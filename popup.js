const $ = id => document.getElementById(id);
let form = null;
const providers = ["gemini", "deepseek", "openai"];
function status(text) { $("status").textContent = text; }
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
  $("modelList").replaceChildren(new Option("Список моделей", ""));
}
function collect() {
  if (!form) return;
  const provider = form.provider;
  form.keys[provider] = $("apiKey").value.trim();
  form.models[provider] = $("model").value.trim();
  form.useBackend = $("useBackend").checked;
  form.backendUrl = $("backendUrl").value.trim();
}
async function save() {
  collect();
  await msg("SETTINGS_SAVE", { settings: form });
  status("Настройки сохранены");
}
async function activeTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length || !tabs[0].id) throw Error("Нет активной вкладки");
  if (!/^https?:/.test(tabs[0].url || "")) throw Error("Откройте обычную веб-страницу");
  return tabs[0];
}
async function action(type, options = {}) {
  await save();
  const tab = await activeTab();
  status(type === "SUMMARY" ? "Суммаризация запущена..." : "Обработка статьи...");
  const result = await browser.tabs.sendMessage(tab.id, { type, ...options });
  if (!result?.ok) throw Error(result?.error || "Не удалось обработать страницу");
  status("Готово. Результат на странице.");
}
document.addEventListener("DOMContentLoaded", async () => {
  try {
    form = (await msg("SETTINGS_GET")).settings;
    render();
  } catch (error) { status("Ошибка загрузки: " + error.message); }
});
$("provider").addEventListener("change", () => {
  if (!form) return;
  collect();
  form.provider = $("provider").value;
  render();
});
$("modelList").addEventListener("change", () => {
  if ($("modelList").value) $("model").value = $("modelList").value;
});
$("modelsLoad").addEventListener("click", async () => {
  try {
    await save();
    status("Загружаю модели...");
    const models = (await msg("MODELS")).models;
    $("modelList").replaceChildren(new Option("Выберите модель", ""));
    for (const id of models) $("modelList").add(new Option(id, id));
    status("Найдено моделей: " + models.length + ". Выберите модель или введите ID вручную.");
  } catch (error) { status("Ошибка моделей: " + error.message); }
});
$("save").addEventListener("click", () => save().catch(e => status(e.message)));
for (const [id, type] of [["translate", "TRANSLATE"], ["original", "ORIGINAL"], ["summary", "SUMMARY"]]) {
  $(id).addEventListener("click", () => action(type, { length: $("length").value })
    .catch(e => status("Ошибка: " + e.message)));
}
