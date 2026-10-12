import { ArrowDown, ArrowUp, Medal, Minus, Sparkles, Trophy } from "lucide-react";
import { StudentAvatar } from "@/components/painel/student-avatar";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  deltaInfo,
  formatPoints,
  leagueColor,
  readableTextColor,
  seasonLabel,
  type RankingLevel,
  type RankingStudent,
  type SeasonSummary,
} from "./ranking-api";

/** Selo colorido da liga (Crua, Verde, Amarela, Azul, Roxa, Marrom, Preta). */
export function LeagueBadge({ level }: { level: RankingLevel }) {
  const color = leagueColor(level);
  return (
    <span
      data-testid="league-badge"
      data-league={level.code}
      className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: color, borderColor: color, color: readableTextColor(color) }}
    >
      {level.name}
    </span>
  );
}

/** Avatar do aluno com anel da cor da liga. */
export function RankAvatar({ student, className }: { student: RankingStudent; className?: string }) {
  const color = leagueColor(student.level);
  return (
    <span
      data-testid="rank-avatar-ring"
      className="inline-flex shrink-0 rounded-full p-0.5"
      style={{ boxShadow: `0 0 0 2px ${color}` }}
    >
      <StudentAvatar name={student.displayName} photo={student.avatarUrl} {...(className ? { className } : {})} />
    </span>
  );
}

/** Variação de posição: seta verde (subiu), vermelha (caiu), traço (manteve) ou "Novo". */
export function DeltaCell({ delta }: { delta: number | null | undefined }) {
  const info = deltaInfo(delta);
  if (info.kind === "new") {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground"
        title={info.label}
        aria-label={info.label}
        data-delta="new"
      >
        <Sparkles className="size-3.5" aria-hidden="true" /> Novo
      </span>
    );
  }
  const Icon = info.kind === "up" ? ArrowUp : info.kind === "down" ? ArrowDown : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-sm font-semibold",
        info.kind === "up" && "text-emerald-600",
        info.kind === "down" && "text-destructive",
        info.kind === "same" && "text-muted-foreground",
      )}
      title={info.label}
      aria-label={info.label}
      data-delta={info.kind}
    >
      <Icon className="size-4" aria-hidden="true" />
      {info.kind !== "same" && info.amount}
    </span>
  );
}

const MEDAL_STYLE = [
  { label: "1º lugar", color: "#CA8A04", icon: Trophy },
  { label: "2º lugar", color: "#6B7280", icon: Medal },
  { label: "3º lugar", color: "#B45309", icon: Medal },
] as const;

/** Pódio simples: os 3 primeiros (1º no centro em telas largas). */
export function Podium({ students }: { students: RankingStudent[] }) {
  const top = students.slice(0, 3);
  if (top.length === 0) return null;
  // Em telas largas: 2º, 1º, 3º (o 1º no meio); no celular segue a ordem natural.
  const order = top.length === 3 ? [1, 0, 2] : top.map((_, i) => i);
  return (
    <div className="grid gap-3 sm:grid-cols-3 sm:items-end" data-testid="ranking-podium">
      {order.map((index) => {
        const student = top[index]!;
        const medal = MEDAL_STYLE[index]!;
        const Icon = medal.icon;
        return (
          <Card
            key={student.studentId}
            data-testid="podium-card"
            className={cn(
              "items-center gap-2 p-4 text-center",
              index === 0 && "sm:pb-8",
              student.isMe && "border-primary",
            )}
          >
            <Icon className="size-7" style={{ color: medal.color }} aria-label={medal.label} />
            <RankAvatar student={student} className="size-14 text-base" />
            <p className="max-w-full truncate text-sm font-bold">{student.displayName}</p>
            <LeagueBadge level={student.level} />
            <p className="font-display text-xl font-extrabold">
              {formatPoints(student.points)} <span className="text-xs font-medium text-muted-foreground">pts</span>
            </p>
          </Card>
        );
      })}
    </div>
  );
}

/** "Campeões das temporadas": campeão do grupo e do Brasil em cada mês anterior. */
export function SeasonChampions({ seasons }: { seasons: SeasonSummary[] }) {
  if (seasons.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma temporada encerrada ainda.</p>;
  }
  return (
    <ul className="divide-y" data-testid="season-champions">
      {seasons.map((s) => (
        <li key={s.season} className="grid gap-1 py-3 text-sm sm:grid-cols-[10rem_1fr_1fr] sm:gap-4">
          <span className="font-semibold capitalize">{seasonLabel(s.season)}</span>
          <span>
            <span className="text-muted-foreground">Campeão do grupo: </span>
            {s.champions.group ? (
              <strong>
                {s.champions.group.displayName} ({formatPoints(s.champions.group.points)} pts)
              </strong>
            ) : (
              "-"
            )}
          </span>
          <span>
            <span className="text-muted-foreground">Campeão do Brasil: </span>
            {s.champions.country ? (
              <strong>
                {s.champions.country.displayName} ({formatPoints(s.champions.country.points)} pts)
              </strong>
            ) : (
              "-"
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
