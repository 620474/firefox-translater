const $ = id => document.getElementById(id);
let form = null;
let saveQueue = Promise.resolve();
let pendingChanges = false;
const providers = ["gemini", "deepseek", "openai"];
function status(text, state = "info") {
  $("status").textContent = text;
  $("status").dataset.state = state;
}
async function clickTask(id, pending, work, done) {
  const button = $(id);
  if (button.disabled) return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  status(pending, "busy");
  try {
    await work();
    if (done) status(done, "ok");
  } catch (error) {
    status("Ошибка: " + error.message, "error");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}
async function msg(type, extra = {}) {
  const result = await browser.runtime.sendMessage({ type, ...extra });
  if (!result?.ok) throw Error(result?.error || "Ошибка");
  return result;
}
function render() {
  const provider = form.provider;
  $("provider").value = provider;
  $("apiKey").value = form.keys[provider] || "";
  $("model").value = form.models[provider] || "";
  $("useBackend").checked = form.useBackend;
  $("backendUrl").value = form.backendUrl || "";
  $("translationPrompt").value = form.translationPrompt || "";
  $("explanationPrompt").value = form.explanationPrompt || "";
  $("modelList").replaceChildren(new Option("Список моделей", ""));
}
function collect() {
  if (!form) return;
  const provider = form.provider;
  form.keys[provider] = $("apiKey").value.trim();
  form.models[provider] = $("model").value.trim();
  form.useBackend = $("useBackend").checked;
  form.backendUrl = $("backendUrl").value.trim();
  form.translationPrompt = $("translationPrompt").value.trim();
  form.explanationPrompt = $("explanationPrompt").value.trim();
}
async function save(showFeedback = true) {
  if (!form) throw Error("Настройки ещё не загружены");
  collect();
  // Snapshot values before awaiting: edits made during an in-flight save must not
  // mutate the payload or be overwritten by an older completion.
  const snapshot = JSON.parse(JSON.stringify(form));
  const persist = async () => {
    await msg("SETTINGS_SAVE", { settings: snapshot });
    const stored = (await msg("SETTINGS_GET")).settings;
    if (stored.translationPrompt !== snapshot.translationPrompt ||
        stored.explanationPrompt !== snapshot.explanationPrompt) {
      throw Error("Не удалось подтвердить сохранение промптов");
    }
    pendingChanges = $("translationPrompt").value.trim() !== stored.translationPrompt ||
      $("explanationPrompt").value.trim() !== stored.explanationPrompt;
    if (showFeedback && !pendingChanges) status("Промпты сохранены и проверены", "ok");
  };
  const operation = saveQueue.then(persist);
  saveQueue = operation.catch(() => {});
  await operation;
}
async function activeTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length || !tabs[0].id) throw Error("Нет активной вкладки");
  if (!/^https?:/.test(tabs[0].url || "")) throw Error("Откройте обычную веб-страницу");
  return tabs[0];
}
async function action(type, options = {}) {
  await save(false);
  const { tabId } = await msg("SETTINGS_TARGET");
  status(type === "SUMMARY" ? "Суммаризация запущена..." : "Обработка статьи...");
  const result = await browser.tabs.sendMessage(tabId, { type, ...options });
  if (!result?.ok) throw Error(result?.error || "Не удалось обработать страницу");
  status("Готово. Результат на странице.");
}
document.addEventListener("DOMContentLoaded", async () => {
  try {
    form = (await msg("SETTINGS_GET")).settings;
    render();
    status("Настройки загружены", "ok");
  } catch (error) { status("Ошибка загрузки: " + error.message, "error"); }
});
$("provider").addEventListener("change", () => {
  if (!form) return;
  collect();
  form.provider = $("provider").value;
  render();
  status("Провайдер изменён — сохраните настройки");
});
for (const id of ["translationPrompt", "explanationPrompt"]) {
  $(id).addEventListener("input", () => {
    pendingChanges = true;
    status("Промпт изменён — нажмите «Сохранить»", "info");
  });
  // Persist on leaving the field, including when the user navigates away from
  // the keyboard without reaching the bottom of a long settings page.
  $(id).addEventListener("change", () =>
    clickTask("saveOnly", "Сохраняю промпт…", () => save()));
}
$("modelList").addEventListener("change", () => {
  if ($("modelList").value) {
    $("model").value = $("modelList").value;
    status("Модель выбрана — сохраните настройки");
  }
});
$("modelsLoad").addEventListener("click", () => clickTask("modelsLoad", "Получаю модели…", async () => {
  await save(false);
  const models = (await msg("MODELS")).models;
  $("modelList").replaceChildren(new Option("Выберите модель", ""));
  for (const id of models) $("modelList").add(new Option(id, id));
  status("Найдено моделей: " + models.length + ". Выберите модель или введите ID вручную.", "ok");
}));
$("saveOnly").addEventListener("click", () => clickTask("saveOnly", "Сохраняю настройки…", save));
$("save").addEventListener("click", () => clickTask("save", "Сохраняю и возвращаюсь к статье…", async () => {
  await save(false);
  const result = await msg("SETTINGS_FINISH");
  if (result.closePopup) window.close();
  if (result.noOrigin) status("Сохранено. Исходная вкладка не найдена — закройте настройки вручную.", "ok");
}));
for (const [id, type] of [["translate", "TRANSLATE"], ["original", "ORIGINAL"], ["summary", "SUMMARY"]]) {
  $(id).addEventListener("click", () => clickTask(id, type === "SUMMARY" ? "Создаю саммари…" : "Обрабатываю статью…",
    () => action(type, { length: $("length").value })));
}
$("clearCache").addEventListener("click", () => clickTask("clearCache", "Очищаю кэш…", async () => {
  await msg("CACHE_CLEAR");
  status("Локальный кэш переводов очищен", "ok");
}));
$("notesOpen").addEventListener("click", () => clickTask("notesOpen", "Открываю заметки…", async () => {
  await msg("OPEN_NOTES");
  status("Заметки открыты", "ok");
}));

$("resetPrompts").addEventListener("click", async () => {
  if (!form) return;
  try {
    const defaults = await msg("PROMPTS_DEFAULTS");
    $("translationPrompt").value = defaults.translation;
    $("explanationPrompt").value = defaults.explanation;
    pendingChanges = true;
    status("Стандартные промпты в форме — нажмите «Сохранить»");
  } catch (error) { status("Ошибка: " + error.message, "error"); }
});
