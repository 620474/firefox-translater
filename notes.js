const root = document.getElementById("notes");
const headings = {
  summary: "Саммари статьи", translate: "Перевод фрагмента",
  explain: "Объяснение", glossary: "Разбор термина",
  keypoints: "Тезисы", custom: "Мой промпт"
};
async function call(type, payload = {}) {
  const response = await browser.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw Error(response?.error || "Ошибка дополнения");
  return response;
}
function text(tag, value, className = "") {
  const node = document.createElement(tag);
  node.textContent = String(value ?? "");
  if (className) node.className = className;
  return node;
}
function button(label, onClick) {
  const element = text("button", label);
  element.type = "button";
  element.addEventListener("click", onClick);
  return element;
}
async function load() {
  root.replaceChildren(text("p", "Загрузка заметок…"));
  try {
    const { notes } = await call("NOTES_LIST");
    root.replaceChildren();
    if (!notes.length) {
      root.append(text("p", "Пока нет заметок. Выделите фрагмент статьи, откройте меню AI и сохраните ответ."));
      return;
    }
    for (const note of notes) {
      const card = document.createElement("article");
      card.append(text("h2", note.title || headings[note.type] || "Заметка"));
      const created = new Date(note.createdAt);
      card.append(text("div", (headings[note.type] || "AI-ответ") + " · " +
        (Number.isNaN(created.getTime()) ? "" : created.toLocaleString("ru-RU")), "meta"));
      if (typeof note.url === "string" && /^https?:\/\//.test(note.url)) {
        const link = text("a", "Открыть оригинал");
        link.href = note.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        card.append(link);
      }
      if (note.selection) {
        const details = document.createElement("details");
        details.append(text("summary", "Выделенный фрагмент"));
        details.append(text("pre", note.selection));
        card.append(details);
      }
      card.append(text("pre", note.answer));
      const tools = document.createElement("div");
      tools.className = "row";
      const copy = button("Копировать", async () => {
        try {
          await navigator.clipboard.writeText(note.answer);
          copy.textContent = "Скопировано";
        } catch {
          copy.textContent = "Не удалось скопировать";
        }
      });
      const del = button("Удалить", async () => {
        if (!confirm("Удалить эту заметку?")) return;
        try {
          await call("NOTES_DELETE", { id: note.id });
          await load();
        } catch (error) {
          del.textContent = "Ошибка удаления: " + error.message;
        }
      });
      tools.append(copy, del);
      card.append(tools);
      root.append(card);
    }
  } catch (error) {
    root.replaceChildren(text("p", "Не удалось загрузить заметки: " + error.message));
  }
}
document.getElementById("refresh").addEventListener("click", load);
load();
