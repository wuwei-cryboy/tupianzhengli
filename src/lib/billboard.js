import * as THREE from 'three'

const _parentQ = new THREE.Quaternion()

/**
 * 等价于 drei 的 <Billboard>：
 *
 *   inner.quaternion = inverse(parentWorldQuaternion) * cameraWorldQuaternion
 *
 * 关键点：补偿必须发生在**局部**空间。因为卡片环整体在绕 Y 轴旋转，
 * 若直接写成 object.quaternion.copy(camera.quaternion)，标签和大图会跟着环一起转。
 */
export function faceCamera(object3D, camera) {
  const parent = object3D.parent
  if (!parent) {
    object3D.quaternion.copy(camera.quaternion)
    return
  }
  parent.updateWorldMatrix(true, false)
  parent.getWorldQuaternion(_parentQ)
  object3D.quaternion.copy(camera.quaternion).premultiply(_parentQ.invert())
  object3D.updateMatrix()
}
