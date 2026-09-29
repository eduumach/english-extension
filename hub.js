const PAGES = ["home", "vocab", "cards", "settings"];
const WORDS_LIMIT = 300;

let known = new Set();
let seen = {};
let wordStats = {};
let cards = [];
let history = [];
let settings = { ...DEFAULT_SETTINGS };
let llmConfigured = false;

let vocabTab = "study";
let cardFilter = "new";
let toastTimer = null;

async function load() {
  const data = await chrome.storage.local.get([
    STORAGE_KEY,
    SEEN_KEY,
    SETTINGS_KEY,
    WORD_STATS_KEY,
    QUIZ_HISTORY_KEY,
    CARDS_KEY,
  ]);
  known = new Set(data[STORAGE_KEY] || []);
  seen = data[SEEN_KEY] || {};
  wordStats = data[WORD_STATS_KEY] || {};
  cards = data[CARDS_KEY] || [];
  history = data[QUIZ_HISTORY_KEY] || [];
  settings = { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
  await loadLlm();
  renderAll();
  route();
}

function renderAll() {
  renderSettings();
  renderHome();
  renderVocab();
  renderCards();
}

function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2200);
}

/* ---------- Navigation ---------- */

function route() {
  const page = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
  document.querySelectorAll("[data-page]").forEach((s) => (s.hidden = s.dataset.page !== page));
  document
    .querySelectorAll("[data-nav]")
    .forEach((a) => a.classList.toggle("active", a.dataset.nav === page));
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);

document.querySelectorAll("[data-vocab-tab]").forEach((a) =>
  a.addEventListener("click", () => setVocabTab(a.dataset.vocabTab)),
);

/* ---------- Home ---------- */

function studyWords() {
  return Object.entries(seen)
    .filter(([w]) => !known.has(w))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function renderHome() {
  const freshCards = cards.filter((c) => !c.exported).length;
  $("st-known").textContent = known.size;
  $("st-study").textContent = studyWords().length;
  $("st-cards").textContent = cards.length;
  const acc = quizAccuracy(history.slice(-10));
  $("st-accuracy").textContent = acc === null ? "—" : `${acc}%`;

  const badge = $("nav-cards-badge");
  badge.hidden = !freshCards;
  badge.textContent = freshCards;

  const steps = [
    {
      done: Object.keys(seen).length > 0,
      html: `Abra um video <b>com legendas</b> no YouTube. As palavras aparecem coloridas.`,
    },
    {
      done: known.size > 0,
      html: `Clique nas palavras que voce ja sabe para marca-las como aprendidas.`,
    },
    {
      done: llmConfigured,
      html: `<a href="#settings">Configure a IA</a> para ganhar exercicios ao fim de cada video.`,
    },
    {
      done: cards.some((c) => c.exported),
      html: `Crie cartoes com o <b>+</b> de uma frase e <a href="#cards">exporte para o Anki</a>.`,
    },
  ];
  $("steps").hidden = steps.every((s) => s.done);
  $("steps-list").innerHTML = steps
    .map((s) => `<li class="${s.done ? "done" : ""}">${s.html}</li>`)
    .join("");

  $("history").innerHTML = history.length
    ? `<p class="muted">${history.length} ${history.length === 1 ? "exercicio feito" : "exercicios feitos"} · acerto geral ${quizAccuracy(history)}%</p>` +
      history
        .slice(-8)
        .reverse()
        .map(
          (h) =>
            `<div class="history-row"><span class="score ${h.correct / h.total >= 0.7 ? "good" : ""}">${h.correct}/${h.total}</span>` +
            `<a class="title" href="https://www.youtube.com/watch?v=${encodeURIComponent(h.videoId || "")}" target="_blank" rel="noopener">${escapeHtml(cleanTitle(h.title) || h.videoId || "")}</a>` +
            `<span class="muted">${new Date(h.ts).toLocaleDateString("pt-BR")}</span></div>`,
        )
        .join("")
    : `<p class="empty">Nenhum exercicio ainda. Eles aparecem ao terminar um video, ou pelo botao <b>Praticar</b> no painel do video.</p>`;
}

/* ---------- Vocabulary ---------- */

function setVocabTab(tab) {
  vocabTab = tab;
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  renderVocab();
}

document
  .querySelectorAll("[data-tab]")
  .forEach((b) => b.addEventListener("click", () => setVocabTab(b.dataset.tab)));

function statsHtml(w) {
  const st = wordStats[w];
  if (!st) return "";
  return `<span class="quiz-stat" title="Acertos / erros nos exercicios"><span class="ok">✓${st.ok}</span> <span class="bad">✗${st.fail}</span></span>`;
}

function renderVocab() {
  const study = studyWords();
  $("tab-study-count").textContent = study.length;
  $("tab-known-count").textContent = known.size;
  $("vocab-help").textContent =
    vocabTab === "study"
      ? "Palavras que apareceram nos videos e voce ainda nao sabe, das mais frequentes para as menos. Quando aprender, clique em \"Ja sei\"."
      : "Palavras que voce marcou como aprendidas. Elas ficam verdes na legenda.";

  const q = $("search").value.trim().toLowerCase();
  const entries =
    vocabTab === "study" ? study : [...known].sort().map((w) => [w, seen[w] || 0]);
  const filtered = q ? entries.filter(([w]) => w.includes(q)) : entries;
  const shown = filtered.slice(0, WORDS_LIMIT);

  if (!shown.length) {
    const msg = q
      ? "Nenhum resultado."
      : vocabTab === "study"
        ? "Nada para estudar ainda. Assista um video com legendas."
        : "Nenhuma palavra aprendida ainda. Clique numa palavra da legenda para marca-la.";
    $("words").innerHTML = `<li class="empty">${msg}</li>`;
  } else {
    $("words").innerHTML = shown
      .map(([w, count]) => {
        const action =
          vocabTab === "study"
            ? `<button class="ghost ok" data-learn="${escapeHtml(w)}">Ja sei</button>`
            : `<button class="ghost" data-unlearn="${escapeHtml(w)}" title="Volta para estudar">Remover</button>`;
        return (
          `<li><span class="word ${vocabTab === "study" ? "yellow" : "green"}">${escapeHtml(w)}</span>` +
          (count ? `<span class="muted">vista ${count}x</span>` : "") +
          statsHtml(w) +
          action +
          `</li>`
        );
      })
      .join("");
  }
  $("words-more").textContent =
    filtered.length > shown.length
      ? `Mostrando ${shown.length} de ${filtered.length}. Use a busca para achar outras.`
      : "";
}

$("search").addEventListener("input", renderVocab);

$("words").addEventListener("click", async (e) => {
  const learn = e.target.closest("[data-learn]");
  const unlearn = e.target.closest("[data-unlearn]");
  if (learn) known.add(learn.dataset.learn);
  else if (unlearn) known.delete(unlearn.dataset.unlearn);
  else return;
  await saveKnown();
});

$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tokens = ($("add-input").value.toLowerCase().match(/[a-zA-ZÀ-ÿ']+/g) || [])
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
  if (!tokens.length) return;
  tokens.forEach((t) => known.add(t));
  $("add-input").value = "";
  await saveKnown();
  toast(tokens.length === 1 ? `"${tokens[0]}" adicionada` : `${tokens.length} palavras adicionadas`);
});

async function saveKnown() {
  await chrome.storage.local.set({ [STORAGE_KEY]: [...known] });
}

/* ---------- Cards ---------- */

function fmtTime(sec) {
  const s = Math.floor(sec || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function renderCards() {
  const fresh = cards.filter((c) => !c.exported);
  $("f-new-count").textContent = fresh.length;
  $("f-all-count").textContent = cards.length;
  $("cards-export").disabled = !fresh.length;
  $("cards-export").textContent = fresh.length ? `Exportar ${fresh.length} ${fresh.length === 1 ? "novo" : "novos"}` : "Exportar novos";
  $("cards-export-all").disabled = !cards.length;

  const list = (cardFilter === "new" ? fresh : cards).slice().reverse();
  if (!list.length) {
    $("card-list").innerHTML = `<div class="empty panel">${
      cards.length
        ? "Todos os cartoes ja foram exportados. Veja em <b>Todos</b>."
        : "Nenhum cartao ainda. No video, clique no <b>+</b> de uma frase (ou tecle <kbd>E</kbd>), ou use <b>Cartoes IA</b> no painel para a IA escolher as melhores frases."
    }</div>`;
    return;
  }
  $("card-list").innerHTML = list
    .map((c) => {
      const notes = (c.wordNotes || [])
        .map((n) => `<b>${escapeHtml(n.word)}</b>: ${escapeHtml(n.tr)}`)
        .join(" · ");
      return `<article class="card">
        <div class="card-front">${cardFrontHtml(c)}</div>
        ${c.translation ? `<div class="card-back">${escapeHtml(c.translation)}</div>` : ""}
        ${notes ? `<div class="card-notes">${notes}</div>` : ""}
        <div class="card-meta">
          ${c.exported ? "" : `<span class="pill blue">novo</span>`}
          ${c.source === "ai" ? `<span class="pill">IA</span>` : ""}
          <a href="${videoLink(c)}" target="_blank" rel="noopener">${escapeHtml(cleanTitle(c.title) || "YouTube")} · ${fmtTime(c.time)}</a>
          <button class="ghost" data-del="${escapeHtml(c.key)}">Apagar</button>
        </div>
      </article>`;
    })
    .join("");
}

document.querySelectorAll("[data-filter]").forEach((b) =>
  b.addEventListener("click", () => {
    cardFilter = b.dataset.filter;
    document
      .querySelectorAll("[data-filter]")
      .forEach((x) => x.classList.toggle("active", x === b));
    renderCards();
  }),
);

$("card-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-del]");
  if (!btn) return;
  cards = cards.filter((c) => c.key !== btn.dataset.del);
  await chrome.storage.local.set({ [CARDS_KEY]: cards });
});

async function onExport(onlyNew) {
  const n = await exportCards(onlyNew);
  toast(n ? `${n} cartoes exportados` : "Nenhum cartao para exportar");
}

$("cards-export").addEventListener("click", () => onExport(true));
$("cards-export-all").addEventListener("click", () => onExport(false));

/* ---------- Settings ---------- */

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

async function loadLlm() {
  const cfg = await getLlmConfig();
  llmConfigured = !!cfg.apiKey;
  $("llm-key").value = cfg.apiKey;
  $("llm-model").value = cfg.model;
  $("llm-url").value = cfg.baseUrl;
  $("llm-state").textContent = llmConfigured ? "configurada" : "sem chave";
  $("llm-state").className = `pill ${llmConfigured ? "green" : "yellow"}`;
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
  await loadLlm();
  renderHome();
});

$("llm-test").addEventListener("click", async () => {
  $("llm-msg").textContent = "Testando...";
  const res = await chrome.runtime.sendMessage({ type: "llm-test" }).catch((err) => ({
    error: String(err?.message || err),
  }));
  $("llm-msg").textContent = res?.ok
    ? "Funcionando ✓"
    : res?.error === "no-api-key"
      ? "Salve a chave primeiro"
      : `Erro: ${res?.error}`;
});

$("export-known").addEventListener("click", () => {
  downloadFile(
    JSON.stringify([...known].sort(), null, 2),
    `known-words-${today()}.json`,
    "application/json",
  );
});

$("import-known").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const arr = JSON.parse(await file.text());
    if (!Array.isArray(arr)) throw new Error("o JSON precisa ser uma lista de palavras");
    const before = known.size;
    for (const w of arr) if (typeof w === "string" && w) known.add(w.toLowerCase());
    await saveKnown();
    toast(`${known.size - before} palavras novas importadas`);
  } catch (err) {
    toast(`Erro ao importar: ${err.message}`);
  }
});

$("export-seen").addEventListener("click", () => {
  const entries = Object.entries(seen).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!entries.length) {
    toast("Nenhuma palavra vista ainda");
    return;
  }
  downloadFile(
    "palavra\tvezes\n" + entries.map(([w, c]) => `${w}\t${c}`).join("\n") + "\n",
    `vistas-${today()}.txt`,
  );
});

const CLEARS = {
  "clear-known": ["Apagar todas as palavras aprendidas?", { [STORAGE_KEY]: [] }],
  "clear-seen": [
    "Apagar o historico de palavras vistas? (as aprendidas nao sao afetadas)",
    { [SEEN_KEY]: {} },
  ],
  "clear-cards": ["Apagar todos os cartoes salvos?", { [CARDS_KEY]: [] }],
};

for (const [id, [question, value]] of Object.entries(CLEARS)) {
  $(id).addEventListener("click", async () => {
    if (!confirm(question)) return;
    await chrome.storage.local.set(value);
    toast("Apagado");
  });
}

/* ---------- Live sync (video tab and popup write to the same storage) ---------- */

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORAGE_KEY]) known = new Set(changes[STORAGE_KEY].newValue || []);
  if (changes[SEEN_KEY]) seen = changes[SEEN_KEY].newValue || {};
  if (changes[WORD_STATS_KEY]) wordStats = changes[WORD_STATS_KEY].newValue || {};
  if (changes[CARDS_KEY]) cards = changes[CARDS_KEY].newValue || [];
  if (changes[QUIZ_HISTORY_KEY]) history = changes[QUIZ_HISTORY_KEY].newValue || [];
  if (changes[SETTINGS_KEY]) {
    settings = { ...DEFAULT_SETTINGS, ...(changes[SETTINGS_KEY].newValue || {}) };
  }
  if (changes[LLM_KEY]) loadLlm().then(renderHome);
  renderAll();
});

load();
