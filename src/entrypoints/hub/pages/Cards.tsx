import { Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CARDS_KEY,
  WORD_RE,
  cleanTitle,
  exportCards,
  fmtTime,
  normalizeWord,
  videoLink,
  type Card,
} from "@/lib/common";
import { setStorage } from "@/lib/use-storage";
import type { HubData } from "../data";

// Sentence with the card's focus words in bold.
function CardFront({ card }: { card: Card }) {
  const words = new Set(card.words || []);
  const parts: (string | { b: string })[] = [];
  let last = 0;
  for (const m of card.sentence.matchAll(WORD_RE)) {
    if (!words.has(normalizeWord(m[0]))) continue;
    parts.push(card.sentence.slice(last, m.index), { b: m[0] });
    last = m.index + m[0].length;
  }
  parts.push(card.sentence.slice(last));
  return (
    <p className="text-base">
      {parts.map((p, i) => (typeof p === "string" ? p : <b key={i} className="text-study">{p.b}</b>))}
    </p>
  );
}

export default function CardsPage({ data }: { data: HubData }) {
  const { cards } = data;
  const [filter, setFilter] = useState<"new" | "all">("new");
  const fresh = cards.filter((c) => !c.exported);
  const list = (filter === "new" ? fresh : cards).slice().reverse();

  async function onExport(onlyNew: boolean) {
    const n = await exportCards(onlyNew);
    toast(n ? `${n} cartões exportados` : "Nenhum cartão para exportar");
  }

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-2xl font-semibold">Cartões Anki</h2>

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as "new" | "all")}>
          <TabsList>
            <TabsTrigger value="new">
              Novos <span className="text-muted-foreground">{fresh.length}</span>
            </TabsTrigger>
            <TabsTrigger value="all">
              Todos <span className="text-muted-foreground">{cards.length}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="flex-1" />
        <Button disabled={!fresh.length} onClick={() => onExport(true)}>
          <Download />
          {fresh.length ? `Exportar ${fresh.length} ${fresh.length === 1 ? "novo" : "novos"}` : "Exportar novos"}
        </Button>
        <Button variant="outline" disabled={!cards.length} onClick={() => onExport(false)}>
          Exportar todos
        </Button>
      </div>
      <p className="text-muted-foreground">
        O arquivo .txt abre direto no Anki em <b>Arquivo → Importar</b>. Depois de exportado, o cartão sai de "Novos".
      </p>

      {!list.length ? (
        <div className="rounded-xl border bg-card px-4 py-8 text-center text-muted-foreground">
          {cards.length ? (
            <>Todos os cartões já foram exportados. Veja em <b>Todos</b>.</>
          ) : (
            <>
              Nenhum cartão ainda. No vídeo, clique no <b>+</b> de uma frase (ou tecle <kbd>E</kbd>), ou use{" "}
              <b>Cartões IA</b> no painel para a IA escolher as melhores frases.
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((c) => (
            <article key={c.key} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
              <CardFront card={c} />
              {c.translation && <p className="text-muted-foreground">{c.translation}</p>}
              {!!c.wordNotes?.length && (
                <p className="text-xs">
                  {c.wordNotes.map((n, i) => (
                    <span key={i}>
                      {i > 0 && " · "}
                      <b>{n.word}</b>: <span className="text-muted-foreground">{n.tr}</span>
                    </span>
                  ))}
                </p>
              )}
              <div className="flex items-center gap-2 text-xs">
                {!c.exported && <Badge className="bg-info text-background">novo</Badge>}
                {c.source === "ai" && <Badge variant="secondary">IA</Badge>}
                <a
                  className="truncate text-info hover:underline"
                  href={videoLink(c)}
                  target="_blank"
                  rel="noopener"
                >
                  {cleanTitle(c.title) || "YouTube"} · {fmtTime(c.time)}
                </a>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto text-muted-foreground"
                  onClick={() => setStorage(CARDS_KEY, cards.filter((x) => x.key !== c.key))}
                >
                  <Trash2 />
                  Apagar
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
