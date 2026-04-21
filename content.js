const STORAGE_KEY = "knownWords";

let knownWords = new Set();
let seenInVideo = new Set();
let currentVideoId = null;
let captionObserver = null;
let panel = null;
let isMutating = false;

async function loadKnownWords() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  knownWords = new Set(data[STORAGE_KEY] || []);
}

async function saveKnownWords() {
  await chrome.storage.local.set({ [STORAGE_KEY]: [...knownWords] });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    knownWords = new Set(changes[STORAGE_KEY].newValue || []);
    reprocessAllSegments();
    updatePanel();
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
  for (const w of tokenize(currentText)) seenInVideo.add(w);
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
      <span class="yt-eng-title">📘 English Study</span>
      <button class="yt-eng-btn-icon" id="yt-eng-toggle" title="Minimizar">—</button>
    </div>
    <div class="yt-eng-body">
      <div class="yt-eng-stats">
        <div><span id="yt-eng-known-count">0</span><small>conhecidas</small></div>
        <div><span id="yt-eng-new-count">0</span><small>novas no video</small></div>
        <div><span id="yt-eng-seen-count">0</span><small>vistas no video</small></div>
      </div>
      <div class="yt-eng-section">
        <div class="yt-eng-label">Novas palavras <small>(clique para marcar como conhecida)</small></div>
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
