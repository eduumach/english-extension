// Storage keys and helpers shared by the popup and the hub.
export const STORAGE_KEY = "knownWords";
export const SEEN_KEY = "seenWords";
export const SETTINGS_KEY = "settings";
export const WORD_STATS_KEY = "wordStats";
export const QUIZ_HISTORY_KEY = "quizHistory";
export const CARDS_KEY = "cards";
export const DEFAULT_SETTINGS = {
  enabled: true,
  targetLang: "pt",
  autoPause: false,
  pauseOnHover: true,
  quizAfterVideo: true,
};

export type Settings = typeof DEFAULT_SETTINGS;

export type Card = {
  key: string;
  videoId: string;
  title?: string;
  time?: number;
  sentence: string;
  words?: string[];
  translation?: string;
  wordNotes?: { word: string; tr: string }[];
  source?: string;
  exported?: boolean;
};

export type QuizResult = {
  videoId?: string;
  title?: string;
  ts: number;
  correct: number;
  total: number;
};

export type WordStats = Record<string, { ok: number; fail: number }>;

export function escapeHtml(s: unknown) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function downloadFile(content: string, filename: string, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function quizAccuracy(history: QuizResult[]) {
  const total = history.reduce((a, h) => a + h.total, 0);
  return total ? Math.round((history.reduce((a, h) => a + h.correct, 0) / total) * 100) : null;
}

// Titles saved before the fix may carry YouTube's "(12) " notification counter.
export function cleanTitle(s?: string) {
  return String(s || "").replace(/^\(\d+\+?\)\s*/, "");
}

export function videoLink(c: Pick<Card, "videoId" | "time">) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(c.videoId)}&t=${c.time || 0}s`;
}

export function fmtTime(sec?: number) {
  const s = Math.floor(sec || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export const WORD_RE = /[a-zA-ZÀ-ÿ']+/g;

export function normalizeWord(m: string) {
  return m.toLowerCase().replace(/^'+|'+$/g, "");
}

// Sentence as HTML with the card's focus words in bold.
function cardFrontHtml(c: Card) {
  const words = new Set(c.words || []);
  return c.sentence.replace(WORD_RE, (m) =>
    words.has(normalizeWord(m)) ? `<b>${escapeHtml(m)}</b>` : escapeHtml(m),
  );
}

// Anki text import: tab-separated, HTML fields, tags in column 3.
function cardsToAnki(cards: Card[]) {
  const clean = (s: string) => String(s).replace(/[\t\r\n]+/g, " ");
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
export async function exportCards(onlyNew: boolean) {
  const data = await browser.storage.local.get(CARDS_KEY);
  const cards = (data[CARDS_KEY] as Card[] | undefined) || [];
  const selected = onlyNew ? cards.filter((c) => !c.exported) : cards;
  if (!selected.length) return 0;
  downloadFile(cardsToAnki(selected), `anki-frases-${today()}.txt`);
  await browser.storage.local.set({
    [CARDS_KEY]: cards.map((c) => ({ ...c, exported: true })),
  });
  return selected.length;
}

export function openHub(section = "") {
  browser.tabs.create({ url: browser.runtime.getURL(`/hub.html${section ? `#${section}` : ""}`) });
}
