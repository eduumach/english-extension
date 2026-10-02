import { PlayCircle, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  WORD_RE,
  cleanTitle,
  dueCards,
  fmtTime,
  fmtUntil,
  isDue,
  normalizeWord,
  updateCards,
  videoLink,
  type Card,
} from "@/lib/common";
import { cn } from "@/lib/utils";
import type { HubData } from "../data";
import { ReviewSession, ReviewStart } from "../review";

// Sentence with the card's focus words in bold.
function CardFront({ card, className }: { card: Card; className?: string }) {
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
    <p className={cn("text-base", className)}>
      {parts.map((p, i) => (typeof p === "string" ? p : <b key={i} className="text-study">{p.b}</b>))}
    </p>
  );
}

function CardBack({ card }: { card: Card }) {
  return (
    <>
      {card.translation && <p className="text-muted-foreground">{card.translation}</p>}
      {!!card.wordNotes?.length && (
        <p className="text-xs">
          {card.wordNotes.map((n, i) => (
            <span key={i}>
              {i > 0 && " · "}
              <b>{n.word}</b>: <span className="text-muted-foreground">{n.tr}</span>
            </span>
          ))}
        </p>
      )}
    </>
  );
}

function VideoLink({ card }: { card: Card }) {
  return (
    <a className="truncate text-info hover:underline" href={videoLink(card)} target="_blank" rel="noopener">
      {cleanTitle(card.title) || "YouTube"} · {fmtTime(card.time)}
    </a>
  );
}

function deleteCard(key: string) {
  return updateCards((cards) => cards.filter((c) => c.key !== key));
}

function Review({ cards, queue, onQueue }: { cards: Card[]; queue: string[]; onQueue: (q: string[] | null) => void }) {
  const byKey = new Map(cards.map((c) => [c.key, c]));
  return (
    <ReviewSession
      queue={queue}
      onQueue={onQueue}
      srs={(k) => (byKey.has(k) ? byKey.get(k)!.srs : null)}
      front={(k) => <CardFront card={byKey.get(k)!} className="text-xl leading-relaxed" />}
      back={(k) => {
        const card = byKey.get(k)!;
        return (
          <>
            <CardBack card={card} />
            <div className="flex items-center gap-2 text-xs">
              <a
                className="flex shrink-0 items-center gap-1.5 text-info hover:underline"
                href={videoLink(card)}
                target="_blank"
                rel="noopener"
              >
                <PlayCircle className="size-4" />
                Ouvir no vídeo
              </a>
              <span className="truncate text-muted-foreground">
                {cleanTitle(card.title) || "YouTube"} · {fmtTime(card.time)}
              </span>
            </div>
          </>
        );
      }}
      onGrade={(k, srs) => updateCards((all) => all.map((c) => (c.key === k ? { ...c, srs } : c)))}
    />
  );
}

export default function CardsPage({ data }: { data: HubData }) {
  const { cards } = data;
  const [tab, setTab] = useState<"review" | "all">("review");
  const [queue, setQueue] = useState<string[] | null>(null);
  const now = Date.now();
  const due = dueCards(cards, now);
  const fresh = due.filter((c) => !c.srs).length;
  const upcoming = cards.filter((c) => !isDue(c, now)).sort((a, b) => a.srs!.due - b.srs!.due)[0];

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-2xl font-semibold">Cartões</h2>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "review" | "all")}>
        <TabsList>
          <TabsTrigger value="review">
            Revisar <span className="text-muted-foreground">{due.length}</span>
          </TabsTrigger>
          <TabsTrigger value="all">
            Todos <span className="text-muted-foreground">{cards.length}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "review" &&
        (queue ? (
          <Review cards={cards} queue={queue} onQueue={setQueue} />
        ) : due.length ? (
          <ReviewStart
            count={due.length}
            fresh={fresh}
            onStart={() => setQueue(due.map((c) => c.key))}
            hint="Leia a frase, tente entender e revele a resposta. Quanto melhor você for, mais tempo até o cartão voltar."
          />
        ) : (
          <div className="rounded-xl border bg-card px-4 py-8 text-center text-muted-foreground">
            {cards.length ? (
              <>
                Nada para revisar agora.
                {upcoming && <> Próximo cartão em {fmtUntil(upcoming.srs!.due, now)}.</>}
              </>
            ) : (
              <>
                Nenhum cartão ainda. No vídeo, clique no <b>+</b> de uma frase (ou tecle <kbd>E</kbd>), ou use{" "}
                <b>Cartões IA</b> no painel para a IA escolher as melhores frases.
              </>
            )}
          </div>
        ))}

      {tab === "all" && (
        <div className="flex flex-col gap-3">
          {!cards.length && (
            <div className="rounded-xl border bg-card px-4 py-8 text-center text-muted-foreground">
              Nenhum cartão ainda.
            </div>
          )}
          {cards
            .slice()
            .reverse()
            .map((c) => (
              <article key={c.key} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
                <CardFront card={c} />
                <CardBack card={c} />
                <div className="flex items-center gap-2 text-xs">
                  {!c.srs ? (
                    <Badge className="bg-info text-background">novo</Badge>
                  ) : (
                    <Badge variant="secondary">
                      {isDue(c, now) ? "para revisar" : `volta em ${fmtUntil(c.srs.due, now)}`}
                    </Badge>
                  )}
                  {c.source === "ai" && <Badge variant="secondary">IA</Badge>}
                  <VideoLink card={c} />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-muted-foreground"
                    onClick={() => deleteCard(c.key)}
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
