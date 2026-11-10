import { AdvancementOutcome, MatchLink, SlotUpdate } from './types';

/**
 * Avanço de uma luta decidida (contrato §3, item 6): o vencedor vai para `next`;
 * o perdedor vai para `loserNext` (se houver e `loserId` não for nulo — empate/folga não têm perdedor).
 * Devolve só as atualizações de slot; o serviço grava no banco.
 */
export function resolveAdvancement(
  match: { next: MatchLink | null; loserNext: MatchLink | null },
  outcome: AdvancementOutcome,
): SlotUpdate[] {
  const updates: SlotUpdate[] = [];
  if (match.next) {
    updates.push({ matchKey: match.next.key, slot: match.next.slot, competitorId: outcome.winnerId });
  }
  if (match.loserNext && outcome.loserId !== null && outcome.loserId !== undefined) {
    updates.push({ matchKey: match.loserNext.key, slot: match.loserNext.slot, competitorId: outcome.loserId });
  }
  return updates;
}
