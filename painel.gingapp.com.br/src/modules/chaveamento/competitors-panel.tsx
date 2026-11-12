import { useState, type CSSProperties, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, Camera, CameraOff, Check, Pencil, Search, ShieldAlert, ShieldCheck, Trash2, UserPlus, UserRoundSearch, Users, X } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { StudentPicker } from "@/components/painel/student-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { api, errorMessage } from "@/lib/api";
import type { EventParticipant } from "@/modules/eventos/types";
import { PARTICIPANT_STATUS_LABEL } from "@/modules/rodas/types";
import { useAddCompetitor, useImportParticipants, useRemoveCompetitor, useUpdateCompetitor, chaveamentoKeys } from "./api";
import { CompetitorPhoto } from "./competitor-photo";
import { chaveamentoErrorMessage, TOURNAMENT_ERROR_MESSAGES } from "./errors";
import { authorizationText, isAcceptablePhotoUrl, needsPhotoAuthorization, parseOptionalInt, photoIndicatorText, seededCount } from "./helpers";
import { SETUP_STEPS } from "./setup-steps";
import { StepsGuide } from "./steps-guide";
import "./chaveamento.css";
import { AGE_GROUP_LABEL, LIMITS, type AgeGroup, type OperatorCategory, type OperatorCompetitor } from "./types";

const AGE_OPTIONS: AgeGroup[] = ["ADULT", "MINOR", "UNKNOWN"];

interface CompetitorsPanelProps {
  eventId: number;
  category: OperatorCategory;
  canEdit: boolean;
}

/** Atletas da categoria. Adicionar/remover/semente só em SETUP; nome, grupo, graduação e foto a qualquer momento. */
export function CompetitorsPanel({ eventId, category, canEdit }: CompetitorsPanelProps) {
  const setup = category.status === "SETUP";
  const remove = useRemoveCompetitor(eventId);
  const [dialog, setDialog] = useState<"event" | "student" | "guest" | null>(null);
  const [editing, setEditing] = useState<OperatorCompetitor | null>(null);
  const [removing, setRemoving] = useState<OperatorCompetitor | null>(null);
  const [quickId, setQuickId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const ordered = [...category.competitors].sort(
    (a, b) => (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER) || a.displayName.localeCompare(b.displayName, "pt-BR"),
  );
  const term = search.trim().toLocaleLowerCase("pt-BR");
  const shown = term === "" ? ordered : ordered.filter((c) => `${c.displayName} ${c.groupName ?? ""}`.toLocaleLowerCase("pt-BR").includes(term));
  const total = category.competitors.length;
  const seeded = seededCount(category.competitors);
  const pendingAuth = category.competitors.filter((c) => needsPhotoAuthorization(c) && !c.photoAuthorized).length;

  return (
    <section aria-label="Atletas da categoria" className="grid grid-cols-1 gap-3" data-testid="competitors-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">
            Atletas <span className="font-normal text-muted-foreground">({total} de {LIMITS.maxCompetitors})</span>
          </h2>
          <p className="text-xs text-muted-foreground" data-testid="competitors-counter" aria-live="polite">
            {total} {total === 1 ? "atleta" : "atletas"} · {seeded} com semente
            {pendingAuth > 0 ? ` · ${String(pendingAuth)} sem autorização do responsável` : ""}
          </p>
        </div>
        {canEdit && setup && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialog("event")}>
              <CalendarCheck /> Adicionar do evento
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDialog("student")}>
              <UserRoundSearch /> Adicionar aluno
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDialog("guest")}>
              <UserPlus /> Adicionar de fora
            </Button>
          </div>
        )}
      </div>

      {!setup && (
        <p className="text-sm text-muted-foreground">
          A chave já foi gerada: não dá mais para adicionar ou remover atletas. Ainda é possível corrigir nome, grupo, graduação e foto.
        </p>
      )}

      {total >= 6 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Buscar atleta"
            placeholder="Buscar por nome ou academia"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="competitors-search"
          />
        </div>
      )}

      {ordered.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-dashed p-4 sm:p-6" data-testid="competitors-empty">
          <div className="grid grid-cols-1 justify-items-center gap-1 text-center">
            <Users className="chv-breathe size-8 text-muted-foreground" aria-hidden />
            <p className="font-extrabold">Nenhum atleta nesta categoria ainda.</p>
            <p className="text-sm text-muted-foreground">{canEdit && setup ? "Use os botões acima para adicionar." : "Quem tiver permissão adiciona os atletas."}</p>
          </div>
          <StepsGuide steps={SETUP_STEPS} current={0} />
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="competitors-no-match">
          Nenhum atleta com “{search.trim()}”.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2" data-testid="competitors-list">
          {shown.map((c, index) =>
            quickId === c.id ? (
              <QuickEditRow key={c.id} eventId={eventId} competitor={c} setup={setup} onClose={() => setQuickId(null)} />
            ) : (
              <li
                key={c.id}
                className="chv-in flex flex-wrap items-center gap-3 rounded-xl border bg-card px-3 py-2.5"
                style={{ "--i": Math.min(index, 10) } as CSSProperties}
                data-testid={`competitor-${String(c.id)}`}
              >
                <CompetitorPhoto name={c.displayName} photoUrl={c.photoUrl} group={c.groupName} id={c.id} size="lg" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="flex min-w-0 items-center gap-2">
                    {c.seed !== null && (
                      <span className="shrink-0 rounded-md bg-primary px-1.5 py-0.5 text-[11px] font-extrabold text-primary-foreground">Semente {c.seed}</span>
                    )}
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => setQuickId(c.id)}
                        aria-label={`Edição rápida de ${c.displayName}`}
                        title="Toque para editar nome, grupo e semente aqui mesmo"
                        className="min-w-0 truncate rounded text-left text-base font-extrabold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {c.displayName}
                      </button>
                    ) : (
                      <span className="truncate text-base font-extrabold">{c.displayName}</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[c.groupName, c.graduationLabel, c.studentId !== null ? "aluno" : "de fora"].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(c)} aria-label={`Editar ${c.displayName}`}>
                      <Pencil /> <span className="max-sm:sr-only">Editar</span>
                    </Button>
                    {setup && (
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(c)} aria-label={`Remover ${c.displayName}`}>
                        <Trash2 /> <span className="max-sm:sr-only">Remover</span>
                      </Button>
                    )}
                  </div>
                )}
                <p className="flex basis-full flex-wrap items-center gap-1.5 text-xs">
                  <Badge variant="outline">{AGE_GROUP_LABEL[c.ageGroup]}</Badge>
                  <Badge variant={c.photoPublic ? "default" : "secondary"} className="gap-1" data-testid={`photo-indicator-${String(c.id)}`}>
                    {c.photoPublic ? <Camera className="size-3" aria-hidden /> : <CameraOff className="size-3" aria-hidden />}
                    {photoIndicatorText(c)}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn("gap-1", !needsPhotoAuthorization(c) && "text-muted-foreground", needsPhotoAuthorization(c) && !c.photoAuthorized && "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200")}
                    data-testid={`auth-indicator-${String(c.id)}`}
                  >
                    {needsPhotoAuthorization(c) && !c.photoAuthorized ? <ShieldAlert className="size-3" aria-hidden /> : <ShieldCheck className="size-3" aria-hidden />}
                    {authorizationText(c)}
                  </Badge>
                </p>
              </li>
            ),
          )}
        </ul>
      )}

      <ImportFromEventDialog eventId={eventId} category={category} open={dialog === "event"} onClose={() => setDialog(null)} />
      <AddStudentDialog eventId={eventId} category={category} open={dialog === "student"} onClose={() => setDialog(null)} />
      <CompetitorFormDialog
        key={editing ? `edit-${String(editing.id)}` : "new"}
        eventId={eventId}
        category={category}
        editing={editing}
        open={dialog === "guest" || editing !== null}
        onClose={() => {
          setDialog(null);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remover atleta?"
        description={removing ? `"${removing.displayName}" sai desta categoria.` : undefined}
        confirmLabel="Remover"
        onConfirm={async () => {
          try {
            await remove.mutateAsync(removing!.id);
          } catch {
            /* o toast já mostrou a mensagem do erro */
          }
        }}
      />
    </section>
  );
}

/**
 * Edição em linha de nome, grupo e semente (Enter salva, Esc cancela). Foto, faixa etária e autorização continuam no
 * diálogo completo ("Editar").
 */
function QuickEditRow({ eventId, competitor, setup, onClose }: { eventId: number; competitor: OperatorCompetitor; setup: boolean; onClose: () => void }) {
  const update = useUpdateCompetitor(eventId);
  const [name, setName] = useState(competitor.displayName);
  const [group, setGroup] = useState(competitor.groupName ?? "");
  const [seed, setSeed] = useState(competitor.seed === null ? "" : String(competitor.seed));
  const [error, setError] = useState("");

  async function save() {
    setError("");
    const displayName = name.trim();
    if (displayName.length < 2) return setError("Informe o nome do atleta (mínimo 2 caracteres).");
    const seedValue = parseOptionalInt(seed, 1, LIMITS.seedMax);
    if (seedValue === undefined) return setError(`Semente: de 1 a ${String(LIMITS.seedMax)} (vazio = sem semente).`);
    try {
      await update.mutateAsync({
        id: competitor.id,
        data: { displayName, groupName: group.trim() === "" ? null : group.trim(), ...(setup ? { seed: seedValue } : {}) },
      });
      onClose();
    } catch (e) {
      setError(chaveamentoErrorMessage(e));
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void save();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <li className="chv-pop grid grid-cols-1 gap-2 rounded-xl border-2 border-primary bg-secondary/40 p-3" data-testid={`competitor-quick-${String(competitor.id)}`}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_2fr_6rem]">
        <div className="grid grid-cols-1 gap-1">
          <Label htmlFor={`q-name-${String(competitor.id)}`} className="text-xs">Nome</Label>
          <Input id={`q-name-${String(competitor.id)}`} value={name} maxLength={LIMITS.nameMax} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={onKeyDown} />
        </div>
        <div className="grid grid-cols-1 gap-1">
          <Label htmlFor={`q-group-${String(competitor.id)}`} className="text-xs">Grupo / academia</Label>
          <Input id={`q-group-${String(competitor.id)}`} value={group} maxLength={LIMITS.groupNameMax} onChange={(e) => setGroup(e.target.value)} onKeyDown={onKeyDown} />
        </div>
        {setup && (
          <div className="grid grid-cols-1 gap-1">
            <Label htmlFor={`q-seed-${String(competitor.id)}`} className="text-xs">Semente</Label>
            <Input id={`q-seed-${String(competitor.id)}`} inputMode="numeric" value={seed} placeholder="Sem" onChange={(e) => setSeed(e.target.value)} onKeyDown={onKeyDown} />
          </div>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          <X /> Cancelar
        </Button>
        <Button type="button" size="sm" disabled={update.isPending} onClick={() => void save()}>
          <Check /> {update.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Adicionar do evento (participantes CONFIRMED/ATTENDED)
// ---------------------------------------------------------------------------------------------------------------------

const participantName = (p: EventParticipant) => p.student?.name ?? p.guestName ?? "—";

function ImportFromEventDialog({
  eventId,
  category,
  open,
  onClose,
}: {
  eventId: number;
  category: OperatorCategory;
  open: boolean;
  onClose: () => void;
}) {
  const importer = useImportParticipants(eventId);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const list = useQuery({
    queryKey: chaveamentoKeys.participants(eventId),
    queryFn: () => api.get<EventParticipant[]>(`/events/${String(eventId)}/participants`),
    enabled: open,
  });
  const alreadyIn = new Set(category.competitors.map((c) => c.eventParticipantId).filter((id): id is number => id !== null));
  const eligible = (list.data ?? []).filter((p) => p.status === "CONFIRMED" || p.status === "ATTENDED");
  const available = eligible.filter((p) => !alreadyIn.has(p.id));

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    try {
      await importer.mutateAsync({ categoryId: category.id, ids: [...selected] });
      setSelected(new Set());
      onClose();
    } catch {
      /* toast mostrado pelo hook */
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar do evento</DialogTitle>
          <DialogDescription>Participantes confirmados ou com presença registrada neste evento.</DialogDescription>
        </DialogHeader>
        {list.isLoading ? (
          <Skeleton className="h-20 w-full" data-testid="import-loading" />
        ) : list.error ? (
          <div className="space-y-2 text-center">
            <p role="alert" className="text-sm text-destructive">{errorMessage(list.error, "Não foi possível carregar os participantes.")}</p>
            <Button variant="outline" size="sm" onClick={() => void list.refetch()}>Tentar de novo</Button>
          </div>
        ) : eligible.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nenhum participante confirmado neste evento. Confirme as inscrições em Eventos &gt; Participantes.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(selected.size === available.length ? new Set() : new Set(available.map((p) => p.id)))}
                disabled={available.length === 0}
              >
                {selected.size === available.length && available.length > 0 ? "Limpar seleção" : "Selecionar todos"}
              </Button>
              <span className="text-xs text-muted-foreground" aria-live="polite">{selected.size} de {available.length} {available.length === 1 ? "disponível" : "disponíveis"} selecionado(s)</span>
            </div>
            <ul className="max-h-72 divide-y overflow-y-auto rounded-md border" data-testid="import-list">
              {eligible.map((p) => {
                const taken = alreadyIn.has(p.id);
                const id = `import-p-${String(p.id)}`;
                return (
                  <li key={p.id} className="flex min-h-12 items-center gap-3 px-3 py-2 text-sm">
                    <Checkbox
                      id={id}
                      checked={taken || selected.has(p.id)}
                      disabled={taken}
                      onCheckedChange={() => toggle(p.id)}
                      aria-label={`Selecionar ${participantName(p)}`}
                    />
                    <Label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2">
                      <span className="truncate">{participantName(p)}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {taken ? "Já na categoria" : PARTICIPANT_STATUS_LABEL[p.status]}
                      </span>
                    </Label>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={selected.size === 0 || importer.isPending} onClick={() => void submit()}>
            {importer.isPending ? "Importando…" : `Importar ${String(selected.size)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Adicionar aluno (busca de alunos já usada no painel)
// ---------------------------------------------------------------------------------------------------------------------

function AddStudentDialog({
  eventId,
  category,
  open,
  onClose,
}: {
  eventId: number;
  category: OperatorCategory;
  open: boolean;
  onClose: () => void;
}) {
  const add = useAddCompetitor(eventId);
  const [studentId, setStudentId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const taken = category.competitors.map((c) => c.studentId).filter((id): id is number => id !== null);

  async function submit() {
    if (studentId === null) {
      setError("Selecione um aluno.");
      return;
    }
    setError("");
    try {
      await add.mutateAsync({ categoryId: category.id, body: { studentId } });
      setStudentId(null);
      onClose();
    } catch (e) {
      setError(chaveamentoErrorMessage(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar aluno</DialogTitle>
          <DialogDescription>Busque um aluno do grupo pelo nome. A foto do cadastro é usada se a regra de privacidade permitir.</DialogDescription>
        </DialogHeader>
        <StudentPicker value={studentId} onChange={(s) => setStudentId(s?.id ?? null)} excludeIds={taken} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={add.isPending} onClick={() => void submit()}>{add.isPending ? "Adicionando…" : "Adicionar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Atleta de fora (convidado): adicionar e editar
// ---------------------------------------------------------------------------------------------------------------------

function CompetitorFormDialog({
  eventId,
  category,
  editing,
  open,
  onClose,
}: {
  eventId: number;
  category: OperatorCategory;
  editing: OperatorCompetitor | null;
  open: boolean;
  onClose: () => void;
}) {
  const add = useAddCompetitor(eventId);
  const update = useUpdateCompetitor(eventId);
  const setup = category.status === "SETUP";
  const linkedStudent = editing !== null && editing.studentId !== null;
  const [name, setName] = useState(editing?.displayName ?? "");
  const [group, setGroup] = useState(editing?.groupName ?? "");
  const [graduation, setGraduation] = useState(editing?.graduationLabel ?? "");
  const [seed, setSeed] = useState(editing?.seed == null ? "" : String(editing.seed));
  const [ageGroup, setAgeGroup] = useState<AgeGroup>(editing?.ageGroup ?? "ADULT");
  const [photoUrl, setPhotoUrl] = useState(editing?.photoUrl ?? "");
  const [authorized, setAuthorized] = useState(editing?.photoAuthorized ?? false);
  const [error, setError] = useState("");
  const pending = add.isPending || update.isPending;
  const askAuthorization = needsPhotoAuthorization({ ageGroup });

  async function submit() {
    setError("");
    const displayName = name.trim();
    if (displayName.length < 2) return setError("Informe o nome do atleta (mínimo 2 caracteres).");
    const photo = photoUrl.trim();
    if (!linkedStudent && photo !== "" && !isAcceptablePhotoUrl(photo)) return setError(TOURNAMENT_ERROR_MESSAGES.INVALID_PHOTO_URL);
    const seedValue = parseOptionalInt(seed, 1, LIMITS.seedMax);
    if (seedValue === undefined) return setError(`Semente: informe um número de 1 a ${String(LIMITS.seedMax)} (vazio = sem semente).`);

    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          data: {
            displayName,
            groupName: group.trim() === "" ? null : group.trim(),
            graduationLabel: graduation.trim() === "" ? null : graduation.trim(),
            ...(setup ? { seed: seedValue } : {}),
            ...(linkedStudent ? {} : { ageGroup, photoUrl: photo === "" ? null : photo }),
            ...(askAuthorization ? { photoAuthorized: authorized } : {}),
          },
        });
      } else {
        // Um único POST com tudo (semente e autorização dentro de guest): sem PATCH de acompanhamento.
        await add.mutateAsync({
          categoryId: category.id,
          body: {
            guest: {
              displayName,
              ...(group.trim() ? { groupName: group.trim() } : {}),
              ...(graduation.trim() ? { graduationLabel: graduation.trim() } : {}),
              ageGroup,
              ...(photo ? { photoUrl: photo } : {}),
              ...(seedValue !== null ? { seed: seedValue } : {}),
              ...(authorized && askAuthorization ? { photoAuthorized: true } : {}),
            },
          },
        });
      }
      onClose();
    } catch (e) {
      setError(chaveamentoErrorMessage(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar atleta" : "Adicionar de fora"}</DialogTitle>
          <DialogDescription>
            {editing ? "Corrija os dados do atleta." : "Atleta de outro grupo, sem cadastro de aluno."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3">
          <div className="grid grid-cols-1 gap-1.5">
            <Label htmlFor="comp-name">Nome</Label>
            <Input id="comp-name" value={name} maxLength={LIMITS.nameMax} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid grid-cols-1 gap-1.5">
              <Label htmlFor="comp-group">Grupo / academia</Label>
              <Input id="comp-group" value={group} maxLength={LIMITS.groupNameMax} onChange={(e) => setGroup(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              <Label htmlFor="comp-grad">Graduação</Label>
              <Input id="comp-grad" value={graduation} maxLength={LIMITS.graduationMax} onChange={(e) => setGraduation(e.target.value)} />
            </div>
          </div>
          {(editing === null || setup) && (
            <div className="grid grid-cols-1 gap-1.5">
              <Label htmlFor="comp-seed">Semente (cabeça de chave, opcional)</Label>
              <Input id="comp-seed" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="Sem semente" />
            </div>
          )}
          {linkedStudent ? (
            <p className="text-sm text-muted-foreground">
              Faixa etária: <strong>{AGE_GROUP_LABEL[editing.ageGroup]}</strong> (calculada pela data de nascimento do aluno).
            </p>
          ) : (
            <fieldset className="grid grid-cols-1 gap-1.5">
              <legend className="mb-1 text-sm font-medium">Maior ou menor de idade?</legend>
              <div className="flex flex-wrap gap-4 text-sm">
                {AGE_OPTIONS.map((option) => (
                  <label key={option} className="flex min-h-9 cursor-pointer items-center gap-2">
                    <input type="radio" name="comp-age" checked={ageGroup === option} onChange={() => setAgeGroup(option)} />
                    {AGE_GROUP_LABEL[option]}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {!linkedStudent && (
            <div className="grid grid-cols-1 gap-1.5">
              <Label htmlFor="comp-photo">Foto (endereço https://, opcional)</Label>
              <Input id="comp-photo" inputMode="url" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://…" />
            </div>
          )}
          {askAuthorization && (
            <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3">
              <Checkbox id="comp-authorized" checked={authorized} onCheckedChange={(v) => setAuthorized(v === true)} className="mt-0.5" />
              <Label htmlFor="comp-authorized" className="text-sm font-normal leading-snug">
                Tenho autorização do responsável para exibir a foto no telão
              </Label>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={pending} onClick={() => void submit()}>{pending ? "Salvando…" : editing ? "Salvar" : "Adicionar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
