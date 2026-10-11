import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AttendancePage, ClassesPage, FinancialPage } from "@/components/gingapp/pages";
import { StudentSwitcher } from "@/components/gingapp/app-shell";
import { DiscoveryPage } from "@/components/gingapp/discovery";
import { JourneyPage } from "@/components/gingapp/journey";
import { resolveActiveStudent, sortStudents, type Student } from "@/lib/queries";
import { clearSession, getStoredStudentId, setStoredStudentId } from "@/lib/session";

/**
 * Seletor de dependente: um RESPONSAVEL com 2+ alunos escolhe o aluno ativo e TODAS as telas que
 * dependem de um aluno seguem essa escolha (mesma regra, lista e banner no mesmo escopo). Aqui o
 * fetch é mockado POR studentId: o teste só passa se o app mandar o ?studentId= certo em cada chamada.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USER_ID = 7;
const st = (id: number, name: string, userId: number | null = null): Student => ({
  id,
  userId,
  unitId: 1,
  name,
  photo: null,
  coverPhoto: null,
  socialLinks: null,
  joinedAt: null,
});
// A API devolve Bruno (id 11) ANTES de Alice (id 12): por nome o primeiro é Alice — não o students[0] da API.
const BRUNO = st(11, "Bruno");
const ALICE = st(12, "Alice");
const API_ORDER = [BRUNO, ALICE];

interface Route {
  body: unknown;
  total?: number;
  status?: number;
}
type Handler = (url: URL, init: RequestInit | undefined) => Route | undefined;
interface Call {
  url: URL;
  method: string;
  body: string | null;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let calls: Call[] = [];

function mockApi(handler: Handler) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input).replace(/^.*\/api/, "http://x"));
      calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
      const route = handler(url, init) ?? { body: [], total: 0 };
      return new Response(JSON.stringify(route.body), {
        status: route.status ?? 200,
        headers: route.total === undefined ? {} : { "X-Total-Count": String(route.total) },
      });
    }),
  );
}

const callsTo = (path: string) => calls.filter((c) => c.url.pathname === path);
const sid = (c: Call) => c.url.searchParams.get("studentId");

function render(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>));
}
const unmount = () => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
};

const text = () => (container?.textContent ?? "").replace(/\u00a0/g, " ");
const waitFor = (assertion: () => void) => act(async () => void (await vi.waitFor(assertion, { timeout: 3000 })));
const select = () => container!.querySelector<HTMLSelectElement>('select[aria-label="Aluno ativo"]');
const choose = async (value: number) =>
  act(async () => {
    const el = select()!;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, String(value));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });

const login = (role: "RESPONSAVEL" | "ALUNO" = "RESPONSAVEL") =>
  localStorage.setItem(
    "mb_user",
    JSON.stringify({ id: USER_ID, name: "Carlos Responsável", email: "c@x", userType: "MEMBER", isSuperAdmin: false, organizationSlug: "x", organizationId: 1, role }),
  );

beforeEach(() => {
  clearSession(); // limpa também a escolha em memória (fallback de storage quebrado)
  localStorage.clear();
  login();
});
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

/* ---------------------------------- lógica pura --------------------------------- */

describe("ordem e escolha do aluno ativo", () => {
  it("ordem determinística: nome (sem distinguir caixa/acento) e, no empate, id", () => {
    const list = [st(5, "carlos"), st(9, "Ana"), st(3, "Ana"), st(4, "Álvaro"), st(2, "bia")];
    expect(sortStudents(list).map((s) => `${s.name}#${s.id}`)).toEqual(["Álvaro#4", "Ana#3", "Ana#9", "bia#2", "carlos#5"]);
    // não depende da ordem de entrada
    expect(sortStudents([...list].reverse()).map((s) => s.id)).toEqual(sortStudents(list).map((s) => s.id));
    expect(list[0]!.id).toBe(5); // não muta a entrada
  });

  it("escolha guardada vence; inválida cai no PRÓPRIO aluno; sem próprio, no primeiro por nome", () => {
    const own = st(20, "Zeca", USER_ID);
    expect(resolveActiveStudent(API_ORDER, USER_ID, 11)?.id).toBe(11);
    expect(resolveActiveStudent(API_ORDER, USER_ID, null)?.id).toBe(12); // Alice, e não API_ORDER[0] (Bruno)
    expect(resolveActiveStudent(API_ORDER, USER_ID, 999)?.id).toBe(12); // id guardado que não é mais da conta
    expect(resolveActiveStudent([...API_ORDER, own], USER_ID, null)?.id).toBe(20); // próprio aluno primeiro
    expect(resolveActiveStudent([...API_ORDER, own], USER_ID, 11)?.id).toBe(11);
    expect(resolveActiveStudent([], USER_ID, 11)).toBeNull();
    expect(resolveActiveStudent(undefined, USER_ID)).toBeNull();
  });

  it("persistência por usuário e à prova de storage quebrado (try/catch)", () => {
    setStoredStudentId(USER_ID, 11);
    expect(getStoredStudentId(USER_ID)).toBe(11);
    expect(getStoredStudentId(8)).toBeNull(); // outro usuário não herda
    localStorage.setItem("mb_active_student:7", "lixo");
    expect(getStoredStudentId(USER_ID)).toBeNull();

    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      expect(() => setStoredStudentId(USER_ID, 12)).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
    const getter = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("SecurityError");
    };
    try {
      expect(getStoredStudentId(USER_ID)).toBeNull();
    } finally {
      Storage.prototype.getItem = getter;
    }
  });
});

/* ------------------------------------ telas ------------------------------------- */

const money = (cents: number) => ({ id: cents, description: `Mens ${cents}`, amountCents: cents, type: "M", dueDate: "2099-12-10T00:00:00.000Z", paidAt: null, status: "PENDING" as const });
const summaryOf = (cents: number) => ({
  openCents: cents, openCount: 1, overdueCents: 0, overdueCount: 0, paidCents: 0, paidCount: 0, oldestOpenDueDate: "2099-12-10T00:00:00.000Z",
});
const SUMMARY: Record<string, number> = { "12": 10000, "11": 30000 }; // Alice R$ 100,00 / Bruno R$ 300,00

function guardianApi(students: Student[] = API_ORDER): Handler {
  return (url) => {
    const id = url.searchParams.get("studentId") ?? "";
    switch (url.pathname) {
      case "/students/me":
        return { body: students };
      case "/finance/me":
        return id in SUMMARY ? { body: [money(SUMMARY[id]!)], total: 1 } : { body: [money(777), money(888)], total: 2 }; // sem studentId = agregado (NUNCA deve acontecer)
      case "/finance/me/summary":
        return { body: summaryOf(id in SUMMARY ? SUMMARY[id]! : 99900) };
      case "/passport/me":
        return { body: { student: { id: Number(id), name: id === "12" ? "Alice" : "Bruno" }, organization: { name: "Grupo" }, unit: null, currentGraduation: null, stats: { aulas: 0, rodas: 0, eventos: 0, graduacoes: 0, certificados: 0 }, publicProfile: null } };
      case "/attendance/me":
        return { body: { records: [], last30dPercent: id === "12" ? 88 : 44, currentStreak: id === "12" ? 8 : 4 }, total: 0 };
      case "/certificates/me":
        return {
          body: [
            { id: 1, studentId: 12, title: "Certificado da Alice", issuedAt: null, verificationCode: "A" },
            { id: 2, studentId: 11, title: "Certificado do Bruno", issuedAt: null, verificationCode: "B" },
          ],
        };
      case "/lessons/me":
        return { body: [{ id: id === "12" ? 501 : 601, classId: 1, unitId: null, teacherUserId: null, date: "2099-01-01T00:00:00.000Z", startTime: null, endTime: null, notes: id === "12" ? "Aula da Alice" : "Aula do Bruno", status: "ACTIVE" }], total: 1 };
      default:
        if (url.pathname.startsWith("/graduations/students/")) {
          const gid = url.pathname.split("/").pop();
          return { body: [{ id: 1, graduatedAt: "2025-01-01T00:00:00.000Z", notes: null, graduationLevel: { id: 1, name: gid === "12" ? "Faixa da Alice" : "Faixa do Bruno", order: 1, color: null } }] };
        }
        return undefined;
    }
  };
}

describe("Responsável com 2 dependentes: o aluno ativo guia as telas", () => {
  it("financeiro: padrão = 1º por nome (Alice); trocar muda lista E banner; toda chamada leva studentId; recarregar mantém a escolha", async () => {
    mockApi(guardianApi());
    const page = (
      <>
        <StudentSwitcher />
        <FinancialPage />
      </>
    );
    render(page);
    await waitFor(() => expect(text()).toContain("Você tem R$ 100,00 em aberto"));
    expect(text()).toContain("Mens 10000");
    expect(select()!.value).toBe("12");
    expect([...select()!.options].map((o) => o.textContent)).toEqual(["Alice", "Bruno"]);

    await choose(11);
    await waitFor(() => expect(text()).toContain("Você tem R$ 300,00 em aberto"));
    expect(text()).toContain("Mens 30000");
    expect(text()).not.toContain("Mens 10000");
    expect(text()).not.toContain("R$ 100,00");
    expect(localStorage.getItem("mb_active_student:7")).toBe("11");

    // lista e resumo SEMPRE no mesmo escopo; nenhuma chamada agregada (sem studentId)
    const finance = [...callsTo("/finance/me"), ...callsTo("/finance/me/summary")];
    expect(finance.length).toBeGreaterThanOrEqual(4);
    expect(finance.every((c) => sid(c) === "12" || sid(c) === "11")).toBe(true);
    expect(callsTo("/finance/me").map(sid)).toEqual(["12", "11"]);
    expect(callsTo("/finance/me/summary").map(sid)).toEqual(["12", "11"]);

    // "recarregar a página": monta de novo, mesma sessão/localStorage => continua em Bruno
    unmount();
    mockApi(guardianApi());
    render(page);
    await waitFor(() => expect(text()).toContain("Você tem R$ 300,00 em aberto"));
    expect(select()!.value).toBe("11");
    expect(callsTo("/finance/me").map(sid)).toEqual(["11"]); // nunca buscou o outro aluno nem o agregado
  });

  it("jornada: passaporte, graduações, frequência e certificados são do aluno ativo (certificados do irmão não aparecem)", async () => {
    mockApi(guardianApi());
    render(
      <>
        <StudentSwitcher />
        <JourneyPage />
      </>,
    );
    await waitFor(() => expect(text()).toContain("Faixa da Alice"));
    expect(text()).toContain("88%");
    expect(text()).toContain("Certificado da Alice");
    expect(text()).not.toContain("Certificado do Bruno");

    await choose(11);
    await waitFor(() => expect(text()).toContain("Faixa do Bruno"));
    expect(text()).toContain("44%");
    expect(text()).toContain("Certificado do Bruno");
    expect(text()).not.toContain("Certificado da Alice");
    expect(text()).not.toContain("Faixa da Alice");

    expect(callsTo("/passport/me").map(sid)).toEqual(["12", "11"]);
    expect(callsTo("/attendance/me").map(sid)).toEqual(["12", "11"]);
    expect(calls.filter((c) => c.url.pathname.startsWith("/graduations/students/")).map((c) => c.url.pathname)).toEqual([
      "/graduations/students/12",
      "/graduations/students/11",
    ]);
  });

  it("frequência e aulas: toda chamada (próximas e anteriores) leva o studentId do aluno ativo e a lista troca", async () => {
    localStorage.setItem("mb_active_student:7", "11");
    mockApi(guardianApi());
    render(
      <>
        <AttendancePage />
        <ClassesPage />
      </>,
    );
    await waitFor(() => expect(text()).toContain("44% nos últimos 30 dias"));
    await waitFor(() => expect(text()).toContain("Aula do Bruno"));
    expect(callsTo("/attendance/me").every((c) => sid(c) === "11")).toBe(true);
    expect(callsTo("/lessons/me").length).toBeGreaterThanOrEqual(2); // próximas + anteriores
    expect(callsTo("/lessons/me").every((c) => sid(c) === "11")).toBe(true);
  });

  it("nada dispara antes de /students/me responder (senão a 1ª chamada traria o agregado dos dois dependentes)", async () => {
    mockApi(guardianApi());
    render(<FinancialPage />);
    await waitFor(() => expect(text()).toContain("Você tem R$ 100,00 em aberto"));
    const first = calls.findIndex((c) => c.url.pathname === "/finance/me");
    expect(calls.findIndex((c) => c.url.pathname === "/students/me")).toBeLessThan(first);
    expect(calls.filter((c) => c.url.pathname !== "/students/me" && c.url.pathname !== "/organizations").every((c) => c.url.searchParams.has("studentId"))).toBe(true);
  });
});

describe("Financeiro: próximos vencimentos e Como pagar (E07)", () => {
  it("mostra o texto do grupo (GET /organizations) e o próximo vencimento; sem texto, o bloco some", async () => {
    const base = guardianApi();
    mockApi((url, init) =>
      url.pathname === "/organizations"
        ? { body: { id: 1, name: "Grupo", paymentInstructions: "PIX: 62999990000\nEnvie o comprovante." } }
        : base(url, init),
    );
    render(<FinancialPage />);
    await waitFor(() => expect(text()).toContain("Como pagar"));
    expect(container!.querySelector('[data-testid="how-to-pay"]')!.textContent).toContain("PIX: 62999990000");
    expect(container!.querySelector('[data-testid="upcoming-dues"]')!.textContent).toContain("Mens 10000");
    unmount();

    mockApi((url, init) =>
      url.pathname === "/organizations" ? { body: { id: 1, name: "Grupo", paymentInstructions: null } } : base(url, init),
    );
    render(<FinancialPage />);
    await waitFor(() => expect(text()).toContain("Você tem R$ 100,00 em aberto"));
    expect(text()).not.toContain("Como pagar");
  });
});

describe("Sem seletor quando não há o que escolher", () => {
  it("ALUNO (um vínculo): sem seletor; as telas usam o próprio aluno", async () => {
    login("ALUNO");
    mockApi(guardianApi([st(12, "Alice", USER_ID)]));
    render(
      <>
        <StudentSwitcher />
        <FinancialPage />
      </>,
    );
    await waitFor(() => expect(text()).toContain("Você tem R$ 100,00 em aberto"));
    expect(select()).toBeNull();
    expect(container!.querySelector('[data-testid="student-switcher"]')).toBeNull();
    expect(callsTo("/finance/me").map(sid)).toEqual(["12"]);
  });

  it("responsável com 1 dependente: sem seletor", async () => {
    mockApi(guardianApi([BRUNO]));
    render(
      <>
        <StudentSwitcher />
        <FinancialPage />
      </>,
    );
    await waitFor(() => expect(text()).toContain("Você tem R$ 300,00 em aberto"));
    expect(container!.querySelector('[data-testid="student-switcher"]')).toBeNull();
  });

  it("sem aluno ligado: nenhuma chamada agregada, telas mostram o vazio", async () => {
    mockApi(guardianApi([]));
    render(<FinancialPage />);
    await waitFor(() => expect(callsTo("/finance/me").length).toBeGreaterThan(0));
    expect(callsTo("/finance/me").map(sid)).toEqual([null]); // servidor responde vazio para quem não tem vínculo
  });
});

/* -------------------------------- eventos / inscrição -------------------------------- */

const ev = (myParticipation: unknown) => ({
  id: 1,
  title: "Batizado",
  type: "BATIZADO",
  description: null,
  date: "2099-12-01T00:00:00.000Z",
  location: "Ginásio",
  imageUrl: null,
  isPublic: true,
  participantsCount: 1,
  myParticipation,
});
const buttons = () => [...document.body.querySelectorAll("button")];
const clickBody = async (name: RegExp) => {
  const el = buttons().find((b) => name.test(b.textContent ?? ""));
  expect(el, `botão ${String(name)}`).toBeTruthy();
  await act(async () => el!.click());
};

describe("Inscrição em evento usa o aluno ativo", () => {
  it("irmão inscrito (Alice) e Bruno ativo: NÃO mostra 'Confirmado', consulta a lista só desse card e o POST grava studentId do Bruno", async () => {
    localStorage.setItem("mb_active_student:7", "11");
    let posted = false;
    mockApi((url, init) => {
      if (url.pathname === "/events") return { body: [ev({ id: 900, studentId: 12, status: "CONFIRMED" })], total: 1 };
      if (url.pathname === "/events/1/participants" && init?.method === "POST") {
        posted = true;
        return { body: { id: 901 } };
      }
      if (url.pathname === "/events/1/participants") return { body: [{ id: 900, userId: null, studentId: 12, guestName: null, status: "CONFIRMED" }] };
      return guardianApi()(url, init);
    });
    render(<DiscoveryPage mode="events" />);
    await waitFor(() => expect(callsTo("/events/1/participants").length).toBeGreaterThan(0));
    expect(text()).not.toContain("Confirmado");

    await act(async () => buttons().find((b) => /Ver detalhes/.test(b.textContent ?? ""))!.click());
    await clickBody(/Quero participar/);
    expect(posted).toBe(true);
    expect(calls.find((c) => c.method === "POST")?.body).toBe('{"studentId":11}');
  });

  it("aluno ativo é o inscrito (Alice): 'Confirmado' sem nenhuma consulta de participantes; cancelar apaga a inscrição DELA", async () => {
    mockApi((url, init) => {
      if (url.pathname === "/events") return { body: [ev({ id: 900, studentId: 12, status: "CONFIRMED" })], total: 1 };
      if (url.pathname === "/events/1/participants/900" && init?.method === "DELETE") return { body: undefined };
      return guardianApi()(url, init);
    });
    render(<DiscoveryPage mode="events" />);
    await waitFor(() => expect(text()).toContain("Confirmado"));
    expect(calls.filter((c) => /\/participants/.test(c.url.pathname))).toHaveLength(0);

    await act(async () => buttons().find((b) => /Confirmado/.test(b.textContent ?? ""))!.click());
    await clickBody(/Cancelar participação/);
    expect(calls.some((c) => c.method === "DELETE" && c.url.pathname === "/events/1/participants/900")).toBe(true);
  });

  it("ninguém da conta inscrito: 'Quero participar' posta o studentId do ativo, sem consultar participantes antes", async () => {
    mockApi((url, init) => {
      if (url.pathname === "/events") return { body: [ev(null)], total: 1 };
      if (url.pathname === "/events/1/participants" && init?.method === "POST") return { body: { id: 5 } };
      return guardianApi()(url, init);
    });
    render(<DiscoveryPage mode="events" />);
    await waitFor(() => expect(text()).toContain("Batizado"));
    await waitFor(() => expect(callsTo("/students/me").length).toBeGreaterThan(0));
    await act(async () => buttons().find((b) => /Ver detalhes/.test(b.textContent ?? ""))!.click());
    await clickBody(/Quero participar/);
    expect(calls.find((c) => c.method === "POST")?.body).toBe('{"studentId":12}'); // Alice = 1º por nome
    expect(calls.filter((c) => c.method === "GET" && /\/participants/.test(c.url.pathname))).toHaveLength(0);
  });
});
