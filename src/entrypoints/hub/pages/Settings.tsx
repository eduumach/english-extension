import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CARDS_KEY,
  SEEN_KEY,
  STORAGE_KEY,
  exportBackup,
  parseBackup,
  restoreBackup,
  type Backup,
  type Card as StudyCard,
  type Settings,
} from "@/lib/common";
import { DEFAULT_LLM, LLM_KEY } from "@/lib/llm";
import { setStorage } from "@/lib/use-storage";
import { ConfirmButton } from "../confirm-button";
import type { HubData } from "../data";

const LANGS: [string, string][] = [
  ["pt", "Português"],
  ["es", "Espanhol"],
  ["fr", "Francês"],
  ["de", "Alemão"],
  ["it", "Italiano"],
  ["ja", "Japonês"],
];

const TOGGLES: [keyof Settings, string, string][] = [
  ["autoPause", "Pausar ao fim de cada frase", "Também pela tecla Q no vídeo"],
  ["pauseOnHover", "Pausar ao passar o mouse na legenda", "Para ler com calma"],
  ["quizAfterVideo", "Exercícios ao terminar o vídeo", "Precisa da IA configurada abaixo"],
];

function SettingRow({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
      <span className="flex flex-col">
        <b className="font-medium">{title}</b>
        <small className="text-muted-foreground">{hint}</small>
      </span>
      {children}
    </label>
  );
}

function LlmCard({ data }: { data: HubData }) {
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!data.llm) return;
    setKey(data.llm.apiKey);
    setModel(data.llm.model);
    setUrl(data.llm.baseUrl);
  }, [data.llm]);

  async function save() {
    const cfg = {
      apiKey: key.trim(),
      model: model.trim() || DEFAULT_LLM.model,
      baseUrl: url.trim() || DEFAULT_LLM.baseUrl,
    };
    let origin;
    try {
      origin = new URL(cfg.baseUrl).origin;
    } catch {
      setMsg("URL inválida");
      return;
    }
    // Non-default providers need host access, granted on this click.
    if (origin !== new URL(DEFAULT_LLM.baseUrl).origin) {
      const granted = await browser.permissions.request({ origins: [`${origin}/*`] });
      if (!granted) {
        setMsg("Permissão negada para essa URL");
        return;
      }
    }
    await setStorage(LLM_KEY, cfg);
    setMsg("Salvo");
  }

  async function test() {
    setMsg("Testando...");
    const res = await browser.runtime
      .sendMessage({ type: "llm-test" })
      .catch((err: Error) => ({ error: String(err?.message || err) }));
    setMsg(
      res?.ok ? "Funcionando ✓" : res?.error === "no-api-key" ? "Salve a chave primeiro" : `Erro: ${res?.error}`,
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Inteligência artificial
          {data.llmConfigured ? (
            <Badge className="bg-known/15 text-known">configurada</Badge>
          ) : (
            <Badge className="bg-study/15 text-study">sem chave</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Usada nos exercícios e nos "Cartões IA". Crie uma chave na{" "}
          <a className="text-info hover:underline" href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener">
            DeepSeek
          </a>{" "}
          e cole abaixo. A chave fica só neste navegador.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="llm-key">Chave da API</Label>
          <Input id="llm-key" type="password" placeholder="sk-..." autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
        </div>
        <Collapsible className="group">
          <CollapsibleTrigger className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <ChevronDown className="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
            Usar outro provedor
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-3 pt-3">
            <p className="text-muted-foreground">Qualquer API compatível com OpenAI (/chat/completions) funciona.</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="llm-model">Modelo</Label>
              <Input id="llm-model" value={model} onChange={(e) => setModel(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="llm-url">URL base</Label>
              <Input id="llm-url" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
          </CollapsibleContent>
        </Collapsible>
        <div className="flex items-center gap-2">
          <Button onClick={save}>Salvar</Button>
          <Button variant="outline" onClick={test}>
            Testar
          </Button>
          <span className="text-muted-foreground">{msg}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function backupSummary({ data, legacy }: Backup) {
  const known = (data[STORAGE_KEY] as string[] | undefined)?.length || 0;
  if (legacy) return `${known} palavras aprendidas serão somadas às suas.`;
  const cards = (data[CARDS_KEY] as StudyCard[] | undefined)?.length || 0;
  const seen = Object.keys((data[SEEN_KEY] as object | undefined) || {}).length;
  return `${known} palavras aprendidas, ${seen} vistas e ${cards} cartões. Isso substitui os dados atuais.`;
}

export default function SettingsPage({ data }: { data: HubData }) {
  const { settings, saveSettings } = data;
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Backup | null>(null);

  async function pickFile(file: File) {
    try {
      setPending(parseBackup(await file.text()));
    } catch (err) {
      toast(`Erro ao importar: ${(err as Error).message}`);
    }
  }

  async function restore() {
    if (!pending) return;
    await restoreBackup(pending);
    setPending(null);
    toast("Backup restaurado");
  }

  async function clear(value: Record<string, unknown>) {
    await browser.storage.local.set(value);
    toast("Apagado");
  }

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-2xl font-semibold">Configurações</h2>

      <Card>
        <CardHeader>
          <CardTitle>Durante o vídeo</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <SettingRow title="Idioma da tradução" hint="Usado no dicionário, nos cartões e nos exercícios">
            <Select value={settings.targetLang} onValueChange={(targetLang) => saveSettings({ targetLang })}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGS.map(([v, label]) => (
                  <SelectItem key={v} value={v}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          {TOGGLES.map(([k, title, hint]) => (
            <SettingRow key={k} title={title} hint={hint}>
              <Switch checked={!!settings[k]} onCheckedChange={(v) => saveSettings({ [k]: v })} />
            </SettingRow>
          ))}
        </CardContent>
      </Card>

      <LlmCard data={data} />

      <Card>
        <CardHeader>
          <CardTitle>Backup</CardTitle>
          <CardDescription>
            Um arquivo com tudo: palavras, cartões, progresso das revisões, exercícios e configurações. A chave da IA
            não vai junto.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportBackup}>
            Exportar backup
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            Importar backup
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) pickFile(file);
            }}
          />
        </CardContent>
      </Card>

      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Restaurar backup
              {pending?.exportedAt && ` de ${new Date(pending.exportedAt).toLocaleDateString("pt-BR")}`}?
            </AlertDialogTitle>
            <AlertDialogDescription>{pending && backupSummary(pending)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={restore}>Restaurar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle>Apagar dados</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <ConfirmButton title="Apagar todas as palavras aprendidas?" onConfirm={() => clear({ [STORAGE_KEY]: [] })}>
            Apagar palavras aprendidas
          </ConfirmButton>
          <ConfirmButton
            title="Apagar o histórico de palavras vistas?"
            description="As palavras aprendidas não são afetadas."
            onConfirm={() => clear({ [SEEN_KEY]: {} })}
          >
            Apagar histórico de vistas
          </ConfirmButton>
          <ConfirmButton title="Apagar todos os cartões salvos?" onConfirm={() => clear({ [CARDS_KEY]: [] })}>
            Apagar todos os cartões
          </ConfirmButton>
        </CardContent>
      </Card>
    </div>
  );
}
