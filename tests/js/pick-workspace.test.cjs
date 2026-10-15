const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('static/js/pick-workspace.js', 'utf8');
let moduleId = 0;
function target(extra = {}) {
  return Object.assign({ handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; },
    removeEventListener(type) { delete this.handlers[type]; } }, extra);
}
async function fixture(reduced = false, loaded = true) {
  let contexts = 0, reverted = 0, script;
  const preference = target({ matches: reduced });
  const link = target({ dataset: { pickOpen: 'panel' } });
  const panel = target({ open: false, querySelector() { return {}; } });
  const root = { dataset: { gsapUrl: '/static/vendor/gsap/gsap.min.js' }, contains: node => node === panel,
    querySelectorAll(selector) {
      if (selector === '[data-pick-open]') return [link];
      if (selector.startsWith('.pick-tool')) return [panel];
      return [];
    } };
  const gsap = { context(fn) { contexts++; fn(); return { add: fn => fn(), revert() { reverted++; } }; }, fromTo() {}, killTweensOf() {} };
  global.window = { matchMedia: () => preference, gsap: loaded ? gsap : null };
  global.document = { getElementById: () => panel, createElement: () => ({ remove() {} }), head: { appendChild(value) { script = value; } } };
  const module = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64') + '#' + moduleId++);
  const cleanup = module.mountPickWorkspace(root);
  await new Promise(resolve => setImmediate(resolve));
  return { link, panel, preference, cleanup, gsap, script, contexts: () => contexts, reverted: () => reverted };
}

test('reduced motion retains disclosure shortcuts without loading animation', async () => {
  const f = await fixture(true, false);
  assert.equal(f.script, undefined);
  assert.equal(f.contexts(), 0);
  f.link.handlers.click();
  assert.equal(f.panel.open, true);
  f.cleanup();
  assert.equal(f.link.handlers.click, undefined);
});

test('preference change and page disposal revert animations and remove listeners', async () => {
  const f = await fixture();
  assert.equal(f.contexts(), 1);
  f.preference.matches = true;
  f.preference.handlers.change();
  assert.equal(f.reverted(), 1);
  f.preference.matches = false;
  f.preference.handlers.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.contexts(), 2);
  f.cleanup();
  assert.equal(f.reverted(), 2);
  assert.equal(f.preference.handlers.change, undefined);
  assert.equal(f.panel.handlers.toggle, undefined);
});

test('animation loading after navigation does not mount on the discarded page', async () => {
  const f = await fixture(false, false);
  assert.ok(f.script);
  f.cleanup();
  global.window.gsap = f.gsap;
  f.script.onload();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.contexts(), 0);
});

test('animation load failure leaves the create-list shortcut usable', async () => {
  const f = await fixture(false, false);
  f.script.onerror();
  await new Promise(resolve => setImmediate(resolve));
  f.link.handlers.click();
  assert.equal(f.panel.open, true);
  assert.equal(f.contexts(), 0);
  f.cleanup();
});
