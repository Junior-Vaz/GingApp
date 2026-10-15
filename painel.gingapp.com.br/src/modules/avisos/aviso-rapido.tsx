import { useRef, useState } from "react";
import { Bell, BookmarkPlus, Loader2, Megaphone, Send, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { StudentMultiPicker } from "@/components/painel/student-multi-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import { ApiError, errorMessage } from "@/lib/api";
import type { StudentOption } from "@/lib/student-lookup";
import { plural } from "@/lib/plural";
import { ROLE_LABEL, useCan, type OrgRole } from "@/lib/session";
import { NativeSelect } from "@/modules/alunos/native-select";
import {
  AUDIENCE_SCOPES,
  BODY_MAX,
  BODY_MIN,
  SCOPE_LABEL,
  TITLE_MAX,
  TITLE_MIN,
  buildAudience,
  splitLeadingEmoji,
  templateTitle,
  useAudiences,
  useQuickTemplates,
  useSendNotice,
  useTemplateMutations,
  type AudienceScope,
  type QuickTemplate,
} from "./aviso-api";
import { TemplateManager, TemplateStrip } from "./aviso-modelos";

const roleLabel = (role: string) => ROLE_LABEL[role as OrgRole] ?? role;

interface NoticeForm {
  title: string;
  body: string;
  scope: AudienceScope;
  unitId: string;
  classId: string;
  role: string;
  students: StudentOption[];
  alsoPublish: boolean;
}

const EMPTY_FORM: NoticeForm = { title: "", body: "", scope: "GROUP", unitId: "", classId: "", role: "", students: [], alsoPublish: false };

/**
 * Botão flutuante (FAB) de AVISO RÁPIDO, na pilha <FloatingActions>: só aparece para quem pode criar comunicados
 * (`announcements:create` = MESTRE/PROFESSOR/INSTRUTOR; MONITOR não). Abre um painel para enviar uma notificação
 * (push) a um alcance escolhido, opcionalmente publicando também no mural de comunicados.
 */
export function QuickNotice() {
  const canCreate = useCan("announcements", "create");
  return canCreate ? <QuickNoticeFab /> : null;
}

function QuickNoticeFab() {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const panel = <QuickNoticePanel onClose={() => setOpen(false)} focusTitle={!isMobile} />;

  const fab = (
    <button
      type="button"
      onClick={isMobile ? () => setOpen(true) : undefined}
      data-testid="quick-notice-fab"
      aria-label="Aviso rápido"
      className="relative flex size-12 items-center justify-center rounded-full border-2 border-primary bg-card text-primary shadow-lg outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:size-14"
    >
      <Megaphone className="size-5 md:size-6" aria-hidden />
    </button>
  );

  if (isMobile) {
    return (
      <>
        {fab}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            aria-label="Aviso rápido"
            className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0 [&>button.absolute]:hidden"
          >
            <SheetTitle className="sr-only">Aviso rápido</SheetTitle>
            <SheetDescription className="sr-only">Envie uma notificação rápida para o alcance escolhido.</SheetDescription>
            {panel}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{fab}</PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={12}
        collisionPadding={16}
        aria-label="Aviso rápido"
        className="flex w-[min(26rem,calc(100vw-2rem))] max-h-[min(42rem,var(--radix-popover-content-available-height,calc(100dvh-7rem)))] flex-col overflow-hidden p-0"
      >
        {panel}
      </PopoverContent>
    </Popover>
  );
}

function Counter({ value, max }: { value: number; max: number }) {
  return (
    <span className={value > max ? "text-destructive" : "text-muted-foreground"} aria-live="off">
      {value}/{max}
    </span>
  );
}

function QuickNoticePanel({ onClose, focusTitle }: { onClose: () => void; focusTitle: boolean }) {
  const [form, setForm] = useState<NoticeForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [view, setView] = useState<"form" | "manage">("form");
  const [templateId, setTemplateId] = useState<number | string | null>(null);
  const [confirmNow, setConfirmNow] = useState(false);
  const sendRef = useRef<HTMLButtonElement>(null);
  const canManage = useCan("announcements", "delete"); // só MESTRE cria/edita/apaga modelos
  const audiences = useAudiences();
  const templates = useQuickTemplates();
  const { create: saveTemplate } = useTemplateMutations();
  const send = useSendNotice();
  const set = <K extends keyof NoticeForm>(key: K, value: NoticeForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFormError(null);
    setConfirmNow(false);
  };
  /** Digitar por cima do texto do modelo desfaz a seleção (o "Enviar já" é só para o modelo como está). */
  const setText = (key: "title" | "body", value: string) => {
    set(key, value);
    setTemplateId(null);
  };

  /** Tocar num modelo PREENCHE título e mensagem (continuam editáveis) e leva o foco ao envio. */
  function pickTemplate(t: QuickTemplate) {
    setForm((f) => ({ ...f, title: templateTitle(t), body: t.body }));
    setTemplateId(t.id);
    setFormError(null);
    setConfirmNow(false);
    setTimeout(() => sendRef.current?.focus(), 0);
  }

  const title = form.title.trim();
  const body = form.body.trim();
  const audience = buildAudience(form);
  const titleOk = title.length >= TITLE_MIN && title.length <= TITLE_MAX;
  const bodyOk = body.length >= BODY_MIN && body.length <= BODY_MAX;
  const canSend = titleOk && bodyOk && audience !== null && !send.isPending;

  // Falta algo? Dica curta junto ao botão (o botão fica desabilitado até estar tudo certo).
  const missing = !titleOk
    ? `Título de ${TITLE_MIN} a ${TITLE_MAX} caracteres.`
    : !bodyOk
      ? `Mensagem de ${BODY_MIN} a ${BODY_MAX} caracteres.`
      : audience === null
        ? { UNIT: "Escolha a unidade.", CLASS: "Escolha a turma.", ROLE: "Escolha o perfil.", STUDENTS: "Escolha ao menos um aluno.", GROUP: "" }[form.scope]
        : "";

  const classes = audiences.data?.classes ?? [];
  const unitName = (id: number | null) => audiences.data?.units.find((u) => u.id === id)?.name;

  /** Para onde vai, em palavras: usado na confirmação do "Enviar já". */
  const audienceText = (() => {
    switch (form.scope) {
      case "GROUP":
        return "todo o grupo";
      case "UNIT":
        return `a unidade ${unitName(Number(form.unitId)) ?? ""}`.trim();
      case "CLASS":
        return `a turma ${classes.find((c) => String(c.id) === form.classId)?.name ?? ""}`.trim();
      case "ROLE":
        return `o perfil ${roleLabel(form.role)}`;
      case "STUDENTS":
        return plural(form.students.length, "aluno escolhido", "alunos escolhidos");
    }
  })();

  async function handleSaveTemplate() {
    if (!titleOk || !bodyOk) return;
    const { emoji, title: plainTitle } = splitLeadingEmoji(title);
    setFormError(null);
    try {
      await saveTemplate.mutateAsync({ title: plainTitle, body, ...(emoji ? { emoji } : {}) });
      toast.success("Modelo salvo.");
    } catch (error) {
      setFormError(errorMessage(error, "Não foi possível salvar o modelo. Tente novamente."));
    }
  }

  async function handleSend() {
    if (!audience || !canSend) return;
    setFormError(null);
    setConfirmNow(false);
    try {
      const result = await send.mutateAsync({
        title,
        body,
        audience,
        ...(form.alsoPublish ? { alsoPublish: true } : {}),
      });
      const people = plural(result?.sent ?? 0, "pessoa");
      toast.success(result?.announcementId ? `Enviado para ${people} e publicado no mural.` : `Enviado para ${people}.`);
      setForm(EMPTY_FORM);
      setTemplateId(null);
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === "NO_RECIPIENTS") setFormError("Ninguém neste alcance. Escolha outro alcance.");
      else if (error instanceof ApiError && error.status === 403) setFormError("Você não tem permissão para enviar avisos.");
      else setFormError(errorMessage(error, "Não foi possível enviar o aviso. Tente novamente."));
    }
  }

  if (view === "manage" && canManage) return <TemplateManager onBack={() => setView("form")} />;

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSend();
      }}
    >
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <h2 className="flex items-center gap-2 font-display text-base font-extrabold">
          <Megaphone className="size-5 text-primary" aria-hidden /> Aviso rápido
        </h2>
        <Button type="button" variant="ghost" size="icon" aria-label="Fechar aviso rápido" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-4" data-testid="quick-notice-body">
        <TemplateStrip
          templates={templates.data ?? []}
          loading={templates.isLoading}
          selectedId={templateId}
          onPick={pickTemplate}
          onManage={canManage ? () => setView("manage") : undefined}
        />

        {templateId !== null && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2" data-testid="quick-notice-send-now">
            {confirmNow ? (
              <>
                <p className="min-w-0 flex-1 text-sm font-medium">Enviar agora para {audienceText}?</p>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setConfirmNow(false)}>
                    Cancelar
                  </Button>
                  <Button type="button" size="sm" disabled={!canSend} onClick={() => void handleSend()}>
                    Sim, enviar
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">Modelo aplicado. Ajuste o texto ou o alcance, ou envie direto.</p>
                <Button type="button" variant="secondary" size="sm" disabled={!canSend} onClick={() => setConfirmNow(true)}>
                  <Zap /> Enviar já
                </Button>
              </>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <Label htmlFor="notice-title">Título</Label>
            <Counter value={form.title.length} max={TITLE_MAX} />
          </div>
          <Input
            id="notice-title"
            value={form.title}
            maxLength={TITLE_MAX + 20}
            placeholder="Ex.: Treino de hoje cancelado"
            autoFocus={focusTitle}
            onChange={(e) => setText("title", e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <Label htmlFor="notice-body">Mensagem</Label>
            <Counter value={form.body.length} max={BODY_MAX} />
          </div>
          <Textarea
            id="notice-body"
            rows={3}
            value={form.body}
            maxLength={BODY_MAX + 40}
            placeholder="Escreva o aviso que os alunos vão receber."
            onChange={(e) => setText("body", e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="notice-scope">Alcance</Label>
          <NativeSelect id="notice-scope" value={form.scope} onChange={(e) => set("scope", e.target.value as AudienceScope)}>
            {AUDIENCE_SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {SCOPE_LABEL[scope]}
              </option>
            ))}
          </NativeSelect>

          {form.scope !== "GROUP" && form.scope !== "STUDENTS" && audiences.isLoading && <Skeleton className="h-9 w-full" />}
          {audiences.error && form.scope !== "GROUP" && form.scope !== "STUDENTS" && (
            <p role="alert" className="flex items-center gap-2 text-xs text-destructive">
              {errorMessage(audiences.error, "Não foi possível carregar as opções de alcance.")}
              <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void audiences.refetch()}>
                Tentar novamente
              </Button>
            </p>
          )}
          {form.scope === "UNIT" && audiences.data && (
            <NativeSelect aria-label="Unidade" value={form.unitId} onChange={(e) => set("unitId", e.target.value)}>
              <option value="">Selecione a unidade…</option>
              {audiences.data.units.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.name}
                </option>
              ))}
            </NativeSelect>
          )}
          {form.scope === "CLASS" && audiences.data && (
            <NativeSelect aria-label="Turma" value={form.classId} onChange={(e) => set("classId", e.target.value)}>
              <option value="">Selecione a turma…</option>
              {classes.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                  {unitName(c.unitId) ? ` — ${unitName(c.unitId)}` : ""}
                </option>
              ))}
            </NativeSelect>
          )}
          {form.scope === "ROLE" && audiences.data && (
            <NativeSelect aria-label="Perfil" value={form.role} onChange={(e) => set("role", e.target.value)}>
              <option value="">Selecione o perfil…</option>
              {audiences.data.roles.map((r) => {
                const value = typeof r === "string" ? r : r.value;
                const label = typeof r === "string" ? roleLabel(r) : r.label;
                return (
                  <option key={value} value={value}>
                    {label}
                  </option>
                );
              })}
            </NativeSelect>
          )}
          {form.scope === "STUDENTS" && <StudentMultiPicker value={form.students} onChange={(students) => set("students", students)} />}
        </div>

        <div className="flex items-start justify-between gap-3 rounded-md border p-3">
          <div className="min-w-0">
            <p id="notice-publish-label" className="text-sm font-semibold">
              Publicar também no mural de comunicados
            </p>
            <p className="text-xs text-muted-foreground">Fica visível no app, além da notificação.</p>
          </div>
          <Switch
            aria-labelledby="notice-publish-label"
            checked={form.alsoPublish}
            onCheckedChange={(v) => set("alsoPublish", v)}
          />
        </div>

        <div aria-label="Pré-visualização" role="group" className="rounded-lg border bg-muted/40 p-3" data-testid="quick-notice-preview">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Como o aluno vai ver</p>
          <div className="flex items-start gap-2.5 rounded-md border bg-card p-2.5 shadow-sm">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <Bell className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{title || "Título do aviso"}</p>
              <p className="line-clamp-2 break-words text-xs text-muted-foreground">{body || "A mensagem aparece aqui."}</p>
            </div>
          </div>
        </div>

        {canManage && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!titleOk || !bodyOk || saveTemplate.isPending}
            onClick={() => void handleSaveTemplate()}
          >
            {saveTemplate.isPending ? <Loader2 className="animate-spin" /> : <BookmarkPlus />} Salvar como modelo
          </Button>
        )}

        {formError && (
          <p role="alert" data-testid="quick-notice-error" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <p className="min-w-0 text-xs text-muted-foreground" aria-live="polite">
          {missing}
        </p>
        <Button ref={sendRef} type="submit" disabled={!canSend}>
          {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
          {send.isPending ? "Enviando…" : "Enviar"}
        </Button>
      </div>
    </form>
  );
}
