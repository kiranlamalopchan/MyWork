/* MyWork — notifications on this device.

   Everything here is an enhancement over a page that already works: the bell
   in the app bar, the inbox behind it and the count on both are rendered by
   Django and need none of this. What this file adds is the part a server
   cannot do — asking the browser for permission, handing the subscription
   back, and putting a number on the home-screen icon.

   Three things have to be true before a notification can arrive with the app
   closed: the browser supports service workers and push, the page is on
   HTTPS (or localhost), and the person said yes to a prompt they were shown
   because they tapped something. On an iPhone there is a fourth — the app
   must have been added to the Home Screen; Safari in a tab cannot subscribe
   at all, and says so by not offering the API. Each of those is checked
   before anything is offered, so nobody is shown a switch that cannot work. */
(function () {
  "use strict";

  var meta = function (name) {
    var el = document.querySelector('meta[name="' + name + '"]');
    return el ? el.getAttribute("content") : "";
  };

  var VAPID = meta("vapid-key");
  var CSRF = meta("csrf-token");

  var supported =
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  /* iOS only exposes push to a PWA that was added to the Home Screen. It is
     worth telling somebody that, rather than letting them tap a button that
     silently does nothing. */
  var iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  var installed =
    window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;

  /* ----------------------------------------------------------------------
     Talking to the server
     ---------------------------------------------------------------------- */

  function post(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": CSRF },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
  }

  /* The VAPID public key travels as base64url text and has to reach
     pushManager.subscribe as bytes. */
  function keyBytes(base64url) {
    var padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    var raw = window.atob(padded);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  function asJSON(subscription) {
    var json = subscription.toJSON();
    return { endpoint: json.endpoint, keys: json.keys };
  }

  /* ----------------------------------------------------------------------
     The worker
     ---------------------------------------------------------------------- */

  function register() {
    /* Scope "/" because the worker is served from the root; saying it out
       loud means a mistake in the URL fails here rather than quietly
       registering something that controls a corner of the site. */
    return navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }

  /* Keep this device subscribed, on every load.

     Not only on the first yes. Two things go wrong over time and both are
     silent: a push service rotates the endpoint, so the server holds an
     address nothing lives at any more; or the browser drops the subscription
     outright — an update, a storage sweep, a push the site failed to show —
     and the person is left with permission granted, a switch that says it is
     on, and nothing ever arriving.

     So both are repaired here. An existing subscription is re-sent, which is
     idempotent and costs one small POST. A missing one is made again, which
     is safe to do without asking: permission has already been granted, so
     there is no prompt and nothing for the person to notice. The alternative
     is a switch that quietly stops working until somebody thinks to toggle
     it off and on, which nobody ever does. */
  function refresh() {
    if (!supported || !VAPID || Notification.permission !== "granted") return;

    register()
      .then(function (reg) { return reg.pushManager.getSubscription(); })
      .then(function (subscription) {
        if (subscription) return post("/notifications/subscribe/", asJSON(subscription));
        /* Granted, but nothing to send to: subscribe again, quietly. */
        return subscribe();
      })
      .catch(function () { /* offline, or a browser that changed its mind */ });
  }

  function subscribe() {
    return register()
      .then(function (reg) {
        return reg.pushManager.getSubscription().then(function (existing) {
          if (existing) return existing;
          return reg.pushManager.subscribe({
            /* Required by every browser: a push may not arrive silently.
               The worker shows a notification for each one, which is what
               this is promising. */
            userVisibleOnly: true,
            applicationServerKey: keyBytes(VAPID),
          });
        });
      })
      .then(function (subscription) {
        return post("/notifications/subscribe/", asJSON(subscription));
      });
  }

  function unsubscribe() {
    return register()
      .then(function (reg) { return reg.pushManager.getSubscription(); })
      .then(function (subscription) {
        if (!subscription) return null;
        var body = { endpoint: subscription.endpoint };
        return subscription.unsubscribe().then(function () {
          return post("/notifications/unsubscribe/", body);
        });
      });
  }

  /* ----------------------------------------------------------------------
     The switch on the inbox page
     ---------------------------------------------------------------------- */

  function initToggle() {
    var box = document.getElementById("push-setup");
    if (!box) return;

    var button = document.getElementById("push-toggle");
    var status = document.getElementById("push-status");

    function say(text, action, on) {
      status.textContent = text;
      box.hidden = false;
      box.classList.toggle("is-on", !!on);
      if (action) {
        button.hidden = false;
        button.textContent = action;
      } else {
        button.hidden = true;
      }
    }

    if (!supported) {
      if (iOS && !installed) {
        say(
          "To get notifications on an iPhone, add MyWork to your Home Screen " +
            "first: tap Share, then Add to Home Screen, and open it from there.",
          null
        );
      } else {
        say("This browser can't show notifications when MyWork is closed.", null);
      }
      return;
    }

    if (!VAPID) {
      say("Push notifications aren't set up on this server yet.", null);
      return;
    }

    if (Notification.permission === "denied") {
      say(
        "Notifications are blocked for MyWork. Turn them back on in your " +
          "browser's settings for this site, then reload.",
        null
      );
      return;
    }

    function settle() {
      if (Notification.permission !== "granted") {
        say("Get a notification when something happens on the board.", "Turn on");
        return;
      }
      register()
        .then(function (reg) { return reg.pushManager.getSubscription(); })
        .then(function (subscription) {
          if (subscription) {
            say("On for this device.", "Turn off", true);
          } else {
            say("Get a notification when something happens on the board.", "Turn on");
          }
        })
        .catch(function () {
          say("Get a notification when something happens on the board.", "Turn on");
        });
    }

    button.addEventListener("click", function () {
      var turningOff = box.classList.contains("is-on");
      button.disabled = true;
      status.textContent = turningOff ? "Turning off…" : "Just a moment…";

      var work = turningOff
        ? unsubscribe()
        : /* The prompt must come from this tap. Asking on page load is how a
             browser learns to refuse on your behalf for ever. */
          Notification.requestPermission().then(function (permission) {
            if (permission !== "granted") return null;
            return subscribe();
          });

      work
        .catch(function () {
          say("That didn't work. Try again, or reload the page.", "Try again");
        })
        .then(function () {
          button.disabled = false;
          if (Notification.permission === "denied") {
            say("Notifications are blocked for MyWork in this browser.", null);
          } else {
            settle();
          }
        });
    });

    settle();
  }

  /* ----------------------------------------------------------------------
     The number on the home-screen icon

     Set from the count Django already rendered into the page, so the icon,
     the bell and the inbox never disagree. The service worker sets it again
     when something arrives while the app is closed.
     ---------------------------------------------------------------------- */

  function initBadge() {
    if (!("setAppBadge" in navigator)) return;
    var count = parseInt(meta("unread-count"), 10);
    if (isNaN(count)) return;

    try {
      if (count > 0) navigator.setAppBadge(count).catch(function () {});
      else navigator.clearAppBadge().catch(function () {});
    } catch (e) { /* not permitted here — the bell still says it */ }
  }

  function init() {
    initToggle();
    initBadge();
    refresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
