import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, Pencil, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { useAnnounce } from "./announce-context";
import { useCategory, useDeleteCategory, useSwapSlots } from "./api";
import { BracketView } from "./bracket-view";
import { CategoryDialog } from "./category-dialog";
import { CompetitorsPanel } from "./competitors-panel";
import { DrawCeremony } from "./draw-ceremony";
import { DrawPanel } from "./draw-panel";
import { GroupStageView, PodiumView } from "./group-stage-view";
import { canSwapSlots, competitorMap, firstMainRound, sideName } from "./helpers";
import { MatchDialog } from "./match-dialog";
import { SETUP_STEPS } from "./setup-steps";
import { StepsGuide } from "./steps-guide";
import { prefersReducedMotion } from "./use-reduced-motion";
import { CATEGORY_STATUS_LABEL, FORMAT_LABEL, type OperatorCategory, type OperatorMatch, type Slot } from "./types";
import "./chaveamento.css";

interface CategoryViewProps {
  eventId: number;
  categoryId: number;
  canEdit: boolean;
  /** Depois de excluir, a página escolhe outra aba. */
  onDeleted: () => void;
}

/** Uma categoria aberta: sorteio e atletas (montagem) ou chave/classificação ao vivo (andamento). */
export function CategoryView({ eventId, categoryId, canEdit, onDeleted }: CategoryViewProps) {
  const query = useCategory(eventId, categoryId);
  if (query.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4" data-testid="category-loading" aria-busy="true">
        <div className="grid grid-cols-1 gap-2">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (query.error || !query.data) {
    return (
      <div className="grid grid-cols-1 justify-items-center gap-3 rounded-lg border p-8 text-center" data-testid="category-error">
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(query.error, "Não foi possível carregar a categoria.")}
        </p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  }
  return <CategoryBody eventId={eventId} category={query.data} canEdit={canEdit} onDeleted={onDeleted} />;
}

function CategoryBody({
  eventId,
  category,
  canEdit,
  onDeleted,
}: {
  eventId: number;
  category: OperatorCategory;
  canEdit: boolean;
  onDeleted: () => void;
}) {
  const announce = useAnnounce();
  const swap = useSwapSlots(eventId);
  const remove = useDeleteCategory(eventId);
  const [matchId, setMatchId] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [swapMode, setSwapMode] = useState(false);
  const [picked, setPicked] = useState<{ matchId: number; slot: Slot } | null>(null);
  const [pathId, setPathId] = useState<number | null>(null);
  const [ceremony, setCeremony] = useState(false);
  const competitors = competitorMap(category);
  const generated = category.matches.length > 0;
  const swappable = canEdit && canSwapSlots(category);
  const firstRound = firstMainRound(category.matches);
  const hasMain = category.matches.some((m) => m.stage === "MAIN");
  const hasGroups = category.matches.some((m) => m.stage === "GROUP");
  const closeMatch = useCallback(() => setMatchId(null), []);
  const endCeremony = useCallback(() => setCeremony(false), []);

  // Se alguém começar uma luta enquanto a troca está ligada, a troca deixa de valer (SWAP_NOT_ALLOWED).
  useEffect(() => {
    if (!swappable) {
      setSwapMode(false);
      setPicked(null);
    }
  }, [swappable]);

  // O atleta destacado pode sumir (chave sorteada de novo): limpa o realce.
  useEffect(() => {
    if (pathId !== null && !competitors.has(pathId)) setPathId(null);
  }, [pathId, competitors]);

  function onSelectMatch(match: OperatorMatch) {
    setMatchId(match.id);
  }

  async function onPick(pickedMatchId: number, slot: Slot) {
    if (picked === null) {
      setPicked({ matchId: pickedMatchId, slot });
      return;
    }
    if (picked.matchId === pickedMatchId && picked.slot === slot) {
      setPicked(null); // tocar no mesmo atleta cancela
      return;
    }
    const first = category.matches.find((m) => m.id === picked.matchId);
    const second = category.matches.find((m) => m.id === pickedMatchId);
    const firstId = first ? (picked.slot === "A" ? first.slotAId : first.slotBId) : null;
    const secondId = second ? (slot === "A" ? second.slotAId : second.slotBId) : null;
    setPicked(null);
    if (!first || !second || firstId === null || secondId === null) return;
    // A API troca "pelo lugar": o atleta que estava no lugar tocado primeiro passa a ser o outro (e vice-versa).
    const body =
      first.id === second.id
        ? { matchId: first.id, slotAId: first.slotBId!, slotBId: first.slotAId! }
        : picked.slot === "A"
          ? { matchId: first.id, slotAId: secondId }
          : { matchId: first.id, slotBId: secondId };
    try {
      await swap.mutateAsync(body);
      announce(`${sideName(competitors, firstId) ?? "Atleta"} e ${sideName(competitors, secondId) ?? "atleta"} trocaram de lugar.`);
    } catch {
      /* o toast já mostrou a mensagem do `code` */
    }
  }

  const pickedName = picked
    ? sideName(
        competitors,
        (() => {
          const m = category.matches.find((x) => x.id === picked.matchId);
          return m ? (picked.slot === "A" ? m.slotAId : m.slotBId) : null;
        })(),
      )
    : null;

  const config =
    category.format === "GROUPS_KNOCKOUT"
      ? `${String(category.groupCount ?? 0)} grupos, ${String(category.advancePerGroup ?? 0)} classificado(s) por grupo`
      : null;

  // Cerimônia do sorteio: curta, pulável e NUNCA com movimento reduzido.
  const onDrawn = useCallback(() => {
    if (!prefersReducedMotion()) setCeremony(true);
  }, []);

  return (
    <div className="chv-in grid grid-cols-1 min-w-0 gap-5 [&>*]:min-w-0" data-testid="category-body">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-extrabold">{category.name}</h2>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{FORMAT_LABEL[category.format]}</span>
            {config && <span>· {config}</span>}
            {category.format !== "ROUND_ROBIN" && category.thirdPlace && <span>· com 3º lugar</span>}
            <Badge variant={category.status === "RUNNING" ? "default" : "secondary"}>{CATEGORY_STATUS_LABEL[category.status]}</Badge>
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label={`Editar categoria ${category.name}`}>
              <Pencil /> Editar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDeleting(true)} aria-label={`Excluir categoria ${category.name}`}>
              <Trash2 /> Excluir
            </Button>
          </div>
        )}
      </div>

      {!canEdit && (
        <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground" data-testid="readonly-note">
          Somente leitura: seu papel permite acompanhar a chave, mas não alterar atletas nem resultados.
        </p>
      )}

      {category.podium.length > 0 && <PodiumView podium={category.podium} competitors={competitors} />}

      {!generated ? (
        <>
          {category.competitors.length > 0 && <StepsGuide steps={SETUP_STEPS} current={category.competitors.length >= 2 ? 1 : 0} />}
          <CompetitorsPanel eventId={eventId} category={category} canEdit={canEdit} />
          <DrawPanel eventId={eventId} category={category} canEdit={canEdit} onDrawn={onDrawn} />
        </>
      ) : (
        <>
          {hasGroups && <GroupStageView category={category} competitors={competitors} onSelectMatch={onSelectMatch} />}
          {hasMain && (
            <section aria-label="Chave" className="grid grid-cols-1 gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-extrabold">{category.format === "GROUPS_KNOCKOUT" ? "Mata-mata" : "Chave"}</h3>
                {swappable && (
                  <Button
                    variant={swapMode ? "default" : "outline"}
                    size="sm"
                    aria-pressed={swapMode}
                    onClick={() => {
                      setSwapMode((on) => !on);
                      setPicked(null);
                    }}
                  >
                    <ArrowLeftRight /> {swapMode ? "Concluir troca" : "Trocar atletas"}
                  </Button>
                )}
              </div>
              {swapMode && (
                <p className="rounded-md border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" aria-live="polite" data-testid="swap-hint">
                  {pickedName
                    ? `Selecionado: ${pickedName}. Toque em outro atleta da 1ª rodada para trocar de lugar (ou toque nele de novo para cancelar).`
                    : "Toque num atleta da 1ª rodada e depois em outro para trocar os dois de lugar."}
                </p>
              )}
              <BracketView
                matches={category.matches}
                competitors={competitors}
                onSelectMatch={onSelectMatch}
                swap={{ active: swapMode, picked, firstRound, onPick: (id, slot) => void onPick(id, slot) }}
                pathId={pathId}
                onPathChange={setPathId}
              />
            </section>
          )}
          <details className="rounded-xl border bg-card p-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Atletas ({category.competitors.length})</summary>
            <div className="mt-3">
              <CompetitorsPanel eventId={eventId} category={category} canEdit={canEdit} />
            </div>
          </details>
          <DrawPanel eventId={eventId} category={category} canEdit={canEdit} onDrawn={onDrawn} />
        </>
      )}

      {ceremony && <DrawCeremony athletes={category.competitors} onDone={endCeremony} />}

      <MatchDialog eventId={eventId} category={category} matchId={matchId} canEdit={canEdit} onClose={closeMatch} onShowPath={setPathId} />
      <CategoryDialog eventId={eventId} editing={editing ? category : null} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Excluir categoria?"
        description={`"${category.name}" e todos os atletas e lutas dela serão apagados. Só é possível enquanto não houver luta em andamento ou encerrada.`}
        confirmLabel="Excluir"
        onConfirm={async () => {
          try {
            await remove.mutateAsync(category.id);
            onDeleted();
          } catch {
            /* o toast já mostrou a mensagem do `code` */
          }
        }}
      />
    </div>
  );
}
