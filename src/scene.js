import * as THREE from 'three'
import { damp, damp3 } from './lib/damp.js'
import { faceCamera } from './lib/billboard.js'
import { Label } from './lib/label.js'
import { createImageMaterial, CARD_GEOMETRY } from './lib/cardMaterial.js'

/**
 * 与原示例 App.tsx 的 CATEGORIES 一一对应：
 * spring / summer / autumn / winter 四段圆弧拼成 2π 的一整圈。
 */
export const CATEGORIES = [
  { name: 'spring', from: 0, len: Math.PI / 4, position: [0, 0, 0] },
  { name: 'summer', from: Math.PI / 4, len: Math.PI / 2, position: [0, 0.4, 0] },
  {
    name: 'autumn',
    from: Math.PI / 4 + Math.PI / 2,
    len: Math.PI / 2,
    position: [0, 0, 0],
  },
  { name: 'winter', from: Math.PI * 1.25, len: Math.PI * 2 - Math.PI * 1.25, position: [0, -0.4, 0] },
]

const RADIUS = 5.25

/**
 * 对应 <Card>：一张 1.618:1 的圆角图片，hover 时放大、上浮
 */
export class Card {
  constructor({ poster, position, rotationY, category, index, localIndex = 0, userImage = false }) {
    this.category = category
    this.index = index
    this.localIndex = localIndex  // 组内局部索引，用于纹理映射
    this.hovered = false
    this.active = false
    this.userImage = userImage

    this.group = new THREE.Group()
    this.group.position.set(...position)
    this.group.rotation.y = rotationY

    this.material = createImageMaterial({
      texture: poster.texture,
      planeSize: [1.618, 1],
      radius: 0.075,
      zoom: 1,
    })
    this.mesh = new THREE.Mesh(CARD_GEOMETRY, this.material)
    this.mesh.userData.card = this
    this.group.add(this.mesh)

    // 与示例一致：初始 scale = [1.618, 1, 1]（几何体已是该尺寸，这里只记录倍数）
    this.scale = new THREE.Vector3(1, 1, 1)
    this.positionOffset = new THREE.Vector3(0, 0, 0)
  }

  /** active = 场景里有任意卡片被悬停（此时同类卡片统一放大到 1.25） */
  setActive(value) {
    this.active = value
  }

  /** hovered = 就是这一张被悬停（放大到 1.4 并上浮） */
  setHovered(value) {
    this.hovered = value
  }

  setVisible(visible) {
    this.mesh.visible = visible
    this.group.visible = visible
  }

  update(delta) {
    // f = hovered ? 1.4 : active ? 1.25 : 1
    const f = this.hovered ? 1.4 : this.active ? 1.25 : 1
    // 位置：hover 时抬起 0.25
    damp3(this.positionOffset, [0, this.hovered ? 0.25 : 0, 0], 0.1, delta)
    this.mesh.position.copy(this.positionOffset)
    // 缩放：阻尼到 [1.618 * f, 1 * f, 1]（几何体基准为 1.618 x 1）
    damp3(this.scale, [f, f, 1], 0.15, delta)
    this.mesh.scale.copy(this.scale)
  }
}

/**
 * 对应 <ActiveCard>：始终面向相机的大图。
 * - 切换时 zoom 从 0.8 回弹到 1，opacity 阻尼到 0 / 1
 */
export class ActiveCard {
  constructor({ posters, activePosterIndex = 0 }) {
    this.posters = posters
    this.activePosterIndex = activePosterIndex

    this.billboard = new THREE.Object3D()

    // 预览图：3.5 宽 × 1.618 高，位置 [0, 1.5, 0]
    this.image = new THREE.Mesh(
      new THREE.PlaneGeometry(3.5, 1.618 * 3.5),
      createImageMaterial({
        texture: posters[0].texture,
        planeSize: [3.5, 1.618 * 3.5],
        radius: 0.3,
        zoom: 0.8,
        opacity: 0,
      }),
    )
    this.image.position.set(0, 1.5, 0)
    this.billboard.add(this.image)

    this.visible = false
    this.material = this.image.material
  }

  setHovered(card) {
    if (card) {
      if (card.material && card.material.uniforms.uMap?.value) {
        this.material.uniforms.uMap.value = card.material.uniforms.uMap.value
        const tex = card.material.uniforms.uMap.value
        if (tex.image) {
          this.material.uniforms.uImageSize.value.set(tex.image.width, tex.image.height)
        }
      } else {
        const localIndex = card.localIndex ?? (card.index % this.posters.length)
        this.activePosterIndex = localIndex % this.posters.length
        const poster = this.posters[this.activePosterIndex]
        this.material.uniforms.uMap.value = poster.texture
        this.material.uniforms.uImageSize.value.set(poster.width, poster.height)
      }
    }
    this.material.uniforms.uZoom.value = 0.8
    this.visible = Boolean(card)
  }

  faceCamera(camera) {
    faceCamera(this.billboard, camera)
  }

  update(delta) {
    const u = this.material.uniforms
    u.uZoom.value = damp(u.uZoom.value, 1, 0.5, delta)
    u.uOpacity.value = damp(u.uOpacity.value, this.visible ? 1 : 0, 0.3, delta)
    this.image.visible = u.uOpacity.value > 0.01
  }
}

export class CategoryLabel {
  constructor({ text, position }) {
    this.label = new Label({
      lines: [text],
      fontSize: 0.25,
      anchorX: 'center',
      anchorY: 'middle',
      color: '#000',
    })
    this.billboard = new THREE.Object3D()
    this.billboard.position.set(...position)
    this.billboard.add(this.label.mesh)
  }

  update(camera) {
    faceCamera(this.billboard, camera)
  }
}