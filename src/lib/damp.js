import * as THREE from 'three'

/**
 * damp —— 对应 pmndrs/maath 的 `easing.damp` 语义。
 * smoothTime 越大越“肉”，是时间常数（秒），不是固定 lerp 系数。
 */
export function damp(current, target, smoothTime, delta) {
  const lambda = 1 / Math.max(0.0001, smoothTime)
  return THREE.MathUtils.damp(current, target, lambda, delta)
}

/** 逐分量阻尼（对应 easing.damp3 / damp2，含 maxSpeed 不设限） */
export function damp3(vec, target, smoothTime, delta) {
  vec.x = damp(vec.x, target[0], smoothTime, delta)
  vec.y = damp(vec.y, target[1], smoothTime, delta)
  vec.z = damp(vec.z, target[2], smoothTime, delta)
  return vec
}

export function dampObject(obj, key, target, smoothTime, delta) {
  obj[key] = damp(obj[key], target, smoothTime, delta)
  return obj[key]
}
