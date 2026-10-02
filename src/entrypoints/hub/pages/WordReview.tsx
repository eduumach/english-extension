import { PlayCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  GRADUATE_DAYS,
  WORD_RE,
  fmtTime,
  normalizeWord,
  setWordSrs,
  videoLink,
  type Card,
} from "@/lib/common";
import type { HubData } from "../data";
import { ReviewSession } from "../review";

// Shape returned by the background "lookup" handler.
type Lookup = {
  translation?: string;
  phonetic?: string;
  alternatives?: { pos: string; terms: string[] }[];
  definitions?: { pos: string; definition: string; example: string }[];
};

// Example sentence shown on the front; translation goes on the back.
type Sentence = { text: string; translation?: string };

// A sentence from the user's cards that contains the word: fallback when Tatoeba has none,
// and the source of the "listen in the video" link.
function findCard(cards: Card[], word: string) {
  return cards.find((c) => (c.sentence.match(WORD_RE) || []).some((m) => normalizeWord(m) === word));
}

function Highlighted({ text, word }: { text: string; word: string }) {
  return (
    <p className="text-lg leading-relaxed">
      {text.split(new RegExp(`(${WORD_RE.source})`)).map((part, i) =>
        normalizeWord(part) === word ? (
          <b key={i} className="text-study">
            {part}
          </b>
        ) : (
          part
        ),
      )}
    </p>
  );
}

function Back({
  word,
  info,
  sentence,
  card,
}: {
  word: string;
  info?: Lookup | "error";
  sentence?: Sentence | null;
  card?: Card;
}) {
  return (
    <div className="flex flex-col gap-3">
      <WordInfo word={word} info={info} />
      {sentence?.translation && (
        <p className="border-l-2 pl-3 text-muted-foreground">{sentence.translation}</p>
      )}
      {card && (
        <a
          className="flex items-center gap-1.5 text-xs text-info hover:underline"
          href={videoLink(card)}
          target="_blank"
          rel="noopener"
        >
          <PlayCircle className="size-4" />
          Ouvir no vídeo · {fmtTime(card.time)}
        </a>
      )}
    </div>
  );
}

function WordInfo({ word, info }: { word: string; info?: Lookup | "error" }) {
  if (!info) return <p className="text-muted-foreground">Buscando tradução...</p>;
  if (info === "error") {
    return (
      <p className="text-muted-foreground">
        Não deu para buscar a tradução.{" "}
        <a
          className="text-info hover:underline"
          href={`https://translate.google.com/?sl=auto&text=${encodeURIComponent(word)}`}
          target="_blank"
          rel="noopener"
        >
          Abrir no Google Tradutor
        </a>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {info.translation && <p className="text-xl font-medium">{info.translation}</p>}
      {!!info.alternatives?.length && (
        <div className="flex flex-col gap-0.5 text-muted-foreground">
          {info.alternatives.slice(0, 3).map((a, i) => (
            <p key={i}>
              <i>{a.pos}</i> {a.terms.join(", ")}
            </p>
          ))}
        </div>
      )}
      {!!info.definitions?.length && (
        <ul className="flex flex-col gap-1.5 text-xs">
          {info.definitions.slice(0, 2).map((d, i) => (
            <li key={i}>
              <i className="text-muted-foreground">{d.pos}</i> {d.definition}
              {d.example && <span className="text-muted-foreground"> — "{d.example}"</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function WordReview({
  data,
  queue,
  onQueue,
}: {
  data: HubData;
  queue: string[];
  onQueue: (q: string[] | null) => void;
}) {
  const { known, wordSrs, cards, settings, saveKnown } = data;
  const [lookups, setLookups] = useState<Record<string, Lookup | "error">>({});
  // undefined while loading, null when no sentence was found.
  const [sentences, setSentences] = useState<Record<string, Sentence | null>>({});
  const requested = useRef(new Set<string>());

  // Fetch a few words ahead so revealing the answer is instant.
  useEffect(() => {
    const { studyLang: sl, targetLang: tl } = settings;
    for (const word of queue.slice(0, 4)) {
      if (requested.current.has(word)) continue;
      requested.current.add(word);
      browser.runtime
        .sendMessage({ type: "lookup", word, sl, tl })
        .then((res: (Lookup & { error?: string }) | undefined) => (res && !res.error ? res : "error"))
        .catch(() => "error" as const)
        .then((info) => setLookups((prev) => ({ ...prev, [word]: info })));
      browser.runtime
        .sendMessage({ type: "examples", word, sl, tl })
        .then((res: { examples?: Sentence[] } | undefined) => {
          // Pick among the top results so the same word doesn't always show the same sentence.
          const list = res?.examples || [];
          return list[Math.floor(Math.random() * Math.min(list.length, 3))] || null;
        })
        .catch(() => null)
        .then((ex) => {
          const card = findCard(cards, word);
          const sentence = ex || (card ? { text: card.sentence, translation: card.translation } : null);
          setSentences((prev) => ({ ...prev, [word]: sentence }));
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.slice(0, 4).join(), settings.studyLang, settings.targetLang]);

  function markKnown(word: string) {
    saveKnown(new Set([...known, word]));
    toast(`"${word}" foi para Aprendidas`);
  }

  return (
    <ReviewSession
      queue={queue}
      onQueue={onQueue}
      // Marked as known elsewhere mid-session: skip it.
      srs={(w) => (known.has(w) ? null : wordSrs[w])}
      front={(w) => {
        const phonetic = lookups[w] !== "error" ? lookups[w]?.phonetic : "";
        const sentence = sentences[w];
        return (
          <div className="flex flex-col gap-3">
            <p className="text-3xl font-semibold">
              {w} {phonetic && <span className="text-base font-normal text-muted-foreground">{phonetic}</span>}
            </p>
            {sentence === undefined ? (
              <p className="text-muted-foreground">Buscando frase de exemplo...</p>
            ) : (
              sentence && <Highlighted text={sentence.text} word={w} />
            )}
          </div>
        );
      }}
      back={(w) => <Back word={w} info={lookups[w]} sentence={sentences[w]} card={findCard(cards, w)} />}
      onGrade={async (w, srs) => {
        await setWordSrs(w, srs, settings.studyLang);
        if (srs.interval >= GRADUATE_DAYS) markKnown(w);
      }}
      actions={(w) => (
        <Button size="sm" variant="ghost" className="text-known" onClick={() => {
            markKnown(w);
            onQueue(queue.filter((x) => x !== w));
          }}>
          Já sei
        </Button>
      )}
    />
  );
}
