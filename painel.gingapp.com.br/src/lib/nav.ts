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
  { to: "/financeiro", label: "Financeiro", icon: Wallet },
  { to: "/eventos", label: "Eventos", icon: PartyPopper },
  { to: "/rodas", label: "Rodas", icon: CircleDot },
  { to: "/certificados", label: "Certificados", icon: BadgeCheck },
  { to: "/comunicados", label: "Comunicados", icon: Megaphone },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
  // Unidades/Configurações não têm RBAC no backend (sem @CanAccess): ficam só para o MESTRE na UI.
  { to: "/unidades", label: "Unidades", icon: Building2, roles: ["MESTRE"] },
  { to: "/configuracoes", label: "Configurações", icon: Settings, roles: ["MESTRE"] },
];

export function navItemsFor(role: OrgRole | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.roles || (role !== undefined && item.roles.includes(role)));
}
