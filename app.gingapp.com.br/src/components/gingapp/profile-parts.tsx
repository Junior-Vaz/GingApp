import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Camera,
  ChevronRight,
  Download,
  Flame,
  ImagePlus,
  Pencil,
  Sprout,
  Trophy,
  CalendarCheck,
  Award,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { plural } from "@/lib/plural";
import { formatPoints, leagueColor, useRankingMe } from "@/lib/ranking";
import { useAttendance, useGraduations, useMyStudent, usePassport, type Student } from "@/lib/queries";
import { useImage } from "@/lib/use-image";
import { useInstall } from "@/lib/install";
import type { Badge } from "@/lib/roles";
import { Avatar } from "./avatar";
import { RoleBadges } from "./roles";
import { Rope } from "./rope";
import { InstallHelp } from "./onboarding/install-guide";

/* ------------------------------------------------------------------------------------------------
 * Blocos visuais do Perfil (prefixo `pf-` em styles.css). Sem lógica de negócio nova: os dados vêm dos
 * hooks que o app já usa (passaporte, graduações, frequência, ranking) e do aluno ativo (seletor).
 * ---------------------------------------------------------------------------------------------- */

/** Cabeçalho de cartão: ícone em ladrilho + título (h2). */
export function CardHeader({ icon: Icon, title, id, aside }: { icon: LucideIcon; title: string; id?: string; aside?: ReactNode }) {
  return (
    <div className="pf-card-head">
      <span className="pf-ico" aria-hidden="true">
        <Icon />
      </span>
      <h2 id={id}>{title}</h2>
      {aside && <span className="pf-card-aside">{aside}</span>}
    </div>
  );
}

/**
 * Cartão de seção do Perfil. `flat` = o conteúdo já traz o próprio título (componentes legados): o título interno
 * some (CSS) e vale o do cabeçalho do cartão, que o nomeia por aria-labelledby.
 */
export function ProfileCard({
  icon,
  title,
  id,
  aside,
  flat = false,
  className = "",
  children,
  testId,
}: {
  icon: LucideIcon;
  title: string;
  id: string;
  aside?: ReactNode;
  flat?: boolean;
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className={`pf-card ${flat ? "pf-flat" : ""} ${className}`.trim()} aria-labelledby={id} data-testid={testId}>
      <CardHeader icon={icon} title={title} id={id} aside={aside} />
      <div className="pf-card-body">{children}</div>
    </section>
  );
}

/** Linha de atalho (ícone, título, dica, selo opcional e seta). Alvo de toque >= 56px. */
export function LinkRow({
  to,
  icon: Icon,
  label,
  hint,
  count,
}: {
  to: "/jornada" | "/ranking" | "/frequencia" | "/financeiro" | "/termos" | "/privacidade";
  icon: LucideIcon;
  label: string;
  hint?: string;
  count?: number;
}) {
  return (
    <Link to={to} className="pf-link-row">
      <Icon className="pf-row-ico" aria-hidden="true" />
      <span className="pf-row-text">
        <strong>{label}</strong>
        {hint && <span>{hint}</span>}
      </span>
      {count !== undefined && count > 0 && <span className="pill-count">{count > 9 ? "9+" : count}</span>}
      <ChevronRight className="pf-row-chevron" aria-hidden="true" />
    </Link>
  );
}

/* ---------------------------------------- HERO ---------------------------------------- */

export interface ProfileHeroProps {
  name: string;
  nickname: string | null;
  photo: string | null;
  coverPhoto: string | null;
  groupName: string | null;
  groupLogoUrl: string | null;
  unitName: string | null;
  baseRole: string;
  roles: Badge[];
  /** Pode editar foto/capa/redes (conta com perfil de aluno próprio). */
  canEdit: boolean;
  onEdit: () => void;
  onChangePhoto: () => void;
  /** Logo abaixo do grupo (ex.: ícones das redes sociais). */
  extra?: ReactNode;
  /** Rodapé do cartão do hero (ex.: chips de dependente). */
  footer?: ReactNode;
}

/** Faixa de capa + avatar grande com selo do grupo + nome, apelido, cargos e grupo. */
export function ProfileHero({ name, nickname, photo, coverPhoto, groupName, groupLogoUrl, unitName, baseRole, roles, canEdit, onEdit, onChangePhoto, extra, footer }: ProfileHeroProps) {
  const cover = useImage(coverPhoto);
  const place = [groupName, unitName].filter(Boolean).join(" · ");
  return (
    <header className="pf-hero" data-testid="profile-hero">
      <div className={`pf-cover ${cover.src ? "has-image" : ""}`} data-testid="profile-cover">
        {cover.src && <img src={cover.src} alt="" onError={cover.onError} />}
        {canEdit && (
          <button type="button" className="pf-cover-btn" onClick={onEdit} aria-label="Trocar foto de capa">
            <ImagePlus aria-hidden="true" />
            <span>Capa</span>
          </button>
        )}
      </div>
      <div className="pf-hero-body">
        <div className="pf-avatar-wrap">
          <Avatar name={name} src={photo} size={104} groupName={groupName} groupLogoUrl={groupLogoUrl} badgeLetters={2} />
          {canEdit && (
            <button type="button" className="pf-cam" onClick={onChangePhoto} aria-label="Trocar foto do perfil">
              <Camera aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="pf-who">
          <h2 className="pf-name" data-testid="profile-name">
            {name}
          </h2>
          {nickname && (
            <p className="pf-nick" data-testid="profile-nickname">
              &ldquo;{nickname}&rdquo;
            </p>
          )}
          <div className="pf-chips">
            <RoleBadges roles={roles} />
            <span className="pf-base-role">{baseRole}</span>
          </div>
          {place && (
            <p className="pf-place" data-testid="profile-place">
              <Sprout aria-hidden="true" />
              {place}
            </p>
          )}
          {extra}
        </div>
        {canEdit && (
          <Button variant="outline" className="pf-edit-btn" onClick={onEdit}>
            <Pencil />
            Editar perfil
          </Button>
        )}
      </div>
      {footer}
    </header>
  );
}

/** Chips de dependente (responsável com 2+ alunos). Escolher muda o aluno ativo: todo o Perfil segue. */
export function DependentChips({ students, activeId, onSelect }: { students: Student[]; activeId: number | undefined; onSelect: (id: number) => void }) {
  if (students.length < 2) return null;
  return (
    <div className="pf-deps" data-testid="profile-dependents">
      <span className="pf-deps-label" id="pf-deps-label">
        Acompanhando
      </span>
      <div className="pf-deps-chips" role="radiogroup" aria-labelledby="pf-deps-label">
        {students.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={s.id === activeId}
            className="pf-dep"
            data-active={s.id === activeId ? "true" : undefined}
            onClick={() => onSelect(s.id)}
          >
            <Avatar name={s.name} src={s.photo} size={30} decorative />
            <span>{s.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------- DESTAQUES -------------------------------------- */

interface Highlight {
  key: string;
  to: "/jornada" | "/frequencia" | "/ranking";
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  sub?: string;
  visual?: ReactNode;
}

/**
 * Faixa de destaques do aluno ATIVO: graduação (corda), frequência (30 dias), liga + pontos e sequência de semanas.
 * Cada cartão só aparece se o dado carregou; erro/sem dado = cartão escondido (nunca mensagem de erro).
 */
export function ProfileHighlights() {
  const { student } = useMyStudent();
  const passport = usePassport();
  const graduations = useGraduations(student?.id);
  const attendance = useAttendance();
  const ranking = useRankingMe();

  const loading = [passport, graduations, attendance, ranking].some((q) => q.isLoading && !q.isError);
  const items: Highlight[] = [];

  const rope = passport.data?.currentGraduation ?? graduations.data?.[0]?.graduationLevel ?? null;
  if (rope) {
    items.push({
      key: "grad",
      to: "/jornada",
      icon: Award,
      label: "Graduação",
      value: rope.name,
      visual: <Rope {...rope} orientation="horizontal" length={64} thickness={12} decorative />,
    });
  }
  const pct = attendance.data?.last30dPercent;
  if (typeof pct === "number") {
    items.push({ key: "freq", to: "/frequencia", icon: CalendarCheck, label: "Frequência", value: `${Math.round(pct)}%`, sub: "últimos 30 dias" });
  }
  const rk = ranking.data;
  if (rk?.level && rk.points) {
    items.push({
      key: "liga",
      to: "/ranking",
      icon: Trophy,
      label: "Liga",
      value: (
        <span className="pf-league">
          <i style={{ background: leagueColor(rk.level) }} aria-hidden="true" />
          {rk.level.name}
        </span>
      ),
      sub: `${formatPoints(rk.points.season)} pts na temporada`,
    });
  }
  if (rk && rk.streakWeeks > 0) {
    items.push({ key: "streak", to: "/ranking", icon: Flame, label: "Sequência", value: plural(rk.streakWeeks, "semana"), sub: "treinando sem falhar" });
  }

  if (loading && items.length === 0) {
    return (
      <div className="pf-highlights" aria-busy="true" aria-label="Carregando destaques" data-testid="profile-highlights-loading">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="pf-hl pf-hl-skeleton" />
        ))}
      </div>
    );
  }
  if (items.length === 0) return null;

  return (
    <ul className="pf-highlights" aria-label="Destaques" data-testid="profile-highlights">
      {items.map((item) => (
        <li key={item.key} className="pf-hl-item" data-testid={`highlight-${item.key}`}>
          <Link to={item.to} className="pf-hl">
            <span className="pf-hl-top">
              <item.icon aria-hidden="true" />
              {item.label}
            </span>
            <strong className="pf-hl-value">{item.value}</strong>
            {item.visual}
            {item.sub && <span className="pf-hl-sub">{item.sub}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ----------------------------------- INSTALAR O APP ----------------------------------- */

/** "Instalar app": some quando o app já roda instalado. Com o prompt nativo guardado (lib/install) instala num toque; senão abre a ajuda (folha guiada no iPhone/iPad, texto nos demais). */
export function InstallRow() {
  const { installed, canPrompt, platform, promptInstall } = useInstall();
  const [help, setHelp] = useState(false);

  if (installed) return null;

  async function install() {
    // iPhone/iPad não têm prompt: a folha guiada é o caminho. Nos demais, prompt nativo se o navegador ofereceu.
    if (platform !== "ios" && canPrompt) {
      await promptInstall();
      return;
    }
    setHelp(true);
  }

  return (
    <>
      <ProfileCard icon={Download} title="Instalar app" id="pf-install-title" testId="profile-install">
        <p className="pf-hint">Tenha o GingApp na tela inicial do celular, com acesso rápido e em tela cheia.</p>
        <Button variant="outline" className="pf-action" onClick={() => void install()}>
          <Download />
          Instalar o GingApp
        </Button>
      </ProfileCard>
      <InstallHelp open={help} onOpenChange={setHelp} />
    </>
  );
}

/** Esqueleto do Perfil enquanto /students/me carrega. */
export function ProfileSkeleton() {
  return (
    <div className="pf-hero" aria-busy="true" aria-label="Carregando perfil" data-testid="profile-skeleton">
      <Skeleton className="pf-cover-sk" />
      <div className="pf-hero-body">
        <Skeleton className="pf-av-sk" />
        <div className="pf-who">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="mt-2 h-4 w-32" />
          <Skeleton className="mt-3 h-4 w-56" />
        </div>
      </div>
    </div>
  );
}
