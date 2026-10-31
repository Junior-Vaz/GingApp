import { useCallback, useState } from "react";

/** "Agora não": o convite só volta depois de 3 dias. */
export const SNOOZE_DAYS = 3;
export const SNOOZE_MS = SNOOZE_DAYS * 24 * 60 * 60 * 1000;

/** Chaves do localStorage dos convites da Home (uma por cartão, separadas de propósito). */
export const SNOOZE_KEYS = {
  install: "gingapp:onboarding:install-dismissed-at",
  push: "gingapp:onboarding:push-dismissed-at",
} as const;
/** Marca de que a dica "como reativar as notificações" já foi mostrada (aparece uma única vez). */
export const PUSH_DENIED_HINT_KEY = "gingapp:onboarding:push-denied-hint-shown";

export type Clock = () => number;
const systemClock: Clock = () => Date.now();

function storageOrNull(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Instante (ms) em que o usuário dispensou, ou null (sem registro, valor inválido ou storage indisponível). */
export function readSnoozedAt(key: string): number | null {
  try {
    const raw = storageOrNull()?.getItem(key);
    if (!raw) return null;
    const at = Number(raw);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/** Puro: continua dispensado enquanto passaram menos de 3 dias. Instante no futuro (relógio mexido) não vale. */
export function isSnoozedAt(snoozedAt: number | null, now: number): boolean {
  if (snoozedAt === null) return false;
  const elapsed = now - snoozedAt;
  return elapsed >= 0 && elapsed < SNOOZE_MS;
}

export function writeSnoozedAt(key: string, now: number): void {
  try {
    storageOrNull()?.setItem(key, String(now));
  } catch {
    /* storage cheio/bloqueado: a dispensa vale só nesta visita */
  }
}

export function isSnoozed(key: string, now: number = systemClock()): boolean {
  return isSnoozedAt(readSnoozedAt(key), now);
}

/**
 * "Dispensar por 3 dias" de um convite. A leitura acontece UMA vez, ao montar (o cartão não pisca ao voltar de outra
 * tela); `snooze()` grava o instante e some na hora, mesmo se o storage falhar. Relógio injetável para teste.
 */
export function useSnooze(key: string, clock: Clock = systemClock): { snoozed: boolean; snooze: () => void } {
  const [snoozed, setSnoozed] = useState(() => isSnoozed(key, clock()));
  const snooze = useCallback(() => {
    writeSnoozedAt(key, clock());
    setSnoozed(true);
  }, [key, clock]);
  return { snoozed, snooze };
}
