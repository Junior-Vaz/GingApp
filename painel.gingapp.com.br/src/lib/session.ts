import { useSyncExternalStore } from "react";
import { STAFF_ROLE_LABEL, type StaffRole } from "@/lib/staff-roles";

/**
 * Sessão do painel de gestão. Chaves PRÓPRIAS (gestao_token / gestao_user) para não colidir com
 * o app do aluno (mb_token / mb_user) nem com o admin quando abertos no mesmo navegador.
 */
export const TOKEN_STORAGE_KEY = "gestao_token";
export const USER_STORAGE_KEY = "gestao_user";

export type OrgRole = "ALUNO" | "RESPONSAVEL" | StaffRole;

export const ROLE_LABEL: Record<OrgRole, string> = {
  ...STAFF_ROLE_LABEL,
  ALUNO: "Aluno",
  RESPONSAVEL: "Responsável",
};

/**
 * Papéis que acessam o painel: a equipe (MESTRE, PROFESSOR, INSTRUTOR e MONITOR - o papel é o MAIOR cargo da pessoa
 * no grupo). Espelha a matriz RolePermission do backend; ALUNO/RESPONSAVEL usam o app. O menu e as ações de cada
 * papel são restritos (ver `roleCan` e `lib/nav.ts`). A autorização real continua no backend (CanAccessGuard) -
 * isto é só a primeira barreira de UX.
 */
export const PANEL_ROLES: readonly OrgRole[] = ["MESTRE", "PROFESSOR", "INSTRUTOR", "MONITOR"];

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  userType: "MEMBER" | "PLATFORM";
  isSuperAdmin: boolean;
  organizationId: number;
  organizationSlug: string;
  /** Logo do grupo (caminho de /uploads ou URL), quando o login/GET /auth/me enviar; sem ele o cabeçalho mobile usa o logo do GingApp. */
  organizationLogoUrl?: string | null;
  /** Papel de acesso = o MAIOR cargo da pessoa no grupo (pode ser INSTRUTOR/MONITOR). */
  role: OrgRole;
  /** Cargos ativos no grupo, do maior para o menor (GET /auth/me traz; o login pode não trazer). */
  roles?: StaffRole[];
  /** Senha definida por outra pessoa (conta criada/redefinida pelo Mestre): o painel exige a troca antes de tudo. */
  mustChangePassword?: boolean;
  /** Termos de Uso/Política de Privacidade (E10): true = há aceite pendente; o painel mostra a tela bloqueante. */
  termsAcceptanceRequired?: boolean;
  currentTermsVersion?: string;
  acceptedTermsVersion?: string | null;
  /** Verificação em duas etapas (GET /auth/me traz; o login não precisa trazer). */
  twoFactorEnabled?: boolean;
  recoveryCodesRemaining?: number;
}

/** O usuário pode usar o painel de gestão? (MEMBER com papel MESTRE, PROFESSOR, INSTRUTOR ou MONITOR.) */
export function canAccessPanel(user: AuthUser | null | undefined): boolean {
  return !!user && user.userType === "MEMBER" && PANEL_ROLES.includes(user.role);
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

/** Sessão válida para o painel: tem token E usuário com papel de gestão. */
export function isAuthenticated(): boolean {
  return !!getToken() && canAccessPanel(getUser());
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
 * Troca SÓ o token, mantendo o usuário guardado. Usado após a troca de senha: o backend revoga todos
 * os tokens antigos (inclusive o desta chamada) e devolve um novo - a sessão segue sem deslogar.
 * Sem sessão guardada não há o que trocar (não cria sessão "pela metade").
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
    // usuário guardado ilegível: getUser() já devolve null
  }
  emit();
}

/** Mescla campos no usuário da sessão (ex.: depois do aceite dos termos). Sem sessão guardada não faz nada. */
export function updateSessionUser(patch: Partial<AuthUser>): void {
  const store = storage();
  const rawUser = store?.getItem(USER_STORAGE_KEY) ?? null;
  if (!store || rawUser === null) return;
  try {
    store.setItem(USER_STORAGE_KEY, JSON.stringify({ ...(JSON.parse(rawUser) as AuthUser), ...patch }));
  } catch {
    return;
  }
  emit();
}

export function clearSession(): void {
  const store = storage();
  store?.removeItem(TOKEN_STORAGE_KEY);
  store?.removeItem(USER_STORAGE_KEY);
  emit();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSessionUser(): AuthUser | null {
  return useSyncExternalStore(subscribe, getUser, () => null);
}

export type PermissionAction = "view" | "create" | "edit" | "delete";
export type PermissionResource =
  | "students"
  | "classes"
  | "lessons"
  | "attendance"
  | "graduations"
  | "finance"
  | "events"
  | "rodas"
  | "announcements"
  | "teachers"
  | "certificates"
  | "units"
  | "dashboard";

/**
 * Espelho de UX da matriz RolePermission do backend (backend/prisma/permission-matrix.ts): MESTRE pode tudo;
 * PROFESSOR = view/create/edit sem delete, exceto `teachers` e `units` (só view) e `finance` (nada).
 * INSTRUTOR = como PROFESSOR, mas graduações e certificados só leitura (além de `teachers`/`units` só leitura e
 * `finance` nada). MONITOR = só leitura (alunos, turmas, aulas, graduações, eventos, rodas, comunicados, unidades)
 * + chamada (`attendance` view/create/edit); sem `finance`, `teachers`, `dashboard` e `certificates`.
 * ALUNO/RESPONSAVEL não usam o painel. O backend decide de fato (CanAccessGuard, 403) - isto só evita
 * mostrar botão que sempre falharia. Sem sessão = nega (falha fechada).
 */
const VIEW: readonly PermissionAction[] = ["view"];
const NONE: readonly PermissionAction[] = [];
const EDITOR: readonly PermissionAction[] = ["view", "create", "edit"];

const STAFF_ACTIONS: Record<
  Exclude<StaffRole, "MESTRE">,
  { fallback: readonly PermissionAction[]; by: Partial<Record<PermissionResource, readonly PermissionAction[]>> }
> = {
  PROFESSOR: { fallback: EDITOR, by: { teachers: VIEW, units: VIEW, finance: NONE } },
  INSTRUTOR: {
    fallback: EDITOR,
    by: { teachers: VIEW, units: VIEW, finance: NONE, graduations: VIEW, certificates: VIEW },
  },
  MONITOR: {
    fallback: VIEW,
    by: { attendance: EDITOR, teachers: NONE, finance: NONE, dashboard: NONE, certificates: NONE },
  },
};

export function roleCan(
  role: OrgRole | undefined,
  resource: PermissionResource,
  action: PermissionAction,
): boolean {
  if (role === "MESTRE") return true;
  if (role === "PROFESSOR" || role === "INSTRUTOR" || role === "MONITOR") {
    const rules = STAFF_ACTIONS[role];
    return (rules.by[resource] ?? rules.fallback).includes(action);
  }
  return false;
}

/** O usuário da sessão pode `action` em `resource`? Ex.: `useCan("students", "delete")`. */
export function useCan(resource: PermissionResource, action: PermissionAction): boolean {
  return roleCan(useSessionUser()?.role, resource, action);
}
