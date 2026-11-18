import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const scripts = await Promise.all(['reader-core.js', 'reader-actions.js', 'content.js'].map(p => readFile(p, 'utf8')));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function gate() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture(html, before = async () => {}) {
  const dom = new JSDOM('<article>' + html + '</article>', { url: 'https://example.com/article', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 350, height: 55, top: 20, bottom: 75 });
  let handler;
  const calls = [];
  window.browser = { storage: { local: { get: async () => ({}) } }, runtime: {
    onMessage: { addListener(fn) { handler = fn; } },
    async sendMessage(m) {
      calls.push(m);
      if (m.type === 'SIGNATURE') return { ok: true, value: 'test/model' };
      if (m.type === 'CACHE_GET') return { ok: true, text: null };
      if (m.type === 'CACHE_SET' || m.type === 'PROGRESS') return { ok: true };
      if (m.type === 'GENERATE') {
        await before(m);
        if (m.mode === 'text') return { ok: true, text: 'Точное саммари.' };
        const payload = JSON.parse(m.prompt.split('The texts to translate are: \n')[1]);
        return { ok: true, text: JSON.stringify({ translations: payload.paragraphs.map(p => ({ id: p.id, text: 'Перевод: ' + p.text })) }) };
      }
      throw Error('Unexpected ' + m.type);
    }
  } };
  scripts.forEach(s => window.eval(s));
  return { dom, document: window.document, calls, send: m => handler(m) };
}

test('cancel permits a new translation and old finally cannot unlock it', async t => {
  const first = gate(), second = gate(), enteredFirst = gate(), enteredSecond = gate();
  let count = 0;
  const f = fixture('<p>Original paragraph with enough useful prose.</p>', async () => {
    count++;
    if (count === 1) { enteredFirst.resolve(); await first.promise; }
    else { enteredSecond.resolve(); await second.promise; }
  });
  t.after(() => { first.resolve(); second.resolve(); f.dom.window.close(); });
  const old = f.send({ type: 'TRANSLATE' });
  await enteredFirst.promise;
  await f.send({ type: 'ORIGINAL' });
  const fresh = f.send({ type: 'TRANSLATE' });
  await enteredSecond.promise;
  first.resolve();
  assert.equal((await old).ok, true);
  assert.equal(f.document.querySelectorAll('[data-aiar-translation]').length, 0);
  assert.equal((await f.send({ type: 'TRANSLATE' })).ok, false);
  second.resolve();
  assert.equal((await fresh).ok, true);
  assert.equal(f.document.querySelectorAll('[data-aiar-translation]').length, 1);
});

test('cancelled translation cannot unlock a subsequent summary', async t => {
  const first = gate(), summaryGate = gate(), entered = gate(), summaryEntered = gate();
  const f = fixture('<p>' + 'This article has enough useful explanatory prose for summarization. '.repeat(4) + '</p>', async m => {
    if (m.mode === 'json') { entered.resolve(); await first.promise; }
    else { summaryEntered.resolve(); await summaryGate.promise; }
  });
  t.after(() => { first.resolve(); summaryGate.resolve(); f.dom.window.close(); });
  const old = f.send({ type: 'TRANSLATE' });
  await entered.promise;
  await f.send({ type: 'ORIGINAL' });
  const summary = f.send({ type: 'SUMMARY', length: 'short' });
  await summaryEntered.promise;
  first.resolve();
  await old;
  assert.equal((await f.send({ type: 'TRANSLATE' })).ok, false);
  await f.send({ type: 'ORIGINAL' });
  assert.equal((await f.send({ type: 'TRANSLATE' })).ok, false);
  summaryGate.resolve();
  assert.equal((await summary).ok, true);
});

test('code and href changes invalidate visible translations without leaking code or href', async t => {
  const f = fixture('<p id=p>Read this useful <a href="/private-old">guide</a> and use <code>SECRET_OLD</code> carefully.</p>');
  t.after(() => f.dom.window.close());
  await f.send({ type: 'TRANSLATE' });
  f.document.querySelector('#p code').textContent = 'SECRET_NEW';
  await tick();
  assert.equal(f.document.querySelectorAll('[data-aiar-translation]').length, 0);
  assert.equal(f.document.querySelector('#p').style.display, '');
  await f.send({ type: 'TRANSLATE' });
  f.document.querySelector('#p a').setAttribute('href', '/private-new');
  await tick();
  assert.equal(f.document.querySelectorAll('[data-aiar-translation]').length, 0);
  await f.send({ type: 'TRANSLATE' });
  assert.equal(f.document.querySelector('[data-aiar-translation] a').getAttribute('href'), '/private-new');
  assert.equal(f.document.querySelector('[data-aiar-translation] code').textContent, 'SECRET_NEW');
  const outbound = JSON.stringify(f.calls);
  for (const secret of ['SECRET_OLD', 'SECRET_NEW', '/private-old', '/private-new']) assert.equal(outbound.includes(secret), false);
});

test('pending results do not apply after protected DOM changes', async t => {
  const wait = gate(), entered = gate();
  const f = fixture('<p>Use this original example <code>SECRET_OLD</code> carefully today.</p>', async () => { entered.resolve(); await wait.promise; });
  t.after(() => { wait.resolve(); f.dom.window.close(); });
  const pending = f.send({ type: 'TRANSLATE' });
  await entered.promise;
  f.document.querySelector('code').textContent = 'SECRET_NEW';
  wait.resolve();
  assert.equal((await pending).ok, true);
  assert.equal(f.document.querySelectorAll('[data-aiar-translation]').length, 0);
});

test('paragraph selection accepts Chinese Japanese and Arabic but not digits or code alone', async t => {
  const f = fixture('<p>这是一个用于测试文章翻译功能的完整中文段落。</p><p>これは記事の翻訳機能を検証するための日本語の文章です。</p><p>هذه فقرة عربية كاملة لاختبار ترجمة المقالات بشكل صحيح.</p><p>12345678901234567890</p><p><code>const onlyCode = true;</code></p>');
  t.after(() => f.dom.window.close());
  assert.equal((await f.send({ type: 'TRANSLATE' })).ok, true);
  assert.equal(f.document.querySelectorAll('[data-aiar-translation]').length, 3);
  assert.equal(JSON.stringify(f.calls).includes('const onlyCode'), false);
});
