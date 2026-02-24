/* Service Worker: Web Push para CRM Gemavip */
self.addEventListener('push', function (event) {
  if (!event.data) return;
  let payload = { title: 'CRM Gemavip', body: '', url: '/notificaciones' };
  try {
    payload = event.data.json();
  } catch (_) {
    payload.body = event.data.text();
  }
  const opts = {
    body: payload.body || 'Nueva solicitud pendiente',
    icon: '/assets/images/gemavip-logo.svg',
    badge: '/assets/images/gemavip-logo.svg',
    tag: 'crm-notif',
    data: { url: payload.url || '/notificaciones' }
  };
  event.waitUntil(
    self.registration.showNotification(payload.title || 'CRM Gemavip', opts)
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const url = event.notification.data?.url || '/notificaciones';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (let i = 0; i < list.length; i++) {
        if (list[i].url.includes(self.location.origin) && 'focus' in list[i]) {
          list[i].navigate(url);
          return list[i].focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
