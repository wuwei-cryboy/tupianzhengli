/**
 * 图片处理工具：支持拖拽、粘贴、文件选择、URL 导入
 * 统一输出：{ id, file, blob, url, width, height, name, type, size, preview }
 */

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

function isValidImageFile(file) {
  return SUPPORTED_TYPES.includes(file.type) && file.size <= MAX_FILE_SIZE
}

function createPreviewUrl(file) {
  return URL.createObjectURL(file)
}

function revokePreviewUrl(url) {
  if (url && url.startsWith('blob:')) URL.revokeObjectURL(url)
}

async function getImageDimensions(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = reject
    img.src = URL.createObjectURL(blob)
  })
}

export async function processFile(file) {
  if (!isValidImageFile(file)) {
    throw new Error(`不支持的文件：${file.name}（仅支持 JPG/PNG/WebP/GIF，≤50MB）`)
  }

  const blob = file.slice(0, file.size, file.type)
  const previewUrl = createPreviewUrl(blob)
  const { width, height } = await getImageDimensions(blob)

  return {
    id: crypto.randomUUID(),
    file,
    blob,
    url: previewUrl,
    width,
    height,
    name: file.name,
    type: file.type,
    size: file.size,
    preview: previewUrl,
    uploadedAt: Date.now(),
  }
}

export async function processFiles(files) {
  const results = []
  for (const file of files) {
    try {
      const result = await processFile(file)
      results.push(result)
    } catch (e) {
      console.warn('跳过文件：', e.message)
    }
  }
  return results
}

export function handleDrop(event) {
  event.preventDefault()
  const files = Array.from(event.dataTransfer.files).filter(f => SUPPORTED_TYPES.includes(f.type))
  return files
}

export function handlePaste(event) {
  const items = Array.from(event.clipboardData.items)
  const files = []
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  return files
}

export async function loadImageFromUrl(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('下载失败')
  const blob = await res.blob()
  if (!SUPPORTED_TYPES.includes(blob.type)) throw new Error('不支持的图片格式')
  if (blob.size > MAX_FILE_SIZE) throw new Error('文件过大（>50MB）')

  const { width, height } = await getImageDimensions(blob)
  const previewUrl = URL.createObjectURL(blob)
  const filename = url.split('/').pop() || 'image.jpg'

  return {
    id: crypto.randomUUID(),
    file: null,
    blob,
    url: previewUrl,
    width,
    height,
    name: filename,
    type: blob.type,
    size: blob.size,
    preview: previewUrl,
    uploadedAt: Date.now(),
  }
}

export function setupDropzone(dropzoneEl, fileInputEl, onFiles) {
  const trigger = dropzoneEl.querySelector('#file-trigger')

  const highlight = () => dropzoneEl.classList.add('drag-over')
  const unhighlight = () => dropzoneEl.classList.remove('drag-over')

  dropzoneEl.addEventListener('dragenter', (e) => { e.preventDefault(); highlight() })
  dropzoneEl.addEventListener('dragover', (e) => { e.preventDefault(); highlight() })
  dropzoneEl.addEventListener('dragleave', (e) => { e.preventDefault(); unhighlight() })
  dropzoneEl.addEventListener('drop', (e) => {
    e.preventDefault()
    e.stopPropagation() // 阻止冒泡到 document，避免重复触发 handleDropFiles
    unhighlight()
    const files = handleDrop(e)
    if (files.length) onFiles(files)
  })

  trigger?.addEventListener('click', () => fileInputEl.click())
  fileInputEl?.addEventListener('change', (e) => {
    const files = Array.from(e.target.files)
    if (files.length) onFiles(files)
    e.target.value = ''
  })

  document.addEventListener('paste', (e) => {
    if (e.target === document.body || e.target === document.documentElement) {
      const files = handlePaste(e)
      if (files.length) onFiles(files)
    }
  })
}

export function showProgress(progressEl, fillEl, textEl, show) {
  progressEl.hidden = !show
  if (show) {
    fillEl.style.width = '0%'
    textEl.textContent = '准备中...'
  }
}

export function updateProgress(fillEl, textEl, percent, text) {
  fillEl.style.width = `${Math.round(percent)}%`
  textEl.textContent = text || `${Math.round(percent)}%`
}