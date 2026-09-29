let settings = { ...DEFAULT_SETTINGS };

async function load() {
  const data = await chrome.storage.local.get([
    STORAGE_KEY,
    SETTINGS_KEY,
    QUIZ_HISTORY_KEY,
    CARDS_KEY,
  ]);
  settings = { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
  renderEnabled();
  $("known").textContent = (data[STORAGE_KEY] || []).length;
  renderCards(data[CARDS_KEY] || []);
  const acc = quizAccuracy((data[QUIZ_HISTORY_KEY] || []).slice(-10));
  $("accuracy").textContent = acc === null ? "—" : `${acc}%`;
  $("llm-notice").hidden = !!(await getLlmConfig()).apiKey;
}

function renderEnabled() {
  $("enabled").checked = settings.enabled;
  $("state").textContent = settings.enabled
    ? "Ativada no YouTube"
    : "Desativada — o YouTube volta ao normal";
  document.body.classList.toggle("off", !settings.enabled);
}

function renderCards(cards) {
  const fresh = cards.filter((c) => !c.exported).length;
  $("cards-new").textContent = fresh;
  $("export-cards").hidden = !fresh;
  $("export-cards").textContent = `Exportar ${fresh} ${fresh === 1 ? "cartao novo" : "cartoes novos"} para o Anki`;
}

$("enabled").addEventListener("change", () => {
  settings.enabled = $("enabled").checked;
  chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  renderEnabled();
});

document.querySelectorAll("[data-open]").forEach((el) =>
  el.addEventListener("click", () => {
    openHub(el.dataset.open);
    window.close();
  }),
);

$("export-cards").addEventListener("click", () => exportCards(true));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[CARDS_KEY]) renderCards(changes[CARDS_KEY].newValue || []);
  if (changes[STORAGE_KEY]) $("known").textContent = (changes[STORAGE_KEY].newValue || []).length;
});

load();
