const STORAGE_KEY = "knownWords";
const SEEN_KEY = "seenWords";

let knownWords = new Set();
let seenWords = {};
let seenInVideo = new Set();
let currentVideoId = null;
let captionObserver = null;
let panel = null;
let isMutating = false;
let seenSaveTimer = null;

async function loadKnownWords() {
  const data = await chrome.storage.local.get([STORAGE_KEY, SEEN_KEY]);
  knownWords = new Set(data[STORAGE_KEY] || []);
  seenWords = data[SEEN_KEY] || {};
}

async function saveKnownWords() {
  await chrome.storage.local.set({ [STORAGE_KEY]: [...knownWords] });
}

function scheduleSeenSave() {
  if (seenSaveTimer) return;
  seenSaveTimer = setTimeout(() => {
    seenSaveTimer = null;
    chrome.storage.local.set({ [SEEN_KEY]: seenWords });
  }, 1000);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORAGE_KEY]) {
    knownWords = new Set(changes[STORAGE_KEY].newValue || []);
    reprocessAllSegments();
    updatePanel();
  }
  if (changes[SEEN_KEY]) {
    seenWords = changes[SEEN_KEY].newValue || {};
  }
});

const WORD_RE = /[a-zA-ZÀ-ÿ']+/g;

function normalizeWord(w) {
  return w.toLowerCase().replace(/^'+|'+$/g, "");
}

function tokenize(text) {
  const matches = text.match(WORD_RE) || [];
  return matches.map(normalizeWord).filter((w) => w.length >= 1);
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

function buildSegmentHTML(text) {
  const parts = text.split(/(\s+)/);
  return parts
    .map((part) => {
      if (!part) return "";
      if (/^\s+$/.test(part)) return part;
      const match = part.match(WORD_RE);
      if (!match) return escapeHtml(part);
      const word = normalizeWord(match[0]);
      if (word.length < 1) return escapeHtml(part);
      const cls = knownWords.has(word) ? "known" : "new";
      return `<span class="yt-eng-word yt-eng-${cls}" data-yt-eng-word="${escapeHtml(
        word,
      )}">${escapeHtml(part)}</span>`;
    })
    .join("");
}

function processSegment(seg) {
  const currentText = seg.textContent;
  if (!currentText) return;
  if (
    seg.dataset.ytEngText === currentText &&
    seg.querySelector(".yt-eng-word")
  ) {
    return;
  }
  for (const w of tokenize(currentText)) {
    if (seenInVideo.has(w)) continue;
    seenInVideo.add(w);
    seenWords[w] = (seenWords[w] || 0) + 1;
    scheduleSeenSave();
  }
  isMutating = true;
  seg.innerHTML = buildSegmentHTML(currentText);
  seg.dataset.ytEngText = currentText;
  isMutating = false;
}

function processAllSegments() {
  const segs = document.querySelectorAll(".ytp-caption-segment");
  segs.forEach(processSegment);
  updatePanel();
}

function reprocessAllSegments() {
  const segs = document.querySelectorAll(".ytp-caption-segment");
  isMutating = true;
  segs.forEach((seg) => {
    const text = seg.dataset.ytEngText || seg.textContent;
    if (!text) return;
    seg.innerHTML = buildSegmentHTML(text);
    seg.dataset.ytEngText = text;
  });
  isMutating = false;
}

function startCaptionObserver() {
  if (captionObserver) captionObserver.disconnect();
  const player = document.getElementById("movie_player") || document.body;
  captionObserver = new MutationObserver((mutations) => {
    if (isMutating) return;
    let hasCaptionChange = false;
    for (const m of mutations) {
      const target = m.target;
      if (!(target instanceof Element) && !(target.parentElement)) continue;
      const el = target instanceof Element ? target : target.parentElement;
      if (el && el.closest(".ytp-caption-segment, .caption-window")) {
        hasCaptionChange = true;
        break;
      }
    }
    if (hasCaptionChange) processAllSegments();
  });
  captionObserver.observe(player, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  processAllSegments();
}

function onWordClick(e) {
  const el = e.target.closest(".yt-eng-word, .yt-eng-chip");
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  const word = el.dataset.ytEngWord || el.dataset.word;
  if (!word) return;
  if (knownWords.has(word)) knownWords.delete(word);
  else knownWords.add(word);
  saveKnownWords();
  reprocessAllSegments();
  updatePanel();
}

document.addEventListener("click", onWordClick, true);

function createPanel() {
  if (document.getElementById("yt-eng-ext-panel")) {
    panel = document.getElementById("yt-eng-ext-panel");
    return;
  }
  panel = document.createElement("div");
  panel.id = "yt-eng-ext-panel";
  panel.innerHTML = `
    <div class="yt-eng-header">
      <span class="yt-eng-title">
        <svg class="yt-eng-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        English Study
      </span>
      <button class="yt-eng-btn-icon" id="yt-eng-toggle" title="Minimizar">—</button>
    </div>
    <div class="yt-eng-body">
      <div class="yt-eng-stats">
        <div><span id="yt-eng-known-count">0</span><small>conhecidas</small></div>
        <div><span id="yt-eng-new-count">0</span><small>novas no video</small></div>
        <div><span id="yt-eng-seen-count">0</span><small>vistas no video</small></div>
      </div>
      <div class="yt-eng-section">
        <div class="yt-eng-label-row">
          <div class="yt-eng-label">Novas palavras <small>(clique para marcar como conhecida)</small></div>
          <button class="yt-eng-btn-icon" id="yt-eng-export-video" title="Exportar as novas do video como .txt">
            <svg class="yt-eng-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Exportar
          </button>
        </div>
        <div id="yt-eng-new-list" class="yt-eng-chips"></div>
      </div>
      <div class="yt-eng-hint-box">
        As palavras aparecem coloridas direto na legenda do video.<br>
        <b>Verde</b> = conhecida · <b>Amarela</b> = nova. Clique em qualquer palavra para alternar.
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  panel.querySelector("#yt-eng-toggle").addEventListener("click", () => {
    panel.classList.toggle("collapsed");
    panel.querySelector("#yt-eng-toggle").textContent =
      panel.classList.contains("collapsed") ? "+" : "—";
  });

  panel.querySelector("#yt-eng-export-video").addEventListener("click", exportVideoUnknown);
}

function sanitizeFilename(s) {
  return s.replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").slice(0, 50);
}

function downloadText(content, filename) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportVideoUnknown() {
  const words = [...seenInVideo].filter((w) => !knownWords.has(w)).sort();
  if (!words.length) {
    alert("Nenhuma palavra nova neste video ainda.");
    return;
  }
  const rawTitle = document.title.replace(/ - YouTube$/, "").trim();
  const slug = sanitizeFilename(rawTitle) || currentVideoId || "video";
  downloadText(words.join("\n") + "\n", `novas-${slug}.txt`);
}

function updatePanel() {
  if (!panel) return;
  const newOnes = [...seenInVideo].filter((w) => !knownWords.has(w)).sort();
  const list = panel.querySelector("#yt-eng-new-list");
  if (list) {
    list.innerHTML = newOnes
      .map(
        (w) =>
          `<span class="yt-eng-chip" data-yt-eng-word="${escapeHtml(w)}">${escapeHtml(w)}</span>`,
      )
      .join("");
  }
  const knownEl = panel.querySelector("#yt-eng-known-count");
  const newEl = panel.querySelector("#yt-eng-new-count");
  const seenEl = panel.querySelector("#yt-eng-seen-count");
  if (knownEl) knownEl.textContent = knownWords.size;
  if (newEl) newEl.textContent = newOnes.length;
  if (seenEl) seenEl.textContent = seenInVideo.size;
}

function getVideoIdFromUrl() {
  try {
    const u = new URL(location.href);
    if (u.pathname !== "/watch") return null;
    return u.searchParams.get("v");
  } catch {
    return null;
  }
}

function onVideoChange() {
  const id = getVideoIdFromUrl();
  if (id === currentVideoId) return;
  currentVideoId = id;
  seenInVideo = new Set();
  if (!id) {
    if (panel) panel.style.display = "none";
    return;
  }
  if (!panel) createPanel();
  panel.style.display = "";
  updatePanel();
  waitForPlayerAndObserve();
}

function waitForPlayerAndObserve() {
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    if (document.getElementById("movie_player")) {
      startCaptionObserver();
      clearInterval(iv);
    } else if (tries > 40) {
      clearInterval(iv);
    }
  }, 500);
}

document.addEventListener("yt-navigate-finish", onVideoChange);
window.addEventListener("popstate", onVideoChange);

(async function init() {
  await loadKnownWords();
  onVideoChange();
})();
