import {
  Award,
  CalendarCheck,
  CalendarDays,
  CircleDot,
  Dumbbell,
  Flame,
  Hand,
  Hourglass,
  Route,
  ScrollText,
  Star,
  Target,
  type LucideIcon,
} from "lucide-react";
import { capitalize } from "@/lib/format";
import type { AchievementTier, PointType } from "@/lib/ranking-student";

/**
 * Ícones (lucide, sem emoji) e rótulos do Ginga Rank do aluno. Conquistas: chave `icon` do servidor (presenca, sequencia, mes,
 * rodas, eventos, jornada, tempo, diario) com a família como segunda tentativa e um ícone neutro por último.
 */

const ACHIEVEMENT_ICON: Record<string, LucideIcon> = {
  presenca: Dumbbell,
  sequencia: Flame,
  mes: CalendarCheck,
  rodas: CircleDot,
  eventos: CalendarDays,
  jornada: Route,
  tempo: Hourglass,
  diario: Hand,
};

export function achievementIconFor(icon: string, family: string): LucideIcon {
  return ACHIEVEMENT_ICON[icon.toLowerCase()] ?? ACHIEVEMENT_ICON[family.toLowerCase()] ?? Award;
}

const FAMILY_LABEL: Record<string, string> = {
  PRESENCA: "Presença",
  SEQUENCIA: "Sequência",
  MES: "Mês",
  RODAS: "Rodas",
  EVENTOS: "Eventos",
  JORNADA: "Jornada",
  TEMPO: "Tempo de casa",
  DIARIO: "Check-in diário",
};

export const familyLabel = (family: string): string => FAMILY_LABEL[family.toUpperCase()] ?? capitalize(family.toLowerCase().replace(/_/g, " "));

/** Nível da medalha: sempre um RÓTULO em texto (não só cor) + a classe de cor. */
export const TIER_LABEL: Record<AchievementTier, string> = { BRONZE: "Bronze", SILVER: "Prata", GOLD: "Ouro" };

export const tierClass = (tier: AchievementTier | null): string => (tier ? `is-${tier.toLowerCase()}` : "is-plain");

const POINT_ICON: Record<PointType, LucideIcon> = {
  CLASS_ATTENDANCE: Dumbbell,
  STREAK_BONUS: Flame,
  EVENT_ATTENDANCE: CalendarDays,
  RODA_PARTICIPATION: CircleDot,
  MONTHLY_CONSISTENCY: Target,
  GRADUATION: Award,
  CERTIFICATE: ScrollText,
  DAILY_CHECKIN: Hand,
  DAILY_WEEK_BONUS: CalendarCheck,
};

export const pointIconFor = (type: string): LucideIcon => POINT_ICON[type as PointType] ?? Star;
