import { useEffect, useState } from "react";
import {
  CARDS_KEY,
  DEFAULT_SETTINGS,
  QUIZ_HISTORY_KEY,
  SEEN_KEY,
  SETTINGS_KEY,
  STORAGE_KEY,
  WORD_SRS_KEY,
  WORD_STATS_KEY,
  langKey,
  type Card,
  type QuizResult,
  type Settings,
  type WordSrs,
  type WordStats,
} from "@/lib/common";
import { LLM_KEY, getLlmConfig, type LlmConfig } from "@/lib/llm";
import { setStorage, useStorage } from "@/lib/use-storage";

export type HubData = ReturnType<typeof useHubData>;

export function useHubData() {
  const [storedSettings] = useStorage<Partial<Settings>>(SETTINGS_KEY, {});
  const settings: Settings = { ...DEFAULT_SETTINGS, ...storedSettings };
  const lang = settings.studyLang;
  const [knownList] = useStorage<string[]>(langKey(STORAGE_KEY, lang), []);
  const [seen] = useStorage<Record<string, number>>(langKey(SEEN_KEY, lang), {});
  const [wordStats] = useStorage<WordStats>(langKey(WORD_STATS_KEY, lang), {});
  const [wordSrs] = useStorage<WordSrs>(langKey(WORD_SRS_KEY, lang), {});
  const [cards] = useStorage<Card[]>(CARDS_KEY, []);
  const [history] = useStorage<QuizResult[]>(QUIZ_HISTORY_KEY, []);
  const [storedLlm] = useStorage(LLM_KEY, {});
  const [llm, setLlm] = useState<LlmConfig | null>(null);

  useEffect(() => {
    getLlmConfig().then(setLlm);
  }, [storedLlm]);

  const known = new Set(knownList);

  // Seen-but-unknown words, most frequent first.
  const studyWords = Object.entries(seen)
    .filter(([w]) => !known.has(w))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return {
    known,
    seen,
    wordStats,
    cards,
    wordSrs,
    history,
    settings,
    llm,
    llmConfigured: !!llm?.apiKey,
    studyWords,
    saveKnown: (words: Set<string>) => setStorage(langKey(STORAGE_KEY, lang), [...words]),
    saveSettings: (patch: Partial<Settings>) => setStorage(SETTINGS_KEY, { ...settings, ...patch }),
  };
}
