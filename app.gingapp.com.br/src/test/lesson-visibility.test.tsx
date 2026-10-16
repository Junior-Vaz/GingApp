import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children, to, className }: { children?: React.ReactNode; to?: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

import { ClassesPage } from "@/components/gingapp/pages";
import { MyClasses } from "@/components/gingapp/class-parts";
import { isLessonVisible, resolveClassInfo } from "@/lib/derive";
import type { ClassItem, Lesson } from "@/lib/queries";

/**
 * Aulas canceladas somem para o aluno 2 dias depois do cancelamento/da data da aula (defesa no cliente: o backend
 * novo já faz isso, o antigo não) e os cartões de aula são compactos (foto à esquerda com fade, 3 linhas).
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 14, 12, 0, 0); // 14/10/2026 12:00 (local)
const utcMidnight = (daysFromToday: number) => new Date(Date.UTC(2026, 9, 14 + daysFromToday)).toISOString();
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const lesson = (over: Partial<Lesson> = {}): Lesson => ({
  id: 1,
  classId: 1,
  unitId: 5,
  teacherUserId: 9,
  date: utcMidnight(3),
  startTime: "19:00",
  endTime: "20:30",
  notes: null,
  status: "ACTIVE",
  ...over,
});

describe("isLessonVisible", () => {
  it("ativa é sempre visível, mesmo antiga", () => {
    expect(isLessonVisible(lesson({ date: utcMidnight(-90) }), NOW)).toBe(true);
    expect(isLessonVisible(lesson({ date: utcMidnight(5) }), NOW)).toBe(true);
  });
  it("cancelada hoje (ou ontem) continua visível", () => {
    expect(isLessonVisible(lesson({ status: "INACTIVE", date: utcMidnight(0), cancelledAt: ago(0) }), NOW)).toBe(true);
    expect(isLessonVisible(lesson({ status: "INACTIVE", date: utcMidnight(2), cancelledAt: ago(1) }), NOW)).toBe(true);
  });
  it("cancelada há 3 dias some, mesmo com aula no futuro", () => {
    expect(isLessonVisible(lesson({ status: "INACTIVE", date: utcMidnight(4), cancelledAt: ago(3) }), NOW)).toBe(false);
  });
  it("cancelada com data de aula antiga some, mesmo cancelada agora", () => {
    expect(isLessonVisible(lesson({ status: "INACTIVE", date: utcMidnight(-3), cancelledAt: ago(0) }), NOW)).toBe(false);
  });
  it("sem cancelledAt (backend antigo) decide só pela data da aula (dia civil)", () => {
    expect(isLessonVisible(lesson({ status: "INACTIVE", date: utcMidnight(-2) }), NOW)).toBe(true);
    expect(isLessonVisible(lesson({ status: "INACTIVE", date: utcMidnight(-3) }), NOW)).toBe(false);
    expect(isLessonVisible(lesson({ status: "INACTIVE", date: utcMidnight(1), cancelledAt: null }), NOW)).toBe(true);
  });
});

describe("resolveClassInfo: professor sem nome", () => {
  it("nome vazio (professor inativo) não gera linha de professor", () => {
    const info = resolveClassInfo(lesson({ teacher: { id: 9, name: "  ", photo: null } }), [], null);
    expect(info.teacher).toBeNull();
  });
});

type Handler = (path: string, url: URL) => { body: unknown; total?: number } | undefined;
function mockApi(handler: Handler) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input).replace(/^.*\/api/, "http://x"));
      const route = handler(url.pathname, url) ?? { body: [] };
      return new Response(JSON.stringify(route.body), {
        status: 200,
        headers: route.total === undefined ? {} : { "X-Total-Count": String(route.total) },
      });
    }),
  );
}
function render(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>));
}
const waitFor = (assertion: () => void) => act(async () => void (await vi.waitFor(assertion, { timeout: 3000 })));
const text = () => (container?.textContent ?? "").split(String.fromCharCode(160)).join(" ");
const cards = () => [...container!.querySelectorAll('[data-testid="lesson-card"]')];

beforeEach(() => {
  localStorage.clear();
  // relogio fixo em NOW (so Date): as aulas fabricadas acima sao relativas a 14/10/2026, nao ao dia em que o teste roda
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

const cls: ClassItem = { id: 1, name: "Adulto Noite", description: null, weekday: 4, startTime: "19:00", endTime: "20:30", unitId: 5 };
const passport = { student: { id: 1, name: "Aluno" }, organization: { name: "Grupo X" }, unit: { name: "Matriz" }, currentGraduation: null, stats: {}, publicProfile: null };

describe("Minhas aulas: canceladas antigas somem", () => {
  it("lista só as visíveis, com selo 'Cancelada' na recente, e os contadores descontam as escondidas", async () => {
    const recent = lesson({ id: 1, status: "INACTIVE", date: utcMidnight(1), cancelledAt: ago(0), class: { id: 1, name: "Turma Recente" } });
    const stale = lesson({ id: 2, status: "INACTIVE", date: utcMidnight(6), cancelledAt: ago(5), class: { id: 1, name: "Turma Velha" } });
    const active = lesson({ id: 3, date: utcMidnight(2), class: { id: 1, name: "Turma Ativa" }, teacher: { id: 9, name: "", photo: null } });
    const oldPast = lesson({ id: 4, status: "INACTIVE", date: utcMidnight(-10), class: { id: 1, name: "Turma Passada Velha" } });
    mockApi((path, url) => {
      if (path === "/lessons/me") {
        return url.searchParams.get("from") ? { body: [recent, active, stale], total: 3 } : { body: [oldPast], total: 1 };
      }
      if (path === "/classes/me") return { body: [cls] };
      if (path === "/passport/me") return { body: passport };
      return undefined;
    });
    render(<ClassesPage />);
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(text()).toContain("Turma Recente");
    expect(text()).toContain("Turma Ativa");
    expect(text()).not.toContain("Turma Velha");
    expect(text()).not.toContain("Turma Passada Velha");
    expect(container!.querySelectorAll(".badge-cancelled")).toHaveLength(1);
    expect(container!.querySelector(".badge-cancelled")?.textContent).toBe("Cancelada");
    // professor sem nome: nenhuma linha de professor
    expect(container!.querySelector('[data-testid="teacher-line"]')).toBeNull();
    // contadores: nada de "Mostrando 2 de 3"
    expect(container!.querySelector('[data-testid="load-more"]')).toBeNull();
  });

  it("página inteira escondida pelo filtro: carrega a próxima sozinha", async () => {
    const hidden = Array.from({ length: 10 }, (_, i) => lesson({ id: 100 + i, status: "INACTIVE", date: utcMidnight(-20 - i) }));
    const shown = [lesson({ id: 1, date: utcMidnight(-30), class: { id: 1, name: "Treino de Setembro" } })];
    mockApi((path, url) => {
      if (path === "/lessons/me") {
        if (url.searchParams.get("from")) return { body: [], total: 0 };
        return url.searchParams.get("offset") === "0" ? { body: hidden, total: 11 } : { body: shown, total: 11 };
      }
      if (path === "/classes/me") return { body: [cls] };
      if (path === "/passport/me") return { body: passport };
      return undefined;
    });
    render(<ClassesPage />);
    await waitFor(() => expect(text()).toContain("Treino de Setembro"));
    expect(cards()).toHaveLength(1);
    expect(container!.querySelector('[data-testid="load-more"]')).toBeNull();
  });
});

describe("Cartões compactos", () => {
  it("cartão de aula: capa 'list' à esquerda, título truncado, linha de unidade/professor e botão de 44px acessível", async () => {
    const l = lesson({
      class: { id: 1, name: "Adulto Noite", photo: "https://img.test/t.jpg" },
      unit: { id: 5, name: "Matriz", photo: null },
      teacher: { id: 9, name: "Mestre Bimba Filho", photo: null },
    });
    mockApi((path, url) => {
      if (path === "/lessons/me") return { body: url.searchParams.get("from") ? [l] : [], total: url.searchParams.get("from") ? 1 : 0 };
      if (path === "/classes/me") return { body: [cls] };
      if (path === "/passport/me") return { body: passport };
      return undefined;
    });
    render(<ClassesPage />);
    await waitFor(() => expect(cards()).toHaveLength(1));
    const card = cards()[0]!;
    expect(card.classList.contains("is-compact")).toBe(true);
    expect(card.querySelector(".cls-cover.is-list")).toBeTruthy();
    expect(card.querySelector("h3.truncate")?.textContent).toBe("Adulto Noite");
    expect(card.querySelector(".lesson-people .unit-line")?.textContent).toContain("Matriz");
    expect(card.querySelector(".lesson-people .teacher-line.is-compact")?.textContent).toContain("Mestre Bimba Filho");
    const open = card.querySelector("button.lesson-open")!;
    expect(open.getAttribute("aria-label")).toContain("Ver aula de Adulto Noite");
  });

  it("Minhas turmas usa o mesmo cartão compacto", async () => {
    mockApi((path) => (path === "/classes/me" ? { body: [{ ...cls, unit: { id: 5, name: "Matriz" }, teacher: { id: 9, name: "Mestre X" } }] } : undefined));
    render(<MyClasses />);
    await waitFor(() => expect(container!.querySelector(".my-class")).toBeTruthy());
    expect(container!.querySelector(".my-class .cls-cover.is-list")).toBeTruthy();
    expect(container!.querySelector(".my-class h3.truncate")?.textContent).toBe("Adulto Noite");
    expect(container!.querySelector(".my-class .lesson-people")).toBeTruthy();
  });
});
