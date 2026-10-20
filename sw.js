/**
 * Service Worker - PWA 离线支持
 * 缓存策略：
 * - 静态资源（HTML、CSS、JS、Three.js）：Cache First
 * - 图片资源：Stale While Revalidate
 * - API/动态内容：Network First
 */

const CACHE_NAME = 'pmndrs-cards-v1'
const STATIC_CACHE = 'static-v1'
const IMAGE_CACHE = 'images-v1'

// 需要预缓存的核心资源
const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './src/styles.css',
  './src/main.js',
  './src/scene.js',
  './src/lib/scroll.js',
  './src/lib/damp.js',
  './src/lib/label.js',
  './src/lib/cardMaterial.js',
  './src/lib/textures.js',
  './src/lib/billboard.js',
  './src/lib/imageHandler.js',
  './src/lib/classifier.js',
  './vendor/three.module.js',
]

// 安装：预缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] 预缓存核心资源')
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] 部分资源预缓存失败:', err)
      })
    }).then(() => self.skipWaiting())
  )
})

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== IMAGE_CACHE)
          .map((key) => {
            console.log('[SW] 删除旧缓存:', key)
            return caches.delete(key)
          })
      )
    }).then(() => self.clients.claim())
  )
})

// 拦截请求
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // 仅处理同源请求
  if (url.origin !== location.origin) return

  // HTML 页面：Network First（确保更新）
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst(request, STATIC_CACHE))
    return
  }

  // 静态资源（JS、CSS、Three.js）：Cache First
  if (request.destination === 'script' || request.destination === 'style' ||
      url.pathname.includes('vendor/') || url.pathname.includes('src/lib/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  // 图片：Stale While Revalidate
  if (request.destination === 'image' || url.pathname.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i)) {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE))
    return
  }

  // 其他：Network First
  event.respondWith(networkFirst(request, STATIC_CACHE))
})

// Cache First 策略
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch (e) {
    return new Response('离线不可用', { status: 503 })
  }
}

// Network First 策略
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)

  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch (e) {
    const cached = await cache.match(request)
    if (cached) return cached
    return new Response('离线不可用', { status: 503 })
  }
}

// Stale While Revalidate 策略
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)

  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone())
    return response
  }).catch(() => cached)

  return cached || fetchPromise
}

// 接收客户端消息
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting()
  }
})