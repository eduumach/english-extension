import { CheckCircle2, Circle } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cleanTitle, quizAccuracy } from "@/lib/common";
import { cn } from "@/lib/utils";
import type { HubData } from "../data";
import type { VocabTab } from "./Vocab";

function Stat({
  value,
  label,
  className,
  href,
  onClick,
}: {
  value: ReactNode;
  label: string;
  className?: string;
  href?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <b className={cn("text-3xl font-semibold", className)}>{value}</b>
      <span className="text-muted-foreground">{label}</span>
    </>
  );
  const base = "flex flex-col gap-1 rounded-xl border bg-card p-4";
  return href ? (
    <a href={href} onClick={onClick} className={cn(base, "transition-colors hover:bg-accent")}>
      {body}
    </a>
  ) : (
    <div className={base}>{body}</div>
  );
}

const KEYS: [ReactNode, string][] = [
  [<kbd>Clique</kbd>, "marca/desmarca como aprendida"],
  [<><kbd>Shift</kbd>+<kbd>Clique</kbd></>, "abre o dicionário"],
  [<><kbd>A</kbd> <kbd>D</kbd></>, "frase anterior / próxima"],
  [<kbd>S</kbd>, "repete a frase"],
  [<kbd>Q</kbd>, "pausa ao fim de cada frase"],
  [<kbd>E</kbd>, "cria cartão Anki da frase"],
];

export default function HomePage({
  data,
  onVocabTab,
}: {
  data: HubData;
  onVocabTab: (tab: VocabTab) => void;
}) {
  const { known, seen, cards, history, llmConfigured, studyWords } = data;
  const acc = quizAccuracy(history.slice(-10));

  const steps: { done: boolean; text: ReactNode }[] = [
    {
      done: Object.keys(seen).length > 0,
      text: <>Abra um vídeo <b>com legendas</b> no YouTube. As palavras aparecem coloridas.</>,
    },
    {
      done: known.size > 0,
      text: "Clique nas palavras que você já sabe para marcá-las como aprendidas.",
    },
    {
      done: llmConfigured,
      text: <><a className="text-info hover:underline" href="#settings">Configure a IA</a> para ganhar exercícios ao fim de cada vídeo.</>,
    },
    {
      done: cards.some((c) => c.exported),
      text: <>Crie cartões com o <b>+</b> de uma frase e <a className="text-info hover:underline" href="#cards">exporte para o Anki</a>.</>,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-semibold">Seu estudo</h2>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat value={known.size} label="palavras aprendidas" className="text-known" href="#vocab" onClick={() => onVocabTab("known")} />
        <Stat value={studyWords.length} label="para estudar" className="text-study" href="#vocab" onClick={() => onVocabTab("study")} />
        <Stat value={cards.length} label="cartões Anki" className="text-info" href="#cards" />
        <Stat value={acc === null ? "—" : `${acc}%`} label="acerto nos exercícios" />
      </div>

      {!steps.every((s) => s.done) && (
        <Card>
          <CardHeader>
            <CardTitle>Primeiros passos</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-2.5">
              {steps.map((s, i) => (
                <li key={i} className={cn("flex items-start gap-2.5", s.done && "text-muted-foreground line-through")}>
                  {s.done ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-known" />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span>{s.text}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Exercícios recentes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {history.length ? (
              <>
                <p className="text-muted-foreground">
                  {history.length} {history.length === 1 ? "exercício feito" : "exercícios feitos"} · acerto geral{" "}
                  {quizAccuracy(history)}%
                </p>
                {history
                  .slice(-8)
                  .reverse()
                  .map((h, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span
                        className={cn(
                          "w-10 shrink-0 font-mono font-semibold",
                          h.correct / h.total >= 0.7 ? "text-known" : "text-study",
                        )}
                      >
                        {h.correct}/{h.total}
                      </span>
                      <a
                        className="flex-1 truncate hover:underline"
                        href={`https://www.youtube.com/watch?v=${encodeURIComponent(h.videoId || "")}`}
                        target="_blank"
                        rel="noopener"
                      >
                        {cleanTitle(h.title) || h.videoId}
                      </a>
                      <span className="shrink-0 text-muted-foreground">
                        {new Date(h.ts).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                  ))}
              </>
            ) : (
              <p className="text-muted-foreground">
                Nenhum exercício ainda. Eles aparecem ao terminar um vídeo, ou pelo botão <b>Praticar</b> no
                painel do vídeo.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Como usar no vídeo</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex gap-4 text-muted-foreground">
              <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-known" />aprendida</span>
              <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-study" />já vista</span>
              <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-orange-400" />nova</span>
            </div>
            <table>
              <tbody>
                {KEYS.map(([k, desc], i) => (
                  <tr key={i}>
                    <td className="py-1 pr-4 whitespace-nowrap">{k}</td>
                    <td className="py-1 text-muted-foreground">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
