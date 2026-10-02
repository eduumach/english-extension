// Demo harness for store screenshots: runs the built hub outside the extension with a fake
// chrome.storage / runtime filled with sample data. See store/demo/serve.sh.
const DAY = 86_400_000;
const now = Date.now();
const midnight = new Date().setHours(0, 0, 0, 0);
const VIDEO = "arj7oStGLkU";
const TITLE = "Inside the Mind of a Master Procrastinator | Tim Urban | TED";

const filler = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix}${i.toString(36)}`);

const study = {
  reluctant: 9, deadline: 8, procrastination: 7, awesome: 6, revised: 6, gratification: 5,
  overwhelming: 5, panic: 5, instant: 4, rational: 4, thrilled: 4, intern: 3, wheel: 3, scary: 3,
  essay: 3, frankly: 2, dormant: 2, insight: 2,
};
const known = [
  "the", "and", "to", "of", "a", "in", "is", "it", "you", "that", "was", "for", "on", "are", "with",
  "as", "i", "his", "they", "be", "at", "one", "have", "this", "from", "or", "had", "by", "word",
  "but", "what", "some", "we", "can", "out", "other", "were", "all", "there", "when", "up", "use",
  "your", "how", "said", "an", "each", "she", "which", "do", "their", "time", "if", "will", "way",
  "about", "many", "then", "them", "write", "would", "like", "so", "these", "her", "long", "make",
  "thing", "see", "him", "two", "has", "look", "more", "day", "could", "go", "come", "did", "number",
  "sound", "no", "most", "people", "my", "over", "know", "water", "than", "call", "first", "who",
  ...filler(1180, "kw"),
];
const seen = Object.fromEntries([...Object.entries(study), ...known.map((w, i) => [w, 3 + (i % 9)]), ...filler(360, "sw").map((w) => [w, 1])]);

const card = (i, sentence, words, translation, notes, time, srs) => ({
  key: `${VIDEO}|${time * 1000}`, videoId: VIDEO, title: TITLE, time, sentence, words, translation,
  wordNotes: notes, ts: now - (30 - i) * DAY, lang: "en", ...(srs ? { srs } : {}),
});
const due = (days, interval, reps) => ({ due: midnight + days * DAY, interval, ease: 2.5, reps, lapses: 0 });
const cards = [
  card(0, "I was reluctant to admit it, but the plan worked.", ["reluctant", "admit"], "Eu relutei em admitir, mas o plano funcionou.",
    [{ word: "reluctant", tr: "relutante" }, { word: "admit", tr: "admitir" }], 72, due(-1, 3, 2)),
  card(1, "And then the deadline was two days away.", ["deadline"], "E então o prazo era em dois dias.",
    [{ word: "deadline", tr: "prazo final" }], 112, due(0, 1, 1)),
  card(2, "The Instant Gratification Monkey takes the wheel.", ["instant", "gratification", "wheel"], "O Macaco da Gratificação Instantânea assume o volante.",
    [{ word: "gratification", tr: "gratificação" }, { word: "take the wheel", tr: "assumir o controle" }], 287),
  card(3, "The Panic Monster is dormant most of the time.", ["panic", "dormant"], "O Monstro do Pânico fica adormecido na maior parte do tempo.",
    [{ word: "dormant", tr: "adormecido, inativo" }], 431),
  card(4, "It's the rational decision-maker who makes plans.", ["rational"], "É o tomador de decisões racional que faz os planos.",
    [{ word: "rational", tr: "racional" }], 248, due(4, 4, 2)),
  card(5, "I was thrilled, and I wrote ninety pages over seventy-two hours.", ["thrilled"], "Fiquei empolgado e escrevi noventa páginas em setenta e duas horas.",
    [{ word: "thrilled", tr: "empolgado, muito feliz" }], 118, due(12, 12, 3)),
];

const wordSrs = {
  reluctant: due(-1, 3, 2), deadline: due(0, 1, 1), awesome: due(0, 3, 2), revised: due(0, 1, 1),
  procrastination: due(6, 8, 3), panic: due(2, 3, 2),
};
const quizHistory = [
  [6, 8, "How to Speak | Patrick Winston"], [7, 8, TITLE], [5, 8, "Why We Sleep | Matt Walker"],
  [8, 8, "The Power of Vulnerability | Brené Brown"], [6, 7, "Steve Jobs' 2005 Stanford Commencement Address"],
  [7, 8, "Grit: the power of passion and perseverance"],
].map(([correct, total, title], i) => ({ ts: now - (6 - i) * DAY, videoId: VIDEO, title, correct, total }));

const store = {
  settings: { enabled: true, studyLang: "en", targetLang: "pt", autoPause: false, pauseOnHover: true, quizAfterVideo: true },
  knownWords: known, seenWords: seen, cards, wordSrs, quizHistory, wordStats: {},
  llm: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKey: "demo" },
};

const LOOKUP = {
  reluctant: { phonetic: "/rɪˈlʌktənt/", translation: "relutante",
    alternatives: [{ pos: "adjective", terms: ["relutante", "hesitante", "contrariado"] }],
    definitions: [{ pos: "adjective", definition: "Unwilling and hesitant; disinclined.", example: "" }] },
};
const EXAMPLES = {
  reluctant: [{ text: "Tom seemed reluctant to help.", translation: "Tom parecia relutante em ajudar." }],
};

const listeners = new Set();
const clone = (v) => (v === undefined ? v : structuredClone(v));
globalThis.chrome = {
  runtime: {
    id: "demo",
    getURL: (p) => p,
    sendMessage: async (msg) => {
      if (msg.type === "lookup") return { word: msg.word, ...(LOOKUP[msg.word] || { translation: msg.word }) };
      if (msg.type === "examples") return { examples: EXAMPLES[msg.word] || [] };
      return { ok: true };
    },
  },
  storage: {
    local: {
      get: async (keys) => {
        const list = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, clone(store[k])]));
      },
      set: async (obj) => {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
          changes[k] = { oldValue: store[k], newValue: clone(v) };
          store[k] = clone(v);
        }
        listeners.forEach((fn) => fn(changes, "local"));
      },
    },
    onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
  },
  permissions: { request: async () => true },
  tabs: { create: () => {} },
};
