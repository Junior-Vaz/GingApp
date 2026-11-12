import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  buildPublicSnapshotBody,
  CategoryData,
  PublicMatchRow,
  SerializedSnapshot,
  serializePublicBody,
} from './tournament-snapshot';
import { isTournamentPhotoFile, readTournamentPhoto } from './tournament-photo-storage';
import { isPublicViewAllowed, isWellFormedPublicToken, photoVisibleOnPublic, publicNotFound } from './tournament-rules';

/** Colunas lidas do aluno do atleta: so foto, nascimento e marca de anonimizacao (usados e NUNCA devolvidos crus). */
export const STUDENT_INFO_SELECT = {
  photo: true,
  birthDate: true,
  anonymizedAt: true,
  person: { select: { birthDate: true } },
} satisfies Prisma.StudentSelect;

/** Lutas lidas para o telao: tudo MENOS `note` (nota interna do operador nunca sai do banco para o publico). */
export const PUBLIC_MATCH_SELECT = {
  id: true,
  organizationId: true,
  categoryId: true,
  key: true,
  stage: true,
  round: true,
  position: true,
  groupIndex: true,
  slotAId: true,
  slotBId: true,
  nextMatchId: true,
  nextSlot: true,
  loserNextMatchId: true,
  loserNextSlot: true,
  isBye: true,
  status: true,
  winnerId: true,
  scoreA: true,
  scoreB: true,
  resultType: true,
  mat: true,
  queueOrder: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TournamentMatchSelect;

/** Entrada memoizada do snapshot publico de um torneio. */
export interface PublicEntry {
  tournamentId: number;
  revision: number;
  /** `"<revision>-<hash do conteudo>"`: mudou o conteudo (mesmo por dado externo, ex.: foto do aluno) = ETag novo. */
  etag: string;
  serialized: SerializedSnapshot;
  builtAt: number;
}

/** TTL da memoizacao: mutacoes invalidam na hora; o TTL cobre dado EXTERNO (foto/nascimento do aluno, status/data do evento). */
export function snapshotTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.TOURNAMENT_SNAPSHOT_TTL_MS);
  return Number.isFinite(n) && n >= 0 ? n : 10_000;
}

/** TTL do cache NEGATIVO (404): cada requisicao de token ruim/desligado custaria uma transacao. Lido a cada uso. */
export function negativeTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.TOURNAMENT_NEGATIVE_TTL_MS);
  return Number.isFinite(n) && n >= 0 ? n : 5_000;
}

const MAX_CACHED = 500;
const MAX_NEGATIVE = 5000;

/**
 * Snapshot PUBLICO do telao (docs/CONTRATO_CHAVEAMENTO.md 5), memoizado por token/torneio:
 *  - N espectadores = 1 consulta ao banco por mudanca (single-flight + cache invalidado por `invalidate` depois do commit);
 *  - a leitura roda numa transacao REPEATABLE READ: revisao e dados vem do MESMO instante (nunca revisao nova com dado velho);
 *  - corrida mutacao x leitura: uma leitura iniciada antes de uma invalidacao DAQUELE torneio nunca entra no cache (sequencia
 *    por torneio: mutacao em um torneio nao quebra o single-flight dos outros);
 *  - todo caso de indisponibilidade (token mal formado/inexistente, desligado, evento rascunho/cancelado ou antigo) lanca o
 *    MESMO 404, e o 404 tambem e memoizado por pouco tempo (cache negativo) para nao custar uma transacao por requisicao;
 *    `invalidate` (rotacao, ligar o telao, criar torneio, qualquer mutacao) derruba o negativo do torneio conhecido.
 */
@Injectable()
export class TournamentPublicService {
  private readonly cache = new Map<string, PublicEntry>();
  private readonly inflight = new Map<string, { startSeq: number; promise: Promise<PublicEntry> }>();
  /** token -> torneio ja visto (para a sequencia por torneio). */
  private readonly knownTournament = new Map<string, number>();
  private readonly negative = new Map<string, { until: number; tournamentId: number | null }>();
  /** Sequencia global monotonica; `invalidatedAt` guarda a sequencia da ULTIMA invalidacao de cada torneio. */
  private seq = 0;
  private readonly invalidatedAt = new Map<number, number>();

  constructor(private readonly prisma: PrismaService) {}

  async getSnapshot(token: string): Promise<PublicEntry> {
    if (!isWellFormedPublicToken(token)) throw publicNotFound();
    const now = Date.now();
    const hit = this.cache.get(token);
    if (hit && now - hit.builtAt < snapshotTtlMs()) return hit;
    if (this.negativeHit(token, now)) throw publicNotFound();
    const flight = this.inflight.get(token);
    if (flight && this.canJoin(token, flight.startSeq)) return flight.promise;

    const startSeq = this.seq;
    const tracked: Promise<PublicEntry> = this.build(token, startSeq).finally(() => {
      if (this.inflight.get(token)?.promise === tracked) this.inflight.delete(token);
    });
    this.inflight.set(token, { startSeq, promise: tracked });
    return tracked;
  }

  /** Token no cache NEGATIVO (404 ainda valido)? Entrada vencida e descartada. */
  private negativeHit(token: string, now: number): boolean {
    const neg = this.negative.get(token);
    if (!neg) return false;
    if (neg.until > now) return true;
    this.negative.delete(token);
    return false;
  }

  /** Uma leitura em voo pode ser compartilhada se NENHUMA invalidacao do torneio aconteceu depois que ela comecou. */
  private canJoin(token: string, startSeq: number): boolean {
    const tid = this.knownTournament.get(token);
    // Torneio ainda desconhecido (primeira leitura): so junta se nada foi invalidado em lugar nenhum desde o inicio.
    if (tid === undefined) return startSeq === this.seq;
    return (this.invalidatedAt.get(tid) ?? 0) <= startSeq;
  }

  /** Chamado DEPOIS do commit de qualquer mutacao (ou rotacao/desligamento/criacao): descarta o que estava memoizado. */
  invalidate(tournamentId: number): void {
    this.seq += 1;
    this.invalidatedAt.set(tournamentId, this.seq);
    for (const [token, entry] of this.cache) if (entry.tournamentId === tournamentId) this.cache.delete(token);
    for (const [token, tid] of this.knownTournament) if (tid === tournamentId) this.knownTournament.delete(token);
    for (const [token, neg] of this.negative) if (neg.tournamentId === tournamentId) this.negative.delete(token);
  }

  /** Tamanho do cache (testes). */
  cacheSize(): number {
    return this.cache.size;
  }

  /** Tamanho do cache negativo (testes). */
  negativeSize(): number {
    return this.negative.size;
  }

  private rememberNegative(token: string, tournamentId: number | null): void {
    const ttl = negativeTtlMs();
    if (ttl <= 0) return;
    if (this.negative.size >= MAX_NEGATIVE) {
      const now = Date.now();
      for (const [t, n] of this.negative) if (n.until <= now) this.negative.delete(t);
      if (this.negative.size >= MAX_NEGATIVE) this.negative.clear(); // varredura de tokens aleatorios: nunca cresce sem limite
    }
    this.negative.set(token, { until: Date.now() + ttl, tournamentId });
  }

  private async build(token: string, startSeq: number): Promise<PublicEntry> {
    const now = new Date();
    const loaded = await this.prisma.$transaction(
      async (tx) => {
        const tournament = await tx.tournament.findUnique({
          where: { publicToken: token },
          select: {
            id: true,
            organizationId: true,
            revision: true,
            publicEnabled: true,
            event: { select: { title: true, date: true, location: true, imageUrl: true, status: true } },
            organization: { select: { name: true } },
          },
        });
        if (!tournament) return { missing: true as const, tournamentId: null };
        const allowed = isPublicViewAllowed(
          { publicEnabled: tournament.publicEnabled, eventStatus: tournament.event.status, eventDate: tournament.event.date },
          now,
        );
        if (!allowed) return { missing: true as const, tournamentId: tournament.id };
        const categories = await tx.tournamentCategory.findMany({
          where: { tournamentId: tournament.id, organizationId: tournament.organizationId },
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          include: {
            competitors: {
              orderBy: { id: 'asc' },
              include: { student: { select: STUDENT_INFO_SELECT } },
            },
            matches: { orderBy: { id: 'asc' }, select: PUBLIC_MATCH_SELECT },
          },
        });
        return { missing: false as const, tournament, categories };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 15000 },
    );
    if (loaded.missing) {
      this.cache.delete(token);
      this.knownTournament.delete(token);
      // So memoiza o 404 se nada deste torneio foi invalidado depois que a leitura comecou (ex.: ligar o telao no meio).
      if (loaded.tournamentId === null || (this.invalidatedAt.get(loaded.tournamentId) ?? 0) <= startSeq) {
        this.rememberNegative(token, loaded.tournamentId);
      }
      throw publicNotFound();
    }

    const { tournament, categories } = loaded;
    const data: CategoryData<PublicMatchRow>[] = categories.map((c) => {
      const { competitors, matches, ...category } = c;
      return {
        category,
        competitors: competitors.map(({ student, ...row }) => ({ row, student })),
        matches,
      };
    });
    const body = buildPublicSnapshotBody({
      revision: tournament.revision,
      event: tournament.event,
      organizationName: tournament.organization.name,
      categories: data,
      now,
      publicToken: token,
    });
    const serialized = serializePublicBody(body);
    const hash = createHash('sha1').update(serialized.tail).digest('hex').slice(0, 10);
    const entry: PublicEntry = {
      tournamentId: tournament.id,
      revision: tournament.revision,
      etag: `"${tournament.revision}-${hash}"`,
      serialized,
      builtAt: Date.now(),
    };
    // So memoiza se NENHUMA invalidacao DESTE torneio aconteceu depois que a leitura comecou.
    if ((this.invalidatedAt.get(tournament.id) ?? 0) <= startSeq) {
      if (this.cache.size >= MAX_CACHED) this.evictExpired();
      this.cache.set(token, entry);
      this.knownTournament.set(token, tournament.id);
    }
    return entry;
  }

  /**
   * Imagem da foto PROPRIA de um atleta para o telao (rota publica). SEM memoizacao: a regra de privacidade e reavaliada a cada
   * pedido, contra o banco. A foto so sai se: token bem formado e dono de um torneio hoje visivel (ligado, evento publicado/
   * encerrado, ate 30 dias depois); o arquivo pertence a um atleta DESTE torneio (mesmo grupo), nao ligado a aluno; e o atleta
   * e ADULT ou tem a foto autorizada AGORA. Qualquer falha = o MESMO 404 do snapshot (nao revela se o arquivo existe).
   */
  async getPhoto(token: string, file: string): Promise<Buffer> {
    if (!isWellFormedPublicToken(token) || !isTournamentPhotoFile(file)) throw publicNotFound();
    // Token inexistente ja visto: 404 sem consulta (mesmo cache negativo do snapshot; `invalidate` o derruba).
    if (this.negativeHit(token, Date.now())) throw publicNotFound();
    const row = await this.prisma.tournamentCompetitor.findFirst({
      where: { photoFile: file, studentId: null, category: { tournament: { publicToken: token } } },
      select: {
        organizationId: true,
        ageGroup: true,
        photoAuthorized: true,
        category: {
          select: {
            organizationId: true,
            tournament: {
              select: { organizationId: true, publicEnabled: true, event: { select: { status: true, date: true } } },
            },
          },
        },
      },
    });
    if (!row) {
      // Token que nao existe (ou rotacionado) = varredura/lixo: memoiza o 404 por pouco tempo. Token valido com arquivo errado nao.
      const owner = await this.prisma.tournament.findUnique({ where: { publicToken: token }, select: { id: true } });
      if (!owner) this.rememberNegative(token, null);
      throw publicNotFound();
    }
    const t = row.category.tournament;
    if (row.organizationId !== t.organizationId || row.category.organizationId !== t.organizationId) throw publicNotFound();
    if (!isPublicViewAllowed({ publicEnabled: t.publicEnabled, eventStatus: t.event.status, eventDate: t.event.date })) throw publicNotFound();
    if (!photoVisibleOnPublic(row.ageGroup, row.photoAuthorized)) throw publicNotFound();
    const image = await readTournamentPhoto(file);
    if (!image) throw publicNotFound();
    return image;
  }

  private evictExpired(): void {
    const ttl = snapshotTtlMs();
    const now = Date.now();
    for (const [token, entry] of this.cache) {
      if (now - entry.builtAt >= ttl) {
        this.cache.delete(token);
        this.knownTournament.delete(token);
      }
    }
  }
}
