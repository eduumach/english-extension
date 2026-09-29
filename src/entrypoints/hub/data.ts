import { useEffect, useState } from "react";
import {
  CARDS_KEY,
  DEFAULT_SETTINGS,
  QUIZ_HISTORY_KEY,
  SEEN_KEY,
  SETTINGS_KEY,
  STORAGE_KEY,
  WORD_STATS_KEY,
  type Card,
  type QuizResult,
  type Settings,
  type WordStats,
} from "@/lib/common";
import { LLM_KEY, getLlmConfig, type LlmConfig } from "@/lib/llm";
import { setStorage, useStorage } from "@/lib/use-storage";

export type HubData = ReturnType<typeof useHubData>;

export function useHubData() {
  const [knownList] = useStorage<string[]>(STORAGE_KEY, []);
  const [seen] = useStorage<Record<string, number>>(SEEN_KEY, {});
  const [wordStats] = useStorage<WordStats>(WORD_STATS_KEY, {});
  const [cards] = useStorage<Card[]>(CARDS_KEY, []);
  const [history] = useStorage<QuizResult[]>(QUIZ_HISTORY_KEY, []);
  const [storedSettings] = useStorage<Partial<Settings>>(SETTINGS_KEY, {});
  const [storedLlm] = useStorage(LLM_KEY, {});
  const [llm, setLlm] = useState<LlmConfig | null>(null);

  useEffect(() => {
    getLlmConfig().then(setLlm);
  }, [storedLlm]);

  const known = new Set(knownList);
  const settings: Settings = { ...DEFAULT_SETTINGS, ...storedSettings };

  // Seen-but-unknown words, most frequent first.
  const studyWords = Object.entries(seen)
    .filter(([w]) => !known.has(w))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return {
    known,
    seen,
    wordStats,
    cards,
    history,
    settings,
    llm,
    llmConfigured: !!llm?.apiKey,
    studyWords,
    saveKnown: (words: Set<string>) => setStorage(STORAGE_KEY, [...words]),
    saveSettings: (patch: Partial<Settings>) => setStorage(SETTINGS_KEY, { ...settings, ...patch }),
  };
}
