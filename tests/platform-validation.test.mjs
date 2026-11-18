import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import fengari from 'fengari';
const version = '0.0.0-panel-test';
execFileSync(process.execPath, ['scripts/package-platforms.mjs', version]);
const script = await readFile(`dist/ai-article-reader-einkbro-v${version}.user.js`, 'utf8');
const client = await readFile('platforms/koreader/client.lua', 'utf8');
after(async () => {
  await Promise.all([`dist/ai-article-reader-einkbro-v${version}.user.js`, `dist/ai-article-reader-koreader-v${version}.koplugin.zip`].map(p => rm(p, { force: true })));
});
const tick = () => new Promise(r => setTimeout(r, 0));
function gate() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function settle(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await tick(); } assert.ok(fn(), 'Timed out'); }
async function fixture() {
  const dom = new JSDOM('<article><p>Useful article text for the reader.</p></article>', { url: 'https://example.org/article', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, shadows = [], commands = [], writes = [];
  const attach = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function(options) { const shadow = attach.call(this, options); shadows.push(shadow); return shadow; };
  const values = { settings: { provider: 'gemini', keys: { gemini: 'TEST_KEY' }, models: { gemini: 'test-model' } } };
  w.GM_getValue = (key, fallback) => structuredClone(values[key] ?? fallback);
  w.GM_setValue = (key, value) => { writes.push(key); values[key] = structuredClone(value); };
  w.GM_listValues = () => Object.keys(values);
  w.GM_deleteValue = key => { delete values[key]; };
  w.GM_registerMenuCommand = (label, fn) => commands.push(fn);
  w.GM_xmlhttpRequest = () => { throw Error('Network is not expected'); };
  await w.eval(script);
  return { dom, w, shadows, commands, values, writes };
}

test('replaced panel rejects delayed settings and its close button cannot remove a new panel', async t => {
  const f = await fixture(), pending = gate(), entered = gate();
  t.after(() => { pending.resolve(); f.dom.window.close(); });
  const get = f.w.GM_getValue;
  let once = true;
  f.w.GM_getValue = async (key, fallback) => {
    if (key === 'settings' && once) { once = false; entered.resolve(); await pending.promise; }
    return get(key, fallback);
  };
  f.commands[0]();
  await entered.promise;
  const old = f.shadows.at(-1);
  f.commands[0]();
  const fresh = f.shadows.at(-1);
  await settle(() => fresh.getElementById('apiKey').value === 'TEST_KEY');
  old.querySelector('button').click();
  assert.equal(fresh.host.isConnected, true);
  pending.resolve();
  await tick(); await tick();
  assert.equal(old.getElementById('apiKey').value, '');
  assert.equal(fresh.getElementById('apiKey').value, 'TEST_KEY');
});

test('closed settings panel cannot save keys or start privileged actions', async t => {
  const f = await fixture();
  t.after(() => f.dom.window.close());
  f.commands[0]();
  const panel = f.shadows.at(-1);
  await settle(() => panel.getElementById('apiKey').value === 'TEST_KEY');
  panel.querySelector('button').click();
  const before = f.writes.length;
  panel.getElementById('apiKey').value = 'STALE_KEY';
  panel.getElementById('save').click();
  panel.getElementById('translate').click();
  panel.getElementById('notesOpen').click();
  await tick(); await tick();
  assert.equal(f.writes.length, before);
  assert.equal(f.values.settings.keys.gemini, 'TEST_KEY');
  assert.equal(panel.host.isConnected, false);
  assert.equal(f.shadows.at(-1), panel);
});

function runLua(program) {
  const { lua, lauxlib, lualib, to_luastring } = fengari;
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  try {
    const result = lauxlib.luaL_dostring(L, to_luastring(`local Client=(function() ${client} end)()\n${program}`));
    assert.equal(result, lua.LUA_OK, lua.lua_tojsstring(L, -1) || 'Lua failure');
  } finally { lua.lua_close(L); }
}

test('KOReader validates entire gateway host port and path', () => runLua(`
  local s={provider='gemini',key='test-key',model='test-model'}
  local valid={'','https://gateway.example','https://gateway.example:443/base/v1','https://localhost:8443','https://127.0.0.1:3000/prefix','https://gateway.example/a%20b'}
  for _,url in ipairs(valid) do s.backend=url; assert(pcall(Client.validate,s),url) end
  local invalid={'http://gateway.example','https://','https:///path','https://user:pass@gateway.example','https://gateway.example?key=x','https://gateway.example/#fragment','https://gateway.example:abc','https://gateway.example:','https://gateway.example:0','https://gateway.example:65536','https://gateway.example:443junk','https://bad..example','https://-bad.example','https://bad-.example','https://256.1.1.1','https://127.1','https://012.0.0.1','https://gateway.example/path%ZZ','https://gateway.example/path with spaces','https://gateway.example!bad'}
  for _,url in ipairs(invalid) do s.backend=url; assert(not pcall(Client.validate,s),url) end
  s.backend=123; assert(not pcall(Client.validate,s))
`));

test('KOReader permits prose punctuation while blocking recognizable code for translation only', () => runLua(`
  local presets={translate={task='Translate'},explain={task='Explain'}}
  local json={encode=function() return '{}' end}
  local prose={'Read this carefully; then continue.','The set {a, b} contains two elements.','A function describes a relationship; this is prose.'}
  for _,value in ipairs(prose) do assert(pcall(Client.buildPrompt,'translate',value,'Book',nil,presets,json),value) end
  local code={'const value = {};','let count = 2;','var value = 3;','function greet() { return 1; }','function(x) return x end','x => x + 1',string.rep(string.char(96),3)..'js'}
  for _,value in ipairs(code) do
    assert(not pcall(Client.buildPrompt,'translate',value,'Book',nil,presets,json),value)
    assert(pcall(Client.buildPrompt,'explain',value,'Book',nil,presets,json),value)
  end
`));
