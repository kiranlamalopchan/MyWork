/* MyWork — progressive enhancement.
   Everything here is optional: each page works fully with JS disabled, and
   these handlers only bind when the elements they need are actually present. */
(function () {
  "use strict";

  /* ----------------------------------------------------------------------
     Page lifecycle

     There used to be one page per document: a tap loaded a new document,
     and everything this file had set up — timers, listeners on window, a
     half-finished fetch — went with the old one. Soft navigation (the last
     section of this file) keeps the document and swaps only the body, so a
     page now has an end that is not the document's end, and anything wired
     to something longer-lived than the body has to be undone then.

     Two kinds of initialiser follow from that. The ones in initOnce() listen
     on the document itself and find their elements at event time, so they
     are set up once and are never stale. The ones in initPage() belong to
     the body on screen; they run again for every page, and anything they
     attach beyond the body they attach through these helpers, which undo it
     when the page is left. An initialiser that only touches elements inside
     the body needs none of this — those listeners go when the body does.
     ---------------------------------------------------------------------- */
  var leaving = [];

  /* Something to undo when this page is left. */
  function onLeave(fn) {
    leaving.push(fn);
  }

  /* addEventListener that is undone when the page is left — for window,
     document, a MediaQueryList, anything that outlives the body. */
  function listen(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    onLeave(function () { target.removeEventListener(type, fn, options); });
  }

  /* setInterval that stops when the page is left. */
  function every(fn, ms) {
    var id = setInterval(fn, ms);
    onLeave(function () { clearInterval(id); });
  }

  function leavePage() {
    var undo = leaving;
    leaving = [];
    for (var i = 0; i < undo.length; i++) {
      try { undo[i](); } catch (e) { /* one failed teardown must not stop the rest */ }
    }
  }

  /* Popstate handlers that belong to the page on screen — a filter whose
     choices are history entries (see wireLiveFilter). Held here rather than
     on window so they go with the page, and so soft navigation can tell a
     step within the page from a step to another one. */
  var historyOwners = [];

  function ownHistory(fn) {
    historyOwners.push(fn);
    onLeave(function () {
      historyOwners = historyOwners.filter(function (other) { return other !== fn; });
    });
  }

  /* The address of the page on screen — path and query — as soft navigation
     knows it. Two things in this file rewrite the address without leaving
     the page (the live search, the live filter); they say so here, so that a
     step through history can be told apart from a jump to an anchor. */
  var shown = null;

  function noteAddress() {
    shown = { key: location.pathname + location.search, pathname: location.pathname };
  }
  noteAddress();

  /* ----------------------------------------------------------------------
     Theme toggle
     The initial value is applied by an inline script in <head> so there's no
     flash of the wrong palette; this only handles the button.
     ---------------------------------------------------------------------- */
  function initTheme() {
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;

    var root = document.documentElement;
    var system = window.matchMedia("(prefers-color-scheme: dark)");

    function isDark() {
      var chosen = root.getAttribute("data-theme");
      return chosen ? chosen === "dark" : system.matches;
    }

    // The switch says which way it is set. The stylesheet draws it from the
    // theme rules on its own; this is for a screen reader, which cannot see
    // where the knob is.
    function announce() {
      btn.setAttribute("aria-checked", isDark() ? "true" : "false");
    }
    announce();
    // The system can change underneath a page that has not chosen.
    if (system.addEventListener) listen(system, "change", announce);

    btn.addEventListener("click", function () {
      var next = isDark() ? "light" : "dark";

      function apply() {
        root.setAttribute("data-theme", next);
        try { localStorage.setItem("mywork-theme", next); } catch (e) { /* private mode */ }
        announce();

        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute("content", next === "dark" ? "#0b1120" : "#f4f5f7");
      }

      // One palette dissolves into the other rather than cutting to it: the
      // browser snapshots the page, swaps the theme underneath, and fades
      // between the two — one composited crossfade, which is far cheaper
      // than transitioning every colour on every element.
      //
      // On a desktop. The snapshot is of the whole page — every frosted
      // panel and the lens in the app bar — and a phone spends the length
      // of the fade drawing it, dropping frames under the knob as it goes,
      // so the one thing you are looking at is the one thing that judders.
      // There the switch is simply the switch: its own slide, sky and stars
      // carry the change, and the page changes under it in a frame. The
      // same where motion is reduced, or the browser cannot do it at all.
      var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var touch = window.matchMedia("(pointer: coarse)").matches;
      if (document.startViewTransition && !still && !touch) {
        document.startViewTransition(apply);
      } else {
        apply();
      }
    });
  }

  /* ----------------------------------------------------------------------
     The app bar behaves like a phone's navigation bar

     Two things a native bar does that a web header does not, and both are
     read off the page rather than told to it. A page with somewhere to go
     back to carries a .backlink; on a phone its href and its words are
     lifted into the slot at the left of the bar, where a thumb expects
     them, and the page's own copy is hidden by the stylesheet (§3). And
     once the page's big heading has scrolled up under the bar, its words
     appear in the middle of it — so a long list still says what it is.

     The bar is part of the body and is swapped with it, so this runs for
     every page and starts from nothing each time.
     ---------------------------------------------------------------------- */
  /* Whether this page has a way back, said on <body> so the stylesheet can
     hide the page's own link on phones. Called before a scroll position is
     put back (render, and a reload), not only when the bar is set up: the
     link is 40px tall, and restoring a position measured without it and
     then taking it away lands the page 40px short. */
  function markBack() {
    var backlink = document.querySelector("main .backlink");
    document.body.classList.toggle("has-back", !!backlink);
    return backlink;
  }

  function initAppBar() {
    var bar = document.querySelector(".appbar");
    if (!bar) return;

    var back = bar.querySelector(".appbar__back");
    var backlink = markBack();
    if (back && backlink) {
      back.setAttribute("href", backlink.getAttribute("href"));
      var label = back.querySelector(".appbar__back-label");
      if (label) label.textContent = backlink.textContent.replace(/\s+/g, " ").trim();
      bar.classList.add("has-back");
    }

    var slot = bar.querySelector(".appbar__title");
    var heading = document.querySelector("main .page-title, main .profile-id__name");
    if (!slot || !heading || !("IntersectionObserver" in window)) return;
    slot.textContent = heading.textContent.replace(/\s+/g, " ").trim();

    // "Gone" means gone under the bar, not merely off the bottom of a short
    // window: the heading has to be above the viewport, and the margin
    // makes the bar's own height count as above.
    var watcher = new IntersectionObserver(function (entries) {
      var entry = entries[0];
      var gone = !entry.isIntersecting && entry.boundingClientRect.top < bar.offsetHeight;
      bar.classList.toggle("is-titled", gone);
    }, { rootMargin: "-" + bar.offsetHeight + "px 0px 0px 0px" });
    watcher.observe(heading);
    onLeave(function () { watcher.disconnect(); });
  }

  /* ----------------------------------------------------------------------
     Arriving from a notification

     Tapping a notification on a lock screen lands you on the board at an
     anchor — a notice, or one comment inside somebody's thread. Two things
     then have to happen that the browser will not do on its own.

     The thing may be folded away. A thread keeps its newest few comments
     open and hides the rest behind "View 3 previous comments", and an anchor
     pointing into a closed <details> scrolls to nothing. Every fold above the
     target is opened first.

     And it has to be obvious which one it was. The board already flashes
     briefly on :target, which is right when you have just reacted and been
     sent back — you know what you were looking at. Arriving from a
     notification is the opposite: you have been away, the page is full of
     other people's notices, and the whole question is which one this is
     about. So it gets a longer, louder mark of its own, and the page scrolls
     it to the middle rather than jamming it under the app bar.

     Runs on load, on hashchange, and when a soft navigation lands on an
     anchor — which fires neither. hashchange matters because a notification
     tapped while MyWork is already open navigates the tab it finds (see
     sw.js), and :target does not re-animate for that.
     ---------------------------------------------------------------------- */
  function landOnHash() {
    var id = window.location.hash.slice(1);
    if (!id) return;

    var target = document.getElementById(id);
    if (!target) return;

    /* Open everything it is hidden inside, innermost first. A reply nested
       under a folded comment is two deep. */
    var box = target.closest ? target.closest("details") : null;
    while (box) {
      box.open = true;
      box = box.parentElement && box.parentElement.closest
        ? box.parentElement.closest("details")
        : null;
    }

    /* Re-triggering an animation means taking the class off, letting the
       browser notice, and putting it back — otherwise a second arrival at
       the same comment does nothing at all. */
    target.classList.remove("is-arrived");
    void target.offsetWidth;
    target.classList.add("is-arrived");

    var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });

    window.setTimeout(function () {
      target.classList.remove("is-arrived");
    }, 4000);
  }

  function initArrival() {
    /* On load the anchor is already applied, but the fold above it may not
       have finished laying out; a frame's wait is enough and avoids
       scrolling to the wrong place. */
    if (window.location.hash) window.requestAnimationFrame(landOnHash);
    window.addEventListener("hashchange", landOnHash);
  }

  /* ----------------------------------------------------------------------
     Sticky search bar: draw a hairline only once it's actually stuck
     ---------------------------------------------------------------------- */
  function initStickyBar() {
    var bar = document.querySelector(".searchbar");
    if (!bar || !("IntersectionObserver" in window)) return;

    // A zero-height sentinel above the bar: when it scrolls out of view the
    // bar has reached its sticky position.
    var sentinel = document.createElement("div");
    sentinel.setAttribute("aria-hidden", "true");
    sentinel.style.cssText = "position:absolute;height:1px;width:1px;";
    bar.parentNode.insertBefore(sentinel, bar);

    var watcher = new IntersectionObserver(function (entries) {
      bar.classList.toggle("is-stuck", !entries[0].isIntersecting);
    });
    watcher.observe(sentinel);
    onLeave(function () { watcher.disconnect(); });
  }

  /* ----------------------------------------------------------------------
     Live search
     Replaces the server-rendered result list as you type. Falls back to a
     normal form submit if the request fails or JS is unavailable.
     ---------------------------------------------------------------------- */
  var ICON_CHEVRON =
    '<svg class="result__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="m9 18 6-6-6-6"/></svg>';

  var ICON_SEARCH_LG =
    '<div class="empty__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg></div>';

  function emptyCard(title, sub) {
    return '<div class="card"><div class="empty">' + ICON_SEARCH_LG +
      '<div class="empty__title">' + title + "</div>" +
      '<div class="empty__sub">' + sub + "</div></div></div>";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Wrap matches in <mark>, on already-escaped text. Each word is highlighted
  // separately, matching how the server searches: "lamb chops" marks both
  // words in "LAMB BONE-IN BBQ CHOPS", where the phrase never appears.
  function highlight(escapedText, query) {
    var words = query.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return escapedText;

    // Longest first, so a short word can't split a longer match apart.
    words.sort(function (a, b) { return b.length - a.length; });

    var pattern = words
      .map(function (w) { return escapeHtml(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); })
      .join("|");

    try {
      var re = new RegExp("(" + pattern + ")", "gi");
      // Step over HTML entities (&amp;, &#39;) so a query like "amp" can't
      // highlight inside one and break the escaping.
      return escapedText
        .split(/(&[a-zA-Z]+;|&#\d+;)/)
        .map(function (part, i) {
          return i % 2 ? part : part.replace(re, "<mark>$1</mark>");
        })
        .join("");
    } catch (e) {
      return escapedText;
    }
  }

  /* ----------------------------------------------------------------------
     Skeletons
     Shapes standing in for something being waited for. Built here rather
     than written into each template because the two places that wait — a
     search in flight and a page that hasn't arrived — want the same shapes,
     and a placeholder that drifts from the thing it replaces is worse than
     no placeholder at all.
     ---------------------------------------------------------------------- */
  function skeletonRows(count, lead) {
    var html = '<ul class="skeleton-list">';
    // Widths step down the stack so it reads as writing, not as grey bars.
    var widths = ["skeleton--w85", "skeleton--w70", "skeleton--w55", "skeleton--w40"];
    for (var i = 0; i < count; i++) {
      html +=
        '<li><div class="skeleton-row">' +
        '<span class="skeleton ' + (lead || "skeleton--badge") + '"></span>' +
        '<span class="skeleton-row__body">' +
        '<span class="skeleton skeleton--line ' + widths[i % widths.length] + '"></span>' +
        '<span class="skeleton skeleton--line skeleton--w40"></span>' +
        "</span></div></li>";
    }
    return html + "</ul>";
  }

  function skeletonCard() {
    return (
      '<div class="skeleton-card">' +
      '<span class="skeleton skeleton--line skeleton--w40"></span>' +
      '<span class="skeleton skeleton--line skeleton--w85"></span>' +
      '<span class="skeleton skeleton--line skeleton--w70"></span>' +
      "</div>"
    );
  }

  /* ----------------------------------------------------------------------
     The page skeletons
     One per kind of screen, in the shape of that screen: the clock page
     waits as a ring over a button, the calendar as a grid of days, the
     board as cards with a face in the corner. A placeholder shaped like
     something else is a page that jumps at the moment it should settle —
     and a wall of grey lines shaped like nothing says only "loading",
     where the shape of the thing says what is loading.

     Built from a handful of blocks below, chosen by the address being gone
     to (skeletonFor). Anything not listed gets the general one.
     ---------------------------------------------------------------------- */
  var SK = {
    line: function (w) { return '<span class="skeleton skeleton--line" style="width:' + (w || 70) + '%"></span>'; },
    title: function (w) { return '<span class="skeleton skeleton--title" style="width:' + (w || 55) + '%"></span>'; },
    big: function (w) { return '<span class="skeleton skeleton--big" style="width:' + (w || 40) + '%"></span>'; },
    circle: function (mod) { return '<span class="skeleton skeleton--circle' + (mod ? " " + mod : "") + '"></span>'; },
    btn: function (mod) { return '<span class="skeleton skeleton--btn' + (mod ? " " + mod : "") + '"></span>'; },
    field: function () { return '<span class="skeleton skeleton--field"></span>'; },
    chip: function () { return '<span class="skeleton skeleton--chip"></span>'; },
    pill: function () { return '<span class="skeleton skeleton--segments"></span>'; },
    // Widths that step down a stack read as writing, not as grey bars.
    text: function (n) {
      var widths = [85, 70, 55, 40], out = "";
      for (var i = 0; i < n; i++) out += SK.line(widths[i % widths.length]);
      return out;
    },
    card: function (inner, mod) { return '<div class="skeleton-card' + (mod ? " " + mod : "") + '">' + inner + "</div>"; },
    stack: function (inner, mod) { return '<div class="skeleton-stack' + (mod ? " " + mod : "") + '">' + inner + "</div>"; },
    row: function (lead, lines, tail) {
      return '<div class="skeleton-row">' + lead +
        '<span class="skeleton-row__body">' + (lines || SK.line(70) + SK.line(40)) + "</span>" +
        (tail || "") + "</div>";
    },
    // A label over a box: one field of a form.
    labelled: function () { return SK.stack(SK.line(30) + SK.field(), "skeleton-stack--tight"); },
    // Heading and the line under it, as every page head has.
    head: function (w) { return '<div class="skeleton-page__head">' + SK.title(w) + SK.line(70) + "</div>"; },
    // A notice on the board: a face, a name, the words, the row of actions.
    notice: function (lines) {
      return SK.card(
        SK.row(SK.circle("skeleton--avatar"), SK.line(35) + SK.text(lines || 2)) +
        '<div class="skeleton-acts">' + SK.line(20) + SK.line(20) + "</div>"
      );
    },
    twoUp: function (inner) { return '<div class="skeleton-tiles">' + inner + "</div>"; },
    repeat: function (n, fn) { var out = ""; for (var i = 0; i < n; i++) out += fn(i); return out; },
  };

  var SKELETONS = {
    hub: function () {
      return SK.twoUp(SK.repeat(2, function () {
        return SK.card(SK.circle("skeleton--icon") + SK.line(55) + SK.line(70), "skeleton-card--tile");
      })) +
      '<div class="skeleton-bar">' + SK.line(35) + SK.btn("skeleton--btn-sm") + "</div>" +
      SK.notice(3) + SK.notice(2);
    },
    board: function () {
      return '<div class="skeleton-bar">' + SK.title(45) + SK.btn("skeleton--btn-sm") + "</div>" +
        SK.notice(3) + SK.notice(2) + SK.notice(2);
    },
    person: function () {
      return SK.row(SK.circle("skeleton--avatar"), SK.title(35) + SK.line(55)) +
        SK.twoUp(SK.repeat(4, function () { return SK.card(SK.big(25) + SK.line(55), "skeleton-card--stat"); })) +
        SK.line(35) + SK.notice(3);
    },
    inbox: function () {
      return SK.head(50) + SK.chip() +
        SK.repeat(4, function () {
          return SK.card(SK.row(SK.circle("skeleton--avatar"), SK.line(70) + SK.line(45) + SK.line(25)));
        });
    },
    holidays: function () {
      return SK.head(55) + SK.row(SK.line(15), SK.field()) +
        SK.repeat(3, function () { return SK.card(SK.line(45) + SK.line(70)); });
    },
    profile: function () {
      return SK.card(SK.circle("skeleton--avatar-xl") + SK.title(30) + SK.line(45), "skeleton-card--centre") +
        SK.card(SK.repeat(4, function () { return SK.row(SK.circle("skeleton--dot"), SK.line(30)); }), "skeleton-card--rows") +
        SK.card(SK.row("", SK.line(30), SK.line(35)));
    },
    form: function () {
      return SK.head(45) + SK.card(SK.repeat(3, SK.labelled) + SK.stack(SK.line(30) + SK.field() + SK.field(), "skeleton-stack--tight")) + SK.btn();
    },
    // ---- PLU ----------------------------------------------------------
    pluList: function () {
      return SK.stack(SK.field() + SK.line(60), "skeleton-stack--search") +
        '<ul class="skeleton-list">' + SK.repeat(4, function (i) {
          return "<li>" + SK.row('<span class="skeleton skeleton--badge"></span>', SK.line([85, 70, 55, 40][i % 4]) + SK.line(40)) + "</li>";
        }) + "</ul>";
    },
    pluDetail: function () {
      return SK.card(SK.line(20) + SK.big(20) + SK.line(65), "skeleton-card--centre skeleton-card--tall") +
        SK.btn() + SK.btn("skeleton--btn-plain");
    },
    pluPhoto: function () {
      return SK.head(45) + SK.card('<span class="skeleton skeleton--drop"></span>' + SK.btn());
    },
    // ---- TimeSheet ----------------------------------------------------
    clock: function () {
      return '<div class="skeleton-bar">' + SK.chip() + SK.line(35) + "</div>" +
        '<span class="skeleton--ring"></span>' +
        SK.line(20) + '<div class="skeleton-chips">' + SK.chip() + SK.chip() + "</div>" + SK.btn();
    },
    timesheet: function () {
      return SK.head(45) + SK.pill() + '<div class="skeleton-chips">' + SK.chip() + SK.chip() + SK.chip() + "</div>" +
        SK.card(SK.line(20) + SK.big(25) + SK.line(30) + SK.line(25)) +
        SK.card(SK.row("", SK.line(40), SK.line(30)) + SK.row("", SK.line(35), SK.line(15)) + SK.row("", SK.line(35), SK.line(20)), "skeleton-card--rows");
    },
    calendar: function () {
      return SK.head(45) + SK.pill() +
        SK.card(
          '<div class="skeleton-bar">' + SK.circle("skeleton--dot") + SK.title(45) + SK.circle("skeleton--dot") + "</div>" +
          '<div class="skeleton-days">' + SK.repeat(35, function () { return '<span class="skeleton skeleton--day"></span>'; }) + "</div>" +
          SK.line(60)
        );
    },
    shiftDetail: function () {
      return SK.head(40) + SK.card(SK.repeat(4, function () { return SK.row("", SK.line(30), SK.line(35)); }), "skeleton-card--rows") +
        SK.btn() + SK.btn("skeleton--btn-plain");
    },
    workplaces: function () {
      return SK.head(50) +
        SK.card(SK.repeat(2, function () {
          return SK.row('<span class="skeleton skeleton--square"></span>', SK.line(45) + SK.line(60), SK.circle("skeleton--dot") + SK.circle("skeleton--dot"));
        }), "skeleton-card--rows") +
        SK.card(SK.row("", SK.line(40), SK.line(30))) + SK.btn();
    },
    pay: function () {
      return SK.head(25) + SK.repeat(2, function () {
        return SK.card(SK.row("", SK.line(40), SK.line(30)) + SK.big(45) + SK.line(35) + SK.btn() + SK.line(60));
      });
    },
    statement: function () {
      return SK.head(50) + SK.card(SK.repeat(6, function () { return SK.row("", SK.line(35), SK.line(25)); }), "skeleton-card--rows");
    },
    more: function () {
      return SK.head(30) + SK.card(SK.repeat(3, function () {
        return SK.row(SK.circle("skeleton--icon-sm"), SK.line(40) + SK.line(65), SK.circle("skeleton--dot"));
      }), "skeleton-card--rows");
    },
    general: function () {
      return SK.head(55) + SK.twoUp('<span class="skeleton skeleton--tile"></span><span class="skeleton skeleton--tile"></span>') +
        SK.card(SK.line(40) + SK.line(85) + SK.line(70)) +
        '<ul class="skeleton-list">' + SK.repeat(3, function (i) {
          return "<li>" + SK.row(SK.circle(), SK.line([85, 70, 55][i]) + SK.line(40)) + "</li>";
        }) + "</ul>";
    },
  };

  /* Which shape stands in for the page at `pathname`. First match wins, so
     the more particular addresses come before the app they sit under. */
  var SKELETON_ROUTES = [
    [/^\/$/, "hub"],
    [/^\/plu\/item\//, "pluDetail"],
    [/^\/plu\/photo-search/, "pluPhoto"],
    [/^\/plu\/import/, "form"],
    [/^\/plu\//, "pluList"],
    [/^\/timesheet\/$/, "clock"],
    [/^\/timesheet\/calendar/, "calendar"],
    [/^\/timesheet\/shifts\/(add|\d+\/edit)/, "form"],
    [/^\/timesheet\/shifts\/\d+/, "shiftDetail"],
    [/^\/timesheet\/shifts/, "timesheet"],
    [/^\/timesheet\/workplaces\/(add|\d+)/, "form"],
    [/^\/timesheet\/(workplaces|preferences)/, "workplaces"],
    [/^\/timesheet\/pay\/statement/, "statement"],
    [/^\/timesheet\/pay/, "pay"],
    [/^\/timesheet\/more/, "more"],
    [/^\/notices\/people\//, "person"],
    [/^\/notices\/(new|\d+\/edit)/, "form"],
    [/^\/notices\/(\d+|comments\/\d+)\/reactions/, "inbox"],
    [/^\/notices/, "board"],
    [/^\/notifications/, "inbox"],
    [/^\/holidays/, "holidays"],
    [/^\/profile\/edit/, "form"],
    [/^\/profile/, "profile"],
  ];

  /* The app whose pages open with the segmented control (base.html's
     section_nav — PLU; TimeSheet's places are tabs of the dock). While the
     page is on its way that strip is drawn too — the real one, copied from
     the page being left when it is the same app, so the strip does not
     blink out and back; a bar of its shape otherwise. */
  var SEGMENTED = /^\/(plu)\//;

  function skeletonFor(href) {
    var pathname = location.pathname;
    try { pathname = new URL(href, location.href).pathname; } catch (e) { /* keep the page's own */ }

    var kind = "general";
    for (var i = 0; i < SKELETON_ROUTES.length; i++) {
      if (SKELETON_ROUTES[i][0].test(pathname)) { kind = SKELETON_ROUTES[i][1]; break; }
    }

    var strip = "";
    var app = (SEGMENTED.exec(pathname) || [])[1];
    if (app) {
      var here = document.querySelector("main.container > .segments--places");
      var sameApp = here && location.pathname.indexOf("/" + app + "/") === 0;
      if (sameApp) {
        var copy = here.cloneNode(true);
        copy.setAttribute("aria-hidden", "true");
        strip = copy.outerHTML;
      } else {
        strip = SK.pill();
      }
    }

    return '<div class="skeleton-page skeleton-page--' + kind + '">' + strip + SKELETONS[kind]() + "</div>";
  }

  function initLiveSearch() {
    var input = document.getElementById("plu-search-input");
    var resultsEl = document.getElementById("plu-results");
    var metaEl = document.getElementById("plu-search-meta");
    var clearBtn = document.getElementById("plu-search-clear");
    var form = document.getElementById("plu-search-form");
    if (!input || !resultsEl || !form) return;

    var endpoint = form.getAttribute("data-search-url");
    // A detail URL built with a sentinel PLU, e.g. "/987654321/". Swapping the
    // sentinel for a real number keeps URL building in Django's hands.
    var detailTemplate = form.getAttribute("data-detail-url-template") || "";
    if (!endpoint || !detailTemplate) return;

    function detailUrl(pluNo) {
      return detailTemplate.replace("987654321", String(pluNo));
    }

    // The page renders no list until something is searched for, so an empty
    // box always goes back to the prompt. Only a page loaded without a query
    // already has that markup to reuse; one loaded with ?q= gets it rebuilt.
    var initialQuery = input.value.trim();
    var idleHtml = initialQuery ? "" : resultsEl.innerHTML;
    var idleMeta = initialQuery ? "" : (metaEl ? metaEl.innerHTML : "");

    var timer = null;
    var inFlight = null;
    var lastRendered = initialQuery;
    // Which page of the results is up. The list shows five at a time and
    // the rest are a page away, exactly as the page renders without JS.
    var initialPage = parseInt(new URLSearchParams(location.search).get("page"), 10) || 1;
    var lastPage = initialQuery ? initialPage : 1;

    // Centres the box while nothing has been searched for; see .search-page.
    var page = document.getElementById("search-page");
    var bar = document.querySelector(".searchbar");

    function setIdle(idle) {
      if (page) page.classList.toggle("is-idle", idle);
    }

    function setMeta(html) {
      if (metaEl) metaEl.innerHTML = html;
    }

    function renderResults(query, data) {
      if (!data.results.length) {
        resultsEl.innerHTML = emptyCard(
          "No matches",
          "Nothing found for &ldquo;" + escapeHtml(query) + "&rdquo;. Try fewer words."
        );
        setMeta("0 results");
        return;
      }

      var html = '<ul class="result-list">';
      for (var i = 0; i < data.results.length; i++) {
        var row = data.results[i];
        html +=
          "<li><a class=\"result\" href=\"" + detailUrl(row.plu_no) + "\">" +
          '<span class="plu-badge">' + highlight(escapeHtml(row.plu_no), query) + "</span>" +
          '<span class="result__body"><span class="result__title">' +
          highlight(escapeHtml(row.description), query) +
          "</span></span>" + ICON_CHEVRON + "</a></li>";
      }
      html += "</ul>";
      html += pagerHtml(query, data.page, data.pages);
      resultsEl.innerHTML = html;

      var meta = data.total + (data.total === 1 ? " result" : " results");
      if (data.pages > 1) {
        meta += " &mdash; page " + data.page + " of " + data.pages;
      }
      setMeta(meta);
    }

    // The same pager templates/_pager.html draws, so the live list and the
    // page it stands in for look alike. Real links, so a tap works as a
    // page load too; the click handler below turns them into a fetch.
    function pagerHtml(query, page, pages) {
      if (pages <= 1) return "";
      var ICON_BACK = ICON_CHEVRON.replace("m9 18 6-6-6-6", "m15 18-6-6 6-6");
      function link(n, cls, inner) {
        var href = location.pathname + "?q=" + encodeURIComponent(query) + (n > 1 ? "&page=" + n : "");
        return '<a class="btn pager__btn ' + cls + '" href="' + href + '" data-page="' + n + '">' + inner + "</a>";
      }
      function dead(cls, inner) {
        return '<span class="btn pager__btn ' + cls + '" aria-disabled="true">' + inner + "</span>";
      }
      var prev = ICON_BACK + "<span>Previous</span>";
      var next = "<span>Next</span>" + ICON_CHEVRON;
      return '<nav class="pager" aria-label="Pagination">' +
        (page > 1 ? link(page - 1, "pager__btn--prev", prev) : dead("pager__btn--prev", prev)) +
        '<span class="pager__label">Page ' + page + " of " + pages + "</span>" +
        (page < pages ? link(page + 1, "pager__btn--next", next) : dead("pager__btn--next", next)) +
        "</nav>";
    }

    resultsEl.addEventListener("click", function (event) {
      var link = event.target.closest && event.target.closest("a[data-page]");
      if (!link) return;
      event.preventDefault();
      run(lastRendered, parseInt(link.getAttribute("data-page"), 10));
      // The new page starts where the old one did.
      var top = resultsEl.getBoundingClientRect().top + window.pageYOffset;
      var bars = (bar ? bar.getBoundingClientRect().height : 0) + 72;
      if (window.pageYOffset > top - bars) window.scrollTo({ top: Math.max(top - bars, 0) });
    });

    // Back to the "type something" state the page opens in.
    function showIdle() {
      resultsEl.innerHTML = idleHtml ||
        emptyCard("Search a PLU", "Type a PLU number or part of a description to see matches.");

      if (idleMeta) {
        setMeta(idleMeta);
      } else {
        var total = parseInt(form.getAttribute("data-total-count"), 10);
        setMeta(isNaN(total) ? "" :
          "Search " + total + " PLU" + (total === 1 ? "" : "s") + " by number or description");
      }
      setIdle(true);
      lastRendered = ""; lastPage = 1;
    }

    function run(query, page) {
      page = page || 1;
      if (query === lastRendered && page === lastPage) return;

      if (!query) {
        if (inFlight) { inFlight.abort(); inFlight = null; }
        if (bar) bar.classList.remove("is-busy");
        showIdle();
        syncUrl("", 1);
        return;
      }

      // Move the box up as soon as there's a query, not when results land, so
      // the layout settles while the request is still in flight.
      setIdle(false);

      if (inFlight) inFlight.abort();
      var controller = new AbortController();
      inFlight = controller;

      // The bar itself carries the waiting (a moving hairline), so the text
      // only needs three dots keeping time with it.
      if (bar) bar.classList.add("is-busy");
      setMeta('Searching<span class="dot-flash">.</span>' +
              '<span class="dot-flash">.</span><span class="dot-flash">.</span>');

      // Rows in the shape of the results that are coming, so the list doesn't
      // sit empty and then jump. Only when there is nothing useful there yet:
      // a refined search keeps its previous results visible, because they are
      // still nearly the answer and blanking them loses more than it gains.
      if (!lastRendered) {
        resultsEl.innerHTML = skeletonRows(5);
      }

      fetch(endpoint + "?q=" + encodeURIComponent(query) + (page > 1 ? "&page=" + page : ""), {
        signal: controller.signal,
        headers: { "X-Requested-With": "XMLHttpRequest" },
      })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function (data) {
          if (controller.signal.aborted) return;
          inFlight = null;
          if (bar) bar.classList.remove("is-busy");
          lastRendered = query;
          lastPage = data.page;
          renderResults(query, data);
          syncUrl(query, data.page);
        })
        .catch(function (err) {
          if (bar) bar.classList.remove("is-busy");
          if (err && err.name === "AbortError") return;
          inFlight = null;
          // Network trouble on a phone is normal — fall back to a real
          // page load rather than leaving a stale list on screen.
          setMeta("Connection problem &mdash; press Search to retry");
        });
    }

    // Keep the address bar in step so refresh/share/back give the same view.
    function syncUrl(query, page) {
      if (!window.history || !window.history.replaceState) return;
      var url = window.location.pathname + (query ? "?q=" + encodeURIComponent(query) : "");
      if (query && page > 1) url += "&page=" + page;
      window.history.replaceState(null, "", url);
      noteAddress();
    }

    function syncClear() {
      if (clearBtn) clearBtn.hidden = input.value.length === 0;
    }

    input.addEventListener("input", function () {
      syncClear();
      var query = input.value.trim();
      clearTimeout(timer);
      // Short debounce: fast enough to feel live, slow enough not to fire
      // a request per keystroke on a phone connection.
      timer = setTimeout(function () { run(query); }, 220);
    });

    // Enter should search immediately and dismiss the on-screen keyboard.
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      clearTimeout(timer);
      input.blur();
      run(input.value.trim());
    });

    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        input.value = "";
        syncClear();
        clearTimeout(timer);
        run("");
        input.focus();
      });
    }

    // Left mid-search: the list the answer was for is gone.
    onLeave(function () {
      clearTimeout(timer);
      if (inFlight) inFlight.abort();
    });

    syncClear();
  }

  /* ----------------------------------------------------------------------
     Animated placeholder
     Types real descriptions from this shop's list through the empty search
     box, so the hint doubles as a worked example of what you can search for.
     Pauses whenever the box is in use — a moving placeholder under a live
     cursor is a distraction, not a hint.
     ---------------------------------------------------------------------- */
  function initPlaceholderTyper() {
    var input = document.getElementById("plu-search-input");
    var data = document.getElementById("search-examples");
    if (!input || !data) return;

    // Reduced motion keeps the plain, static hint the markup ships with.
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;

    var examples;
    try { examples = JSON.parse(data.textContent); } catch (e) { return; }
    if (!Array.isArray(examples) || !examples.length) return;

    // Descriptions are stored shouting (BEEF BONELESS BLADE); lowercase reads
    // as a hint rather than a heading.
    examples = examples.map(function (s) { return String(s).toLowerCase(); });

    var STATIC = input.getAttribute("placeholder") || "";
    var TYPE_MS = 55, DELETE_MS = 28, HOLD_MS = 1500, GAP_MS = 350;

    var idx = 0, pos = 0, deleting = false, timer = null, paused = false;

    function stop() {
      clearTimeout(timer);
      timer = null;
    }

    function step() {
      if (paused) return;

      var word = examples[idx];
      var next;

      if (!deleting) {
        pos++;
        input.placeholder = word.slice(0, pos) + "▌";
        if (pos >= word.length) {
          deleting = true;
          input.placeholder = word;   // drop the caret while it rests
          next = HOLD_MS;
        } else {
          next = TYPE_MS;
        }
      } else {
        pos--;
        input.placeholder = word.slice(0, pos) + "▌";
        if (pos <= 0) {
          deleting = false;
          idx = (idx + 1) % examples.length;
          next = GAP_MS;
        } else {
          next = DELETE_MS;
        }
      }

      timer = setTimeout(step, next);
    }

    function pause() {
      paused = true;
      stop();
      input.placeholder = STATIC;
    }

    function resume() {
      if (!paused) return;
      paused = false;
      pos = 0;
      deleting = false;
      stop();
      timer = setTimeout(step, GAP_MS);
    }

    // Typing or focusing hands the box back to the user.
    input.addEventListener("focus", pause);
    input.addEventListener("blur", function () {
      if (!input.value) resume();
    });
    input.addEventListener("input", function () {
      if (input.value) pause();
    });

    // A page opened with ?q= already has a query in the box; leave it alone.
    if (input.value) {
      paused = true;
    } else {
      timer = setTimeout(step, GAP_MS);
    }

    // Honour the setting being flipped mid-session.
    if (reduced.addEventListener) {
      listen(reduced, "change", function (e) {
        if (e.matches) pause();
      });
    }

    // The box goes with the page; the typing must not carry on without it.
    onLeave(stop);
  }

  /* ----------------------------------------------------------------------
     Copy a PLU number (for typing straight into the scale)
     ---------------------------------------------------------------------- */
  function flash(message) {
    var el = document.createElement("div");
    el.className = "copied-flash";
    el.setAttribute("role", "status");
    el.textContent = message;
    document.body.appendChild(el);

    requestAnimationFrame(function () { el.classList.add("is-visible"); });
    setTimeout(function () {
      el.classList.remove("is-visible");
      setTimeout(function () { el.remove(); }, 220);
    }, 1400);
  }

  function initCopy() {
    document.querySelectorAll("[data-copy]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var value = btn.getAttribute("data-copy");

        function ok() { flash("Copied " + value); }

        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(value).then(ok, fallback);
        } else {
          fallback();
        }

        // http:// on the local network has no async clipboard API
        function fallback() {
          var ta = document.createElement("textarea");
          ta.value = value;
          ta.setAttribute("readonly", "");
          ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); ok(); } catch (e) { flash("Couldn't copy"); }
          ta.remove();
        }
      });
    });
  }

  /* ----------------------------------------------------------------------
     Photo picker: preview, drag & drop, and a busy overlay while OCR runs
     ---------------------------------------------------------------------- */
  function initPhotoPicker() {
    var input = document.getElementById("photo-input");
    var zone = document.getElementById("photo-dropzone");
    if (!input || !zone) return;

    var emptyState = document.getElementById("photo-empty");
    var preview = document.getElementById("photo-preview");
    var filename = document.getElementById("photo-filename");
    var label = document.getElementById("photo-label");
    var submit = document.getElementById("photo-submit");
    var form = document.getElementById("photo-form");

    var isMobile = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent || "");
    if (label) label.textContent = isMobile ? "Take a photo" : "Choose a photo";

    // Only phones get the rear camera; on desktop `capture` just gets in the way.
    if (isMobile) input.setAttribute("capture", "environment");
    else input.removeAttribute("capture");

    var objectUrl = null;

    function showFile(file) {
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
      if (!file) {
        // Cleared: back to the empty box, ready for the next list.
        if (preview) { preview.removeAttribute("src"); preview.hidden = true; }
        if (emptyState) emptyState.hidden = false;
        if (filename) filename.textContent = "Hold the page flat and fill the frame";
        return;
      }
      objectUrl = URL.createObjectURL(file);

      if (preview) { preview.src = objectUrl; preview.hidden = false; }
      if (emptyState) emptyState.hidden = true;
      if (filename) filename.textContent = file.name;
      if (submit) submit.disabled = false;
    }

    input.addEventListener("change", function () {
      showFile(input.files && input.files[0]);
    });

    ["dragenter", "dragover"].forEach(function (type) {
      zone.addEventListener(type, function (e) {
        e.preventDefault();
        zone.classList.add("is-dragover");
      });
    });
    ["dragleave", "drop"].forEach(function (type) {
      zone.addEventListener(type, function (e) {
        e.preventDefault();
        zone.classList.remove("is-dragover");
      });
    });
    zone.addEventListener("drop", function (e) {
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      input.files = e.dataTransfer.files;
      showFile(file);
    });

    // The photo goes by XMLHttpRequest under the reading panel (makeReader)
    // and the results come back on their own, dropped under the form —
    // the page never leaves, so the preview stays beside what it said.
    var status = document.getElementById("photo-status");
    var results = document.getElementById("photo-results");
    var reader = null;

    if (form && status && results && window.FormData) {
      form.addEventListener("submit", function (event) {
        var file = input.files && input.files[0];
        if (!file || !form.checkValidity()) return;
        event.preventDefault();
        if (reader) reader.abort();
        results.innerHTML = "";
        submit.disabled = true;
        submit.textContent = "Reading…";
        reader = makeReader(file, {
          into: status,
          reading: "Reading the list and naming each line — a few seconds",
        });
        reader.send(form.action || location.href, new FormData(form), "text")
          .then(function (res) {
            reader.settle();
            results.innerHTML = res.text;
            submit.disabled = false;
            submit.textContent = "Read another photo";
            initPhotoPicks();
            // The answer is below the fold on a phone: bring the head of it up.
            var head = results.querySelector(".results-head, .alert");
            if (head) head.scrollIntoView({ behavior: "smooth", block: "start" });
          })
          .catch(function (err) {
            reader.close();
            submit.disabled = false;
            submit.textContent = "Read this photo";
            results.innerHTML = '<div class="alert alert--error">' +
              (err && err.message === "abort"
                ? "Stopped. Choose the photo again when you're ready."
                : escapeHtml(sendFailure(err, "."))) +
              "</div>";
          });
      });
      onLeave(function () { if (reader) reader.abort(); });
    }
    initPhotoPicks();
  }

  /* A line of the read put right: the row's own form posts the chosen PLU
     (or none) and the row that comes back takes the old one's place. The
     <details> is real, so it all works as plain forms without this. */
  function initPhotoPicks() {
    var results = document.getElementById("photo-results");
    if (!results || results.hasAttribute("data-picks-live") || !window.fetch) return;
    results.setAttribute("data-picks-live", "");

    function recount() {
      var title = results.querySelector(".results-head__title");
      var n = results.querySelectorAll("[data-pick]").length;
      if (title) title.textContent = n + " item" + (n === 1 ? "" : "s") + " found";
    }

    // Clear: the read is forgotten on the server and the page goes back to
    // its empty state, with the photo box ready for the next list.
    results.addEventListener("submit", function (event) {
      var form = event.target.closest && event.target.closest("[data-photo-clear]");
      if (!form) return;
      event.preventDefault();
      var button = form.querySelector("button");
      button.disabled = true;
      fetch(form.action, {
        method: "POST",
        body: new FormData(form),
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      })
        .then(function (res) {
          if (!res.ok) throw new Error("not cleared");
          results.innerHTML = "";
          var status = document.getElementById("photo-status");
          if (status) { status.innerHTML = ""; status.hidden = true; }
          var submit = document.getElementById("photo-submit");
          if (submit) submit.textContent = "Read this photo";
          var input = document.getElementById("photo-input");
          if (input) { input.value = ""; input.dispatchEvent(new Event("change", { bubbles: true })); }
          var top = document.getElementById("photo-dropzone");
          if (top) top.scrollIntoView({ behavior: "smooth", block: "start" });
        })
        .catch(function () { button.disabled = false; });
    });

    results.addEventListener("submit", function (event) {
      var form = event.target.closest && event.target.closest("[data-pick-form]");
      if (!form) return;
      event.preventDefault();
      var row = form.closest("[data-pick]");
      var button = event.submitter;
      var body = new FormData(form);
      // The chips carry their number; the Set button takes the typed one.
      if (button && button.hasAttribute("name")) body.set("plu_no", button.value);
      else {
        var typed = form.querySelector("[data-pick-number]");
        if (!typed || !typed.value.trim()) { if (typed) typed.focus(); return; }
        body.set("plu_no", typed.value.trim());
      }
      row.classList.add("is-busy");
      fetch(form.action, {
        method: "POST",
        body: body,
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      })
        .then(function (res) {
          return res.text().then(function (text) {
            if (!res.ok) {
              var data = null;
              try { data = JSON.parse(text); } catch (e) { data = null; }
              throw new Error((data && data.error) || "That line couldn't be changed.");
            }
            return text;
          });
        })
        .then(function (html) {
          if (!html.trim()) {
            // Taken out: the row folds away and the count follows.
            row.style.height = row.offsetHeight + "px";
            row.classList.add("is-going");
            setTimeout(function () { row.remove(); recount(); }, 260);
            return;
          }
          var box = document.createElement("ul");
          box.innerHTML = html;
          var fresh = box.firstElementChild;
          row.replaceWith(fresh);
          fresh.classList.add("is-changed");
        })
        .catch(function (err) {
          row.classList.remove("is-busy");
          var typed = form.querySelector("[data-pick-number]");
          var note = form.querySelector(".pick__error") || document.createElement("div");
          note.className = "help help--error pick__error";
          note.textContent = err.message;
          form.appendChild(note);
          if (typed) typed.focus();
        });
    });
  }

  /* ----------------------------------------------------------------------
     CSV picker: show the chosen filename
     ---------------------------------------------------------------------- */
  function initCsvPicker() {
    var input = document.getElementById("csv-input");
    var name = document.getElementById("csv-filename");
    var submit = document.getElementById("csv-submit");
    if (!input) return;

    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (name) name.textContent = file ? file.name : "No file selected yet";
      if (submit) submit.disabled = !file;
    });
  }

  /* ----------------------------------------------------------------------
     Live clock
     Keeps the dial counting between page loads. Everything is derived from
     the server's timestamps, and the server's own "now" is compared against
     the browser's once at startup — so a phone whose clock is minutes out
     still shows the elapsed time the server would agree with.
     ---------------------------------------------------------------------- */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function formatHMS(seconds) {
    if (seconds < 0) seconds = 0;
    var s = Math.floor(seconds);
    return pad2(Math.floor(s / 3600)) + ":" + pad2(Math.floor(s / 60) % 60) + ":" + pad2(s % 60);
  }

  function formatMinutes(seconds) {
    var m = Math.floor(Math.max(seconds, 0) / 60);
    var h = Math.floor(m / 60);
    return h ? h + "h " + (m % 60) + "m" : m + "m";
  }

  function initLiveClock() {
    var root = document.getElementById("clock-live");
    if (!root) return;

    var status = root.getAttribute("data-status");
    var timeEl = document.getElementById("clock-elapsed");
    var breakEl = document.getElementById("clock-break");
    var wallEl = document.getElementById("wall-clock");
    var ring = document.getElementById("dial-progress");

    // 2πr for the r=52 circle in the markup.
    var CIRCUMFERENCE = 326.73;
    var targetSeconds = (parseFloat(root.getAttribute("data-target-hours")) || 8) * 3600;

    function ms(attr) {
      var raw = root.getAttribute(attr);
      if (!raw) return null;
      var t = Date.parse(raw);
      return isNaN(t) ? null : t;
    }

    var clockIn = ms("data-clock-in");
    var breakStart = ms("data-break-start");
    var bankedBreak = (parseInt(root.getAttribute("data-banked-break"), 10) || 0) * 1000;

    // The phone's clock is the source of truth: the stored clock-in was
    // stamped from this same device, so counting forward from it here needs
    // no correction against the server. Skewing to the server would instead
    // make the elapsed time disagree with the phone's own clock.
    function now() { return Date.now(); }

    var lastText = "";

    function paint() {
      if (status === "IDLE") {
        if (wallEl) {
          var d = new Date(now());
          var h = d.getHours() % 12;
          wallEl.textContent = (h === 0 ? 12 : h) + ":" + pad2(d.getMinutes());
        }
        return;
      }
      if (!clockIn) return;

      // A break that's running keeps growing; finished ones are already banked.
      var breakMs = bankedBreak + (breakStart ? Math.max(now() - breakStart, 0) : 0);
      var workedMs = Math.max(now() - clockIn - breakMs, 0);

      if (timeEl) {
        var text = formatHMS((status === "ON_BREAK" ? now() - breakStart : workedMs) / 1000);
        if (text !== lastText) {
          lastText = text;
          timeEl.textContent = text;
        }
      }

      if (breakEl) breakEl.textContent = formatMinutes(breakMs / 1000);

      if (ring) {
        var progress = Math.min(workedMs / 1000 / targetSeconds, 1);
        ring.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - progress));
      }
    }

    paint();
    every(paint, 1000);

    // A phone that's been asleep comes back with a stale face; repaint the
    // moment it's visible again rather than waiting for the next tick.
    listen(document, "visibilitychange", function () {
      if (!document.hidden) paint();
    });
  }

  /* ----------------------------------------------------------------------
     Stamp the phone's own clock onto every clock action
     The server records the instant this reports rather than its own, so the
     time saved is the time that was on the phone when the button was tapped.
     The IANA zone rides along so every page renders in the phone's local
     time instead of whatever timezone the server is set to.
     ---------------------------------------------------------------------- */
  function localIsoNow() {
    var d = new Date();
    // Build the offset by hand: toISOString() would convert to UTC and drop
    // the phone's own offset, which is the part the server needs.
    var offset = -d.getTimezoneOffset();
    var sign = offset >= 0 ? "+" : "-";
    var abs = Math.abs(offset);

    return d.getFullYear() +
      "-" + pad2(d.getMonth() + 1) +
      "-" + pad2(d.getDate()) +
      "T" + pad2(d.getHours()) +
      ":" + pad2(d.getMinutes()) +
      ":" + pad2(d.getSeconds()) +
      sign + pad2(Math.floor(abs / 60)) + ":" + pad2(abs % 60);
  }

  function initClientClock() {
    var zone = "";
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (e) { /* very old browser — the server falls back to its own zone */ }

    // Publish the zone on every page, not just when a clock button is
    // pressed, so pages render in the phone's local time from the first
    // visit — and follow the phone if it moves.
    if (zone && document.cookie.indexOf("plu_tz=" + zone) === -1) {
      document.cookie = "plu_tz=" + encodeURIComponent(zone) +
        ";path=/;max-age=31536000;SameSite=Lax";
    }

    var forms = document.querySelectorAll("form[data-stamp-time]");
    if (!forms.length) return;

    forms.forEach(function (form) {
      // Filled at submit time, not page load, so a page left open for hours
      // still posts the moment the button was actually pressed.
      form.addEventListener("submit", function () {
        setHidden(form, "client_time", localIsoNow());
        if (zone) setHidden(form, "client_tz", zone);
      });
    });

    function setHidden(form, name, value) {
      var input = form.querySelector('input[name="' + name + '"]');
      if (!input) {
        input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        form.appendChild(input);
      }
      input.value = value;
    }
  }

  /* ----------------------------------------------------------------------
     Break rows on the shift edit page
     Clones the formset's empty_form and renumbers it, which is all Django
     needs to treat the new row as a real form on POST.
     ---------------------------------------------------------------------- */
  function initBreakRows() {
    var addBtn = document.getElementById("add-break");
    var rows = document.getElementById("break-rows");
    var tpl = document.getElementById("break-empty");
    if (!addBtn || !rows || !tpl) return;

    var totalInput = document.querySelector('input[name$="-TOTAL_FORMS"]');
    if (!totalInput) return;

    addBtn.addEventListener("click", function () {
      var index = parseInt(totalInput.value, 10) || 0;
      var html = tpl.innerHTML.replace(/__prefix__/g, String(index));

      var holder = document.createElement("div");
      holder.innerHTML = html;
      var row = holder.firstElementChild;
      // Only rows created by this tap animate in; the ones already on the
      // page when it loaded stay put.
      row.classList.add("is-new");
      rows.appendChild(row);

      totalInput.value = String(index + 1);

      var first = row.querySelector("input");
      if (first) first.focus();
    });
  }

  /* ------------------------------------------------------------------------
     Ripple — a tap should look like it landed somewhere specific, so the
     circle grows from the point that was actually touched.
     ---------------------------------------------------------------------- */
  function initRipple() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    document.addEventListener("pointerdown", function (event) {
      var btn = event.target.closest(".btn");
      if (!btn || btn.disabled || btn.classList.contains("is-loading")) return;

      var rect = btn.getBoundingClientRect();
      var ripple = document.createElement("span");
      ripple.className = "btn__ripple";
      ripple.style.setProperty("--rx", (event.clientX - rect.left) + "px");
      ripple.style.setProperty("--ry", (event.clientY - rect.top) + "px");
      btn.appendChild(ripple);

      // Outlives the .5s animation by a hair, so it never vanishes mid-grow.
      setTimeout(function () { ripple.remove(); }, 550);
    }, { passive: true });
  }

  /* ------------------------------------------------------------------------
     Submit feedback — a form that is working says so, and stops taking taps.
     Two forms opt out: the live-search form never navigates, and the photo
     upload is sent by makeReader under its own reading panel. The CSV import
     form is left in, because that upload is the slowest thing in the app.
     ---------------------------------------------------------------------- */
  var NO_BUSY = { "plu-search-form": 1, "photo-form": 1 };

  function initSubmitState() {
    document.querySelectorAll("form").forEach(function (form) {
      if (form.id && NO_BUSY[form.id]) return;
      // Sent by fetch, and the page stays: a reaction (initReactions) and
      // an edit made in place (initEditing). A download stays too.
      if (form.classList.contains("picker") || form.hasAttribute("data-editor")) return;
      if (form.hasAttribute("data-download")) return;

      form.addEventListener("submit", function (event) {
        // A form that failed validation never leaves the page; the browser
        // blocks submit before this fires, so the button is safe to lock.
        // One whose confirm() was declined stays too, and must not lock.
        if (event.defaultPrevented) return;
        var btn = form.querySelector('button[type="submit"], button:not([type])');
        if (!btn || btn.classList.contains("is-loading")) return;

        // Hold the rendered width, or swapping the label for a spinner makes
        // the button collapse to the spinner's size mid-press.
        btn.style.minWidth = btn.offsetWidth + "px";
        btn.classList.add("is-loading");

        // Bfcache restores can bring the old DOM back with the button still
        // spinning, so clear it when the page is shown again.
        window.addEventListener("pageshow", function () {
          btn.classList.remove("is-loading");
          btn.style.minWidth = "";
        }, { once: true });
      });
    });
  }

  /* ----------------------------------------------------------------------
     App switcher
     The <details> opens and closes on its own; this only adds what a menu is
     expected to do — close when you click away, when you press Escape, or
     once you've picked something.
     ---------------------------------------------------------------------- */
  /* Any <details> marked data-dismiss behaves like a menu: a click outside or
     an Escape shuts it. Written once because there are two of them now — the
     app switcher in the bar, and the one on your own photo — and a second
     copy is a second thing to forget when a third arrives.

     The menus are looked up when something happens rather than when the page
     loads, so they are always the ones on screen: bound once, for every page
     this document will show. */
  function initAppMenu() {
    function menus() {
      return document.querySelectorAll("details[data-dismiss]");
    }

    document.addEventListener("click", function (event) {
      menus().forEach(function (menu) {
        if (!menu.open) return;
        // Picking something closes it too: a real page load would otherwise
        // leave the panel open behind the new page in bfcache.
        var picked = event.target.closest && event.target.closest("a");
        if (!menu.contains(event.target) || picked) menu.open = false;
      });
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      menus().forEach(function (menu) {
        if (!menu.open) return;
        menu.open = false;
        var btn = menu.querySelector("summary");
        if (btn) btn.focus();
      });
    });
  }

  /* ----------------------------------------------------------------------
     Count-up
     Every figure on screen is the real server-rendered number; this only
     animates the journey to it. The element already contains the final text,
     so with JS off — or reduced motion on — nothing is lost, it just appears
     rather than arrives.
     ---------------------------------------------------------------------- */
  var TALLY_FORMATS = {
    // Seconds in, "5h 19m" out — the same shape the `hm` template filter prints.
    hm: function (seconds) {
      var m = Math.round(Math.max(seconds, 0) / 60);
      var h = Math.floor(m / 60);
      m = m % 60;
      if (h && m) return h + "h " + m + "m";
      if (h) return h + "h";
      return m + "m";
    },
    minutes: formatMinutes,
    int: function (n) { return String(Math.round(Math.max(n, 0))); }
  };

  /* Counting a figure up is a way of saying "this was just worked out". It
     says that once. Every page after the first is a page you navigated to on
     purpose, and watching the same totals climb again each time turns an
     arrival into a wait — so the flourish is spent on the first render of a
     visit and every page after it draws its numbers already finished.

     Per tab, not per account: coming back tomorrow is a new arrival, and a
     browser with storage turned off simply gets it every time rather than
     never. */
  var TALLY_KEY = "mywork-tallied";

  function tallyAlreadyPlayed() {
    try { return sessionStorage.getItem(TALLY_KEY) === "1"; }
    catch (e) { return false; }
  }

  function markTallyPlayed() {
    try { sessionStorage.setItem(TALLY_KEY, "1"); }
    catch (e) { /* private mode — the count-up just plays each time */ }
  }

  function initTally(forceInstant) {
    var els = document.querySelectorAll("[data-tally]");
    if (!els.length) return;

    // `forceInstant` is for figures that replaced other figures rather than
    // arriving: swapping the timesheet to another job is not an arrival, and
    // counting every total up again would turn a filter into a wait.
    var instant =
      forceInstant === true ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      tallyAlreadyPlayed();
    if (!instant) markTallyPlayed();

    els.forEach(function (el) {
      var target = parseFloat(el.getAttribute("data-tally"));
      if (isNaN(target)) return;

      var render = TALLY_FORMATS[el.getAttribute("data-tally-format")] || TALLY_FORMATS.hm;
      if (instant || target <= 0) {
        el.textContent = render(target);
        return;
      }

      // Reserve the width the final figure needs, or the card jitters as the
      // number grows through "9m" to "36h 40m".
      el.style.minWidth = el.offsetWidth + "px";
      el.style.display = "inline-block";

      var DURATION = 850;
      var started = null;

      function step(now) {
        if (started === null) started = now;
        var p = Math.min((now - started) / DURATION, 1);
        // Fast at first, settling at the end — the same feel as --ease-out.
        el.textContent = render(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) {
          requestAnimationFrame(step);
        } else {
          el.textContent = render(target);
          el.style.minWidth = "";
          el.style.display = "";
        }
      }

      requestAnimationFrame(step);
    });
  }

  /* ----------------------------------------------------------------------
     Cycle start — show the ones that apply
     A workplace carries a start for all three periods, but only the ones
     in use are worth asking about: the period its cap is counted over, and
     the one it is paid on. The others stay in the form (and keep submitting
     their values), just out of the way.

     Two more things a job that pays on a cycle wants. Choosing how it pays
     sets the cap to the same period — paid fortnightly, the count goes back
     to zero with each pay fortnight, which is what a limit per pay run is
     for; it can still be changed after, for a cap on some other cycle. And
     the fortnight's two answers — which weekday, this week or last — are
     spelt out as the dates they come to, as they are changed, so the choice
     can be checked against a payslip before it is saved.
     ---------------------------------------------------------------------- */
  function initPeriodFields() {
    var period = document.getElementById("id_limit_period");
    var pays = document.getElementById("id_pay_cycle");
    var weekday = document.getElementById("id_fortnight_starts_on");
    var phase = document.getElementById("id_fortnight_phase");
    if (!period && !weekday) return;

    var fields = {
      WEEK: [document.getElementById("id_week_starts_on")],
      FORTNIGHT: [weekday, phase],
      MONTH: [document.getElementById("id_month_starts_on")]
    };

    var rows = {};
    Object.keys(fields).forEach(function (key) {
      rows[key] = fields[key].filter(Boolean).map(function (el) { return el.closest(".field"); }).filter(Boolean);
    });

    function wanted(key) {
      if (period && period.value === key) return true;
      // Paid on it: the pay run reads the same start (Workplace.pay_window).
      if (pays && pays.value === key) return true;
      // Nothing to go by (your own cycles form has neither): show them all.
      return !period && !pays;
    }

    function sync() {
      Object.keys(rows).forEach(function (key) {
        var show = wanted(key);
        rows[key].forEach(function (row) { row.hidden = !show; });
      });
    }

    if (period) period.addEventListener("change", sync);
    if (pays) {
      pays.addEventListener("change", function () {
        // A job that pays on a cycle counts its cap over that cycle unless
        // told otherwise; one paid whenever leaves the cap where it was.
        if (period && pays.value && pays.value !== "IRREGULAR") period.value = pays.value;
        sync();
      });
    }
    sync();

    // ---- the fortnight, as dates ------------------------------------------
    var hint = document.querySelector("[data-fortnight-hint]");
    if (!weekday || !phase || !hint) return;

    var DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    function say() {
      var startsOn = parseInt(weekday.value, 10);
      if (isNaN(startsOn)) return;
      // Python counts Monday as 0; JS counts Sunday as 0. Same sum as
      // models.week_start, in JS's numbering.
      var today = new Date();
      var back = ((today.getDay() + 6) % 7 - startsOn + 7) % 7;
      if (phase.value === "last") back += 7;
      var start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
      var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 13);
      hint.textContent = DAYS[startsOn] + " → " + DAYS[(startsOn + 6) % 7] +
        ". This one runs " + start.getDate() + " " + MONTHS[start.getMonth()] +
        " – " + end.getDate() + " " + MONTHS[end.getMonth()] + ".";
    }

    weekday.addEventListener("change", say);
    phase.addEventListener("change", say);
  }

  /* ----------------------------------------------------------------------
     Sending a file, and showing it being read
     One panel for every upload that is read rather than kept — a payslip
     for the workplace form, a photo of a picking list: a thumbnail of the
     file with a beam sweeping over it, the name and size, a bar that fills
     with the bytes actually sent and then shimmers while the server reads,
     and the two steps as they happen. Nothing in it is pretended: the bar
     is the upload's own progress events, and the second step lights only
     once the last byte has gone.

       var reader = makeReader(file, { after: el, reading: "Reading the text" });
       reader.send(url, formData, "json").then(data => { reader.settle(); … })

     `after` is the element the panel goes under; `reading` the words of
     the second step. send() resolves with the parsed body ("json") or the
     text ("text"); a cancel rejects with an Error whose message is "abort".
     ---------------------------------------------------------------------- */
  /* What to tell the user when a send failed, from what the server did. */
  function sendFailure(err, again) {
    var status = err && err.status;
    if (err && err.message === "network") return "It couldn't be sent. Check the connection and try again" + again;
    if (status === 403) return "You've been signed out, or the page is stale. Reload the page and try again.";
    if (status === 413) return "That file is too big for the server to take. Try a smaller photo or a PDF.";
    if (status === 504 || status === 502) return "The server took too long reading it (HTTP " + status + "). Try a smaller or clearer file" + again;
    if (status >= 500) return "The server hit an error reading it (HTTP " + status + ") — check the server log.";
    if (status === 200 || status === 0) return "The server answered with a page instead of a result — you may be signed out. Reload and try again.";
    return "It couldn't be read (HTTP " + status + ")" + again;
  }

  function fileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  }

  function makeReader(file, opts) {
    var isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    var isImage = !isPdf && /^image\//.test(file.type);
    var el = document.createElement("div");
    el.className = "reader";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("data-stage", "upload");
    el.innerHTML =
      '<div class="reader__doc' + (isPdf ? " reader__doc--pdf" : "") + '" aria-hidden="true">' +
        (isImage ? '<img class="reader__img" alt="">' : '<span class="reader__glyph">' + (isPdf ? "PDF" : "FILE") + "</span>") +
        '<span class="reader__beam"></span>' +
      "</div>" +
      '<div class="reader__body">' +
        '<div class="reader__name"><span>' + escapeHtml(file.name) + "</span>" +
          '<span class="reader__size">' + fileSize(file.size) + "</span></div>" +
        '<div class="reader__bar"><span class="reader__fill"></span></div>' +
        '<ol class="reader__steps">' +
          '<li class="reader__step is-live" data-step="upload"><span class="reader__mark"></span><span>Uploading<b class="reader__pct"></b></span></li>' +
          '<li class="reader__step" data-step="read"><span class="reader__mark"></span><span>' + escapeHtml(opts.reading || "Reading") + "</span></li>" +
        "</ol>" +
      "</div>" +
      '<button type="button" class="reader__cancel" aria-label="Cancel">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
      "</button>";

    var thumbUrl = null;
    if (isImage && window.URL && URL.createObjectURL) {
      thumbUrl = URL.createObjectURL(file);
      el.querySelector(".reader__img").src = thumbUrl;
    }
    var request = null;
    var started = Date.now();
    el.querySelector(".reader__cancel").addEventListener("click", function () {
      if (request) request.abort();
    });
    if (opts.after) opts.after.insertAdjacentElement("afterend", el);
    else if (opts.into) { opts.into.innerHTML = ""; opts.into.appendChild(el); opts.into.hidden = false; }

    function stage(name) {
      el.setAttribute("data-stage", name);
      var order = ["upload", "read", "done"];
      var at = order.indexOf(name);
      el.querySelectorAll(".reader__step").forEach(function (step) {
        var i = order.indexOf(step.getAttribute("data-step"));
        step.classList.toggle("is-done", i < at);
        step.classList.toggle("is-live", i === at);
      });
    }

    function progress(sent, total) {
      if (!total) return;
      var share = Math.min(sent / total, 1);
      el.querySelector(".reader__fill").style.width = (share * 100).toFixed(1) + "%";
      el.querySelector(".reader__pct").textContent = " " + Math.round(share * 100) + "%";
    }

    var reader = {
      el: el,
      // Done: the panel settles into one line — the file, ticked, and how
      // long it took — so the file that was read stays named.
      settle: function () {
        stage("done");
        el.querySelector(".reader__pct").textContent = "";
        el.querySelector('[data-step="read"] span:last-child').textContent =
          "Read in " + ((Date.now() - started) / 1000).toFixed(1) + " s";
        var cancel = el.querySelector(".reader__cancel");
        if (cancel) cancel.remove();
      },
      close: function () {
        el.remove();
        if (thumbUrl) { URL.revokeObjectURL(thumbUrl); thumbUrl = null; }
        if (opts.into) opts.into.hidden = true;
      },
      abort: function () {
        if (request) request.abort();
        if (thumbUrl) { URL.revokeObjectURL(thumbUrl); thumbUrl = null; }
      },
      // The file goes by XMLHttpRequest rather than fetch: it is the one
      // that reports how much of a file has been sent.
      send: function (url, body, as) {
        return new Promise(function (resolve, reject) {
          var xhr = new XMLHttpRequest();
          request = xhr;
          xhr.open("POST", url, true);
          xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
          if (as === "json") xhr.setRequestHeader("Accept", "application/json");
          xhr.upload.addEventListener("progress", function (event) {
            if (event.lengthComputable) progress(event.loaded, event.total);
          });
          xhr.upload.addEventListener("load", function () { progress(1, 1); stage("read"); });
          xhr.addEventListener("load", function () {
            request = null;
            if (as === "json") {
              var data = null;
              try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }
              if (!data || (xhr.status >= 400 && !data.error)) {
                // Not the JSON the view sends: a sign-in page, an error
                // page, a proxy's limit. Say which, not "the connection".
                var why = new Error("not read");
                why.status = xhr.status;
                return reject(why);
              }
              return resolve(data);
            }
            // A fragment comes back with a 400 when the read went wrong,
            // and that is the answer; only the server's own failures aren't.
            if (xhr.status >= 500 || xhr.status === 403 || xhr.status === 413) {
              var bad = new Error("not read");
              bad.status = xhr.status;
              return reject(bad);
            }
            resolve({ status: xhr.status, text: xhr.responseText });
          });
          xhr.addEventListener("error", function () { request = null; reject(new Error("network")); });
          xhr.addEventListener("abort", function () { request = null; reject(new Error("abort")); });
          xhr.send(body);
        });
      },
    };
    return reader;
  }

  /* ----------------------------------------------------------------------
     Workplace — fill the form from a payslip
     The small button on the workplace form. The file goes to
     timeclock:workplace_payslip by fetch; what comes back is the boxes to
     fill (keyed by the form's own ids) and where each figure was read from,
     which is listed under the button. Boxes are filled, not the form saved:
     the user checks the figures and presses Save as ever. The name is only
     filled into an empty box — a job being edited keeps its name.
     ---------------------------------------------------------------------- */
  function initPayslipFill() {
    var block = document.querySelector("[data-payslip]");
    if (!block || !window.fetch || !window.FormData) return;
    var input = block.querySelector("[data-payslip-file]");
    var label = block.querySelector("[data-payslip-label]");
    var hint = block.querySelector("[data-payslip-hint]");
    var read = block.querySelector("[data-payslip-read]");
    var button = block.querySelector(".payslip__btn");
    var form = block.closest("form");
    var idle = label.textContent;
    // True while the slip's figures are going in, so the change events the
    // fill itself fires aren't taken for the user editing.
    var filling = false;
    var reader = null;

    function busy(on) {
      button.classList.toggle("is-busy", on);
      button.setAttribute("aria-disabled", on ? "true" : "false");
      input.disabled = on;
    }

    function say(text, bad) {
      hint.textContent = text;
      hint.classList.toggle("help--error", !!bad);
    }

    function fill(id, value) {
      var el = document.getElementById("id_" + id);
      if (!el) return false;
      if (id === "name" && el.value.trim()) return false;
      el.value = String(value);
      // A select that had no such option keeps what it had.
      if (el.tagName === "SELECT" && el.value !== String(value)) return false;
      // Let the period rows and the fortnight hint follow the new value.
      el.dispatchEvent(new Event("change", { bubbles: true }));
      mark(el.closest(".field"));
      return true;
    }

    // A box the slip filled says so beside its label, and stays ringed
    // until the user types over it — the flash alone is gone before the
    // eye has left the button.
    function mark(row) {
      if (!row) return;
      row.classList.remove("is-filled");
      void row.offsetWidth;
      row.classList.add("is-filled");
      var label = row.querySelector(".label");
      if (label && !label.querySelector(".payslip__tag")) {
        var tag = document.createElement("span");
        tag.className = "payslip__tag";
        tag.textContent = "From payslip";
        label.appendChild(tag);
      }
    }

    function unmark(row) {
      row.classList.remove("is-filled");
      var tag = row.querySelector(".payslip__tag");
      if (tag) tag.remove();
    }

    function show(data) {
      var count = 0;
      // The cycle first, so the rows it reveals are there to be filled.
      var order = ["name", "pay_cycle", "limit_period", "hourly_rate", "tax_rate",
        "week_starts_on", "fortnight_starts_on", "fortnight_phase", "month_starts_on"];
      filling = true;
      order.forEach(function (key) {
        if (key in data.fields && fill(key, data.fields[key])) count++;
      });
      filling = false;
      read.innerHTML = "";
      var list = document.createElement("ul");
      list.className = "payslip__list";
      (data.read || []).forEach(function (item) {
        var li = document.createElement("li");
        var b = document.createElement("b");
        b.textContent = item.label + " ";
        var v = document.createElement("span");
        v.textContent = item.value;
        var how = document.createElement("small");
        how.textContent = item.how;
        li.appendChild(b); li.appendChild(v); li.appendChild(how);
        list.appendChild(li);
      });
      read.appendChild(list);
      (data.notes || []).forEach(function (note) {
        var p = document.createElement("p");
        p.className = "payslip__note";
        p.textContent = note;
        read.appendChild(p);
      });
      read.hidden = false;
      say(count
        ? "Filled " + count + " box" + (count === 1 ? "" : "es") + " below — each is marked “From payslip”. Check them against the slip, then save."
        : "Read the slip, but every box it could fill already had that value.");
      label.textContent = "Another payslip";
    }

    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var body = new FormData();
      body.append("payslip", file);
      var token = form && form.querySelector('input[name="csrfmiddlewaretoken"]');
      if (token) body.append("csrfmiddlewaretoken", token.value);

      busy(true);
      label.textContent = "Reading…";
      say("Looking for the rate, the tax withheld and the pay period.");
      read.hidden = true;
      hint.hidden = true;
      var isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      reader = makeReader(file, {
        after: hint,
        reading: isPdf ? "Reading the text" : "Reading the picture — a photo takes a few seconds",
      });

      reader.send(block.getAttribute("data-payslip-url"), body, "json")
        .then(function (data) {
          busy(false);
          if (data.error) {
            reader.close();
            hint.hidden = false;
            label.textContent = idle;
            say(data.error, true);
            return;
          }
          reader.settle();
          hint.hidden = false;
          show(data);
        })
        .catch(function (err) {
          busy(false);
          reader.close();
          hint.hidden = false;
          label.textContent = idle;
          if (err && err.message === "abort") {
            say("Stopped. Choose the payslip again when you're ready — or type the figures in.");
            return;
          }
          say(sendFailure(err, " — or type the figures in."), true);
        });
      // So the same file can be chosen again after a fix.
      input.value = "";
    });

    // Left the page mid-read: nothing to fill any more.
    onLeave(function () { if (reader) reader.abort(); });

    // Anything typed after a fill is the user's, not the slip's: the ring
    // and the tag come off that box. A select fires change, not input.
    if (form) {
      function edited(event) {
        if (filling) return;
        var row = event.target.closest && event.target.closest(".field.is-filled");
        if (row) unmark(row);
      }
      form.addEventListener("input", edited);
      form.addEventListener("change", edited);
    }
  }

  /* ----------------------------------------------------------------------
     Pay — one form, and the date box only when a day is the answer
     "What did this payment cover" is a list; one of its answers is a day
     you name, and only then is there a date to ask for. The button asks
     before it draws the line, in the words of the answer chosen.
     ---------------------------------------------------------------------- */
  function initPayForms() {
    document.querySelectorAll("form[data-settle]").forEach(function (form) {
      var covers = form.querySelector("[data-settle-covers]");
      var day = form.querySelector("[data-settle-day]");
      if (!covers || !day) return;

      function sync() { day.hidden = covers.value !== "date"; }
      covers.addEventListener("change", sync);
      sync();

      form.addEventListener("submit", function (event) {
        var chosen = covers.options[covers.selectedIndex];
        var what = covers.value === "date"
          ? "work up to and including " + (form.up_to.value || "the day chosen")
          : chosen.text;
        if (!confirm("Mark " + what + " as paid at " + form.getAttribute("data-settle") + "?")) {
          event.preventDefault();
        }
      });
    });
  }

  /* ----------------------------------------------------------------------
     Statement — the quick picks fill the dates
     "This month" and "Last month" are the two most statements are for; the
     boxes stay, for any other stretch. The form is marked data-download:
     the browser saves the file and the page stays, so neither the busy
     state nor the page skeleton a submit usually brings applies to it.
     ---------------------------------------------------------------------- */
  function initStatementForm() {
    var form = document.querySelector("form[data-statement]");
    if (!form) return;

    form.querySelectorAll("[data-range]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var parts = btn.getAttribute("data-range").split(":");
        form.from.value = parts[0];
        form.to.value = parts[1];
      });
    });

  }

  /* ----------------------------------------------------------------------
     Cash in hand — hide the tax question it cannot answer

     Paid cash there is no withholding to state, so a percentage box sitting
     open underneath is a question with no right answer. It goes the moment
     cash is chosen and comes back if the job changes, and the server clears
     the value either way so nothing lingers on the row.
     ---------------------------------------------------------------------- */
  function initCashFields() {
    var paidIn = document.getElementById("id_paid_in");
    var tax = document.getElementById("id_tax_rate");
    if (!paidIn || !tax) return;

    var row = tax.closest(".field");
    if (!row) return;

    function sync() {
      var cash = paidIn.value === "CASH";
      row.hidden = cash;
      if (cash) tax.value = "";
    }

    paidIn.addEventListener("change", sync);
    sync();
  }

  /* ----------------------------------------------------------------------
     Notice composer
     The box grows with what you write, counts down only once the limit is
     within sight, and won't post an empty notice. Without this the textarea
     is simply a fixed three rows and the server catches the empty post.
     ---------------------------------------------------------------------- */
  /* ----------------------------------------------------------------------
     Compose dialog
     The + is a real link to the composer's own page; this catches the click
     and opens the same form in a <dialog> instead. With JS off the link is
     simply followed, so posting never depends on any of this.
     ---------------------------------------------------------------------- */
  /* ----------------------------------------------------------------------
     Dialogs
     Every <dialog class="modal"> — the composer, the list of who reacted —
     opens and shuts the same way: the box travels in and back out, the
     backdrop and Escape both close it. Wired per page, since the dialogs
     are part of the body and go with it.
     ---------------------------------------------------------------------- */
  function openModal(modal) {
    if (!modal || typeof modal.showModal !== "function") return false;
    modal.classList.remove("is-closing");
    if (!modal.open) modal.showModal();
    return true;
  }

  function closeModal(modal) {
    if (!modal || !modal.open) return;
    // Let the box travel back out before the dialog is taken away.
    modal.classList.add("is-closing");
    setTimeout(function () {
      modal.classList.remove("is-closing");
      if (modal.open) modal.close();
    }, 160);
  }

  function initModals() {
    document.querySelectorAll("dialog.modal").forEach(function (modal) {
      if (typeof modal.showModal !== "function") return;

      modal.querySelectorAll("[data-close]").forEach(function (btn) {
        btn.addEventListener("click", function () { closeModal(modal); });
      });

      // Clicking the backdrop lands on the dialog itself, never on its box.
      modal.addEventListener("click", function (event) {
        if (event.target === modal) closeModal(modal);
      });

      // Escape closes the dialog itself; intercept so it animates out too.
      modal.addEventListener("cancel", function (event) {
        event.preventDefault();
        closeModal(modal);
      });
    });
  }

  function initComposeModal() {
    var modal = document.getElementById("compose-modal");
    if (!modal || typeof modal.showModal !== "function") return;

    function open(event) {
      if (event) event.preventDefault();
      openModal(modal);
      var box = modal.querySelector("textarea");
      if (box) box.focus();
    }

    document.querySelectorAll("[data-compose]").forEach(function (trigger) {
      trigger.addEventListener("click", open);
    });

    // A rejected post comes back with the box marked open, so the writer
    // sees the error where they typed rather than on an empty board.
    if (modal.hasAttribute("data-open")) open();
  }

  /* ----------------------------------------------------------------------
     Who reacted
     The count on a tally is a link to the page of names behind it. With
     script the tap fetches that list and shows it in a sheet over the
     board instead, so looking at who reacted is a glance, not a trip.
     ---------------------------------------------------------------------- */
  function initReactorsSheet() {
    if (!window.fetch) return;

    document.addEventListener("click", function (event) {
      var link = event.target.closest ? event.target.closest("a.tally__emoji, a.comment__tally") : null;
      if (!link || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var modal = document.getElementById("reactors-modal");
      if (!modal || typeof modal.showModal !== "function") return;

      event.preventDefault();
      var title = modal.querySelector("#reactors-title");
      var sub = modal.querySelector("#reactors-sub");
      var body = modal.querySelector("#reactors-body");
      title.textContent = "Reactions";
      sub.textContent = "";
      body.innerHTML = '<div class="modal__wait" aria-hidden="true"></div>';
      openModal(modal);

      fetch(link.href, {
        credentials: "same-origin",
        headers: { "X-Requested-With": "fetch", Accept: "application/json" },
      })
        .then(function (response) {
          if (!response.ok) throw new Error("no list");
          return response.json();
        })
        .then(function (data) {
          if (!modal.isConnected || !modal.open) return;
          title.textContent = data.title;
          sub.textContent = data.sub;
          body.innerHTML = data.html;
        })
        .catch(function () {
          // The page of names is still there; go and look at it.
          if (modal.isConnected && modal.open) window.location.href = link.href;
        });
    });
  }

  /* ----------------------------------------------------------------------
     Editing in place
     Edit on your own notice is a link to the edit page. With script the
     tap opens the editor that _notice_body.html keeps folded inside the
     card: the words become a box, Save posts it by fetch, and the card is
     redrawn with the answer — so a fix to a typo never leaves the board.
     If the save cannot be sent the form is posted the old way.
     ---------------------------------------------------------------------- */
  function initEditing() {
    if (!window.fetch || !window.FormData) return;

    function editorFor(el) {
      var card = el.closest(".notice");
      return card ? card.querySelector("[data-editor]") : null;
    }

    function open(editor) {
      var card = editor.closest(".notice");
      var text = card.querySelector(".notice__text");
      var box = editor.querySelector("textarea");
      // One at a time: the last card left open goes back to its words.
      document.querySelectorAll(".notice.is-editing [data-editor]").forEach(function (other) {
        if (other !== editor) close(other);
      });
      editor.hidden = false;
      if (text) text.hidden = true;
      card.classList.add("is-editing");
      grow(box);
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    }

    function close(editor) {
      var card = editor.closest(".notice");
      var text = card.querySelector(".notice__text");
      var error = editor.querySelector("[data-editor-error]");
      editor.hidden = true;
      if (text) text.hidden = false;
      if (error) error.hidden = true;
      card.classList.remove("is-editing");
      // Back to what is on the board, not to a half-made change.
      var box = editor.querySelector("textarea");
      if (box) box.value = box.defaultValue;
    }

    function grow(box) {
      box.style.height = "auto";
      box.style.height = Math.min(box.scrollHeight + 2, 320) + "px";
    }

    document.addEventListener("click", function (event) {
      var target = event.target.closest ? event.target.closest("[data-edit], [data-editor-cancel]") : null;
      if (!target || event.defaultPrevented) return;
      var editor = editorFor(target);
      if (!editor) return;
      event.preventDefault();
      if (target.hasAttribute("data-edit")) open(editor);
      else close(editor);
    });

    document.addEventListener("input", function (event) {
      var box = event.target;
      if (box.matches && box.matches("[data-editor] textarea")) grow(box);
    });

    document.addEventListener("keydown", function (event) {
      var box = event.target;
      if (!box.matches || !box.matches("[data-editor] textarea")) return;
      if (event.key === "Escape") { event.preventDefault(); close(box.closest("[data-editor]")); }
      // Enter with the modifier saves, as it does in most boxes like this.
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        box.closest("[data-editor]").requestSubmit();
      }
    });

    document.addEventListener("submit", function (event) {
      var editor = event.target;
      if (!editor.matches || !editor.matches("[data-editor]")) return;
      event.preventDefault();

      var card = editor.closest(".notice");
      var error = editor.querySelector("[data-editor-error]");
      var save = editor.querySelector('button[type="submit"]');
      if (save) save.disabled = true;

      fetch(editor.action, {
        method: "POST",
        body: new FormData(editor),
        credentials: "same-origin",
        headers: { "X-Requested-With": "fetch", Accept: "application/json" },
      })
        .then(function (response) {
          return response.json().then(function (data) {
            if (!response.ok && !data.error) throw new Error("not saved");
            return data;
          });
        })
        .then(function (data) {
          if (save) save.disabled = false;
          if (data.error) {
            if (error) { error.textContent = data.error; error.hidden = false; }
            return;
          }
          if (!card.isConnected) return;
          var old = card.querySelector(".notice__body");
          var box = document.createElement("template");
          box.innerHTML = data.body.trim();
          var next = box.content.firstElementChild;
          if (old && next) old.replaceWith(next);
          card.classList.remove("is-editing");
          card.classList.add("is-saved");
          setTimeout(function () { card.classList.remove("is-saved"); }, 1400);
        })
        .catch(function () {
          // The old way: the page, with the change carried in the form.
          if (editor.isConnected) editor.submit();
        });
    });
  }

  /* ----------------------------------------------------------------------
     Comment and reply boxes
     Reply and Comment are ordinary anchors to the box they open — the fold
     itself is :target, so it works with no script at all. This only puts the
     cursor in the box, which is what you meant when you tapped the word.
     ---------------------------------------------------------------------- */
  function initCommentBoxes() {
    document.addEventListener("click", function (event) {
      var link = event.target.closest ? event.target.closest("[data-focus]") : null;
      if (!link) return;

      var target = document.querySelector(link.getAttribute("href"));
      if (!target) return;

      // The anchor points either at the input itself or at the form that
      // :target reveals, in which case the input inside it wants the cursor.
      var input = target.matches("input") ? target : target.querySelector("input[type=text]");
      if (!input) return;

      // After the browser has followed the anchor, so its own scroll lands
      // first and the focus doesn't fight it.
      setTimeout(function () { input.focus({ preventScroll: true }); }, 0);
    });
  }

  /* ----------------------------------------------------------------------
     Reactions
     The row of faces is a <details> over a form of submit buttons, so it
     opens and posts with no script at all. That path is a page load per
     tap, though — a POST, a redirect and a fresh board — and on a phone
     with a poor signal that is a second or two of nothing having visibly
     happened, which is exactly long enough to tap again. So a tap here is
     sent by fetch instead: the button wears the face at once, and the
     server's answer — the same button and tally the board would have
     drawn — replaces both when it lands. If anything about that goes
     wrong the form is posted the old way, so a reaction is never lost.

     Everything is delegated to the document, so it holds for every page
     this document shows and for a control that has just been swapped in.
     ---------------------------------------------------------------------- */
  function initReactions() {
    function pickers() {
      return document.querySelectorAll("details.react");
    }

    function closeAll(except) {
      pickers().forEach(function (picker) {
        if (picker !== except && picker.open) picker.open = false;
      });
    }

    // ---- open and shut ---------------------------------------------------

    document.addEventListener("click", function (event) {
      var inside = event.target.closest ? event.target.closest("details.react") : null;
      closeAll(inside);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      closeAll(null);
    });

    // The row of faces opens from the left edge of its React button. Under a
    // reply stepped in from the right of a narrow phone that puts the last
    // face or two off the screen, so an opened picker is measured and, if
    // it hangs over the edge, moved back inside it (§25 reads --shift).
    // toggle does not bubble; it is caught on the way down instead.
    document.addEventListener("toggle", function (event) {
      var details = event.target;
      if (!details.matches || !details.matches("details.react")) return;
      var picker = details.querySelector(".picker");
      if (!picker) return;
      picker.style.removeProperty("--shift");
      if (!details.open) return;
      closeAll(details);
      // Kept inside the card it belongs to, which is always inside the
      // screen — innerWidth is not to be trusted on a phone mid-zoom.
      var card = details.closest(".notice") || document.querySelector("main.container");
      var edge = card ? card.getBoundingClientRect().right - 8 : window.innerWidth - 12;
      var box = picker.getBoundingClientRect();
      var over = box.right - edge;
      if (over > 0) picker.style.setProperty("--shift", Math.min(over, box.left - 12) + "px");
    }, true);

    // On a mouse the row opens under the pointer, the way it does on the
    // app it is borrowed from, and shuts once the pointer has left it and
    // the button for good. Only where hover means something: a phone's
    // emulated hover would open the row on the tap that meant to press.
    if (window.matchMedia && window.matchMedia("(hover: hover)").matches) {
      var hoverTimer = null;
      var hoverOpened = null;
      document.addEventListener("mouseover", function (event) {
        var details = event.target.closest ? event.target.closest("details.react") : null;
        clearTimeout(hoverTimer);
        if (!details) return;
        hoverTimer = setTimeout(function () {
          if (!details.open) hoverOpened = details;
          details.open = true;
        }, 350);
      });
      // A click on the button under a row that hover already opened means
      // "open it", not "shut what I did not open".
      document.addEventListener("click", function (event) {
        var summary = event.target.closest ? event.target.closest("details.react > summary") : null;
        if (summary && summary.parentElement === hoverOpened && hoverOpened.open) {
          event.preventDefault();
        }
        hoverOpened = null;
      });
      document.addEventListener("mouseout", function (event) {
        var details = event.target.closest ? event.target.closest("details.react") : null;
        clearTimeout(hoverTimer);
        if (!details || !details.open) return;
        if (event.relatedTarget && details.contains(event.relatedTarget)) return;
        hoverTimer = setTimeout(function () { details.open = false; }, 450);
      });
    }

    // ---- the tap ---------------------------------------------------------

    if (!window.fetch || !window.FormData) return;

    document.addEventListener("click", function (event) {
      var btn = event.target.closest ? event.target.closest(".picker__btn") : null;
      if (!btn || event.defaultPrevented) return;
      var form = btn.form || btn.closest("form.picker");
      var details = btn.closest("details.react");
      if (!form || !details) return;

      event.preventDefault();
      send(details, form, btn);
    });

    function send(details, form, btn) {
      var key = details.getAttribute("data-react");
      var taking = btn.classList.contains("is-on");

      // What was tapped shows at once; the answer confirms it.
      wear(details, taking ? null : btn);
      details.open = false;

      var body = new FormData(form);
      body.set("emoji", btn.value);

      fetch(form.action, {
        method: "POST",
        body: body,
        credentials: "same-origin",
        headers: { "X-Requested-With": "fetch", Accept: "application/json" },
      })
        .then(function (response) {
          if (!response.ok) throw new Error("reaction not saved");
          return response.json();
        })
        .then(function (data) {
          // The page may have been swapped underneath a slow answer.
          var live = document.querySelector('details.react[data-react="' + key + '"]');
          if (!live || !live.isConnected) return;
          swap(live, data.control);
          var tally = document.querySelector('[data-tally="' + key + '"]');
          if (tally && data.tally) swap(tally, data.tally);
        })
        .catch(function () {
          // The old way: a page load, with the face carried in a field the
          // buttons no longer need to supply.
          var live = document.querySelector('details.react[data-react="' + key + '"] form.picker');
          if (!live) return;
          var field = document.createElement("input");
          field.type = "hidden";
          field.name = "emoji";
          field.value = btn.value;
          live.appendChild(field);
          live.submit();
        });
    }

    /* The React button, wearing the face just tapped — or none. Drawn from
       the button that was pressed, which already has the face and the word
       on it, so nothing here has to know what a reaction looks like. */
    function wear(details, btn) {
      var summary = details.querySelector("summary");
      if (!summary) return;
      var label = summary.querySelector(".act__label");
      var face = summary.querySelector(".rx");
      var icon = summary.querySelector(".act__icon");

      details.querySelectorAll(".picker__btn").forEach(function (other) {
        other.classList.toggle("is-on", other === btn);
      });

      if (!btn) {
        summary.classList.remove("is-on");
        summary.removeAttribute("data-kind");
        if (face) face.remove();
        if (!icon) summary.insertAdjacentHTML("afterbegin", NEUTRAL_FACE);
        if (label) label.textContent = "React";
        return;
      }
      summary.classList.add("is-on");
      summary.setAttribute("data-kind", btn.getAttribute("data-kind") || "");
      if (icon) icon.remove();
      if (face) face.remove();
      var pressed = btn.querySelector(".rx");
      if (pressed) summary.insertAdjacentElement("afterbegin", pressed.cloneNode(true));
      if (label) label.textContent = btn.getAttribute("data-label") || "Reacted";
    }

    /* One element for another, parsed the way the page itself was. */
    function swap(el, html) {
      var box = document.createElement("template");
      box.innerHTML = html.trim();
      var next = box.content.firstElementChild;
      if (next) el.replaceWith(next);
    }
  }

  // The plain face on a React button nobody has pressed — the same lines
  // _react.html draws, for putting back after a reaction is taken away.
  var NEUTRAL_FACE =
    '<svg class="act__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/>' +
    '<path d="M9 9.5v.01M15 9.5v.01"/></svg>';

  function initCompose() {
    var box = document.querySelector(".compose textarea");
    if (!box) return;

    var counter = document.getElementById("notice-count");
    var post = document.getElementById("notice-post");
    var max = parseInt(box.getAttribute("maxlength"), 10) || 0;

    function sync() {
      // Collapse first, or the box can only ever get taller.
      box.style.height = "auto";
      box.style.height = Math.min(box.scrollHeight, 260) + "px";

      var used = box.value.trim().length;
      if (post) post.disabled = used === 0;

      if (counter && max) {
        var left = max - box.value.length;
        // Silent until the last fifth — a counter that always shows is noise.
        counter.textContent = left <= max / 5 ? left + " left" : "";
        counter.classList.toggle("is-close", left <= 40);
      }
    }

    box.addEventListener("input", sync);
    sync();
  }

  /* ----------------------------------------------------------------------
     Profile photo — see the picture you picked before you commit to it
     Without this the circle keeps showing your old face (or your initial)
     until the upload round-trips, which reads as the tap having missed.
     ---------------------------------------------------------------------- */
  function initAvatarPicker() {
    var input = document.getElementById("avatar-input");
    if (!input) return;

    var menu = input.closest("details");
    var face = menu && menu.querySelector(".avatar");
    var hint = document.getElementById("photo-hint");
    if (!face) return;

    var objectUrl = null;

    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) return;

      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(file);

      var img = face.querySelector(".avatar__img");
      if (!img) {
        // Replacing an initial: the letter goes, an image takes its place.
        face.textContent = "";
        img = document.createElement("img");
        img.className = "avatar__img";
        img.alt = "";
        face.appendChild(img);
      }
      img.src = objectUrl;

      // The choice is made, so the menu has nothing left to offer — and the
      // picture behind it is the thing you now want to look at.
      if (menu) menu.open = false;

      if (hint) {
        hint.textContent = "Uploading\u2026";
        hint.hidden = false;
      }

      // Picking the photo is the decision; there is nothing left to confirm,
      // so it sends itself. requestSubmit rather than submit so the page's
      // own submit handling still sees it go.
      var form = input.form;
      if (!form) return;
      if (form.requestSubmit) form.requestSubmit();
      else form.submit();
    });
  }

  /* ----------------------------------------------------------------------
     Live workplace filter

     Two screens ask which job you mean, and on both of them the answer used
     to cost a page load: the timesheet's row of chips went away and came
     back, and the clock's picker changed nothing at all until you clocked in
     or reloaded, so the hours cap under it went on describing the job you had
     just stopped looking at.

     Now the control stays exactly where your thumb left it and only what
     depends on it is fetched and swapped. Mark a control with
     data-live-filter="<id>" and give the region that id; links inside it are
     followed as URLs, radios inside it name a workplace.

     Progressive enhancement, not a rewrite. The chips are the same links and
     the radios are the same form fields; with no JavaScript, a broken fetch,
     or any response that isn't the page we asked for, the browser does it the
     ordinary way. pushState keeps the address bar honest for the links, so
     back, refresh, a bookmark and a link sent to somebody all still mean what
     they say.
     ---------------------------------------------------------------------- */
  function initLiveFilter() {
    if (!window.fetch || !window.DOMParser || !window.history.pushState) return;

    var controls = document.querySelectorAll("[data-live-filter]");
    for (var i = 0; i < controls.length; i++) {
      var region = document.getElementById(
        controls[i].getAttribute("data-live-filter")
      );
      if (region) wireLiveFilter(controls[i], region);
    }
  }

  function wireLiveFilter(control, region) {
    // Long enough that a filter which answers immediately — which is nearly
    // always — never flashes grey on its way to being instant.
    var WAIT = 250;
    var rows = region.getAttribute("data-live-skeleton") === "rows";
    var inFlight = null;
    var timer = null;

    // Which job a URL is asking for, so a chip lights up on what it means
    // rather than on the exact string — "page 2 of Fresh Meat" is still Fresh
    // Meat, and "no workplace at all" is the All chip.
    function jobIn(url) {
      try {
        return new URL(url, window.location.origin).searchParams.get("workplace") || "";
      } catch (e) {
        return "";
      }
    }

    function markChosen(href) {
      // Only links need telling. A radio the browser has just checked is
      // already showing the right thing.
      var links = control.querySelectorAll("a.chip--link");
      var want = jobIn(href);
      for (var i = 0; i < links.length; i++) {
        links[i].classList.toggle("is-on", jobIn(links[i].href) === want);
      }
    }

    function stopWaiting() {
      clearTimeout(timer);
      region.removeAttribute("aria-busy");
    }

    function handOver(href) {
      // Whatever went wrong, the browser can still do this the ordinary way.
      stopWaiting();
      window.location.href = href;
    }

    function load(href, remember) {
      if (inFlight) inFlight.abort();
      var controller = new AbortController();
      inFlight = controller;

      // The control answers now; the figures land a moment later. That order
      // is what makes it feel like a switch rather than a request.
      markChosen(href);
      region.setAttribute("aria-busy", "true");
      clearTimeout(timer);
      timer = setTimeout(function () {
        region.innerHTML = rows ? skeletonRows(4, "skeleton--circle") : skeletonCard();
      }, WAIT);

      fetch(href, {
        signal: controller.signal,
        credentials: "same-origin",
        headers: { "X-Requested-With": "fetch" },
      })
        .then(function (response) {
          if (!response.ok) throw new Error(response.status);
          return response.text();
        })
        .then(function (html) {
          var doc = new DOMParser().parseFromString(html, "text/html");
          var next = doc.getElementById(region.id);
          // Anything but the page we asked for — a sign-in screen, an error —
          // is the browser's to show, not ours to paste into a card.
          if (!next) return handOver(href);

          stopWaiting();
          region.innerHTML = next.innerHTML;
          // Figures that replaced figures, so they arrive already finished.
          initTally(true);
          if (remember === "push") history.pushState({ liveFilter: true }, "", href);
          if (remember === "replace") history.replaceState({ liveFilter: true }, "", href);
          noteAddress();
        })
        .catch(function (error) {
          if (error && error.name === "AbortError") return;
          handOver(href);
        });
    }

    // ---- links: the timesheet's chips ----------------------------------
    // On the control itself rather than on the document, so the cancel is in
    // before the page-level skeleton handler ever sees the click.
    control.addEventListener("click", function (event) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      var link = event.target.closest ? event.target.closest("a.chip--link") : null;
      if (!link || link.origin !== window.location.origin) return;

      event.preventDefault();
      // Already on it: nothing to fetch, and nothing to flash either.
      if (link.href !== window.location.href) load(link.href, "push");
    });

    // ---- radios: the clock's workplace picker ---------------------------
    // Picking one is not a navigation, so it replaces the current history
    // entry rather than stacking one per job you looked at — otherwise the
    // back button walks you through every choice you tried before clocking in.
    control.addEventListener("change", function (event) {
      var radio = event.target;
      if (!radio || radio.type !== "radio" || !radio.value) return;
      load(
        window.location.pathname + "?workplace=" + encodeURIComponent(radio.value),
        "replace"
      );
    });

    // Back and forward move between filters the same way the chips do. The
    // entry you arrived on is flagged too, or going back to it lands on a
    // state this ignores and the page keeps showing the job you left. The
    // handler is the page's, not the window's: soft navigation hands it
    // only the steps that stay within this page, and drops it on leaving.
    if (control.querySelector("a.chip--link")) {
      history.replaceState({ liveFilter: true }, "", window.location.href);
      ownHistory(function () { load(window.location.href, null); });
    }

    // Left mid-swap: the region the answer was for is gone.
    onLeave(function () {
      clearTimeout(timer);
      if (inFlight) inFlight.abort();
    });
  }

  /* ----------------------------------------------------------------------
     Page skeleton
     Every screen here is rendered by the server, so most of the time there is
     no gap to fill: you tap, the page arrives, and a placeholder would only
     have flickered. On a phone on mobile data there is a gap, and that is the
     one this fills — the old page stops being the answer the moment you tap,
     and sitting on it for two seconds looks like the tap missed.

     So nothing is shown for the first fraction of a second. Past that, the
     page's own content is set aside (the nodes themselves, so nothing is lost
     or re-initialised) and shapes stand in until the new page lands. If the
     navigation never happens, the page comes back.

     One controller for both kinds of leaving: a form posting or a link the
     browser follows (initNavSkeleton, below) and a link soft navigation
     follows itself. Either arms it; whichever page lands resolves it.
     ---------------------------------------------------------------------- */
  var pageSkeleton = (function () {
    // Long enough that a quick navigation never flashes a skeleton.
    var WAIT = 400;
    // A navigation that never lands — offline, or cancelled in a way the page
    // is never told about — gets its content back rather than being stranded.
    var GIVE_UP = 12000;

    var timer = null;
    var giveUp = null;
    var parked = null;
    var host = null;
    var bound = "";   // where the navigation is going — which shape to draw

    function show() {
      if (parked) return;
      host = document.querySelector("main.container");
      if (!host) return;
      // Drawn before the content is set aside: the shape may copy the
      // segmented control off the page being left.
      var shapes = skeletonFor(bound);
      parked = document.createDocumentFragment();
      while (host.firstChild) parked.appendChild(host.firstChild);
      host.innerHTML = shapes;
      host.setAttribute("aria-busy", "true");
      giveUp = setTimeout(restore, GIVE_UP);
    }

    /* The page's own content back: the navigation did not happen. */
    function restore() {
      clearTimeout(timer);
      clearTimeout(giveUp);
      if (!parked) return;
      // Only into the page it came from, if that is still the one on screen.
      if (host && host.isConnected) {
        host.innerHTML = "";
        host.appendChild(parked);
        host.removeAttribute("aria-busy");
      }
      parked = null;
      host = null;
    }

    /* Start waiting, for `href`. The skeleton appears only if the wait
       turns out long, and in the shape of the page at that address. */
    function arm(href) {
      clearTimeout(timer);
      bound = href || "";
      timer = setTimeout(show, WAIT);
    }

    /* The navigation landed and brought a whole body with it: nothing to put
       back, and nothing left to wait for. */
    function reset() {
      clearTimeout(timer);
      clearTimeout(giveUp);
      parked = null;
      host = null;
    }

    return { arm: arm, restore: restore, reset: reset };
  })();

  /* The navigations the browser makes itself. Soft navigation has already
     cancelled the clicks it takes, so what reaches here is a real page load —
     a form, or a link that opted out. */
  function initNavSkeleton() {
    document.addEventListener("click", function (event) {
      // Anything the browser won't treat as a plain navigation is not one:
      // new tabs, downloads, modified clicks, and anything already handled.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      var link = event.target.closest ? event.target.closest("a[href]") : null;
      if (!link || link.hasAttribute("download")) return;
      if (link.target && link.target !== "_self") return;
      if (link.origin !== window.location.origin) return;

      var href = link.getAttribute("href") || "";
      if (!href || href.charAt(0) === "#") return;
      // A link to where you already are only moves the scroll position.
      if (link.pathname === window.location.pathname &&
          link.search === window.location.search) return;

      pageSkeleton.arm(link.href);
    });

    document.addEventListener("submit", function (event) {
      // The live search and the compose dialog handle their own submits, and
      // a delete form whose confirm() was declined never leaves the page —
      // all of them have cancelled the event by the time it reaches here.
      if (event.defaultPrevented) return;
      var form = event.target;
      if (form.getAttribute && form.getAttribute("target")) return;
      // A file to save is not a page to wait for.
      if (form.hasAttribute && form.hasAttribute("data-download")) return;
      // A form lands wherever its view sends it — usually back where it
      // was posted from, which the page carries in `next` when it knows.
      var next = form.querySelector && form.querySelector('input[name="next"]');
      pageSkeleton.arm(next && next.value ? next.value : form.action);
    });

    // Leaving for real: nothing left to wait for.
    window.addEventListener("pagehide", function () {
      pageSkeleton.reset();
    });

    // Back button onto a page the browser kept: it comes back mid-skeleton,
    // so put its content back.
    window.addEventListener("pageshow", function (event) {
      if (event.persisted) pageSkeleton.restore();
    });
  }

  /* ----------------------------------------------------------------------
     Live field errors
     A message from the server describes the value that was in the box when
     it was sent. The moment you change that value the message stops being
     true, and leaving it there tells you off for something you have already
     fixed — so it goes as soon as you touch the field.

     While you type, the browser's own checks stand in: a half-typed address
     is not an error yet, but one you have finished and got wrong is, and it
     is said in the same slot rather than in a popup over the page.
     ---------------------------------------------------------------------- */
  function initLiveErrors() {
    var fields = document.querySelectorAll(".field");
    if (!fields.length) return;

    fields.forEach(function (field) {
      var control = field.querySelector(
        "input:not([type=hidden]):not([type=file]), select, textarea"
      );
      var slot = field.querySelector("[data-error]");
      if (!control || !slot) return;

      function show(message) {
        slot.textContent = message || "";
        slot.hidden = !message;
        field.classList.toggle("field--invalid", !!message);
        if (message) control.setAttribute("aria-invalid", "true");
        else control.removeAttribute("aria-invalid");
      }

      control.addEventListener("input", function () {
        // An empty box is not yet wrong — it is a box being cleared, or one
        // you have not filled in. Nagging mid-keystroke is what makes people
        // stop reading these messages at all.
        if (!control.value) {
          show("");
          return;
        }
        show(control.checkValidity() ? "" : control.validationMessage);
      });

      // Moving on is when a browser would normally have spoken up.
      control.addEventListener("blur", function () {
        if (!control.value) return;
        if (!control.checkValidity()) show(control.validationMessage);
      });
    });
  }

  /* ----------------------------------------------------------------------
     The tab bar's capsule, which slides.

     The bright lozenge behind the current tab used to be a background on the
     tab itself, so moving between tabs meant one lozenge vanishing and
     another appearing. It is now a single element that travels: tap a tab and
     the capsule slides across to it, the way the selected pill in an iOS tab
     bar moves rather than blinks.

     Tapping a tab is still an ordinary link, and the page still loads. The
     slide fills the gap before it does — and because the new page draws its
     capsule already under the tab you chose, the movement and the arrival
     join up instead of fighting.

     Nothing here is required for the bar to work. Without JavaScript the
     capsule is never built, .has-slider is never set, and the active tab
     keeps the background it always had.
     ---------------------------------------------------------------------- */
  var FROM_KEY = "mywork-tab-from";
  // A note to the next page, not a preference: it is read once, cleared
  // immediately, and ignored if it has been sitting there long enough to
  // belong to some earlier navigation that never landed.
  var FROM_FRESH = 15000;

  /* Which tab the knob was under, and exactly where on the screen it was —
     the next page's dock is laid out differently (the name moves to the
     new tab, and the dock re-centres around it), so the knob starts from
     the place it was seen rather than from where that tab has since gone. */
  function rememberTab(href, box) {
    try {
      window.sessionStorage.setItem(FROM_KEY, [Date.now(), href, box ? Math.round(box.left) : "", box ? Math.round(box.width) : ""].join(" "));
    } catch (e) { /* private browsing: the capsule simply won't slide */ }
  }

  function takeRemembered() {
    var raw = null;
    try {
      raw = window.sessionStorage.getItem(FROM_KEY);
      window.sessionStorage.removeItem(FROM_KEY);
    } catch (e) { return null; }
    if (!raw) return null;
    var parts = raw.split(" ");
    if (parts.length < 2 || !parts[1]) return null;
    if (Date.now() - Number(parts[0]) > FROM_FRESH) return null;
    return {
      href: parts[1],
      left: parts[2] === "" || parts[2] === undefined ? null : Number(parts[2]),
      width: parts[3] === "" || parts[3] === undefined ? null : Number(parts[3])
    };
  }

  function initTabSlider() {
    // The note the last page left about which tab it was on (see below).
    // Read once, here, because taking it clears it — and both bars want it.
    var from = takeRemembered();
    document.querySelectorAll(".tabbar__inner, .segments").forEach(function (bar) {
      wireSlider(bar, from);
    });
  }

  /* One bar's capsule. The tab bar and the segmented control are the same
     mechanism in different materials; each gets its own capsule, and each
     only ever slides between its own tabs — a bar that has no tab for where
     you came from simply places its capsule and does not animate. */
  function wireSlider(bar, from) {
    var tabs = bar.querySelectorAll(".tab");
    // One tab has nowhere to slide to.
    if (tabs.length < 2) return;

    var slider = document.createElement("span");
    slider.className = "tab-slider";
    slider.setAttribute("aria-hidden", "true");
    // First child, so that at equal z-index the tabs paint over it.
    bar.insertBefore(slider, bar.firstChild);
    bar.classList.add("has-slider");

    function measure(tab) {
      // getBoundingClientRect rather than offsetLeft: the bar is a scroll
      // container with padding and a border, and offsetLeft's origin differs
      // between browsers on exactly that. An absolutely positioned child
      // starts at the padding box, so the border is what has to come off.
      var barBox = bar.getBoundingClientRect();
      var tabBox = tab.getBoundingClientRect();
      var style = window.getComputedStyle(bar);
      return {
        x: tabBox.left - barBox.left - (parseFloat(style.borderLeftWidth) || 0) + bar.scrollLeft,
        y: tabBox.top - barBox.top - (parseFloat(style.borderTopWidth) || 0) + bar.scrollTop,
        w: tabBox.width,
        h: tabBox.height
      };
    }

    function place(tab, animate) {
      if (!tab) {
        // No tab is current — a page under this app that isn't one of the
        // three. Nothing to sit under, so the capsule stays away.
        slider.classList.remove("is-on");
        return;
      }
      placeBox(measure(tab), animate);
    }

    function placeBox(box, animate) {
      if (!box.w) return;

      if (!animate) {
        slider.classList.add("is-instant");
      }
      slider.style.width = box.w + "px";
      slider.style.height = box.h + "px";
      slider.style.transform = "translate3d(" + box.x + "px, " + box.y + "px, 0)";
      slider.classList.add("is-on");

      if (!animate) {
        // Read back a layout value to commit the position before the
        // transition is allowed again, or the first move animates from 0,0.
        void slider.offsetWidth;
        slider.classList.remove("is-instant");
      }
    }

    function current() {
      return bar.querySelector(".tab.is-active");
    }

    /* The slide happens on the page you land on, not the one you leave.

       Tapping a tab is a real navigation, and the browser tears the old page
       down within a few tens of milliseconds — far inside a 420ms transition,
       which is why animating on the way out produced a jump. There is no
       amount of tuning that beats that; the animation has to run somewhere it
       will not be interrupted, and the only such place is the new page.

       So the tab you were on is written down on the way out, and the page
       that arrives puts the capsule back where it was and slides it to where
       it now belongs. That is also the honest order of events: the content
       has changed, and the capsule is catching up with it. */
    function tabFor(href) {
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].href === href) return tabs[i];
      }
      return null;
    }

    var isDock = bar.classList.contains("tabbar__inner");

    /* The dock's knob moves like a drop of liquid. It does not travel: its
       near edge stays under the tab you were on while its far edge reaches
       out to the tab you tapped, so for a moment it spans both — then the
       trailing edge lets go and snaps in, and the pill is under the new tab.
       Two transitions with two timings (§34: .is-stretching, .is-snapping),
       and the tab's icon fades in only once the pill has arrived under it. */
    var STRETCH = 190;
    var SNAP = 340;
    // How long a segmented control's slide takes to settle (§34).
    var SLIDE = 420;

    // While the knob is on its way nothing else may place it: fonts.ready
    // and the resize handler below both put the knob straight under the
    // current tab, and on a soft navigation fonts.ready resolves at once —
    // which used to plant the knob at its destination before the move had
    // begun, so the move ran backwards from there.
    var moving = false;

    function flowTo(fromTab, toTab, fromBox) {
      var a = fromBox || measure(fromTab);
      var b = measure(toTab);
      var x = Math.min(a.x, b.x);
      var right = Math.max(a.x + a.w, b.x + b.w);
      slider.classList.add("is-stretching");
      slider.style.width = (right - x) + "px";
      slider.style.height = b.h + "px";
      slider.style.transform = "translate3d(" + x + "px, " + b.y + "px, 0)";
      setTimeout(function () {
        slider.classList.remove("is-stretching");
        slider.classList.add("is-snapping");
        fromTab.classList.remove("is-leaving");
        place(toTab, true);
        setTimeout(function () {
          slider.classList.remove("is-snapping");
          moving = false;
          // Anything that changed under it while it was on its way.
          place(current(), false);
        }, SNAP);
      }, STRETCH);
    }

    var landed = current();
    var cameFrom = from ? tabFor(from.href) : null;

    if (cameFrom && landed && cameFrom !== landed) {
      // Put it where it was, let that paint, then move it. Two frames: one
      // to commit the starting position, one for the transition to have
      // something to start from. In the dock "where it was" is the spot on
      // the screen the last page left it at — the tab it sat under has
      // since lost its name and moved (see rememberTab).
      var wasBox = null;
      if (isDock && from.left !== null && from.width) {
        var barBox = bar.getBoundingClientRect();
        var style = window.getComputedStyle(bar);
        var to = measure(landed);
        wasBox = {
          x: from.left - barBox.left - (parseFloat(style.borderLeftWidth) || 0) + bar.scrollLeft,
          y: to.y,
          w: from.width,
          h: to.h
        };
      }
      if (wasBox) placeBox(wasBox, false); else place(cameFrom, false);
      // In the dock the tab being left keeps the pill's white ink while the
      // pill is still under it, and greys as the pill lets go (flowTo).
      // Set before the first paint, so it is white from the start rather
      // than fading up from grey.
      if (isDock) cameFrom.classList.add("is-leaving");
      moving = true;
      // The tab the knob is about to land on: its icon and name arrive with
      // the knob (§4). Only now — a page that opens with the knob already
      // in place does not replay an arrival.
      landed.classList.add("is-arriving");
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          if (isDock) {
            flowTo(cameFrom, landed, wasBox);
            return;
          }
          place(landed, true);
          // A segmented control's knob slides, and stretches a little along
          // its travel as it goes — the give the switch's knob has under a
          // finger — rounding out again as it lands.
          slider.classList.add("is-moving");
          setTimeout(function () { slider.classList.remove("is-moving"); }, 210);
          setTimeout(function () { moving = false; place(current(), false); }, SLIDE);
        });
      });
    } else {
      place(landed, false);
    }

    bar.addEventListener("click", function (event) {
      var tab = event.target.closest ? event.target.closest(".tab") : null;
      if (!tab || !bar.contains(tab)) return;
      if (tab.classList.contains("is-active")) {
        // Tapping the tab you are on, in the dock, does what a phone's does:
        // from somewhere inside that tab it goes back to the tab's own first
        // screen (an ordinary navigation, left to the link), and from that
        // screen it scrolls back to the top rather than reloading it.
        if (isDock && tab.pathname === location.pathname) {
          event.preventDefault();
          try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { window.scrollTo(0, 0); }
        }
        return;
      }
      // Nothing moves here. Where the capsule is now is the whole message
      // the next page needs.
      var here = current();
      if (here) rememberTab(here.href, slider.classList.contains("is-on") ? slider.getBoundingClientRect() : null);
    });

    // A width change is not a selection change, so it must not look like one.
    var settle = null;
    listen(window, "resize", function () {
      clearTimeout(settle);
      settle = setTimeout(function () { if (!moving) place(current(), false); }, 120);
    });

    // Fonts land after first paint and can change a tab's width underneath
    // the capsule. Unless the page has gone by then — or the knob is on its
    // way, in which case it re-measures itself when it lands.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        if (bar.isConnected && !moving) place(current(), false);
      });
    }

    // Coming back to a page the browser kept alive: re-measure, don't animate.
    listen(window, "pageshow", function (event) {
      if (event.persisted) place(current(), false);
    });
  }

  /* ----------------------------------------------------------------------
     The tab bar gets out of the way

     An iPhone's tab bar folds to its icons while you scroll down a long page
     and is whole again the moment you scroll up. The bar has the two sizes
     (§4b in the stylesheet); this decides which, from the direction of
     travel — not the position, because what matters is what you are doing,
     and a page you are reading downwards is a page you want more of.

     A little give in both directions, so a finger that wobbles while it
     scrolls does not flicker the bar, and the top of the page always has
     the whole bar, because there is nothing above it to be reading.
     ---------------------------------------------------------------------- */
  function initTabBarFold() {
    var bar = document.querySelector(".tabbar");
    if (!bar) return;

    // How far down since the last turn before the bar folds; how far back up
    // before it unfolds. Both are a real movement rather than a wobble, so a
    // thumb that drifts while it scrolls cannot flutter the bar; down is the
    // longer of the two, because folding is a favour to reading and can
    // wait, while unfolding is a reach for the bar and cannot.
    var FOLD_AFTER = 64;
    var UNFOLD_AFTER = 24;
    // A page with less than this to scroll never folds: there is nothing to
    // get out of the way of, and a bar that folds and unfolds over three
    // lines of movement is a bar that twitches.
    var ROOM = 160;

    var last = window.scrollY;
    var turn = last;        // where the direction last changed
    var goingDown = false;
    var folded = false;
    var queued = false;

    function set(fold) {
      if (fold === folded) return;
      folded = fold;
      bar.classList.toggle("is-min", fold);
    }

    function measure() {
      queued = false;
      // Clamped: iOS lets the page overshoot both ends, and a bounce is not
      // a direction.
      var max = document.documentElement.scrollHeight - window.innerHeight;
      if (max < ROOM) { set(false); return; }
      var y = Math.max(0, Math.min(window.scrollY, max));
      if (y === last) return;

      var down = y > last;
      if (down !== goingDown) {
        goingDown = down;
        turn = last;
      }
      last = y;

      if (y <= 8) set(false);
      else if (down && y - turn > FOLD_AFTER) set(true);
      else if (!down && turn - y > UNFOLD_AFTER) set(false);
    }

    // One decision per frame, however many scroll events a flick sends.
    listen(window, "scroll", function () {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(measure);
    }, { passive: true });
  }

  /* ----------------------------------------------------------------------
     Soft navigation — the next page arrives instead of the site reloading

     Every screen is rendered by the server, and until now every tap on a
     link was a full page load: the browser tore the document down, fetched
     the next one, parsed the stylesheet again, ran this file again and
     painted from nothing. On a phone that is a blank quarter-second at best,
     and on mobile data it is the gap the skeleton above stands in.

     Now a tap fetches the next page's HTML and swaps its <body> in for this
     one. Same document, same stylesheet, nothing re-parsed but the page
     itself — and the address bar, the title and the back button all still
     mean what they say: pushState records the move, popstate reverses it,
     and a page you step back to is drawn again from the copy already fetched.

     Two things make it feel instant rather than merely quick. The fetch
     starts when a finger lands on a link, not when it lifts — the hundred
     milliseconds between touchstart and click is most of a round trip on a
     decent connection — and on a mouse it starts on hover. And a page
     fetched in the last minute is not fetched again.

     Progressive enhancement throughout. Anything the browser would not treat
     as a plain same-site navigation is left to it — modified clicks, new
     tabs, downloads, other origins, forms — and so is anything the response
     turns out not to be: a file, an error, or a page built for different
     stylesheets or scripts than this one (a deploy has landed, and only a
     real load picks that up). Two attributes let a template opt a link out:

       data-full-load   a real navigation, always. For a link that redirects
                        to an anchor, which fetch cannot see.
       data-no-cache    never prefetched and never served from the cache.
                        For a page whose GET does something — the inbox
                        marks itself read.

     Scripts in the fetched page are not run. Nothing here needs any beyond
     the two base.html loads, and the page's own initialisers are run again
     by hand (initPage); notifications.js hears about it as mywork:page.
     ---------------------------------------------------------------------- */
  function initSoftNav() {
    // Which way the page being fetched should come in — see the click
    // handler below. Reset to "forward" once a page has used it.
    var arrive = "forward";

    var supported = !!(window.fetch && window.DOMParser && window.Promise &&
      window.history.pushState && window.URL && "isConnected" in document.body);

    // How long a fetched page may stand in for itself: when tapped, and
    // when stepped back to. The second is longer because back means "what
    // I was just looking at", not "what is there now" — the same bargain a
    // browser's own back-forward cache makes.
    var FRESH = 60 * 1000;
    var KEEP = 5 * 60 * 1000;
    // Hover intent before a mouse prefetches; how long a finger must stay
    // still before it counts as a tap rather than the start of a scroll.
    var HOVER = 65;
    var TOUCH = 80;
    var MAX_CACHE = 20;

    // Paths that are never ours to render: other software's pages, files.
    var NOT_A_PAGE = /^\/(admin|static|media)\/|^\/sw\.js$/;

    var cache = {};      // url (no hash) -> { promise, html, url, redirected, at }
    var scrolls = {};    // path+search -> scrollY when last left
    var active = null;   // the navigation being awaited, if any

    /* A step back or forward can mean three things; told apart here so the
       page's own handlers only ever see their own. */
    window.addEventListener("popstate", function (event) {
      var state = event.state;
      // A filter changing within the page it belongs to — that page's
      // business, if it is still on screen to deal with it.
      if (state && state.liveFilter && historyOwners.length &&
          location.pathname === shown.pathname) {
        historyOwners.slice().forEach(function (fn) { fn(); });
        noteAddress();
        return;
      }
      // An anchor within the page only moves the scroll; hashchange has it.
      if (location.pathname + location.search === shown.key) return;
      if (!supported) return;
      go(location.href, KEEP, "pop");
    });

    if (!supported) return;

    // Scroll is put back by hand on popstate (below), after the right page is
    // on screen. Left to the browser it would happen first, on the wrong one.
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    keepScrollAcrossReload();

    // ---- which links -------------------------------------------------------

    function isPage(link) {
      var href = link.getAttribute("href") || "";
      if (!href || href.charAt(0) === "#") return false;
      if (link.hasAttribute("download") || link.hasAttribute("data-full-load")) return false;
      if (link.target && link.target !== "_self") return false;
      if (link.origin !== location.origin) return false;
      if (NOT_A_PAGE.test(link.pathname)) return false;
      // An anchor on this page is a scroll, not a navigation.
      if (link.hash && link.pathname === location.pathname &&
          link.search === location.search) return false;
      return true;
    }

    function linkIn(event) {
      var link = event.target.closest ? event.target.closest("a[href]") : null;
      return link && isPage(link) ? link : null;
    }

    function split(href) {
      var cut = href.indexOf("#");
      return cut < 0 ? [href, ""] : [href.slice(0, cut), href.slice(cut)];
    }

    // ---- fetching ----------------------------------------------------------

    function fetchPage(url) {
      var entry = { at: Date.now(), html: null, url: url, redirected: false };
      entry.promise = fetch(url, {
        credentials: "same-origin",
        headers: { Accept: "text/html" },
      })
        .then(function (response) {
          var type = response.headers.get("Content-Type") || "";
          var landed = new URL(response.url || url, location.href);
          // Not a page of ours to draw: an error, a file, somewhere else.
          if (!response.ok || type.indexOf("text/html") < 0 ||
              landed.origin !== location.origin) {
            throw new Error("not a page");
          }
          return response.text().then(function (html) {
            entry.html = html;
            entry.url = split(landed.href)[0];
            entry.redirected = response.redirected;
            entry.at = Date.now();
            return entry;
          });
        })
        .catch(function (error) {
          if (cache[url] === entry) delete cache[url];
          throw error;
        });
      cache[url] = entry;
      prune();
      return entry.promise;
    }

    /* The page at `url`: from the cache if it is younger than `maxAge`, or
       already on its way, otherwise fetched now. */
    function pageAt(url, maxAge) {
      var hit = cache[url];
      if (hit && (hit.html === null || Date.now() - hit.at < maxAge)) return hit.promise;
      return fetchPage(url);
    }

    function prune() {
      var keys = Object.keys(cache);
      if (keys.length <= MAX_CACHE) return;
      keys.sort(function (a, b) { return cache[a].at - cache[b].at; });
      delete cache[keys[0]];
    }

    function prefetch(link) {
      if (!isPage(link) || link.hasAttribute("data-no-cache")) return;
      // Someone who has asked for less data gets exactly what they tap on.
      if (navigator.connection && navigator.connection.saveData) return;
      var url = split(link.href)[0];
      if (url === split(location.href)[0]) return;
      var hit = cache[url];
      if (hit && (hit.html === null || Date.now() - hit.at < FRESH)) return;
      fetchPage(url).catch(function () { /* the tap, if it comes, will try again */ });
    }

    // ---- rendering ---------------------------------------------------------

    /* The stylesheet and scripts a page was built for. */
    function assets(root) {
      var urls = [];
      root.querySelectorAll('link[rel="stylesheet"][href], script[src]').forEach(function (el) {
        urls.push(el.getAttribute("href") || el.getAttribute("src"));
      });
      return urls.sort().join(" ");
    }

    function copyMeta(doc, name) {
      var from = doc.querySelector('meta[name="' + name + '"]');
      var to = document.querySelector('meta[name="' + name + '"]');
      if (from && to) to.setAttribute("content", from.getAttribute("content") || "");
    }

    /* scrollTo without the smooth scrolling the stylesheet asks for: a new
       page starts at the top, it does not glide there. Asked for outright,
       because an inline scroll-behavior on <html> is not enough — Chrome's
       window.scrollTo still reads the stylesheet's. Setting scrollTop does
       honour the inline value, so that is the fallback for a browser that
       does not know "instant". */
    function jumpTo(y) {
      try {
        window.scrollTo({ top: y, left: 0, behavior: "instant" });
      } catch (e) {
        var root = document.scrollingElement || document.documentElement;
        var was = root.style.scrollBehavior;
        root.style.scrollBehavior = "auto";
        root.scrollTop = y;
        root.style.scrollBehavior = was;
      }
    }

    /* Where the keyboard and a screen reader are after the swap. A real load
       starts them at the top of the new page; a swap would leave them on
       nothing, so the page itself is given focus — or its autofocus field. */
    function settleFocus() {
      var main = document.querySelector("main.container");
      var target = document.querySelector("[autofocus]") || main;
      if (!target) return;
      if (target === main) main.setAttribute("tabindex", "-1");
      try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    }

    /* Put a fetched page on screen. False means "not something to draw
       here" and the caller lets the browser make the trip instead. */
    function render(entry, hash, mode) {
      var doc = new DOMParser().parseFromString(entry.html, "text/html");
      if (!doc.body || !doc.querySelector("main.container")) return false;
      // Built for other CSS or JS than this document has: a deploy landed
      // between then and now, and only a real load picks that up.
      if (assets(doc) !== assets(document)) return false;

      leavePage();
      pageSkeleton.reset();

      document.title = doc.title;
      copyMeta(doc, "unread-count");
      // Adopted rather than re-parsed from a string, and its scripts have
      // already "started" as far as the browser is concerned: they do not run.
      document.documentElement.replaceChild(document.adoptNode(doc.body), document.body);
      document.body.setAttribute("data-arrive", mode === "pop" ? "back" : arrive);
      arrive = "forward";
      // The page's height has to be final before a scroll position goes back.
      markBack();

      // A redirect went somewhere else; the anchor was for where we asked.
      if (entry.redirected) hash = "";
      if (mode === "push") {
        history.pushState({ soft: true }, "", entry.url + hash);
      } else if (mode === "pop" && entry.url !== split(location.href)[0]) {
        // The entry keeps its anchor; a redirect only corrects its address.
        history.replaceState(history.state, "", entry.url + location.hash);
      }
      noteAddress();

      if (mode === "pop") jumpTo(scrolls[shown.key] || 0);
      else if (location.hash) window.requestAnimationFrame(landOnHash);
      else jumpTo(0);

      initPage();
      settleFocus();
      return true;
    }

    function handOver(href) {
      window.location.href = href;
    }

    /* Go to `href`: the navigation proper. */
    function go(href, maxAge, mode) {
      var parts = split(href);
      var job = {};
      active = job;

      // Where this page was left, for when it is stepped back to.
      scrolls[shown.key] = window.scrollY;
      pageSkeleton.arm(href);

      pageAt(parts[0], maxAge).then(function (entry) {
        if (active !== job) return;   // a later tap took over
        active = null;
        if (!render(entry, parts[1], mode)) handOver(href);
      }, function () {
        if (active !== job) return;
        active = null;
        handOver(href);
      });
    }

    // ---- the tap -----------------------------------------------------------

    document.addEventListener("click", function (event) {
      // Anything the browser would not treat as a plain navigation is not
      // one: new tabs, modified clicks, and anything already handled — the
      // compose button, the filter chips.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var link = linkIn(event);
      if (!link) return;

      // How the next page should come in (§20): a tab or a segment is a
      // sideways move between equals and cross-fades; a back link pops;
      // anything else pushes in from the right, the way a phone's screens
      // stack. The stylesheet reads it off <body> once the page has landed.
      arrive = link.closest(".tabbar, .segments, .appbar__nav") ? "tab"
        : link.closest(".backlink, .appbar__back") ? "back"
        : "forward";

      event.preventDefault();
      go(link.href, link.hasAttribute("data-no-cache") ? 0 : FRESH, "push");
    });

    // ---- the moment before the tap -----------------------------------------

    var hoverLink = null;
    var hoverTimer = null;
    document.addEventListener("mouseover", function (event) {
      var link = event.target.closest ? event.target.closest("a[href]") : null;
      if (!link || link === hoverLink) return;
      clearTimeout(hoverTimer);
      hoverLink = link;
      hoverTimer = setTimeout(function () { prefetch(link); }, HOVER);
    });
    document.addEventListener("mouseout", function (event) {
      if (!hoverLink || !hoverLink.contains(event.target)) return;
      // Moving between the link's own children is not leaving it.
      if (event.relatedTarget && hoverLink.contains(event.relatedTarget)) return;
      clearTimeout(hoverTimer);
      hoverLink = null;
    });

    // A mouse button going down is a decision made.
    document.addEventListener("mousedown", function (event) {
      if (event.button !== 0) return;
      var link = event.target.closest ? event.target.closest("a[href]") : null;
      if (link) prefetch(link);
    });

    // A finger landing might be a tap or the start of a scroll. One that
    // has not moved after a moment is a tap; one that moves is not.
    var touchTimer = null;
    document.addEventListener("touchstart", function (event) {
      clearTimeout(touchTimer);
      var link = event.target.closest ? event.target.closest("a[href]") : null;
      if (!link) return;
      touchTimer = setTimeout(function () { prefetch(link); }, TOUCH);
    }, { passive: true });
    document.addEventListener("touchmove", function () {
      clearTimeout(touchTimer);
    }, { passive: true });

    // ---- reloads -----------------------------------------------------------

    /* With scroll restoration set to manual, a reload — or arriving back at
       this document from another one, when the browser did not keep it —
       would start at the top. Write the position down on the way out and
       put it back on the way in, for exactly those two arrivals. */
    function keepScrollAcrossReload() {
      var KEY = "mywork-scroll";

      window.addEventListener("pagehide", function () {
        try {
          sessionStorage.setItem(KEY, location.href + " " + window.scrollY);
        } catch (e) { /* private browsing: a reload starts at the top */ }
      });

      var raw = null;
      try {
        raw = sessionStorage.getItem(KEY);
        sessionStorage.removeItem(KEY);
      } catch (e) { return; }
      if (!raw) return;

      var cut = raw.lastIndexOf(" ");
      if (raw.slice(0, cut) !== location.href) return;

      var arrival = performance.getEntriesByType &&
        performance.getEntriesByType("navigation")[0];
      if (!arrival || (arrival.type !== "reload" && arrival.type !== "back_forward")) return;
      jumpTo(Number(raw.slice(cut + 1)) || 0);
    }
  }

  /* ----------------------------------------------------------------------
     Start-up
     Once for the document, then once for every page it shows. Soft
     navigation goes first: its click handler must have cancelled a tap
     before the skeleton's sees it, and listeners fire in the order they
     were added.
     ---------------------------------------------------------------------- */
  function initOnce() {
    // Before soft navigation: these two catch a tap on a link — Edit, a
    // tally — and handle it in the card, and soft navigation must find the
    // tap already taken rather than follow the link.
    initReactorsSheet();
    initEditing();
    initSoftNav();
    initArrival();
    initReactions();
    initCommentBoxes();
    initAppMenu();
    initRipple();
    initNavSkeleton();
  }

  function initPage() {
    initTheme();
    initAppBar();
    initCompose();
    initModals();
    initComposeModal();
    initTally();
    initPeriodFields();
    initPayslipFill();
    initPayForms();
    initStatementForm();
    initCashFields();
    initLiveClock();
    initClientClock();
    initBreakRows();
    initStickyBar();
    initLiveSearch();
    initPlaceholderTyper();
    initCopy();
    initPhotoPicker();
    initAvatarPicker();
    initCsvPicker();
    initSubmitState();
    initLiveFilter();
    initTabSlider();
    initTabBarFold();
    initLiveErrors();

    // For anything outside this file with a page to set up — notifications.js
    // has the switch on the inbox and the number on the icon.
    if (typeof CustomEvent === "function") {
      document.dispatchEvent(new CustomEvent("mywork:page"));
    }
  }

  function init() {
    markBack();
    initOnce();
    initPage();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
