import { useEffect, useState } from "react";
import { Loader2, Settings } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/modules/alunos/native-select";
import { birthdayErrorMessage, useBirthdaySettings, useSaveBirthdaySettings } from "./api";
import type { BirthdaySettings } from "./types";
import { GREETING_MAX } from "./utils";

/** Mensagem inicial dos parabéns automáticos (o servidor troca {nome} e {grupo}). */
export const DEFAULT_AUTO_MESSAGE = "Parabéns, {nome}! 🎉 A família {grupo} deseja um ótimo dia.";

const DEFAULTS: BirthdaySettings = {
  dailyDigest: true,
  autoGreeting: false,
  autoGreetingMessage: DEFAULT_AUTO_MESSAGE,
  autoGreetingHour: 8,
};

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** Configurações dos aniversários do grupo (só MESTRE): resumo diário ao gestor e parabéns automáticos. */
export function BirthdaySettingsCard() {
  const query = useBirthdaySettings(true);
  const save = useSaveBirthdaySettings();
  const [draft, setDraft] = useState<BirthdaySettings>(DEFAULTS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) setDraft({ ...DEFAULTS, ...query.data });
  }, [query.data]);

  const message = draft.autoGreetingMessage.trim();
  const messageInvalid = draft.autoGreeting && (message.length === 0 || message.length > GREETING_MAX);
  const dirty =
    query.data !== undefined &&
    (draft.dailyDigest !== query.data.dailyDigest ||
      draft.autoGreeting !== query.data.autoGreeting ||
      draft.autoGreetingHour !== query.data.autoGreetingHour ||
      draft.autoGreetingMessage !== query.data.autoGreetingMessage);

  function update<K extends keyof BirthdaySettings>(key: K, value: BirthdaySettings[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setError(null);
  }

  async function submit() {
    if (messageInvalid) return;
    setError(null);
    try {
      await save.mutateAsync({ ...draft, autoGreetingMessage: draft.autoGreetingMessage.trim() });
      toast.success("Configurações salvas.");
    } catch (e) {
      setError(birthdayErrorMessage(e, "Não foi possível salvar as configurações. Tente novamente."));
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-4 md:p-5" data-testid="birthday-settings">
      <div className="flex items-center gap-2">
        <Settings className="size-4 text-primary" aria-hidden />
        <h2 className="text-base font-bold">Configurações</h2>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : query.error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          {birthdayErrorMessage(query.error, "Não foi possível carregar as configurações.")}
          <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex items-start justify-between gap-3 rounded-md border p-3">
            <div className="min-w-0">
              <p id="digest-label" className="text-sm font-semibold">
                Resumo diário dos aniversariantes
              </p>
              <p className="text-xs text-muted-foreground">Todo dia de manhã, o gestor recebe a lista de quem faz aniversário hoje (só se houver).</p>
            </div>
            <Switch aria-labelledby="digest-label" checked={draft.dailyDigest} onCheckedChange={(v) => update("dailyDigest", v)} />
          </div>

          <div className="grid gap-3 rounded-md border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p id="auto-label" className="text-sm font-semibold">
                  Parabéns automáticos
                </p>
                <p className="text-xs text-muted-foreground">O app envia os parabéns no dia, no horário escolhido. Cada pessoa recebe uma vez por ano.</p>
              </div>
              <Switch aria-labelledby="auto-label" checked={draft.autoGreeting} onCheckedChange={(v) => update("autoGreeting", v)} />
            </div>

            {draft.autoGreeting && (
              <>
                <div className="grid gap-1.5 sm:max-w-xs">
                  <Label htmlFor="auto-hour">Horário do envio</Label>
                  <NativeSelect
                    id="auto-hour"
                    className="h-11 md:h-9"
                    value={String(draft.autoGreetingHour)}
                    onChange={(e) => update("autoGreetingHour", Number(e.target.value))}
                  >
                    {HOURS.map((hour) => (
                      <option key={hour} value={String(hour)}>
                        {String(hour).padStart(2, "0")}:00
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <Label htmlFor="auto-message">Mensagem</Label>
                    <span className={messageInvalid ? "text-destructive" : "text-muted-foreground"}>
                      {message.length}/{GREETING_MAX}
                    </span>
                  </div>
                  <Textarea
                    id="auto-message"
                    rows={3}
                    value={draft.autoGreetingMessage}
                    aria-invalid={messageInvalid || undefined}
                    onChange={(e) => update("autoGreetingMessage", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use {"{nome}"} para o nome (ou apelido) da pessoa e {"{grupo}"} para o nome do grupo.
                  </p>
                </div>
              </>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div>
            <Button type="submit" disabled={!dirty || messageInvalid || save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} Salvar configurações
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
