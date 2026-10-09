import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fmt, startOfToday } from "@/lib/format";
import { AttendancePage, ClassesPage, FinancialPage, NotificationsPage } from "@/components/gingapp/pages";
import { DiscoveryPage } from "@/components/gingapp/discovery";
import type { AttendanceRecord, EventDto, FinancialRecord, Lesson, NotificationDto } from "@/lib/queries";

/**
 * Achado do e2e real do app: /finance/me devolvia 50 de 58 registros SEM aviso e o banner mostrava
 * "R$ 765,00 em aberto" (soma da lista truncada) quando o banco somava R$ 845,00 — e os vencimentos
 * mais antigos (os atrasados) eram justamente os que sumiam. Estes testes mockam o fetch com o
 * contrato novo (limit/offset + X-Total-Count + endpoints agregados) e provam que as telas usam o
 * total/agregado do servidor, pedem o período certo e paginam com aviso.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Route {
  body: unknown;
  total?: number;
  status?: number;
}
type Handler = (url: URL) => Route | undefined;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let calls: URL[] = [];

/** fetch mockado por rota: o handler recebe a URL (sem o prefixo /api) e devolve corpo + X-Total-Count. */
function mockApi(handler: Handler) {
  calls = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input).replace(/^.*\/api/, "http://x"));
    calls.push(url);
    const route = handler(url) ?? { body: [], total: 0 };
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: route.total === undefined ? {} : { "X-Total-Count": String(route.total) },
    });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const callsTo = (path: string) => calls.filter((u) => u.pathname === path);

function render(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>));
}

const text = () => (container?.textContent ?? "").replace(/\u00a0/g, " ");
const waitFor = (assertion: () => void) => act(async () => void (await vi.waitFor(assertion, { timeout: 3000 })));
const button = (name: RegExp) => [...container!.querySelectorAll("button")].find((b) => name.test(b.textContent ?? ""));
const clickButton = async (name: RegExp) => {
  const el = button(name);
  expect(el, `botão ${String(name)}`).toBeTruthy();
  await act(async () => el!.click());
};
const rows = () => container!.querySelectorAll("tbody tr").length;

beforeEach(() => localStorage.clear());
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

/* ------------------------------- Financeiro ------------------------------- */

// 58 lançamentos: a 1ª página (50) tem 20 em aberto de R$ 38,25 (= R$ 765,00 — o valor ERRADO do
// banner antigo) e 30 pagos; a 2ª (8) traz os atrasados mais antigos, R$ 10,00 cada (R$ 80,00).
// Total real em aberto: R$ 845,00, como o SQL.
const rec = (id: number, status: FinancialRecord["status"], dueDate: string, amountCents: number): FinancialRecord => ({
  id,
  description: `Mensalidade ${id}`,
  amountCents,
  type: "MENSALIDADE",
  dueDate,
  paidAt: status === "PAID" ? "2025-01-02T00:00:00.000Z" : null,
  status,
});
const page1: FinancialRecord[] = [
  ...Array.from({ length: 20 }, (_, i) => rec(100 - i, "PENDING", i === 0 ? "2099-12-10T00:00:00.000Z" : "2020-06-10T00:00:00.000Z", 3825)),
  ...Array.from({ length: 30 }, (_, i) => rec(200 + i, "PAID", "2019-03-10T00:00:00.000Z", 10000)),
];
const page2: FinancialRecord[] = Array.from({ length: 8 }, (_, i) => rec(300 + i, "OVERDUE", "2018-01-05T00:00:00.000Z", 1000));
const summary = {
  openCents: 84500,
  openCount: 28,
  overdueCents: 8000 + 19 * 3825,
  overdueCount: 8 + 19,
  paidCents: 300000,
  paidCount: 30,
  oldestOpenDueDate: "2018-01-05T00:00:00.000Z",
};

const financeApi = (overrides: Partial<Record<"summary", Route>> = {}): Handler => (url) => {
  if (url.pathname === "/finance/me/summary") return overrides.summary ?? { body: summary };
  if (url.pathname === "/finance/me") {
    return url.searchParams.get("offset") === "50" ? { body: page2, total: 58 } : { body: page1, total: 58 };
  }
  return undefined;
};

describe("Financeiro do aluno: total vem do banco, lista paginada", () => {
  it("58 lançamentos: banner = R$ 845,00 do summary (e NÃO R$ 765,00 da lista truncada); '50 de 58'; carregar mais traz os 8", async () => {
    // A soma da lista truncada é exatamente o valor errado que o app mostrava antes.
    const naive = page1.filter((r) => r.status === "PENDING" || r.status === "OVERDUE").reduce((s, r) => s + r.amountCents, 0);
    expect(naive).toBe(76500);

    mockApi(financeApi());
    render(<FinancialPage />);
    await waitFor(() => expect(text()).toContain("Você tem R$ 845,00 em aberto"));
    expect(text()).not.toContain("765,00");
    expect(text()).toContain("27 em atraso (R$ 806,75) · Vencimento mais antigo: 05 de janeiro de 2018");

    // pediu o resumo agregado e a 1ª página com limit/offset
    expect(callsTo("/finance/me/summary")).toHaveLength(1);
    const listCall = callsTo("/finance/me")[0]!;
    expect(listCall.searchParams.get("limit")).toBe("50");
    expect(listCall.searchParams.get("offset")).toBe("0");

    // aviso de truncamento com o total real; a lista tem 50 linhas
    expect(rows()).toBe(50);
    expect(text()).toContain("Mostrando 50 de 58 lançamentos");

    await clickButton(/Carregar mais/);
    await waitFor(() => expect(rows()).toBe(58));
    expect(callsTo("/finance/me").map((u) => u.searchParams.get("offset"))).toEqual(["0", "50"]);
    expect(text()).not.toContain("Mostrando"); // completo: sem aviso nem botão
    expect(button(/Carregar mais/)).toBeUndefined();
    expect(text()).toContain("Você tem R$ 845,00 em aberto"); // o banner não muda ao paginar
  });

  it("status exibido: PENDING vencido aparece como Atrasado; PENDING futuro como Em aberto", async () => {
    mockApi(financeApi());
    render(<FinancialPage />);
    await waitFor(() => expect(rows()).toBe(50));
    const badges = [...container!.querySelectorAll("tbody .badge")].map((b) => b.textContent);
    expect(badges.filter((b) => b === "Em aberto")).toHaveLength(1); // só o de 2099
    expect(badges.filter((b) => b === "Atrasado")).toHaveLength(19);
    expect(badges.filter((b) => b === "Pago")).toHaveLength(30);
  });

  it("sem dívida: 'em dia' e sem vencimento; resumo com falha NÃO vira soma da lista (mostra erro)", async () => {
    mockApi(
      financeApi({
        summary: {
          body: { ...summary, openCents: 0, openCount: 0, overdueCents: 0, overdueCount: 0, oldestOpenDueDate: null },
        },
      }),
    );
    render(<FinancialPage />);
    await waitFor(() => expect(text()).toContain("Sua mensalidade está em dia"));
    expect(text()).toContain("Nenhuma cobrança pendente.");
    act(() => root?.unmount());
    container?.remove();

    mockApi(financeApi({ summary: { status: 500, body: { message: "falhou" } } }));
    render(<FinancialPage />);
    await waitFor(() => expect(text()).toContain("falhou"));
    expect(text()).not.toContain("Você tem");
    expect(text()).not.toContain("Sua mensalidade está em dia");
  });
});

/* -------------------------------- Frequência ------------------------------ */

const att = (id: number, date: string, present: boolean): AttendanceRecord => ({
  id,
  lessonId: id,
  present,
  justification: present ? null : "Doente",
  lesson: { date, classId: 1 },
});

describe("Frequência: período pedido ao servidor, sequência e % vêm agregados", () => {
  const now = new Date();
  const monthKey = fmt(now, "yyyy-MM");
  const firstDay = `${monthKey}-01`;
  const lastDay = fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0), "yyyy-MM-dd");

  it("pede só o mês escolhido (from/to, limit=200) e exibe a sequência (63) e os 30 dias (88%) calculados pelo servidor", async () => {
    mockApi((url) =>
      url.pathname === "/attendance/me"
        ? {
            body: {
              records: [att(1, `${monthKey}-02T00:00:00.000Z`, true), att(2, `${monthKey}-01T00:00:00.000Z`, false)],
              last30dPercent: 88,
              currentStreak: 63,
            },
            total: 2,
          }
        : undefined,
    );
    render(<AttendancePage />);
    await waitFor(() => expect(text()).toContain("88% nos últimos 30 dias"));
    const call = callsTo("/attendance/me")[0]!;
    expect(call.searchParams.get("from")).toBe(firstDay);
    expect(call.searchParams.get("to")).toBe(lastDay);
    expect(call.searchParams.get("limit")).toBe("200");
    // sequência 63 > qualquer página: vem do servidor, não de contar a lista local (que daria 1)
    const streak = [...container!.querySelectorAll(".stat")].find((s) => s.textContent?.includes("Sequência atual"));
    expect(streak?.querySelector(".stat-value")?.textContent).toBe("63");
    // estatística do mês sobre os registros do mês: 1 presença de 2 = 50%
    expect(text()).toContain("de 2 registradas no mês");
    expect(text()).not.toContain("Exibindo"); // 2 de 2: sem aviso de truncamento
  });

  it("trocar o mês pede outro intervalo; mês com mais registros que o limite avisa 'Exibindo 200 de 250'", async () => {
    mockApi((url) => {
      if (url.pathname !== "/attendance/me") return undefined;
      const isCurrent = url.searchParams.get("from") === firstDay;
      return {
        body: {
          records: Array.from({ length: isCurrent ? 2 : 200 }, (_, i) => att(i + 1, `${url.searchParams.get("from")}T00:00:00.000Z`, true)),
          last30dPercent: 100,
          currentStreak: 5,
        },
        total: isCurrent ? 2 : 250,
      };
    });
    render(<AttendancePage />);
    await waitFor(() => expect(callsTo("/attendance/me")).toHaveLength(1));

    const select = container!.querySelector<HTMLSelectElement>('select[aria-label="Mês de frequência"]')!;
    expect(select.options).toHaveLength(12);
    const previous = select.options[1]!.value; // mês anterior
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, previous);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitFor(() => expect(text()).toContain("Exibindo 200 de 250 registros deste mês."));
    const second = callsTo("/attendance/me")[1]!;
    expect(second.searchParams.get("from")).toBe(`${previous}-01`);
  });
});

/* ---------------------------------- Aulas --------------------------------- */

const lesson = (id: number, date: string): Lesson => ({
  id,
  classId: 1,
  unitId: null,
  teacherUserId: null,
  date,
  startTime: null,
  endTime: null,
  notes: `Aula ${id}`,
  status: "ACTIVE",
});

describe("Aulas: próximas e anteriores vêm de consultas por período", () => {
  it("pede 'de hoje em diante' (asc) e 'até ontem' (desc, 10) separadamente; 70 próximas => '50 de 70' + carregar mais", async () => {
    const today = fmt(startOfToday(), "yyyy-MM-dd");
    mockApi((url) => {
      if (url.pathname === "/lessons/me") {
        if (url.searchParams.get("from")) {
          const offset = Number(url.searchParams.get("offset"));
          const count = offset === 0 ? 50 : 20;
          return {
            body: Array.from({ length: count }, (_, i) => lesson(1000 + offset + i, "2099-01-01T00:00:00.000Z")),
            total: 70,
          };
        }
        return { body: [lesson(1, "2000-01-01T00:00:00.000Z")], total: 1 };
      }
      if (url.pathname === "/classes/me") return { body: [{ id: 1, name: "Adulto", description: null, weekday: 4, startTime: "19:00", endTime: "20:00", unitId: null }] };
      if (url.pathname === "/passport/me") return { body: null };
      return undefined;
    });
    render(<ClassesPage />);
    await waitFor(() => expect(text()).toContain("Mostrando 50 de 70 aulas"));

    const upcoming = callsTo("/lessons/me").find((u) => u.searchParams.get("from"))!;
    expect(upcoming.searchParams.get("from")).toBe(today);
    expect(upcoming.searchParams.get("order")).toBe("asc");
    const past = callsTo("/lessons/me").find((u) => u.searchParams.get("to"))!;
    expect(past.searchParams.get("order")).toBe("desc");
    expect(past.searchParams.get("limit")).toBe("10");
    expect(Number(new Date(`${past.searchParams.get("to")}T00:00:00`)) < Number(startOfToday())).toBe(true); // até ONTEM

    expect(container!.querySelectorAll(".class-card")).toHaveLength(51); // 50 próximas + 1 anterior
    expect(text()).toContain("Próxima aula");

    await clickButton(/Carregar mais/);
    await waitFor(() => expect(container!.querySelectorAll(".class-card")).toHaveLength(71));
    expect(text()).not.toContain("Mostrando 50 de 70");
  });
});

/* ------------------------------- Notificações ----------------------------- */

const note = (id: number, readAt: string | null = null): NotificationDto => ({
  id,
  title: `Recado ${id}`,
  body: "corpo",
  type: null,
  readAt,
  createdAt: "2026-10-01T10:00:00.000Z",
});

describe("Notificações: não lidas contadas no banco, lista paginada", () => {
  it("58 notificações: mostra '55 novos recados' do unread-count (lista de 50 teria 47); '50 de 58' e carregar mais", async () => {
    mockApi((url) => {
      if (url.pathname === "/notifications/unread-count") return { body: { count: 55 } };
      if (url.pathname === "/notifications") {
        const offset = Number(url.searchParams.get("offset"));
        const count = offset === 0 ? 50 : 8;
        return { body: Array.from({ length: count }, (_, i) => note(offset + i + 1, i % 20 === 5 && offset === 0 ? "2026-10-02T00:00:00.000Z" : null)), total: 58 };
      }
      if (url.pathname === "/announcements") return { body: [] };
      if (url.pathname === "/students/me") return { body: [] };
      if (url.pathname === "/passport/me") return { body: null };
      return undefined;
    });
    render(<NotificationsPage />);
    await waitFor(() => expect(text()).toContain("55 novos recados"));
    expect(container!.querySelectorAll(".notice-item")).toHaveLength(50);
    expect(text()).toContain("Mostrando 50 de 58 notificações");

    await clickButton(/Carregar mais/);
    await waitFor(() => expect(container!.querySelectorAll(".notice-item")).toHaveLength(58));
    expect(text()).toContain("55 novos recados");
    expect(text()).not.toContain("Mostrando");
  });

  it("servidor sem X-Total-Count: página cheia (50) ainda oferece 'Carregar mais'; página parcial encerra", async () => {
    mockApi((url) => {
      if (url.pathname === "/notifications") {
        const offset = Number(url.searchParams.get("offset"));
        return { body: Array.from({ length: offset === 0 ? 50 : 3 }, (_, i) => note(offset + i + 1)) }; // sem total
      }
      if (url.pathname === "/notifications/unread-count") return { body: { count: 53 } };
      if (url.pathname === "/announcements") return { body: [] };
      if (url.pathname === "/students/me") return { body: [] };
      if (url.pathname === "/passport/me") return { body: null };
      return undefined;
    });
    render(<NotificationsPage />);
    await waitFor(() => expect(container!.querySelectorAll(".notice-item")).toHaveLength(50));
    expect(button(/Carregar mais/)).toBeTruthy();
    await clickButton(/Carregar mais/);
    await waitFor(() => expect(container!.querySelectorAll(".notice-item")).toHaveLength(53));
    expect(button(/Carregar mais/)).toBeUndefined();
  });
});

/* --------------------------------- Eventos -------------------------------- */

const ev = (id: number): EventDto => ({
  id,
  title: `Evento ${id}`,
  type: "WORKSHOP",
  description: null,
  date: `2026-12-${String((id % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
  location: "Ginásio",
  imageUrl: null,
  isPublic: true,
});

describe("/eventos: lista paginada com o total real", () => {
  it("63 eventos: '50 de 63 encontros' e, ao carregar mais, os 13 restantes (sem mexer nos participantes)", async () => {
    mockApi((url) => {
      if (url.pathname === "/events") {
        const offset = Number(url.searchParams.get("offset"));
        return { body: Array.from({ length: offset === 0 ? 50 : 13 }, (_, i) => ev(offset + i + 1)), total: 63 };
      }
      if (/\/participants$/.test(url.pathname)) return { body: [] };
      if (url.pathname === "/students/me") return { body: [] };
      if (url.pathname === "/rodas/reference/states") return { body: [] };
      return undefined;
    });
    render(<DiscoveryPage mode="events" />);
    await waitFor(() => expect(text()).toContain("Mostrando 50 de 63 encontros"));
    expect(container!.querySelectorAll(".discovery-grid > *")).toHaveLength(50);
    const first = callsTo("/events")[0]!;
    expect(first.searchParams.get("limit")).toBe("50");
    // próximos primeiro: o servidor pagina na mesma ordem que a tela mostra
    expect(first.searchParams.get("order")).toBe("asc");
    expect(first.searchParams.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // só a aba ativa busca: nada de /calendar nem /rodas
    expect(callsTo("/calendar")).toHaveLength(0);
    expect(callsTo("/rodas")).toHaveLength(0);

    await clickButton(/Carregar mais/);
    await waitFor(() => expect(container!.querySelectorAll(".discovery-grid > *")).toHaveLength(63));
    expect(text()).not.toContain("Mostrando 50 de 63");
  });

  it("Comunidade: /calendar paginado ('50 de 120'); aba Rodas usa /calendar?type=RODA (só futuras) em vez do /rodas completo", async () => {
    mockApi((url) => {
      if (url.pathname === "/calendar") {
        const offset = Number(url.searchParams.get("offset"));
        return {
          body: Array.from({ length: offset === 0 ? 50 : 50 }, (_, i) => ({
            id: offset + i + 1,
            source: url.searchParams.get("type") === "RODA" ? "RODA" : "EVENTO",
            type: url.searchParams.get("type") === "RODA" ? "RODA" : "WORKSHOP",
            title: `Item ${offset + i + 1}`,
            description: null,
            date: "2026-12-01T00:00:00.000Z",
            location: null,
            imageUrl: null,
            state: null,
            city: null,
          })),
          total: 120,
        };
      }
      if (/\/participants$/.test(url.pathname)) return { body: [] };
      if (url.pathname === "/students/me") return { body: [] };
      if (url.pathname === "/rodas/reference/states") return { body: [] };
      return undefined;
    });
    render(<DiscoveryPage mode="community" />);
    await waitFor(() => expect(text()).toContain("Mostrando 50 de 120 encontros"));
    act(() => root?.unmount());
    container?.remove();

    render(<DiscoveryPage mode="rodas" />);
    await waitFor(() => expect(text()).toContain("Mostrando 50 de 120 rodas"));
    expect(callsTo("/calendar").some((u) => u.searchParams.get("type") === "RODA")).toBe(true);
    expect(callsTo("/rodas")).toHaveLength(0);
  });
});

/* ------------------- Participação: resumo da listagem, sem N+1 ------------------- */

const evp = (id: number, participantsCount: number, myParticipation: EventDto["myParticipation"] = null): EventDto => ({
  ...ev(id),
  participantsCount,
  myParticipation,
});
const participantCalls = () => calls.filter((u) => /\/participants/.test(u.pathname));
const bodyButton = (name: RegExp) => [...document.body.querySelectorAll("button")].find((b) => name.test(b.textContent ?? ""));
const clickBody = async (name: RegExp) => {
  const el = bodyButton(name);
  expect(el, `botão ${String(name)}`).toBeTruthy();
  await act(async () => el!.click());
};
const login = (id = 7, name = "Aluno Teste") =>
  localStorage.setItem("mb_user", JSON.stringify({ id, name, email: "a@x", userType: "MEMBER", isSuperAdmin: false, organizationSlug: "x", organizationId: 1, role: "ALUNO" }));

describe("Participação em eventos/rodas: contagem e 'inscrito' vêm da listagem (sem GET /participants por card)", () => {
  it("/events com 50 cards: ZERO chamadas a /participants; contagem = participantsCount; 'Confirmado' = myParticipation; sem iniciais de terceiros", async () => {
    login();
    const items = Array.from({ length: 50 }, (_, i) =>
      i === 3 ? evp(i + 1, 9, { id: 901, studentId: 5, status: "CONFIRMED" }) : evp(i + 1, i === 0 ? 0 : i % 5),
    );
    mockApi((url) => {
      if (url.pathname === "/events") return { body: items, total: 50 };
      if (/\/participants/.test(url.pathname)) return { body: [{ id: 1, userId: null, studentId: null, guestName: null, status: "CONFIRMED" }] };
      if (url.pathname === "/students/me") return { body: [{ id: 5, userId: 7, unitId: 1, name: "Aluno Teste", photo: null, coverPhoto: null, socialLinks: null, joinedAt: null }] };
      if (url.pathname === "/rodas/reference/states") return { body: [] };
      return undefined;
    });
    render(<DiscoveryPage mode="events" />);
    await waitFor(() => expect(container!.querySelectorAll(".discovery-grid > *")).toHaveLength(50));
    await waitFor(() => expect(callsTo("/students/me").length).toBeGreaterThan(0));

    expect(participantCalls()).toHaveLength(0); // era 1 por card (N+1 => 429)
    expect(container!.textContent).toContain("9 na roda");
    expect(container!.querySelectorAll(".tiny-avatars")).toHaveLength(0);
    // exatamente 1 card inscrito
    expect([...container!.querySelectorAll("button")].filter((b) => /Confirmado/.test(b.textContent ?? ""))).toHaveLength(1);
  });

  it("inscrever e cancelar: POST com studentId, DELETE pelo id da myParticipation (sem listar ninguém) e /events é refeito", async () => {
    login();
    let mine: EventDto["myParticipation"] = null;
    let count = 4;
    const writes: string[] = [];
    mockApi((url) => {
      const method = (vi.mocked(fetch).mock.calls.at(-1)?.[1] as RequestInit | undefined)?.method ?? "GET";
      if (url.pathname === "/events") return { body: [evp(1, count, mine)], total: 1 };
      if (url.pathname === "/events/1/participants" && method === "POST") {
        writes.push(`POST ${url.pathname} ${String((vi.mocked(fetch).mock.calls.at(-1)?.[1] as RequestInit).body)}`);
        mine = { id: 777, studentId: 5, status: "CONFIRMED" };
        count += 1;
        return { body: { id: 777 } };
      }
      if (url.pathname === "/events/1/participants/777" && method === "DELETE") {
        writes.push(`DELETE ${url.pathname}`);
        mine = null;
        count -= 1;
        return { body: undefined };
      }
      if (url.pathname === "/students/me") return { body: [{ id: 5, userId: 7, unitId: 1, name: "Aluno Teste", photo: null, coverPhoto: null, socialLinks: null, joinedAt: null }] };
      if (url.pathname === "/rodas/reference/states") return { body: [] };
      return undefined;
    });
    render(<DiscoveryPage mode="events" />);
    await waitFor(() => expect(text()).toContain("4 na roda"));
    await clickButton(/Ver detalhes/);
    await waitFor(() => expect(bodyButton(/Quero participar/)).toBeTruthy());
    const listsBefore = callsTo("/events").length;

    await clickBody(/Quero participar/);
    await waitFor(() => expect(text()).toContain("5 na roda"));
    expect(writes).toEqual(['POST /events/1/participants {"studentId":5}']);
    expect(callsTo("/events").length).toBeGreaterThan(listsBefore); // cache certo invalidado
    expect(bodyButton(/Cancelar participação/)).toBeTruthy();

    await clickBody(/Cancelar participação/);
    await waitFor(() => expect(text()).toContain("4 na roda"));
    expect(writes[1]).toBe("DELETE /events/1/participants/777");
    expect(participantCalls().filter((u) => !/participants\/777$/.test(u.pathname) && u.pathname !== "/events/1/participants")).toHaveLength(0);
    // nenhum GET de lista de participantes em todo o fluxo
    expect(vi.mocked(fetch).mock.calls.filter(([u, init]) => /\/participants/.test(String(u)) && ((init as RequestInit | undefined)?.method ?? "GET") === "GET")).toHaveLength(0);
  });

  it("fonte sem resumo (/calendar): nada de /participants ao listar; ao abrir os detalhes consulta SÓ aquele card e acha a própria inscrição", async () => {
    login();
    mockApi((url) => {
      if (url.pathname === "/calendar") {
        return {
          body: Array.from({ length: 12 }, (_, i) => ({
            id: i + 1, source: "RODA", type: "RODA", title: `Roda ${i + 1}`, description: null,
            date: "2026-12-01T00:00:00.000Z", location: null, imageUrl: null, state: null, city: null,
          })),
          total: 12,
        };
      }
      if (url.pathname === "/rodas/3/participants") {
        return { body: [{ id: 41, userId: null, studentId: null, guestName: null, status: "CONFIRMED" }, { id: 42, userId: 7, studentId: null, guestName: null, status: "CONFIRMED" }] };
      }
      if (url.pathname === "/students/me") return { body: [] };
      if (url.pathname === "/rodas/reference/states") return { body: [] };
      return undefined;
    });
    render(<DiscoveryPage mode="rodas" />);
    await waitFor(() => expect(container!.querySelectorAll(".discovery-grid > *")).toHaveLength(12));
    expect(participantCalls()).toHaveLength(0);

    await act(async () => [...container!.querySelectorAll("button")].filter((b) => /Ver detalhes/.test(b.textContent ?? ""))[2]!.click());
    await waitFor(() => expect(document.body.textContent).toContain("2 participantes"));
    expect(participantCalls().map((u) => u.pathname)).toEqual(["/rodas/3/participants"]);
    expect(bodyButton(/Cancelar participação/)).toBeTruthy(); // userId 7 = eu
  });
});
