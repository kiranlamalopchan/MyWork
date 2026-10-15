/* Progressive picking UI: native forms/details work before GSAP arrives. */
let gsapReady;
function loadGsap(url) {
  if (window.gsap) return Promise.resolve(window.gsap);
  if (!gsapReady) {
    gsapReady = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.onload = () => window.gsap ? resolve(window.gsap) : reject(new Error("Animation unavailable"));
      script.onerror = () => { gsapReady = null; script.remove(); reject(new Error("Animation unavailable")); };
      document.head.appendChild(script);
    });
  }
  return gsapReady;
}

export function mountPickWorkspace(root) {
  let disposed = false;
  let context = null;
  let gsap = null;
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const listeners = [];
  function on(target, type, handler) {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  }
  root.querySelectorAll("[data-pick-open]").forEach(link => {
    on(link, "click", () => {
      const target = document.getElementById(link.dataset.pickOpen);
      if (target && root.contains(target)) target.open = true;
    });
  });
  root.querySelectorAll(".pick-tool, .warehouse-confirm, .pick-completed").forEach(details => {
    on(details, "toggle", () => {
      if (!details.open || !context || preference.matches) return;
      const body = details.querySelector(".pick-tool-body, .pick-scan-body, .pick-completed-body");
      if (!body) return;
      context.add(() => {
        gsap.killTweensOf(body);
        gsap.fromTo(body, { opacity: .35, y: 5 }, { opacity: 1, y: 0, duration: .23, ease: "power2.out", clearProps: "opacity,transform" });
      });
    });
  });
  async function animate() {
    if (preference.matches || disposed) return;
    try {
      gsap = await loadGsap(root.dataset.gsapUrl);
      if (disposed || preference.matches || context) return;
      context = gsap.context(() => {
        const entries = Array.from(root.querySelectorAll("[data-pick-enter], [data-pick-card]")).filter(node => node.getClientRects().length).slice(0, 10);
        if (entries.length) gsap.fromTo(entries, { opacity: .35, y: 9 }, { opacity: 1, y: 0, duration: .4, stagger: .035, ease: "power2.out", clearProps: "opacity,transform" });
        root.querySelectorAll("[data-pick-progress]").forEach(bar => {
          gsap.fromTo(bar, { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, duration: .65, ease: "power2.out", clearProps: "transform,transformOrigin" });
        });
      }, root);
    } catch (error) { /* Content and every control remain available without animation. */ }
  }
  on(preference, "change", () => {
    if (preference.matches && context) { context.revert(); context = null; }
    else animate();
  });
  animate();
  return () => {
    disposed = true;
    listeners.forEach(remove => remove());
    if (context) { context.revert(); context = null; }
  };
}
