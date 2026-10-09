const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runInNewContext } = require('node:vm');
const source = readFileSync(resolve(__dirname, '../../static/js/theme.js'), 'utf8');
function load({ saved, dark = false, storageFails = false } = {}) {
  let selected, stored = saved, color, changes = 0;
  const system = { matches: dark, addEventListener: (_, callback) => { system.change = callback; } };
  const window = { matchMedia: () => system, dispatchEvent: () => { changes++; } };
  const document = {
    documentElement: { getAttribute: () => selected, setAttribute: (_, value) => { selected = value; } },
    querySelector: () => ({ setAttribute: (_, value) => { color = value; } }),
  };
  const localStorage = {
    getItem: () => { if (storageFails) throw Error('storage disabled'); return stored; },
    setItem: (_, value) => { if (storageFails) throw Error('storage disabled'); stored = value; },
  };
  runInNewContext(source, { window, document, localStorage, Event: class Event {} });
  return { theme: window.MyWorkTheme, system, stored: () => stored, color: () => color, changes: () => changes };
}
test('saved theme overrides the system and survives another page load', () => {
  const page = load({ saved: 'light', dark: true });
  assert.equal(page.theme.isDark(), false);
  page.theme.toggle();
  assert.equal(page.stored(), 'dark');
  assert.equal(page.color(), '#101b14');
  assert.equal(load({ saved: page.stored() }).theme.isDark(), true);
});
test('system appearance updates browser chrome until the user makes a choice', () => {
  const page = load();
  assert.equal(page.color(), '#f3f6f2');
  page.system.matches = true;
  page.system.change();
  assert.equal(page.theme.isDark(), true);
  assert.equal(page.color(), '#101b14');
  page.theme.toggle();
  page.system.change();
  assert.equal(page.theme.isDark(), false);
});
test('appearance still changes when browser storage is unavailable', () => {
  const page = load({ storageFails: true });
  page.theme.toggle();
  assert.equal(page.theme.isDark(), true);
  assert.equal(page.color(), '#101b14');
  assert.equal(page.changes(), 2);
});
