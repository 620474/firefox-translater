/* Standalone offline article export. No network scripts, trackers, or page styles. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports) module.exports=api;
  else root.AIARExport=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";
const DROP="script,style,noscript,iframe,object,embed,form,button,input,textarea,select,nav,footer,aside,canvas,video,audio,svg,dialog,[role=navigation],[aria-hidden=true]";
const KEEP=new Set(["article","section","div","header","main","h1","h2","h3","h4","h5","h6","p","ul","ol","li","blockquote","pre","code","kbd","samp","figure","figcaption","img","a","strong","b","em","i","span","small","mark","abbr","time","sub","sup","q","br","hr","table","thead","tbody","tr","td","th","details","summary","picture"]);
const STYLE=`
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#fff;color:#202124;font:17px/1.72 system-ui,-apple-system,Arial,sans-serif}
main{max-width:780px;margin:0 auto;padding:30px 24px 70px}
header.export-head{border-bottom:1px solid #ccc;margin-bottom:28px;padding-bottom:18px}
h1{font-size:2em;line-height:1.22}h2{font-size:1.5em}h3{font-size:1.22em}
h1,h2,h3,h4,h5,h6{line-height:1.35;break-after:avoid}
p,li,blockquote{overflow-wrap:anywhere}blockquote{border-left:3px solid #888;padding-left:16px;margin-left:0}
pre{background:#f4f4f4;padding:16px;overflow-x:auto;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:6px}
code,kbd,samp,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.88em}
img{max-width:100%;height:auto;display:block;margin:14px auto}figure{margin:24px 0;text-align:center}
figcaption{font-size:.85em;color:#555}a{color:#164b8c}table{border-collapse:collapse;max-width:100%;display:block;overflow-x:auto}
td,th{border:1px solid #bbb;padding:6px}small,.source{color:#555} .source{font-size:13px;overflow-wrap:anywhere}
@page{size:A4;margin:16mm}
@media print{body{font-size:11pt}main{max-width:none;padding:0}pre{break-inside:avoid}figure{break-inside:avoid}a{color:inherit}}
`;
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function sanitize(fragment,base){
  for(const bad of [...fragment.querySelectorAll(DROP)]) bad.remove();
  const document=fragment.ownerDocument;
  for(const el of [...fragment.querySelectorAll("*")]){
    if(!fragment.contains(el))continue;
    const tag=el.localName.toLowerCase();
    if(!KEEP.has(tag)){
      el.replaceWith(...el.childNodes);
      continue;
    }
    if(tag==="img"){
      const img=el;
      const src=img.getAttribute("src")||"";
      if(src){try{const u=new URL(src,base);if(["https:","http:","data:"].includes(u.protocol))img.setAttribute("src",u.href);else img.removeAttribute("src");}catch{img.removeAttribute("src");}}
    }
    for(const attr of [...el.attributes]){
      const name=attr.name.toLowerCase();
      if(name==="href"&&tag==="a"){
        try{const u=new URL(attr.value,base);if(["https:","http:","mailto:"].includes(u.protocol))el.setAttribute("href",u.href);else el.removeAttribute("href");}catch{el.removeAttribute("href");}
      }else if(!(["alt","src","width","height","lang","dir","title","start","reversed","value","datetime","colspan","rowspan"].includes(name)&&tag!=="a")){
        el.removeAttribute(attr.name);
      }else if(tag==="a"&&name!=="href"&&name!=="title")el.removeAttribute(attr.name);
    }
  }
  return fragment;
}
function snapshot(root,translations,base){
  const clone=root.cloneNode(true);
  const originalNodes=[root,...root.querySelectorAll("*")],copiedNodes=[clone,...clone.querySelectorAll("*")];
  // Resolve lazy/responsive image URLs while source nodes are still aligned.
  for(let i=0;i<originalNodes.length;i++){
    if(originalNodes[i]?.localName!=="img"||copiedNodes[i]?.localName!=="img")continue;
    const selected=originalNodes[i].currentSrc||originalNodes[i].getAttribute("src");
    if(selected)copiedNodes[i].setAttribute("src",selected);
    copiedNodes[i].removeAttribute("srcset");
    copiedNodes[i].removeAttribute("sizes");
  }
  // Each entry points to the hidden source, whose translated sibling is already in the clone.
  for(let i=0;i<originalNodes.length;i++){
    if(!translations.has(originalNodes[i]))continue;
    const source=copiedNodes[i];
    if(source?.parentNode)source.remove();
  }
  for(const el of [...clone.querySelectorAll("[data-aiar-translation]")])el.removeAttribute("data-aiar-translation");
  sanitize(clone,base);
  return clone;
}
function documentHtml(article,{title,url,date=new Date().toISOString().slice(0,10)}){
  const safeTitle=escapeHtml(title);
  const safeUrl=escapeHtml(url);
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta name="referrer" content="no-referrer"><title>'+safeTitle+'</title><style>'+STYLE+'</style></head><body>'+
    '<main><header class="export-head"><h1>'+safeTitle+'</h1><p class="source">Источник: <a href="'+safeUrl+'">'+safeUrl+'</a> · Сохранено '+escapeHtml(date)+'</p></header>'+
    article.innerHTML+'</main></body></html>';
}
async function inlineImages(article,loader,{maxImages=35,maxBytes=12000000}={}){
  let total=0,embedded=0,missing=0;
  const imgs=[...article.querySelectorAll("img")].slice(0,maxImages);
  for(const img of imgs){
    const url=img.getAttribute("src");
    if(!url)continue;
    if(url.startsWith("data:image/")){embedded++;continue;}
    try{
      const result=await loader(url);
      if(!result?.data||!result.data.startsWith("data:image/")||result.data.length+total>maxBytes)throw Error("Image unavailable");
      total+=result.data.length;embedded++;
      img.setAttribute("src",result.data);
    }catch{
      missing++;
      const placeholder=article.ownerDocument.createElement("figcaption");
      placeholder.textContent="[Изображение недоступно офлайн] "+(img.getAttribute("alt")||"");
      img.replaceWith(placeholder);
    }
  }
  for(const img of [...article.querySelectorAll("img")].slice(maxImages)){
    missing++;img.replaceWith(article.ownerDocument.createTextNode("[Изображение не включено в офлайн-файл]"));
  }
  return {embedded,missing};
}
function saveHtml(html,name,doc=document){
  const blob=new Blob([html],{type:"text/html;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=doc.createElement("a");a.href=url;a.download=name+".html";
  doc.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function showPrint(html,doc=document){
  const backdrop=doc.createElement("div");
  backdrop.id="aiar-export-print";
  backdrop.style.cssText="position:fixed!important;inset:0!important;z-index:2147483646!important;background:#fff!important;display:flex!important;flex-direction:column!important;pointer-events:auto!important;";
  const bar=doc.createElement("div");
  bar.style.cssText="padding:10px;background:#fff;color:#111;display:flex;gap:8px;align-items:center;font:15px Arial,sans-serif;border-bottom:1px solid #aaa;";
  const print=doc.createElement("button");print.textContent="Печать → Сохранить как PDF";print.type="button";
  const close=doc.createElement("button");close.textContent="Закрыть";close.type="button";
  for(const b of [print,close])b.style.cssText="padding:10px;border:1px solid #666;background:#fff;color:#111;";
  const iframe=doc.createElement("iframe");iframe.title="Предпросмотр статьи для PDF";
  iframe.style.cssText="width:100%;flex:1;border:0;background:#fff";
  iframe.srcdoc=html;
  print.addEventListener("click",()=>iframe.contentWindow?.print());
  close.addEventListener("click",()=>backdrop.remove());
  bar.append(print,close);backdrop.append(bar,iframe);doc.documentElement.append(backdrop);
  return backdrop;
}
return {snapshot,documentHtml,inlineImages,saveHtml,showPrint,sanitize,STYLE};
});