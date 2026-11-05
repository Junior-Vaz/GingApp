import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RankingMe } from "@/lib/ranking";
import type {
  AchievementView,
  AchievementsResponse,
  DailyCheckinStatus,
  Evolution,
  MonthGoal,
  PointStatement,
  PointStatementItem,
  RankingRules,
} from "@/lib/ranking-student";
import { saveSession } from "@/lib/session";

/**
 * Apoio dos testes do Ginga Rank do aluno: o backend é mockado via fetch com os FORMATOS de docs/CONTRATO_RANK_ALUNO.md.
 * Cada chamada fica registrada em `calls` (rota, método, query, corpo) para conferir o que o app pede.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Call {
  path: string;
  url: URL;
  method: string;
  body: string | null;
}

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

export const ST = (id: number, userId: number | null, name: string) => ({
  id,
  userId,
  unitId: 1,
  name,
  photo: null,
  coverPhoto: null,
  socialLinks: null,
  joinedAt: null,
});

/* ---------- Dados no formato do contrato ---------- */

export const RULES: RankingRules = {
  points: {
    classAttendance: 10,
    streakStep: 5,
    streakMax: 25,
    eventAttendance: 30,
    rodaParticipation: 25,
    monthlyConsistency: 50,
    graduationPerLevel: 100,
    certificate: 20,
    dailyCheckin: 1,
    dailyWeekBonus: 5,
  },
  limits: { maxClassPointsPerDay: 3, consistencyMinRate: 0.8, consistencyMinLessons: 4, dailyWeekTarget: 5, dailyMonthCapDays: 20 },
  leagues: [
    { code: "CRUA", name: "Semente", color: "#E5E5E5", minPoints: 0 },
    { code: "VERDE", name: "Broto", color: "#22C55E", minPoints: 300 },
    { code: "AMARELA", name: "Ginga", color: "#FACC15", minPoints: 900 },
    { code: "AZUL", name: "Roda", color: "#3B82F6", minPoints: 2000 },
  ],
  categories: [
    { code: "GENERAL", label: "Geral", description: "Todos os pontos juntos." },
    { code: "TRAINING", label: "Treino", description: "Só aulas, sequência e mês consistente." },
    { code: "RODAS", label: "Rodas", description: "Só participação em rodas." },
    { code: "EVENTS", label: "Eventos", description: "Só presença em eventos." },
  ],
  bands: [
    { code: "KIDS", label: "Kids (até 12 anos)" },
    { code: "YOUTH", label: "Juvenil (13 a 17)" },
    { code: "ADULT", label: "Adulto (18+)" },
  ],
  achievements: [
    { code: "AULAS_25", name: "25 aulas", description: "25 aulas.", family: "PRESENCA", tier: "BRONZE" },
    { code: "CENTURION", name: "Centurião", description: "100 aulas.", family: "PRESENCA", tier: "SILVER" },
    { code: "AULAS_250", name: "250 aulas", description: "250 aulas.", family: "PRESENCA", tier: "GOLD" },
    { code: "SEQ_4W", name: "4 semanas", description: "4 semanas.", family: "SEQUENCIA", tier: "BRONZE" },
  ],
  seasons: { lengthLabel: "mensal", timezone: "America/Sao_Paulo" },
};

export const DAILY: DailyCheckinStatus = {
  today: "2026-11-04",
  checkedInToday: false,
  weekDays: 3,
  weekTarget: 5,
  weekDone: false,
  monthDays: 3,
  monthCapDays: 20,
  last7: [
    { day: "2026-10-29", done: false },
    { day: "2026-10-30", done: true },
    { day: "2026-10-31", done: false },
    { day: "2026-11-01", done: true },
    { day: "2026-11-02", done: true },
    { day: "2026-11-03", done: false },
    { day: "2026-11-04", done: false },
  ],
};

export const GOAL: MonthGoal = {
  season: "2026-11",
  lessonsPlanned: 12,
  lessonsDone: 5,
  present: 8,
  neededForBonus: 10,
  remainingForBonus: 2,
  canStillReach: true,
  bonusPoints: 50,
  hasGoal: true,
  league: {
    current: { code: "AZUL", name: "Roda", color: "#3B82F6" },
    next: { code: "ROXA", name: "Axé", color: "#8B5CF6", minPoints: 4000 },
    pointsToNext: 220,
    progressPct: 69,
  },
};

export const week = (n: number): string => {
  const d = new Date(Date.UTC(2026, 8, 7 + n * 7));
  return d.toISOString().slice(0, 10);
};

export const EVOLUTION_WEEK: Evolution = {
  granularity: "WEEK",
  points: Array.from({ length: 12 }, (_, i) => ({ key: week(i), points: i === 11 ? 40 : (i % 4) * 10, cumulative: 100 + i * 20, lessons: i % 3 })),
  bestWeek: { key: week(6), points: 30 },
  currentStreakWeeks: 7,
  bestStreakWeeks: 9,
};

export const EVOLUTION_MONTH: Evolution = {
  granularity: "MONTH",
  points: Array.from({ length: 12 }, (_, i) => ({ key: `2026-${String(i + 1).padStart(2, "0")}`, points: i === 11 ? 90 : i * 5, cumulative: 100 + i * 50, lessons: i })),
  bestWeek: { key: week(6), points: 30 },
  currentStreakWeeks: 7,
  bestStreakWeeks: 9,
};

export const stmtItem = (id: number, over: Partial<PointStatementItem> = {}): PointStatementItem => ({
  id,
  type: "CLASS_ATTENDANCE",
  points: 10,
  occurredAt: "2026-11-02T22:00:00.000Z",
  season: "2026-11",
  label: `Aula: Turma ${id}`,
  ...over,
});

export const statement = (items: PointStatementItem[], over: Partial<PointStatement> = {}): PointStatement => ({
  items,
  total: items.length,
  seasonTotals: [
    { season: "2026-11", points: 180 },
    { season: "2026-10", points: 420 },
  ],
  allTimePoints: 6420,
  ...over,
});

export const ach = (code: string, over: Partial<AchievementView> = {}): AchievementView => ({
  code,
  name: code,
  description: `Descrição de ${code}.`,
  family: "PRESENCA",
  tier: "BRONZE",
  icon: "presenca",
  earned: false,
  earnedAt: null,
  progress: { current: 3, target: 25 },
  rarityPct: null,
  ...over,
});

export const ACHIEVEMENTS: AchievementsResponse = {
  items: [
    ach("AULAS_25", { name: "25 aulas", tier: "BRONZE", earned: true, earnedAt: "2026-03-10T00:00:00.000Z", progress: { current: 25, target: 25 }, rarityPct: 62.5 }),
    ach("CENTURION", { name: "Centurião", tier: "SILVER", progress: { current: 62, target: 100 }, rarityPct: 4 }),
    ach("AULAS_250", { name: "250 aulas", tier: "GOLD", progress: { current: 62, target: 250 }, rarityPct: null }),
    ach("SEQ_4W", { name: "4 semanas seguidas", family: "SEQUENCIA", icon: "sequencia", tier: "BRONZE", earned: true, earnedAt: "2026-04-01T15:30:00.000Z", progress: { current: 4, target: 4 } }),
    ach("SEQ_8W", { name: "8 semanas seguidas", family: "SEQUENCIA", icon: "sequencia", tier: "SILVER", earned: true, earnedAt: "2026-05-01T15:30:00.000Z", progress: { current: 8, target: 8 } }),
    ach("DAILY_7", { name: "7 check-ins", family: "DIARIO", icon: "diario", tier: "BRONZE", earned: true, earnedAt: "2026-10-01T15:30:00.000Z", progress: { current: 7, target: 7 } }),
    ach("PERFECT_MONTH", { name: "Mês perfeito", family: "MES", icon: "mes", tier: "GOLD", progress: null }),
  ],
  showcase: ["AULAS_25"],
  earnedCount: 4,
  totalCount: 7,
};

export const baseMe = (over: Partial<RankingMe> = {}): RankingMe => ({
  student: { id: 11, displayName: "Camila Souza", avatarUrl: null },
  points: { season: 1180, allTime: 6420 },
  level: { code: "AZUL", name: "Roda", color: "#3B82F6" },
  nextLevel: { code: "ROXA", name: "Axé", color: "#8B5CF6", minPoints: 4000 },
  pointsToNext: 220,
  progressPct: 69,
  streakWeeks: 7,
  rank: { group: 6, city: 8, state: 14, country: 63 },
  achievements: [],
  availableAchievements: [],
  settings: { optInPublic: false, nickname: null, canOptIn: true, requiresGuardianConsent: false },
  ...over,
});

/* ---------- Mock do backend ---------- */

type Handler = (url: URL, call: Call) => unknown;

export interface Mocks {
  /** Chave: "/rota" (qualquer método) ou "POST /rota". O valor devolvido vira JSON 200; devolva um Response para outro status. */
  routes?: Record<string, Handler>;
  students?: unknown[];
}

export const calls: Call[] = [];

export function mockApi(mocks: Mocks = {}) {
  calls.length = 0;
  const defaults: Record<string, Handler> = {
    "/students/me": () => mocks.students ?? [ST(11, 1, "Camila Souza")],
    "/ranking/seasons": () => ({ current: "2026-11", items: [] }),
    "/ranking/students": () => ({ items: [], me: null, total: 0, season: "2026-11", scope: "GROUP", category: "GENERAL", band: null }),
    "/ranking/groups": () => ({ items: [], total: 0, season: "2026-11", scope: "CITY" }),
    "/ranking/me": () => baseMe(),
    "/ranking/rules": () => RULES,
    "/ranking/me/points": () => statement([stmtItem(1), stmtItem(2, { type: "DAILY_CHECKIN", points: 1, label: "Check-in do dia 02/11" })]),
    "/ranking/me/evolution": (url) => (url.searchParams.get("granularity") === "MONTH" ? EVOLUTION_MONTH : EVOLUTION_WEEK),
    "/ranking/me/goal": () => GOAL,
    "/ranking/me/achievements": () => ACHIEVEMENTS,
    "GET /ranking/me/daily-checkin": () => DAILY,
    "POST /ranking/me/daily-checkin": () => ({ ...DAILY, checkedInToday: true, weekDays: 4, monthDays: 4, alreadyCheckedIn: false, pointsToday: 1 }),
  };
  const table = { ...defaults, ...(mocks.routes ?? {}) };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input).replace(/^.*\/api/, "http://x"));
      const method = init?.method ?? "GET";
      const call: Call = { path: url.pathname, url, method, body: typeof init?.body === "string" ? init.body : null };
      calls.push(call);
      const handler = table[`${method} ${url.pathname}`] ?? table[url.pathname];
      if (!handler) return json(404, { message: `sem rota ${method} ${url.pathname}` });
      const result = await handler(url, call);
      return result instanceof Response ? result : json(200, result);
    }),
  );
}

export const callsTo = (path: string, method?: string): Call[] => calls.filter((c) => c.path === path && (method === undefined || c.method === method));

/* ---------- Montagem e interação ---------- */

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let queryClient: QueryClient | null = null;

export const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

export async function mount(node: ReactNode) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(QueryClientProvider, { client: queryClient! }, node)));
  await settle();
  await settle();
  await settle();
}

export function cleanup() {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  queryClient = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
}

export const getQueryClient = () => queryClient!;

export function prepare() {
  localStorage.clear();
  // jsdom não tem ResizeObserver (Switch/Accordion do Radix usam).
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  saveSession("t", {
    id: 1,
    name: "Camila Souza",
    email: "c@x.com",
    userType: "MEMBER",
    isSuperAdmin: false,
    organizationId: 1,
    organizationSlug: "g",
    role: "ALUNO",
  });
}

export const q = <T extends Element = HTMLElement>(selector: string) => document.body.querySelector<T>(selector);
export const qa = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)];
export const byText = (selector: string, text: string) => qa(selector).find((el) => el.textContent?.trim() === text);
export const textOf = (selector: string) => q(selector)?.textContent ?? "";

export async function click(el: Element | null | undefined) {
  expect(el, "elemento para clicar").toBeTruthy();
  act(() => (el as HTMLElement).click());
  await settle();
  await settle();
}

export async function selectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
  await settle();
}
