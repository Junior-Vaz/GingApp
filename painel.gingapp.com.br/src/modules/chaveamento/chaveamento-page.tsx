import { useEffect, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, CircleDot, Layers, Plus, Trophy } from "lucide-react";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { useCan } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { EventItem } from "@/modules/eventos/types";
import { AnnouncerProvider } from "./announcer";
import { useCreateTournament, useTournament } from "./api";
import { CategoryDialog } from "./category-dialog";
import { CategoryView } from "./category-view";
import { ControlDesk } from "./control-desk";
import { useCompactSidebar } from "./page-activity";
import { QuickUndoProvider, UndoBar } from "./quick-undo";
import { scrollIntoViewCentered } from "./fields";
import { ScrollFade } from "./scroll-fade";
import { SETUP_STEPS } from "./setup-steps";
import { StepsGuide } from "./steps-guide";
import { TournamentCard } from "./tournament-card";
import { CATEGORY_STATUS_LABEL, LIMITS, type TournamentSummary } from "./types";
import "./chaveamento.css";

interface ChaveamentoPageProps {
  eventId: number;
  /** Volta para a lista de eventos (a rota injeta a navegação). */
  onBack?: () => void;
}

/** Chaveamento do campeonato (operador): mesa de controle, telão, categorias, atletas, sorteio e chave ao vivo. */
export function ChaveamentoPage({ eventId, onBack }: ChaveamentoPageProps) {
  const canEdit = useCan("events", "edit");
  const tournament = useTournament(eventId);
  const create = useCreateTournament(eventId);
  // O título do evento só enfeita o cabeçalho: se falhar, a página funciona do mesmo jeito.
  const event = useQuery({
    queryKey: ["chaveamento", eventId, "event"],
    queryFn: () => api.get<EventItem>(`/events/${String(eventId)}`),
    retry: false,
    staleTime: 60_000,
  });
  const title = event.data?.title;

  useCompactSidebar();

  // Marca a página (CSS): no celular os botões flutuantes globais saem da frente dos botões do placar.
  useEffect(() => {
    document.body.dataset["chaveamento"] = "1";
    return () => {
      delete document.body.dataset["chaveamento"];
    };
  }, []);

  return (
    <AnnouncerProvider>
      <QuickUndoProvider>
        <PageHeader
          title="Chaveamento"
          description={title ? `Campeonato: ${title}` : "Chave ao vivo do campeonato."}
          actions={
            onBack ? (
              <Button variant="outline" onClick={onBack}>
                <ArrowLeft /> Eventos
              </Button>
            ) : undefined
          }
        />
        {tournament.isLoading ? (
          <div className="grid grid-cols-1 gap-4" data-testid="chaveamento-loading" aria-busy="true">
            <Skeleton className="h-56 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
            <Skeleton className="h-72 w-full rounded-2xl" />
          </div>
        ) : tournament.error ? (
          <div className="grid grid-cols-1 justify-items-center gap-3 rounded-lg border p-8 text-center" data-testid="chaveamento-error">
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(tournament.error, "Não foi possível carregar o chaveamento.")}
            </p>
            <Button variant="outline" size="sm" onClick={() => void tournament.refetch()}>
              Tentar de novo
            </Button>
          </div>
        ) : tournament.data === null || tournament.data === undefined ? (
          <div className="grid grid-cols-1 justify-items-center gap-5 rounded-2xl border border-dashed p-6 text-center sm:p-10" data-testid="chaveamento-empty">
            <Trophy className="chv-breathe size-10 text-primary" aria-hidden />
            <div className="grid grid-cols-1 gap-1">
              <p className="text-lg font-extrabold">Este evento ainda não tem chaveamento.</p>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                Crie o chaveamento para montar categorias, sortear as lutas e acompanhar a chave ao vivo.
              </p>
            </div>
            <StepsGuide steps={SETUP_STEPS} current={-1} className="w-full max-w-2xl text-left" />
            {canEdit ? (
              <Button size="lg" className="h-12" disabled={create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? "Criando…" : "Criar chaveamento"}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">Peça a um professor ou ao mestre para criar o chaveamento.</p>
            )}
          </div>
        ) : (
          <TournamentBody eventId={eventId} tournament={tournament.data} canEdit={canEdit} />
        )}
        <UndoBar eventId={eventId} />
      </QuickUndoProvider>
    </AnnouncerProvider>
  );
}

const STATUS_ICON = { SETUP: Layers, RUNNING: CircleDot, FINISHED: CheckCircle2 } as const;

function TournamentBody({ eventId, tournament, canEdit }: { eventId: number; tournament: TournamentSummary; canEdit: boolean }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const categories = tournament.categories;
  const current = categories.find((c) => c.id === selected) ?? categories[0] ?? null;
  const runningIds = categories.filter((c) => c.status === "RUNNING").map((c) => c.id);

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = categories[(index + step + categories.length) % categories.length];
    if (!next) return;
    setSelected(next.id);
    requestAnimationFrame(() => document.getElementById(`cat-tab-${String(next.id)}`)?.focus());
  }

  return (
    <div className="grid grid-cols-1 min-w-0 gap-5 [&>*]:min-w-0">
      {runningIds.length > 0 && <ControlDesk eventId={eventId} runningIds={runningIds} canEdit={canEdit} />}

      <TournamentCard eventId={eventId} tournament={tournament} canEdit={canEdit} />

      <section aria-label="Categorias" className="grid grid-cols-1 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-extrabold">
            Categorias <span className="font-normal text-muted-foreground">({categories.length} de {LIMITS.maxCategories})</span>
          </h2>
          {canEdit && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> Nova categoria
            </Button>
          )}
        </div>

        {categories.length === 0 ? (
          <div className="grid grid-cols-1 gap-4 rounded-2xl border border-dashed p-5 text-center" data-testid="categories-empty">
            <div className="grid grid-cols-1 gap-1">
              <p className="font-extrabold">Nenhuma categoria ainda.</p>
              <p className="text-sm text-muted-foreground">{canEdit ? "Crie a primeira (ex.: Adulto masculino até 70 kg)." : "Quem tiver permissão cria as categorias."}</p>
            </div>
            <StepsGuide steps={SETUP_STEPS} current={0} className="text-left" />
          </div>
        ) : (
          <>
            <ScrollFade role="tablist" aria-label="Categorias do campeonato" className="flex gap-2 rounded-xl bg-muted p-1" data-testid="category-tabs">
              {categories.map((c, index) => {
                const active = current?.id === c.id;
                const Icon = STATUS_ICON[c.status];
                return (
                  <button
                    key={c.id}
                    id={`cat-tab-${String(c.id)}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls="cat-panel"
                    tabIndex={active ? 0 : -1}
                    onClick={(e) => {
                      setSelected(c.id);
                      scrollIntoViewCentered(e.currentTarget);
                    }}
                    onKeyDown={(e) => onTabKeyDown(e, index)}
                    className={cn(
                      "flex min-h-12 shrink-0 flex-col items-start justify-center rounded-lg px-3 py-1 text-left text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="max-w-48 truncate" title={c.name}>{c.name}</span>
                    <span className="flex items-center gap-1 text-xs font-normal">
                      <Icon className="size-3" aria-hidden />
                      {CATEGORY_STATUS_LABEL[c.status]} · {c.competitorsCount} atl.
                      {c.liveMatchesCount > 0 && <Badge variant="destructive" className="px-1.5 py-0 text-xs">{c.liveMatchesCount} ao vivo</Badge>}
                    </span>
                  </button>
                );
              })}
            </ScrollFade>
            <div role="tabpanel" id="cat-panel" aria-labelledby={current ? `cat-tab-${String(current.id)}` : undefined}>
              {current && (
                <CategoryView
                  key={current.id}
                  eventId={eventId}
                  categoryId={current.id}
                  canEdit={canEdit}
                  onDeleted={() => setSelected(null)}
                />
              )}
            </div>
          </>
        )}
      </section>

      <CategoryDialog eventId={eventId} editing={creating ? "new" : null} onClose={() => setCreating(false)} onCreated={(id) => setSelected(id)} />
    </div>
  );
}
