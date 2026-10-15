import { ArrowLeft, Building2, CalendarDays, Clock, Layers, UserRound, Users } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { EntityAvatar } from "@/components/painel/entity-avatar";
import { RopeSwatch } from "@/components/painel/rope-swatch";
import { StudentAvatar } from "@/components/painel/student-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { useClassStudents, type ClassStudent } from "@/lib/class-students";
import { dayOnly, fmt } from "@/lib/format";
import { civilDay } from "@/lib/lesson-window";
import { plural } from "@/lib/plural";
import { timeRange } from "@/modules/aulas/aulas-api";
import { CLASS_STATUS_LABEL, WEEKDAY_LABEL, scheduleLabel } from "./schema";
import { classes, useClassUpcomingLessons } from "./turmas-api";

/** Taxa de presença como o aluno aparece na lista: "8 de 10 aulas (80%)" ou "—" quando a turma não teve aula no período. */
function attendanceLabel(s: Pick<ClassStudent, "presences" | "lessonsInPeriod" | "attendanceRate">): string {
  if (!s.lessonsInPeriod) return "Sem aulas no período";
  return `${s.presences ?? 0} de ${plural(s.lessonsInPeriod, "aula")} (${s.attendanceRate ?? 0}%)`;
}

/** Linha de um aluno da turma: foto, nome (e apelido), corda, status e presenças nos últimos 90 dias. */
export function ClassStudentRow({ student }: { student: ClassStudent }) {
  const cord = student.currentCord;
  return (
    <li data-testid="class-student-row" className="flex items-start gap-3 px-3 py-3 text-sm">
      <StudentAvatar name={student.name} photo={student.photo} className="size-10" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{student.name}</span>
          {student.nickname && <span className="text-muted-foreground">“{student.nickname}”</span>}
          {student.studentStatus === "INACTIVE" && <Badge variant="secondary">Inativo</Badge>}
        </p>
        <p className="flex items-center gap-2 text-muted-foreground">
          {cord ? (
            <>
              <RopeSwatch
                style={cord.style}
                colors={cord.colors}
                tipStart={cord.tipStart}
                tipEnd={cord.tipEnd}
                orientation="horizontal"
                size="sm"
                decorative
              />
              <span data-testid="class-student-cord">{cord.name}</span>
            </>
          ) : (
            <span>Sem graduação</span>
          )}
        </p>
      </div>
      <p data-testid="class-student-attendance" className="shrink-0 text-right text-xs text-muted-foreground">
        {attendanceLabel(student)}
      </p>
    </li>
  );
}

/** Detalhe da turma (/turmas/$classId): dados da turma, atalhos (próxima aula, aulas) e a lista dos ALUNOS com foto. */
export function TurmaDetailPage({ classId }: { classId: number }) {
  const navigate = useNavigate();
  const klass = classes.useOne(classId);
  const students = useClassStudents(classId);
  const today = civilDay(new Date());
  const upcoming = useClassUpcomingLessons(classId, today);
  const lessonsList = upcoming.data?.items ?? [];
  const nextActive = lessonsList.find((l) => l.status === "ACTIVE");

  const back = (
    <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => void navigate({ to: "/turmas" })}>
      <ArrowLeft /> Turmas
    </Button>
  );

  if (klass.isLoading) {
    return (
      <>
        {back}
        <Skeleton className="h-40 w-full" data-testid="turma-loading" />
      </>
    );
  }
  if (klass.error || !klass.data) {
    return (
      <>
        {back}
        <div className="space-y-2 py-8 text-center">
          <p className="text-sm text-destructive">{errorMessage(klass.error, "Turma não encontrada.")}</p>
          <Button variant="outline" size="sm" onClick={() => void klass.refetch()}>
            Tentar novamente
          </Button>
        </div>
      </>
    );
  }

  const c = klass.data;
  const weekday = c.weekday === null || c.weekday === undefined ? "—" : (WEEKDAY_LABEL[c.weekday] ?? "—");
  const info: Array<{ icon: typeof Clock; label: string; value: React.ReactNode }> = [
    { icon: CalendarDays, label: "Dia", value: weekday },
    { icon: Clock, label: "Horário", value: scheduleLabel(c) },
    {
      icon: Building2,
      label: "Unidade",
      value: c.unit ? (
        <span className="flex items-center gap-2">
          <EntityAvatar name={c.unit.name} photo={c.unit.photo} icon={Building2} className="size-6" />
          {c.unit.name}
        </span>
      ) : (
        "—"
      ),
    },
    {
      icon: UserRound,
      label: "Professor",
      value: c.teacher ? (
        <span className="flex items-center gap-2">
          <EntityAvatar name={c.teacher.name} photo={c.teacher.photo} icon={UserRound} className="size-6" />
          {c.teacher.name}
        </span>
      ) : (
        "—"
      ),
    },
    {
      icon: CalendarDays,
      label: "Próxima aula",
      value: nextActive ? (
        <span data-testid="turma-next-lesson">
          {fmt(dayOnly(nextActive.date), "dd/MM/yyyy")} · {timeRange(nextActive)}
        </span>
      ) : upcoming.isLoading ? (
        "…"
      ) : (
        "Nenhuma aula ativa à frente"
      ),
    },
  ];

  return (
    <>
      {back}
      <div className="mb-4 flex items-start gap-3">
        <EntityAvatar name={c.name} photo={c.photo} icon={Layers} className="size-14" />
        <div className="min-w-0">
          <h1 className="break-words text-xl font-extrabold tracking-tight md:text-2xl">{c.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant={c.status === "ACTIVE" ? "default" : "secondary"}>{CLASS_STATUS_LABEL[c.status]}</Badge>
            {c.autoGenerateLessons && <Badge variant="outline">Aulas contínuas</Badge>}
          </div>
          {c.description && <p className="mt-2 text-sm text-muted-foreground">{c.description}</p>}
        </div>
      </div>

      <dl className="mb-6 grid gap-3 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-3">
        {info.map(({ icon: Icon, label, value }) => (
          <div key={label} className="min-w-0 space-y-0.5">
            <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Icon className="size-3.5" /> {label}
            </dt>
            <dd className="text-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="turma-alunos" className="mb-6">
        <h2 id="turma-alunos" className="mb-2 flex items-center gap-2 text-base font-bold">
          <Users className="size-4" /> Alunos
          {students.data && <span className="font-normal text-muted-foreground">({students.data.length})</span>}
        </h2>
        {students.isLoading ? (
          <Skeleton className="h-24 w-full" data-testid="class-students-loading" />
        ) : students.error ? (
          <div className="space-y-2 text-center">
            <p className="text-sm text-destructive">{errorMessage(students.error, "Não foi possível carregar os alunos da turma.")}</p>
            <Button variant="outline" size="sm" onClick={() => void students.refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : students.data?.length ? (
          <>
            <ul className="divide-y rounded-md border">
              {students.data.map((s) => (
                <ClassStudentRow key={s.id} student={s} />
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">Presenças nos últimos 90 dias (aulas ativas já realizadas).</p>
          </>
        ) : (
          <p className="rounded-md border py-6 text-center text-sm text-muted-foreground">Nenhum aluno matriculado ainda.</p>
        )}
      </section>

      <section aria-labelledby="turma-aulas">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="turma-aulas" className="flex items-center gap-2 text-base font-bold">
            <CalendarDays className="size-4" /> Próximas aulas
          </h2>
          <Button variant="outline" size="sm" onClick={() => void navigate({ to: "/aulas" })}>
            Ver todas as aulas
          </Button>
        </div>
        {upcoming.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : lessonsList.length ? (
          <ul className="divide-y rounded-md border">
            {lessonsList.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="font-medium">{fmt(dayOnly(l.date), "dd/MM/yyyy")}</span>
                <span className="text-muted-foreground">{timeRange(l)}</span>
                <Badge variant={l.status === "ACTIVE" ? "default" : "secondary"}>{l.status === "ACTIVE" ? "Ativa" : "Cancelada"}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border py-6 text-center text-sm text-muted-foreground">Nenhuma aula de hoje em diante.</p>
        )}
      </section>
    </>
  );
}
