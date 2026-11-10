import { HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CloseReason, TournamentLiveHub } from './tournament-live-hub';
import { PublicEntry, TournamentPublicService } from './tournament-public.service';
import { tooManyViewers } from './tournament-rules';
import { composeSnapshotJson } from './tournament-snapshot';

/**
 * Stream SSE do telao (docs/CONTRATO_CHAVEAMENTO.md 5), escrito direto no `res` para controlar os cabecalhos (inclusive
 * `X-Accel-Buffering: no`) e o flush. Cada mensagem `snapshot` e o estado COMPLETO (nao delta), `id:` = revisao.
 *
 * Ciclo de vida: o 404/503 saem ANTES de abrir o stream (resposta JSON normal). Os ouvintes de desconexao sao registrados
 * ANTES do primeiro `await` (cliente que vai embora enquanto o snapshot e lido nao pode deixar ouvinte no hub). Depois de
 * aberto, o stream so termina por `event: closed` (token rotacionado / telao desligado / indisponivel / 6 h / desligamento
 * do app) ou porque o cliente foi embora; em ambos os casos os timers sao limpos e o ouvinte sai do hub (sem vazar memoria).
 */

export interface StreamTimings {
  pingMs: number;
  maxDurationMs: number;
}

/** 20 s de ping e teto de 6 h; as envs existem para os e2e (valores invalidos caem no padrao). */
export function streamTimings(env: NodeJS.ProcessEnv = process.env): StreamTimings {
  const num = (name: string, fallback: number) => {
    const n = Number(env[name]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return { pingMs: num('TOURNAMENT_SSE_PING_MS', 20_000), maxDurationMs: num('TOURNAMENT_SSE_MAX_MS', 6 * 3_600_000) };
}

const logger = new Logger('TournamentStream');

// --------------------------------------------------------------------------------------------------------------
// Frame SSE memoizado
// --------------------------------------------------------------------------------------------------------------

export interface SseFrame {
  text: string;
  bytes: number;
}

/** Um frame `snapshot` serializado POR ENTRADA (revisao/ETag): todas as conexoes enviam a MESMA string, com um serverTime comum. */
const frames = new WeakMap<PublicEntry, SseFrame>();

export function frameFor(entry: PublicEntry, now: Date = new Date()): SseFrame {
  let frame = frames.get(entry);
  if (!frame) {
    const text = `event: snapshot\nid: ${entry.revision}\ndata: ${composeSnapshotJson(entry.serialized, now)}\n\n`;
    frame = { text, bytes: Buffer.byteLength(text) };
    frames.set(entry, frame);
  }
  return frame;
}

const MIN_BUFFER_BYTES = 1024 * 1024;

/** Teto de bytes pendentes por conexao: `max(1 MB, 2 x frame)`; acima disso o cliente e lento demais e cai. */
export function bufferLimitFor(frameBytes: number): number {
  return Math.max(MIN_BUFFER_BYTES, 2 * frameBytes);
}

/** Escreve e informa se a conexao estourou o teto de buffer (cliente que nao consome). Nao derruba por conta propria. */
export function writeWithLimit(res: Pick<Response, 'write' | 'writableLength'>, chunk: string, limitBytes: number): boolean {
  res.write(chunk);
  return res.writableLength > limitBytes;
}

// --------------------------------------------------------------------------------------------------------------

export async function openTournamentStream(
  token: string,
  req: Request,
  res: Response,
  publicService: TournamentPublicService,
  hub: TournamentLiveHub,
): Promise<void> {
  let closed = false;
  let sending = false;
  let dirty = false;
  let lastEtag: string | null = null;
  let limitBytes = MIN_BUFFER_BYTES;
  let pingTimer: NodeJS.Timeout | undefined;
  let maxTimer: NodeJS.Timeout | undefined;
  let unsubscribe: (() => void) | null = null;

  const cleanup = (): void => {
    closed = true;
    if (pingTimer) clearInterval(pingTimer);
    if (maxTimer) clearTimeout(maxTimer);
    pingTimer = undefined;
    maxTimer = undefined;
    unsubscribe?.(); // idempotente: libera a vaga do limite de conexoes em TODO caminho
    unsubscribe = null;
    req.socket?.off('close', cleanup);
    res.off('close', cleanup);
    res.off('error', cleanup);
  };

  // Desconexao ANTES de qualquer await: `res`/socket 'close' (o 'close' do `req` nao serve: pode disparar com o corpo consumido).
  res.once('close', cleanup);
  res.once('error', cleanup);
  req.socket?.once('close', cleanup);
  const gone = (): boolean => closed || !!req.socket?.destroyed || res.destroyed;

  try {
    // 1) Antes de abrir: 404 identico ao do GET (token invalido/desligado/evento fora da janela).
    const first = await publicService.getSnapshot(token);
    if (gone()) {
      cleanup();
      return;
    }

    const write = (chunk: string): void => {
      if (closed || res.writableEnded || res.destroyed) return;
      try {
        // Cliente lento (nao le o que enviamos): derruba a conexao em vez de acumular frames na memoria do servidor.
        if (writeWithLimit(res, chunk, limitBytes)) {
          logger.warn('Cliente do telao lento demais: conexao encerrada.');
          cleanup();
          res.destroy();
        }
      } catch (error) {
        logger.warn(`Falha ao escrever no stream: ${error instanceof Error ? error.message : String(error)}`);
        cleanup();
      }
    };

    const closeWith = (reason: CloseReason): void => {
      if (closed) return;
      write(`event: closed\ndata: ${JSON.stringify({ reason })}\n\n`);
      cleanup();
      if (!res.writableEnded && !res.destroyed) res.end();
    };

    const emit = (entry: PublicEntry): void => {
      if (entry.etag === lastEtag) return;
      lastEtag = entry.etag;
      const frame = frameFor(entry);
      limitBytes = bufferLimitFor(frame.bytes);
      write(frame.text);
    };

    /** Busca o snapshot atual (memoizado) e envia se mudou; coalesce avisos que chegam durante o envio. */
    const refresh = async (): Promise<void> => {
      if (closed) return;
      if (sending) {
        dirty = true;
        return;
      }
      sending = true;
      try {
        do {
          dirty = false;
          let entry: PublicEntry;
          try {
            entry = await publicService.getSnapshot(token);
          } catch (error) {
            const status = (error as { getStatus?: () => number }).getStatus?.();
            if (status === HttpStatus.NOT_FOUND) closeWith('unavailable');
            else logger.warn(`Falha ao montar o snapshot do stream: ${error instanceof Error ? error.message : String(error)}`);
            return;
          }
          if (!closed) emit(entry);
        } while (dirty && !closed);
      } finally {
        sending = false;
      }
    };

    // 2) Limite de conexoes: 503 TOO_MANY_VIEWERS antes de abrir o stream (nada fica registrado).
    unsubscribe = hub.subscribe(first.tournamentId, {
      onChange: () => void refresh(),
      onClose: (reason) => closeWith(reason),
    });
    if (!unsubscribe) throw tooManyViewers();
    if (gone()) {
      cleanup();
      return;
    }

    // 3) Abre o stream e envia o PRIMEIRO snapshot na hora.
    const timings = streamTimings();
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Robots-Tag', 'noindex');
    req.socket?.setNoDelay(true);
    req.socket?.setKeepAlive(true);
    req.setTimeout(0);
    res.setTimeout(0);
    res.flushHeaders();

    write('retry: 3000\n\n');
    emit(first);
    pingTimer = setInterval(() => {
      write(': ping\n\n');
      void refresh(); // pega mudanca de dado EXTERNO (foto/nascimento do aluno, evento cancelado) mesmo sem mutacao
    }, timings.pingMs);
    pingTimer.unref?.();
    maxTimer = setTimeout(() => closeWith('max-duration'), timings.maxDurationMs);
    maxTimer.unref?.();
    // Algo pode ter mudado entre o primeiro getSnapshot e a inscricao no hub.
    void refresh();
  } catch (error) {
    cleanup(); // 404, 503 ou falha ao abrir: nunca deixar ouvinte no hub nem listeners no socket
    throw error;
  }
}
