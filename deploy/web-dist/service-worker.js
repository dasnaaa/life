// Web-Push Service Worker fuer die Web-Deployment (life.wrkt.at).
// Registriert von lib/pushNotifications.ts. Zeigt eingehende Push-Events als
// System-Benachrichtigung an und oeffnet/fokussiert die App bei Klick.
self.addEventListener("push", (event) => {
  let payload = { title: "Daily Brief", body: "" };
  try {
    if (event.data) payload = event.data.json();
  } catch {
    payload = { title: "Daily Brief", body: event.data ? event.data.text() : "" };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "Daily Brief", {
      body: payload.body || "",
      icon: "/favicon.png",
      badge: "/favicon.png",
      data: payload.data || {},
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
