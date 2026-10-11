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
  type LucideIcon,
} from "lucide-react";
import type { OrgRole } from "@/lib/session";

export interface NavItem {
  /** Caminho da rota (arquivo src/routes/_app.<slug>.tsx). */
  to: string;
  label: string;
  icon: LucideIcon;
  /** Papéis que enxergam o item. Omitido = todos os papéis do painel (MESTRE e PROFESSOR). */
  roles?: readonly OrgRole[];
}

/**
 * SSOT do menu lateral. Para adicionar um item: crie a rota em src/routes e acrescente UMA
 * linha aqui. A ordem do array é a ordem do menu (mesma do painel Vue anterior).
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/alunos", label: "Alunos", icon: Users },
  { to: "/professores", label: "Professores", icon: GraduationCap },
  { to: "/turmas", label: "Turmas", icon: Layers },
  { to: "/aulas", label: "Aulas", icon: CalendarDays },
  { to: "/frequencia", label: "Frequência", icon: ClipboardCheck },
  { to: "/graduacoes", label: "Graduações", icon: Award },
  // Financeiro é só do MESTRE (backend: RolePermission PROFESSOR/finance = tudo false).
  { to: "/financeiro", label: "Financeiro", icon: Wallet, roles: ["MESTRE"] },
  { to: "/eventos", label: "Eventos", icon: PartyPopper },
  { to: "/rodas", label: "Rodas", icon: CircleDot },
  { to: "/certificados", label: "Certificados", icon: BadgeCheck },
  { to: "/comunicados", label: "Comunicados", icon: Megaphone },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
  // Unidades (backend: recurso `units`, CRUD só do MESTRE) e Configurações (PATCH /organizations/me, só MESTRE):
  // ficam só para o MESTRE no menu.
  { to: "/unidades", label: "Unidades", icon: Building2, roles: ["MESTRE"] },
  { to: "/configuracoes", label: "Configurações", icon: Settings, roles: ["MESTRE"] },
];

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
