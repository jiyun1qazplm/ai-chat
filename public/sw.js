/*
 * 极简 Service Worker：让浏览器认为本站是可安装的应用，并提供离线兜底。
 * 策略：网络优先，失败时回退到缓存（仅缓存成功的基础资源）。
 */

const CACHE = 'ai-chat-v1'
// 首次安装就缓存首页与图标，保证断网也能打开
const PRECACHE = ['./', './icon-192.png', './icon-512.png', './manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  // 只处理同源的 GET；API 请求（跨域）一律不拦
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return
  }
  event.respondWith(
    fetch(request)
      .then((response) => {
        // 成功响应顺手写入缓存
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {})
        }
        return response
      })
      .catch(() =>
        caches.match(request).then((cached) => cached ?? caches.match('./').then((root) => root ?? Response.error()))
      )
  )
})
