/* MyWork — progressive enhancement.
   Everything here is optional: each page works fully with JS disabled, and
   these handlers only bind when the elements they need are actually present. */
(function () {
  "use strict";

  /* ----------------------------------------------------------------------
     Theme toggle
     The initial value is applied by an inline script in <head> so there's no
     flash of the wrong palette; this only handles the button.
     ---------------------------------------------------------------------- */
  function initTheme() {
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;

    btn.addEventListener("click", function () {
      var root = document.documentElement;
      var systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      var current = root.getAttribute("data-theme") || (systemDark ? "dark" : "light");
      var next = current === "dark" ? "light" : "dark";

      root.setAttribute("data-theme", next);
      try { localStorage.setItem("mywork-theme", next); } catch (e) { /* private mode */ }

      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", next === "dark" ? "#0b1120" : "#f4f5f7");
    });
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

    new IntersectionObserver(function (entries) {
      bar.classList.toggle("is-stuck", !entries[0].isIntersecting);
    }).observe(sentinel);
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
      reduced.addEventListener("change", function (e) {
        if (e.matches) pause();
      });
    }
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
    var timer = setInterval(paint, 1000);

    // A phone that's been asleep comes back with a stale face; repaint the
    // moment it's visible again rather than waiting for the next tick.
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) paint();
    });
    window.addEventListener("pagehide", function () { clearInterval(timer); });
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
  function initAppMenu() {
    var menu = document.getElementById("app-switcher");
    if (!menu) return;

    document.addEventListener("click", function (event) {
      if (!menu.open) return;
      if (menu.contains(event.target)) return;
      menu.open = false;
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !menu.open) return;
      menu.open = false;
      var btn = menu.querySelector("summary");
      if (btn) btn.focus();
    });

    // Navigating away leaves the panel open behind the new page in bfcache.
    menu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () { menu.open = false; });
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

  function initTally() {
    var els = document.querySelectorAll("[data-tally]");
    if (!els.length) return;

    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    els.forEach(function (el) {
      var target = parseFloat(el.getAttribute("data-tally"));
      if (isNaN(target)) return;

      var render = TALLY_FORMATS[el.getAttribute("data-tally-format")] || TALLY_FORMATS.hm;
      if (reduced || target <= 0) {
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
    var pickers = document.querySelectorAll("details.react");
    if (!pickers.length) return;

    document.addEventListener("click", function (event) {
      pickers.forEach(function (picker) {
        if (picker.open && !picker.contains(event.target)) picker.open = false;
      });
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      pickers.forEach(function (picker) { picker.open = false; });
    });
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

  function init() {
    initTheme();
    initCompose();
    initComposeModal();
    initReactions();
    initCommentBoxes();
    initAppMenu();
    initTally();
    initPeriodFields();
    initLiveClock();
    initClientClock();
    initBreakRows();
    initStickyBar();
    initLiveSearch();
    initPlaceholderTyper();
    initCopy();
    initPhotoPicker();
    initCsvPicker();
    initRipple();
    initSubmitState();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
