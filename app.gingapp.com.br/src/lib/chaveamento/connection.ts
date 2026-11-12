import { API_URL } from "@/lib/api";
import { isOffline, isPageHidden } from "./page-state";
import { parsePublicSnapshot } from "./parse";
import { diffSnapshots, type SnapshotDiff } from "./snapshot-diff";
import type { PublicSnapshot } from "./types";

/** Tempo máximo para o SSE abrir; passou disso, cai para a consulta periódica. */
export const SSE_OPEN_TIMEOUT_MS = 8_000;
/** Intervalo da consulta periódica (plano B). */
export const POLL_INTERVAL_MS = 3_000;
/** De quanto em quanto tempo tenta reabrir o SSE enquanto está na consulta. */
export const SSE_RETRY_MS = 30_000;
/** Teto do recuo exponencial da consulta quando ela falha (3 s, 6 s, 12 s, 24 s, 30 s...). Volta a 3 s no primeiro sucesso. */
export const POLL_BACKOFF_MAX_MS = 30_000;

/** Espera até a próxima consulta depois de `failures` falhas seguidas (0 = intervalo normal). */
export function pollDelayAfter(failures: number): number {
  if (failures <= 0) return POLL_INTERVAL_MS;
  return Math.min(POLL_BACKOFF_MAX_MS, POLL_INTERVAL_MS * 2 ** Math.min(failures, 10));
}

/**
 * live = SSE aberto; polling = consulta a cada 3 s funcionando; reconnecting = ainda sem conexão (início ou falha);
 * unavailable = campeonato fora do ar (404 / `closed`): estado final, sem tentar de novo.
 */
export type ConnectionStatus = "live" | "reconnecting" | "polling" | "unavailable";

export interface LiveState {
  status: ConnectionStatus;
  snapshot: PublicSnapshot | null;
  /** Mudanças do ÚLTIMO snapshot aceito (null antes do primeiro). */
  diff: SnapshotDiff | null;
  /** Sobe a cada snapshot aceito (chave estável para efeitos de animação/anúncio). */
  seq: number;
  /** O aparelho avisou que está sem rede (`offline`): o último placar continua na tela e nada é pedido até a rede voltar. */
  offline: boolean;
}

export const INITIAL_LIVE_STATE: LiveState = { status: "reconnecting", snapshot: null, diff: null, seq: 0, offline: false };

/** `closed` por estes motivos é passageiro (teto de 6 h / reinício do servidor): reavalia pela consulta em vez de desistir. */
const TRANSIENT_CLOSE_REASONS = new Set(["max-duration", "shutdown"]);

const publicUrl = (token: string): string => `${API_URL}/public/tournaments/${encodeURIComponent(token)}`;

/** O corpo sem o `serverTime` (que muda a cada resposta): duas respostas iguais têm a mesma assinatura. */
export function signatureOf(text: string): string {
  return text.replace(/"serverTime":"[^"]*",?/, "");
}

function closedReason(data: unknown): string | null {
  if (typeof data !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(data);
    const reason = (parsed as { reason?: unknown } | null)?.reason;
    return typeof reason === "string" ? reason : null;
  } catch {
    return null;
  }
}

/**
 * Máquina de conexão do telão (sem React, testável com timers falsos):
 * 1. abre o EventSource; se não abrir em 8 s ou cair => consulta GET a cada 3 s com `If-None-Match` (304 mantém o estado);
 * 2. durante a consulta, tenta reabrir o SSE a cada 30 s (a consulta só para quando o SSE abre de verdade);
 * 3. `closed` (token rotacionado/desligado) ou 404 => `unavailable` e NADA mais acontece (sem loop de reconexão);
 * 4. `stop()` limpa timers, fecha o EventSource e aborta a consulta em andamento.
 * 5. Bateria e dados: com a aba/app OCULTO (`visibilityState === "hidden"`) ou o aparelho OFFLINE, o EventSource é fechado e
 *    NENHUM timer/consulta fica de pé (o último snapshot continua na tela). Ao voltar ao primeiro plano (ou a rede voltar) faz
 *    uma consulta imediata (GET com `If-None-Match`) e reabre o SSE.
 * 6. Consulta que falha recua de forma exponencial (3 s -> 30 s) e volta a 3 s no primeiro sucesso.
 * Snapshots de revisão MENOR que a exibida são ignorados; mesmo corpo repetido não gera render.
 */
export class LiveConnection {
  private state: LiveState = INITIAL_LIVE_STATE;
  private stopped = false;
  private source: EventSource | null = null;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pollAbort: AbortController | null = null;
  private polling = false;
  private etag: string | null = null;
  private signature: string | null = null;
  /** Aba oculta: nada de rede nem timers. */
  private hidden = false;
  /** Aparelho sem rede: nada de rede nem timers. */
  private offline = false;
  /** Consultas seguidas que falharam (base do recuo exponencial). */
  private failures = 0;
  private listening = false;

  constructor(
    private readonly token: string,
    private readonly onChange: (state: LiveState) => void,
  ) {}

  start(): void {
    if (this.stopped) return;
    this.listen();
    this.hidden = isPageHidden();
    this.offline = isOffline();
    if (this.offline) this.emit({ ...this.state, offline: true });
    if (this.idle) return; // abre quando voltar ao primeiro plano / a rede voltar
    this.openStream();
  }

  stop(): void {
    this.stopped = true;
    this.unlisten();
    this.teardown();
  }

  private get idle(): boolean {
    return this.hidden || this.offline;
  }

  /* ------------------------------------------------ primeiro plano e rede ------------------------------------------------ */

  private readonly onVisibility = (): void => {
    if (this.stopped) return;
    if (isPageHidden()) {
      if (this.hidden) return;
      this.hidden = true;
      this.teardown();
      return;
    }
    if (!this.hidden) return;
    this.hidden = false;
    this.resume();
  };

  private readonly onOffline = (): void => {
    if (this.stopped || this.offline) return;
    this.offline = true;
    this.teardown();
    if (this.state.status !== "unavailable") this.emit({ ...this.state, offline: true, status: "reconnecting" });
  };

  private readonly onOnline = (): void => {
    if (this.stopped || !this.offline) return;
    this.offline = false;
    if (this.state.status !== "unavailable") this.emit({ ...this.state, offline: false });
    this.resume();
  };

  private listen(): void {
    if (this.listening || typeof document === "undefined" || typeof window === "undefined") return;
    this.listening = true;
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("offline", this.onOffline);
    window.addEventListener("online", this.onOnline);
  }

  private unlisten(): void {
    if (!this.listening) return;
    this.listening = false;
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("offline", this.onOffline);
    window.removeEventListener("online", this.onOnline);
  }

  /** Voltou ao primeiro plano (ou a rede voltou): consulta na hora (304 se nada mudou) e reabre o SSE. */
  private resume(): void {
    if (this.stopped || this.idle || this.state.status === "unavailable") return;
    this.failures = 0;
    this.beginPolling();
    this.openStream();
  }

  /* ------------------------------------------------ estado ------------------------------------------------ */

  private emit(next: LiveState): void {
    this.state = next;
    if (!this.stopped) this.onChange(next);
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.state.status === status || this.state.status === "unavailable") return;
    this.emit({ ...this.state, status });
  }

  /** Aceita (ou ignora) o texto de um snapshot. true = o corpo era um snapshot válido. */
  private ingest(text: unknown): boolean {
    if (typeof text !== "string") return false;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return false;
    }
    const snapshot = parsePublicSnapshot(raw);
    if (!snapshot) return false;
    const current = this.state.snapshot;
    if (current && snapshot.revision < current.revision) return true;
    const signature = signatureOf(text);
    if (current && signature === this.signature) return true;
    this.signature = signature;
    this.emit({ ...this.state, snapshot, diff: diffSnapshots(current, snapshot), seq: this.state.seq + 1 });
    return true;
  }

  /* ------------------------------------------------ SSE ------------------------------------------------ */

  private clearOpenTimer(): void {
    if (this.openTimer !== null) clearTimeout(this.openTimer);
    this.openTimer = null;
  }

  private closeSource(): void {
    this.clearOpenTimer();
    const source = this.source;
    this.source = null;
    if (source) {
      try {
        source.close();
      } catch {
        /* nada a fazer */
      }
    }
  }

  private openStream(): void {
    if (this.stopped || this.idle || this.source || this.state.status === "unavailable") return;
    if (typeof EventSource === "undefined") {
      this.beginPolling();
      return;
    }
    let source: EventSource;
    try {
      source = new EventSource(`${publicUrl(this.token)}/stream`);
    } catch {
      this.beginPolling();
      this.scheduleRetry();
      return;
    }
    this.source = source;
    this.openTimer = setTimeout(() => this.streamFailed(source), SSE_OPEN_TIMEOUT_MS);

    source.addEventListener("open", () => {
      if (source === this.source) this.streamConnected();
    });
    source.addEventListener("snapshot", (event) => {
      if (source !== this.source) return;
      this.streamConnected();
      this.ingest((event as MessageEvent).data);
    });
    source.addEventListener("closed", (event) => {
      if (source !== this.source) return;
      const reason = closedReason((event as MessageEvent).data);
      if (reason !== null && TRANSIENT_CLOSE_REASONS.has(reason)) this.streamFailed(source);
      else this.makeUnavailable();
    });
    source.addEventListener("error", () => {
      if (source === this.source) this.streamFailed(source);
    });
  }

  /** SSE abriu de verdade: a consulta e a tentativa de reabertura não são mais necessárias. */
  private streamConnected(): void {
    this.clearOpenTimer();
    this.stopPolling();
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.failures = 0;
    this.setStatus("live");
  }

  private streamFailed(source: EventSource): void {
    if (source !== this.source || this.stopped) return;
    this.closeSource();
    if (this.idle) return;
    if (this.state.status === "live") this.setStatus("reconnecting");
    this.beginPolling();
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.stopped || this.idle || this.retryTimer !== null || this.state.status === "unavailable") return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.openStream();
    }, SSE_RETRY_MS);
  }

  /* ------------------------------------------------ consulta (plano B) ------------------------------------------------ */

  private beginPolling(): void {
    if (this.stopped || this.idle || this.polling || this.state.status === "unavailable") return;
    this.polling = true;
    void this.pollOnce();
  }

  private stopPolling(): void {
    this.polling = false;
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.pollAbort?.abort();
    this.pollAbort = null;
  }

  private async pollOnce(): Promise<void> {
    const controller = new AbortController();
    this.pollAbort = controller;
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (this.etag !== null) headers["If-None-Match"] = this.etag;
      const response = await fetch(publicUrl(this.token), {
        headers,
        signal: controller.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (this.stopped || controller.signal.aborted) return;
      if (response.status === 304) {
        this.failures = 0;
        this.setStatus("polling");
      } else if (response.status === 404) {
        this.makeUnavailable();
        return;
      } else if (response.ok) {
        const text = await response.text();
        if (this.stopped || controller.signal.aborted) return;
        if (this.ingest(text)) {
          const etag = response.headers.get("ETag");
          if (etag) this.etag = etag;
          this.failures = 0;
          this.setStatus("polling");
        } else {
          this.failures += 1;
          this.setStatus("reconnecting");
        }
      } else {
        this.failures += 1;
        this.setStatus("reconnecting");
      }
    } catch {
      if (this.stopped || controller.signal.aborted) return;
      this.failures += 1;
      this.setStatus("reconnecting");
    }
    if (this.polling && !this.stopped && !this.idle && this.state.status !== "unavailable") {
      this.pollTimer = setTimeout(() => {
        this.pollTimer = null;
        void this.pollOnce();
      }, pollDelayAfter(this.failures));
    }
  }

  /* ------------------------------------------------ fim ------------------------------------------------ */

  /** Campeonato fora do ar: estado final. Não guarda o snapshot antigo (o link pode ter sido trocado de propósito). */
  private makeUnavailable(): void {
    this.teardown();
    this.emit({ status: "unavailable", snapshot: null, diff: null, seq: this.state.seq, offline: this.state.offline });
  }

  private teardown(): void {
    this.closeSource();
    this.stopPolling();
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
