import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ChevronDown, Keyboard, Play, RadioTower } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAnnounce } from "./announce-context";
import { useDeskCategories, useStartMatch } from "./api";
import { CompetitorPhoto, PhotoScope } from "./competitor-photo";
import { collectDesk, type DeskEntry, type MatFilter } from "./desk";
import { competitorMap, competitorMeta, EMPTY_SLOT, lastMainRound, matLabel, sideName, stageLabel } from "./helpers";
import { MatchControls } from "./match-controls";
import { MatchDialog } from "./match-dialog";
import { OfflineNotice } from "./offline-notice";
import { useOnline } from "./page-activity";
import { ScrollFade } from "./scroll-fade";
import { shortcutKey, shouldIgnoreShortcut } from "./shortcuts";
import "./chaveamento.css";

const NEXT_VISIBLE = 5;

interface ControlDeskProps {
  eventId: number;
  /** Categorias EM ANDAMENTO (a mesa só olha essas). */
  runningIds: readonly number[];
  canEdit: boolean;
}

const filterLabel = (filter: MatFilter): string => (filter === "all" ? "todos os tatames" : filter === "none" ? "lutas sem tatame" : `Tatame ${String(filter)}`);

/**
 * Mesa de controle (topo do torneio): "AO VIVO agora" e "PRÓXIMAS" de TODAS as categorias em andamento, ordenadas por
 * ordem de chamada e tatame. A luta ao vivo traz placar +/−, botões gigantes de vencedor e (no desktop) atalhos A/B/U.
 */
export function ControlDesk({ eventId, runningIds, canEdit }: ControlDeskProps) {
  const { categories, loading, failed, refetch } = useDeskCategories(eventId, runningIds);
  const announce = useAnnounce();
  const start = useStartMatch(eventId);
  const online = useOnline();
  const [filter, setFilter] = useState<MatFilter>("all");
  const [focusId, setFocusId] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [opened, setOpened] = useState<{ categoryId: number; matchId: number } | null>(null);
  const desk = useMemo(() => collectDesk(categories, filter), [categories, filter]);

  // Um tatame que acabou (ou sumiu) não pode deixar a mesa vazia: volta para "todos".
  useEffect(() => {
    if ((typeof filter === "number" && !desk.mats.includes(filter)) || (filter === "none" && !desk.hasNoMat)) setFilter("all");
  }, [filter, desk.mats, desk.hasNoMat]);

  const focused = desk.live.find((e) => e.match.id === focusId) ?? desk.live[0] ?? null;
  const first = desk.next[0] ?? null;

  async function startEntry(entry: DeskEntry) {
    const names = competitorMap(entry.category);
    const a = sideName(names, entry.match.slotAId) ?? EMPTY_SLOT;
    const b = sideName(names, entry.match.slotBId) ?? EMPTY_SLOT;
    try {
      await start.mutateAsync(entry.match.id);
      announce(`Luta iniciada: ${a} contra ${b}.`);
    } catch {
      /* o toast do hook já mostrou a mensagem do `code` */
    }
  }

  // I = iniciar a próxima luta da fila (A/B/U agem na luta ao vivo em foco, dentro do cartão dela).
  useEffect(() => {
    if (!canEdit || first === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcut(event) || shortcutKey(event) !== "i" || start.isPending || !online) return;
      event.preventDefault();
      void startEntry(first);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, first, start.isPending, online]);

  const openedCategory = opened ? (categories.find((c) => c.id === opened.categoryId) ?? null) : null;
  const visibleNext = showAll ? desk.next : desk.next.slice(0, NEXT_VISIBLE);
  const matOptions: Array<{ value: MatFilter; label: string }> = [
    { value: "all", label: "Todos os tatames" },
    ...desk.mats.map((m) => ({ value: m as MatFilter, label: `Tatame ${String(m)}` })),
    ...(desk.hasNoMat && desk.mats.length > 0 ? [{ value: "none" as MatFilter, label: "Sem tatame" }] : []),
  ];

  return (
    <section aria-label="Mesa de controle" className="grid grid-cols-1 min-w-0 gap-4 rounded-2xl border bg-card p-3 shadow-sm sm:p-4 [&>*]:min-w-0" data-testid="control-desk">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <RadioTower className="size-5 text-primary" aria-hidden /> Mesa de controle
        </h2>
        {matOptions.length > 1 && (
          <ScrollFade role="radiogroup" aria-label="Filtrar por tatame" className="flex max-w-full gap-2 rounded-xl bg-muted p-1" data-testid="mat-filter">
            {matOptions.map((o) => {
              const active = o.value === filter;
              return (
                <button
                  key={String(o.value)}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setFilter(o.value)}
                  className={cn(
                    "min-h-11 shrink-0 rounded-lg px-3 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9 pointer-coarse:md:min-h-11",
                    active ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </ScrollFade>
        )}
      </header>

      <OfflineNotice />

      {loading && categories.length === 0 ? (
        <div className="grid grid-cols-1 gap-3" data-testid="desk-loading">
          <Skeleton className="h-44 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : categories.length === 0 && failed > 0 ? (
        <div className="grid grid-cols-1 justify-items-start gap-2 text-sm" data-testid="desk-error">
          <p role="alert" className="text-destructive">Não foi possível carregar as lutas das categorias em andamento.</p>
          <Button variant="outline" size="sm" onClick={refetch}>Tentar de novo</Button>
        </div>
      ) : (
        <>
          <section aria-label="Ao vivo agora" className="grid grid-cols-1 gap-3">
            <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider">
              <span className={cn("size-2.5 rounded-full", desk.live.length > 0 ? "chv-dot bg-red-600" : "bg-muted-foreground/50")} aria-hidden />
              Ao vivo agora
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs tabular-nums" data-testid="desk-live-count">{desk.live.length}</span>
            </h3>
            {desk.live.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground" data-testid="desk-live-empty">
                Nenhuma luta ao vivo em {filterLabel(filter)}.{canEdit && first ? " Toque em “Iniciar luta” na próxima da fila." : ""}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {desk.live.map((entry) => (
                  <PhotoScope key={entry.match.id} eventId={eventId} categoryId={entry.category.id}>
                    <LiveCard
                      eventId={eventId}
                      entry={entry}
                      canEdit={canEdit}
                      focused={focused?.match.id === entry.match.id}
                      multiple={desk.live.length > 1}
                      onFocus={() => setFocusId(entry.match.id)}
                    />
                  </PhotoScope>
                ))}
              </div>
            )}
            {canEdit && desk.live.length > 0 && (
              <p className="hidden items-center gap-2 text-xs text-muted-foreground pointer-fine:lg:flex" data-testid="desk-shortcuts">
                <Keyboard className="size-4" aria-hidden />
                Atalhos{desk.live.length > 1 ? " (na luta marcada)" : ""}: <b>A</b> ou <b>B</b> = vencedor · <b>U</b> = desfazer · <b>I</b> = iniciar a próxima
              </p>
            )}
          </section>

          <section aria-label="Próximas lutas" className="grid grid-cols-1 gap-3">
            <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider">
              Próximas
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs tabular-nums" data-testid="desk-next-count">{desk.next.length}</span>
            </h3>
            {desk.next.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground" data-testid="desk-next-empty">
                Nenhuma luta pronta em {filterLabel(filter)}. As próximas aparecem aqui quando os dois atletas estiverem definidos.
              </p>
            ) : (
              <ol className="grid grid-cols-1 gap-2" data-testid="desk-next-list">
                {visibleNext.map((entry, index) => (
                  <PhotoScope key={entry.match.id} eventId={eventId} categoryId={entry.category.id}>
                    <NextRow
                      entry={entry}
                      index={index}
                      featured={index === 0}
                      canEdit={canEdit}
                      starting={start.isPending && start.variables === entry.match.id}
                      anyStarting={start.isPending}
                      onStart={() => void startEntry(entry)}
                      onOpen={() => setOpened({ categoryId: entry.category.id, matchId: entry.match.id })}
                    />
                  </PhotoScope>
                ))}
              </ol>
            )}
            {desk.next.length > NEXT_VISIBLE && (
              <Button variant="ghost" size="sm" className="justify-self-start" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
                <ChevronDown className={cn(showAll && "rotate-180")} />
                {showAll ? "Mostrar menos" : `Ver mais ${String(desk.next.length - NEXT_VISIBLE)}`}
              </Button>
            )}
          </section>
        </>
      )}

      {openedCategory && (
        <PhotoScope eventId={eventId} categoryId={openedCategory.id}>
          <MatchDialog eventId={eventId} category={openedCategory} matchId={opened?.matchId ?? null} canEdit={canEdit} onClose={() => setOpened(null)} />
        </PhotoScope>
      )}
    </section>
  );
}

function entryNames(entry: DeskEntry) {
  const names = competitorMap(entry.category);
  const a = entry.match.slotAId === null ? null : (names.get(entry.match.slotAId) ?? null);
  const b = entry.match.slotBId === null ? null : (names.get(entry.match.slotBId) ?? null);
  return { a, b, nameA: a?.displayName ?? EMPTY_SLOT, nameB: b?.displayName ?? EMPTY_SLOT };
}

/** "Categoria · Semifinal · Tatame 2 · Ordem 3". */
function entryLine(entry: DeskEntry): string {
  const { match, category } = entry;
  return [category.name, stageLabel(match, lastMainRound(category.matches)), matLabel(match.mat), match.queueOrder !== null ? `Ordem ${String(match.queueOrder)}` : null]
    .filter(Boolean)
    .join(" · ");
}

function LiveCard({
  eventId,
  entry,
  canEdit,
  focused,
  multiple,
  onFocus,
}: {
  eventId: number;
  entry: DeskEntry;
  canEdit: boolean;
  focused: boolean;
  multiple: boolean;
  onFocus: () => void;
}) {
  const { match, category } = entry;
  const { a, b, nameA, nameB } = entryNames(entry);
  const mat = matLabel(match.mat);
  return (
    <article
      aria-label={`Luta ao vivo: ${nameA} contra ${nameB}`}
      data-testid={`desk-live-${String(match.id)}`}
      data-focused={focused ? "true" : undefined}
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
      className="chv-in @container relative rounded-2xl border-2 border-red-600 bg-red-50/70 p-3 sm:p-4 dark:bg-red-950/30"
    >
      <span className="chv-halo pointer-events-none absolute -inset-1.5 rounded-[20px] ring-2 ring-red-500/70" aria-hidden />
      <div className="relative grid grid-cols-1 gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-2 py-1 text-xs font-extrabold tracking-wider text-white">
            <span className="chv-dot size-1.5 rounded-full bg-white" aria-hidden /> AO VIVO
          </span>
          {mat && <span className="rounded-md border bg-card px-2 py-1 text-xs font-bold">{mat}</span>}
          <span className="line-clamp-2 min-w-32 flex-1 basis-32 break-words text-xs font-semibold text-muted-foreground" title={entryLine(entry)}>
            {entryLine({ ...entry, match: { ...match, mat: null } })}
          </span>
          {multiple && focused && canEdit && <span className="rounded-md bg-primary px-2 py-1 text-xs font-extrabold uppercase tracking-wider text-primary-foreground">Atalhos aqui</span>}
        </div>
        {canEdit ? (
          <MatchControls eventId={eventId} category={category} match={match} canEdit variant="desk" shortcuts={focused} />
        ) : (
          <div className="grid grid-cols-1 gap-2 @lg:grid-cols-2">
            {[a, b].map((c, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                <CompetitorPhoto name={c?.displayName ?? EMPTY_SLOT} photoUrl={c?.photoUrl ?? null} own={c} group={c?.groupName} id={c?.id} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 break-words font-extrabold" title={c?.displayName ?? EMPTY_SLOT}>{c?.displayName ?? EMPTY_SLOT}</p>
                  <p className="line-clamp-2 break-words text-xs text-muted-foreground">{competitorMeta(c)}</p>
                </div>
                <span className="text-3xl font-black tabular-nums">{(i === 0 ? match.scoreA : match.scoreB) ?? 0}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function NextRow({
  entry,
  index,
  featured,
  canEdit,
  starting,
  anyStarting,
  onStart,
  onOpen,
}: {
  entry: DeskEntry;
  index: number;
  featured: boolean;
  canEdit: boolean;
  starting: boolean;
  anyStarting: boolean;
  onStart: () => void;
  onOpen: () => void;
}) {
  const { a, b, nameA, nameB } = entryNames(entry);
  const offline = !useOnline();
  return (
    <li
      data-testid={`desk-next-${String(entry.match.id)}`}
      style={{ "--i": index } as CSSProperties}
      className={cn("chv-in grid grid-cols-1 gap-3 rounded-xl border bg-card p-3", featured && "border-2 border-emerald-600 bg-emerald-50/60 sm:p-4 dark:bg-emerald-950/20")}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn("grid shrink-0 place-items-center rounded-full bg-muted font-extrabold tabular-nums", featured ? "size-10 bg-emerald-700 text-white" : "size-8 text-sm")} aria-hidden>
          {index + 1}
        </span>
        <div className="flex shrink-0 -space-x-2" aria-hidden>
          <CompetitorPhoto name={nameA} photoUrl={a?.photoUrl ?? null} own={a} group={a?.groupName} id={a?.id} size={featured ? "lg" : "sm"} />
          <CompetitorPhoto name={nameB} photoUrl={b?.photoUrl ?? null} own={b} group={b?.groupName} id={b?.id} size={featured ? "lg" : "sm"} />
        </div>
        <div className="min-w-0 flex-1 basis-40">
          {featured && <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-emerald-800 dark:text-emerald-300">Próxima luta</p>}
          <p className={cn("line-clamp-2 break-words font-extrabold leading-tight", featured ? "text-base sm:text-lg" : "text-sm")} title={`${nameA} x ${nameB}`}>
            {nameA} <span className="font-normal text-muted-foreground">x</span> {nameB}
          </p>
          <p className="line-clamp-2 break-words text-xs text-muted-foreground" title={entryLine(entry)}>{entryLine(entry)}</p>
        </div>
        {!featured && (
          <div className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:[&>*]:flex-1">
            {canEdit && (
              <Button type="button" size="sm" disabled={anyStarting || offline} onClick={onStart} aria-label={`Iniciar luta: ${nameA} contra ${nameB}`}>
                <Play /> Iniciar
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={onOpen} aria-label={`Abrir a luta ${nameA} contra ${nameB}`}>
              Abrir
            </Button>
          </div>
        )}
      </div>
      {featured && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          {canEdit && (
            <Button type="button" size="lg" className="h-14 gap-2 text-base font-extrabold md:h-14" disabled={anyStarting || offline} onClick={onStart} aria-label={`Iniciar luta: ${nameA} contra ${nameB}`}>
              <Play className="!size-5" /> {starting ? "Iniciando…" : "Iniciar luta"}
              <kbd className="hidden rounded border border-current/30 px-1.5 py-0.5 font-sans text-xs font-bold leading-none lg:inline">I</kbd>
            </Button>
          )}
          <Button type="button" variant="outline" className="h-11 sm:h-14 md:h-14" onClick={onOpen} aria-label={`Abrir a luta ${nameA} contra ${nameB}`}>
            Abrir
          </Button>
        </div>
      )}
      {/* Descrição extra só para leitor de tela: o resumo dos dois lados. */}
      <span className="sr-only">{competitorMeta(a)} contra {competitorMeta(b)}</span>
    </li>
  );
}
