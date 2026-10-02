import { BookOpen, Home, Layers, Settings as SettingsIcon, Type } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Toaster } from "@/components/ui/sonner";
import { dueCards, dueWords } from "@/lib/common";
import { cn } from "@/lib/utils";
import { useHubData } from "./data";
import CardsPage from "./pages/Cards";
import HomePage from "./pages/Home";
import SettingsPage from "./pages/Settings";
import VocabPage, { type VocabTab } from "./pages/Vocab";

const PAGES = [
  { id: "home", label: "Início", icon: Home },
  { id: "vocab", label: "Vocabulário", icon: Type },
  { id: "cards", label: "Cartões", icon: Layers },
  { id: "settings", label: "Configurações", icon: SettingsIcon },
] as const;

type Page = (typeof PAGES)[number]["id"];

function currentPage(): Page {
  const hash = location.hash.slice(1);
  return PAGES.some((p) => p.id === hash) ? (hash as Page) : "home";
}

export default function App() {
  const data = useHubData();
  const [page, setPage] = useState<Page>(currentPage);
  const [vocabTab, setVocabTab] = useState<VocabTab>("study");

  useEffect(() => {
    const onHash = () => {
      setPage(currentPage());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const badges: Partial<Record<Page, number>> = {
    vocab: dueWords(data.studyWords, data.wordSrs).review.length,
    cards: dueCards(data.cards).length,
  };
  const { enabled } = data.settings;

  return (
    <div className="flex min-h-screen text-sm">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col gap-6 border-r bg-card/40 p-4">
        <div className="flex items-center gap-2 px-2 text-base font-semibold">
          <BookOpen className="size-5" />
          Glossa
        </div>
        <nav className="flex flex-col gap-1">
          {PAGES.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                page === id && "bg-accent text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
              {!!badges[id] && <Badge className="ml-auto bg-info text-background">{badges[id]}</Badge>}
            </a>
          ))}
        </nav>
        <label className="mt-auto flex cursor-pointer items-center gap-2.5 px-2">
          <Switch checked={enabled} onCheckedChange={(v) => data.saveSettings({ enabled: v })} />
          <span className={enabled ? "text-known" : "text-muted-foreground"}>
            {enabled ? "Ativada" : "Desativada"}
          </span>
        </label>
      </aside>

      <main className={cn("mx-auto w-full max-w-4xl px-10 py-8", !enabled && "opacity-60")}>
        {page === "home" && <HomePage data={data} onVocabTab={setVocabTab} />}
        {page === "vocab" && <VocabPage data={data} tab={vocabTab} onTab={setVocabTab} />}
        {page === "cards" && <CardsPage data={data} />}
        {page === "settings" && <SettingsPage data={data} />}
      </main>

      <Toaster position="bottom-center" />
    </div>
  );
}
