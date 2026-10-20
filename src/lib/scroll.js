import * as THREE from 'three'

/**
 * 对应 @react-three/drei 的 <ScrollControls pages={4} infinite>。
 * 增加了惯性/动量系统：拖拽释放后保留速度，模拟真实物理惯性滑动。
 */
export class Scroll {
  constructor(domElement, { pages = 4, infinite = true, damping = 0.25, eps = 0.00001, drag = 0.02 } = {}) {
    this.domElement = domElement
    this.pages = pages
    this.infinite = infinite
    this.damping = damping          // 阻尼系数，越小跟随越快
    this.drag = drag                // 惯性阻力系数，越小惯性越大（建议 0.01-0.05）
    this.eps = eps

    this.target = 0                 // 未回绕的目标进度（可任意大或小）
    this.offset = 0                 // 平滑后的公开进度，恒在 [0,1)
    this.delta = 0                  // 本帧变化量绝对值
    this.velocity = 0               // 当前滚动速度（进度/秒）
    this.onChange = null

    this._dragging = false
    this._pointerY = 0
    this._lastPointerY = 0
    this._lastTime = 0
    this._touchY = null
    this.velocity = 0               // 当前滚动速度（进度/秒）
    this.drag = drag                // 惯性阻力系数，越小惯性越大（建议 0.01-0.05）
    this.damping = damping
    this.eps = eps

    this._bind()
  }

  get pagesDone() {
    return this.target - this.offset
  }

  /** 一屏滚动的"像素长度"，用于把像素位移换算成进度增量 */
  _scrollLength() {
    return this.pages * 1000 || 1000
  }

  _push(deltaOffset) {
    this.target += deltaOffset
  }

  _bind() {
    this._onWheel = (event) => {
      if (event.ctrlKey) return // 页面缩放交给浏览器
      event.preventDefault()
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1
      this._push((event.deltaY * scale) / this._scrollLength())
    }
    this._onKeyDown = (event) => {
      if (event.key === 'PageUp' || event.key === 'ArrowUp') this._push(-0.1)
      else if (event.key === 'PageDown' || event.key === 'ArrowDown') this._push(0.1)
      else if (event.key === 'Home') this.jumpTo(0)
      else if (event.key === 'End') this.jumpTo(0.9999)
      else return
      event.preventDefault()
    }
    this._onPointerDown = (event) => {
      this._dragging = true
      this._pointerY = event.clientY
      this._lastPointerY = event.clientY
      this._lastTime = performance.now()
      this.velocity = 0  // 开始拖拽时清零速度
      this.domElement.setPointerCapture?.(event.pointerId)
    }
    this._onPointerMove = (event) => {
      if (!this._dragging) return
      const now = performance.now()
      const dt = (now - this._lastTime) / 1000
      if (dt > 0) {
        const dy = event.clientY - this._lastPointerY
        this.velocity = dy / dt / this._scrollLength()
      }
      this._lastPointerY = event.clientY
      this._lastTime = now
      this._push((event.clientY - this._pointerY) / this._scrollLength())
      this._pointerY = event.clientY
    }
    this._onPointerUp = () => {
      this._dragging = false
      // 保留 velocity，让惯性继续滚动
    }
    this._onTouchMove = (event) => {
      const y = event.touches[0]?.clientY
      if (y == null) return
      if (event.cancelable) event.preventDefault()
      if (this._touchY != null) this._push((y - this._touchY) / this._scrollLength())
      this._touchY = y
    }
    this._onTouchEnd = () => {
      this._touchY = null
      // 触摸结束也保留 velocity 惯性
    }
    this._onKeyDown = (event) => {
      if (event.key === 'PageUp' || event.key === 'ArrowUp') this._push(-0.1)
      else if (event.key === 'PageDown' || event.key === 'ArrowDown') this._push(0.1)
      else if (event.key === 'Home') this.jumpTo(0)
      else if (event.key === 'End') this.jumpTo(0.9999)
      else return
      event.preventDefault()
    }

    const el = this.domElement
    el.addEventListener('wheel', this._onWheel, { passive: false })
    el.addEventListener('pointerdown', this._onPointerDown)
    el.addEventListener('touchstart', this._onTouchMove, { passive: false })
    el.addEventListener('touchmove', this._onTouchMove, { passive: false })
    el.addEventListener('touchend', this._onTouchEnd)
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onKeyDown)
      window.addEventListener('pointermove', this._onPointerMove)
      window.addEventListener('pointerup', this._onPointerUp)
    }
  }

  /** HUD 分组按钮：沿最短路径滚到某个进度（复刻版新增的扩展交互） */
  jumpTo(targetOffset) {
    const diff = targetOffset - this.target
    this.target += diff - Math.round(diff)
    this.velocity = 0 // 跳转时清零速度
  }

  update(delta) {
    const last = this.offset

    // 1. 惯性积分：目标位置 += 速度 * 时间
    if (Math.abs(this.velocity) > 0.0001) {
      this.target += this.velocity * delta
      // 速度指数衰减
      this.velocity *= Math.exp(-this.drag * delta)
    } else {
      this.velocity = 0
    }

    // 2. 阻尼插值到目标位置
    this.offset = THREE.MathUtils.damp(this.offset, this.target, 1 / this.damping, delta)

    // 无限循环逻辑
    if (this.infinite) {
      if (this.offset >= 1) {
        const k = Math.floor(this.offset)
        this.offset -= k
        this.target -= k
      } else if (this.offset < 0) {
        const k = Math.ceil(this.offset)
        this.offset -= k
        this.target -= k
      }
    } else {
      this.offset = THREE.MathUtils.clamp(this.offset, 0, 1)
      this.target = THREE.MathUtils.clamp(this.target, 0, 1)
    }

    this.delta = Math.abs(last - this.offset)
    if (this.onChange) this.onChange(this)
    return this.delta > this.eps
  }

  /** HUD 分组按钮：沿最短路径滚到某个进度（复刻版新增的扩展交互） */
  jumpTo(targetOffset) {
    const diff = targetOffset - this.target
    this.target += diff - Math.round(diff)
    this.velocity = 0 // 跳转时清零速度
  }

  dispose() {
    const el = this.domElement
    el.removeEventListener('wheel', this._onWheel)
    el.removeEventListener('pointerdown', this._onPointerDown)
    el.removeEventListener('touchstart', this._onTouchMove)
    el.removeEventListener('touchmove', this._onTouchMove)
    el.removeEventListener('touchend', this._onTouchEnd)
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._onKeyDown)
      window.removeEventListener('pointermove', this._onPointerMove)
      window.removeEventListener('pointerup', this._onPointerUp)
    }
  }
}