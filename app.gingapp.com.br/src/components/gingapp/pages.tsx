import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, MapPin, Download, Bell, ShieldCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/api";
import { capitalize, dayOnly, fmt, formatCurrency, relativeTime, startOfToday } from "@/lib/format";
import { currentStreak, monthStats, recordsInMonth } from "@/lib/derive";
import {
  useAnnouncements,
  useAttendance,
  useClasses,
  useFinance,
  useLessons,
  useMyStudent,
  useNotifications,
  usePassport,
  type FinanceStatus,
  type FinancialRecord,
  type Lesson,
} from "@/lib/queries";
import { PageHeading, SectionHeading, StateMessage } from "./shared";

/* ------------------------------ Minhas aulas ------------------------------ */

export function ClassesPage() {
  const lessons = useLessons();
  const classes = useClasses();
  const passport = usePassport();
  const [detail, setDetail] = useState<Lesson | null>(null);

  const today = startOfToday().getTime();
  const all = lessons.data ?? [];
  const upcoming = all.filter((l) => dayOnly(l.date).getTime() >= today);
  const past = all.filter((l) => dayOnly(l.date).getTime() < today).reverse().slice(0, 10);
  const className = (l: Lesson) => classes.data?.find((c) => c.id === l.classId)?.name ?? "Aula";
  const unitName = passport.data?.unit?.name;
  const timeOf = (l: Lesson) => {
    const c = classes.data?.find((item) => item.id === l.classId);
    return [l.startTime ?? c?.startTime, l.endTime ?? c?.endTime].filter(Boolean).join(" – ");
  };

  const card = (item: Lesson, isNext: boolean) => (
    <article className="class-card" key={item.id}>
      <div className="class-top">
        <span className="badge">
          {isNext ? "Próxima aula • " : ""}
          {capitalize(fmt(dayOnly(item.date), "EEE, dd/MM"))}
        </span>
        {timeOf(item) && (
          <span className="class-time">
            <Clock size={13} />
            {timeOf(item)}
          </span>
        )}
      </div>
      <h3>{className(item)}</h3>
      {unitName && (
        <div className="detail-line">
          <MapPin />
          {unitName}
        </div>
      )}
      {item.status === "INACTIVE" && <span className="badge badge-warm">Cancelada</span>}
      {item.notes && <p className="text-xs text-muted-foreground my-4">{item.notes}</p>}
      <div className="class-bottom">
        <span />
        <Button variant="soft" size="sm" onClick={() => setDetail(item)}>
          Ver aula
        </Button>
      </div>
    </article>
  );

  return (
    <>
      <PageHeading title="Minhas aulas" subtitle="Seu próximo treino, sua próxima evolução." />
      {passport.data && (
        <div className="badge mb-6">
          {passport.data.organization.name}
          {passport.data.unit ? ` · ${passport.data.unit.name}` : ""}
        </div>
      )}
      {lessons.isLoading ? (
        <StateMessage>Carregando…</StateMessage>
      ) : lessons.error ? (
        <StateMessage tone="error">{errorMessage(lessons.error, "Não foi possível carregar as aulas.")}</StateMessage>
      ) : all.length === 0 ? (
        <StateMessage>Nenhuma aula agendada.</StateMessage>
      ) : (
        <>
          {upcoming.length > 0 && (
            <>
              <SectionHeading title="Próximas" />
              <div className="grid lg:grid-cols-2 gap-x-6">{upcoming.map((item, index) => card(item, index === 0 && item.status === "ACTIVE"))}</div>
            </>
          )}
          {past.length > 0 && (
            <>
              <SectionHeading title="Anteriores" />
              <div className="grid lg:grid-cols-2 gap-x-6">{past.map((item) => card(item, false))}</div>
            </>
          )}
        </>
      )}
      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent>
          <DialogTitle>{detail ? className(detail) : ""}</DialogTitle>
          <DialogDescription>
            {detail ? capitalize(fmt(dayOnly(detail.date), "EEEE, dd 'de' MMMM")) : ""}
            {detail && timeOf(detail) ? ` · ${timeOf(detail)}` : ""}
          </DialogDescription>
          {unitName && (
            <div className="detail-line">
              <MapPin />
              {unitName}
            </div>
          )}
          {detail?.status === "INACTIVE" && <p className="text-sm text-destructive">Esta aula foi cancelada.</p>}
          {detail?.notes && <p className="text-sm text-muted-foreground">{detail.notes}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}

/* -------------------------------- Frequência ------------------------------ */

export function AttendancePage() {
  const attendance = useAttendance();
  const records = useMemo(() => attendance.data?.records ?? [], [attendance.data]);
  const months = useMemo(() => {
    const keys = new Set<string>([fmt(new Date(), "yyyy-MM")]);
    records.forEach((r) => keys.add(fmt(dayOnly(r.lesson.date), "yyyy-MM")));
    return [...keys].sort().reverse();
  }, [records]);
  const [month, setMonth] = useState(months[0] ?? fmt(new Date(), "yyyy-MM"));

  const reference = useMemo(() => {
    const [year, mon] = month.split("-").map(Number);
    return new Date(year ?? new Date().getFullYear(), (mon ?? 1) - 1, 1);
  }, [month]);
  const monthRecords = recordsInMonth(records, reference);
  const stats = monthStats(records, reference);
  const daysInMonth = new Date(reference.getFullYear(), reference.getMonth() + 1, 0).getDate();
  const byDay = new Map<number, boolean>();
  monthRecords.forEach((r) => {
    const day = dayOnly(r.lesson.date).getDate();
    byDay.set(day, (byDay.get(day) ?? false) || r.present);
  });
  const percent = attendance.data?.last30dPercent;

  return (
    <>
      <PageHeading title="Minha frequência" subtitle="Constância é o que transforma a sua ginga." />
      {attendance.error ? (
        <StateMessage tone="error">{errorMessage(attendance.error, "Não foi possível carregar sua frequência.")}</StateMessage>
      ) : (
        <>
          <div className="stats-grid">
            <div className="stat">
              <div>
                <p className="stat-label">Frequência</p>
                <div className="stat-value">{stats.total > 0 ? `${stats.percent}%` : "—"}</div>
                <p className="stat-sub">
                  {percent != null ? `${Math.round(percent)}% nos últimos 30 dias` : "Sem registros ainda"}
                </p>
              </div>
            </div>
            <div className="stat">
              <div>
                <p className="stat-label">Aulas frequentadas</p>
                <div className="stat-value">{stats.present}</div>
                <p className="stat-sub">
                  {stats.total > 0 ? `de ${stats.total} registradas no mês` : "Presenças registradas"}
                </p>
              </div>
            </div>
            <div className="stat">
              <div>
                <p className="stat-label">Sequência atual</p>
                <div className="stat-value">{currentStreak(records)}</div>
                <p className="stat-sub">Aulas seguidas</p>
              </div>
            </div>
          </div>
          <section className="content-band">
            <div className="section-heading">
              <h2>Meu calendário de treinos</h2>
              <select className="select-field" aria-label="Mês de frequência" value={month} onChange={(event) => setMonth(event.target.value)}>
                {months.map((key) => {
                  const [y, m] = key.split("-").map(Number);
                  return (
                    <option key={key} value={key}>
                      {capitalize(fmt(new Date(y ?? 2000, (m ?? 1) - 1, 1), "MMMM yyyy"))}
                    </option>
                  );
                })}
              </select>
            </div>
            {attendance.isLoading ? (
              <StateMessage>Carregando…</StateMessage>
            ) : (
              <div className="attendance-grid">
                {["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"].map((day) => (
                  <div key={day} className="text-xs text-muted-foreground text-center pb-2">
                    {day}
                  </div>
                ))}
                {Array.from({ length: reference.getDay() }, (_, i) => (
                  <div key={`blank-${i}`} />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const state = byDay.get(i + 1);
                  return (
                    <div key={i} className={`calendar-cell ${state === true ? "present" : ""}`}>
                      {i + 1}
                      {state === true && <span>✓ Presença</span>}
                      {state === false && <span>Falta</span>}
                    </div>
                  );
                })}
              </div>
            )}
            {!attendance.isLoading && records.length === 0 && (
              <p className="text-xs text-muted-foreground mt-4">Nenhum registro de presença ainda.</p>
            )}
            {monthRecords.some((r) => !r.present && r.justification) && (
              <ul className="text-xs text-muted-foreground mt-4 space-y-1">
                {monthRecords
                  .filter((r) => !r.present && r.justification)
                  .map((r) => (
                    <li key={r.id}>
                      {fmt(dayOnly(r.lesson.date), "dd/MM")}: {r.justification}
                    </li>
                  ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground mt-4">Presenças registradas pelo professor.</p>
          </section>
        </>
      )}
    </>
  );
}

/* -------------------------------- Financeiro ------------------------------ */

const STATUS_LABEL: Record<FinanceStatus, string> = {
  PENDING: "Em aberto",
  PAID: "Pago",
  OVERDUE: "Atrasado",
  CANCELLED: "Cancelado",
};

export function FinancialPage() {
  const finance = useFinance();
  const [record, setRecord] = useState<FinancialRecord | null>(null);
  const sorted = [...(finance.data ?? [])].sort(
    (a, b) => dayOnly(b.dueDate).getTime() - dayOnly(a.dueDate).getTime(),
  );
  const open = sorted.filter((r) => r.status === "PENDING" || r.status === "OVERDUE");
  const openCents = open.reduce((sum, r) => sum + r.amountCents, 0);
  const nextDue = [...open].sort((a, b) => dayOnly(a.dueDate).getTime() - dayOnly(b.dueDate).getTime())[0];
  const hasOverdue = open.some((r) => r.status === "OVERDUE");

  return (
    <>
      <PageHeading title="Meu financeiro" subtitle="Tudo em dia para continuar sua jornada." />
      {finance.error ? (
        <StateMessage tone="error">{errorMessage(finance.error, "Não foi possível carregar seus dados financeiros.")}</StateMessage>
      ) : finance.isLoading ? (
        <StateMessage>Carregando…</StateMessage>
      ) : (
        <>
          <div className="flex gap-3 items-center bg-secondary text-primary p-5 rounded-lg mb-7">
            {openCents > 0 ? <AlertTriangle /> : <ShieldCheck />}
            <div>
              <strong className="text-sm">
                {openCents > 0 ? `Você tem ${formatCurrency(openCents)} em aberto` : "Sua mensalidade está em dia"}
              </strong>
              <p className="text-xs mt-1">
                {nextDue
                  ? `${hasOverdue ? "Vencimento mais antigo" : "Próximo vencimento"}: ${fmt(dayOnly(nextDue.dueDate), "dd 'de' MMMM 'de' yyyy")}`
                  : "Nenhuma cobrança pendente."}
              </p>
            </div>
          </div>
          <SectionHeading title="Histórico de pagamentos" />
          {sorted.length === 0 ? (
            <StateMessage>Nenhum lançamento financeiro encontrado.</StateMessage>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Descrição</th>
                    <th>Vencimento</th>
                    <th>Valor</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((item) => (
                    <tr key={item.id}>
                      <td>{item.description}</td>
                      <td>{fmt(dayOnly(item.dueDate), "dd/MM/yyyy")}</td>
                      <td>{formatCurrency(item.amountCents)}</td>
                      <td>
                        <span className={`badge ${item.status === "PAID" ? "" : "badge-warm"}`}>{STATUS_LABEL[item.status]}</span>
                      </td>
                      <td>
                        <Button variant="ghost" size="icon" title="Ver cobrança" aria-label={`Ver ${item.description}`} onClick={() => setRecord(item)}>
                          <Download />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-5">Dados sempre buscados online — esta tela não fica disponível offline.</p>
        </>
      )}
      <Dialog open={record !== null} onOpenChange={(open) => !open && setRecord(null)}>
        <DialogContent>
          <DialogTitle>{record?.description}</DialogTitle>
          <DialogDescription>Detalhes da cobrança</DialogDescription>
          {record && (
            <div className="space-y-1 text-sm">
              <p>Valor: {formatCurrency(record.amountCents)}</p>
              <p>Vencimento: {fmt(dayOnly(record.dueDate), "dd/MM/yyyy")}</p>
              <p>Situação: {STATUS_LABEL[record.status]}</p>
              {record.paidAt && <p>Pago em: {fmt(dayOnly(record.paidAt), "dd/MM/yyyy")}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------- Notificações ----------------------------- */

export function NotificationsPage() {
  const notifications = useNotifications();
  const announcements = useAnnouncements();
  const passport = usePassport();
  const { student } = useMyStudent();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });
  const markAll = useMutation({
    mutationFn: () => api.patch("/notifications/read-all"),
    onSuccess: async () => {
      await refresh();
      toast.success("Todos os recados foram marcados como lidos.");
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível marcar como lidos.")),
  });
  const markOne = useMutation({
    mutationFn: (id: number) => api.patch(`/notifications/${id}/read`),
    onSuccess: refresh,
  });

  const list = notifications.data ?? [];
  const unread = list.filter((n) => n.readAt === null).length;
  const notices = (announcements.data ?? []).filter(
    (a) => a.isActive && (a.unitId === null || a.unitId === (student?.unitId ?? null)),
  );

  return (
    <>
      <PageHeading title="Meus recados" subtitle="O que acontece no seu grupo e na sua jornada." />
      {notifications.error ? (
        <StateMessage tone="error">{errorMessage(notifications.error, "Não foi possível carregar as notificações.")}</StateMessage>
      ) : (
        <>
          <div className="flex justify-between items-center mb-5">
            <span className="text-sm text-muted-foreground">
              {notifications.isLoading ? "Carregando…" : unread === 0 ? "Tudo lido. Axé!" : `${unread} ${unread === 1 ? "novo recado" : "novos recados"}`}
            </span>
            <Button variant="outline" size="sm" disabled={unread === 0 || markAll.isPending} onClick={() => markAll.mutate()}>
              <Check />
              Marcar como lidos
            </Button>
          </div>
          {list.length > 0 ? (
            <div className="notice-list">
              {list.map((notice) => (
                <article
                  className="notice-item cursor-pointer"
                  key={notice.id}
                  onClick={() => notice.readAt === null && markOne.mutate(notice.id)}
                >
                  <div className="notice-meta">
                    <Bell size={15} />
                    <span>GingApp</span>
                    <time>{relativeTime(notice.createdAt)}</time>
                    {notice.readAt === null && <span className="cord-dot size-1.5" />}
                  </div>
                  <h3>{notice.title}</h3>
                  <p>{notice.body}</p>
                </article>
              ))}
            </div>
          ) : (
            !notifications.isLoading && <StateMessage>Nenhuma notificação por enquanto.</StateMessage>
          )}
        </>
      )}
      {notices.length > 0 && (
        <>
          <SectionHeading title="Recados do grupo" />
          <div className="notice-list">
            {notices.map((notice) => (
              <article className="notice-item" key={notice.id}>
                <div className="notice-meta">
                  <Bell size={15} />
                  <span>{passport.data?.organization.name ?? "Seu grupo"}</span>
                  <time>{relativeTime(notice.publishedAt ?? notice.createdAt)}</time>
                </div>
                <h3>{notice.title}</h3>
                <p>{notice.body}</p>
              </article>
            ))}
          </div>
        </>
      )}
    </>
  );
}
