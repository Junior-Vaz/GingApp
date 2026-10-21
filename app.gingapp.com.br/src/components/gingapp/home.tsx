import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Clock,
  MapPin,
  ChartNoAxesColumnIncreasing,
  CircleDot,
  MessagesSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import communityImage from "@/assets/capoeira-community.jpg";
import { PageHeading, SectionHeading, EventCard, StateMessage } from "./shared";
import { capitalize, dayOnly, fmt, relativeTime, startOfToday } from "@/lib/format";
import { useSessionUser } from "@/lib/session";
import { errorMessage } from "@/lib/api";
import { plural } from "@/lib/plural";
import { useFeedSettings } from "@/lib/feed";
import {
  fromCalendar,
  useAnnouncements,
  useAttendance,
  useCalendar,
  useClasses,
  useGraduations,
  useMyStudent,
  useNextLessons,
  useMyIdentity,
  useMyUnit,
  usePassport,
} from "@/lib/queries";
import { HeroCarousel } from "./hero-carousel";
import { BirthdaysStrip } from "./birthdays-strip";
import { PinnedCommunications } from "./pinned-communications";
import { Avatar } from "./avatar";
import { GraduationCard } from "./graduation-parts";
import { ClassCover, TeacherLine, UnitLine } from "./class-parts";
import { graduationCardLabel, monthRange, monthStats, nextLesson, resolveClassInfo, weekdayLabel } from "@/lib/derive";

export function HomePage() {
  const user = useSessionUser();
  const { student, isLoading: loadingStudent, error: studentError } = useMyStudent();
  const graduations = useGraduations(student?.id);
  // Frequência do MÊS pedida ao servidor por período (até 200 registros) e só a próxima aula ativa:
  // nenhuma estatística sai de uma lista truncada em 50.
  const attendance = useAttendance({ ...monthRange(new Date()), limit: 200 });
  const passport = usePassport();
  const me = useMyIdentity();
  const groupName = passport.data?.organization.name ?? me.groupName ?? "Seu grupo";
  const lessons = useNextLessons();
  const classes = useClasses();
  const calendar = useCalendar({}, { pageSize: 2 });
  const announcements = useAnnouncements();
  // Atalho "Grupo" só com o feed ligado (carregando/desligado/erro = oculto).
  const feedEnabled = useFeedSettings().data?.enabled === true;

  const firstName = user?.name.split(" ")[0] ?? "capoeirista";
  const cardLabel = graduationCardLabel(student, user?.id);
  const current = graduations.data?.[0] ?? null;
  const month = monthStats(attendance.data?.records ?? [], new Date());
  const upcoming = nextLesson(lessons.data ?? []);
  const upcomingClass = classes.data?.find((c) => c.id === upcoming?.classId);
  const upcomingDate = upcoming ? dayOnly(upcoming.date) : null;
  const isToday = upcomingDate !== null && upcomingDate.getTime() === startOfToday().getTime();
  const myUnit = useMyUnit();
  const info = resolveClassInfo(upcoming, classes.data, myUnit);
  const events = calendar.items.slice(0, 2).map(fromCalendar);
  const notices = (announcements.data ?? [])
    .filter((a) => a.isActive && (a.unitId === null || a.unitId === (student?.unitId ?? null)))
    .slice(0, 2);

  return (
    <>
      <PageHeading
        title={`Salve, ${firstName}! ☀️`}
        subtitle="Cada ginga é um novo passo na sua jornada."
        aside={<Avatar name={groupName} src={me.groupLogoUrl} size={56} className="home-group-logo" label={`Logo do grupo ${groupName}`} title={groupName} />}
      />
      {studentError && <StateMessage tone="error">{errorMessage(studentError, "Não foi possível carregar seus dados.")}</StateMessage>}
      {!loadingStudent && !studentError && !student && <StateMessage>Nenhum aluno vinculado a esta conta.</StateMessage>}
      <HeroCarousel />
      <Link to="/jornada" className="grad-link" aria-label={`${cardLabel}: ver jornada`}>
        <GraduationCard
          label={cardLabel}
          name={current ? current.graduationLevel.name : null}
          rope={current ? current.graduationLevel : null}
          loading={graduations.isLoading || loadingStudent}
          subtitle={
            [groupName, current ? `Desde ${fmt(dayOnly(current.graduatedAt), "MMMM 'de' yyyy")}` : null].filter(Boolean).join(" · ") ||
            "Nenhuma graduação registrada"
          }
        />
      </Link>
      <section className="stats-grid stats-grid-2" aria-label="Minha evolução">
        <Link to="/frequencia" className="stat no-underline">
          <div>
            <p className="stat-label">Frequência no mês</p>
            <div className="stat-value">{month.total > 0 ? `${month.percent}%` : "—"}</div>
            <p className="stat-sub">
              {month.total > 0 ? (
                <>
                  <span className="positive">
                    {month.present} de {plural(month.total, "aula")}
                  </span>
                </>
              ) : (
                "Sem registros neste mês"
              )}
            </p>
          </div>
          <div className="stat-icon">
            <ChartNoAxesColumnIncreasing />
          </div>
        </Link>
        <Link to="/rodas" className="stat no-underline">
          <div>
            <p className="stat-label">Vivências na roda</p>
            <div className="stat-value">
              {passport.data?.stats.rodas ?? 0} <span className="text-[11px] font-normal text-muted-foreground">{passport.data?.stats.rodas === 1 ? "roda" : "rodas"}</span>
            </div>
            <p className="stat-sub">Histórias que ficam com você</p>
          </div>
          <div className="stat-icon">
            <CircleDot />
          </div>
        </Link>
      </section>
      <PinnedCommunications className="mb-4" />
      <BirthdaysStrip className="mb-4" />
      {feedEnabled && (
        <Link
          to="/feed"
          className="mb-[29px] flex min-h-14 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 no-underline"
          data-testid="home-feed-shortcut"
          aria-label="Abrir o Grupo: veja o que o pessoal compartilhou"
        >
          <span className="flex size-9 flex-none items-center justify-center rounded-md bg-secondary text-primary" aria-hidden="true">
            <MessagesSquare size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block text-sm">Grupo</strong>
            <span className="block text-xs text-muted-foreground">Fotos, recados e conversas da sua roda</span>
          </span>
          <ArrowUpRight size={16} className="flex-none text-muted-foreground" aria-hidden="true" />
        </Link>
      )}
      <div className="dashboard-columns">
        <div>
          <SectionHeading title="Bora treinar?" to="/aulas" label="Minhas aulas" />
          {lessons.isLoading ? (
            <StateMessage>Carregando…</StateMessage>
          ) : upcoming && upcomingDate ? (
            <article className="class-card next-class is-compact" data-testid="next-class">
              <ClassCover name={info.name} src={info.photo} variant="wide" />
              <div className="class-top">
                <span className="badge">
                  <span className="cord-dot size-1.5" /> Próxima aula • {isToday ? "Hoje" : capitalize(fmt(upcomingDate, "EEE, dd/MM"))}
                </span>
                {info.time && (
                  <span className="class-time">
                    <Clock size={13} />
                    {info.time}
                  </span>
                )}
              </div>
              <h3 className="truncate">{info.name}</h3>
              <div className="lesson-people">
                <UnitLine compact unit={info.unit} />
                {upcomingClass?.weekday != null && (
                  <div className="detail-line is-compact">
                    <CalendarDays />
                    {weekdayLabel(upcomingClass.weekday)}
                  </div>
                )}
              </div>
              <div className="class-bottom">
                <div className="teacher">
                  {info.teacher ? <TeacherLine compact teacher={info.teacher} /> : <span className="truncate">{upcoming.notes ?? upcomingClass?.description ?? "Bom treino!"}</span>}
                </div>
                <Button variant="soft" size="sm" asChild className="text-[10px] next-class-cta">
                  <Link to="/aulas">
                    Ver minha aula
                    <ArrowRight size={13} />
                  </Link>
                </Button>
              </div>
            </article>
          ) : (
            <StateMessage>Nenhuma aula agendada por enquanto.</StateMessage>
          )}
          <SectionHeading title="Nos vemos na roda" to="/eventos" label="Todos os eventos" />
          {calendar.isLoading ? (
            <StateMessage>Carregando…</StateMessage>
          ) : events.length > 0 ? (
            <div className="event-grid">
              {events.map((event) => (
                <EventCard key={event.key} event={event} />
              ))}
            </div>
          ) : (
            <StateMessage>Nenhum encontro agendado.</StateMessage>
          )}
        </div>
        <div className="dashboard-right">
          <SectionHeading title="Recados do grupo" to="/notificacoes" label="Ver todos" />
          {notices.length > 0 ? (
            <div className="notice-list">
              {notices.map((notice) => (
                <article className="notice-item" key={notice.id}>
                  <div className="notice-meta">
                    <Avatar decorative name={groupName} src={me.groupLogoUrl} size={24} />
                    <span>{groupName}</span>
                    <time>{relativeTime(notice.publishedAt ?? notice.createdAt)}</time>
                  </div>
                  <h3>{notice.title}</h3>
                  <p>{notice.body}</p>
                </article>
              ))}
            </div>
          ) : (
            <StateMessage>{announcements.isError ? "Recados indisponíveis no momento." : "Nenhum recado do grupo."}</StateMessage>
          )}
          <SectionHeading title="Capoeira é conexão" />
          <section className="community-preview">
            <img src={communityImage} alt="Comunidade reunida em uma roda de capoeira" width={1024} height={768} loading="lazy" />
            <div className="community-preview-content">
              <div className="eyebrow">
                <MapPin size={11} /> Perto de você
              </div>
              <h3>Sua próxima roda está perto.</h3>
              <p>
                Gente, encontros e histórias.
                <br />
                Descubra o que acontece ao seu redor.
              </p>
              <Button variant="hero" size="sm" className="text-[10px]" asChild>
                <Link to="/comunidade">
                  Encontrar minha comunidade
                  <ArrowUpRight />
                </Link>
              </Button>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
