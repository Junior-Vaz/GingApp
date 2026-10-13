import { useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Award,
  CalendarDays,
  CircleDot,
  Crown,
  Dumbbell,
  Flame,
  Heart,
  Lock,
  Medal,
  Minus,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trophy,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useIsMobile } from "@/hooks/use-mobile";
import { ApiError, errorMessage } from "@/lib/api";
import { dayOnly, fmt, toDate } from "@/lib/format";
import { plural } from "@/lib/plural";
import {
  LEAGUES,
  formatPoints,
  leagueColor,
  useSaveRankingSettings,
  type GroupRankItem,
  type RankLevel,
  type RankSettings,
  type RankingMe,
  type StudentRankItem,
} from "@/lib/ranking";
import { Avatar } from "./avatar";
import { useMyIdentity } from "@/lib/queries";

const cssVars = (vars: Record<string, string | number>) => vars as CSSProperties;

/* ---------- Avatar, selo da liga, logo ---------- */

/**
 * Avatar do ranking: o Avatar único do app com o ANEL na cor da liga (ou a moldura metálica do pódio, `frame`)
 * e o selo redondo do grupo no canto inferior direito (por cima do anel) quando houver dado do grupo.
 */
export function RankAvatar({
  name,
  url,
  color,
  frame,
  size,
  badgeLetters,
  groupName,
  groupLogoUrl,
}: {
  name: string;
  url: string | null;
  color: string;
  frame?: boolean;
  size: number | string;
  badgeLetters?: 1 | 2;
  groupName?: string | null | undefined;
  groupLogoUrl?: string | null | undefined;
}) {
  return (
    <Avatar
      decorative
      name={name}
      src={url}
      size={size}
      {...(badgeLetters ? { badgeLetters } : {})}
      {...(frame ? { frame: true } : { ringColor: color })}
      groupName={groupName}
      groupLogoUrl={groupLogoUrl}
    />
  );
}

/** Selo da liga: bolinha na cor + nome. */
export function LeagueSeal({ level, className = "" }: { level: RankLevel; className?: string }) {
  return (
    <span className={`rk-seal ${className}`} style={cssVars({ "--lg": leagueColor(level) })} data-testid="rk-seal">
      <i aria-hidden="true" />
      {level.name}
    </span>
  );
}

/** Seta de subiu/desceu (rankDelta > 0 = subiu posicoes). */
export function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="rk-delta is-none" aria-label="Sem comparação">–</span>;
  if (value > 0)
    return (
      <span className="rk-delta is-up" aria-label={`Subiu ${value} ${value === 1 ? "posição" : "posições"}`}>
        <ArrowUp aria-hidden="true" />
        {value}
      </span>
    );
  if (value < 0)
    return (
      <span className="rk-delta is-down" aria-label={`Desceu ${-value} ${value === -1 ? "posição" : "posições"}`}>
        <ArrowDown aria-hidden="true" />
        {-value}
      </span>
    );
  return (
    <span className="rk-delta is-same" aria-label="Manteve a posição">
      <Minus aria-hidden="true" />
    </span>
  );
}

/* ---------- Podio ---------- */

export interface PodiumEntry {
  key: string;
  rank: number;
  name: string;
  /** Linha abaixo do nome (grupo / cidade). */
  sub: string;
  /** Grupo da pessoa (selo redondo no avatar); ausente = sem selo. */
  groupName?: string | null;
  groupLogoUrl?: string | null;
  imageUrl: string | null;
  color: string;
  points: number;
  seal: ReactNode;
  isMe: boolean;
  /** Selo de destaque quando e o proprio ("Você" / "Meu grupo"). */
  meLabel?: string;
}

const FRAME: Record<number, string> = { 1: "#F5C242", 2: "#C3CAD4", 3: "#CD7F32" };
const MEDAL_LABEL: Record<number, string> = { 1: "1º lugar", 2: "2º lugar", 3: "3º lugar" };

/** Os 3 primeiros em degraus de alturas diferentes (2º | 1º | 3º), com coroa e molduras ouro/prata/bronze. */
export function Podium({ entries }: { entries: PodiumEntry[] }) {
  return (
    <ol className="rk-podium" data-testid="rk-podium" aria-label="Pódio">
      {[0, 1, 2].map((index) => {
        const slot = index + 1;
        const entry = entries[index];
        if (!entry) {
          return (
            <li key={`empty-${slot}`} className={`rk-pod is-${slot} is-empty`} style={cssVars({ "--frame": FRAME[slot] ?? "#ccc" })}>
              <span className="rk-frame-empty" aria-hidden="true">
                <Trophy />
              </span>
              <span className="rk-pod-sub">Vaga aberta</span>
              <div className="rk-step">
                <span className="rk-step-num">{slot}º</span>
              </div>
            </li>
          );
        }
        return (
          <li
            key={entry.key}
            className={`rk-pod is-${slot} ${entry.isMe ? "is-me" : ""}`}
            style={cssVars({ "--frame": FRAME[slot] ?? "#ccc", "--lg": entry.color })}
            data-testid="rk-pod"
            aria-label={`${MEDAL_LABEL[slot]}: ${entry.name}, ${formatPoints(entry.points)} pontos`}
          >
            {slot === 1 && <Crown className="rk-crown" aria-hidden="true" />}
            <RankAvatar frame size="var(--size)" badgeLetters={2} name={entry.name} url={entry.imageUrl} color={entry.color} groupName={entry.groupName} groupLogoUrl={entry.groupLogoUrl} />
            <strong className="rk-pod-name">{entry.name}</strong>
            {entry.isMe && <span className="rk-you">{entry.meLabel ?? "Você"}</span>}
            <span className="rk-pod-sub">
              <span>{entry.sub}</span>
            </span>
            {entry.seal}
            <div className="rk-step">
              <span className="rk-step-num">{entry.rank}º</span>
              <span className="rk-step-pts">{formatPoints(entry.points)} pts</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function studentPodiumEntry(item: StudentRankItem): PodiumEntry {
  return {
    key: `s-${item.studentId}`,
    rank: item.rank,
    name: item.displayName,
    sub: item.groupName,
    groupName: item.groupName,
    groupLogoUrl: item.groupLogoUrl,
    imageUrl: item.avatarUrl,
    color: leagueColor(item.level),
    points: item.points,
    seal: <LeagueSeal level={item.level} />,
    isMe: item.isMe,
  };
}

function groupPodiumEntry(item: GroupRankItem): PodiumEntry {
  return {
    key: `g-${item.groupId}`,
    rank: item.rank,
    name: item.name,
    sub: [item.city, item.state].filter(Boolean).join(" - ") || "Grupo",
    imageUrl: item.logoUrl,
    color: "#1b5e43",
    points: item.totalPoints,
    seal: (
      <span className="rk-seal" style={cssVars({ "--lg": "#1b5e43" })}>
        <Users aria-hidden="true" />
        {plural(item.studentsCount, "aluno")}
      </span>
    ),
    isMe: item.isMine,
    meLabel: "Meu grupo",
  };
}

export function StudentsPodium({ items }: { items: StudentRankItem[] }) {
  return <Podium entries={items.slice(0, 3).map(studentPodiumEntry)} />;
}

export function GroupsPodium({ items }: { items: GroupRankItem[] }) {
  return <Podium entries={items.slice(0, 3).map(groupPodiumEntry)} />;
}

/* ---------- Linhas da lista ---------- */

export function StudentRow({ item, index }: { item: StudentRankItem; index: number }) {
  const color = leagueColor(item.level);
  const place = [item.city, item.state].filter(Boolean).join(" - ");
  return (
    <li
      className={`rk-item ${item.isMe ? "is-me" : ""}`}
      style={cssVars({ "--lg": color, "--i": Math.min(index, 12) })}
      data-testid="rk-row"
      aria-current={item.isMe ? "true" : undefined}
    >
      <div className="rk-pos">
        <strong>{item.rank}</strong>
        <Delta value={item.rankDelta} />
      </div>
      <RankAvatar size="var(--rk-av)" name={item.displayName} url={item.avatarUrl} color={color} groupName={item.groupName} groupLogoUrl={item.groupLogoUrl} />
      <div className="rk-who">
        <strong>
          {item.displayName}
          {item.isMe && <span className="rk-you">Você</span>}
        </strong>
        <span className="rk-group">
          <span>
            {item.groupName}
            {place ? ` · ${place}` : ""}
          </span>
        </span>
      </div>
      <div className="rk-pts">
        <strong>{formatPoints(item.points)}</strong>
        <span>pts</span>
        <LeagueSeal level={item.level} className="rk-hide-sm" />
      </div>
    </li>
  );
}

export function GroupRow({ item, index }: { item: GroupRankItem; index: number }) {
  const place = [item.city, item.state].filter(Boolean).join(" - ");
  return (
    <li
      className={`rk-item is-group ${item.isMine ? "is-me" : ""}`}
      style={cssVars({ "--lg": "#1b5e43", "--i": Math.min(index, 12) })}
      data-testid="rk-group-row"
      aria-current={item.isMine ? "true" : undefined}
    >
      <div className="rk-pos">
        <strong>{item.rank}</strong>
      </div>
      <RankAvatar size="var(--rk-av)" name={item.name} url={item.logoUrl} color="#1b5e43" />
      <div className="rk-who">
        <strong>
          {item.name}
          {item.isMine && (
            <span className="rk-you">
              <Star aria-hidden="true" /> Meu grupo
            </span>
          )}
        </strong>
        <span className="rk-group">
          <span>
            {place || "Brasil"} · {plural(item.studentsCount, "aluno")} · média{" "}
            {formatPoints(Math.round(item.avgPoints))} pts/aluno
          </span>
        </span>
      </div>
      <div className="rk-pts">
        <strong>{formatPoints(item.totalPoints)}</strong>
        <span>pts</span>
      </div>
    </li>
  );
}

/** Linhas-fantasma enquanto carrega. */
export function RankSkeleton() {
  return (
    <div data-testid="rk-skeleton" aria-busy="true" aria-label="Carregando ranking">
      <div className="rk-podium rk-skel-podium" aria-hidden="true">
        {[104, 132, 84].map((height, i) => (
          <div key={i} className="rk-pod">
            <span className="rk-skel rk-skel-circle" />
            <span className="rk-skel rk-skel-line" />
            <span className="rk-skel rk-skel-step" style={{ height }} />
          </div>
        ))}
      </div>
      <ul className="rk-list" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i} className="rk-item">
            <span className="rk-skel rk-skel-line" style={{ width: 28 }} />
            <span className="rk-skel rk-skel-circle sm" />
            <span className="rk-skel rk-skel-line" style={{ width: "60%" }} />
            <span className="rk-skel rk-skel-line" style={{ width: 54 }} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Confete (CSS puro) ---------- */

const CONFETTI_COLORS = [...LEAGUES.map((l) => l.color).filter((c) => c !== "#111827"), "#F5C242", "#1b5e43"];

export function Confetti() {
  const pieces = Array.from({ length: 42 }, (_, i) => ({
    x: ((i * 37) % 100) + (i % 3) * 0.7,
    dx: ((i * 53) % 160) - 80,
    delay: (i % 14) * 0.09,
    time: 2.4 + ((i * 7) % 10) / 10,
    rotate: (i * 47) % 360,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length] ?? "#22C55E",
  }));
  return (
    <div className="rk-confetti" data-testid="rk-confetti" aria-hidden="true">
      {pieces.map((piece, i) => (
        <span
          key={i}
          style={cssVars({
            "--x": `${piece.x}%`,
            "--dx": `${piece.dx}px`,
            "--d": `${piece.delay}s`,
            "--t": `${piece.time}s`,
            "--r": `${piece.rotate}deg`,
            "--c": piece.color,
          })}
        />
      ))}
    </div>
  );
}

/* ---------- Conquistas ---------- */

const ACHIEVEMENT_ICONS: LucideIcon[] = [Award, Flame, Star, Medal, Target, Zap, Heart, Crown];

function achievementIcon(code: string): LucideIcon {
  const key = code.toUpperCase();
  if (/STREAK|SEQ|SEMANA/.test(key)) return Flame;
  if (/RODA/.test(key)) return CircleDot;
  if (/EVENT|BATIZ/.test(key)) return CalendarDays;
  if (/TREIN|AULA|FREQ|TRAIN/.test(key)) return Dumbbell;
  if (/FIRST|PRIMEIR|ESTREIA/.test(key)) return Sparkles;
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ACHIEVEMENT_ICONS[hash % ACHIEVEMENT_ICONS.length] ?? Award;
}

interface BadgeInfo {
  code: string;
  name: string;
  description: string;
  earnedAt: string | null;
}

function AchievementBadge({ badge, onOpen }: { badge: BadgeInfo; onOpen: (badge: BadgeInfo) => void }) {
  const Icon = achievementIcon(badge.code);
  const earned = badge.earnedAt !== null;
  return (
    <button
      type="button"
      className={`rk-badge ${earned ? "is-earned" : "is-locked"}`}
      onClick={() => onOpen(badge)}
      aria-label={`${badge.name}${earned ? " (conquistada)" : " (ainda não conquistada)"}`}
      data-testid={earned ? "rk-badge-earned" : "rk-badge-locked"}
    >
      <span className="rk-badge-icon">
        <Icon aria-hidden="true" />
        {!earned && <Lock className="rk-badge-lock" aria-hidden="true" />}
      </span>
      <span className="rk-badge-name">{badge.name}</span>
    </button>
  );
}

/** Data "só dia" (meia-noite UTC) vira o mesmo dia civil local; um instante real usa o horário local. */
function earnedDate(iso: string): string {
  return fmt(/T00:00:00(\.0+)?Z$/.test(iso) ? dayOnly(iso) : toDate(iso), "dd/MM/yyyy");
}

function AchievementDialog({ badge, onClose }: { badge: BadgeInfo | null; onClose: () => void }) {
  const Icon = badge ? achievementIcon(badge.code) : Award;
  const earned = badge?.earnedAt != null;
  return (
    <Dialog open={badge !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rk-dialog">
        {badge && (
          <>
            <div className={`rk-badge-big ${earned ? "is-earned" : "is-locked"}`}>
              <Icon aria-hidden="true" />
            </div>
            <DialogTitle className="text-center">{badge.name}</DialogTitle>
            <DialogDescription className="text-center">
              {earned && badge.earnedAt ? `Conquistada em ${earnedDate(badge.earnedAt)}` : "Ainda não conquistada"}
            </DialogDescription>
            <p className="rk-dialog-text">
              {earned ? badge.description : `Como conquistar: ${badge.description}`}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Seu progresso ---------- */

export function ProgressCard({ me, onConfigure }: { me: RankingMe; onConfigure: () => void }) {
  const [badge, setBadge] = useState<BadgeInfo | null>(null);
  const identity = useMyIdentity();
  const color = leagueColor(me.level);
  const next = me.nextLevel;
  const nextColor = next ? leagueColor(next) : color;
  const pct = Math.max(0, Math.min(100, Math.round(me.progressPct)));
  const toNext = me.pointsToNext ?? 0;
  const earned: BadgeInfo[] = me.achievements.map((a) => ({ ...a }));
  const locked: BadgeInfo[] = me.availableAchievements.map((a) => ({ ...a, earnedAt: null }));
  const positions = [
    { label: "Grupo", value: me.rank.group },
    { label: "Cidade", value: me.rank.city },
    { label: "Estado", value: me.rank.state },
    { label: "Brasil", value: me.rank.country },
  ];

  return (
    <section className="rk-card rk-progress" aria-label="Seu progresso" data-testid="rk-progress" style={cssVars({ "--lg": color, "--next": nextColor })}>
      <div className="rk-me-top">
        <RankAvatar size={64} name={me.student.displayName} url={me.student.avatarUrl} color={color} groupName={identity.groupName} groupLogoUrl={identity.groupLogoUrl} />
        <div className="rk-me-id">
          <span className="rk-eyebrow">Seu progresso</span>
          <strong>{me.student.displayName}</strong>
          <LeagueSeal level={me.level} />
        </div>
      </div>

      <div className="rk-next">
        {next ? (
          <>
            <div className="rk-next-line">
              <span>
                {`falta${toNext === 1 ? "" : "m"} ${formatPoints(toNext)} ${toNext === 1 ? "ponto" : "pontos"} para `}
                <strong style={cssVars({ "--lg": nextColor })} className="rk-next-name">
                  {next.name.toLocaleUpperCase("pt-BR")}
                </strong>
              </span>
              <b>{pct}%</b>
            </div>
            <div className="rk-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progresso até a próxima liga">
              <div className="rk-bar-fill" style={cssVars({ "--pct": `${pct}%` })} />
            </div>
          </>
        ) : (
          <p className="rk-maxed">
            <Crown aria-hidden="true" /> Você chegou à liga máxima. Axé!
          </p>
        )}
      </div>

      <div className="rk-pos-grid" aria-label="Sua posição">
        {positions.map((p) => (
          <div key={p.label} className="rk-pos-tile">
            <span>{p.label}</span>
            <strong>{p.value !== null ? `#${p.value}` : "–"}</strong>
          </div>
        ))}
      </div>

      <div className="rk-stats">
        <div>
          <Flame aria-hidden="true" className="is-flame" />
          <strong>{me.streakWeeks}</strong>
          <span>{me.streakWeeks === 1 ? "semana seguida" : "semanas seguidas"}</span>
        </div>
        <div>
          <Trophy aria-hidden="true" />
          <strong>{formatPoints(me.points.season)}</strong>
          <span>pts na temporada</span>
        </div>
        <div>
          <Medal aria-hidden="true" />
          <strong>{formatPoints(me.points.allTime)}</strong>
          <span>pts no total</span>
        </div>
      </div>

      <div className="rk-ach">
        <div className="rk-ach-head">
          <h3>Conquistas</h3>
          <span>
            {earned.length} de {earned.length + locked.length}
          </span>
        </div>
        {earned.length + locked.length === 0 ? (
          <p className="rk-muted">As conquistas aparecem aqui conforme você treina.</p>
        ) : (
          <div className="rk-badges">
            {earned.map((b) => (
              <AchievementBadge key={b.code} badge={b} onOpen={setBadge} />
            ))}
            {locked.map((b) => (
              <AchievementBadge key={b.code} badge={b} onOpen={setBadge} />
            ))}
          </div>
        )}
      </div>

      {!me.settings.optInPublic && (
        <button type="button" className="rk-optin-hint" onClick={onConfigure}>
          Você não aparece nos rankings abertos. <span>Configurar ranking</span>
        </button>
      )}
      <AchievementDialog badge={badge} onClose={() => setBadge(null)} />
    </section>
  );
}

export function ProgressSkeleton() {
  return (
    <section className="rk-card rk-progress" aria-busy="true" aria-label="Carregando seu progresso" data-testid="rk-progress-skeleton">
      <div className="rk-me-top">
        <span className="rk-skel rk-skel-circle" />
        <div style={{ flex: 1, display: "grid", gap: 8 }}>
          <span className="rk-skel rk-skel-line" style={{ width: "70%" }} />
          <span className="rk-skel rk-skel-line" style={{ width: "40%" }} />
        </div>
      </div>
      <span className="rk-skel rk-skel-line" style={{ height: 12, marginTop: 18 }} />
      <span className="rk-skel rk-skel-step" style={{ height: 120, marginTop: 18, borderRadius: 12 }} />
    </section>
  );
}

/* ---------- Configurar ranking ---------- */

const NICKNAME_MAX = 24;

function SettingsForm({ settings, onDone }: { settings: RankSettings; onDone: () => void }) {
  const save = useSaveRankingSettings();
  const [optIn, setOptIn] = useState(settings.optInPublic);
  const [nickname, setNickname] = useState(settings.nickname ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const blocked = !settings.canOptIn;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    try {
      await save.mutateAsync({ optInPublic: optIn, nickname: nickname.trim() === "" ? null : nickname.trim() });
      toast.success("Preferências do ranking salvas!");
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.status === 403 && error.code === "GUARDIAN_CONSENT_REQUIRED") {
        setOptIn(false);
        setProblem(
          "Seu responsável ainda não autorizou. Peça a ele para autorizar que você apareça nos rankings abertos e tente de novo.",
        );
        return;
      }
      setProblem(errorMessage(error, "Não foi possível salvar agora. Tente novamente."));
    }
  }

  return (
    <form className="rk-settings" onSubmit={(event) => void submit(event)}>
      {settings.requiresGuardianConsent && (
        <div className="rk-note" role="note" data-testid="rk-guardian-note">
          <ShieldCheck aria-hidden="true" />
          <div>
            <strong>Autorização do responsável</strong>
            <p>
              Como você é menor de idade, seu responsável precisa autorizar que você apareça nos rankings abertos. Peça a ele
              para liberar pelo app. Enquanto isso, você continua no ranking do seu grupo.
            </p>
          </div>
        </div>
      )}
      <div className="rk-setting-row">
        <div>
          <label htmlFor="rk-optin">Aparecer nos rankings abertos</label>
          <p>Seu nome (ou apelido) e sua posição ficam visíveis nos rankings de cidade, estado e Brasil.</p>
        </div>
        <Switch id="rk-optin" checked={optIn} onCheckedChange={setOptIn} disabled={blocked || save.isPending} />
      </div>
      <div className="rk-setting-field">
        <label htmlFor="rk-nick">Apelido (opcional)</label>
        <Input
          id="rk-nick"
          value={nickname}
          maxLength={NICKNAME_MAX}
          placeholder="Como você quer ser chamado na roda"
          onChange={(event) => setNickname(event.target.value)}
          disabled={save.isPending}
        />
        <p>Aparece no lugar do seu nome nos rankings abertos.</p>
      </div>
      {problem && (
        <p className="rk-problem" role="alert" data-testid="rk-settings-error">
          {problem}
        </p>
      )}
      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? "Salvando…" : "Salvar"}
      </Button>
    </form>
  );
}

export function SettingsSheet({
  open,
  onOpenChange,
  settings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: RankSettings | undefined;
}) {
  const mobile = useIsMobile();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={mobile ? "bottom" : "right"} className="rk-sheet">
        <SheetHeader>
          <SheetTitle>Configurar ranking</SheetTitle>
          <SheetDescription>Escolha como você aparece no Ginga Rank.</SheetDescription>
        </SheetHeader>
        {settings ? (
          <SettingsForm key={`${settings.optInPublic}-${settings.nickname ?? ""}`} settings={settings} onDone={() => onOpenChange(false)} />
        ) : (
          <p className="rk-muted">Carregando suas preferências…</p>
        )}
      </SheetContent>
    </Sheet>
  );
}
