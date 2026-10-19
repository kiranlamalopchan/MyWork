const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runInNewContext } = require('node:vm');
const palette = JSON.parse(readFileSync(resolve(__dirname, '../../design/tokens/palette.json'), 'utf8'));
const source = readFileSync(resolve(__dirname, '../../static/js/theme.js'), 'utf8');
function load({ saved, dark = false, storageFails = false, season, calendar = {}, today = "2026-10-16T12:00:00" } = {}) {
  let stored = saved, color, changes = 0;
  const attributes = {};
  const storage = { "mywork-theme": saved, "mywork-season": season };
  const system = { matches: dark, addEventListener: (_, callback) => { system.change = callback; } };
  const window = { getComputedStyle: () => ({ getPropertyValue: () => {
    const isDark = attributes['data-theme'] ? attributes['data-theme'] === 'dark' : system.matches;
    return palette[isDark ? 'dark' : 'light'].bg;
  } }), matchMedia: () => system, dispatchEvent: () => { changes++; } };
  const document = {
    documentElement: { getAttribute: name => attributes[name], setAttribute: (name, value) => { attributes[name] = value; } },
    getElementById: id => id === 'seasonal-calendar' ? { textContent: JSON.stringify(calendar) } : null,
    querySelector: selector => selector.startsWith('meta') ? { setAttribute: (_, value) => { color = value; } } : null,
  };
  const localStorage = {
    getItem: key => { if (storageFails) throw Error('storage disabled'); return storage[key]; },
    setItem: (key, value) => { if (storageFails) throw Error('storage disabled'); storage[key] = value; if (key === 'mywork-theme') stored = value; },
  };
  runInNewContext(source, { window, document, localStorage, Date: class extends Date { constructor() { super(today); } }, Event: class Event {} });
  return { attributes, storage, theme: window.MyWorkTheme, system, stored: () => stored, color: () => color, changes: () => changes };
}
test('saved theme overrides the system and survives another page load', () => {
  const page = load({ saved: 'light', dark: true });
  assert.equal(page.theme.isDark(), false);
  page.theme.toggle();
  assert.equal(page.stored(), 'dark');
  assert.equal(page.color(), '#000000');
  assert.equal(load({ saved: page.stored() }).theme.isDark(), true);
});
test('system appearance updates browser chrome until the user makes a choice', () => {
  const page = load();
  assert.equal(page.color(), '#eaeaf0');
  page.system.matches = true;
  page.system.change();
  assert.equal(page.theme.isDark(), true);
  assert.equal(page.color(), '#000000');
  page.theme.toggle();
  page.system.change();
  assert.equal(page.theme.isDark(), false);
});
test('appearance still changes when browser storage is unavailable', () => {
  const page = load({ storageFails: true });
  page.theme.toggle();
  assert.equal(page.theme.isDark(), true);
  assert.equal(page.color(), '#000000');
  assert.equal(page.changes(), 2);
});

test('old personal festival preferences cannot override the shared Home banner', () => {
  const page = load({ season: 'tihar' });
  assert.equal(page.attributes['data-season'], undefined);
  assert.equal(page.theme.setSeason, undefined);
});
