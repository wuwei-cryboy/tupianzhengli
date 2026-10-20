import * as THREE from 'three'

/**
 * 对应 drei 的 <Text>（troika-three-text）里最关键的那部分：
 * 把 canvas 上的文字做成一张始终正对相机的平面，fontSize 以世界单位计。
 * 原示例用 Inter，这里用 Helvetica/Arial 近似替代，颜色纯黑。
 */
export class Label {
  constructor({
    lines = [],
    fontSize = 0.25,
    anchorX = 'center',
    anchorY = 'middle',
    lineHeight = 1.15,
    color = '#000',
    font = 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif',
    weight = 400,
    letterSpacing = 0,
    pxPerUnit = 256,
  } = {}) {
    this.fontSize = fontSize
    this.anchorX = anchorX
    this.anchorY = anchorY
    this.lineHeight = lineHeight
    this.color = color
    this.font = font
    this.weight = weight
    this.letterSpacing = letterSpacing
    this.pxPerUnit = pxPerUnit

    this.canvas = document.createElement('canvas')
    this.ctx = this.canvas.getContext('2d')
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.minFilter = THREE.LinearFilter
    this.texture.magFilter = THREE.LinearFilter
    this.texture.generateMipmaps = false

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material)
    this.material.color.set(color)
    this._lines = null

    this.setLines(lines)
  }

  setLines(value) {
    const lines = (Array.isArray(value) ? value : [value]).map((line) =>
      String(line ?? ''),
    )
    if (this._lines && this._lines.join('\u0000') === lines.join('\u0000')) {
      return this
    }
    this._lines = lines
    this._layout()
    return this
  }

  setColor(color) {
    if (color === this.color) return this
    this.color = color
    this.material.color.set(color)
    return this
  }

  setOpacity(value) {
    this.material.opacity = value
    this.material.transparent = true
    return this
  }

  _layout() {
    const ctx = this.ctx
    const fontPx = Math.round(this.fontSize * this.pxPerUnit)
    const fontSpec = `${this.weight} ${fontPx}px ${this.font}`
    ctx.font = fontSpec
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${this.letterSpacing}px`

    const lines = this._lines.length ? this._lines : ['']
    const widths = lines.map((line) => ctx.measureText(line || ' ').width)
    const pad = Math.ceil(fontPx * 0.12)
    const lineH = fontPx * this.lineHeight
    const width = Math.ceil(Math.max(1, ...widths)) + pad * 2
    const height = Math.ceil(lineH * lines.length) + pad * 2

    this.canvas.width = width
    this.canvas.height = height

    ctx.font = fontSpec
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${this.letterSpacing}px`
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#ffffff'
    ctx.textBaseline = 'middle'

    lines.forEach((line, i) => {
      const w = widths[i]
      const x =
        this.anchorX === 'left'
          ? pad
          : this.anchorX === 'right'
            ? width - pad - w
            : (width - w) / 2
      ctx.fillText(line, x, pad + lineH * (i + 0.5))
    })

    this.texture.needsUpdate = true

    this.width = width / this.pxPerUnit
    this.height = height / this.pxPerUnit

    this.mesh.geometry.dispose()
    this.mesh.geometry = new THREE.PlaneGeometry(this.width, this.height)

    // troika 语义：anchorX=left 时左边缘对齐到 position.x；anchorY=top 时上边缘对齐到 position.y
    const offsetX = this.anchorX === 'left' ? this.width / 2 : 0
    const offsetY = this.anchorY === 'top' ? -this.height / 2 : 0
    this.mesh.position.set(offsetX, offsetY, 0)
    return this
  }

  dispose() {
    this.texture.dispose()
    this.material.dispose()
    this.mesh.geometry.dispose()
  }
}
