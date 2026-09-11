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
      // than transitioning every colour on every element. Where it cannot
      // (or motion is reduced), the switch is simply the switch.
      var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (document.startViewTransition && !still) {
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

  function skeletonPage() {
    return (
      '<div class="skeleton-page">' +
      '<div class="skeleton-page__head">' +
      '<span class="skeleton skeleton--title skeleton--w55"></span>' +
      '<span class="skeleton skeleton--line skeleton--w70"></span>' +
      "</div>" +
      '<div class="skeleton-tiles">' +
      '<span class="skeleton skeleton--tile"></span>' +
      '<span class="skeleton skeleton--tile"></span>' +
      "</div>" +
      skeletonCard() +
      skeletonRows(3, "skeleton--circle") +
      "</div>"
    );
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
      resultsEl.innerHTML = html;

      var shown = data.results.length;
      var meta = shown + (shown === 1 ? " result" : " results");
      if (data.truncated) {
        meta = "Top " + shown + " of " + data.total + " &mdash; keep typing to narrow it down";
      }
      setMeta(meta);
    }

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
      lastRendered = "";
    }

    function run(query) {
      if (query === lastRendered) return;

      if (!query) {
        if (inFlight) { inFlight.abort(); inFlight = null; }
        if (bar) bar.classList.remove("is-busy");
        showIdle();
        syncUrl("");
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

      fetch(endpoint + "?q=" + encodeURIComponent(query), {
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
          renderResults(query, data);
          syncUrl(query);
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
    function syncUrl(query) {
      if (!window.history || !window.history.replaceState) return;
      var url = window.location.pathname + (query ? "?q=" + encodeURIComponent(query) : "");
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
    var overlay = document.getElementById("photo-overlay");

    var isMobile = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent || "");
    if (label) label.textContent = isMobile ? "Take a photo" : "Choose a photo";

    // Only phones get the rear camera; on desktop `capture` just gets in the way.
    if (isMobile) input.setAttribute("capture", "environment");
    else input.removeAttribute("capture");

    var objectUrl = null;

    function showFile(file) {
      if (!file) return;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
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

    if (form) {
      form.addEventListener("submit", function () {
        if (!form.checkValidity()) return;
        if (overlay) overlay.hidden = false;
        if (submit) {
          submit.disabled = true;
          submit.textContent = "Reading…";
        }
      });
    }
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
     upload already covers the screen with its own OCR overlay. The CSV import
     form is left in, because that upload is the slowest thing in the app.
     ---------------------------------------------------------------------- */
  var NO_BUSY = { "plu-search-form": 1, "photo-form": 1 };

  function initSubmitState() {
    document.querySelectorAll("form").forEach(function (form) {
      if (form.id && NO_BUSY[form.id]) return;

      form.addEventListener("submit", function () {
        // A form that failed validation never leaves the page; the browser
        // blocks submit before this fires, so the button is safe to lock.
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
     Cycle start — show the one that applies
     A workplace carries a start for all three periods, but only the period
     its limit uses is worth asking about. The others stay in the form (and
     keep submitting their values), just out of the way.
     ---------------------------------------------------------------------- */
  function initPeriodFields() {
    var period = document.getElementById("id_limit_period");
    if (!period) return;

    var fields = {
      WEEK: document.getElementById("id_week_starts_on"),
      FORTNIGHT: document.getElementById("id_fortnight_anchor"),
      MONTH: document.getElementById("id_month_starts_on")
    };

    var rows = {};
    Object.keys(fields).forEach(function (key) {
      if (fields[key]) rows[key] = fields[key].closest(".field");
    });
    if (!Object.keys(rows).length) return;

    function sync() {
      Object.keys(rows).forEach(function (key) {
        rows[key].hidden = key !== period.value;
      });
    }

    period.addEventListener("change", sync);
    sync();
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
  function initComposeModal() {
    var modal = document.getElementById("compose-modal");
    if (!modal || typeof modal.showModal !== "function") return;

    function open(event) {
      if (event) event.preventDefault();
      modal.classList.remove("is-closing");
      modal.showModal();
      var box = modal.querySelector("textarea");
      if (box) box.focus();
    }

    function close() {
      // Let the box travel back out before the dialog is taken away.
      modal.classList.add("is-closing");
      setTimeout(function () {
        modal.classList.remove("is-closing");
        modal.close();
      }, 160);
    }

    document.querySelectorAll("[data-compose]").forEach(function (trigger) {
      trigger.addEventListener("click", open);
    });

    modal.querySelectorAll("[data-close]").forEach(function (btn) {
      btn.addEventListener("click", close);
    });

    // Clicking the backdrop lands on the dialog itself, never on its box.
    modal.addEventListener("click", function (event) {
      if (event.target === modal) close();
    });

    // Escape closes the dialog itself; intercept so it animates out too.
    modal.addEventListener("cancel", function (event) {
      event.preventDefault();
      close();
    });

    // A rejected post comes back with the box marked open, so the writer
    // sees the error where they typed rather than on an empty board.
    if (modal.hasAttribute("data-open")) open();
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
     Reaction picker
     The row of faces is a <details>, so it opens without script. This only
     closes the one you left open when you move on.
     ---------------------------------------------------------------------- */
  function initReactions() {
    function pickers() {
      return document.querySelectorAll("details.react");
    }

    document.addEventListener("click", function (event) {
      pickers().forEach(function (picker) {
        if (picker.open && !picker.contains(event.target)) picker.open = false;
      });
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      pickers().forEach(function (picker) { picker.open = false; });
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
      // Kept inside the card it belongs to, which is always inside the
      // screen — innerWidth is not to be trusted on a phone mid-zoom.
      var card = details.closest(".notice") || document.querySelector("main.container");
      var edge = card ? card.getBoundingClientRect().right - 8 : window.innerWidth - 12;
      var box = picker.getBoundingClientRect();
      var over = box.right - edge;
      if (over > 0) picker.style.setProperty("--shift", Math.min(over, box.left - 12) + "px");
    }, true);
  }

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

    function show() {
      if (parked) return;
      host = document.querySelector("main.container");
      if (!host) return;
      parked = document.createDocumentFragment();
      while (host.firstChild) parked.appendChild(host.firstChild);
      host.innerHTML = skeletonPage();
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

    /* Start waiting. The skeleton appears only if the wait turns out long. */
    function arm() {
      clearTimeout(timer);
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

      pageSkeleton.arm();
    });

    document.addEventListener("submit", function (event) {
      // The live search and the compose dialog handle their own submits, and
      // a delete form whose confirm() was declined never leaves the page —
      // all of them have cancelled the event by the time it reaches here.
      if (event.defaultPrevented) return;
      var form = event.target;
      if (form.getAttribute && form.getAttribute("target")) return;
      pageSkeleton.arm();
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
      pageSkeleton.arm();

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
    initComposeModal();
    initTally();
    initPeriodFields();
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
