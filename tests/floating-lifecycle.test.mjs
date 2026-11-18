import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const code = await readFile('floating.js', 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function gate() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture(before) {
  const dom = new JSDOM('<article>Article</article>', { url: 'https://example.com', runScripts: 'outside-only', pretendToBeVisual: true });
  let shadow;
  const attach = dom.window.Element.prototype.attachShadow;
  dom.window.Element.prototype.attachShadow = function(options) { shadow = attach.call(this, options); return shadow; };
  const calls = [];
  dom.window.browser = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    runtime: { onMessage: { addListener() {} }, async sendMessage(m) {
      calls.push(m);
      if (m.type === 'TAB_ACTION') await before(m);
      return { ok: true, provider: 'test', model: 'model' };
    } }
  };
  dom.window.eval(code);
  const launcher = shadow.querySelector('.launcher');
  async function choose(label) {
    if (shadow.querySelector('.menu').hidden) {
      // A long press opens the menu even when idle; a short click starts translation.
      launcher.dispatchEvent(new dom.window.MouseEvent('pointerdown', { button: 0 }));
      await new Promise(resolve => setTimeout(resolve, 550));
    }
    const button = [...shadow.querySelectorAll('.menu button')].find(b => b.textContent === label);
    assert.ok(button, label);
    button.click();
    await tick();
  }
  return { dom, shadow, launcher, calls, choose };
}

for (const failOld of [false, true]) test('cancel unlocks launcher; stale ' + (failOld ? 'failure' : 'success') + ' cannot reset a new operation', async t => {
  const oldGate = gate(), newGate = gate();
  let translations = 0;
  const f = fixture(async m => {
    if (m.operation !== 'TRANSLATE') return;
    translations++;
    if (translations === 1) {
      await oldGate.promise;
      if (failOld) throw Error('STALE_FAILURE');
    } else await newGate.promise;
  });
  t.after(() => { oldGate.resolve(); newGate.resolve(); f.dom.window.close(); });
  f.launcher.click();
  await tick();
  assert.equal(f.launcher.classList.contains('busy'), true);
  await f.choose('Оригинал');
  assert.equal(f.launcher.classList.contains('busy'), false);
  assert.equal(f.shadow.querySelector('.toast').textContent, 'Оригинал восстановлен');
  f.launcher.click();
  await tick();
  assert.equal(translations, 2);
  assert.equal(f.launcher.classList.contains('busy'), true);
  oldGate.resolve();
  await tick();
  assert.equal(f.launcher.classList.contains('busy'), true);
  assert.equal(f.shadow.querySelector('.toast').textContent, 'Оригинал восстановлен');
  newGate.resolve();
  await tick();
  assert.equal(f.launcher.classList.contains('busy'), false);
  assert.equal(f.shadow.querySelector('.toast').textContent, 'Перевод готов');
});

test('restoring original during summary does not unlock or cancel summary', async t => {
  const oldGate = gate(), summaryGate = gate();
  const f = fixture(async m => {
    if (m.operation === 'TRANSLATE') await oldGate.promise;
    if (m.operation === 'SUMMARY') await summaryGate.promise;
  });
  t.after(() => { oldGate.resolve(); summaryGate.resolve(); f.dom.window.close(); });
  f.launcher.click();
  await tick();
  await f.choose('Оригинал');
  await f.choose('Саммари');
  assert.equal(f.launcher.classList.contains('busy'), true);
  oldGate.resolve();
  await tick();
  assert.equal(f.launcher.classList.contains('busy'), true);
  await f.choose('Оригинал');
  assert.equal(f.launcher.classList.contains('busy'), true);
  await f.choose('Перевести');
  assert.equal(f.calls.filter(m => m.operation === 'TRANSLATE').length, 1);
  summaryGate.resolve();
  await tick();
  assert.equal(f.launcher.classList.contains('busy'), false);
  assert.equal(f.shadow.querySelector('.toast').textContent, 'Саммари открыто');
});
