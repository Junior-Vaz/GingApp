import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, ChevronLeft, ChevronRight, Compass, QrCode, Sprout, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import "./hero-carousel.css";
import rodaImage from "@/assets/capoeira-roda.jpg";
import communityImage from "@/assets/capoeira-community.jpg";
import { Rope } from "./rope";
import { ropeLabel, type RopeSpec } from "@/lib/rope";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useGraduations, useHierarchy, useMyStudent, usePassport } from "@/lib/queries";
import { formatPoints, leagueColor, readableOn, useRankingMe } from "@/lib/ranking";
import { useSessionUser } from "@/lib/session";
import { SPONSOR_IMPRESSION_DELAY_MS, isViewerMinor, reportImpressionOnce, useActiveSponsor } from "@/lib/sponsors";
import { buildSponsorSlide, insertSponsorSlide } from "./hero-sponsor";
import { useReducedMotion } from "@/lib/use-reduced-motion";

/** Tempo em cada slide antes de avançar sozinho. */
export const HERO_INTERVAL_MS = 5500;
/** Deslocamento horizontal mínimo (px) para o gesto valer como "passar o slide". */
const SWIPE_MIN_PX = 40;

type Tone = "community" | "ranking" | "journey" | "checkin" | "sponsor";

/** Dados do anunciante de um slide patrocinado (o botão e a imagem já vêm resolvidos em `cta.to` e `image`). */
export interface HeroSponsorSpec {
  /** Id da campanha (conta a impressão). */
  id: number;
  name: string;
  logoSrc: string | null;
}

export interface HeroSlideSpec {
  key: string;
  tone: Tone;
  image?: string;
  imageAlt?: string;
  eyebrowIcon: ReactNode;
  eyebrow: string;
  title: ReactNode;
  text: ReactNode;
  /** Barra de progresso / selo extra entre o texto e o botão. */
  extra?: ReactNode;
  /** Desenho decorativo à direita (selo da liga, corda). */
  art?: ReactNode;
  /** `external`: link externo (patrocinado) - vira `<a target="_blank" rel="sponsored noopener noreferrer">` em vez do Link do app. */
  cta: { to: string; label: string; external?: boolean };
  /** Presente SÓ no slide patrocinado: selo "Patrocinado", chip do logo e "Por que vejo isso?". */
  sponsor?: HeroSponsorSpec;
}

const isMousePointer = (e: { pointerType?: string }) => e.pointerType !== "touch" && e.pointerType !== "pen";

/** Só o foco de TECLADO pausa (um toque/clique num indicador não pode travar o autoplay para sempre). */
function isKeyboardFocus(target: EventTarget): boolean {
  try {
    return (target as Element).matches(":focus-visible");
  } catch {
    return true;
  }
}

/**
 * Carrossel do banner da Home (apresentação): troca sozinho a cada ~5,5 s com fade curto; pausa com mouse em cima,
 * foco de teclado, toque/arraste e aba oculta; swipe no toque, setas (desktop) e indicadores clicáveis.
 * Com `prefers-reduced-motion` não há autoplay nem animação. O slide ativo é guardado pela CHAVE: se um slide
 * entrar/sair (dados chegando ou falhando) o que o aluno está vendo não pula.
 * `onSponsorSeen(id)` dispara quando o slide patrocinado fica ATIVO com a aba VISÍVEL por 1 s seguido (trocar de slide
 * ou esconder a aba antes disso cancela); quem decide contar uma vez por sessão é quem recebe o callback.
 */
export function HeroCarouselView({
  slides,
  intervalMs = HERO_INTERVAL_MS,
  onSponsorSeen,
}: {
  slides: HeroSlideSpec[];
  intervalMs?: number;
  onSponsorSeen?: (sponsorId: number) => void;
}) {
  const reduced = useReducedMotion();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [manual, setManual] = useState(false); // aria-live só depois de o aluno navegar
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [touching, setTouching] = useState(false);
  // Folha "Por que vejo isso?": o nome fica guardado ao fechar para o texto não mudar durante a animação de saída.
  const [info, setInfo] = useState<{ sponsorName: string; open: boolean } | null>(null);
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.visibilityState === "hidden");
  const count = slides.length;
  const found = slides.findIndex((s) => s.key === activeKey);
  const index = found >= 0 ? found : 0;
  const activeSponsorId = slides[index]?.sponsor?.id;

  useEffect(() => {
    // Impressão: slide patrocinado ativo + aba visível por >= 1 s. Mudou o slide/a aba/a campanha = o timer recomeça.
    if (activeSponsorId === undefined || hidden || !onSponsorSeen) return;
    const timer = setTimeout(() => onSponsorSeen(activeSponsorId), SPONSOR_IMPRESSION_DELAY_MS);
    return () => clearTimeout(timer);
  }, [activeSponsorId, hidden, onSponsorSeen]);

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const goTo = useCallback(
    (target: number, byUser: boolean) => {
      if (count === 0) return;
      const wrapped = ((target % count) + count) % count;
      setActiveKey(slides[wrapped]!.key);
      if (byUser) setManual(true);
    },
    [count, slides],
  );

  const paused = hover || focus || touching || hidden || info?.open === true;
  useEffect(() => {
    if (reduced || paused || count < 2) return;
    const timer = setTimeout(() => goTo(index + 1, false), intervalMs);
    return () => clearTimeout(timer);
  }, [reduced, paused, count, index, intervalMs, goTo]);

  // Pré-carrega a imagem do próximo slide para a troca não piscar.
  const nextImage = count > 1 ? slides[(index + 1) % count]?.image : undefined;
  useEffect(() => {
    if (!nextImage || typeof Image === "undefined") return;
    const img = new Image();
    img.src = nextImage;
  }, [nextImage]);

  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  const onPointerDown = (e: ReactPointerEvent) => {
    if (isMousePointer(e)) return;
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    swiped.current = false;
    setTouching(true);
  };
  const endTouch = (e: ReactPointerEvent, cancelled: boolean) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start || start.id !== e.pointerId) return;
    setTouching(false);
    if (cancelled) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
      swiped.current = true;
      goTo(index + (dx < 0 ? 1 : -1), true);
    }
  };

  if (count === 0) return null;

  const banner = (
    <section
      className="welcome-banner hero-carousel"
      role="region"
      aria-roledescription="carrossel"
      aria-label="Destaques da Ginga"
      data-testid="hero-carousel"
      data-paused={paused || undefined}
      onPointerEnter={(e) => isMousePointer(e) && setHover(true)}
      onPointerLeave={(e) => isMousePointer(e) && setHover(false)}
      onFocus={(e) => isKeyboardFocus(e.target) && setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
      onPointerDown={onPointerDown}
      onPointerUp={(e) => endTouch(e, false)}
      onPointerCancel={(e) => endTouch(e, true)}
      onClickCapture={(e) => {
        // Depois de um arrasto o "click" sintético não pode abrir o link do slide.
        if (swiped.current) {
          swiped.current = false;
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div className="hero-track" aria-live={manual ? "polite" : "off"}>
        {slides.map((slide, i) => (
          <div
            key={slide.key}
            className={`hero-slide hero-${slide.tone}`}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} de ${count}`}
            data-active={i === index || undefined}
            data-testid={`hero-slide-${slide.key}`}
          >
            {slide.image && (
              <img
                src={slide.image}
                alt={slide.imageAlt ?? ""}
                width={1536}
                height={768}
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
                // Imagem do patrocinador que não carrega: some e fica o degradê neutro (sem ícone de imagem quebrada).
                onError={slide.sponsor ? (e) => void (e.currentTarget.style.display = "none") : undefined}
              />
            )}
            {slide.art && <div className="hero-art">{slide.art}</div>}
            <div className="welcome-content">
              {slide.sponsor ? (
                <div className="hero-sponsor-top">
                  {slide.sponsor.logoSrc && (
                    <span className="hero-sponsor-logo" data-testid="hero-sponsor-logo">
                      <img
                        src={slide.sponsor.logoSrc}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        onError={(e) => void (e.currentTarget.style.display = "none")}
                      />
                    </span>
                  )}
                  <span className="hero-sponsor-badge" data-testid="hero-sponsor-badge">
                    {slide.eyebrow}
                  </span>
                  <span className="hero-sponsor-name">{slide.sponsor.name}</span>
                </div>
              ) : (
                <div className="eyebrow">
                  {slide.eyebrowIcon} {slide.eyebrow}
                </div>
              )}
              <h2>{slide.title}</h2>
              <p>{slide.text}</p>
              {slide.extra}
              {slide.sponsor ? (
                <div className="hero-sponsor-actions">
                  <Button variant="hero" size="sm" asChild>
                    <a href={slide.cta.to} target="_blank" rel="sponsored noopener noreferrer" tabIndex={i === index ? 0 : -1}>
                      {slide.cta.label}
                      <span className="sr-only"> (abre em nova aba)</span>
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </a>
                  </Button>
                  <button
                    type="button"
                    className="hero-sponsor-why"
                    tabIndex={i === index ? 0 : -1}
                    aria-haspopup="dialog"
                    onClick={() => setInfo({ sponsorName: slide.sponsor!.name, open: true })}
                  >
                    Por que vejo isso?
                  </button>
                </div>
              ) : (
                <Button variant="hero" size="sm" asChild>
                  <Link to={slide.cta.to} tabIndex={i === index ? 0 : -1}>
                    {slide.cta.label}
                    <ArrowUpRight size={14} />
                  </Link>
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {count > 1 && (
        <>
          <button type="button" className="hero-arrow hero-arrow-prev" aria-label="Slide anterior" onClick={() => goTo(index - 1, true)}>
            <ChevronLeft />
          </button>
          <button type="button" className="hero-arrow hero-arrow-next" aria-label="Próximo slide" onClick={() => goTo(index + 1, true)}>
            <ChevronRight />
          </button>
          <div className="hero-dots">
            {slides.map((slide, i) => (
              <button
                key={slide.key}
                type="button"
                className="hero-dot"
                aria-label={slide.sponsor ? `Patrocinado: ${typeof slide.title === "string" ? slide.title : slide.sponsor.name}` : `Ir para o slide ${i + 1} de ${count}`}
                aria-current={i === index ? "true" : undefined}
                data-active={i === index || undefined}
                onClick={() => goTo(i, true)}
              >
                <span />
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );

  // A folha fica FORA do <section>: eventos React de um portal sobem pela árvore React, e um toque/foco dentro
  // dela não pode contar como swipe/foco do carrossel.
  return (
    <>
      {banner}
      <Dialog open={info?.open === true} onOpenChange={(open) => setInfo((current) => (current ? { ...current, open } : current))}>
        <DialogContent className="max-w-[calc(100vw-32px)] sm:max-w-md" data-testid="sponsor-why-dialog">
          <DialogHeader>
            <DialogTitle>Por que vejo isso?</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-foreground/80">
              O GingApp é gratuito e se mantém com o apoio de parceiros. Este anúncio é de {info?.sponsorName} e não usa seus dados pessoais.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}

const ropeSpecOf = (level: { color: string | null; style?: RopeSpec["style"]; colors?: string[]; tipStart?: string | null; tipEnd?: string | null }): RopeSpec => ({
  color: level.color,
  style: level.style,
  colors: level.colors,
  tipStart: level.tipStart,
  tipEnd: level.tipEnd,
});

/**
 * Banner da Home: comunidade (sempre), ranking, jornada e check-in. Ranking e jornada seguem o ALUNO ATIVO
 * (dependente) e simplesmente saem do carrossel enquanto carregam ou se a consulta falhar - nunca mostram erro.
 */
export function HeroCarousel() {
  const { student, isSuccess: studentsLoaded } = useMyStudent();
  const ranking = useRankingMe();
  const graduations = useGraduations(student?.id);
  const hierarchy = useHierarchy();

  // Patrocinado: só com sessão, com a lista de alunos já resolvida e o passaporte do aluno ativo assentado (é dele que o
  // app sabe se o perfil é menor). Menor = nem pede nem mostra. Sem data de nascimento o app não sabe: o servidor decide.
  const user = useSessionUser();
  const passport = usePassport();
  const minor = isViewerMinor({ passportIsMinor: passport.data?.viewer?.isMinor });
  const sponsorQuery = useActiveSponsor(student?.id, !!user && studentsLoaded && !passport.isLoading && !minor);
  const sponsor = minor ? null : (sponsorQuery.data ?? null);

  const me = ranking.isError ? undefined : ranking.data;
  const current = graduations.isError ? undefined : graduations.data?.[0];
  const levels = useMemo(() => (hierarchy.isError ? [] : [...(hierarchy.data?.levels ?? [])].sort((a, b) => a.order - b.order)), [hierarchy.data, hierarchy.isError]);

  const sponsorSlide = useMemo(() => (sponsor ? buildSponsorSlide(sponsor) : null), [sponsor]);

  const slides = useMemo(() => {
    const list: HeroSlideSpec[] = [
      {
        key: "comunidade",
        tone: "community",
        image: rodaImage,
        imageAlt: "Capoeiristas jogando em uma roda no Pelourinho",
        eyebrowIcon: <Sprout size={13} />,
        eyebrow: "Sua capoeira vai além do treino",
        title: (
          <>
            O mundo é uma roda.
            <br />
            Encontre a sua.
          </>
        ),
        text: "Conecte-se com a comunidade, viva novos encontros e leve sua ginga mais longe.",
        cta: { to: "/comunidade", label: "Explorar a comunidade" },
      },
    ];

    if (me?.level) {
      const color = leagueColor(me.level);
      const points = me.points?.season ?? 0;
      list.push({
        key: "ranking",
        tone: "ranking",
        image: communityImage,
        imageAlt: "",
        eyebrowIcon: <Trophy size={13} />,
        eyebrow: "Seu ranking",
        title: "Suba de liga a cada treino",
        text:
          me.nextLevel && me.pointsToNext != null
            ? `Liga ${me.level.name} · ${formatPoints(points)} pts. Faltam ${formatPoints(me.pointsToNext)} para a liga ${me.nextLevel.name}.`
            : `Liga ${me.level.name} · ${formatPoints(points)} pts. Você está no topo das ligas!`,
        art: (
          <span className="hero-seal" style={{ background: color, color: readableOn(color) }} data-testid="hero-league-seal">
            <Trophy aria-hidden="true" />
            <strong>{me.level.name}</strong>
          </span>
        ),
        cta: { to: "/ranking", label: "Ver ranking" },
      });
    }

    if (current) {
      const level = current.graduationLevel;
      const position = levels.findIndex((l) => l.id === level.id);
      const next = position >= 0 ? levels[position + 1] : undefined;
      const hasProgress = position >= 0 && levels.length > 1;
      const pct = hasProgress ? Math.round(((position + 1) / levels.length) * 100) : 0;
      list.push({
        key: "jornada",
        tone: "journey",
        eyebrowIcon: <Compass size={13} />,
        eyebrow: "Sua jornada",
        title: next || !hasProgress ? "Falta pouco para a próxima corda" : "Você chegou ao topo da régua",
        text: next ? `Corda atual: ${level.name}. Próxima: ${next.name}.` : `Corda atual: ${level.name}.`,
        extra: hasProgress ? (
          <div className="hero-progress" role="img" aria-label={`Corda ${position + 1} de ${levels.length}`} data-testid="hero-journey-progress">
            <span style={{ width: `${pct}%` }} />
            <small>
              Corda {position + 1} de {levels.length}
            </small>
          </div>
        ) : undefined,
        art: <Rope {...ropeSpecOf(level)} orientation="vertical" length={132} thickness={24} label={ropeLabel(ropeSpecOf(level))} />,
        cta: { to: "/jornada", label: "Minha jornada" },
      });
    }

    list.push({
      key: "checkin",
      tone: "checkin",
      eyebrowIcon: <QrCode size={13} />,
      eyebrow: "Check-in",
      title: "Marque sua presença com o QR",
      text: "Chegou na aula ou na roda? Leia o QR code e registre sua presença em segundos.",
      art: <QrCode className="hero-qr" aria-hidden="true" />,
      cta: { to: "/checkin", label: "Fazer check-in" },
    });
    return insertSponsorSlide(list, sponsorSlide);
  }, [me, current, levels, sponsorSlide]);

  return <HeroCarouselView slides={slides} onSponsorSeen={reportImpressionOnce} />;
}
