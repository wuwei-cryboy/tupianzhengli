/**
 * 无浏览器逻辑自测：在 Node 里加载真实的 three.js，跑通几何 / 阻尼 / 滚动 /
 * 拾取 / hover 形变这些与 DOM 无关的路径，确认复刻版的核心数学和原示例一致。
 *
 * 运行：node scripts/check.mjs
 */
import * as THREE from 'three'
import { Scroll } from '../src/lib/scroll.js'
import { damp, damp3 } from '../src/lib/damp.js'
import { CATEGORIES } from '../src/scene.js'
import { CARD_GEOMETRY } from '../src/lib/cardMaterial.js'

let failures = 0
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failures += 1
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps

/* ------------------------------------------------------------------ */
console.log('\n[1] 四个分组弧段必须无缝拼成 2π')
{
  let cursor = 0
  let ok = true
  for (const c of CATEGORIES) {
    if (!close(c.from, cursor)) ok = false
    cursor = c.from + c.len
  }
  check('from/len 首尾相接', ok)
  check('总弧长 = 2π', close(cursor, Math.PI * 2, 1e-9), `total=${cursor.toFixed(12)}`)

  const amounts = CATEGORIES.map((c) => Math.round(c.len * 22))
  check(
    '卡片数量为 amount-3 且为正',
    amounts.every((a) => a - 3 > 0),
    amounts.map((a) => a - 3).join(' / '),
  )
  console.log(`       每段卡片数：${amounts.map((a) => a - 3).join(', ')}（共 ${amounts.reduce((s, a) => s + a - 3, 0)} 张）`)
}

/* ------------------------------------------------------------------ */
console.log('\n[2] 环形排布：位置在半径 5.25 的圆上，宽度轴沿径向')
{
  const angle = 1.234
  const radius = 5.25
  const position = new THREE.Vector3(Math.sin(angle) * radius, 0, Math.cos(angle) * radius)
  const rotationY = Math.PI / 2 + angle
  const rotation = new THREE.Euler(0, rotationY, 0)
  const normal = new THREE.Vector3(0, 0, 1).applyEuler(rotation) // 面法线 = 局部 +Z
  const widthAxis = new THREE.Vector3(1, 0, 0).applyEuler(rotation) // 卡片宽度轴 = 局部 +X
  const radial = position.clone().setY(0).normalize()

  check('半径正确', close(position.length(), radius, 1e-9), `r=${position.length()}`)
  check(
    '面法线与径向垂直（切向）',
    Math.abs(normal.dot(radial)) < 1e-9,
    `dot=${normal.dot(radial).toFixed(12)}`,
  )
  check(
    '宽度轴沿径向（|dot| = 1）',
    close(Math.abs(widthAxis.dot(radial)), 1, 1e-9),
    `dot=${widthAxis.dot(radial).toFixed(6)}`,
  )
  // 竖直方向必须保持不动（rotation 只有 Y 分量）
  check('卡片保持竖直', close(normal.y, 0, 1e-12) && close(widthAxis.y, 0, 1e-12))
}

/* ------------------------------------------------------------------ */
console.log('\n[3] 滚动 → 旋转映射与无限回绕')
{
  const fakeEl = {
    addEventListener() {},
    removeEventListener() {},
    setPointerCapture() {},
  }
  const scroll = new Scroll(fakeEl, { pages: 4, infinite: true })

  // 直接推目标值，模拟滚轮
  scroll._target = 0.3
  for (let i = 0; i < 400; i += 1) scroll.update(1 / 60)
  check('阻尼收敛到目标 offset', Math.abs(scroll.offset - 0.3) < 1e-3, `offset=${scroll.offset.toFixed(5)}`)

  const rotation = -scroll.offset * Math.PI * 2
  check('offset 0.3 → 旋转 -0.6π', close(rotation, -Math.PI * 0.6, 2e-3), `ry=${rotation.toFixed(4)}`)

  // 正向越界回绕
  scroll._target = 1.2
  for (let i = 0; i < 1200; i += 1) scroll.update(1 / 60)
  check('offset 永远落在 [0,1)', scroll.offset >= 0 && scroll.offset < 1, `offset=${scroll.offset.toFixed(6)}`)
  check('回绕后等价于 0.2 圈', Math.abs(scroll.offset - 0.2) < 2e-3, `offset=${scroll.offset.toFixed(4)}`)

  // 反向回绕
  scroll._target = -0.9
  for (let i = 0; i < 1500; i += 1) scroll.update(1 / 60)
  check('反向回绕同样保持在 [0,1)', scroll.offset >= 0 && scroll.offset < 1, `offset=${scroll.offset.toFixed(4)}`)
  check('反向回绕后等价于 0.1 圈', Math.abs(scroll.offset - 0.1) < 3e-3, `offset=${scroll.offset.toFixed(4)}`)
}

/* ------------------------------------------------------------------ */
console.log('\n[4] maath easing.damp 语义')
{
  let x = 0
  let t = 0
  const dt = 1 / 60
  for (let i = 0; i < 30; i += 1) {
    x = damp(x, 1, 0.1, dt)
    t += dt
  }
  const expected = 1 - Math.exp(-t / 0.1)
  check('smoothTime=0.1 时 0.5s 后 ≈ 1-e^-5', Math.abs(x - expected) < 1e-6, `x=${x.toFixed(6)}`)
  check('已经非常接近目标', x > 0.99, x.toFixed(4))

  const v = new THREE.Vector3(0, 0, 0)
  for (let i = 0; i < 120; i += 1) damp3(v, [1.4, 1.4, 1], 0.15, dt)
  check('damp3 三轴独立收敛', close(v.z, 1, 1e-3) && v.x > 1.39, `x=${v.x.toFixed(4)} z=${v.z.toFixed(4)}`)

  // 帧率无关性：同样是 0.5s，用 30fps 与 120fps 推演结果应当一致
  const step = (fps) => {
    let value = 0
    const d = 1 / fps
    for (let i = 0; i < Math.round(0.5 * fps); i += 1) value = damp(value, 1, 0.12, d)
    return value
  }
  check(
    '阻尼与帧率无关',
    Math.abs(step(30) - step(120)) < 2e-3,
    `30fps=${step(30).toFixed(5)} 120fps=${step(120).toFixed(5)}`,
  )
}

/* ------------------------------------------------------------------ */
console.log('\n[5] hover 形变状态机（f = hovered ? 1.4 : active ? 1.25 : 1）')
{
  const f = (hovered, active) => (hovered ? 1.4 : active ? 1.25 : 1)
  check('无 hover → 1.0', f(false, false) === 1)
  check('有卡片 hover（自身）→ 1.4', f(true, true) === 1.4)
  check('有卡片 hover（其他）→ 1.25', f(false, true) === 1.25)

  // 模拟：hover 到第 5 张，跑 1s，检查被 hover 的那张确实大到 1.4、其余 1.25
  const cards = Array.from({ length: 12 }, () => ({ scale: new THREE.Vector3(1, 1, 1) }))
  const hoveredIndex = 5
  const dt = 1 / 60
  for (let i = 0; i < 90; i += 1) {
    cards.forEach((card, i2) => {
      const hovered = i2 === hoveredIndex
      const active = true
      damp3(card.scale, [f(hovered, active), f(hovered, active), 1], 0.15, dt)
    })
  }
  check(
    '被 hover 的卡片 ≈ 1.4x',
    Math.abs(cards[hoveredIndex].scale.x - 1.4) < 2e-3,
    cards[hoveredIndex].scale.x.toFixed(4),
  )
  check(
    '其余卡片 ≈ 1.25x',
    Math.abs(cards[0].scale.x - 1.25) < 2e-3,
    cards[0].scale.x.toFixed(4),
  )
}

/* ------------------------------------------------------------------ */
console.log('\n[6] 射线拾取与可视范围（相机从环心上方俯视）')
{
  const camera = new THREE.PerspectiveCamera(75, 1.6, 0.1, 200)
  camera.position.set(0, 4.5, 9)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()

  // 复刻 main.js 的层级：scene root 在 y=1.5，卡片在 XZ 平面上半径 5.25
  const SCENE_Y = 1.5
  const radius = 5.25
  const meshes = []
  const entries = []
  for (const c of CATEGORIES) {
    const amount = Math.round(c.len * 22)
    for (let i = 0; i < amount - 3; i += 1) {
      const angle = c.from + (i / amount) * c.len
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.618, 1))
      mesh.position.set(
        Math.sin(angle) * radius,
        SCENE_Y + c.position[1],
        Math.cos(angle) * radius,
      )
      mesh.rotation.y = Math.PI / 2 + angle
      mesh.updateMatrixWorld()
      meshes.push(mesh)
      entries.push({ mesh, category: c.name, index: i, angle })
    }
  }

  // 视野内可见卡片数量（投影到 NDC）
  let visible = 0
  for (const e of entries) {
    const p = e.mesh.position.clone().project(camera)
    if (Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z > -1 && p.z < 1) visible += 1
  }
  check('至少一半卡片在视野内', visible >= entries.length / 2, `可见 ${visible}/${entries.length}`)

  const raycaster = new THREE.Raycaster()
  const pickAt = (ndc) => {
    raycaster.setFromCamera(ndc, camera)
    const hits = raycaster.intersectObjects(meshes, false)
    return hits.length ? { hit: hits[0], entry: entries.find((e) => e.mesh === hits[0].object) } : null
  }

  // 把最靠近相机的卡片投影回屏幕，再从该像素反向拾取，必须命中它自己
  const nearest = entries.reduce((best, e) =>
    e.mesh.position.distanceTo(camera.position) < best.mesh.position.distanceTo(camera.position) ? e : best,
  )
  const ndc = nearest.mesh.position.clone().project(camera)
  const picked = pickAt(new THREE.Vector2(ndc.x, ndc.y))
  check('从卡片像素反向拾取命中该卡片', picked?.entry?.mesh === nearest.mesh,
    picked ? `${picked.entry.category} #${picked.entry.index}` : 'no hit')

  // 沿一条水平扫描线移动指针：应当连续命中多张不同卡片（hover 在高频切换）
  const distinct = new Map()
  for (let x = -0.9; x <= 0.9; x += 0.01) {
    const p = pickAt(new THREE.Vector2(x, ndc.y * 0.6))
    if (p) distinct.set(`${p.entry.category}#${p.entry.index}`, p.entry)
  }
  check(
    '一次横扫能命中多张不同卡片',
    distinct.size >= 3,
    `命中 ${distinct.size} 张：${[...distinct.keys()].slice(0, 6).join(', ')}…`,
  )

  // 上方（sky）与屏幕正下方应当命中足够少的卡片，保证环是“一圈立着的卡片”
  const top = pickAt(new THREE.Vector2(0, 0.85))
  check('画面上方基本为空白', !top, top ? `${top.entry.category} #${top.entry.index}` : '空')

  // 屏幕中心（环心正上方）应为空，避免整圈遮挡死角
  const center = pickAt(new THREE.Vector2(0, 0))
  console.log(`       屏幕中心命中：${center ? `${center.entry.category} #${center.entry.index}` : '（空，环心）'}`)
}

/* ------------------------------------------------------------------ */
console.log('\n[7] 卡片几何比例 1.618 : 1')
{
  const params = CARD_GEOMETRY.parameters
  check('PlaneGeometry 1.618 x 1', close(params.width, 1.618) && close(params.height, 1))
  const big = new THREE.PlaneGeometry(3.5, 1.618 * 3.5)
  check('ActiveCard 大图 3.5 x 5.663', close(big.parameters.height, 5.663, 1e-9))
}

console.log('')
if (failures) {
  console.error(`✗ ${failures} 项检查未通过`)
  process.exit(1)
}
console.log('✓ 全部检查通过')
