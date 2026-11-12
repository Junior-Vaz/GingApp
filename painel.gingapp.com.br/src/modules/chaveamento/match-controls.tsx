import { useEffect, useId, useRef, useState } from "react";
import { Footprints, Minus, Play, Plus, Route, Trophy, Undo2 } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { NativeSelect } from "@/modules/rodas/native-select";
import { CompetitorPhoto } from "./competitor-photo";
import { competitorMeta, scoreText } from "./helpers";
import { useMatchActions } from "./match-actions";
import { useQuickUndo } from "./quick-undo-context";
import { shortcutKey, shouldIgnoreShortcut } from "./shortcuts";
import { LIMITS, MATCH_STATUS_LABEL, RESULT_TYPE_LABEL, type OperatorCategory, type OperatorCompetitor, type OperatorMatch, type ResultType, type Slot } from "./types";

interface MatchControlsProps {
  eventId: number;
  category: OperatorCategory;
  match: OperatorMatch;
  canEdit: boolean;
  /** `dialog`: ação rápida (bottom sheet), com tatame/ordem. `desk`: cartão da mesa de controle. */
  variant: "dialog" | "desk";
  /** Depois de salvar o resultado (a ação rápida se fecha). */
  onDone?: (() => void) | undefined;
  /** Atalhos de teclado A/B/U/I valem para esta luta (só a luta "em foco" da mesa liga). */
  shortcuts?: boolean | undefined;
  /** Destacar o caminho de um atleta na chave (a ação rápida se fecha). */
  onShowPath?: ((competitorId: number) => void) | undefined;
}

const clampScore = (n: number): number => Math.min(Math.max(n, 0), LIMITS.scoreMax);

/** "3" + 1 -> "4"; vazio conta como 0; texto inválido não muda nada. */
function bumpScore(text: string, delta: number): string {
  const value = text.trim() === "" ? 0 : /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
  return value === null ? text : String(clampScore(value + delta));
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="hidden rounded border border-current/30 px-1.5 py-0.5 font-sans text-[11px] font-bold leading-none opacity-80 lg:inline">{children}</kbd>
  );
}

/**
 * Controles da luta: iniciar, placar com +/−, botões grandes de vencedor, outro tipo de resultado (W.O.,
 * desclassificação, empate) e desfazer. É o mesmo componente na ação rápida e na mesa de controle.
 */
export function MatchControls({ eventId, category, match, canEdit, variant, onDone, shortcuts, onShowPath }: MatchControlsProps) {
  const actions = useMatchActions(eventId, category, match);
  const quick = useQuickUndo();
  const uid = useId();
  const { competitors, titleA, titleB, busy } = actions;
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [resultType, setResultType] = useState<ResultType>("NORMAL");
  const [scoreA, setScoreA] = useState(match.scoreA === null ? "" : String(match.scoreA));
  const [scoreB, setScoreB] = useState(match.scoreB === null ? "" : String(match.scoreB));
  const [mat, setMat] = useState(match.mat === null ? "" : String(match.mat));
  const [queue, setQueue] = useState(match.queueOrder === null ? "" : String(match.queueOrder));

  const hasBoth = match.slotAId !== null && match.slotBId !== null;
  const canScore = canEdit && !match.isBye && hasBoth && (match.status === "READY" || match.status === "LIVE");
  const compA = match.slotAId === null ? null : (competitors.get(match.slotAId) ?? null);
  const compB = match.slotBId === null ? null : (competitors.get(match.slotBId) ?? null);
  const score = scoreText(match);
  const winnerName = match.winnerId === null ? null : (competitors.get(match.winnerId)?.displayName ?? "Atleta");

  async function winner(slot: Slot) {
    const id = slot === "A" ? match.slotAId : match.slotBId;
    if (id === null) return;
    const done = await actions.onWinner(id, slot === "A" ? titleA : titleB, scoreA, scoreB, resultType);
    if (done) onDone?.();
  }
  async function draw() {
    const done = await actions.onDraw(scoreA, scoreB);
    if (done) onDone?.();
  }

  // Atalhos: sempre a versão mais recente das funções (o listener é registrado uma vez).
  const latest = useRef({ winner, start: actions.onStart, status: match.status, resultType, canScore, busy, hasQuick: quick.current !== null });
  latest.current = { winner, start: actions.onStart, status: match.status, resultType, canScore, busy, hasQuick: quick.current !== null };
  useEffect(() => {
    if (!shortcuts) return;
    const onKey = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcut(event)) return;
      const key = shortcutKey(event);
      const now = latest.current;
      if (key === null || !now.canScore || now.busy) return;
      if (key === "u") {
        // Com a janela do desfazer rápido aberta, quem trata o U é a barra (imediato); senão pede confirmação.
        if (now.hasQuick || now.status === "READY") return;
        event.preventDefault();
        setConfirmUndo(true);
      } else if (key === "i") {
        if (now.status !== "READY") return;
        event.preventDefault();
        void now.start();
      } else if (now.resultType !== "DRAW") {
        event.preventDefault();
        void now.winner(key === "a" ? "A" : "B");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts]);

  const sideProps = { uid, busy, resultType, variant } as const;

  return (
    <div className="grid grid-cols-1 gap-4" data-testid={variant === "desk" ? "desk-controls" : undefined}>
      {actions.error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" data-testid="match-error">
          {actions.error}
        </p>
      )}

      {match.isBye ? (
        <p className="text-sm text-muted-foreground">Folga: este atleta avança automaticamente. Não há luta para registrar.</p>
      ) : match.status === "PENDING" || !hasBoth ? (
        <p className="text-sm text-muted-foreground">Aguardando os atletas das lutas anteriores. Termine essas lutas primeiro.</p>
      ) : null}

      {match.status === "FINISHED" && !match.isBye && (
        <div className="rounded-xl border bg-muted/40 p-3 text-sm" data-testid="match-result">
          <p className="flex items-center gap-2 font-extrabold">
            <Trophy className="size-4 text-emerald-700" aria-hidden />
            {winnerName ? `Vencedor: ${winnerName}` : match.resultType === "DRAW" ? "Empate" : "Encerrada"}
          </p>
          <p className="text-muted-foreground">
            {[score ? `Placar ${score}` : null, match.resultType ? RESULT_TYPE_LABEL[match.resultType] : null].filter(Boolean).join(" · ") || MATCH_STATUS_LABEL.FINISHED}
          </p>
        </div>
      )}

      {!canEdit && variant === "dialog" && <p className="text-sm text-muted-foreground">Somente leitura: seu papel não permite registrar resultados.</p>}

      {canEdit && match.status === "READY" && !match.isBye && hasBoth && (
        <Button type="button" size="lg" className="h-14 gap-2 text-base font-extrabold" disabled={busy} onClick={() => void actions.onStart()}>
          <Play className="!size-5" /> Iniciar luta {shortcuts && <Kbd>I</Kbd>}
        </Button>
      )}

      {canScore && (
        <fieldset className="grid grid-cols-1 gap-3" disabled={busy}>
          <legend className="sr-only">Registrar resultado</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SidePanel {...sideProps} slot="A" competitor={compA} title={titleA} score={scoreA} onScore={setScoreA} kbd="A" onWin={() => void winner("A")} />
            <SidePanel {...sideProps} slot="B" competitor={compB} title={titleB} score={scoreB} onScore={setScoreB} kbd="B" onWin={() => void winner("B")} />
          </div>
          {resultType === "DRAW" && (
            <Button type="button" size="lg" className="h-14 whitespace-normal text-base font-extrabold" onClick={() => void draw()}>
              Registrar empate
            </Button>
          )}
          <details className="rounded-lg border bg-muted/30 px-3 text-sm" open={resultType !== "NORMAL" ? true : undefined}>
            <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
              <Footprints className="size-4" aria-hidden /> W.O., desclassificação ou empate
              {resultType !== "NORMAL" && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-900">{RESULT_TYPE_LABEL[resultType]}</span>}
            </summary>
            <div className="grid grid-cols-1 gap-1.5 pb-3 pt-1">
              <Label htmlFor={`${uid}-type`}>Tipo de resultado</Label>
              <NativeSelect id={`${uid}-type`} value={resultType} onChange={(e) => setResultType(e.target.value as ResultType)}>
                <option value="NORMAL">{RESULT_TYPE_LABEL.NORMAL}</option>
                <option value="WALKOVER">{RESULT_TYPE_LABEL.WALKOVER} (o adversário não compareceu)</option>
                <option value="DISQUALIFICATION">{RESULT_TYPE_LABEL.DISQUALIFICATION}</option>
                {match.stage === "GROUP" && <option value="DRAW">{RESULT_TYPE_LABEL.DRAW} (só na fase de grupos)</option>}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">Depois de escolher, toque em quem venceu.</p>
            </div>
          </details>
        </fieldset>
      )}

      {variant === "dialog" && canEdit && !match.isBye && (
        <fieldset className="grid grid-cols-1 gap-3 border-t pt-3" disabled={busy}>
          <legend className="sr-only">Tatame e ordem de chamada</legend>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid grid-cols-1 gap-1.5">
              <Label htmlFor={`${uid}-mat`}>Tatame (0 a {LIMITS.matMax})</Label>
              <Input id={`${uid}-mat`} inputMode="numeric" value={mat} onChange={(e) => setMat(e.target.value)} placeholder="Sem tatame" />
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              <Label htmlFor={`${uid}-queue`}>Ordem de chamada</Label>
              <Input id={`${uid}-queue`} inputMode="numeric" value={queue} onChange={(e) => setQueue(e.target.value)} placeholder="Sem ordem" />
            </div>
          </div>
          <Button type="button" variant="secondary" onClick={() => void actions.onSaveSchedule(mat, queue)}>
            Salvar tatame e ordem
          </Button>
        </fieldset>
      )}

      {variant === "dialog" && onShowPath && !match.isBye && (compA ?? compB) && (
        <div className="grid grid-cols-1 gap-2 border-t pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Caminho na chave</p>
          <div className="flex flex-wrap gap-2">
            {[compA, compB].map((c) =>
              c ? (
                <Button key={c.id} type="button" variant="outline" size="sm" onClick={() => onShowPath(c.id)}>
                  <Route /> Destacar caminho de {c.displayName}
                </Button>
              ) : null,
            )}
          </div>
        </div>
      )}

      {canEdit && !match.isBye && (match.status === "LIVE" || match.status === "FINISHED") && (
        <Button
          type="button"
          variant="outline"
          className={cn("h-12 gap-2 border-destructive/50 text-destructive", variant === "desk" && "h-11 md:h-10")}
          disabled={busy}
          onClick={() => setConfirmUndo(true)}
        >
          <Undo2 /> {variant === "desk" ? "Desfazer início da luta" : "Desfazer"} {shortcuts && <Kbd>U</Kbd>}
        </Button>
      )}

      <ConfirmDialog
        open={confirmUndo}
        onOpenChange={setConfirmUndo}
        title={match.status === "FINISHED" ? "Desfazer o resultado?" : "Desfazer o início da luta?"}
        description={
          match.status === "FINISHED"
            ? `O resultado de ${titleA} contra ${titleB} será apagado e a luta volta a "${MATCH_STATUS_LABEL.READY}". O vencedor sai da próxima luta.`
            : `A luta ${titleA} contra ${titleB} volta a "${MATCH_STATUS_LABEL.READY}".`
        }
        confirmLabel="Desfazer"
        onConfirm={() => actions.onUndo()}
      />
    </div>
  );
}

interface SidePanelProps {
  uid: string;
  busy: boolean;
  resultType: ResultType;
  variant: "dialog" | "desk";
  slot: Slot;
  competitor: OperatorCompetitor | null;
  title: string;
  score: string;
  onScore: (text: string) => void;
  kbd: string;
  onWin: () => void;
}

/** Um lado da luta: atleta, placar com − e +, e o botão gigante de vencedor. */
function SidePanel({ uid, busy, resultType, slot, competitor, title, score, onScore, kbd, onWin }: SidePanelProps) {
  const meta = competitorMeta(competitor);
  return (
    <div className="grid grid-cols-1 content-start gap-3 rounded-xl border bg-card p-3" data-testid={`side-${slot}`}>
      <div className="flex items-center gap-3">
        <CompetitorPhoto name={title} photoUrl={competitor?.photoUrl ?? null} group={competitor?.groupName} id={competitor?.id} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-base font-extrabold leading-tight">{title}</p>
          <p className="truncate text-xs text-muted-foreground">{meta || "Sem grupo informado"}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`${uid}-score-${slot}`} className="sr-only">
          Placar de {title}
        </Label>
        <Button type="button" variant="outline" size="icon" className="size-12 shrink-0" aria-label={`Diminuir placar de ${title}`} disabled={busy} onClick={() => onScore(bumpScore(score, -1))}>
          <Minus className="!size-5" />
        </Button>
        <Input
          id={`${uid}-score-${slot}`}
          inputMode="numeric"
          value={score}
          onChange={(e) => onScore(e.target.value)}
          placeholder="0"
          style={{ fontSize: "1.875rem" }}
          className="h-12 min-w-0 flex-1 text-center font-black tabular-nums"
        />
        <Button type="button" variant="outline" size="icon" className="size-12 shrink-0" aria-label={`Aumentar placar de ${title}`} disabled={busy} onClick={() => onScore(bumpScore(score, 1))}>
          <Plus className="!size-5" />
        </Button>
      </div>
      {resultType !== "DRAW" && (
        <Button
          type="button"
          size="lg"
          aria-label={`Vencedor: ${title}`}
          className="h-auto min-h-14 w-full justify-between gap-3 whitespace-normal py-2 text-left"
          disabled={busy}
          onClick={onWin}
        >
          <Trophy className="!size-5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block text-[10px] font-bold tracking-[0.2em] opacity-80">
              {resultType === "WALKOVER" ? "VENCEU POR W.O." : resultType === "DISQUALIFICATION" ? "VENCEU (DESCLASSIFICAÇÃO)" : "VENCEU"}
            </span>
            <span className="block truncate text-base font-extrabold">{title}</span>
          </span>
          <Kbd>{kbd}</Kbd>
        </Button>
      )}
    </div>
  );
}
