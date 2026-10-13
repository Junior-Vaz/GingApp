import {
  Award,
  BookOpen,
  ClipboardCheck,
  Crown,
  Drum,
  Flame,
  Gem,
  GraduationCap,
  Hand,
  Heart,
  Medal,
  Music,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trophy,
  UserCheck,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { StaffRole } from "@/lib/session";

/**
 * Cargos por grupo (Ficha única). Cada grupo cria os seus cargos (nome, cor, ícone e rank — maior = mais sênior);
 * o cargo tem um PERFIL DE ACESSO (`accessRole`) que define as permissões. O `role` de /auth/me continua sendo o
 * papel de ACESSO: gates de permissão do app não mudam. Este arquivo é a SSOT de tipos e helpers de cargo.
 */
export interface Badge {
  id: number;
  name: string;
  slug: string;
  /** Hex #RRGGBB; ausente = selo neutro. */
  color: string | null;
  /** Nome lucide em kebab-case (ver ROLE_ICONS); ausente/desconhecido = sem ícone. */
  icon: string | null;
  accessRole: StaffRole;
  rank: number;
}

/** Ordem de acesso (maior primeiro): MESTRE > PROFESSOR > INSTRUTOR > MONITOR. Também resolve cargos legados (string[]). */
export const STAFF_ROLE_ORDER: StaffRole[] = ["MESTRE", "PROFESSOR", "INSTRUTOR", "MONITOR"];

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  MESTRE: "Mestre",
  PROFESSOR: "Professor",
  INSTRUTOR: "Instrutor",
  MONITOR: "Monitor",
};

export const isStaffRole = (value: unknown): value is StaffRole =>
  typeof value === "string" && (STAFF_ROLE_ORDER as string[]).includes(value);

/** Ícones lucide aceitos pelo contrato (nome kebab -> componente). */
export const ROLE_ICONS: Record<string, LucideIcon> = {
  crown: Crown,
  "graduation-cap": GraduationCap,
  award: Award,
  "clipboard-check": ClipboardCheck,
  medal: Medal,
  trophy: Trophy,
  star: Star,
  shield: Shield,
  "shield-check": ShieldCheck,
  gem: Gem,
  flame: Flame,
  sparkles: Sparkles,
  music: Music,
  drum: Drum,
  hand: Hand,
  heart: Heart,
  zap: Zap,
  target: Target,
  "book-open": BookOpen,
  "user-check": UserCheck,
  users: Users,
};

/** Ícone do cargo pelo nome kebab; sem nome ou desconhecido = null (o selo aparece só com o texto). */
export const roleIcon = (name: string | null | undefined): LucideIcon | null => (name ? (ROLE_ICONS[name] ?? null) : null);

const HEX = /^#[0-9a-f]{6}$/i;

/** Cor válida (#RRGGBB) ou null. */
export const validColor = (value: unknown): string | null => (typeof value === "string" && HEX.test(value.trim()) ? value.trim() : null);

/**
 * Estilo do selo: fundo na cor do cargo e texto preto/branco conforme a luminância (legível em qualquer cor).
 * Sem cor: undefined (o selo neutro usa a classe `.badge`).
 */
export function badgeStyle(color: string | null | undefined): { backgroundColor: string; color: string } | undefined {
  const hex = validColor(color);
  if (!hex) return undefined;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return { backgroundColor: hex, color: luminance > 0.6 ? "#111111" : "#ffffff" };
}

/** Ranks dos 4 cargos padrão, usados só para converter respostas antigas (string[]) em Badge. */
const LEGACY_RANK: Record<StaffRole, number> = { MESTRE: 400, PROFESSOR: 300, INSTRUTOR: 200, MONITOR: 100 };

/** Converte um papel de acesso legado ("PROFESSOR") em Badge com nome capitalizado e sem cor/ícone. */
export function legacyBadge(role: StaffRole): Badge {
  return {
    id: -(STAFF_ROLE_ORDER.indexOf(role) + 1),
    name: STAFF_ROLE_LABEL[role],
    slug: role.toLowerCase(),
    color: null,
    icon: null,
    accessRole: role,
    rank: LEGACY_RANK[role],
  };
}

/**
 * Aceita Badge (contrato novo) ou string legada ("PROFESSOR"); qualquer outra coisa vira null.
 * Defensivo: campos ausentes ou inválidos caem em padrões neutros em vez de quebrar a tela.
 */
export function toBadge(value: unknown): Badge | null {
  if (typeof value === "string") return isStaffRole(value) ? legacyBadge(value) : null;
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const name = typeof v["name"] === "string" ? v["name"].trim() : "";
  if (!name) return null;
  const accessRole = isStaffRole(v["accessRole"]) ? v["accessRole"] : "MONITOR";
  const slug = typeof v["slug"] === "string" && v["slug"] ? v["slug"] : name.toLowerCase();
  return {
    id: typeof v["id"] === "number" ? v["id"] : 0,
    name,
    slug,
    color: validColor(v["color"]),
    icon: typeof v["icon"] === "string" && v["icon"] ? v["icon"] : null,
    accessRole,
    rank: typeof v["rank"] === "number" && Number.isFinite(v["rank"]) ? v["rank"] : LEGACY_RANK[accessRole],
  };
}

/** Normaliza uma lista de cargos: descarta inválidos e repetidos (por slug) e ordena do maior rank para o menor. */
export function normalizeBadges(value: unknown): Badge[] {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const badges: Badge[] = [];
  for (const item of list) {
    const badge = toBadge(item);
    if (!badge || seen.has(badge.slug)) continue;
    seen.add(badge.slug);
    badges.push(badge);
  }
  return badges.sort((a, b) => b.rank - a.rank);
}

/** Selo principal = o de maior rank. Quem não tem cargo é só aluno (ou responsável). */
export const primaryBadge = (badges: Badge[]): Badge | null => normalizeBadges(badges)[0] ?? null;

/**
 * URL do painel do grupo (onde mestres/professores/instrutores/monitores gerenciam).
 * Embutida no build via VITE_PAINEL_URL; sem ela, usa o painel de produção.
 */
export const PAINEL_URL: string =
  (import.meta.env["VITE_PAINEL_URL"] as string | undefined)?.trim() || "https://painel.gingapp.com.br";
