// CAL·OPS Service Worker
const CACHE_NAME = 'calops-v1'

self.addEventListener('install', event => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  self.clients.claim()
})

// Don't intercept fetch when running in Capacitor
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  // only cache same-origin requests, pass through everything else
  if (url.origin !== location.origin) return
  event.respondWith(fetch(event.request))
})

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {}
  const title = data.title || 'CAL·OPS'
  const options = {
    body: data.body || 'New notification',
    tag: data.tag || 'calops-notification',
    renotify: true,
    data: { url: data.url || '/cal-ops.html' }
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url || '/cal-ops.html'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('cal-ops') && 'focus' in client) return client.focus()
      }
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})
