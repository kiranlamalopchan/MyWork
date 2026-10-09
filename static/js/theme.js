/* One source for the saved palette, system preference and browser chrome. */
(function () {
  "use strict";
  var root = document.documentElement;
  var system = window.matchMedia("(prefers-color-scheme: dark)");
  var key = "mywork-theme";
  try {
    var saved = localStorage.getItem(key);
    if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
  } catch (e) { /* Storage disabled: follow the system until a choice is made. */ }

  function isDark() {
    var chosen = root.getAttribute("data-theme");
    return chosen ? chosen === "dark" : system.matches;
  }
  function announce() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", isDark() ? "#101b14" : "#f3f6f2");
    window.dispatchEvent(new Event("mywork:theme"));
  }
  window.MyWorkTheme = {
    isDark: isDark,
    toggle: function () {
      var next = isDark() ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem(key, next); } catch (e) { /* The session choice still works. */ }
      announce();
    },
  };
  if (system.addEventListener) system.addEventListener("change", announce);
  announce();
})();
