{% load static %}/*
 * MyWork's service worker.
 *
 * Served from the site root rather than from /static/, because a worker may
 * only control pages underneath where it was served from: at
 * /static/js/sw.js it would control /static/js/ and nothing else, and a push
 * arriving for the board would have nobody to wake. It is a Django template
 * for one reason — {% templatetag openblock %} static {% templatetag closeblock %}
 * gives the icons their hashed names in production, so a changed icon is a
 * changed URL rather than one the worker cached last month.
 *
 * It does two things and deliberately not a third. There is no fetch handler
 * and nothing is cached: an offline cache is a promise to serve stale pages,
 * and a stale timesheet is worse than no timesheet. This worker exists so
 * that a notification can arrive with the app closed.
 */

const ICON = "{% static 'img/icon-192.png' %}";
const BADGE = "{% static 'img/icon-192.png' %}";

/*
 * A new worker takes over straight away rather than waiting for every tab to
 * close. Notifications are the whole job here, so an old copy lingering is
 * only ever an old copy of this file deciding what a push looks like.
 */
self.addEventListener("install", (event) => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/*
 * Something arrived.
 *
 * The payload is already written — title, body, where to go — because this
 * runs with the app closed and cannot ask the server anything without a
 * network round trip that may simply fail. showNotification must be called:
 * the subscription was made with userVisibleOnly, and a browser that receives
 * a push and shows nothing eventually revokes permission.
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "MyWork", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "MyWork";
  const options = {
    body: data.body || "",
    icon: ICON,
    badge: BADGE,
    /*
     * Two notifications about the same notice replace each other rather than
     * stacking: the tag is the server's dedupe key, so the lock screen shows
     * the same one line the inbox does.
     */
    tag: data.tag || "mywork",
    renotify: true,
    data: { url: data.url || "/" },
    timestamp: Date.now(),
  };

  event.waitUntil(
    self.registration.showNotification(title, options).then(() => {
      /* The number on the home-screen icon, from the same count as the bell. */
      if (typeof data.badge === "number" && self.navigator && self.navigator.setAppBadge) {
        return data.badge > 0
          ? self.navigator.setAppBadge(data.badge).catch(() => {})
          : self.navigator.clearAppBadge().catch(() => {});
      }
    })
  );
});

/*
 * They tapped it.
 *
 * A tab that is already open is focused and navigated rather than joined by a
 * second one — on a phone that is the difference between going back to the
 * app and ending up with two of it. Matching is on the origin, not the exact
 * URL, because the window that is open is almost never sitting on the page
 * the notification points at.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows) {
          if (client.url.indexOf(self.location.origin) === 0 && "focus" in client) {
            if ("navigate" in client) client.navigate(url).catch(() => {});
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});
