// CAL·OPS Service Worker
// Handles push notifications, background sync, and offline caching

const CACHE_NAME = 'calops-v1'
const ASSETS_TO_CACHE = [
  '/cal-ops.html',
  '/manifest.json'
]

// ── INSTALL ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
  )
  self.skipWaiting()
})

// ── ACTIVATE ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// ── FETCH — serve from cache, fall back to network ──
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  )
})

// ── PUSH NOTIFICATIONS ──
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {}
  const title = data.title || 'CAL·OPS'
  const options = {
    body: data.body || 'New notification',
    icon: data.icon || '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: data.tag || 'calops-notification',
    renotify: true,
    requireInteraction: data.requireInteraction || false,
    data: {
      url: data.url || '/cal-ops.html',
      type: data.type || 'general'
    },
    actions: data.actions || []
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

// ── NOTIFICATION CLICK ──
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url || '/cal-ops.html'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // if app is already open, focus it
      for (const client of clientList) {
        if (client.url.includes('cal-ops') && 'focus' in client) {
          return client.focus()
        }
      }
      // otherwise open new window
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})

// ── BACKGROUND SYNC — check for pending orders ──
self.addEventListener('sync', event => {
  if (event.tag === 'check-orders') {
    event.waitUntil(checkPendingOrders())
  }
})

async function checkPendingOrders() {
  // this runs in background — posts message to client if orders need attention
  const clients_list = await clients.matchAll()
  clients_list.forEach(client => {
    client.postMessage({ type: 'BACKGROUND_SYNC', tag: 'check-orders' })
  })
}
