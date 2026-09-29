// Storage keys and helpers shared by popup.js and hub.js.
const STORAGE_KEY = "knownWords";
const SEEN_KEY = "seenWords";
const SETTINGS_KEY = "settings";
const WORD_STATS_KEY = "wordStats";
const QUIZ_HISTORY_KEY = "quizHistory";
const CARDS_KEY = "cards";
const DEFAULT_SETTINGS = {
  enabled: true,
  targetLang: "pt",
  autoPause: false,
  pauseOnHover: true,
  quizAfterVideo: true,
};

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s).replace(
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

function today() {
  return new Date().toISOString().slice(0, 10);
}

function downloadFile(content, filename, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function quizAccuracy(history) {
  const total = history.reduce((a, h) => a + h.total, 0);
  return total ? Math.round((history.reduce((a, h) => a + h.correct, 0) / total) * 100) : null;
}

// Titles saved before the fix may carry YouTube's "(12) " notification counter.
function cleanTitle(s) {
  return String(s || "").replace(/^\(\d+\+?\)\s*/, "");
}

function videoLink(c) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(c.videoId)}&t=${c.time || 0}s`;
}

// Sentence as HTML with the card's focus words in bold.
function cardFrontHtml(c) {
  const words = new Set(c.words || []);
  return c.sentence.replace(/[a-zA-ZÀ-ÿ']+/g, (m) => {
    const w = m.toLowerCase().replace(/^'+|'+$/g, "");
    return words.has(w) ? `<b>${escapeHtml(m)}</b>` : escapeHtml(m);
  });
}

// Anki text import: tab-separated, HTML fields, tags in column 3.
function cardsToAnki(cards) {
  const clean = (s) => String(s).replace(/[\t\r\n]+/g, " ");
  const rows = cards.map((c) => {
    const notes = (c.wordNotes || [])
      .map((n) => `<b>${escapeHtml(n.word)}</b>: ${escapeHtml(n.tr)}`)
      .join("<br>");
    const back = [
      escapeHtml(c.translation || ""),
      notes,
      `<a href="${videoLink(c)}">${escapeHtml(cleanTitle(c.title) || "YouTube")}</a>`,
    ]
      .filter(Boolean)
      .join("<br><br>");
    return [clean(cardFrontHtml(c)), clean(back), "youtube-english"].join("\t");
  });
  return "#separator:tab\n#html:true\n#tags column:3\n" + rows.join("\n") + "\n";
}

// Downloads the cards as an Anki .txt and flags them as exported.
// Returns how many were exported.
async function exportCards(onlyNew) {
  const data = await chrome.storage.local.get(CARDS_KEY);
  const cards = data[CARDS_KEY] || [];
  const selected = onlyNew ? cards.filter((c) => !c.exported) : cards;
  if (!selected.length) return 0;
  downloadFile(cardsToAnki(selected), `anki-frases-${today()}.txt`);
  await chrome.storage.local.set({
    [CARDS_KEY]: cards.map((c) => ({ ...c, exported: true })),
  });
  return selected.length;
}

function openHub(section = "") {
  chrome.tabs.create({ url: chrome.runtime.getURL(`hub.html${section ? `#${section}` : ""}`) });
}
