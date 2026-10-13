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

/** Ícones permitidos nos cargos (nome lucide em kebab-case, igual ao validado pelo backend). */
export const ROLE_ICONS: Readonly<Record<string, LucideIcon>> = {
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

export const ROLE_ICON_NAMES: readonly string[] = Object.keys(ROLE_ICONS);

/** Ícone do cargo pelo nome kebab; `null` quando não há ícone (ou o nome é desconhecido). */
export function roleIcon(name: string | null | undefined): LucideIcon | null {
  return name ? (ROLE_ICONS[name] ?? null) : null;
}

/** Paleta sugerida no editor de cargos (os quatro padrões + mais seis). */
export const ROLE_COLOR_PALETTE: readonly { value: string; label: string }[] = [
  { value: "#B45309", label: "Âmbar" },
  { value: "#1D4ED8", label: "Azul" },
  { value: "#047857", label: "Verde" },
  { value: "#7C3AED", label: "Violeta" },
  { value: "#BE123C", label: "Vermelho" },
  { value: "#0E7490", label: "Ciano" },
  { value: "#C2410C", label: "Laranja" },
  { value: "#A21CAF", label: "Magenta" },
  { value: "#334155", label: "Grafite" },
  { value: "#CA8A04", label: "Ouro" },
];

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Cor de texto legível (preto/branco) sobre o fundo `hex` (#RRGGBB), pela luminância relativa. */
export function readableTextColor(hex: string): string {
  if (!HEX_COLOR.test(hex)) return "#ffffff";
  const channel = (start: number) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.4 ? "#111827" : "#ffffff";
}
