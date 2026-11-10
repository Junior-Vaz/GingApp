import { TournamentMatchStage, TournamentMatchStatus, TournamentResultType } from '@prisma/client';
import { resolveAdvancement } from './engine';
import { conflict, notFound, badRequest, TournamentErrorCode as Code, TOURNAMENT_LIMITS } from './tournament-rules';

/**
 * Fluxo das lutas de uma categoria (docs/CONTRATO_CHAVEAMENTO.md 4), em funcoes PURAS sobre as lutas em memoria: cada
 * `plan*` valida a regra, nao toca em nada e devolve os "patches" (alteracoes por id de luta) que o servico grava na MESMA
 * transacao. Erros sao HttpException com `code` em MAIUSCULAS. Testadas em test/tournaments.spec.ts.
 */

export type Slot = 'A' | 'B';

/** Visao de uma luta com tudo que o fluxo precisa (sem datas/notas). */
export interface MatchNode {
  id: number;
  key: string;
  stage: TournamentMatchStage;
  round: number;
  position: number;
  groupIndex: number | null;
  slotAId: number | null;
  slotBId: number | null;
  nextMatchId: number | null;
  nextSlot: string | null;
  loserNextMatchId: number | null;
  loserNextSlot: string | null;
  isBye: boolean;
  status: TournamentMatchStatus;
  winnerId: number | null;
  scoreA: number | null;
  scoreB: number | null;
  resultType: TournamentResultType | null;
}

/** Alteracoes a gravar numa luta. `undefined` = nao mexe. */
export interface MatchPatch {
  slotAId?: number | null;
  slotBId?: number | null;
  status?: TournamentMatchStatus;
  winnerId?: number | null;
  scoreA?: number | null;
  scoreB?: number | null;
  resultType?: TournamentResultType | null;
  note?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}

export type PatchMap = Map<number, MatchPatch>;

export interface ResultInput {
  winnerId?: number | null;
  scoreA?: number | null;
  scoreB?: number | null;
  resultType?: TournamentResultType;
  note?: string | null;
}

/** PENDING (falta atleta) ou READY (dois atletas) de uma luta ainda nao iniciada. */
export function statusFromSlots(slotAId: number | null, slotBId: number | null): TournamentMatchStatus {
  return slotAId !== null && slotBId !== null ? 'READY' : 'PENDING';
}

/** Aplica os patches (copia). */
export function applyPatches<T extends MatchNode>(matches: T[], patches: PatchMap): T[] {
  return matches.map((m) => {
    const patch = patches.get(m.id);
    return patch ? ({ ...m, ...stripUndefined(patch) } as T) : m;
  });
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** Ha luta (que nao seja folga) em andamento ou terminada? Folga nasce FINISHED mas nao conta como resultado. */
export function hasPlayedMatches(matches: readonly MatchNode[]): boolean {
  return matches.some((m) => !m.isBye && (m.status === 'LIVE' || m.status === 'FINISHED'));
}

/** Todos os jogos de grupo terminaram (e existe ao menos um)? */
export function allGroupMatchesFinished(matches: readonly MatchNode[]): boolean {
  const group = matches.filter((m) => m.stage === 'GROUP');
  return group.length > 0 && group.every((m) => m.status === 'FINISHED');
}

/** Categoria com chave gerada: FINISHED quando todas as lutas terminaram, senao RUNNING. */
export function deriveCategoryStatus(matches: readonly MatchNode[]): 'RUNNING' | 'FINISHED' {
  return matches.length > 0 && matches.every((m) => m.status === 'FINISHED') ? 'FINISHED' : 'RUNNING';
}

class Working {
  private readonly byId = new Map<number, MatchNode>();
  private readonly byKey = new Map<string, MatchNode>();
  readonly patches: PatchMap = new Map();

  constructor(matches: readonly MatchNode[]) {
    for (const m of matches) {
      this.byId.set(m.id, m);
      this.byKey.set(m.key, m);
    }
  }

  get(id: number): MatchNode | undefined {
    const base = this.byId.get(id);
    if (!base) return undefined;
    const patch = this.patches.get(id);
    return patch ? ({ ...base, ...stripUndefined(patch) } as MatchNode) : base;
  }

  getByKey(key: string): MatchNode | undefined {
    const base = this.byKey.get(key);
    return base ? this.get(base.id) : undefined;
  }

  patch(id: number, change: MatchPatch): void {
    this.patches.set(id, { ...(this.patches.get(id) ?? {}), ...change });
  }

  /** Coloca (ou tira, com null) um atleta no slot de uma luta ainda nao iniciada e recalcula PENDING/READY. */
  setSlot(id: number, slot: string, competitorId: number | null): void {
    const target = this.get(id);
    if (!target) throw conflict(Code.INCONSISTENT_STATE, 'A chave está inconsistente (luta seguinte não encontrada).');
    if (target.status === 'LIVE' || target.status === 'FINISHED') {
      throw conflict(Code.INCONSISTENT_STATE, 'A luta seguinte já foi iniciada.');
    }
    const a = slot === 'A' ? competitorId : target.slotAId;
    const b = slot === 'B' ? competitorId : target.slotBId;
    this.patch(id, slot === 'A' ? { slotAId: a } : { slotBId: b });
    this.patch(id, { status: statusFromSlots(a, b) });
  }
}

function findMatch(w: Working, matchId: number): MatchNode {
  const match = w.get(matchId);
  if (!match) throw notFound(Code.MATCH_NOT_FOUND, 'Luta não encontrada.');
  return match;
}

/** O mesmo resultado? Compara vencedor, tipo e (so se informados) placares; a nota nao conta. */
function sameResult(match: MatchNode, input: ResultInput, type: TournamentResultType, winnerId: number | null): boolean {
  if ((match.resultType ?? 'NORMAL') !== type) return false;
  if (match.winnerId !== winnerId) return false;
  if (input.scoreA !== undefined && (input.scoreA ?? null) !== match.scoreA) return false;
  if (input.scoreB !== undefined && (input.scoreB ?? null) !== match.scoreB) return false;
  return true;
}

export interface FlowPlan {
  patches: PatchMap;
  /** true = nada a gravar (repeticao idempotente). */
  idempotent: boolean;
}

/** READY -> LIVE (varias lutas LIVE ao mesmo tempo sao permitidas). LIVE de novo = idempotente. */
export function planStart(matches: readonly MatchNode[], matchId: number, now: Date): FlowPlan {
  const w = new Working(matches);
  const match = findMatch(w, matchId);
  if (match.status === 'LIVE') return { patches: w.patches, idempotent: true };
  if (match.status === 'FINISHED') throw conflict(Code.MATCH_ALREADY_FINISHED, 'Esta luta já terminou. Desfaça o resultado antes de iniciar de novo.');
  if (match.status !== 'READY' || match.slotAId === null || match.slotBId === null) {
    throw conflict(Code.MATCH_NOT_READY, 'A luta ainda não tem os dois atletas.');
  }
  w.patch(matchId, { status: 'LIVE', startedAt: now });
  return { patches: w.patches, idempotent: false };
}

/**
 * Fecha a luta e PROPAGA vencedor/perdedor (engine.resolveAdvancement). Repetir o MESMO resultado = idempotente; outro
 * resultado em luta FINISHED = 409 MATCH_ALREADY_FINISHED; sem os dois atletas = 409 MATCH_NOT_READY.
 */
export function planResult(matches: readonly MatchNode[], matchId: number, input: ResultInput, now: Date): FlowPlan {
  const w = new Working(matches);
  const match = findMatch(w, matchId);
  const type: TournamentResultType = input.resultType ?? 'NORMAL';
  const winnerGiven = input.winnerId ?? null;

  // Folga nasce FINISHED com o vencedor ja definido: nenhum resultado e aceito nela (nem o "mesmo" vencedor).
  if (match.isBye) throw conflict(Code.MATCH_IS_BYE, 'Folga não tem resultado: o atleta já avançou.');

  if (match.status === 'FINISHED') {
    if (sameResult(match, input, type, winnerGiven)) return { patches: w.patches, idempotent: true };
    throw conflict(Code.MATCH_ALREADY_FINISHED, 'Esta luta já tem resultado. Desfaça antes de registrar outro.');
  }
  if (match.status === 'PENDING' || match.slotAId === null || match.slotBId === null) {
    throw conflict(Code.MATCH_NOT_READY, 'A luta ainda não tem os dois atletas.');
  }

  const scoreA = input.scoreA ?? null;
  const scoreB = input.scoreB ?? null;
  for (const score of [scoreA, scoreB]) {
    if (score !== null && (!Number.isInteger(score) || score < 0 || score > TOURNAMENT_LIMITS.scoreMax)) {
      throw badRequest(Code.INVALID_RESULT, `O placar deve ficar entre 0 e ${TOURNAMENT_LIMITS.scoreMax}.`);
    }
  }
  let winnerId: number | null;
  if (type === 'DRAW') {
    if (match.stage !== 'GROUP') throw badRequest(Code.INVALID_RESULT, 'Empate só vale na fase de grupos ou em todos contra todos.');
    if (winnerGiven !== null) throw badRequest(Code.INVALID_RESULT, 'Empate não tem vencedor.');
    if (scoreA !== null && scoreB !== null && scoreA !== scoreB) {
      throw badRequest(Code.INVALID_RESULT, 'Em empate o placar dos dois lados deve ser igual.');
    }
    winnerId = null;
  } else {
    if (winnerGiven === null) throw badRequest(Code.INVALID_RESULT, 'Informe o vencedor da luta.');
    if (winnerGiven !== match.slotAId && winnerGiven !== match.slotBId) {
      throw badRequest(Code.INVALID_RESULT, 'O vencedor precisa ser um dos dois atletas desta luta.');
    }
    winnerId = winnerGiven;
  }

  w.patch(matchId, {
    status: 'FINISHED',
    winnerId,
    scoreA,
    scoreB,
    resultType: type,
    note: input.note ?? null,
    // Finalizada sem "iniciar" (READY): registra o inicio no mesmo instante; LIVE ja tem startedAt.
    startedAt: match.status === 'READY' ? now : undefined,
    finishedAt: now,
  });

  if (match.stage !== 'GROUP' && winnerId !== null) {
    const loserId = winnerId === match.slotAId ? match.slotBId : match.slotAId;
    const next = match.nextMatchId !== null ? w.get(match.nextMatchId) : undefined;
    const loserNext = match.loserNextMatchId !== null ? w.get(match.loserNextMatchId) : undefined;
    if ((match.nextMatchId !== null && !next) || (match.loserNextMatchId !== null && !loserNext)) {
      throw conflict(Code.INCONSISTENT_STATE, 'A chave está inconsistente (luta seguinte não encontrada).');
    }
    const updates = resolveAdvancement(
      {
        next: next && match.nextSlot ? { key: next.key, slot: match.nextSlot as Slot } : null,
        loserNext: loserNext && match.loserNextSlot ? { key: loserNext.key, slot: match.loserNextSlot as Slot } : null,
      },
      { winnerId, loserId },
    );
    for (const update of updates) {
      const target = w.getByKey(update.matchKey);
      if (!target) throw conflict(Code.INCONSISTENT_STATE, 'A chave está inconsistente (luta seguinte não encontrada).');
      const existing = update.slot === 'A' ? target.slotAId : target.slotBId;
      if (existing !== null && existing !== update.competitorId) {
        throw conflict(Code.INCONSISTENT_STATE, 'O lugar na luta seguinte já está ocupado por outro atleta.');
      }
      w.setSlot(target.id, update.slot, update.competitorId);
    }
  }
  return { patches: w.patches, idempotent: false };
}

export interface UndoPlan extends FlowPlan {
  /** GROUPS_KNOCKOUT: o mata-mata (lutas que nao sao de grupo) deve ser apagado e regerado depois. */
  deleteKnockout: boolean;
}

/**
 * Desfaz LIVE -> READY ou FINISHED -> READY, tirando vencedor/perdedor dos slots seguintes. Bloqueado (409
 * DEPENDENT_MATCH_PLAYED) se a luta seguinte ja esta LIVE/FINISHED. Em jogo de grupo, se o mata-mata ja existe so desfaz se
 * NENHUMA luta dele (fora as folgas) esta LIVE/FINISHED: o mata-mata e apagado.
 */
export function planUndo(matches: readonly MatchNode[], matchId: number): UndoPlan {
  const w = new Working(matches);
  const match = findMatch(w, matchId);
  if (match.isBye) throw conflict(Code.MATCH_IS_BYE, 'Folga não tem resultado para desfazer.');
  if (match.status === 'PENDING' || match.status === 'READY') {
    throw conflict(Code.NOTHING_TO_UNDO, 'Esta luta ainda não foi iniciada: não há o que desfazer.');
  }
  if (match.status === 'LIVE') {
    w.patch(matchId, { status: 'READY', startedAt: null });
    return { patches: w.patches, idempotent: false, deleteKnockout: false };
  }

  let deleteKnockout = false;
  if (match.stage === 'GROUP') {
    const knockout = matches.filter((m) => m.stage !== 'GROUP');
    if (knockout.some((m) => !m.isBye && (m.status === 'LIVE' || m.status === 'FINISHED'))) {
      throw conflict(Code.DEPENDENT_MATCH_PLAYED, 'O mata-mata já começou. Desfaça as lutas dele (na ordem inversa) antes de mexer nos grupos.');
    }
    deleteKnockout = knockout.length > 0;
  } else {
    const links: Array<{ matchId: number | null; slot: string | null; competitorId: number | null }> = [
      { matchId: match.nextMatchId, slot: match.nextSlot, competitorId: match.winnerId },
      {
        matchId: match.loserNextMatchId,
        slot: match.loserNextSlot,
        competitorId: match.winnerId === null ? null : match.winnerId === match.slotAId ? match.slotBId : match.slotAId,
      },
    ];
    for (const link of links) {
      if (link.matchId === null || !link.slot) continue;
      const target = w.get(link.matchId);
      if (!target) throw conflict(Code.INCONSISTENT_STATE, 'A chave está inconsistente (luta seguinte não encontrada).');
      if (target.status === 'LIVE' || target.status === 'FINISHED') {
        throw conflict(Code.DEPENDENT_MATCH_PLAYED, 'A luta seguinte já foi iniciada ou terminou. Desfaça-a primeiro (ordem inversa).');
      }
      const holder = link.slot === 'A' ? target.slotAId : target.slotBId;
      if (holder === link.competitorId) w.setSlot(target.id, link.slot, null);
    }
  }
  w.patch(matchId, { status: 'READY', winnerId: null, scoreA: null, scoreB: null, resultType: null, note: null, startedAt: null, finishedAt: null });
  return { patches: w.patches, idempotent: false, deleteKnockout };
}

export interface SwapRequest {
  slotAId?: number | null;
  slotBId?: number | null;
}

/**
 * Troca atletas de lugar na 1a rodada de uma chave eliminatoria, antes de qualquer resultado. Coloca `slotAId`/`slotBId`
 * (os omitidos ficam como estao) na luta indicada; quem estava la vai para o lugar antigo do outro (permutacao: nunca
 * duplica nem perde atleta). Folga: o vencedor da folga acompanha o atleta que passou a ocupar o lugar.
 */
export function planSwap(
  matches: readonly MatchNode[],
  matchId: number,
  request: SwapRequest,
  competitorIds: ReadonlySet<number>,
  format: string,
): FlowPlan {
  const w = new Working(matches);
  const match = findMatch(w, matchId);
  if (format !== 'SINGLE_ELIMINATION' || match.stage !== 'MAIN' || match.round !== 1) {
    throw conflict(Code.SWAP_NOT_ALLOWED, 'A troca só vale na 1ª rodada de uma chave eliminatória.');
  }
  if (hasPlayedMatches(matches)) {
    throw conflict(Code.SWAP_NOT_ALLOWED, 'A categoria já tem luta em andamento ou terminada: a troca não é mais permitida.');
  }
  const wantA = request.slotAId ?? match.slotAId;
  const wantB = request.slotBId ?? match.slotBId;
  if (wantA === null || wantB === null) throw conflict(Code.SWAP_NOT_ALLOWED, 'Este lugar da chave está vazio (folga): não dá para trocar por ele.');
  for (const id of [wantA, wantB]) {
    if (!competitorIds.has(id)) throw notFound(Code.COMPETITOR_NOT_FOUND, 'Atleta não encontrado nesta categoria.');
  }
  if (wantA === wantB) throw badRequest(Code.INVALID_COMPETITOR, 'O mesmo atleta não pode ocupar os dois lados da luta.');
  if (match.slotAId === null || match.slotBId === null) {
    throw conflict(Code.SWAP_NOT_ALLOWED, 'Esta luta é uma folga: só o lugar ocupado pode ser trocado, sem preencher o vazio.');
  }

  // Estado de trabalho dos lugares ocupados da 1a rodada.
  const round1 = matches.filter((m) => m.stage === 'MAIN' && m.round === 1);
  const cells = new Map<string, number>(); // "<matchId>:<A|B>" -> atleta
  for (const m of round1) {
    if (m.slotAId !== null) cells.set(`${m.id}:A`, m.slotAId);
    if (m.slotBId !== null) cells.set(`${m.id}:B`, m.slotBId);
  }
  const locate = (athlete: number): string | null => {
    for (const [cell, who] of cells) if (who === athlete) return cell;
    return null;
  };
  const place = (cell: string, athlete: number): void => {
    const current = cells.get(cell);
    if (current === athlete) return;
    const from = locate(athlete);
    if (from === null || current === undefined) {
      throw conflict(Code.SWAP_NOT_ALLOWED, 'O atleta não está na 1ª rodada desta chave.');
    }
    cells.set(from, current);
    cells.set(cell, athlete);
  };
  place(`${matchId}:A`, wantA);
  place(`${matchId}:B`, wantB);

  // Diferencas -> patches (e acompanhamento do vencedor das folgas).
  for (const m of round1) {
    const a = cells.get(`${m.id}:A`) ?? null;
    const b = cells.get(`${m.id}:B`) ?? null;
    if (a === m.slotAId && b === m.slotBId) continue;
    w.patch(m.id, { slotAId: a, slotBId: b });
    if (m.isBye) {
      const winner = a ?? b;
      w.patch(m.id, { winnerId: winner });
      if (m.nextMatchId !== null && m.nextSlot && winner !== null) {
        const next = w.get(m.nextMatchId);
        if (!next) throw conflict(Code.INCONSISTENT_STATE, 'A chave está inconsistente (luta seguinte não encontrada).');
        w.setSlot(next.id, m.nextSlot, winner);
      }
    }
  }
  return { patches: w.patches, idempotent: w.patches.size === 0 };
}
