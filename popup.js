const STORAGE_KEY = "knownWords";
const SEEN_KEY = "seenWords";
const SETTINGS_KEY = "settings";
const DEFAULT_SETTINGS = {
  enabled: true,
  targetLang: "pt",
  autoPause: false,
  pauseOnHover: true,
  quizAfterVideo: true,
};
const QUIZ_HISTORY_KEY = "quizHistory";
const CARDS_KEY = "cards";

const $ = (id) => document.getElementById(id);

let words = [];
let seen = {};
let settings = { ...DEFAULT_SETTINGS };

async function load() {
  const data = await chrome.storage.local.get([
    STORAGE_KEY,
    SEEN_KEY,
    SETTINGS_KEY,
    QUIZ_HISTORY_KEY,
    CARDS_KEY,
  ]);
  words = (data[STORAGE_KEY] || []).slice().sort();
  seen = data[SEEN_KEY] || {};
  settings = { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
  renderSettings();
  renderProgress(data[QUIZ_HISTORY_KEY] || []);
  renderCards(data[CARDS_KEY] || []);
  render();
  loadLlm();
}

function renderProgress(history) {
  const el = $("progress");
  if (!history.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const recent = history.slice(-10);
  const pct = (list) => {
    const total = list.reduce((a, h) => a + h.total, 0);
    return total ? Math.round((list.reduce((a, h) => a + h.correct, 0) / total) * 100) : 0;
  };
  el.innerHTML =
    `<div class="progress-head"><b>${history.length}</b> exercicios feitos · ` +
    `acerto recente <b>${pct(recent)}%</b> (geral ${pct(history)}%)</div>` +
    history
      .slice(-5)
      .reverse()
      .map(
        (h) =>
          `<div class="progress-row"><span class="score">${h.correct}/${h.total}</span>` +
          `<span class="title" title="${escapeHtml(h.title || "")}">${escapeHtml(h.title || h.videoId || "")}</span></div>`,
      )
      .join("");
}

function renderCards(cards) {
  $("cards-total").textContent = cards.length;
  $("cards-new").textContent = cards.filter((c) => !c.exported).length;
}

// Anki text import: tab-separated, HTML fields, tags in column 3.
function cardsToAnki(cards) {
  const clean = (s) => String(s).replace(/[\t\r\n]+/g, " ");
  const rows = cards.map((c) => {
    const words = new Set(c.words || []);
    const front = c.sentence.replace(/[a-zA-ZÀ-ÿ']+/g, (m) => {
      const w = m.toLowerCase().replace(/^'+|'+$/g, "");
      return words.has(w) ? `<b>${escapeHtml(m)}</b>` : escapeHtml(m);
    });
    const notes = (c.wordNotes || [])
      .map((n) => `<b>${escapeHtml(n.word)}</b>: ${escapeHtml(n.tr)}`)
      .join("<br>");
    const link = `https://www.youtube.com/watch?v=${encodeURIComponent(c.videoId)}&t=${c.time}s`;
    const back = [
      escapeHtml(c.translation || ""),
      notes,
      `<a href="${link}">${escapeHtml(c.title || "YouTube")}</a>`,
    ]
      .filter(Boolean)
      .join("<br><br>");
    return [clean(front), clean(back), "youtube-english"].join("\t");
  });
  return "#separator:tab\n#html:true\n#tags column:3\n" + rows.join("\n") + "\n";
}

async function exportCards(onlyNew) {
  const data = await chrome.storage.local.get(CARDS_KEY);
  const cards = data[CARDS_KEY] || [];
  const selected = onlyNew ? cards.filter((c) => !c.exported) : cards;
  if (!selected.length) {
    alert(onlyNew ? "Nenhum cartao novo para exportar." : "Nenhum cartao ainda.");
    return;
  }
  const blob = new Blob([cardsToAnki(selected)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `anki-frases-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  await chrome.storage.local.set({
    [CARDS_KEY]: cards.map((c) => ({ ...c, exported: true })),
  });
}

$("cards-export").addEventListener("click", () => exportCards(true));
$("cards-export-all").addEventListener("click", () => exportCards(false));
$("cards-clear").addEventListener("click", async () => {
  if (!confirm("Apagar todos os cartoes salvos?")) return;
  await chrome.storage.local.set({ [CARDS_KEY]: [] });
});

async function loadLlm() {
  const cfg = await getLlmConfig();
  $("llm-key").value = cfg.apiKey;
  $("llm-model").value = cfg.model;
  $("llm-url").value = cfg.baseUrl;
  $("llm-state").textContent = cfg.apiKey ? "· configurada" : "· sem chave";
  if (!cfg.apiKey) $("llm-section").open = true;
}

$("llm-save").addEventListener("click", async () => {
  const cfg = {
    apiKey: $("llm-key").value.trim(),
    model: $("llm-model").value.trim() || DEFAULT_LLM.model,
    baseUrl: $("llm-url").value.trim() || DEFAULT_LLM.baseUrl,
  };
  let origin;
  try {
    origin = new URL(cfg.baseUrl).origin;
  } catch {
    $("llm-msg").textContent = "URL invalida";
    return;
  }
  // Non-default providers need host access, granted on this click.
  if (origin !== new URL(DEFAULT_LLM.baseUrl).origin) {
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) {
      $("llm-msg").textContent = "Permissao negada para essa URL";
      return;
    }
  }
  await chrome.storage.local.set({ [LLM_KEY]: cfg });
  $("llm-msg").textContent = "Salvo";
  loadLlm();
});

$("llm-test").addEventListener("click", async () => {
  $("llm-msg").textContent = "Testando...";
  const res = await chrome.runtime.sendMessage({ type: "llm-test" }).catch((err) => ({
    error: String(err?.message || err),
  }));
  $("llm-msg").textContent = res?.ok
    ? "Funcionando"
    : res?.error === "no-api-key"
      ? "Salve a chave primeiro"
      : `Erro: ${res?.error}`;
});

async function save() {
  await chrome.storage.local.set({ [STORAGE_KEY]: words });
}

function render() {
  $("total").textContent = words.length;
  $("seen-total").textContent = Object.keys(seen).length;
  const q = $("search").value.trim().toLowerCase();
  const filtered = q ? words.filter((w) => w.includes(q)) : words;
  const list = $("list");
  if (!filtered.length) {
    list.innerHTML = `<div class="empty">${words.length ? "Nenhum resultado" : "Sem palavras ainda"}</div>`;
    return;
  }
  list.innerHTML = filtered
    .map(
      (w) =>
        `<li><span class="word">${escapeHtml(w)}</span><button class="del" data-word="${escapeHtml(w)}" title="Remover">×</button></li>`,
    )
    .join("");
}

function escapeHtml(s) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

function renderSettings() {
  $("target-lang").value = settings.targetLang;
  document.querySelectorAll("[data-setting]").forEach((el) => {
    el.checked = !!settings[el.dataset.setting];
  });
  $("power-label").textContent = settings.enabled ? "Ativada" : "Desativada";
  document.body.classList.toggle("off", !settings.enabled);
}

async function saveSettings() {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

$("target-lang").addEventListener("change", (e) => {
  settings.targetLang = e.target.value;
  saveSettings();
});

document.querySelectorAll("[data-setting]").forEach((el) =>
  el.addEventListener("change", () => {
    settings[el.dataset.setting] = el.checked;
    saveSettings();
  }),
);

$("search").addEventListener("input", render);

$("list").addEventListener("click", async (e) => {
  const btn = e.target.closest(".del");
  if (!btn) return;
  const w = btn.dataset.word;
  words = words.filter((x) => x !== w);
  await save();
  render();
});

$("add-btn").addEventListener("click", addWord);
$("add-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addWord();
});

async function addWord() {
  const raw = $("add-input").value.trim().toLowerCase();
  if (!raw) return;
  const tokens = (raw.match(/[a-zA-ZÀ-ÿ']+/g) || [])
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t.length >= 1);
  if (!tokens.length) return;
  const set = new Set(words);
  for (const t of tokens) set.add(t);
  words = [...set].sort();
  $("add-input").value = "";
  await save();
  render();
}

$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(words, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `known-words-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$("import").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error("JSON precisa ser um array");
    const set = new Set(words);
    for (const w of arr) {
      if (typeof w === "string" && w.length >= 1) set.add(w.toLowerCase());
    }
    words = [...set].sort();
    await save();
    render();
  } catch (err) {
    alert("Erro ao importar: " + err.message);
  }
  e.target.value = "";
});

$("clear").addEventListener("click", async () => {
  if (!confirm("Apagar todas as palavras conhecidas?")) return;
  words = [];
  await save();
  render();
});

$("export-seen").addEventListener("click", () => {
  const entries = Object.entries(seen).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!entries.length) {
    alert("Nenhuma palavra vista ainda. Assista um video com legendas.");
    return;
  }
  const text = "palavra\tvezes\n" + entries.map(([w, c]) => `${w}\t${c}`).join("\n") + "\n";
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vistas-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

$("clear-seen").addEventListener("click", async () => {
  if (!confirm("Apagar historico de palavras vistas? (suas palavras conhecidas NAO serao afetadas)")) return;
  seen = {};
  await chrome.storage.local.set({ [SEEN_KEY]: seen });
  render();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORAGE_KEY]) {
    words = (changes[STORAGE_KEY].newValue || []).slice().sort();
    render();
  }
  if (changes[SEEN_KEY]) {
    seen = changes[SEEN_KEY].newValue || {};
    render();
  }
  if (changes[CARDS_KEY]) {
    renderCards(changes[CARDS_KEY].newValue || []);
  }
  if (changes[QUIZ_HISTORY_KEY]) {
    renderProgress(changes[QUIZ_HISTORY_KEY].newValue || []);
  }
  if (changes[SETTINGS_KEY]) {
    settings = { ...DEFAULT_SETTINGS, ...(changes[SETTINGS_KEY].newValue || {}) };
    renderSettings();
  }
});

load();
