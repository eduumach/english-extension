import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  CARDS_KEY,
  DEFAULT_SETTINGS,
  QUIZ_HISTORY_KEY,
  SETTINGS_KEY,
  STORAGE_KEY,
  langKey,
  dueCards,
  openHub,
  quizAccuracy,
  type Card,
  type QuizResult,
  type Settings,
} from "@/lib/common";
import { LLM_KEY, getLlmConfig } from "@/lib/llm";
import { setStorage, useStorage } from "@/lib/use-storage";
import { cn } from "@/lib/utils";

function open(section = "") {
  openHub(section);
  window.close();
}

function Stat({
  value,
  label,
  className,
  section,
}: {
  value: string | number;
  label: string;
  className?: string;
  section: string;
}) {
  return (
    <button
      onClick={() => open(section)}
      className="flex flex-col items-center rounded-lg bg-card px-2 py-2.5 transition-colors hover:bg-accent"
    >
      <b className={cn("text-xl leading-tight", className)}>{value}</b>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </button>
  );
}

export default function App() {
  const [stored] = useStorage<Partial<Settings>>(SETTINGS_KEY, {});
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  const [known] = useStorage<string[]>(langKey(STORAGE_KEY, settings.studyLang), []);
  const [cards] = useStorage<Card[]>(CARDS_KEY, []);
  const [history] = useStorage<QuizResult[]>(QUIZ_HISTORY_KEY, []);
  const [llmCfg] = useStorage(LLM_KEY, {});
  const [hasKey, setHasKey] = useState(true);

  useEffect(() => {
    getLlmConfig().then((c) => setHasKey(!!c.apiKey));
  }, [llmCfg]);

  const due = dueCards(cards).length;
  const acc = quizAccuracy(history.slice(-10));

  return (
    <div className="flex w-72 flex-col gap-3 p-4 text-sm">
      <header className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 font-semibold">
          <Logo size={16} />
          Glossa
        </h1>
        <Switch
          checked={settings.enabled}
          onCheckedChange={(enabled) => setStorage(SETTINGS_KEY, { ...settings, enabled })}
          title="Desative para assistir sem a extensão"
        />
      </header>

      <p className={cn("text-xs", settings.enabled ? "text-known" : "text-muted-foreground")}>
        {settings.enabled ? "Ativada no YouTube" : "Desativada — o YouTube volta ao normal"}
      </p>

      <div className={cn("grid grid-cols-3 gap-2", !settings.enabled && "opacity-50")}>
        <Stat value={known.length} label="aprendidas" className="text-known" section="vocab" />
        <Stat value={due} label="para revisar" className="text-info" section="cards" />
        <Stat value={acc === null ? "—" : `${acc}%`} label="acerto" section="home" />
      </div>

      <Button onClick={() => open()}>Abrir hub de estudo</Button>
      {due > 0 && (
        <Button variant="secondary" onClick={() => open("cards")}>
          Revisar {due} {due === 1 ? "cartão" : "cartões"}
        </Button>
      )}

      {!hasKey && (
        <button
          onClick={() => open("settings")}
          className="flex items-center justify-between rounded-lg border border-study/30 bg-study/10 px-3 py-2 text-left text-xs text-study hover:bg-study/15"
        >
          Configure a IA para ter exercícios e cartões automáticos
          <ChevronRight className="size-4 shrink-0" />
        </button>
      )}

      <p className="text-xs text-muted-foreground">
        Abra um vídeo com legendas no YouTube. Clique numa palavra para marcá-la como aprendida.
      </p>
    </div>
  );
}
