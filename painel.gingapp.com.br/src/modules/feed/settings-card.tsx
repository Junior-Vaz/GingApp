import { useState, type FormEvent } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { feedErrorMessage, useFeedSettings, useSaveFeedSettings } from "./api";
import { addBlockedWords } from "./blocked-words";
import {
  BLOCKED_WORDS_MAX,
  BLOCKED_WORD_LENGTH_MAX,
  POSTING_MODES,
  type FeedSettings,
  type PostingMode,
} from "./types";

const sameSettings = (a: FeedSettings, b: FeedSettings) =>
  a.enabled === b.enabled &&
  a.postingMode === b.postingMode &&
  a.allowComments === b.allowComments &&
  a.blockedWords.length === b.blockedWords.length &&
  a.blockedWords.every((w, i) => w === b.blockedWords[i]);

function SettingsForm({ saved }: { saved: FeedSettings }) {
  const save = useSaveFeedSettings();
  const [draft, setDraft] = useState<FeedSettings | null>(null);
  const [word, setWord] = useState("");
  const [wordError, setWordError] = useState<string | null>(null);
  const value = draft ?? saved;
  const dirty = draft !== null && !sameSettings(draft, saved);
  const change = (patch: Partial<FeedSettings>) => setDraft({ ...value, ...patch });

  function onAddWord(event: FormEvent) {
    event.preventDefault();
    const result = addBlockedWords(value.blockedWords, word);
    setWordError(result.error);
    if (result.error) return;
    change({ blockedWords: result.words });
    setWord("");
  }

  async function onSave() {
    try {
      await save.mutateAsync(value);
      setDraft(null);
    } catch {
      // O toast de erro já foi mostrado; as alterações continuam na tela para nova tentativa.
    }
  }

  return (
    <div className="space-y-5">
      {!value.enabled && (
        <p
          role="status"
          data-testid="feed-disabled-notice"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
        >
          O feed está desligado neste grupo. Ligue para os membros poderem postar. Antes de ligar, confira o modo de postagem
          (padrão: alunos com aprovação) e avise os responsáveis sobre fotos de menores.
        </p>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor="feed-enabled" className="text-sm font-semibold">
            Feed ativo
          </Label>
          <p className="text-sm text-muted-foreground">
            {value.enabled
              ? "Os membros veem e publicam no feed do grupo pelo app."
              : "Desligado: ninguém vê nem publica no feed do app. Nada é apagado."}
          </p>
        </div>
        <Switch
          id="feed-enabled"
          checked={value.enabled}
          onCheckedChange={(enabled) => change({ enabled })}
          className="mt-1"
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Quem pode postar</legend>
        <RadioGroup
          value={value.postingMode}
          onValueChange={(mode) => change({ postingMode: mode as PostingMode })}
          aria-label="Modo de postagem"
        >
          {POSTING_MODES.map((mode) => (
            <label
              key={mode.value}
              htmlFor={`feed-mode-${mode.value}`}
              className={cn(
                "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3",
                value.postingMode === mode.value && "border-primary bg-primary/5",
              )}
            >
              <RadioGroupItem id={`feed-mode-${mode.value}`} value={mode.value} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{mode.label}</span>
                <span className="block text-sm text-muted-foreground">{mode.help}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
        <p className="text-sm text-muted-foreground">
          Menores de 18 anos sempre passam por aprovação, em qualquer modo.
        </p>
      </fieldset>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor="feed-comments" className="text-sm font-semibold">
            Permitir comentários
          </Label>
          <p className="text-sm text-muted-foreground">
            Desligado: as publicações continuam, mas ninguém consegue comentar.
          </p>
        </div>
        <Switch
          id="feed-comments"
          checked={value.allowComments}
          onCheckedChange={(allowComments) => change({ allowComments })}
          className="mt-1"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="feed-word" className="text-sm font-semibold">
          Palavras bloqueadas
        </Label>
        <p className="text-sm text-muted-foreground">
          Publicações que tiverem uma dessas palavras ficam aguardando aprovação. Até{" "}
          {BLOCKED_WORDS_MAX} palavras, com até {BLOCKED_WORD_LENGTH_MAX} caracteres cada.
        </p>
        <form onSubmit={onAddWord} className="flex gap-2">
          <Input
            id="feed-word"
            value={word}
            onChange={(e) => {
              setWord(e.target.value);
              setWordError(null);
            }}
            placeholder="Digite uma palavra e toque em Adicionar"
            autoComplete="off"
            aria-invalid={wordError ? true : undefined}
            aria-describedby={wordError ? "feed-word-error" : undefined}
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="outline" disabled={word.trim() === ""}>
            <Plus /> Adicionar
          </Button>
        </form>
        {wordError && (
          <p id="feed-word-error" role="alert" className="text-sm text-destructive">
            {wordError}
          </p>
        )}
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {value.blockedWords.length} de {BLOCKED_WORDS_MAX} palavras
        </p>
        {value.blockedWords.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Lista de palavras bloqueadas">
            {value.blockedWords.map((w) => (
              <li key={w}>
                <Badge variant="secondary" className="max-w-full gap-1 break-all py-1 pr-1 text-sm font-medium">
                  {w}
                  <button
                    type="button"
                    aria-label={`Remover a palavra ${w}`}
                    onClick={() => change({ blockedWords: value.blockedWords.filter((x) => x !== w) })}
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button type="button" disabled={!dirty || save.isPending} onClick={() => void onSave()}>
          {save.isPending ? (
            <>
              <Loader2 className="animate-spin" aria-hidden /> Salvando…
            </>
          ) : (
            "Salvar"
          )}
        </Button>
        {dirty && (
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={save.isPending}
              onClick={() => {
                setDraft(null);
                setWordError(null);
                setWord("");
              }}
            >
              Descartar
            </Button>
            <span role="status" className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Alterações não salvas
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/** Cartão "Configurações do feed" (só o Mestre). */
export function FeedSettingsCard() {
  const query = useFeedSettings(true);
  return (
    <section aria-labelledby="feed-settings-title" className="mb-6 rounded-lg border bg-card p-4 text-card-foreground shadow-sm sm:p-5">
      <h2 id="feed-settings-title" className="mb-4 text-base font-bold">
        Configurações do feed
      </h2>
      {query.isPending ? (
        <div className="space-y-3" role="status" aria-busy="true" aria-label="Carregando configurações">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : query.isError ? (
        <div className="grid gap-3 text-center">
          <p role="alert" className="text-sm text-destructive">
            {feedErrorMessage(query.error, "Não foi possível carregar as configurações do feed.")}
          </p>
          <Button type="button" variant="outline" className="justify-self-center" onClick={() => void query.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : (
        <SettingsForm saved={query.data} />
      )}
    </section>
  );
}
