// Lexical browser adapter. Never export privileged callbacks or settings on window.
const listeners = [];
const pageSender = () => ({ tab: { id: 1, url: location.href }, frameId: 0, url: location.href });
const dispatchPage = async message => {
  for (const listener of listeners.slice(1)) {
    const result = await listener(message);
    if (result !== undefined) return result;
  }
  return { ok: false, error: 'Обновите страницу' };
};
const browser = {
  storage: { local: {
    async get(key) {
      const keys = key === null ? await GM_listValues() : Array.isArray(key) ? key : [key];
      const pairs = await Promise.all(keys.map(async k => [k, await GM_getValue(k)]));
      return Object.fromEntries(pairs);
    },
    async set(values) { for (const [k,v] of Object.entries(values)) await GM_setValue(k,v); },
    async remove(keys) { for (const key of Array.isArray(keys)?keys:[keys]) await GM_deleteValue(key); }
  } },
  runtime: {
    getURL: name => 'aiar-userscript://' + name,
    onMessage: { addListener: listener => listeners.push(listener) },
    sendMessage: message => listeners[0](message, pageSender())
  },
  tabs: {
    query: async () => [{ id: 1, url: location.href }],
    sendMessage: (_,message) => dispatchPage(message),
    create: async ({url}) => openPanel(url.endsWith('notes.html')?'notes':'popup')
  }
};
// GM networking bypasses website CORS without placing API keys in page storage.
const fetch = (url, options={}) => new Promise((resolve,reject) => {
  let request;
  const cleanup = () => options.signal?.removeEventListener('abort', abort);
  const abort = () => { request?.abort?.(); cleanup(); reject(Error('Запрос отменён')); };
  if (options.signal?.aborted) return abort();
  options.signal?.addEventListener('abort',abort,{once:true});
  request = GM_xmlhttpRequest({
    url: String(url), method: options.method || 'GET', headers: options.headers || {},
    data: options.body, timeout: 60000,
    onload(response) {
      cleanup();
      const headers = new Map(String(response.responseHeaders||'').split(/\r?\n/).map(line => {
        const i=line.indexOf(':'); return [line.slice(0,i).toLowerCase(),line.slice(i+1).trim()];
      }));
      resolve({ ok:response.status>=200&&response.status<300, status:response.status,
        statusText:response.statusText, headers:{get:name=>headers.get(name.toLowerCase())||null},
        json:async()=>JSON.parse(response.responseText) });
    },
    onerror() { cleanup(); reject(Error('Ошибка сети')); },
    ontimeout() { cleanup(); reject(Error('Превышено время ожидания')); }
  });
});
