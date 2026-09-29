import { Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WORD_RE, normalizeWord } from "@/lib/common";
import { cn } from "@/lib/utils";
import type { HubData } from "../data";

export type VocabTab = "study" | "known";

const WORDS_LIMIT = 300;

export default function VocabPage({
  data,
  tab,
  onTab,
}: {
  data: HubData;
  tab: VocabTab;
  onTab: (tab: VocabTab) => void;
}) {
  const { known, seen, wordStats, studyWords, saveKnown } = data;
  const [query, setQuery] = useState("");
  const [toAdd, setToAdd] = useState("");

  const q = query.trim().toLowerCase();
  const entries = tab === "study" ? studyWords : [...known].sort().map((w) => [w, seen[w] || 0] as const);
  const filtered = q ? entries.filter(([w]) => w.includes(q)) : entries;
  const shown = filtered.slice(0, WORDS_LIMIT);

  function toggle(word: string, learned: boolean) {
    const next = new Set(known);
    if (learned) next.add(word);
    else next.delete(word);
    saveKnown(next);
  }

  function add(e: FormEvent) {
    e.preventDefault();
    const tokens = (toAdd.match(WORD_RE) || []).map(normalizeWord).filter(Boolean);
    if (!tokens.length) return;
    saveKnown(new Set([...known, ...tokens]));
    setToAdd("");
    toast(tokens.length === 1 ? `"${tokens[0]}" adicionada` : `${tokens.length} palavras adicionadas`);
  }

  const emptyMsg = q
    ? "Nenhum resultado."
    : tab === "study"
      ? "Nada para estudar ainda. Assista um vídeo com legendas."
      : "Nenhuma palavra aprendida ainda. Clique numa palavra da legenda para marcá-la.";

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-2xl font-semibold">Vocabulário</h2>

      <div className="flex flex-col gap-2">
        <Tabs value={tab} onValueChange={(v) => onTab(v as VocabTab)}>
          <TabsList>
            <TabsTrigger value="study">
              Para estudar <span className="text-muted-foreground">{studyWords.length}</span>
            </TabsTrigger>
            <TabsTrigger value="known">
              Aprendidas <span className="text-muted-foreground">{known.size}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-muted-foreground">
          {tab === "study"
            ? 'Palavras que apareceram nos vídeos e você ainda não sabe, das mais frequentes para as menos. Quando aprender, clique em "Já sei".'
            : "Palavras que você marcou como aprendidas. Elas ficam verdes na legenda."}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Buscar palavra..."
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <form onSubmit={add} className="flex gap-2">
          <Input
            placeholder="Adicionar palavra que já sei"
            className="w-60"
            value={toAdd}
            onChange={(e) => setToAdd(e.target.value)}
          />
          <Button type="submit" variant="secondary">
            Adicionar
          </Button>
        </form>
      </div>

      <ul className="divide-y rounded-xl border bg-card">
        {shown.length ? (
          shown.map(([w, count]) => {
            const st = wordStats[w];
            return (
              <li key={w} className="flex items-center gap-3 px-4 py-2">
                <span className={cn("font-medium", tab === "study" ? "text-study" : "text-known")}>{w}</span>
                {count > 0 && <span className="text-xs text-muted-foreground">vista {count}x</span>}
                {st && (
                  <span className="font-mono text-xs" title="Acertos / erros nos exercícios">
                    <span className="text-known">✓{st.ok}</span> <span className="text-destructive">✗{st.fail}</span>
                  </span>
                )}
                {tab === "study" ? (
                  <Button size="sm" variant="ghost" className="ml-auto text-known" onClick={() => toggle(w, true)}>
                    Já sei
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-muted-foreground"
                    title="Volta para estudar"
                    onClick={() => toggle(w, false)}
                  >
                    Remover
                  </Button>
                )}
              </li>
            );
          })
        ) : (
          <li className="px-4 py-8 text-center text-muted-foreground">{emptyMsg}</li>
        )}
      </ul>
      {filtered.length > shown.length && (
        <p className="text-muted-foreground">
          Mostrando {shown.length} de {filtered.length}. Use a busca para achar outras.
        </p>
      )}
    </div>
  );
}
