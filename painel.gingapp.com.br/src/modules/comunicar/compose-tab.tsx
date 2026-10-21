import { useMemo, useState } from "react";
import { CalendarClock, Loader2, Pin, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { ImageUploader } from "@/components/painel/image-upload-field";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { fmt } from "@/lib/format";
import { plural } from "@/lib/plural";
import { useSessionUser } from "@/lib/session";
import { isImageRef } from "@/lib/uploads";
import { NativeSelect } from "@/modules/alunos/native-select";
import { useAudiences } from "@/modules/avisos/aviso-api";
import { useCreateCommunication, usePreview } from "./api";
import {
  ACK_LABEL,
  ROLE_LABEL,
  SCOPE_LABEL,
  type AckMode,
  type CommRole,
  type CommScope,
  type CreateCommunicationInput,
  type ScopeType,
} from "./types";
import {
  BODY_MAX,
  BODY_MIN,
  TITLE_MAX,
  TITLE_MIN,
  allowedScopes,
  buildScope,
  changedCount,
  checkText,
  commErrorMessage,
  parsePinnedUntil,
  parseSchedule,
  scheduleBounds,
  toDateInput,
} from "./utils";

interface ComposeForm {
  title: string;
  body: string;
  imageUrl: string;
  scopeType: ScopeType | "";
  unitId: string;
  classId: string;
  role: CommRole | "";
  mode: "NOW" | "LATER";
  scheduledLocal: string;
  ack: AckMode;
  pin: boolean;
  pinnedUntilDay: string;
}

const emptyForm = (scopes: ScopeType[]): ComposeForm => ({
  title: "",
  body: "",
  imageUrl: "",
  // Com uma única opção (professor/instrutor: turma) já vem escolhida; com várias, o Mestre escolhe de propósito.
  scopeType: scopes.length === 1 ? scopes[0]! : "",
  unitId: "",
  classId: "",
  role: "",
  mode: "NOW",
  scheduledLocal: "",
  ack: "NONE",
  pin: false,
  pinnedUntilDay: "",
});

interface ConfirmState {
  /** Quantidade que o gestor está confirmando (vai em `confirmCount`). */
  count: number;
  /** true = o servidor respondeu RECIPIENTS_CHANGED e a contagem foi atualizada. */
  changed: boolean;
}

function Counter({ value, max }: { value: number; max: number }) {
  return (
    <span className={value > max ? "text-destructive" : "text-muted-foreground"} aria-live="off">
      {value}/{max}
    </span>
  );
}

/** Aba "Nova mensagem": título, texto, imagem, alcance (com prévia de destinatários), agendamento, confirmação e fixar. */
export function ComposeTab() {
  const role = useSessionUser()?.role;
  const scopes = useMemo(() => allowedScopes(role), [role]);
  const audiences = useAudiences(true, { ownClasses: true });
  const create = useCreateCommunication();

  const [form, setForm] = useState<ComposeForm>(() => emptyForm(scopes));
  const [formError, setFormError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const set = <K extends keyof ComposeForm>(key: K, value: ComposeForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFormError(null);
  };

  const units = audiences.data?.units ?? [];
  const classes = audiences.data?.classes ?? [];
  const unitName = (id: number | null) => units.find((u) => u.id === id)?.name;

  const scope: CommScope | null = buildScope({ type: form.scopeType, unitId: form.unitId, classId: form.classId, role: form.role });
  const preview = usePreview(scope);
  const previewCount = typeof preview.data?.count === "number" ? preview.data.count : null;
  const sample = Array.isArray(preview.data?.sample) ? preview.data.sample : [];

  const { titleOk, bodyOk } = checkText(form.title, form.body);
  const imageOk = form.imageUrl.trim() === "" || isImageRef(form.imageUrl.trim());
  const bounds = scheduleBounds();
  const schedule = form.mode === "LATER" ? parseSchedule(form.scheduledLocal) : null;
  const scheduleError = schedule && "error" in schedule ? (form.scheduledLocal ? schedule.error : null) : null;
  const scheduledAt = schedule && "iso" in schedule ? new Date(schedule.iso) : null;
  const pinned = form.pin ? parsePinnedUntil(form.pinnedUntilDay, scheduledAt ?? new Date()) : null;
  const pinnedError = pinned && "error" in pinned ? pinned.error : null;

  const missing = !titleOk
    ? `Título de ${TITLE_MIN} a ${TITLE_MAX} caracteres.`
    : !bodyOk
      ? `Mensagem de ${BODY_MIN} a ${BODY_MAX} caracteres.`
      : !imageOk
        ? "O link da imagem não é válido."
        : form.scopeType === ""
          ? "Escolha para quem enviar."
          : scope === null
            ? { UNIT: "Escolha a unidade.", CLASS: "Escolha a turma.", ROLE: "Escolha o papel.", GROUP: "", BIRTHDAY_MONTH: "" }[form.scopeType]
            : previewCount === null
              ? preview.isError
                ? "Não foi possível calcular os destinatários."
                : "Calculando os destinatários…"
              : previewCount === 0
                ? "Ninguém neste alcance. Escolha outro."
                : form.mode === "LATER" && schedule && "error" in schedule
                  ? schedule.error
                  : pinnedError
                    ? pinnedError
                    : "";
  const canSubmit = missing === "" && !create.isPending;
  const later = form.mode === "LATER";

  function describeScope(): string {
    if (!scope) return "";
    switch (scope.type) {
      case "UNIT":
        return `Unidade ${unitName(scope.unitId ?? null) ?? ""}`.trim();
      case "CLASS":
        return `Turma ${classes.find((c) => c.id === scope.classId)?.name ?? ""}`.trim();
      case "ROLE":
        return `Papel: ${scope.role ? ROLE_LABEL[scope.role] : ""}`;
      default:
        return SCOPE_LABEL[scope.type];
    }
  }

  function buildInput(confirmCount: number): CreateCommunicationInput | null {
    if (!scope) return null;
    const title = form.title.trim();
    const body = form.body.trim();
    return {
      title,
      body,
      scope,
      confirmCount,
      requiresAck: form.ack,
      ...(form.imageUrl.trim() ? { imageUrl: form.imageUrl.trim() } : {}),
      ...(scheduledAt ? { scheduledAt: scheduledAt.toISOString() } : {}),
      ...(form.pin ? { pinToFeed: true } : {}),
      ...(form.pin && pinned && "iso" in pinned ? { pinnedUntil: pinned.iso } : {}),
    };
  }

  async function submit() {
    if (!confirm) return;
    const input = buildInput(confirm.count);
    if (!input) return;
    setFormError(null);
    try {
      const result = await create.mutateAsync(input);
      const people = plural(result?.recipients ?? confirm.count, "pessoa");
      toast.success(
        result?.status === "SCHEDULED" && scheduledAt
          ? `Mensagem agendada para ${fmt(scheduledAt, "dd/MM 'às' HH:mm")} (${people}).`
          : `Mensagem enviada para ${people}.`,
      );
      setConfirm(null);
      setForm(emptyForm(scopes));
    } catch (error) {
      const fresh = changedCount(error);
      if (fresh !== null) {
        // Alguém entrou ou saiu do alcance entre a prévia e o envio: mostra a nova contagem e pede nova confirmação.
        setConfirm({ count: fresh, changed: true });
        void preview.refetch();
        return;
      }
      setConfirm(null);
      setFormError(commErrorMessage(error, "Não foi possível enviar a mensagem. Tente novamente."));
    }
  }

  const noClasses = form.scopeType === "CLASS" && audiences.data && classes.length === 0;

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-4 p-4 md:p-5">
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <Label htmlFor="comm-title">Título</Label>
            <Counter value={form.title.trim().length} max={TITLE_MAX} />
          </div>
          <Input id="comm-title" value={form.title} maxLength={TITLE_MAX + 20} placeholder="Ex.: Roda de sábado" onChange={(e) => set("title", e.target.value)} />
        </div>

        <div className="grid gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <Label htmlFor="comm-body">Mensagem</Label>
            <Counter value={form.body.trim().length} max={BODY_MAX} />
          </div>
          <Textarea id="comm-body" rows={5} value={form.body} maxLength={BODY_MAX + 100} placeholder="Escreva o que todos precisam saber." onChange={(e) => set("body", e.target.value)} />
        </div>

        <ImageUploader value={form.imageUrl} onChange={(v) => set("imageUrl", v)} label="Imagem (opcional)" shape="wide" previewAlt="Imagem da mensagem" />
      </Card>

      <Card className="flex flex-col gap-4 p-4 md:p-5">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <Users className="size-4 text-primary" aria-hidden /> Para quem
        </h2>

        <div className="grid gap-1.5">
          <Label htmlFor="comm-scope">Alcance</Label>
          <NativeSelect
            id="comm-scope"
            className="h-11 md:h-9"
            value={form.scopeType}
            onChange={(e) => setForm((f) => ({ ...f, scopeType: e.target.value as ScopeType | "", unitId: "", classId: "", role: "" }))}
          >
            <option value="">Escolha o alcance…</option>
            {scopes.map((type) => (
              <option key={type} value={type}>
                {SCOPE_LABEL[type]}
              </option>
            ))}
          </NativeSelect>
          {role !== "MESTRE" && <p className="text-xs text-muted-foreground">Professores e instrutores enviam apenas para as suas turmas.</p>}
        </div>

        {(form.scopeType === "UNIT" || form.scopeType === "CLASS") && audiences.isLoading && <Skeleton className="h-9 w-full" />}
        {audiences.error && (form.scopeType === "UNIT" || form.scopeType === "CLASS") && (
          <p role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
            Não foi possível carregar as opções.
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void audiences.refetch()}>
              Tentar novamente
            </Button>
          </p>
        )}
        {form.scopeType === "UNIT" && audiences.data && (
          <NativeSelect aria-label="Unidade" className="h-11 md:h-9" value={form.unitId} onChange={(e) => set("unitId", e.target.value)}>
            <option value="">Selecione a unidade…</option>
            {units.map((u) => (
              <option key={u.id} value={String(u.id)}>
                {u.name}
              </option>
            ))}
          </NativeSelect>
        )}
        {form.scopeType === "CLASS" && audiences.data && (
          <NativeSelect aria-label="Turma" className="h-11 md:h-9" value={form.classId} onChange={(e) => set("classId", e.target.value)}>
            <option value="">Selecione a turma…</option>
            {classes.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
                {unitName(c.unitId) ? ` — ${unitName(c.unitId)}` : ""}
              </option>
            ))}
          </NativeSelect>
        )}
        {noClasses && <p className="text-sm text-muted-foreground">Você não tem turmas ativas para enviar mensagens.</p>}
        {form.scopeType === "ROLE" && (
          <NativeSelect aria-label="Papel" className="h-11 md:h-9" value={form.role} onChange={(e) => set("role", e.target.value as CommRole | "")}>
            <option value="">Selecione o papel…</option>
            {(Object.keys(ROLE_LABEL) as CommRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </NativeSelect>
        )}
        {form.scopeType === "BIRTHDAY_MONTH" && (
          <p className="text-xs text-muted-foreground">Quem faz aniversário no mês atual (adultos que mostram o aniversário ao grupo e a equipe).</p>
        )}

        {scope !== null && (
          <div className="rounded-lg border bg-muted/40 p-3" data-testid="comm-preview" aria-live="polite">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Quem vai receber</p>
            {preview.isLoading ? (
              <Skeleton className="h-5 w-40" />
            ) : preview.isError ? (
              <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
                {commErrorMessage(preview.error, "Não foi possível calcular os destinatários.")}
                <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void preview.refetch()}>
                  Tentar novamente
                </Button>
              </p>
            ) : previewCount !== null ? (
              <>
                <p className="text-sm font-semibold" data-testid="comm-preview-count">
                  {plural(previewCount, "pessoa")}
                </p>
                {sample.length > 0 && (
                  <p className="break-words text-xs text-muted-foreground">
                    Por exemplo: {sample.map((s) => s.name).join(", ")}
                    {previewCount > sample.length ? ` e mais ${previewCount - sample.length}` : ""}.
                  </p>
                )}
              </>
            ) : null}
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-4 p-4 md:p-5">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <CalendarClock className="size-4 text-primary" aria-hidden /> Quando e como
        </h2>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Envio</legend>
          <div role="radiogroup" aria-label="Quando enviar" className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["NOW", "Enviar agora"],
                ["LATER", "Agendar"],
              ] as const
            ).map(([mode, label]) => (
              <label
                key={mode}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm font-medium focus-within:ring-2 focus-within:ring-ring ${form.mode === mode ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent/40"}`}
              >
                <input type="radio" name="comm-mode" className="sr-only" checked={form.mode === mode} onChange={() => set("mode", mode)} aria-label={label} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {later && (
          <div className="grid gap-1.5 sm:max-w-xs">
            <Label htmlFor="comm-when">Data e hora do envio</Label>
            <Input
              id="comm-when"
              type="datetime-local"
              className="h-11 md:h-9"
              min={bounds.min}
              max={bounds.max}
              value={form.scheduledLocal}
              aria-invalid={scheduleError ? true : undefined}
              onChange={(e) => set("scheduledLocal", e.target.value)}
            />
            {scheduleError ? <p role="alert" className="text-xs text-destructive">{scheduleError}</p> : <p className="text-xs text-muted-foreground">Até 90 dias a partir de hoje.</p>}
          </div>
        )}

        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor="comm-ack">Pedir confirmação</Label>
          <NativeSelect id="comm-ack" className="h-11 md:h-9" value={form.ack} onChange={(e) => set("ack", e.target.value as AckMode)}>
            {(Object.keys(ACK_LABEL) as AckMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {ACK_LABEL[mode]}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="grid gap-3 rounded-md border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p id="comm-pin-label" className="flex items-center gap-1.5 text-sm font-semibold">
                <Pin className="size-3.5" aria-hidden /> Fixar no feed
              </p>
              <p className="text-xs text-muted-foreground">A mensagem fica no topo do feed do grupo, além da notificação.</p>
            </div>
            <Switch aria-labelledby="comm-pin-label" checked={form.pin} onCheckedChange={(v) => set("pin", v)} />
          </div>
          {form.pin && (
            <div className="grid gap-1.5 sm:max-w-xs">
              <Label htmlFor="comm-pin-until">Fixar até (opcional)</Label>
              <Input
                id="comm-pin-until"
                type="date"
                className="h-11 md:h-9"
                min={toDateInput(new Date())}
                value={form.pinnedUntilDay}
                aria-invalid={pinnedError ? true : undefined}
                onChange={(e) => set("pinnedUntilDay", e.target.value)}
              />
              {pinnedError ? <p role="alert" className="text-xs text-destructive">{pinnedError}</p> : <p className="text-xs text-muted-foreground">Sem data, fica fixada até alguém desafixar.</p>}
            </div>
          )}
        </div>
      </Card>

      {formError && (
        <p role="alert" data-testid="comm-error" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      )}

      {/* Rodapé fora do fluxo fixo: os botões flutuantes (aviso/chamada rápida) ficam no canto e cobririam o botão; o respiro
          embaixo no celular deixa o botão acima deles. */}
      <div className="flex flex-col gap-2 pb-40 sm:flex-row sm:items-center sm:justify-between md:pb-0">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground" aria-live="polite">
          {missing}
        </p>
        <Button
          type="button"
          className="w-full sm:w-auto"
          disabled={!canSubmit}
          onClick={() => {
            if (previewCount !== null) setConfirm({ count: previewCount, changed: false });
          }}
        >
          {create.isPending ? <Loader2 className="animate-spin" /> : later ? <CalendarClock /> : <Send />}
          {later ? "Agendar" : "Enviar agora"}
        </Button>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && !create.isPending && setConfirm(null)}>
        <AlertDialogContent data-testid="comm-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {later ? "Agendar" : "Enviar"} para {plural(confirm?.count ?? 0, "pessoa")}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {confirm?.changed && (
                  <p role="alert" className="font-medium text-destructive">
                    A lista de destinatários mudou. Agora são {plural(confirm.count, "pessoa")}. Confirme de novo.
                  </p>
                )}
                <p>
                  Alcance: {describeScope()}.{" "}
                  {later && scheduledAt ? `Será enviada em ${fmt(scheduledAt, "dd/MM/yyyy 'às' HH:mm")}.` : "Será enviada agora e não dá para desfazer."}
                </p>
                <p className="break-words font-medium text-foreground">{form.title.trim()}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={create.isPending}>Cancelar</AlertDialogCancel>
            <Button disabled={create.isPending || (confirm?.count ?? 0) === 0} onClick={() => void submit()}>
              {create.isPending ? "Aguarde…" : later ? "Sim, agendar" : "Sim, enviar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
