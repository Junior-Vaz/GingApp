import { plural } from "@/lib/plural";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, ClipboardCheck, Layers, Loader2, X } from "lucide-react";
import { EntityAvatar } from "@/components/painel/entity-avatar";
import { StudentAvatar } from "@/components/painel/student-avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { errorMessage } from "@/lib/api";
import { useCan } from "@/lib/session";
import { cn } from "@/lib/utils";
import { useQuickSessions, useRoster, useSaveAttendance, type QuickSession } from "./frequencia-api";
import { markAll, setPresence, summarize, toRows, type RosterRow } from "./roster";

const STATUS_LABEL: Record<QuickSession["status"], string> = {
  ONGOING: "Em andamento",
  UPCOMING: "Próxima",
  ENDED: "Encerrada",
};

const timeLabel = (s: Pick<QuickSession, "startTime" | "endTime">) =>
  s.startTime || s.endTime ? `${s.startTime ?? "—"}–${s.endTime ?? "—"}` : "Horário livre";

/** Aula pré-selecionada: a em andamento; senão a próxima; senão a primeira da lista (o servidor já ordena). */
function pickDefaultSession(sessions: QuickSession[]): QuickSession | undefined {
  return sessions.find((s) => s.status === "ONGOING") ?? sessions.find((s) => s.status === "UPCOMING") ?? sessions[0];
}

/**
 * Botão flutuante (FAB) de CHAMADA RÁPIDA, montado no layout autenticado: só aparece para quem pode ver a frequência
 * (MESTRE/PROFESSOR). Abre um painel ancorado ao botão com as aulas de hoje e a lista de alunos com Presente/Ausente.
 */
export function QuickAttendance() {
  const canView = useCan("attendance", "view");
  return canView ? <QuickAttendanceFab /> : null;
}

function QuickAttendanceFab() {
  const [open, setOpen] = useState(false);
  const sessionsQuery = useQuickSessions(true);
  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);
  const hasOngoing = sessions.some((s) => s.status === "ONGOING");
  const count = sessions.length;
  // Celular: o painel abre como folha de baixo (quase tela cheia) em vez de popover ancorado ao botão.
  const isMobile = useIsMobile();
  const panel = (
    <QuickAttendancePanel
      sessions={sessions}
      isLoading={sessionsQuery.isLoading}
      error={sessionsQuery.error}
      onRetry={() => void sessionsQuery.refetch()}
      onClose={() => setOpen(false)}
    />
  );

  const fab = (
        <button
          type="button"
          onClick={isMobile ? () => setOpen(true) : undefined}
          data-testid="quick-attendance-fab"
          aria-label={count > 0 ? `Chamada rápida (${count} ${count === 1 ? "aula" : "aulas"} hoje)` : "Chamada rápida"}
          // Celular: acima da barra inferior (4rem + área segura); a partir de md volta ao canto da tela.
          style={{ right: "calc(1rem + env(safe-area-inset-right))" }}
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 flex size-14 md:bottom-[calc(1rem+env(safe-area-inset-bottom))] items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:size-16"
        >
          {hasOngoing && (
            <span
              data-testid="quick-attendance-pulse"
              aria-hidden="true"
              className="absolute inset-0 -z-10 animate-ping rounded-full bg-primary/40 motion-reduce:animate-none"
            />
          )}
          <ClipboardCheck className="size-6 md:size-7" aria-hidden />
          {count > 0 && (
            <span
              data-testid="quick-attendance-badge"
              aria-hidden="true"
              className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full border-2 border-background bg-highlight px-1 text-[11px] font-extrabold leading-5 text-foreground"
            >
              {count}
            </span>
          )}
        </button>
  );

  if (isMobile) {
    return (
      <>
        {fab}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            aria-label="Chamada rápida"
            className="flex h-[92dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0 [&>button.absolute]:hidden"
          >
            <SheetTitle className="sr-only">Chamada rápida</SheetTitle>
            <SheetDescription className="sr-only">Marque presente ou ausente para os alunos das aulas de hoje.</SheetDescription>
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
        aria-label="Chamada rápida"
        className="flex w-[min(26rem,calc(100vw-2rem))] max-h-[min(40rem,calc(100dvh-7rem))] flex-col overflow-hidden p-0"
      >
        {panel}
      </PopoverContent>
    </Popover>
  );
}

function QuickAttendancePanel({
  sessions,
  isLoading,
  error,
  onRetry,
  onClose,
}: {
  sessions: QuickSession[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // Escolha do usuário se ainda existe na lista; senão a em andamento / próxima.
  const selected = sessions.find((s) => s.lessonId === selectedId) ?? pickDefaultSession(sessions);
  const lessonId = selected ? String(selected.lessonId) : "";
  const roster = useRoster(lessonId);
  const save = useSaveAttendance();

  // Chegada de dados novos (troca de aula ou recarga depois de salvar): refaz as linhas, exceto com marcações pendentes
  // (um refetch ao voltar o foco da janela não pode apagar o que o professor acabou de tocar).
  useEffect(() => {
    if (!dirtyRef.current) setRows(roster.data ? toRows(roster.data) : []);
  }, [roster.data, lessonId]);

  const summary = summarize(rows);
  const decided = summary.total - summary.undecided;

  function mark(studentId: number, present: boolean) {
    setRows((r) => setPresence(r, studentId, present));
    setDirty(true);
  }

  function chooseSession(id: number) {
    if (id === selected?.lessonId) return;
    if (dirty && !window.confirm("Há marcações não salvas nesta aula. Descartar e trocar de aula?")) return;
    dirtyRef.current = false;
    setDirty(false);
    setRows([]);
    setSelectedId(id);
  }

  async function handleSave() {
    try {
      await save.mutateAsync({ lessonId, rows });
      setDirty(false); // a recarga da chamada (invalidada pelo hook) assume as linhas
    } catch {
      // erro já notificado por toast (notifyError); as marcações continuam na tela para tentar de novo
    }
  }

  function renderRoster() {
    if (roster.isLoading) {
      return (
        <div className="space-y-3 p-4" data-testid="quick-roster-loading">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      );
    }
    if (roster.error) {
      return (
        <div className="p-6 text-center" data-testid="quick-roster-error">
          <p className="text-sm text-destructive">{errorMessage(roster.error, "Não foi possível carregar a chamada desta aula.")}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void roster.refetch()}>
            Tentar novamente
          </Button>
        </div>
      );
    }
    if (rows.length === 0) {
      return (
        <p className="p-6 text-center text-sm text-muted-foreground" data-testid="quick-roster-empty">
          Esta turma não tem alunos matriculados.
        </p>
      );
    }
    return (
      <ul aria-label={`Alunos de ${selected?.className ?? "aula"}`} className="divide-y">
        {rows.map((row) => (
          <li key={row.studentId} className="flex items-center gap-2.5 px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5" data-testid="quick-student-row">
            <StudentAvatar name={row.studentName} photo={row.photo} className="size-10 text-sm sm:size-12" />
            <span className="min-w-0 flex-1 break-words text-sm font-semibold leading-tight">{row.studentName}</span>
            <div role="group" aria-label={`Presença de ${row.studentName}`} className="flex shrink-0 gap-1.5">
              <button
                type="button"
                aria-pressed={row.present === true}
                aria-label={`Presente: ${row.studentName}`}
                onClick={() => mark(row.studentId, true)}
                className={cn(
                  "inline-flex h-12 min-w-11 items-center justify-center gap-1 rounded-md border px-2 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring min-[380px]:min-w-[4.25rem] md:h-11",
                  row.present === true ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-secondary",
                )}
              >
                <Check className="size-4" aria-hidden /> <span className="max-[379px]:sr-only">Presente</span>
              </button>
              <button
                type="button"
                aria-pressed={row.present === false}
                aria-label={`Ausente: ${row.studentName}`}
                onClick={() => mark(row.studentId, false)}
                className={cn(
                  "inline-flex h-12 min-w-11 items-center justify-center gap-1 rounded-md border px-2 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring min-[380px]:min-w-[4.25rem] md:h-11",
                  row.present === false
                    ? "border-destructive bg-destructive text-destructive-foreground"
                    : "bg-card hover:bg-secondary",
                )}
              >
                <X className="size-4" aria-hidden /> <span className="max-[379px]:sr-only">Ausente</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  let body;
  if (isLoading) {
    body = (
      <div className="space-y-3 p-4" data-testid="quick-sessions-loading">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  } else if (error) {
    body = (
      <div className="p-6 text-center" data-testid="quick-sessions-error">
        <p className="text-sm text-destructive">{errorMessage(error, "Não foi possível carregar as aulas de hoje.")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Tentar novamente
        </Button>
      </div>
    );
  } else if (sessions.length === 0) {
    body = (
      <p className="p-8 text-center text-sm text-muted-foreground" data-testid="quick-sessions-empty">
        Nenhuma aula hoje.
      </p>
    );
  } else {
    body = (
      <>
        <div role="tablist" aria-label="Aulas de hoje" className="flex shrink-0 gap-2 overflow-x-auto border-b p-3">
          {sessions.map((s) => {
            const active = s.lessonId === selected?.lessonId;
            return (
              <button
                key={s.lessonId}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid="quick-session-tab"
                onClick={() => chooseSession(s.lessonId)}
                className={cn(
                  "flex min-w-44 shrink-0 items-center gap-2 rounded-lg border p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-primary bg-secondary" : "bg-card hover:bg-muted",
                )}
              >
                <EntityAvatar name={s.className} photo={s.classPhoto} icon={Layers} className="size-9" />
                <span className="min-w-0 text-xs leading-tight">
                  <span className="block truncate text-sm font-bold">{s.className}</span>
                  <span className="block text-muted-foreground">
                    {timeLabel(s)} · {STATUS_LABEL[s.status]}
                  </span>
                  <span className="block font-semibold">
                    marcados {s.markedCount}/{s.studentsCount}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel">
          {rows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2 text-xs">
              <span data-testid="quick-summary">
                {plural(summary.present, "presente")} · {plural(summary.absent, "ausente")}
                {summary.undecided > 0 && ` · ${summary.undecided} sem chamada`}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRows((r) => markAll(r, true));
                  setDirty(true);
                }}
              >
                <CheckCheck /> Todos presentes
              </Button>
            </div>
          )}
          {renderRoster()}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {dirty
              ? "Alterações não salvas."
              : decided === 0
                ? "Toque em Presente ou Ausente."
                : summary.undecided > 0
                  ? `${summary.undecided} sem chamada.`
                  : "Chamada completa."}
          </p>
          <Button disabled={decided === 0 || !dirty || save.isPending} onClick={() => void handleSave()}>
            {save.isPending && <Loader2 className="animate-spin" />}
            {save.isPending ? "Salvando…" : "Salvar chamada"}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <h2 className="font-display text-base font-extrabold">Chamada rápida</h2>
        <Button variant="ghost" size="icon" aria-label="Fechar chamada rápida" onClick={onClose}>
          <X />
        </Button>
      </div>
      {body}
    </>
  );
}
