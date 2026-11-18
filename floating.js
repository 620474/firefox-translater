/* Touch-first floating launcher. No API keys ever enter this script or page DOM. */
(() => {
  if (window.top !== window || window.__aiarFloatingInitialized) return;
  window.__aiarFloatingInitialized = true;

  const DEFAULTS = { side: "right", topRatio: 0.64, opacity: 0.28, eink: false };
  const SIZE = 52, EDGE = 10, HOLD_MS = 520, DRAG_THRESHOLD = 11;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  let prefs = { ...DEFAULTS }, busy = false, menuOpen = false;
  let gesture = null, holdTimer = null, toastTimer = null;

  const host = document.createElement("div");
  host.id = "aiar-floating-root";
  host.style.cssText = "position:fixed!important;top:0!important;left:0!important;" +
    "width:0!important;height:0!important;z-index:2147483647!important;" +
    "pointer-events:none!important;";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = [
    ":host{all:initial} .launcher,.menu,.toast{box-sizing:border-box;font-family:Arial,sans-serif}",
    ".launcher{position:fixed;top:64vh;right:10px;width:52px;height:52px;border-radius:50%;",
    "border:2px solid #555;background:#fff;color:#111;box-shadow:0 1px 5px #5558;",
    "font-size:28px;font-weight:700;line-height:1;display:grid;place-items:center;",
    "user-select:none;-webkit-user-select:none;touch-action:none;cursor:pointer;",
    "padding:0;pointer-events:auto;transition:opacity 120ms;-webkit-tap-highlight-color:transparent}",
    ".launcher::after{content:'A';font:bold 12px Arial,sans-serif;position:absolute;",
    "right:7px;top:6px;padding:0 2px;background:#fff;color:#111}",
    ".launcher:hover,.launcher:active,.launcher:focus-visible,.launcher.busy{opacity:.95!important}",
    ".menu{position:fixed;width:min(310px,calc(100vw - 24px));",
    "max-height:calc(100vh - 24px);overflow-y:auto;overscroll-behavior:contain;",
    "background:#fff;color:#111;border:1px solid #777;border-radius:14px;",
    "padding:14px;pointer-events:auto;box-shadow:0 5px 22px #0005;font:15px/1.4 Arial,sans-serif}",
    ".menu[hidden],.toast[hidden]{display:none!important}",
    ".heading,.row,.summary{display:flex;align-items:center;justify-content:space-between;gap:8px}",
    ".heading{margin-bottom:8px}.heading strong{font-size:16px}",
    ".muted{font-size:12px;color:#555;margin:6px 0 12px;overflow-wrap:anywhere}",
    ".menu button,.menu select{min-height:44px;padding:8px;color:#111;background:#fff;",
    "border:1px solid #777;border-radius:8px;font:inherit;cursor:pointer}",
    ".menu button.primary{background:#111;color:#fff}",
    ".actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}",
    ".summary{margin-top:8px}.summary>*{flex:1;min-width:0}",
    ".full{display:block;width:100%;margin-top:8px}",
    ".row{margin-top:13px}.row input[type=range]{width:125px;max-width:55%;accent-color:#222}",
    ".row input[type=checkbox]{width:22px;height:22px;accent-color:#222}",
    ".toast{position:fixed;width:min(280px,calc(100vw - 75px));",
    "padding:9px 12px;background:#222;color:#fff;border:1px solid #888;",
    "border-radius:8px;font:14px/1.4 Arial,sans-serif;pointer-events:none;overflow-wrap:anywhere}",
    ".eink.launcher{box-shadow:none;transition:none;border-color:#111}",
    ".eink.menu,.eink.toast{box-shadow:none;border-radius:0}",
    "@media(prefers-reduced-motion:reduce){.launcher{transition:none}}"
  ].join("");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "launcher";
  button.textContent = "文";
  button.setAttribute("aria-label", "AI Article Reader: коснитесь для перевода, удерживайте для меню");
  button.title = "Короткое нажатие — перевод. Долгое — меню. Можно перетащить.";

  const menu = document.createElement("section");
  menu.className = "menu";
  menu.hidden = true;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.hidden = true;
  toast.setAttribute("role", "status");
  shadow.append(style, button, menu, toast);
  document.documentElement.append(host);

  function clean(input = {}) {
    return {
      side: input.side === "left" ? "left" : "right",
      topRatio: clamp(Number.isFinite(Number(input.topRatio)) ? Number(input.topRatio) : .64, .04, .92),
      opacity: clamp(Number.isFinite(Number(input.opacity)) ? Number(input.opacity) : .28, .12, .95),
      eink: !!input.eink
    };
  }
  function positionMenu() {
    const height = menu.offsetHeight || 360;
    menu.style.top = clamp(button.getBoundingClientRect().top - height / 2, 12,
      Math.max(12, innerHeight - height - 12)) + "px";
    if (innerWidth >= 390) {
      menu.style.left = prefs.side === "left" ? "70px" : "auto";
      menu.style.right = prefs.side === "right" ? "70px" : "auto";
    } else {
      menu.style.left = prefs.side === "left" ? "10px" : "auto";
      menu.style.right = prefs.side === "right" ? "10px" : "auto";
    }
  }
  function positionToast() {
    toast.style.top = clamp(button.getBoundingClientRect().top - 54, 6,
      Math.max(6, innerHeight - 75)) + "px";
    toast.style.left = prefs.side === "left" ? "70px" : "auto";
    toast.style.right = prefs.side === "right" ? "70px" : "auto";
  }
  function place() {
    button.style.top = clamp(prefs.topRatio * innerHeight, EDGE,
      Math.max(EDGE, innerHeight - SIZE - EDGE)) + "px";
    button.style.left = prefs.side === "left" ? EDGE + "px" : "auto";
    button.style.right = prefs.side === "right" ? EDGE + "px" : "auto";
    button.style.opacity = String(prefs.opacity);
    for (const el of [button, menu, toast]) el.classList.toggle("eink", prefs.eink);
    if (menuOpen) positionMenu();
    if (!toast.hidden) positionToast();
  }
  async function save() {
    await browser.storage.local.set({ aiarFloatingPrefs: { ...prefs } });
  }
  function notify(text) {
    toast.textContent = String(text).slice(0, 220);
    toast.hidden = false;
    positionToast();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.hidden = true, 4000);
  }
  async function send(type, payload = {}) {
    const response = await browser.runtime.sendMessage({ type, ...payload });
    if (!response?.ok) throw Error(response?.error || "Ошибка расширения");
    return response;
  }
  function closeMenu() {
    menu.hidden = true;
    menu.replaceChildren();
    menuOpen = false;
  }
  function el(tag, text = "", className = "") {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function action(label, callback, className = "") {
    const node = el("button", label, className);
    node.type = "button";
    node.addEventListener("click", callback);
    return node;
  }
  async function run(operation, options = {}) {
    if (busy) { notify("Дождитесь завершения текущей операции"); return; }
    closeMenu();
    busy = true;
    button.classList.add("busy");
    button.textContent = "⋯";
    try {
      await send("TAB_ACTION", { operation, options });
      notify(operation === "TRANSLATE" ? "Перевод готов" :
        operation === "ORIGINAL" ? "Оригинал восстановлен" :
        operation === "SELECTION_ACTION" ? "Анализ выделения готов" : "Саммари открыто");
    } catch (error) {
      notify("Ошибка: " + (error.message || error));
    } finally {
      busy = false;
      button.classList.remove("busy");
      button.textContent = "文";
      button.style.fontSize = "";
      button.setAttribute("aria-label", "Нажмите для перевода, удерживайте для меню");
      button.style.opacity = String(prefs.opacity);
    }
  }
  async function openMenu() {
    if (busy) return notify("Дождитесь завершения перевода");
    closeMenu();
    menuOpen = true;
    menu.hidden = false;

    const header = el("div", "", "heading");
    const close = action("✕", closeMenu);
    close.setAttribute("aria-label", "Закрыть");
    header.append(el("strong", "AI Article Reader"), close);
    const current = el("p", "Провайдер и модель", "muted");
    menu.append(header, current);

    const actions = el("div", "", "actions");
    actions.append(
      action("Перевести", () => run("TRANSLATE"), "primary"),
      action("Оригинал", () => run("ORIGINAL"))
    );
    menu.append(actions);

    const summary = el("div", "", "summary");
    const level = document.createElement("select");
    level.setAttribute("aria-label", "Объём саммари");
    for (const [value, label] of [
      ["short", "Кратко"], ["normal", "Стандартно"], ["detailed", "Подробно"]
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      if (value === "normal") option.selected = true;
      level.append(option);
    }
    summary.append(level, action("Саммари", () => run("SUMMARY", { length: level.value })));
    menu.append(summary);

    menu.append(el("p", "Выделенный фрагмент", "muted"));
    const selectionActions = el("div", "", "actions");
    const selectedAction = (label, id) => action(label,
      () => run("SELECTION_ACTION", { actionId: id }));
    selectionActions.append(
      selectedAction("Перевести фрагмент", "translate"),
      selectedAction("Объяснить", "explain"),
      selectedAction("Термин", "glossary"),
      selectedAction("Тезисы", "keypoints")
    );
    menu.append(selectionActions);
    menu.append(action("✦ Мой промпт (для выделения)",
      () => run("SELECTION_ACTION", { actionId: "custom" }), "full"));
    menu.append(action("▤ Мои заметки", async () => {
      try {
        await send("OPEN_NOTES");
        closeMenu();
      } catch (error) { notify("Ошибка: " + error.message); }
    }, "full"));

    menu.append(action("⚙ Настройки AI и моделей", async () => {
      try {
        await send("OPEN_SETTINGS");
        closeMenu();
      } catch (error) { notify(error.message); }
    }, "full"));

    const opacityRow = el("label", "", "row");
    const opacityText = el("span", "Прозрачность: " + Math.round(prefs.opacity * 100) + "%");
    const opacity = document.createElement("input");
    opacity.type = "range";
    opacity.min = "12";
    opacity.max = "95";
    opacity.value = String(Math.round(prefs.opacity * 100));
    opacity.setAttribute("aria-label", "Прозрачность кнопки");
    opacity.addEventListener("input", () => {
      prefs.opacity = Number(opacity.value) / 100;
      opacityText.textContent = "Прозрачность: " + opacity.value + "%";
      place();
    });
    opacity.addEventListener("change", () => save().catch(() => notify("Ошибка сохранения")));
    opacityRow.append(opacityText, opacity);
    menu.append(opacityRow);

    const einkRow = el("label", "", "row");
    einkRow.append(el("span", "Режим E-Ink"));
    const eink = document.createElement("input");
    eink.type = "checkbox";
    eink.checked = prefs.eink;
    eink.addEventListener("change", () => {
      prefs.eink = eink.checked;
      place();
      save().catch(() => notify("Ошибка сохранения"));
    });
    einkRow.append(eink);
    menu.append(einkRow);
    menu.append(el("p", "Перемести кнопку пальцем в удобное место.", "muted"));
    positionMenu();

    try {
      const info = await send("PUBLIC_SETTINGS");
      if (menuOpen) current.textContent = info.provider + " · " + info.model;
    } catch { if (menuOpen) current.textContent = "Настройте модель и API-ключ"; }
  }
  function cancelHold() { clearTimeout(holdTimer); holdTimer = null; }
  button.addEventListener("contextmenu", event => event.preventDefault());
  button.addEventListener("pointerdown", event => {
    if (event.button !== 0 || busy) return;
    event.preventDefault();
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    button.setPointerCapture?.(event.pointerId);
    cancelHold();
    holdTimer = setTimeout(() => {
      holdTimer = null;
      if (!gesture || gesture.moved) return;
      gesture = null;
      openMenu();
    }, HOLD_MS);
  });
  button.addEventListener("pointermove", event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > DRAG_THRESHOLD) {
      gesture.moved = true;
      cancelHold();
    }
    if (!gesture.moved) return;
    button.style.left = clamp(event.clientX - SIZE / 2, EDGE,
      Math.max(EDGE, innerWidth - SIZE - EDGE)) + "px";
    button.style.right = "auto";
    button.style.top = clamp(event.clientY - SIZE / 2, EDGE,
      Math.max(EDGE, innerHeight - SIZE - EDGE)) + "px";
  });
  button.addEventListener("pointerup", event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    cancelHold();
    const moved = gesture.moved;
    gesture = null;
    if (moved) {
      prefs.side = event.clientX < innerWidth / 2 ? "left" : "right";
      prefs.topRatio = clamp((event.clientY - SIZE / 2) / innerHeight, .04, .92);
      place();
      save().catch(() => notify("Не удалось сохранить положение"));
    } else if (menuOpen) closeMenu();
    else run("TRANSLATE");
  });
  button.addEventListener("pointercancel", () => { gesture = null; cancelHold(); });
  button.addEventListener("lostpointercapture", cancelHold);
  // Keyboard accessibility: native click without a pointer event.
  button.addEventListener("click", event => {
    if (event.detail === 0) menuOpen ? closeMenu() : run("TRANSLATE");
  });
  browser.runtime.onMessage.addListener(message => {
    if (message?.type !== "UI_PROGRESS" || !busy) return undefined;
    const total = Number(message.total);
    const done = Number(message.done);
    if (!Number.isInteger(total) || total < 1 || !Number.isInteger(done)) return undefined;
    button.textContent = Math.min(total, Math.max(0, done)) + "/" + total;
    button.style.fontSize = "13px";
    button.setAttribute("aria-label", "Обработка: " + done + " из " + total);
    return undefined;
  });
  document.addEventListener("pointerdown", event => {
    // Closed Shadow DOM hides internal nodes from document-level listeners.
    // Events from the launcher or menu still include the host.
    if (menuOpen && !event.composedPath().includes(host)) closeMenu();
  }, true);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && menuOpen) closeMenu();
  });
  window.addEventListener("resize", place);
  browser.storage.local.get("aiarFloatingPrefs").then(data => {
    prefs = clean(data.aiarFloatingPrefs || DEFAULTS);
    place();
  }).catch(place);
  place();
})();
