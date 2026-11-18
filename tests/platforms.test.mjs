import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {inflateRawSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
import fengari from 'fengari';
const require=createRequire(import.meta.url), luaparse=require('luaparse');
execFileSync(process.execPath,['scripts/package-all.mjs','0.0.0-test']);
after(async()=>{
  for (const name of ['firefox-translator-v0.0.0-test.zip','ai-article-reader-einkbro-v0.0.0-test.user.js','ai-article-reader-koreader-v0.0.0-test.koplugin.zip']) {
    await rm('dist/'+name,{force:true});
  }
});
const userscript=await readFile('dist/ai-article-reader-einkbro-v0.0.0-test.user.js','utf8');
const tick=()=>new Promise(r=>setTimeout(r,5));
async function settle(predicate) { for(let i=0;i<80;i++){if(predicate())return;await tick();} assert.ok(predicate(),'operation timed out'); }
function unzip(data) {
  const entries=new Map();let offset=0;
  while(data.readUInt32LE(offset)===0x04034b50){
    const packed=data.readUInt32LE(offset+18),nameSize=data.readUInt16LE(offset+26),extra=data.readUInt16LE(offset+28);
    const start=offset+30+nameSize+extra;
    entries.set(data.subarray(offset+30,offset+30+nameSize).toString(),inflateRawSync(data.subarray(start,start+packed)).toString());
    offset=start+packed;
  }
  return entries;
}
test('all packages have aligned versions and complete content; Lua parses as 5.1',async()=>{
  assert.match(userscript,/@version 0\.0\.0-test/);
  assert.match(userscript,/@grant GM_xmlhttpRequest/);
  const firefox=unzip(await readFile('dist/firefox-translator-v0.0.0-test.zip'));
  assert.equal(JSON.parse(firefox.get('manifest.json')).version,'0.0.0-test');
  for(const file of ['background.js','content.js','notes.js','reader-actions.js']) assert.equal(firefox.get(file),await readFile(file,'utf8'));
  const lua=unzip(await readFile('dist/ai-article-reader-koreader-v0.0.0-test.koplugin.zip'));
  assert.equal(lua.get('aiarticlereader.koplugin/version.txt'),'0.0.0-test\n');
  for(const [file,source] of lua) if(file.endsWith('.lua')) luaparse.parse(source,{luaVersion:'5.1'});
  for(const id of ['translate','explain','glossary','keypoints','custom']) assert.ok(lua.get('aiarticlereader.koplugin/presets.lua').includes(id+'='));
});
test('EinkBro bundle translates, restores, explains, saves notes and opens settings using GM APIs',async t=>{
  const dom=new JSDOM('<article><p id="source">Choose <code>SECRET_CODE</code> for your useful application today.</p></article>',{
    url:'https://example.org/story',runScripts:'outside-only',pretendToBeVisual:true
  });
  t.after(()=>dom.window.close());
  const w=dom.window, shadows=[],requests=[],commands=[];
  const attach=w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow=function(options){const root=attach.call(this,options);shadows.push(root);return root;};
  w.HTMLElement.prototype.getBoundingClientRect=()=>({width:350,height:50,top:20,bottom:70});
  const values={settings:{provider:'gemini',keys:{gemini:'PRIVATE_TEST_KEY'},models:{gemini:'test-model'}}};
  w.GM_getValue=(k,d)=>structuredClone(values[k]??d);
  w.GM_setValue=(k,v)=>{values[k]=structuredClone(v);};
  w.GM_deleteValue=k=>{delete values[k];};w.GM_listValues=()=>Object.keys(values);
  w.GM_registerMenuCommand=(label,fn)=>commands.push(fn);
  w.GM_xmlhttpRequest=options=>{
    requests.push(options);
    const body=JSON.parse(options.data),prompt=body.contents[0].parts[0].text;
    let answer='Объяснение выделенного текста';
    if(prompt.includes('The texts to translate are: \n')){
      const payload=JSON.parse(prompt.split('The texts to translate are: \n')[1]);
      answer=JSON.stringify({translations:payload.paragraphs.map(p=>({id:p.id,text:'Перевод '+p.text}))});
    }
    setTimeout(()=>options.onload({status:200,responseText:JSON.stringify({candidates:[{content:{parts:[{text:answer}]}}]})}),0);
    return {abort(){}};
  };
  await w.eval(userscript);
  const launcher=shadows.find(s=>s.querySelector('.launcher')).querySelector('.launcher');
  launcher.click();
  await settle(()=>w.document.querySelector('[data-aiar-translation]'));
  await settle(()=>!launcher.classList.contains('busy'));
  assert.equal(w.document.querySelector('[data-aiar-translation] code').textContent,'SECRET_CODE');
  assert.ok(!requests[0].data.includes('SECRET_CODE'));
  launcher.click();await tick();
  const menu=shadows.find(s=>s.querySelector('.launcher'));
  // Idle long press opens menu; the short click above is a no-op translation of existing content.
  await settle(()=>!launcher.classList.contains('busy'));
  launcher.dispatchEvent(new w.MouseEvent('pointerdown',{button:0}));
  await new Promise(r=>setTimeout(r,550));
  [...menu.querySelectorAll('button')].find(b=>b.textContent==='Оригинал').click();
  await settle(()=>!w.document.querySelector('[data-aiar-translation]'));
  const range=w.document.createRange();range.selectNodeContents(w.document.querySelector('#source').firstChild);
  w.getSelection().addRange(range);
  launcher.dispatchEvent(new w.MouseEvent('pointerdown',{button:0}));await new Promise(r=>setTimeout(r,550));
  [...menu.querySelectorAll('button')].find(b=>b.textContent==='Объяснить').click();
  await settle(()=>shadows.some(s=>[...s.querySelectorAll('button')].some(b=>b.textContent==='В заметки'&&!b.disabled)));
  const result=shadows.find(s=>[...s.querySelectorAll('button')].some(b=>b.textContent==='В заметки'));
  [...result.querySelectorAll('button')].find(b=>b.textContent==='В заметки').click();
  await settle(()=>values.readerNotesV1?.length===1);
  commands[0]();await tick();
  const panel=shadows.find(s=>s.getElementById('apiKey'));
  assert.equal(panel.getElementById('apiKey').value,'PRIVATE_TEST_KEY');
  panel.getElementById('model').value='changed-model';panel.getElementById('save').click();
  await settle(()=>values.settings.models.gemini==='changed-model');
  panel.getElementById('notesOpen').click();await tick();
  assert.ok(shadows.some(s=>s.getElementById('notes')?.textContent.includes('Объяснение')));
  assert.equal(w.browser,undefined);
  assert.equal(w.localStorage.length,0);
  assert.ok(!w.document.documentElement.outerHTML.includes('PRIVATE_TEST_KEY'));
});
test('KOReader provider client runs with mock transports and blocks invalid settings/code',async()=>{
  const source=await readFile('platforms/koreader/client.lua','utf8');
  const presetZip=unzip(await readFile('dist/ai-article-reader-koreader-v0.0.0-test.koplugin.zip'));
  const program=`local Client=(function() ${source} end)()
    local presets=(function() ${presetZip.get('aiarticlereader.koplugin/presets.lua')} end)()
    local encoded, response, lastURL, lastHeaders
    local JSON={encode=function(value) encoded=value;return 'JSON' end,decode=function() return response end}
    local deps={json=JSON,post=function(url,headers,body) lastURL=url;lastHeaders=headers;assert(body=='JSON');return '{}' end}
    local settings={provider='gemini',key='PRIVATE_KEY',model='test-model'}
    local prompt=Client.buildPrompt('explain','useful selection','book',nil,presets,JSON)
    assert(prompt:find('untrusted DATA',1,true))
    assert(encoded.selection=='useful selection')
    assert(not pcall(Client.buildPrompt,'translate','const value = {};','book',nil,presets,JSON))
    assert(not pcall(Client.buildPrompt,'invalid','text','book',nil,presets,JSON))
    response={candidates={{content={parts={{text='answer'}}}}}}
    assert(Client.generate(settings,prompt,deps)=='answer')
    assert(lastHeaders['x-goog-api-key']=='PRIVATE_KEY')
    assert(not lastURL:find('PRIVATE_KEY',1,true))
    for _,provider in ipairs({'deepseek','openai'}) do
      settings.provider=provider;response={choices={{message={content='answer'}}}}
      assert(Client.generate(settings,prompt,deps)=='answer')
      assert(lastHeaders.Authorization=='Bearer PRIVATE_KEY')
    end
    settings.backend='https://gateway.example';response={text='gateway-answer'}
    assert(Client.generate(settings,prompt,deps)=='gateway-answer')
    assert(lastURL=='https://gateway.example/api/generate')
    assert(lastHeaders['X-Provider-Api-Key']=='PRIVATE_KEY')
    settings.backend='http://unsafe.example';assert(not pcall(Client.validate,settings))
    settings.backend='https://user:pass@example.org';assert(not pcall(Client.validate,settings))
  `;
  const {lua,lauxlib,lualib,to_luastring}=fengari,L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
  const result=lauxlib.luaL_dostring(L,to_luastring(program));
  assert.equal(result,lua.LUA_OK,lua.lua_tojsstring(L,-1)||'Lua error');
});

test('KOReader entry point registers menus, handles selections and stores answers locally',async()=>{
  const main=await readFile('platforms/koreader/main.lua','utf8');
  const client=await readFile('platforms/koreader/client.lua','utf8');
  // Presets are generated from the shared browser source, also exercised above.
  const presets=require('../reader-actions.js').PRESETS;
  const luaPresets='{' + [...Object.keys(presets),'custom'].map(id=>`${id}={label="${id}",task="task"}`).join(',') + '}';
  const program=`
    local Client=(function() ${client} end)()
    local presets=${luaPresets}
    local shown, menu, highlightCallback, selectedAction, saved
    local Class={}
    function Class:extend(value) setmetatable(value,{__index=self});return value end
    function Class:new(value) return value end
    local ui={show=function(_,widget) shown=widget end,close=function() end}
    local modules={
      ['ui/widget/container/widgetcontainer']=Class,
      ['ui/uimanager']=ui,
      ['device']={hasClipboard=function() return false end},
      ['json']={encode=function() return 'JSON' end},
      ['ui/network/manager']={runWhenConnected=function(_,fn) fn() end},
      ['ui/trapper']={wrap=function(_,fn) fn() end,dismissableRunInSubprocess=function(_,fn) return true,fn() end},
    }
    local data={aiar_settings={provider='gemini',key='test-key',model='test-model'}}
    G_reader_settings={readSetting=function(_,key,default) return data[key] or default end,
      saveSetting=function(_,key,value) data[key]=value end,flush=function() end}
    local require=function(name) return modules[name] or Class end
    local dofile=function(path) return path:find('client.lua',1,true) and Client or presets end
    Client.generate=function(settings,prompt) assert(prompt:find('Source JSON',1,true));return 'Test answer' end
    local Plugin=(function() ${main} end)()
    Plugin.path='plugins/aiarticlereader.koplugin'
    local highlight={selected_text={text='Selected useful text'},highlightFromHoldPos=function() end,onClose=function() end,
      addToHighlightDialog=function(_,name,callback) highlightCallback=callback end}
    Plugin.ui={highlight=highlight,document={file='/private/books/book.epub'},menu={registerToMainMenu=function(_,plugin) saved=plugin end}}
    Plugin:init();assert(saved==Plugin)
    menu={};Plugin:addToMainMenu(menu);assert(#menu.aiarticlereader.sub_item_table==2)
    highlightCallback(highlight).callback();assert(#shown.buttons==5)
    shown.buttons[1][1].callback();assert(shown.ok_callback)
    shown.ok_callback();assert(shown.text=='Test answer')
    shown.buttons_table[1][1].callback()
    assert(data.aiar_notes[1].answer=='Test answer')
    assert(data.aiar_notes[1].title=='book.epub')
    assert(data.aiar_notes[1].selection=='Selected useful text')
    Plugin:showNotes();assert(shown.text:find('Test answer',1,true))
  `;
  const {lua,lauxlib,lualib,to_luastring}=fengari,L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
  assert.equal(lauxlib.luaL_dostring(L,to_luastring(program)),lua.LUA_OK,lua.lua_tojsstring(L,-1)||'Lua error');
});
