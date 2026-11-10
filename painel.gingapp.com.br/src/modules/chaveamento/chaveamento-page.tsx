import { useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trophy } from "lucide-react";
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
import { TournamentCard } from "./tournament-card";
import { CATEGORY_STATUS_LABEL, LIMITS, type TournamentSummary } from "./types";

interface ChaveamentoPageProps {
  eventId: number;
  /** Volta para a lista de eventos (a rota injeta a navegação). */
  onBack?: () => void;
}

/** Chaveamento do campeonato (operador): telão, categorias, atletas, sorteio e chave ao vivo. */
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

  return (
    <AnnouncerProvider>
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
        <div className="grid gap-4" data-testid="chaveamento-loading">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : tournament.error ? (
        <div className="grid justify-items-center gap-3 rounded-lg border p-8 text-center" data-testid="chaveamento-error">
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(tournament.error, "Não foi possível carregar o chaveamento.")}
          </p>
          <Button variant="outline" size="sm" onClick={() => void tournament.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : tournament.data === null || tournament.data === undefined ? (
        <div className="grid justify-items-center gap-3 rounded-lg border border-dashed p-10 text-center" data-testid="chaveamento-empty">
          <Trophy className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-semibold">Este evento ainda não tem chaveamento.</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Crie o chaveamento para montar categorias, sortear as lutas e acompanhar a chave ao vivo.
          </p>
          {canEdit ? (
            <Button disabled={create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? "Criando…" : "Criar chaveamento"}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Peça a um professor ou ao mestre para criar o chaveamento.</p>
          )}
        </div>
      ) : (
        <TournamentBody eventId={eventId} tournament={tournament.data} canEdit={canEdit} />
      )}
    </AnnouncerProvider>
  );
}

function TournamentBody({ eventId, tournament, canEdit }: { eventId: number; tournament: TournamentSummary; canEdit: boolean }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const categories = tournament.categories;
  const current = categories.find((c) => c.id === selected) ?? categories[0] ?? null;

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
    <div className="grid gap-5">
      <TournamentCard eventId={eventId} tournament={tournament} canEdit={canEdit} />

      <section aria-label="Categorias" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold">
            Categorias <span className="font-normal text-muted-foreground">({categories.length} de {LIMITS.maxCategories})</span>
          </h2>
          {canEdit && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> Nova categoria
            </Button>
          )}
        </div>

        {categories.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="categories-empty">
            Nenhuma categoria ainda. {canEdit ? "Crie a primeira (ex.: Adulto masculino até 70 kg)." : ""}
          </p>
        ) : (
          <>
            <div role="tablist" aria-label="Categorias do campeonato" className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
              {categories.map((c, index) => {
                const active = current?.id === c.id;
                return (
                  <button
                    key={c.id}
                    id={`cat-tab-${String(c.id)}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls="cat-panel"
                    tabIndex={active ? 0 : -1}
                    onClick={() => setSelected(c.id)}
                    onKeyDown={(e) => onTabKeyDown(e, index)}
                    className={cn(
                      "flex min-h-11 shrink-0 flex-col items-start justify-center rounded-md px-3 py-1 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "bg-background text-foreground shadow" : "text-muted-foreground",
                    )}
                  >
                    <span className="max-w-48 truncate">{c.name}</span>
                    <span className="flex items-center gap-1 text-[11px] font-normal">
                      {CATEGORY_STATUS_LABEL[c.status]} · {c.competitorsCount} atl.
                      {c.liveMatchesCount > 0 && <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">{c.liveMatchesCount} ao vivo</Badge>}
                    </span>
                  </button>
                );
              })}
            </div>
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
