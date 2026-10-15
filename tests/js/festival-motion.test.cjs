const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/js/app.js', 'utf8');
const init = source.slice(source.indexOf('  function initFestivalMotion()'), source.indexOf('  function initTheme()'));
function fixture(reduced = false) {
  const attributes = {}, handlers = {}, cleanup = [];
  const root = { setAttribute: (name, value) => { attributes[name] = value; } };
  const preference = { matches: reduced }, document = { hidden: false, querySelector: () => root };
  let intersection, disconnected = false;
  const window = { matchMedia: () => preference, IntersectionObserver: class { constructor(fn) { intersection = fn; } observe() {} disconnect() { disconnected = true; } } };
  vm.runInNewContext(init + '\ninitFestivalMotion();', { document, window, onLeave: fn => cleanup.push(fn), listen: (target, type, fn) => { handlers[type] = fn; } });
  return { attributes, preference, document, handlers, intersection: visible => intersection([{ isIntersecting: visible }]), cleanup: () => cleanup.forEach(fn => fn()), disconnected: () => disconnected };
}
test('animation resumes automatically when the banner returns to view', () => {
  const page = fixture();
  assert.equal(page.attributes['data-motion-ready'], 'true');
  assert.equal(page.attributes['data-motion-paused'], 'false');
  page.intersection(false);
  assert.equal(page.attributes['data-motion-paused'], 'true');
  page.intersection(true);
  assert.equal(page.attributes['data-motion-paused'], 'false');
});
test('reduced motion, background tabs and page disposal stop animation', () => {
  const page = fixture(true);
  assert.equal(page.attributes['data-motion-paused'], 'true');
  page.preference.matches = false;
  page.handlers.change();
  assert.equal(page.attributes['data-motion-paused'], 'false');
  page.document.hidden = true;
  page.handlers.visibilitychange();
  assert.equal(page.attributes['data-motion-paused'], 'true');
  page.document.hidden = false;
  page.handlers.visibilitychange();
  page.intersection(false);
  assert.equal(page.attributes['data-motion-paused'], 'true');
  page.cleanup();
  assert.equal(page.disconnected(), true);
});
