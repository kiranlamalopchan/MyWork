const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/js/app.js', 'utf8');
const init = source.slice(source.indexOf('  function initPhotoPicks()'), source.indexOf('  function initCsvPicker()'));

function submit(button, number = '') {
  const handlers = {}, requests = [];
  const row = { classList: { add() {} } };
  const typed = { value: number, focus() {} };
  const form = {
    action: '/plu/photo-search/pick/',
    closest: () => row,
    querySelector: selector => selector === '[data-pick-number]' ? typed : null,
  };
  const results = {
    hasAttribute: () => false, setAttribute() {},
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
  };
  vm.runInNewContext(init + '\ninitPhotoPicks();', {
    document: { getElementById: () => results },
    window: { fetch: true },
    FormData: class extends Map {
      constructor() { super([['index', '0'], ['query', 'lamb leg chops'], ['plu_no', number]]); }
    },
    fetch(url, options) { requests.push({ url, options }); return new Promise(() => {}); },
  });
  const event = {
    target: { closest: selector => selector === '[data-pick-form]' ? form : null },
    submitter: { ...button, hasAttribute: name => name === 'name' && Boolean(button.name) },
    preventDefault() {},
  };
  handlers.submit.forEach(fn => fn(event));
  return requests;
}

test('product name lookup submits a search without requiring a typed PLU', () => {
  const requests = submit({ name: 'action', value: 'search' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.body.get('action'), 'search');
  assert.equal(requests[0].options.body.get('query'), 'lamb leg chops');
  assert.notEqual(requests[0].options.body.get('plu_no'), 'search');
});

test('choosing a suggested product submits its code instead of an old typed code', () => {
  const requests = submit({ name: 'plu_no', value: '1319' }, '900');
  assert.equal(requests[0].options.body.get('plu_no'), '1319');
  assert.equal(requests[0].options.body.has('action'), false);
});

test('manual PLU correction and removing a row keep their existing behavior', () => {
  assert.equal(submit({ name: 'action', value: 'set' }, '900')[0].options.body.get('plu_no'), '900');
  assert.equal(submit({ name: 'plu_no', value: '' })[0].options.body.get('plu_no'), '');
});
