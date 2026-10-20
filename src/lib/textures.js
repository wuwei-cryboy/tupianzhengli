import * as THREE from 'three'

/**
 * 原示例的 10 张图片来自 src/img1..img10.jpg。
 * 复刻版不打包任何二进制素材：用 canvas 程序化生成 10 张
 * 尺寸比例各异的「抽象海报」，这样也能顺带验证 shader 里的 cover 裁剪。
 * 想换成自己的图：把 files 换成图片 URL 即可（TextureLoader 支持相对路径）。
 */
const PALETTES = [
  ['#f4d7c0', '#e29a6a', '#7b4b32', '#fbf1e6'],
  ['#cfe0d8', '#6f9c8c', '#1f4a44', '#eef5f0'],
  ['#e7d9f2', '#9b7bb8', '#3b2b52', '#f7f2fb'],
  ['#f6e2c9', '#c8a15a', '#4a3a1f', '#fdf6ea'],
  ['#d8e5f5', '#6f9ac9', '#233a5c', '#f0f6fd'],
  ['#f3d4d7', '#c06b74', '#4d2028', '#fdf0f1'],
  ['#dfe6cf', '#8ba15b', '#2f3a1c', '#f4f7ec'],
  ['#d7e8e8', '#59a3a3', '#134343', '#eef7f7'],
  ['#f0dfd0', '#b9856a', '#43291c', '#fbf3ec'],
]

const SIZES = [
  [1200, 900],
  [900, 1200],
  [1200, 800],
  [1000, 1000],
  [1100, 800],
  [900, 1100],
  [1200, 760],
  [1000, 1300],
  [1200, 900],
  [960, 1200],
]

/** 可复现的伪随机 */
function mulberry32(seed) {
  return function random() {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function drawPoster(index) {
  const [bg, accent, ink, light] = PALETTES[index % PALETTES.length]
  const [w, h] = SIZES[index % SIZES.length]
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  const rnd = mulberry32(index * 977 + 13)

  // 背景渐变
  const grad = ctx.createLinearGradient(0, 0, w, h)
  grad.addColorStop(0, light)
  grad.addColorStop(1, bg)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  // 大色块 / 圆弧
  const shapes = 2 + Math.floor(rnd() * 2)
  for (let s = 0; s < shapes; s++) {
    ctx.save()
    ctx.globalAlpha = 0.55 + rnd() * 0.4
    ctx.fillStyle = s % 2 === 0 ? accent : ink
    const kind = rnd()
    if (kind < 0.45) {
      const r = Math.min(w, h) * (0.18 + rnd() * 0.4)
      ctx.beginPath()
      ctx.arc(w * (0.15 + rnd() * 0.7), h * (0.15 + rnd() * 0.7), r, 0, Math.PI * 2)
      ctx.fill()
    } else if (kind < 0.8) {
      const bw = w * (0.12 + rnd() * 0.4)
      const bh = h * (0.06 + rnd() * 0.5)
      ctx.translate(w * rnd(), h * rnd())
      ctx.rotate((rnd() - 0.5) * 0.6)
      ctx.fillRect(-bw / 2, -bh / 2, bw, bh)
    } else {
      ctx.strokeStyle = ink
      ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.012)
      ctx.beginPath()
      ctx.arc(w * 0.5, h * 0.5, Math.min(w, h) * (0.2 + rnd() * 0.25), 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  // 细颗粒（模拟胶片噪点）
  const grain = ctx.createImageData(w, h)
  for (let i = 0; i < grain.data.length; i += 4) {
    const v = 128 + (rnd() - 0.5) * 26
    grain.data[i] = grain.data[i + 1] = grain.data[i + 2] = v
    grain.data[i + 3] = 14
  }
  ctx.putImageData(grain, 0, 0)

  // 顶部细分割线，增加"版式感"
  ctx.fillStyle = ink
  ctx.globalAlpha = 0.35
  ctx.fillRect(w * 0.08, h * 0.08, w * 0.84, Math.max(1, h * 0.0025))
  ctx.globalAlpha = 1

  return canvas
}

/**
 * 生成海报纹理数组（异步版本，返回 Promise）
 * @param {number} count - 生成数量
 * @returns {Promise<Array<{texture: THREE.Texture, width: number, height: number, ratio: number}>>}
 */
export function createPosterTextures(count = 10) {
  return new Promise((resolve) => {
    // 使用 requestIdleCallback 分片生成，避免阻塞主线程
    const posters = []
    let index = 0
    
    function generateNext(deadline) {
      while (index < 10 && (deadline.timeRemaining() > 1 || deadline.didTimeout)) {
        const canvas = drawPoster(index)
        const texture = new THREE.CanvasTexture(canvas)
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = 4
        texture.minFilter = THREE.LinearMipmapLinearFilter
        texture.magFilter = THREE.LinearFilter
        texture.generateMipmaps = true
        texture.needsUpdate = true
        posters.push({
          texture,
          width: canvas.width,
          height: canvas.height,
          ratio: canvas.width / canvas.height,
        })
        index++
      }
      
      if (index < 10) {
        requestIdleCallback(generateNext, { timeout: 1000 })
      } else {
        resolve(posters)
      }
    }
    
    requestIdleCallback(generateNext, { timeout: 2000 })
  })
}

/**
 * 创建占位纹理（统一结构）
 * @returns {{texture: THREE.Texture, width: number, height: number, ratio: number}}
 */
export function createPlaceholderPoster() {
  const placeholderTex = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat
  )
  placeholderTex.needsUpdate = true
  placeholderTex.colorSpace = THREE.SRGBColorSpace
  return {
    texture: placeholderTex,
    width: 1,
    height: 1,
    ratio: 1,
  }
}