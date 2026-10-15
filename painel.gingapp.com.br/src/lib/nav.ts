import {
  LayoutDashboard,
  Users,
  GraduationCap,
  Layers,
  CalendarDays,
  ClipboardCheck,
  Award,
  Wallet,
  PartyPopper,
  CircleDot,
  BadgeCheck,
  Megaphone,
  BarChart3,
  Building2,
  Settings,
  History,
  Trophy,
  ArrowRightLeft,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { PANEL_ROLES, type OrgRole } from "@/lib/session";

export interface NavItem {
  /** Caminho da rota (arquivo src/routes/_app.<slug>.tsx). */
  to: string;
  label: string;
  icon: LucideIcon;
  /** Papéis que enxergam o item. Omitido = todos os papéis do painel (MESTRE, PROFESSOR, INSTRUTOR e MONITOR). */
  roles?: readonly OrgRole[];
}

/** Equipe que enxerga dashboard/equipe/certificados: o MONITOR não tem esses recursos (backend: dashboard/teachers/certificates = nada). */
const WITHOUT_MONITOR: readonly OrgRole[] = ["MESTRE", "PROFESSOR", "INSTRUTOR"];

/**
 * SSOT do menu lateral. Para adicionar um item: crie a rota em src/routes e acrescente UMA
 * linha aqui. A ordem do array é a ordem do menu (mesma do painel Vue anterior).
 */
export const NAV_ITEMS: readonly NavItem[] = [
  // Dashboard (dashboard:view) e Equipe (teachers:view): o MONITOR não tem nenhum dos dois.
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: WITHOUT_MONITOR },
  { to: "/alunos", label: "Alunos", icon: Users },
  // Equipe = mestres, professores, instrutores e monitores (cargos acumuláveis); a rota continua /professores.
  { to: "/professores", label: "Equipe", icon: GraduationCap, roles: WITHOUT_MONITOR },
  { to: "/turmas", label: "Turmas", icon: Layers },
  { to: "/aulas", label: "Aulas", icon: CalendarDays },
  { to: "/frequencia", label: "Frequência", icon: ClipboardCheck },
  { to: "/graduacoes", label: "Graduações", icon: Award },
  // Ranking do grupo (GET /ranking/*): quem vê alunos (students:view) = toda a equipe, inclusive o MONITOR.
  { to: "/ranking", label: "Ranking", icon: Trophy, roles: PANEL_ROLES },
  // Financeiro é só do MESTRE (backend: RolePermission PROFESSOR/finance = tudo false).
  { to: "/financeiro", label: "Financeiro", icon: Wallet, roles: ["MESTRE"] },
  // Transferências entre grupos (GET/POST /transfers): só o MESTRE (backend: 403 para os demais papéis).
  { to: "/transferencias", label: "Transferências", icon: ArrowRightLeft, roles: ["MESTRE"] },
  { to: "/eventos", label: "Eventos", icon: PartyPopper },
  { to: "/rodas", label: "Rodas", icon: CircleDot },
  // Certificados (certificates:view): o MONITOR não tem (backend: nada); o INSTRUTOR só lê.
  { to: "/certificados", label: "Certificados", icon: BadgeCheck, roles: WITHOUT_MONITOR },
  { to: "/comunicados", label: "Comunicados", icon: Megaphone },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
  // Unidades (backend: recurso `units`, CRUD só do MESTRE) e Configurações (PATCH /organizations/me, só MESTRE):
  // ficam só para o MESTRE no menu.
  { to: "/unidades", label: "Unidades", icon: Building2, roles: ["MESTRE"] },
  { to: "/configuracoes", label: "Configurações", icon: Settings, roles: ["MESTRE"] },
  // Atividade do grupo (GET /audit-logs/me-group): trilha de auditoria do próprio grupo, só o MESTRE.
  { to: "/atividade", label: "Atividade do grupo", icon: History, roles: ["MESTRE"] },
];

/**
 * "Meu perfil": rota de TODOS os papéis do painel (sem `roles`), aberta pelo avatar do cabeçalho, pelo menu "Mais" e
 * pelo rodapé da sidebar. Fica FORA de NAV_ITEMS de propósito: não é uma área do menu lateral nem entra nas abas do celular.
 */
export const PROFILE_ITEM: NavItem = { to: "/perfil", label: "Meu perfil", icon: UserRound };

/** Mensagem mostrada quando um papel do painel abre uma rota que não é dele (ex.: PROFESSOR em /financeiro). */
export const ROUTE_FORBIDDEN_MESSAGE = "Você não tem permissão para acessar esta área.";

/** O papel pode abrir esta rota do menu? Rotas fora do menu, ou sem `roles`, são livres para o painel. */
export function canAccessRoute(role: OrgRole | undefined, to: string): boolean {
  const item = NAV_ITEMS.find((i) => i.to === to);
  return !item?.roles || (role !== undefined && item.roles.includes(role));
}

export function navItemsFor(role: OrgRole | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.roles || (role !== undefined && item.roles.includes(role)));
}

/**
 * Atalhos da BARRA INFERIOR (celular), em ordem de preferência: Início, Alunos, Frequência/Chamada, Financeiro e, para
 * quem não tem Financeiro, Turmas/Aulas. Só entram os que o papel enxerga (mesma regra do menu: `navItemsFor`).
 */
const MOBILE_TAB_PREFERENCE = ["/dashboard", "/alunos", "/frequencia", "/financeiro", "/turmas", "/aulas"] as const;
export const MOBILE_TAB_COUNT = 4;

/** Os 4 atalhos da barra inferior do papel (o 5º botão é sempre o "Mais"). */
export function mobileTabsFor(role: OrgRole | undefined): NavItem[] {
  const allowed = navItemsFor(role);
  return MOBILE_TAB_PREFERENCE.map((to) => allowed.find((item) => item.to === to))
    .filter((item): item is NavItem => item !== undefined)
    .slice(0, MOBILE_TAB_COUNT);
}

/** O que sobra para o menu "Mais" (todo o resto que o papel enxerga, na ordem do menu). */
export function mobileMoreFor(role: OrgRole | undefined): NavItem[] {
  const tabs = new Set(mobileTabsFor(role).map((item) => item.to));
  return navItemsFor(role).filter((item) => !tabs.has(item.to));
}

/** Tela inicial do papel: o Dashboard, ou /alunos para quem não tem Dashboard (MONITOR). */
export function homeFor(role: OrgRole | undefined): "/dashboard" | "/alunos" {
  return role !== undefined && !canAccessRoute(role, "/dashboard") ? "/alunos" : "/dashboard";
}
