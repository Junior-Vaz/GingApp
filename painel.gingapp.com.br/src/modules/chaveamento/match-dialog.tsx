import { useEffect, useRef, type PointerEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { competitorMap, EMPTY_SLOT, lastMainRound, matLabel, sideName, stageLabel, statusText } from "./helpers";
import { MatchControls } from "./match-controls";
import type { OperatorCategory, OperatorMatch } from "./types";

interface MatchDialogProps {
  eventId: number;
  category: OperatorCategory;
  matchId: number | null;
  canEdit: boolean;
  onClose: () => void;
  /** Destacar o caminho de um atleta na chave (a ação rápida se fecha). */
  onShowPath?: ((competitorId: number) => void) | undefined;
}

/**
 * Ação rápida da luta: no celular vira bottom sheet (o DialogContent já ancora no rodapé em telas pequenas) e no desktop,
 * caixa de diálogo. Mostra sempre a luta MAIS RECENTE da categoria (a consulta de 5 s atualiza por baixo) e já abre
 * nos botões certos: "Iniciar luta" quando está pronta, "Venceu: …" quando está ao vivo.
 */
export function MatchDialog({ eventId, category, matchId, canEdit, onClose, onShowPath }: MatchDialogProps) {
  const match = matchId === null ? null : (category.matches.find((m) => m.id === matchId) ?? null);
  // A luta pode sumir (ex.: mata-mata apagado por um desfazer em grupos): fecha em vez de mostrar uma luta fantasma.
  useEffect(() => {
    if (matchId !== null && match === null) onClose();
  }, [matchId, match, onClose]);

  return (
    <Dialog open={match !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] overscroll-contain overflow-y-auto sm:max-w-xl" data-testid="match-dialog">
        {match && <SheetGrabber onClose={onClose} />}
        {match && (
          <MatchPanel
            key={match.id}
            eventId={eventId}
            category={category}
            match={match}
            canEdit={canEdit}
            onClose={onClose}
            onShowPath={
              onShowPath
                ? (id) => {
                    onShowPath(id);
                    onClose();
                  }
                : undefined
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Alça da folha (só no celular): arrastar para baixo fecha. É um atalho de gesto; o botão Fechar de 44 px e a tecla Esc
 * continuam funcionando, por isso a alça fica fora da árvore de acessibilidade.
 */
function SheetGrabber({ onClose }: { onClose: () => void }) {
  const startY = useRef<number | null>(null);
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (startY.current !== null && event.clientY - startY.current > 64) {
      startY.current = null;
      onClose();
    }
  };
  return (
    <div
      aria-hidden="true"
      data-testid="sheet-grabber"
      className="-mb-2 -mt-2 grid h-8 touch-none place-items-center sm:hidden"
      onPointerDown={(event) => {
        startY.current = event.clientY;
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={onMove}
      onPointerUp={() => (startY.current = null)}
      onPointerCancel={() => (startY.current = null)}
    >
      <span className="h-1.5 w-12 rounded-full bg-muted-foreground/40" />
    </div>
  );
}

function MatchPanel({
  eventId,
  category,
  match,
  canEdit,
  onClose,
  onShowPath,
}: {
  eventId: number;
  category: OperatorCategory;
  match: OperatorMatch;
  canEdit: boolean;
  onClose: () => void;
  onShowPath: ((competitorId: number) => void) | undefined;
}) {
  const competitors = competitorMap(category);
  const titleA = sideName(competitors, match.slotAId) ?? EMPTY_SLOT;
  const titleB = sideName(competitors, match.slotBId) ?? EMPTY_SLOT;
  const lastRound = lastMainRound(category.matches);
  const mat = matLabel(match.mat);
  return (
    <>
      <DialogHeader>
        <DialogTitle className="break-words leading-tight">
          {titleA} <span className="font-normal text-muted-foreground">x</span> {titleB}
        </DialogTitle>
        <DialogDescription>
          {category.name}
          {" · "}
          {stageLabel(match, lastRound)}
          {match.stage === "GROUP" && match.groupIndex !== null && category.format === "GROUPS_KNOCKOUT" ? ` · Grupo ${String.fromCharCode(65 + match.groupIndex)}` : ""}
          {" · "}
          <Badge variant={match.status === "LIVE" ? "destructive" : "outline"} className="align-middle">
            {match.status === "LIVE" ? "AO VIVO" : statusText(match)}
          </Badge>
          {mat ? ` · ${mat}` : ""}
        </DialogDescription>
      </DialogHeader>
      <MatchControls eventId={eventId} category={category} match={match} canEdit={canEdit} variant="dialog" onDone={onClose} onShowPath={onShowPath} />
    </>
  );
}
