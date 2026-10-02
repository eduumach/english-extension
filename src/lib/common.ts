// Storage keys and helpers shared by the popup and the hub.
import { LLM_KEY } from "./llm";

export const STORAGE_KEY = "knownWords";
export const SEEN_KEY = "seenWords";
export const SETTINGS_KEY = "settings";
export const WORD_STATS_KEY = "wordStats";
export const QUIZ_HISTORY_KEY = "quizHistory";
export const CARDS_KEY = "cards";
export const WORD_SRS_KEY = "wordSrs";
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
  ts?: number;
  srs?: Srs;
};

// Spaced-repetition state. A card without it is new and due right away.
export type Srs = {
  due: number; // ms timestamp
  interval: number; // days; 0 while relearning
  ease: number;
  reps: number; // consecutive successful reviews
  lapses: number;
};

export type Grade = 0 | 1 | 2 | 3; // again, hard, good, easy

export type WordSrs = Record<string, Srs>;

export type QuizResult = {
  videoId?: string;
  title?: string;
  ts: number;
  correct: number;
  total: number;
};

export type WordStats = Record<string, { ok: number; fail: number }>;

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

const DAY_MS = 86_400_000;
const RELEARN_MS = 10 * 60_000;

export function isDue(c: Card, now = Date.now()) {
  return !c.srs || c.srs.due <= now;
}

// Due cards in review order: already-studied ones first (oldest due), then new ones (oldest created).
export function dueCards(cards: Card[], now = Date.now()) {
  return cards
    .filter((c) => isDue(c, now))
    .sort((a, b) => (a.srs ? a.srs.due : Infinity) - (b.srs ? b.srs.due : Infinity) || (a.ts || 0) - (b.ts || 0));
}

// SM-2 as Anki does it: intervals in whole days, due at local midnight so a
// card scheduled for "tomorrow" shows up all of tomorrow.
export function schedule(prev: Srs | undefined, grade: Grade, now = Date.now()): Srs {
  const s = prev || { due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0 };
  if (grade === 0) {
    return {
      due: now + RELEARN_MS,
      interval: 0,
      ease: Math.max(1.3, s.ease - 0.2),
      reps: 0,
      lapses: s.lapses + (s.reps > 0 ? 1 : 0),
    };
  }
  const ease = Math.max(1.3, s.ease + (grade === 1 ? -0.15 : grade === 3 ? 0.15 : 0));
  let interval: number;
  if (s.reps === 0) interval = grade === 3 ? 4 : 1;
  else if (s.reps === 1 && grade === 2) interval = 3;
  else {
    const factor = grade === 1 ? 1.2 : grade === 2 ? s.ease : s.ease * 1.3;
    interval = Math.max(s.interval + 1, Math.round(s.interval * factor));
  }
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  return { due: midnight + interval * DAY_MS, interval, ease, reps: s.reps + 1, lapses: s.lapses };
}

function fmtDays(d: number) {
  if (d < 30) return `${d} ${d === 1 ? "dia" : "dias"}`;
  if (d < 365) {
    const m = Math.round(d / 30);
    return `${m} ${m === 1 ? "mês" : "meses"}`;
  }
  const y = Math.round(d / 365);
  return `${y} ${y === 1 ? "ano" : "anos"}`;
}

// Time left until a timestamp, e.g. "10 min", "5 h", "3 dias".
export function fmtUntil(ts: number, now = Date.now()) {
  const ms = Math.max(0, ts - now);
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < DAY_MS) return `${Math.round(ms / 3_600_000)} h`;
  return fmtDays(Math.ceil(ms / DAY_MS));
}

// Interval a review button would give, shown under the button.
export function fmtInterval(srs: Srs, now = Date.now()) {
  return srs.interval ? fmtDays(srs.interval) : fmtUntil(srs.due, now);
}

// Words never reviewed enter a session in small batches, most frequent first.
export const NEW_WORDS_PER_SESSION = 10;
// A word reviewed well enough to wait this long counts as learned.
export const GRADUATE_DAYS = 21;

// Study words (seen, not known) that are due: reviewed ones by due date, then new ones by frequency.
export function dueWords(studyWords: [string, number][], wordSrs: WordSrs, now = Date.now()) {
  const review = studyWords
    .filter(([w]) => wordSrs[w] && wordSrs[w].due <= now)
    .map(([w]) => w)
    .sort((a, b) => wordSrs[a]!.due - wordSrs[b]!.due);
  const fresh = studyWords.filter(([w]) => !wordSrs[w]).map(([w]) => w);
  return { review, fresh };
}

export async function setWordSrs(word: string, srs: Srs) {
  const data = await browser.storage.local.get(WORD_SRS_KEY);
  await browser.storage.local.set({ [WORD_SRS_KEY]: { ...(data[WORD_SRS_KEY] as WordSrs | undefined), [word]: srs } });
}

// Read-modify-write against fresh storage: the content script may append cards meanwhile.
export async function updateCards(fn: (cards: Card[]) => Card[]) {
  const data = await browser.storage.local.get(CARDS_KEY);
  await browser.storage.local.set({ [CARDS_KEY]: fn((data[CARDS_KEY] as Card[] | undefined) || []) });
}

// Everything the user builds up. The LLM config goes too, minus the API key (a secret
// shouldn't sit in a backup file); restoring keeps the key already configured.
const BACKUP_KEYS = [
  STORAGE_KEY,
  SEEN_KEY,
  SETTINGS_KEY,
  WORD_STATS_KEY,
  QUIZ_HISTORY_KEY,
  CARDS_KEY,
  WORD_SRS_KEY,
  LLM_KEY,
];
const BACKUP_APP = "youtube-english-study";

// `legacy`: an old known-words list, merged into the current words instead of replacing them.
export type Backup = { exportedAt?: string; legacy?: boolean; data: Record<string, unknown> };

export async function exportBackup() {
  const data = await browser.storage.local.get(BACKUP_KEYS);
  if (data[LLM_KEY]) data[LLM_KEY] = { ...(data[LLM_KEY] as object), apiKey: undefined };
  const file = { app: BACKUP_APP, version: 1, exportedAt: new Date().toISOString(), data };
  downloadFile(JSON.stringify(file), `english-study-backup-${today()}.json`, "application/json");
}

// Also accepts the old "known words" export (a plain JSON list).
export function parseBackup(text: string): Backup {
  const json = JSON.parse(text);
  if (Array.isArray(json)) {
    return { legacy: true, data: { [STORAGE_KEY]: json.filter((w) => typeof w === "string" && w).map((w) => w.toLowerCase()) } };
  }
  if (json?.app !== BACKUP_APP || typeof json.data !== "object") {
    throw new Error("este arquivo não é um backup da extensão");
  }
  const data = Object.fromEntries(Object.entries(json.data).filter(([k]) => BACKUP_KEYS.includes(k)));
  return { exportedAt: json.exportedAt, data };
}

// Replaces the current data with the backup's. Keys missing from the backup are left alone.
export async function restoreBackup({ data, legacy }: Backup) {
  const current = await browser.storage.local.get([LLM_KEY, STORAGE_KEY]);
  const next = { ...data };
  if (legacy) {
    next[STORAGE_KEY] = [...new Set([...((current[STORAGE_KEY] as string[]) || []), ...(next[STORAGE_KEY] as string[])])];
  }
  if (next[LLM_KEY]) {
    const apiKey = (current[LLM_KEY] as { apiKey?: string } | undefined)?.apiKey;
    next[LLM_KEY] = { ...(next[LLM_KEY] as object), ...(apiKey ? { apiKey } : {}) };
  }
  await browser.storage.local.set(next);
}

export function openHub(section = "") {
  browser.tabs.create({ url: browser.runtime.getURL(`/hub.html${section ? `#${section}` : ""}`) });
}
