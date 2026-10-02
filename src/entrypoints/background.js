// Network calls run here to avoid CORS restrictions on content-script fetches.
import { chatJSON, getLlmConfig } from "@/lib/llm";

export default defineBackground(() => {
  const cache = new Map();

  // "OFF" badge on the toolbar icon while the extension is disabled.
  function updateBadge(settings) {
    chrome.action.setBadgeText({ text: settings?.enabled === false ? "OFF" : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#555" });
  }

  async function syncBadge() {
    updateBadge((await chrome.storage.local.get("settings")).settings);
  }

  chrome.runtime.onStartup.addListener(syncBadge);
  chrome.runtime.onInstalled.addListener(syncBadge);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) updateBadge(changes.settings.newValue);
  });

  const handlers = {
    lookup: (msg) => lookup(msg.word, msg.tl || "pt"),
    quiz: (msg) => generateQuiz(msg.items, msg.tl || "pt"),
    "ai-cards": (msg) => generateCards(msg.items, msg.unknown || [], msg.tl || "pt", msg.max || 8),
    "card-back": (msg) => cardBack(msg.sentence, msg.words || [], msg.tl || "pt"),
    examples: (msg) => examples(msg.word, msg.tl || "pt"),
    "open-hub": async () => {
      await chrome.tabs.create({ url: chrome.runtime.getURL("/hub.html") });
      return { ok: true };
    },
    "llm-status": async () => ({ configured: !!(await getLlmConfig()).apiKey }),
    "llm-test": async () => {
      await chatJSON([{ role: "user", content: 'Reply with the JSON {"ok": true}' }], {
        timeoutMs: 20000,
      });
      return { ok: true };
    },
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const handler = handlers[msg?.type];
    if (!handler) return;
    handler(msg).then(sendResponse, (err) =>
      sendResponse({ error: String(err?.message || err) }),
    );
    return true;
  });

  async function lookup(word, tl) {
    const key = `${word}|${tl}`;
    if (cache.has(key)) return cache.get(key);
    const [tr, dict] = await Promise.all([
      translateWord(word, tl).catch(() => null),
      defineWord(word).catch(() => null),
    ]);
    if (!tr && !dict) throw new Error("lookup failed");
    const result = { word, ...(tr || {}), ...(dict || {}) };
    cache.set(key, result);
    return result;
  }

  async function translateText(text, tl) {
    const url =
      "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en" +
      `&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data[0] || []).map((x) => x[0]).join("");
  }

  async function cardBack(sentence, words, tl) {
    const [translation, notes] = await Promise.all([
      translateText(sentence, tl).catch(() => ""),
      Promise.all(
        words.slice(0, 6).map((word) =>
          translateWord(word, tl).then(
            (r) => ({ word, tr: r.translation }),
            () => ({ word, tr: "" }),
          ),
        ),
      ),
    ]);
    return { translation, words: notes.filter((n) => n.tr && n.tr.toLowerCase() !== n.word) };
  }

  async function translateWord(word, tl) {
    const url =
      "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en" +
      `&tl=${encodeURIComponent(tl)}&dt=t&dt=bd&q=${encodeURIComponent(word)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const translation = (data[0] || []).map((x) => x[0]).join("");
    const alternatives = (data[1] || []).map(([pos, terms]) => ({
      pos,
      terms: (terms || []).slice(0, 5),
    }));
    return { translation, alternatives };
  }

  // dictionaryapi.dev sometimes hangs for ~20s before failing; the lookup waits for it,
  // so cap the wait and skip it for a while once it looks down.
  const DICT_TIMEOUT_MS = 2500;
  const DICT_BACKOFF_MS = 5 * 60_000;
  let dictDownUntil = 0;

  async function defineWord(word) {
    if (Date.now() < dictDownUntil) return null;
    let res;
    try {
      res = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
        { signal: AbortSignal.timeout(DICT_TIMEOUT_MS) },
      );
    } catch (err) {
      dictDownUntil = Date.now() + DICT_BACKOFF_MS;
      throw err;
    }
    if (res.status >= 500) dictDownUntil = Date.now() + DICT_BACKOFF_MS;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const entries = await res.json();
    const entry = entries[0];
    if (!entry) return null;
    const phonetic =
      entry.phonetic || (entry.phonetics || []).find((p) => p.text)?.text || "";
    const definitions = [];
    for (const m of entries.flatMap((e) => e.meanings || [])) {
      for (const d of (m.definitions || []).slice(0, 2)) {
        definitions.push({
          pos: m.partOfSpeech,
          definition: d.definition,
          example: d.example || "",
        });
      }
    }
    return { phonetic, definitions: definitions.slice(0, 4) };
  }

  // Tatoeba uses ISO 639-3 codes.
  const TATOEBA_LANGS = { pt: "por", es: "spa", fr: "fra", de: "deu", it: "ita", ja: "jpn" };
  const exampleCache = new Map();

  // Example sentences with the word, from Tatoeba (free, human-written, with translations).
  // -> { examples: [{ text, translation }] }
  async function examples(word, tl) {
    const key = `${word}|${tl}`;
    if (exampleCache.has(key)) return exampleCache.get(key);
    const to = TATOEBA_LANGS[tl] || "por";
    // The legacy search matches the exact word; the newer API stems it ("reluctant" ->
    // "reluctantly"), so it's only the fallback.
    let list = (await tatoebaLegacy(word, to).catch(() => [])).filter((e) => e.translation);
    if (!list.length) list = (await tatoebaNew(word, to).catch(() => [])).filter((e) => e.translation);
    const result = { examples: list.slice(0, 5) };
    exampleCache.set(key, result);
    return result;
  }

  function pickTranslation(translations, to) {
    return translations.flat().find((t) => t?.lang === to)?.text || "";
  }

  async function tatoebaLegacy(word, to) {
    const url =
      "https://tatoeba.org/en/api_v0/search?from=eng&orphans=no&unapproved=no&sort=relevance" +
      `&to=${to}&query=${encodeURIComponent(`=${word}`)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.results || []).map((r) => ({ text: r.text, translation: pickTranslation(r.translations || [], to) }));
  }

  async function tatoebaNew(word, to) {
    const url =
      "https://api.tatoeba.org/unstable/sentences?lang=eng&sort=relevance&limit=10" +
      `&trans:lang=${to}&q=${encodeURIComponent(word)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.data || []).map((r) => ({ text: r.text, translation: pickTranslation(r.translations || [], to) }));
  }

  const LANG_NAMES = {
    pt: "Brazilian Portuguese",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian",
    ja: "Japanese",
  };

  // items: [{ word, context }] -> { questions: [{ word, type, question, options, answer, explanation }] }
  async function generateQuiz(items, tl) {
    const lang = LANG_NAMES[tl] || LANG_NAMES.pt;
    const system =
      `You are a friendly English tutor. The student's native language is ${lang}. ` +
      "You write short multiple-choice exercises that check whether the student really knows a word. " +
      "Respond only with JSON.";
    const user = `Create exactly one exercise per word below. Vary the type:
  - "meaning": choose the correct ${lang} meaning of the word as used in its context sentence
  - "fill_blank": a NEW short English sentence with "___" where the word goes; options are English words
  - "usage": choose the English sentence that uses the word correctly
  Rules: 4 options, exactly one correct, plausible distractors, short question in English, explanation in ${lang} (one sentence). Use the sense the word has in its context sentence.

  Words:
  ${items.map((it, i) => `${i + 1}. "${it.word}" (context: "${it.context.slice(0, 200)}")`).join("\n")}

  JSON format: {"questions":[{"word":"...","type":"meaning|fill_blank|usage","question":"...","options":["...","...","...","..."],"answer":0,"explanation":"..."}]}`;

    const out = await chatJSON([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    const wanted = new Set(items.map((it) => it.word));
    const questions = (out.questions || [])
      .map((q) => ({ ...q, word: String(q.word || "").toLowerCase() }))
      .filter(
        (q) =>
          wanted.has(q.word) &&
          Array.isArray(q.options) &&
          q.options.length >= 2 &&
          Number.isInteger(q.answer) &&
          q.answer >= 0 &&
          q.answer < q.options.length,
      )
      .map(shuffleOptions);
    if (!questions.length) throw new Error("the model returned no valid questions");
    return { questions };
  }

  // Models tend to put the right answer in the same slot; reshuffle.
  function shuffleOptions(q) {
    const order = q.options.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return {
      word: q.word,
      type: q.type,
      question: String(q.question || ""),
      options: order.map((i) => String(q.options[i])),
      answer: order.indexOf(q.answer),
      explanation: String(q.explanation || ""),
    };
  }

  // items: [{ i, text }] transcript lines -> { cards: [{ lineStart, lineEnd, focus, translation, explanation }] }
  async function generateCards(items, unknown, tl, max) {
    const lang = LANG_NAMES[tl] || LANG_NAMES.pt;
    const system =
      `You are an English tutor helping a ${lang} speaker build flashcards from a YouTube transcript. ` +
      "Respond only with JSON.";
    const user = `Pick up to ${max} of the most useful sentences from the transcript for this learner.
  Prefer sentences with words from the "unknown words" list, phrasal verbs, idioms or collocations worth learning. Skip filler, greetings and broken fragments.
  A sentence may span consecutive lines (at most 3): give the first and last line numbers.
  For each card:
  - "focus": 1-3 words or expressions from the sentence to learn (as they appear)
  - "translation": natural ${lang} translation of the whole sentence
  - "explanation": in ${lang}, one short sentence on what the focus means here

  Unknown words: ${unknown.join(", ")}

  Transcript (line number, text):
  ${items.map((it) => `[${it.i}] ${it.text}`).join("\n")}

  JSON format: {"cards":[{"line_start":0,"line_end":0,"focus":["..."],"translation":"...","explanation":"..."}]}`;

    const out = await chatJSON([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    const valid = new Set(items.map((it) => it.i));
    const cards = (out.cards || [])
      .filter(
        (c) =>
          valid.has(c.line_start) &&
          Array.isArray(c.focus) &&
          c.focus.length &&
          typeof c.translation === "string",
      )
      .slice(0, max)
      .map((c) => ({
        lineStart: c.line_start,
        lineEnd: Number.isInteger(c.line_end) && c.line_end >= c.line_start ? c.line_end : c.line_start,
        focus: c.focus.map(String).slice(0, 3),
        translation: c.translation,
        explanation: String(c.explanation || ""),
      }));
    if (!cards.length) throw new Error("the model returned no valid cards");
    return { cards };
  }
});
