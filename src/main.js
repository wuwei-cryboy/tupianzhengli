import * as THREE from 'three'
import { Card, ActiveCard, CategoryLabel, CATEGORIES } from './scene.js'
import { Scroll } from './lib/scroll.js'
import { damp3 } from './lib/damp.js'
import { createPosterTextures } from './lib/textures.js'
import { createImageMaterial } from './lib/cardMaterial.js'
import { processFiles } from './lib/imageHandler.js'
import { classifier, DEFAULT_CATEGORIES } from './lib/classifier.js'
import { loadAllImages, saveImage, reviveRecord, deleteImage } from './lib/imageStore.js'

/* ================================================================
 * 全局状态 & DOM 引用
 * ================================================================ */
const canvas = document.getElementById('scene')
const boot = document.getElementById('boot')
const bootText = document.getElementById('boot-text')
const statsEl = document.getElementById('stats')
const chipsEl = document.getElementById('chips')
const fpsEl = document.getElementById('fps')
const fileInput = document.getElementById('file-input')

// 分类/上传相关
const userImages = []
let categoryModal = null, categoryInput = null, editingCategoryId = null
let activeFiltersCache = new Set()

/** 启动时从 IndexedDB 恢复用户上传的图片 */
async function restoreUserImages() {
  try {
    const records = await loadAllImages()
    if (!records.length) return
    console.log(`[ImageStore] 恢复 ${records.length} 张用户图片`)
    
    // 去重：按 id 只保留第一条
    const uniqueRecords = []
    const seenIds = new Set()
    for (const r of records) {
      if (!seenIds.has(r.id)) {
        seenIds.add(r.id)
        uniqueRecords.push(r)
      }
    }
    if (uniqueRecords.length !== records.length) {
      console.log(`[ImageStore] 去重：${records.length} → ${uniqueRecords.length}`)
    }
    
    for (const record of uniqueRecords) {
      const img = reviveRecord(record)
      // 创建纹理
      const texture = await new Promise((resolve, reject) => {
        const loader = new THREE.TextureLoader()
        loader.load(img.preview, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace
          resolve(tex)
        }, undefined, reject)
      })
      addUserImage({
        ...img,
        texture,
        // 兼容旧记录没有 categoryId 的情况
        categoryId: img.categoryId || 'custom',
        confidence: img.confidence || 0,
      }, { persist: false }) // 恢复时不再重复写入 IndexedDB
    }
  } catch (e) {
    console.warn('[ImageStore] 恢复失败:', e)
  }
}

// 视图模式
let viewMode = '3d', currentGridFilter = null
const gridView = document.getElementById('grid-view')
const gridContainer = document.getElementById('grid-container')
const gridTitle = document.getElementById('grid-title')
const backBtn = document.getElementById('back-to-3d')
const modalOverlay = document.getElementById('modal-overlay')
const modalImage = document.getElementById('modal-image')
const modalTitle = document.getElementById('modal-title')
const modalMeta = document.getElementById('modal-meta')
const modalClose = document.getElementById('modal-close')
const modalCategorySelect = document.getElementById('modal-category-select')
let editingImageData = null

// Three.js 对象（初始化后赋值）
let renderer, scene, camera, root, rotating
let cards = [], labels = [], activeCard, scroll
let pointer, raycaster, posters

// 场景就绪标志
let sceneReady = false
let initScenePromise = null

/* ================================================================
 * 异步场景初始化（核心优化：占位纹理+分片创建+异步纹理生成）
 * ================================================================ */
async function initScene() {
  console.log('[Three.js] 开始初始化场景...')

  // 1. 渲染器（快，同步 OK）
  console.log('[Three.js] 创建渲染器...')
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor('#fdfdfd', 1)

  scene = new THREE.Scene()
  
  // 关键修复：立即同步 canvas 真实尺寸到 camera 和 renderer，修正 aspect ratio
  const width = canvas.clientWidth || window.innerWidth
  const height = canvas.clientHeight || window.innerHeight
  if (width > 0 && height > 0) {
    camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 200)
    renderer.setSize(width, height, false)
  } else {
    camera = new THREE.PerspectiveCamera(75, 1, 0.1, 200)
  }
  camera.position.set(0, 4.5, 9)

  root = new THREE.Group()
  root.position.set(0, 1.5, 0)
  scene.add(root)

  rotating = new THREE.Group()
  root.add(rotating)

  // 让出主线程
  await new Promise(r => setTimeout(r, 0))
  console.log('[Three.js] 渲染器创建完成')

  // 2. 占位纹理（1x1 白色），先让卡片能渲染
  // 形状必须与 createPosterTextures 的真实纹理一致（{ texture, width, height, ratio }），
  // 因为 Card / ActiveCard 内部都会读 poster.texture
  console.log('[Three.js] 创建占位纹理...')
  const placeholderTex = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat
  )
  placeholderTex.needsUpdate = true
  placeholderTex.colorSpace = THREE.SRGBColorSpace
  const placeholderPoster = { texture: placeholderTex, width: 1, height: 1, ratio: 1 }
  posters = Array(10).fill(placeholderPoster)

  // 异步生成真实纹理（不阻塞主流程）
  console.log('[Three.js] 开始异步生成真实纹理...')
  
  // 纹理版本号机制 - 解决竞态条件
  let textureVersion = 0
  
  createPosterTextures(10).then(realPosters => {
    textureVersion++
    const currentVersion = textureVersion
    posters = realPosters
    
    // 更新已创建卡片的纹理
    cards.forEach((card, i) => {
      // 防御性检查
      if (!card?.material?.uniforms?.uMap) return
      const poster = realPosters[i % realPosters.length]
      if (poster?.texture) {
        card.material.uniforms.uMap.value = poster.texture
        card.material.needsUpdate = true
      }
    })
    if (activeCard?.material?.uniforms?.uMap) {
      if (realPosters[0]?.texture) {
        activeCard.material.uniforms.uMap.value = realPosters[0].texture
        activeCard.material.needsUpdate = true
      }
    }
    console.log('[Three.js] 真实纹理已替换 (v' + textureVersion + ')')
  }).catch(err => console.warn('[Three.js] 纹理生成失败:', err))
  
  // 暴露纹理版本号供后续新卡片使用
  window.__textureVersion = () => textureVersion

  // 3. 指针/射线/卡片容器（快）
  pointer = new THREE.Vector2(0, 0)
  raycaster = new THREE.Raycaster()
  cards = []
  labels = []

  // 4. 创建卡片环（分批次，避免长任务阻塞）
  for (let configIdx = 0; configIdx < CATEGORIES.length; configIdx++) {
    const config = CATEGORIES[configIdx]
    const group = new THREE.Group()
    group.position.set(...config.position)
    rotating.add(group)

    const amount = Math.round(config.len * 22)
    const count = amount - 3

    // 分组标题
    const label = new CategoryLabel({
      text: config.name,
      position: [
        Math.sin(config.from + config.len / 2) * 5.25 * 1.4,
        0.5,
        Math.cos(config.from + config.len / 2) * 5.25 * 1.4,
      ],
    })
    group.add(label.billboard)
    labels.push(label)

    for (let i = 0; i < count; i += 1) {
      const angle = config.from + (i / amount) * config.len
      const card = new Card({
        poster: posters[i % posters.length],
        position: [Math.sin(angle) * 5.25, 0, Math.cos(angle) * 5.25],
        rotationY: Math.PI / 2 + angle,
        category: config.name,
        index: cards.length,
        localIndex: i,
      })
      group.add(card.group)
      cards.push(card)
    }
    await new Promise(r => setTimeout(r, 0))
    console.log(`[Three.js] 分组 ${config.name} 创建完成`)
  }

  // 5. ActiveCard（用占位图）— 挂在 root 固定位置，不随环旋转
  activeCard = new ActiveCard({ posters, activePosterIndex: 0 })
  root.add(activeCard.billboard)

  // 6. 滚动交互
  scroll = new Scroll(canvas, { pages: 4, infinite: true })

  // 7. 交互系统（快）
  pointer = new THREE.Vector2(0, 0)
  raycaster = new THREE.Raycaster()

  function setPointer(event) {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  }
  canvas.addEventListener('pointermove', setPointer)
  canvas.addEventListener('pointerdown', setPointer)
  canvas.addEventListener('pointerleave', () => pointer.set(0, 0))

  console.log('[Three.js] 场景构建完成')
  
  // 关键修复：场景构建完成后，强制同步一次尺寸，修正 camera.aspect
  resize()
  
  // 恢复用户上传的图片
  await restoreUserImages()
  
  return true
}

/* ================================================================
 * 初始化入口（供 index.html 视频播放时调用）
 * ================================================================ */
function startInitScene() {
  if (!initScenePromise) {
    console.log('[Three.js] 启动场景初始化...')
    initScenePromise = initScene().then(() => {
      sceneReady = true
      console.log('[Three.js] 场景初始化完成')
      startRenderLoop()
    }).catch(err => {
      console.error('[Three.js] 初始化失败:', err)
      sceneReady = true
      startRenderLoop()
      showError('场景初始化失败，请刷新页面重试')
    })
  }
  return initScenePromise
}

/* ================================================================
 * 渲染循环（等待场景就绪后运行）
 * ================================================================ */
const clock = new THREE.Clock()
let fpsAcc = 0, fpsFrames = 0, fps = 0

function frame() {
  if (!sceneReady || !scroll || !rotating || !renderer) return

  const rawDelta = clock.getDelta()
  const delta = Math.min(rawDelta, 0.1)

  scroll.update(delta)
  rotating.rotation.y = -scroll.offset * Math.PI * 2

  damp3(camera.position, [-pointer.x * 2, pointer.y * 2 + 4.5, 9], 0.3, delta)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()

  setHovered(pick())

  for (const card of cards) card.update(delta)
  activeCard.update(delta)
  for (const label of labels) label.update(camera)
  activeCard.faceCamera(camera)

  // FPS
  const fpsDelta = clock.getDelta()
  fpsAcc += fpsDelta
  fpsFrames += 1
  if (fpsAcc > 0.5) {
    fps = Math.round(fpsFrames / fpsAcc)
    fpsAcc = 0
    fpsFrames = 0
    if (fpsEl) fpsEl.textContent = `${fps} fps`
  }

  renderer.render(scene, camera)
}

function startRenderLoop() {
  if (sceneReady) {
    // 关键修复：场景就绪时强制同步一次尺寸，修正 camera.aspect 和 renderer size
    resize()
    renderer.setAnimationLoop(frame)
    console.log('[Three.js] 渲染循环已启动')
  } else {
    const checkReady = setInterval(() => {
      if (sceneReady) {
        clearInterval(checkReady)
        resize()  // 确保延迟启动时也修正尺寸
        renderer.setAnimationLoop(frame)
        console.log('[Three.js] 渲染循环已启动(延迟)')
      }
    }, 50)
  }
  hideBoot()
}

// 启动遮罩：场景就绪后才移除，避免一直显示"正在构建卡片环"
function hideBoot() {
  if (!boot) return
  boot.classList.add('boot--done')
  setTimeout(() => boot.remove(), 900)
}

// 初始化失败时把启动遮罩显示为错误状态（不再无限转圈）
function showError(message) {
  if (!boot) return
  boot.classList.remove('boot--done')
  boot.classList.add('boot--error')
  if (bootText) bootText.textContent = message
}

/* ================================================================
 * 导出供 index.html 调用
 * ================================================================ */
window.startInitScene = startInitScene
window.sceneReady = () => sceneReady
window.getSceneReady = () => sceneReady

/* ================================================================
 * 交互：滚动 / 指针 / 拾取
 * ================================================================ */
let hoveredCard = null

function pick() {
  // 关键：更新世界矩阵（递归），确保射线与旋转后的卡片正确相交
  rotating.updateWorldMatrix(true, true)
  raycaster.setFromCamera(pointer, camera)
  const meshes = cards.map((card) => card.mesh)
  const hits = raycaster.intersectObjects(meshes, false)
  return hits.length ? cards.find((card) => card.mesh === hits[0].object) : null
}

function setHovered(card) {
  if (card === hoveredCard) return
  hoveredCard = card

  for (const item of cards) {
    item.setActive(Boolean(card))
    item.setHovered(item === card)
  }
  activeCard.setHovered(card)

  if (chipsEl) {
    for (const chip of chipsEl.children) {
      chip.classList.toggle('is-active', chip.textContent === card?.category)
    }
  }

  if (card) {
    statsEl.textContent = `${card.category} · #${String(card.index).padStart(2, '0')}`
    statsEl.classList.add('is-live')
  } else {
    statsEl.textContent = '—'
    statsEl.classList.remove('is-live')
  }
}

/* ================================================================
 * 图片上传与分类（仅在用户上传时触发 AI 识别）
 * ================================================================ */
function addUserImage(imageData, { persist = true } = {}) {
  const material = createImageMaterial({
    texture: imageData.texture || imageData.previewTexture,
    planeSize: [1.618, 1],
    radius: 0.075,
    zoom: 1,
  })
  const angle = rotating.rotation.y + (Math.random() - 0.5) * 0.5
  const card = new Card({
    poster: { texture: material.uniforms.uMap.value, width: imageData.width, height: imageData.height, ratio: imageData.width / imageData.height },
    position: [Math.sin(angle) * 5.25, 0, Math.cos(angle) * 5.25],
    rotationY: Math.PI / 2 + angle,
    category: imageData.category || 'custom',
    index: cards.length,
    localIndex: 0,
    userImage: true,
  })
  card.mesh.material = material
  card.material = material  // 关键：同步给 card.material，供 ActiveCard 读取

  // 根据分类精准找到对应的组（优先用 categoryId，兼容旧数据用 name）
  let targetGroup = null
  if (imageData.categoryId) {
    const catConfig = CATEGORIES.find(c => c.name === imageData.category)
    if (catConfig) {
      const idx = CATEGORIES.indexOf(catConfig)
      targetGroup = rotating.children[idx]
    }
  }
  if (!targetGroup) {
    // 兜底：用 name 模糊匹配
    const catIndex = CATEGORIES.findIndex(c => c.name === (imageData.category || 'custom'))
    targetGroup = rotating.children[catIndex >= 0 ? catIndex : 0]
  }
  if (targetGroup) targetGroup.add(card.group)

  cards.push(card)

  // 持久化：保存到 IndexedDB（只存 blob + 元数据，不存 Three.js 对象）
  if (persist) {
    const record = {
      id: imageData.id,
      blob: imageData.blob,
      name: imageData.name,
      type: imageData.type,
      size: imageData.size,
      width: imageData.width,
      height: imageData.height,
      category: imageData.category,
      categoryId: imageData.categoryId,
      confidence: imageData.confidence,
      uploadedAt: imageData.uploadedAt || Date.now(),
    }
    saveImage(record).catch(e => console.warn('[ImageStore] 保存失败:', e))
  }

  userImages.push({ ...imageData, card })
  updateCategoryChips()
}

async function handleDropFiles(files) {
  if (!files.length) return

  try {
    const processed = await processFiles(files)
    let completed = 0

    for (const img of processed) {
      let categoryId = 'custom'
      let confidence = 0

      if (img.preview) {
        const imgEl = document.createElement('img')
        imgEl.src = img.preview
        await new Promise(resolve => { imgEl.onload = resolve; imgEl.onerror = resolve })
        // 仅在用户上传时调用 AI 分类
        const result = await classifier.classify(imgEl)
        categoryId = result.categoryId
        confidence = result.confidence
      }

      const texture = await new Promise((resolve, reject) => {
        const loader = new THREE.TextureLoader()
        loader.load(img.preview, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace
          resolve(tex)
        }, undefined, reject)
      })

      addUserImage({
        ...img,
        texture,
        category: classifier.getAllCategories().find(c => c.id === categoryId)?.name || '自定义',
        categoryId,
        confidence,
      })

      completed++
    }
  } catch (e) {
    console.error('上传失败:', e)
  }
}

// 分类筛选芯片更新
function updateCategoryChips() {
  if (!chipsEl) return

  const activeFilters = new Set()
  for (const btn of chipsEl.children) {
    if (btn.classList.contains('is-active') && btn.dataset.filter) {
      activeFilters.add(btn.dataset.filter)
    }
  }

  const presetCats = CATEGORIES.map(c => c.name)
  const builtinCustomCats = DEFAULT_CATEGORIES.map(c => c.name)
  const customCats = classifier.customCategories.map(c => c.name)
  const allCats = [...presetCats, ...builtinCustomCats, ...customCats]

  chipsEl.innerHTML = ''

  for (const name of allCats) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'chip'
    btn.textContent = name
    btn.dataset.filter = name
    const presetIdx = presetCats.indexOf(name)
    if (presetIdx !== -1) {
      btn.dataset.index = presetIdx
    }
    if (customCats.includes(name)) {
      btn.dataset.custom = 'true'
    }
    if (activeFilters.has(name)) {
      btn.classList.add('is-active')
    }
    chipsEl.appendChild(btn)
  }

  const addBtn = document.createElement('button')
  addBtn.type = 'button'
  addBtn.className = 'chip chip-add'
  addBtn.innerHTML = '+'
  addBtn.title = '新建分类'
  addBtn.addEventListener('click', showCategoryModal)
  chipsEl.appendChild(addBtn)
}

// 统一的分类芯片点击处理
chipsEl?.addEventListener('click', (event) => {
  const btn = event.target.closest('button.chip[data-filter]')
  if (!btn) return

  const filter = btn.dataset.filter
  const isActive = btn.classList.toggle('is-active')

  if (isActive) {
    for (const other of chipsEl.children) {
      if (other !== btn) other.classList.remove('is-active')
    }
  }

  if (viewMode === 'grid') {
    if (currentGridFilter === filter) return
    currentGridFilter = filter
    renderGrid(filter)

    for (const other of chipsEl.children) {
      other.classList.toggle('is-active', other.dataset.filter === filter)
    }
  } else {
    if (btn.dataset.index !== undefined) {
      const config = CATEGORIES[Number(btn.dataset.index)]
      if (scroll && typeof scroll.jumpTo === 'function') {
        scroll.jumpTo((config.from + config.len / 2) / (Math.PI * 2))
      }
    } else {
      enterGridMode(filter)
    }
  }
})

/* ================================================================
 * 2D 平铺模式 & 模态框
 * ================================================================ */
function getAllImages() {
  const all = []
  for (const card of cards) {
    if (card.userImage) continue
    const tex = card.material.uniforms.uMap.value
    all.push({
      id: `preset-${card.category}-${card.index}`,
      category: card.category,
      texture: tex,
      width: tex.image?.width || 1,
      height: tex.image?.height || 1,
      preview: tex.image?.src || '',
      name: `${card.category} ${card.index}`,
      isPreset: true,
      cardRef: card,
    })
  }
  for (const img of userImages) {
    const tex = img.card.material.uniforms.uMap.value
    all.push({
      id: img.id,
      category: img.category,
      texture: tex,
      width: img.width,
      height: img.height,
      preview: img.preview,
      name: img.name,
      isPreset: false,
      cardRef: img.card,
    })
  }
  return all
}

function enterGridMode(filterCategory) {
  currentGridFilter = filterCategory
  viewMode = 'grid'
  const catName = filterCategory === '自定义' ? '自定义分类' : filterCategory
  gridTitle.textContent = catName
  renderGrid(filterCategory)
  document.getElementById('scene').classList.add('view-hidden')
  gridView.hidden = false
  gridView.offsetHeight
  gridView.classList.add('active')
}

function exitGridMode() {
  viewMode = '3d'
  currentGridFilter = null
  gridView.classList.remove('active')
  document.getElementById('scene').classList.remove('view-hidden')
  setTimeout(() => {
    if (viewMode === '3d') {
      gridView.hidden = true
      gridContainer.innerHTML = ''
    }
  }, 500)
}

function showGridItemContextMenu(e, img) {
  e.preventDefault()
  const existing = document.querySelector('.grid-item-context-menu')
  if (existing) existing.remove()

  const allCategories = classifier.getAllCategories()
  const menu = document.createElement('div')
  menu.className = 'grid-item-context-menu'
  const categoryItems = allCategories.map(cat => {
    const isCurrent = cat.name === img.category
    return `<button class="ctx-category${isCurrent ? ' current' : ''}" data-category-id="${cat.id}">${isCurrent ? '✓ ' : ''}${cat.name}</button>`
  }).join('')
  menu.innerHTML = categoryItems + '<hr style="margin:4px 0;border-color:var(--ink-faint)"><button class="ctx-delete" style="color:#c00;">删除图片</button>'
  menu.style.left = `${e.clientX}px`
  menu.style.top = `${e.clientY}px`
  document.body.appendChild(menu)

  for (const btn of menu.querySelectorAll('.ctx-category')) {
    btn.addEventListener('click', () => {
      const newCategoryId = btn.dataset.categoryId
      const newCategory = classifier.getAllCategories().find(c => c.id === newCategoryId)
      if (!newCategory || newCategory.name === img.category) { menu.remove(); return }
      const oldCategory = img.category
      img.category = newCategory.name
      img.categoryId = newCategory.id
      if (img.cardRef) img.cardRef.category = newCategory.name
      const userImgIdx = userImages.findIndex(u => u.id === img.id)
      if (userImgIdx !== -1) {
        userImages[userImgIdx].category = newCategory.name
        userImages[userImgIdx].categoryId = newCategory.id
      }
      renderGrid(currentGridFilter)
      updateCategoryChips()
      console.log(`[分类修改] ${img.name}: ${oldCategory} → ${newCategory.name}`)
      menu.remove()
    })
  }

  // 删除按钮
  menu.querySelector('.ctx-delete')?.addEventListener('click', async () => {
    if (!confirm('确定删除这张图片吗？')) return
    // 1. 从 IndexedDB 删除
    await deleteImage(img.id)
    // 2. 从 3D 场景移除
    if (img.cardRef) {
      img.cardRef.setVisible(false)
      const idx = cards.indexOf(img.cardRef)
      if (idx >= 0) cards.splice(idx, 1)
    }
    // 3. 从内存数组移除
    const idx = userImages.findIndex(u => u.id === img.id)
    if (idx >= 0) userImages.splice(idx, 1)
    // 4. 刷新 UI
    updateCategoryChips()
    renderGrid(currentGridFilter)
    menu.remove()
  })
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeMenu) }
  }
  setTimeout(() => document.addEventListener('click', closeMenu), 0)
}

let gridPressTimer = null
function bindGridItemLongPress(item, img) {
  item.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== undefined) return
    gridPressTimer = setTimeout(() => showGridItemContextMenu({ preventDefault: () => {}, clientX: e.clientX, clientY: e.clientY }, img), 500)
  })
  item.addEventListener('pointerup', () => clearTimeout(gridPressTimer))
  item.addEventListener('pointerleave', () => clearTimeout(gridPressTimer))
  item.addEventListener('pointercancel', () => clearTimeout(gridPressTimer))
}

function renderGrid(filterCategory) {
  const allImages = getAllImages()
  const filtered = filterCategory
    ? allImages.filter(img => img.category === filterCategory || (filterCategory === '自定义' && img.category === '自定义'))
    : allImages

  gridContainer.innerHTML = ''

  if (filtered.length === 0) {
    gridContainer.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--ink-soft); padding: 40px;">该分类暂无图片</p>'
    return
  }

  const shuffled = [...filtered].sort(() => Math.random() - 0.5)

  for (let i = 0; i < shuffled.length; i++) {
    const img = shuffled[i]
    const item = document.createElement('div')
    item.className = 'grid-item'
    item.style.animationDelay = `${i * 0.03}s`

    const tex = img.texture
    const src = tex.image?.src || img.preview || ''

    item.innerHTML = `
      <img src="${src}" alt="${img.name}" loading="lazy">
      <div class="grid-item-info">
        <div class="grid-item-title">${img.name}</div>
        <div class="grid-item-meta">${img.category} · ${img.width}×${img.height}</div>
      </div>
    `

    item.addEventListener('click', () => openModal(img))
    item.addEventListener('contextmenu', (e) => showGridItemContextMenu(e, img))
    bindGridItemLongPress(item, img)
    gridContainer.appendChild(item)
  }
}

modalCategorySelect?.addEventListener('change', handleModalCategoryChange)

function openModal(img) {
  const tex = img.texture
  const src = tex.image?.src || img.preview || ''
  editingImageData = img
  modalImage.src = src
  modalImage.alt = img.name
  modalTitle.textContent = img.name
  modalMeta.textContent = `${img.category} · ${img.width}×${img.height} · ${(img.size / 1024).toFixed(1)} KB`
  updateModalCategorySelect(img.category)
  modalOverlay.hidden = false
  modalOverlay.offsetHeight
  modalOverlay.classList.add('active')
}

function updateModalCategorySelect(currentCategory) {
  if (!modalCategorySelect) return
  const allCategories = classifier.getAllCategories()
  modalCategorySelect.innerHTML = ''
  for (const cat of allCategories) {
    const option = document.createElement('option')
    option.value = cat.id
    option.textContent = cat.name
    if (cat.name === currentCategory || cat.id === currentCategory) option.selected = true
    modalCategorySelect.appendChild(option)
  }
}

function handleModalCategoryChange() {
  if (!editingImageData || !modalCategorySelect) return
  const newCategoryId = modalCategorySelect.value
  const newCategory = classifier.getAllCategories().find(c => c.id === newCategoryId)
  if (!newCategory) return
  const oldCategory = editingImageData.category
  if (oldCategory === newCategory.name) return
  editingImageData.category = newCategory.name
  editingImageData.categoryId = newCategory.id
  if (editingImageData.cardRef) editingImageData.cardRef.category = newCategory.name
  const userImgIdx = userImages.findIndex(u => u.id === editingImageData.id)
  if (userImgIdx !== -1) {
    userImages[userImgIdx].category = newCategory.name
    userImages[userImgIdx].categoryId = newCategory.id
  }
  modalMeta.textContent = `${newCategory.name} · ${editingImageData.width}×${editingImageData.height} · ${(editingImageData.size / 1024).toFixed(1)} KB`
  if (viewMode === 'grid') renderGrid(currentGridFilter)
  updateCategoryChips()
  console.log(`[分类修改] ${editingImageData.name}: ${oldCategory} → ${newCategory.name}`)
}

function closeModal(immediate = false) {
  modalOverlay.classList.remove('active')
  const delay = immediate ? 0 : 300
  setTimeout(() => { modalOverlay.hidden = true; modalImage.src = '' }, delay)
}

backBtn?.addEventListener('click', () => {
  for (const chip of chipsEl?.children || []) chip.classList.remove('is-active')
  for (const card of cards) { card.mesh.visible = true; card.group.visible = true }
  for (const img of userImages) { img.card.mesh.visible = true; img.card.group.visible = true }
  exitGridMode()
})

modalClose?.addEventListener('click', closeModal)
modalOverlay?.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal() })

document.addEventListener('dblclick', (e) => {
  if (e.target.closest('.modal-overlay') || e.target.closest('button') || e.target.closest('a')) return
  if (viewMode === 'grid') exitGridMode()
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (modalOverlay.classList.contains('active')) closeModal()
    else if (viewMode === 'grid') exitGridMode()
  }
})

let isDragging = false
document.addEventListener('dragenter', (e) => {
  if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); isDragging = true; document.body.classList.add('dragging') }
})
document.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() })
document.addEventListener('dragleave', (e) => {
  if (e.clientX <= 0 || e.clientX >= window.innerWidth || e.clientY <= 0 || e.clientY >= window.innerHeight) {
    isDragging = false; document.body.classList.remove('dragging')
  }
})
document.addEventListener('drop', async (e) => {
  // 如果事件已经被 dropzone 处理（stopPropagation），则不再重复处理
  if (e.defaultPrevented) return
  if (e.dataTransfer.types.includes('Files')) {
    e.preventDefault()
    isDragging = false
    document.body.classList.remove('dragging')
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
    if (files.length) await handleDropFiles(files)
  }
})

fileInput?.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'))
  if (files.length) await handleDropFiles(files)
  e.target.value = ''
})

/* ================================================================
 * 分类弹窗（新建/编辑分类）
 * ================================================================ */
function showCategoryModal() {
  if (categoryModal) return
  const modal = document.createElement('div')
  modal.className = 'category-modal'
  modal.innerHTML = `
    <div class="category-modal-content">
      <h3>新建分类</h3>
      <input type="text" placeholder="分类名称" class="category-input">
      <div class="category-modal-actions">
        <button class="category-cancel">取消</button>
        <button class="category-confirm">创建</button>
      </div>
    </div>
  `
  document.body.appendChild(modal)
  categoryModal = modal
  categoryInput = modal.querySelector('.category-input')
  categoryInput.focus()

  modal.querySelector('.category-cancel').addEventListener('click', closeCategoryModal)
  modal.querySelector('.category-confirm').addEventListener('click', confirmCategoryModal)
  modal.addEventListener('click', (e) => { if (e.target === modal) closeCategoryModal() })
}

function closeCategoryModal() {
  categoryModal?.remove()
  categoryModal = null
  categoryInput = null
}

function confirmCategoryModal() {
  const name = categoryInput?.value?.trim()
  if (!name) return
  classifier.addCustomCategory({ name })
  closeCategoryModal()
  updateCategoryChips()
}

/* ================================================================
 * 启动流程
 * ================================================================ */
// 初始化分类芯片
updateCategoryChips()

// 响应式窗口尺寸
function resize() {
  const width = window.innerWidth, height = window.innerHeight
  // 防御性检查：避免 0 尺寸
  if (width === 0 || height === 0) {
    console.warn('[Three.js] resize: 尺寸为 0，跳过')
    return
  }
  if (camera) { camera.aspect = width / height; camera.updateProjectionMatrix() }
  if (renderer) renderer.setSize(width, height, false)
}
window.addEventListener('resize', resize)

// 兜底：模块被直接 import 时（如 index_local.html）也会启动场景初始化
// 通过 window.startInitScene 暴露的入口，避免重复初始化
if (typeof document !== 'undefined' && document.getElementById('scene')) {
  startInitScene()
}
