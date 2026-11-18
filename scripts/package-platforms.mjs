import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { writeZip } from './archive.mjs';
const require=createRequire(import.meta.url);
const actions=require('../reader-actions.js');
const version=process.argv[2] || '0.1.0';
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw Error('Invalid semantic version');
await mkdir('dist',{recursive:true});
const read=path=>readFile(path,'utf8');
const metadata=`// ==UserScript==
// @name AI Article Reader - EinkBro
// @namespace https://github.com/620474/firefox-translater
// @version ${version}
// @description Перевод статей, саммари и действия с выделением для E-Ink
// @match https://*/*
// @match http://*/*
// @noframes
// @run-at document-idle
// @grant GM_getValue
// @grant GM_setValue
// @grant GM_deleteValue
// @grant GM_listValues
// @grant GM_xmlhttpRequest
// @grant GM_registerMenuCommand
// @connect *
// ==/UserScript==
`;
let panels='';
for (const name of ['popup','notes']) {
  const html=(await read(name+'.html')).match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g,'');
  panels+=`const ${name}HTML=${JSON.stringify(html)};\nconst ${name}CSS=${JSON.stringify(await read(name+'.css'))};\n`;
  panels+=`function ${name}Start(document,browser) {\n${await read(name+'.js')}\n}\n`;
}
const panelCode=`
let panelHost;
function openPanel(name) {
  panelHost?.remove();
  panelHost=document.createElement('div');
  panelHost.style.cssText='position:fixed;inset:0;z-index:2147483647;background:white;overflow:auto;color:black';
  const shadow=panelHost.attachShadow({mode:'closed'});
  const style=document.createElement('style');
  style.textContent=(name==='notes'?notesCSS:popupCSS)+' :host{font:16px Arial} main{width:auto;max-width:680px;margin:auto;padding:16px} button,input,select{min-height:44px}';
  const close=document.createElement('button');close.textContent='Закрыть';
  close.addEventListener('click',()=>panelHost.remove());
  const parsed=new DOMParser().parseFromString(name==='notes'?notesHTML:popupHTML,'text/html');
  shadow.append(style,close,...Array.from(parsed.body.childNodes).map(n=>document.importNode(n,true)));
  document.documentElement.append(panelHost);
  const scopedDocument={getElementById:id=>shadow.getElementById(id),createElement:tag=>document.createElement(tag),
    addEventListener:(event,fn)=>{if(event==='DOMContentLoaded')fn();}};
  const scopedBrowser={...browser,runtime:{...browser.runtime,sendMessage:message=>listeners[0](message,
    {...pageSender(),url:browser.runtime.getURL(name+'.html')})}};
  (name==='notes'?notesStart:popupStart)(scopedDocument,scopedBrowser);
}
`;
const script=metadata+'\n(async function(){\n"use strict";\nif(window.top!==window)return;\n'+
  await read('platforms/einkbro/adapter.js')+'\n'+await read('background.js')+'\n'+
  panels+panelCode+'\n'+await read('reader-core.js')+'\n'+await read('reader-actions.js')+'\n'+
  `if(!(await browser.storage.local.get('aiarFloatingPrefs')).aiarFloatingPrefs) await browser.storage.local.set({aiarFloatingPrefs:{eink:true}});\n`+
  await read('content.js')+'\n'+await read('floating.js')+'\nGM_registerMenuCommand("AI Article Reader - настройки",()=>openPanel("popup"));\n})();\n';
await writeFile(`dist/ai-article-reader-einkbro-v${version}.user.js`,script);
// Generate Lua presets from the same source used by both browser clients.
const luaString=s=>'"'+s.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n').replace(/\r/g,'\\r')+'"';
const lua='return {\n'+Object.entries(actions.PRESETS).map(([id,p])=>`  ${id}={label=${luaString(p.label)},task=${luaString(p.task)}},`).join('\n')+
  `\n  custom={label="Мой промпт",task=${luaString(actions.DEFAULT_CUSTOM)}}\n}\n`;
const names=['main.lua','client.lua','_meta.lua','README.md'];
const entries=await Promise.all(names.map(async name=>['aiarticlereader.koplugin/'+name,await read('platforms/koreader/'+name)]));
entries.push(['aiarticlereader.koplugin/presets.lua',lua],['aiarticlereader.koplugin/version.txt',version+'\n']);
await writeZip(`dist/ai-article-reader-koreader-v${version}.koplugin.zip`,entries);
console.log('Built EinkBro userscript and KOReader plugin '+version);
