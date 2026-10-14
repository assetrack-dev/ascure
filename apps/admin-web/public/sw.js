/*
 * ASCURE console service worker — Web Push only (plan §19, N56).
 *
 * Shows a push and opens its link. Deliberately NO fetch handler / caching:
 * the console must always load live data, and an offline cache here would
 * serve stale pages after every deploy.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "ASCURE", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "ASCURE";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      // Same tag = the phone REPLACES the earlier notification for this group
      // ("12 repairs" replaces "3 repairs") instead of stacking or re-buzzing.
      tag: data.tag || undefined,
      renotify: false,
      data: { url: data.url || "/", notificationId: data.notificationId || null },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          await client.focus();
          if ("navigate" in client) return client.navigate(target);
          return undefined;
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
