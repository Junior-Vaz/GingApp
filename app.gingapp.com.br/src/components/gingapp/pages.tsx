import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, MapPin, Download, Bell, ShieldCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/api";
import { capitalize, dayOnly, fmt, formatCurrency, relativeTime } from "@/lib/format";
import { effectiveFinanceStatus, monthRange, monthStats, recentMonths, recordsInMonth, streakOf } from "@/lib/derive";
import {
  useAnnouncements,
  useAttendance,
  useClasses,
  useFinance,
  useFinanceSummary,
  useMyStudent,
  useNotifications,
  useOwnOrganization,
  usePassport,
  usePastLessons,
  useUnreadCount,
  useUpcomingLessons,
  type FinanceStatus,
  type FinancialRecord,
  type Lesson,
} from "@/lib/queries";
import { PushSettings } from "./push-settings";
import { LoadMore, PageHeading, SectionHeading, StateMessage } from "./shared";

/* ------------------------------ Minhas aulas ------------------------------ */

export function ClassesPage() {
  // Próximas (de hoje em diante, a mais próxima primeiro) e anteriores (as mais recentes primeiro)
  // vêm de consultas separadas por período: o histórico longo não esconde a próxima aula.
  const upcomingQuery = useUpcomingLessons();
  const pastQuery = usePastLessons();
  const classes = useClasses();
  const passport = usePassport();
  const [detail, setDetail] = useState<Lesson | null>(null);

  const upcoming = upcomingQuery.items;
  const past = pastQuery.items;
  const all = [...upcoming, ...past];
  const loading = upcomingQuery.isLoading || pastQuery.isLoading;
  const error = upcomingQuery.error ?? pastQuery.error;
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
      {loading ? (
        <StateMessage>Carregando…</StateMessage>
      ) : error ? (
        <StateMessage tone="error">{errorMessage(error, "Não foi possível carregar as aulas.")}</StateMessage>
      ) : all.length === 0 ? (
        <StateMessage>Nenhuma aula agendada.</StateMessage>
      ) : (
        <>
          {upcoming.length > 0 && (
            <>
              <SectionHeading title="Próximas" />
              <div className="grid lg:grid-cols-2 gap-x-6">{upcoming.map((item, index) => card(item, index === 0 && item.status === "ACTIVE"))}</div>
              <LoadMore
                shown={upcoming.length}
                total={upcomingQuery.total}
                hasMore={upcomingQuery.hasNextPage}
                loading={upcomingQuery.isFetchingNextPage}
                onMore={() => void upcomingQuery.fetchNextPage()}
                noun="aulas"
              />
            </>
          )}
          {past.length > 0 && (
            <>
              <SectionHeading title="Anteriores" />
              <div className="grid lg:grid-cols-2 gap-x-6">{past.map((item) => card(item, false))}</div>
              <LoadMore
                shown={past.length}
                total={pastQuery.total}
                hasMore={pastQuery.hasNextPage}
                loading={pastQuery.isFetchingNextPage}
                onMore={() => void pastQuery.fetchNextPage()}
                noun="aulas anteriores"
              />
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
  // Os últimos 12 meses; os registros vêm do SERVIDOR já filtrados pelo mês escolhido (até 200),
  // e sequência/% dos 30 dias vêm agregados do banco — nada é calculado sobre uma lista truncada.
  const months = useMemo(() => recentMonths(12), []);
  const [month, setMonth] = useState(months[0] ?? fmt(new Date(), "yyyy-MM"));

  const reference = useMemo(() => {
    const [year, mon] = month.split("-").map(Number);
    return new Date(year ?? new Date().getFullYear(), (mon ?? 1) - 1, 1);
  }, [month]);
  const range = useMemo(() => monthRange(reference), [reference]);
  const attendance = useAttendance({ ...range, limit: 200 });
  const records = useMemo(() => attendance.data?.records ?? [], [attendance.data]);
  const monthTotal = attendance.data?.total ?? records.length;
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
                <div className="stat-value">{streakOf(attendance.data)}</div>
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
              <p className="text-xs text-muted-foreground mt-4">Nenhum registro de presença neste mês.</p>
            )}
            {monthTotal > records.length && (
              <p className="text-xs text-muted-foreground mt-4" role="status">
                Exibindo {records.length} de {monthTotal} registros deste mês.
              </p>
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
  const summary = useFinanceSummary();
  const organization = useOwnOrganization();
  const [record, setRecord] = useState<FinancialRecord | null>(null);
  const howToPay = organization.data?.paymentInstructions?.trim();
  // Próximos vencimentos: em aberto e AINDA não vencidos, do mais próximo para o mais distante.
  const upcoming = finance.items
    .filter((item) => effectiveFinanceStatus(item) === "PENDING")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 3);
  // O banner usa SÓ os totais agregados no banco (summary); a lista é paginada e pode estar
  // incompleta, então nunca se soma nada a partir dela.
  const totals = summary.data;
  const openCents = totals?.openCents ?? 0;
  const overdueCount = totals?.overdueCount ?? 0;

  return (
    <>
      <PageHeading title="Meu financeiro" subtitle="Tudo em dia para continuar sua jornada." />
      {finance.error ? (
        <StateMessage tone="error">{errorMessage(finance.error, "Não foi possível carregar seus dados financeiros.")}</StateMessage>
      ) : finance.isLoading || summary.isLoading ? (
        <StateMessage>Carregando…</StateMessage>
      ) : (
        <>
          {totals ? (
            <div className="flex gap-3 items-center bg-secondary text-primary p-5 rounded-lg mb-7">
              {openCents > 0 ? <AlertTriangle /> : <ShieldCheck />}
              <div>
                <strong className="text-sm">
                  {openCents > 0 ? `Você tem ${formatCurrency(openCents)} em aberto` : "Sua mensalidade está em dia"}
                </strong>
                <p className="text-xs mt-1">
                  {totals.oldestOpenDueDate
                    ? `${overdueCount > 0 ? `${overdueCount} em atraso (${formatCurrency(totals.overdueCents)}) · Vencimento mais antigo` : "Próximo vencimento"}: ${fmt(dayOnly(totals.oldestOpenDueDate), "dd 'de' MMMM 'de' yyyy")}`
                    : "Nenhuma cobrança pendente."}
                </p>
              </div>
            </div>
          ) : (
            <StateMessage tone="error">{errorMessage(summary.error, "Não foi possível calcular o total em aberto.")}</StateMessage>
          )}
          {upcoming.length > 0 && (
            <>
              <SectionHeading title="Próximos vencimentos" />
              <ul className="mb-7 space-y-2 text-sm" data-testid="upcoming-dues">
                {upcoming.map((item) => (
                  <li key={item.id} className="flex justify-between gap-3 rounded-lg bg-secondary px-4 py-3">
                    <span>
                      {item.description} · {fmt(dayOnly(item.dueDate), "dd/MM/yyyy")}
                    </span>
                    <strong>{formatCurrency(item.amountCents)}</strong>
                  </li>
                ))}
              </ul>
            </>
          )}
          {howToPay && (
            <>
              <SectionHeading title="Como pagar" />
              <p className="mb-7 whitespace-pre-line rounded-lg border p-4 text-sm" data-testid="how-to-pay">
                {howToPay}
              </p>
            </>
          )}
          <SectionHeading title="Histórico de pagamentos" />
          {finance.items.length === 0 ? (
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
                  {finance.items.map((item) => {
                    const status = effectiveFinanceStatus(item);
                    return (
                      <tr key={item.id}>
                        <td>{item.description}</td>
                        <td>{fmt(dayOnly(item.dueDate), "dd/MM/yyyy")}</td>
                        <td>{formatCurrency(item.amountCents)}</td>
                        <td>
                          <span className={`badge ${status === "PAID" ? "" : "badge-warm"}`}>{STATUS_LABEL[status]}</span>
                        </td>
                        <td>
                          <Button variant="ghost" size="icon" title="Ver cobrança" aria-label={`Ver ${item.description}`} onClick={() => setRecord(item)}>
                            <Download />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <LoadMore
            shown={finance.items.length}
            total={finance.total}
            hasMore={finance.hasNextPage}
            loading={finance.isFetchingNextPage}
            onMore={() => void finance.fetchNextPage()}
            noun="lançamentos"
          />
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
              <p>Situação: {STATUS_LABEL[effectiveFinanceStatus(record)]}</p>
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

  const unreadCount = useUnreadCount();
  const list = notifications.items;
  // Não lidas contadas no banco (a lista carregada pode ser só uma parte das notificações).
  const unread = unreadCount.data ?? 0;
  const notices = (announcements.data ?? []).filter(
    (a) => a.isActive && (a.unitId === null || a.unitId === (student?.unitId ?? null)),
  );

  return (
    <>
      <PageHeading title="Meus recados" subtitle="O que acontece no seu grupo e na sua jornada." />
      <PushSettings />
      {notifications.error ? (
        <StateMessage tone="error">{errorMessage(notifications.error, "Não foi possível carregar as notificações.")}</StateMessage>
      ) : (
        <>
          <div className="flex justify-between items-center mb-5">
            <span className="text-sm text-muted-foreground">
              {notifications.isLoading || unreadCount.isLoading ? "Carregando…" : unread === 0 ? "Tudo lido. Axé!" : `${unread} ${unread === 1 ? "novo recado" : "novos recados"}`}
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
          <LoadMore
            shown={list.length}
            total={notifications.total}
            hasMore={notifications.hasNextPage}
            loading={notifications.isFetchingNextPage}
            onMore={() => void notifications.fetchNextPage()}
            noun="notificações"
          />
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
          {announcements.total !== null && announcements.total > (announcements.data?.length ?? 0) && (
            <p className="text-xs text-muted-foreground py-2" role="status">
              Mostrando {announcements.data?.length ?? 0} de {announcements.total} recados do grupo.
            </p>
          )}
        </>
      )}
    </>
  );
}
