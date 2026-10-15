const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/js/app.js', 'utf8');
const initSource = source.slice(source.indexOf('  var barcodeFallbackReady ='), source.indexOf('  function initStoreNavigation()'));

function element(extra = {}) {
  return Object.assign({ handlers: {}, hidden: true, value: '', focused: false,
    addEventListener(type, fn) { this.handlers[type] = fn; },
    focus() { this.focused = true; }, dispatchEvent() {},
  }, extra);
}
function fixture(camera = false, creation = false, lookup = false, productOnly = false) {
  const bin = element(), product = element(), quantity = element();
  const title = element();
  if (creation) product.dataset = { scanNext: "#id_title" };
  const status = element(), video = element({ srcObject: null, play: async () => {} });
  const panel = element({ querySelector: () => video });
  const stop = element(), details = element({ open: true });
  const buttons = ['bin', 'product'].map(target => element({ dataset: { cameraTarget: target } }));
  let submitted = 0;
  const form = element({ requestSubmit() { submitted++; }, elements: { quantity, lookup: { value: "" } }, dataset: { scanSuccess: creation ? "Code captured. Save the product." : "" }, closest: () => creation ? null : details,
    querySelectorAll: selector => selector === '[data-scan-field]' ? (productOnly ? [product] : [bin, product]) : buttons,
    querySelector: selector => ({ '[data-camera-panel]': panel, '[data-scan-status]': status,
      '[data-camera-stop]': stop, '[data-scan-field="bin"]': bin,
      '[data-scan-field="product"]': product, '#id_title': title })[selector],
  });
  if (lookup) { form.dataset.scanSubmit = "true"; form.dataset.scanAction = "/store-navigation/#floorplan"; }
  const root = { querySelectorAll: () => [form] };
  const doc = element({ querySelector: () => root, hidden: false });
  const cleanups = [];
  let stopped = 0, pendingTimer = null;
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  const media = { getUserMedia: async () => stream };
  const win = { isSecureContext: true, setTimeout(fn) { pendingTimer = fn; return 1; }, clearTimeout() { pendingTimer = null; } };
  if (camera) win.BarcodeDetector = class {
    static async getSupportedFormats() { return ['code_128']; }
    async detect() { return []; }
  };
  const context = { document: doc, window: win, navigator: { mediaDevices: media },
    onLeave: fn => cleanups.push(fn), listen: (target, type, fn) => target.addEventListener(type, fn), Event };
  vm.runInNewContext(initSource + '\ninitWarehousePicking();', context);
  return { form, submitted: () => submitted, bin, product, title, quantity, status, video, panel, stop, details, buttons, doc, win, media,
    cleanup: () => cleanups.forEach(fn => fn()), stream, stopped: () => stopped, timer: () => pendingTimer };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('scanner Enter advances fields without submitting collected quantities', () => {
  const f = fixture();
  let prevented = 0;
  f.bin.handlers.keydown({ key: 'Enter', preventDefault() { prevented++; } });
  assert.equal(f.product.focused, true);
  f.product.handlers.keydown({ key: 'Enter', preventDefault() { prevented++; } });
  assert.equal(f.quantity.focused, true);
  assert.equal(prevented, 2);
});

test('camera unsupported retains scanner/manual input', async () => {
  const f = fixture();
  await f.buttons[0].handlers.click();
  assert.match(f.status.textContent, /scanner keyboard or enter the code/);
  assert.equal(f.bin.focused, true);
  assert.equal(f.panel.hidden, true);
});

test('captured code fills one field and closes camera without submitting', async () => {
  const f = fixture(true);
  f.win.BarcodeDetector.prototype.detect = async () => [{ rawValue: '00001234' }];
  await f.buttons[0].handlers.click();
  await flush();
  assert.equal(f.bin.value, '00001234');
  assert.equal(f.product.value, '');
  assert.equal(f.product.focused, true);
  assert.equal(f.panel.hidden, true);
  assert.equal(f.stopped(), 1);
  assert.equal(f.video.srcObject, null);
});

test('navigation stops camera and cancels scheduled detection', async () => {
  const f = fixture(true);
  await f.buttons[0].handlers.click();
  await flush();
  assert.equal(f.panel.hidden, false);
  assert.ok(f.timer());
  f.cleanup();
  assert.equal(f.stopped(), 1);
  assert.equal(f.timer(), null);
  assert.equal(f.panel.hidden, true);
});

test('a camera permission response arriving after navigation is released', async () => {
  const f = fixture(true);
  let resolveCamera;
  f.media.getUserMedia = () => new Promise(resolve => { resolveCamera = resolve; });
  const start = f.buttons[0].handlers.click();
  await flush();
  f.cleanup();
  resolveCamera(f.stream);
  await start;
  assert.equal(f.stopped(), 1);
  assert.equal(f.panel.hidden, true);
});


test('product creation scans barcode and focuses name without a disclosure panel', async () => {
  const f = fixture(true, true);
  f.win.BarcodeDetector.prototype.detect = async () => [{ rawValue: '0012345678905' }];
  await f.buttons[1].handlers.click();
  await flush();
  assert.equal(f.product.value, '0012345678905');
  assert.equal(f.title.focused, true);
  assert.equal(f.quantity.focused, false);
  assert.equal(f.stopped(), 1);
  assert.match(f.status.textContent, /Save the product/);
});

test('map point selection updates destination and selected marker', () => {
  const mapSource = source.slice(source.indexOf('  function initWarehouseProductMap()'), source.indexOf('  function initPage()'));
  const status = element();
  const select = element({ value: '', options: [{ text: 'Choose a point' }, { text: 'Rack A' }], selectedIndex: 1 });
  select.dispatchEvent = () => select.handlers.change();
  let selected = false;
  const point = element({ dataset: { selectNode: '42' }, classList: { toggle(_name, value) { selected = value; } }, setAttribute() {}, removeAttribute() {} });
  const root = { querySelector: selector => selector === '#id_map_node' ? select : status, querySelectorAll: () => [point] };
  vm.runInNewContext(mapSource + '\ninitWarehouseProductMap();', { document: { querySelector: () => root }, Event });
  assert.equal(selected, false);
  let prevented = false;
  point.handlers.click({ preventDefault() { prevented = true; } });
  assert.equal(select.value, '42');
  assert.equal(selected, true);
  assert.equal(prevented, true);
  assert.match(status.textContent, /Rack A/);
});


test('camera search submits exact barcode lookup after stopping the stream', async () => {
  const f = fixture(true, false, true);
  f.win.BarcodeDetector.prototype.detect = async () => [{ rawValue: '000012345' }];
  await f.buttons[1].handlers.click();
  await flush();
  assert.equal(f.product.value, '000012345');
  assert.equal(f.form.elements.lookup.value, 'barcode');
  assert.equal(f.form.action, '/store-navigation/#floorplan');
  assert.equal(f.submitted(), 1);
  assert.equal(f.stopped(), 1);
});

test('Enter in search retains normal name and barcode search submission', () => {
  const f = fixture(false, false, true);
  f.product.value = '00123';
  let prevented = false;
  f.product.handlers.keydown({ key: 'Enter', preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(f.submitted(), 0);
  assert.equal(f.form.elements.lookup.value, '');
  assert.equal(f.quantity.focused, false);
});


test('product-only scan moves directly to quantity and releases the camera', async () => {
  const f = fixture(true, false, false, true);
  f.product.handlers.keydown({ key: 'Enter', preventDefault() {} });
  assert.equal(f.quantity.focused, true);
  f.quantity.focused = false;
  f.win.BarcodeDetector.prototype.detect = async () => [{ rawValue: '0012345' }];
  await f.buttons[1].handlers.click();
  await flush();
  assert.equal(f.product.value, '0012345');
  assert.equal(f.quantity.focused, true);
  assert.equal(f.stopped(), 1);
  assert.match(f.status.textContent, /Enter the quantity/);
});
