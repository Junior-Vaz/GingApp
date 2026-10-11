import { useSyncExternalStore } from "react";

/**
 * Sessão do aluno. Chaves específicas deste app (mb_token / mb_user) para não colidir com
 * painel/admin quando abertos no mesmo navegador.
 */
export const TOKEN_STORAGE_KEY = "mb_token";
export const USER_STORAGE_KEY = "mb_user";

export type OrgRole = "ALUNO" | "RESPONSAVEL" | "MESTRE" | "PROFESSOR";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  userType: "MEMBER" | "PLATFORM";
  isSuperAdmin: boolean;
  organizationId: number;
  organizationSlug: string;
  role: OrgRole;
  /** Senha definida pelo Mestre/Professor (conta criada ou senha redefinida): a troca é obrigatória no primeiro acesso. */
  mustChangePassword?: boolean;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let cachedRaw: string | null | undefined;
let cachedUser: AuthUser | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return storage()?.getItem(TOKEN_STORAGE_KEY) ?? null;
}

export function getUser(): AuthUser | null {
  const raw = storage()?.getItem(USER_STORAGE_KEY) ?? null;
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedUser = raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      cachedUser = null;
    }
  }
  return cachedUser;
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

function emit() {
  listeners.forEach((listener) => listener());
}

export function saveSession(token: string, user: AuthUser): void {
  const store = storage();
  store?.setItem(TOKEN_STORAGE_KEY, token);
  store?.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  emit();
}

/**
 * Troca SÓ o token (mb_token), mantendo o usuário (mb_user) e a escolha do dependente
 * (mb_active_student:*). Usado após a troca de senha: o backend revoga todos os tokens antigos
 * (inclusive o desta chamada) e devolve um novo - a sessão segue sem deslogar. Sem sessão guardada
 * não há o que trocar (não cria sessão "pela metade").
 */
export function replaceToken(token: string): void {
  const store = storage();
  const rawUser = store?.getItem(USER_STORAGE_KEY) ?? null;
  if (!store || rawUser === null) return;
  store.setItem(TOKEN_STORAGE_KEY, token);
  // Só é chamada depois de a PRÓPRIA senha ser trocada: a troca obrigatória (mustChangePassword) está cumprida.
  try {
    const user = JSON.parse(rawUser) as AuthUser;
    if (user.mustChangePassword) store.setItem(USER_STORAGE_KEY, JSON.stringify({ ...user, mustChangePassword: false }));
  } catch {
    // usuário guardado ilegível: getUser() já devolve null; nada a limpar
  }
  emit();
}

export function clearSession(): void {
  const store = storage();
  store?.removeItem(TOKEN_STORAGE_KEY);
  store?.removeItem(USER_STORAGE_KEY);
  memoryChoice.clear();
  emit();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Aluno ativo (seletor de dependente do RESPONSAVEL): só o id do Student escolhido, guardado POR
 * USUÁRIO (outra conta no mesmo navegador não herda a escolha). Todo acesso ao storage tem try/catch
 * (modo privado/cota/storage bloqueado => sem persistência, o app segue funcionando).
 */
export const ACTIVE_STUDENT_KEY_PREFIX = "mb_active_student:";
const activeStudentKey = (userId: number) => `${ACTIVE_STUDENT_KEY_PREFIX}${userId}`;
/** Fallback em memória quando o storage está indisponível (vale até recarregar a página). */
const memoryChoice = new Map<number, number>();

export function getStoredStudentId(userId: number | undefined): number | null {
  if (userId === undefined) return null;
  try {
    const raw = storage()?.getItem(activeStudentKey(userId)) ?? null;
    const id = raw === null ? NaN : Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function setStoredStudentId(userId: number | undefined, studentId: number): void {
  if (userId === undefined) return;
  try {
    storage()?.setItem(activeStudentKey(userId), String(studentId));
    memoryChoice.delete(userId);
  } catch {
    // Sem persistência (modo privado/cota): a escolha vale só até recarregar, guardada em memória
    // — o snapshot lido do storage não mudaria e a UI não trocaria de aluno.
    memoryChoice.set(userId, studentId);
  }
  emit();
}

export function useStoredStudentId(userId: number | undefined): number | null {
  return useSyncExternalStore(
    subscribe,
    () => getStoredStudentId(userId) ?? (userId === undefined ? null : (memoryChoice.get(userId) ?? null)),
    () => null,
  );
}

export function useSessionUser(): AuthUser | null {
  return useSyncExternalStore(subscribe, getUser, () => null);
}
