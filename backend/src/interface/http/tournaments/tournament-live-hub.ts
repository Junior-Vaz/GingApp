import { Injectable, Logger } from '@nestjs/common';

/**
 * Hub SSE EM MEMORIA do telao (docs/CONTRATO_CHAVEAMENTO.md 5 e 9): uma instancia do backend. Multi-instancia exigiria
 * Redis pub/sub (limitacao registrada no plano). Guarda so funcoes de retorno por torneio; nenhum dado de atleta.
 */

export type CloseReason = 'token-rotated' | 'disabled' | 'unavailable' | 'max-duration' | 'shutdown';

export interface HubListener {
  /** Algo mudou no torneio (depois do commit): o ouvinte busca o snapshot novo. */
  onChange(): void;
  /** O stream deve terminar (`event: closed`). */
  onClose(reason: CloseReason): void;
}

export const DEFAULT_MAX_VIEWERS = 300;

/** Limite de conexoes simultaneas por torneio. Lido a cada conexao (os e2e trocam a env). */
export function maxViewersPerTournament(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.TOURNAMENT_MAX_VIEWERS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_VIEWERS;
}

@Injectable()
export class TournamentLiveHub {
  private readonly logger = new Logger(TournamentLiveHub.name);
  private readonly channels = new Map<number, Set<HubListener>>();

  /**
   * Registra um ouvinte. Devolve a funcao de descadastro (idempotente) ou `null` se o torneio ja atingiu o limite de
   * conexoes (o chamador responde 503 TOO_MANY_VIEWERS ANTES de abrir o stream).
   */
  subscribe(tournamentId: number, listener: HubListener): (() => void) | null {
    let set = this.channels.get(tournamentId);
    if (!set) {
      set = new Set();
      this.channels.set(tournamentId, set);
    }
    if (set.size >= maxViewersPerTournament()) {
      if (set.size === 0) this.channels.delete(tournamentId);
      return null;
    }
    set.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.channels.get(tournamentId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.channels.delete(tournamentId);
    };
  }

  /** Notifica TODOS os ouvintes do torneio (so depois de a transacao confirmar). Um ouvinte com erro nao afeta os outros. */
  notifyChanged(tournamentId: number): void {
    for (const listener of [...(this.channels.get(tournamentId) ?? [])]) {
      try {
        listener.onChange();
      } catch (error) {
        this.logger.warn(`Ouvinte do telao falhou ao notificar: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /** Manda `closed` a todos os ouvintes do torneio (token rotacionado / telao desligado). Cada ouvinte se descadastra sozinho. */
  closeAll(tournamentId: number, reason: CloseReason): void {
    for (const listener of [...(this.channels.get(tournamentId) ?? [])]) {
      try {
        listener.onClose(reason);
      } catch (error) {
        this.logger.warn(`Ouvinte do telao falhou ao fechar: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  listenerCount(tournamentId: number): number {
    return this.channels.get(tournamentId)?.size ?? 0;
  }

  totalListeners(): number {
    let total = 0;
    for (const set of this.channels.values()) total += set.size;
    return total;
  }

  /**
   * Encerra todos os streams ANTES de o servidor HTTP fechar (senao `server.close()` espera para sempre as conexoes SSE).
   * Roda no SIGTERM (main.ts liga `enableShutdownHooks`) e em `app.close()`.
   */
  beforeApplicationShutdown(): void {
    for (const id of [...this.channels.keys()]) this.closeAll(id, 'shutdown');
  }
}
