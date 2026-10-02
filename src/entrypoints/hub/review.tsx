import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtInterval, schedule, type Grade, type Srs } from "@/lib/common";
import { cn } from "@/lib/utils";

const GRADES: { grade: Grade; label: string; className: string }[] = [
  { grade: 0, label: "Errei", className: "text-destructive" },
  { grade: 1, label: "Difícil", className: "text-study" },
  { grade: 2, label: "Bom", className: "text-known" },
  { grade: 3, label: "Fácil", className: "text-info" },
];

// One review session over a snapshot of item keys. "Errei" sends the item to the end.
// `srs` returns null for an item that no longer exists (deleted elsewhere), which is skipped.
export function ReviewSession({
  queue,
  onQueue,
  srs,
  front,
  back,
  onGrade,
  actions,
}: {
  queue: string[];
  onQueue: (q: string[] | null) => void;
  srs: (key: string) => Srs | undefined | null;
  front: (key: string) => ReactNode;
  back: (key: string) => ReactNode;
  onGrade: (key: string, srs: Srs, grade: Grade) => void;
  actions?: (key: string) => ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const key = queue[0];
  const state = key === undefined ? null : srs(key);
  const missing = key !== undefined && state === null;

  function grade(g: Grade) {
    if (key === undefined || state === null) return;
    setShown(false);
    onQueue(g === 0 ? [...queue.slice(1), key] : queue.slice(1));
    onGrade(key, schedule(state, g), g);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!shown && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setShown(true);
      } else if (shown && ["1", "2", "3", "4"].includes(e.key)) {
        grade((Number(e.key) - 1) as Grade);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (missing) onQueue(queue.slice(1));
  }, [missing, queue, onQueue]);

  if (!queue.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-4 py-10 text-center">
        <p className="text-base font-medium">Revisão concluída 🎉</p>
        <Button variant="outline" onClick={() => onQueue(null)}>
          Voltar
        </Button>
      </div>
    );
  }
  if (key === undefined || missing) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span>Faltam {queue.length}</span>
        {!state && <Badge className="bg-info text-background">novo</Badge>}
        <span className="flex-1" />
        {actions?.(key)}
        <Button size="sm" variant="ghost" onClick={() => onQueue(null)}>
          Encerrar
        </Button>
      </div>
      <article className="flex min-h-56 flex-col gap-4 rounded-xl border bg-card p-6">
        {front(key)}
        {shown && (
          <>
            <hr />
            {back(key)}
          </>
        )}
      </article>
      {shown ? (
        <div className="grid grid-cols-4 gap-2">
          {GRADES.map(({ grade: g, label, className }) => (
            <Button key={g} variant="outline" className="h-auto flex-col gap-0.5 py-2" onClick={() => grade(g)}>
              <span className={cn("font-semibold", className)}>{label}</span>
              <span className="text-xs text-muted-foreground">
                <kbd>{g + 1}</kbd> {fmtInterval(schedule(state ?? undefined, g))}
              </span>
            </Button>
          ))}
        </div>
      ) : (
        <Button onClick={() => setShown(true)}>
          Mostrar resposta <kbd className="ml-1">Espaço</kbd>
        </Button>
      )}
    </div>
  );
}

export function ReviewStart({
  count,
  fresh,
  onStart,
  hint,
}: {
  count: number;
  fresh: number;
  onStart: () => void;
  hint: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-4 py-10 text-center">
      <p className="text-base">
        <b className="text-info">{count}</b> para revisar
        {fresh > 0 && <span className="text-muted-foreground"> ({fresh} {fresh === 1 ? "novo" : "novos"})</span>}
      </p>
      <Button onClick={onStart}>Começar revisão</Button>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
