import * as THREE from 'three'

/**
 * 对应 @react-three/drei 的 <Image> 材质：
 *  - object-fit: cover 的 UV 裁剪（ratio 公式与 drei 一致）
 *  - zoom uniform：绕中心缩放（ActiveCard 从 0.8 回弹到 1 就靠它）
 *  - radius：圆角矩形 SDF，按屏幕导数做抗锯齿
 *
 * 注意：这里用 ShaderMaterial 直出，不做色彩空间转换（纹理按 sRGB 原样显示）。
 */
export function createImageMaterial({
  texture,
  planeSize = [1.618, 1],
  radius = 0.075,
  zoom = 1,
  opacity = 1,
}) {
  const image = texture.image
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    extensions: { derivatives: true },
    uniforms: {
      uMap: { value: texture },
      uImageSize: {
        value: new THREE.Vector2(image?.width ?? 1, image?.height ?? 1),
      },
      uPlaneSize: {
        value: new THREE.Vector2(planeSize[0], planeSize[1]),
      },
      uRadius: { value: radius },
      uZoom: { value: zoom },
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec2 vUv;
      uniform sampler2D uMap;
      uniform vec2 uImageSize;
      uniform vec2 uPlaneSize;
      uniform float uRadius;
      uniform float uZoom;
      uniform float uOpacity;

      // 圆角矩形有向距离场
      float sdRoundRect(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - b + r;
        return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
      }

      void main() {
        // —— cover：按平面/图片宽高比裁剪 UV（drei Image 的 ratio 写法）——
        vec2 ratio = vec2(
          min((uPlaneSize.x / uPlaneSize.y) / (uImageSize.x / uImageSize.y), 1.0),
          min((uPlaneSize.y / uPlaneSize.x) / (uImageSize.y / uImageSize.x), 1.0)
        );
        vec2 uv = vec2(
          vUv.x * ratio.x + (1.0 - ratio.x) * 0.5,
          vUv.y * ratio.y + (1.0 - ratio.y) * 0.5
        );

        // —— zoom：绕中心缩放 ——
        uv = (uv - 0.5) / uZoom + 0.5;

        vec3 color = texture2D(uMap, clamp(uv, 0.0, 1.0)).rgb;

        // —— 圆角遮罩（世界单位）——
        vec2 p = (vUv - 0.5) * uPlaneSize;
        float r = min(uRadius, min(uPlaneSize.x, uPlaneSize.y) * 0.5);
        float d = sdRoundRect(p, uPlaneSize * 0.5, r);
        float aa = max(fwidth(d), 0.0001);
        float alpha = 1.0 - smoothstep(-aa, aa, d);

        if (alpha * uOpacity < 0.004) discard;
        gl_FragColor = vec4(color, alpha * uOpacity);
      }
    `,
  })
  return material
}

/** 卡片共享平面：1.618 : 1（原始示例 scale={[1.618, 1]}） */
export const CARD_GEOMETRY = new THREE.PlaneGeometry(1.618, 1, 1, 1)
