import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RankingPage } from "@/components/gingapp/ranking";
import {
  leagueColor,
  leveledUp,
  readableOn,
  seasonLabel,
  type GroupsRankingPage,
  type RankingMe,
  type SeasonsResponse,
  type StudentRankItem,
  type StudentsRankingPage,
} from "@/lib/ranking";
import { saveSession } from "@/lib/session";

/**
 * Ginga Rank: o backend e' mockado via fetch (contrato de /ranking/*). Verifica pódio, lista, filtros
 * (a troca de escopo/categoria muda a QUERY), "Ver mais", progresso/conquistas, configurar ranking
 * (sucesso, 403 de consentimento e menor sem autorização), estado vazio, subida de liga e aluno ativo.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LEVELS = {
  VERDE: { code: "VERDE", name: "Verde", color: "#22C55E" },
  AZUL: { code: "AZUL", name: "Azul", color: "#3B82F6" },
  ROXA: { code: "ROXA", name: "Roxa", color: "#8B5CF6" },
};

const row = (rank: number, over: Partial<StudentRankItem> = {}): StudentRankItem => ({
  rank,
  studentId: 100 + rank,
  displayName: `Aluno ${rank}`,
  avatarUrl: null,
  groupId: 1,
  groupName: "Grupo Cordão de Ouro",
  groupLogoUrl: null,
  city: "Salvador",
  state: "BA",
  points: 1000 - rank * 10,
  level: LEVELS.AZUL,
  rankDelta: rank % 2 === 0 ? 2 : -1,
  isMe: false,
  ...over,
});

const studentsPage = (items: StudentRankItem[], over: Partial<StudentsRankingPage> = {}): StudentsRankingPage => ({
  items,
  me: { rank: 2, points: 980, inList: true },
  total: items.length,
  season: "2026-10",
  scope: "GROUP",
  category: "GENERAL",
  band: null,
  ...over,
});

const baseMe = (over: Partial<RankingMe> = {}): RankingMe => ({
  student: { id: 11, displayName: "Camila Souza", avatarUrl: null },
  points: { season: 1180, allTime: 6420 },
  level: LEVELS.AZUL,
  nextLevel: { ...LEVELS.ROXA, minPoints: 1400 },
  pointsToNext: 220,
  progressPct: 69,
  streakWeeks: 7,
  rank: { group: 6, city: 8, state: 14, country: 63 },
  achievements: [
    { code: "FIRST_CLASS", name: "Primeira aula", description: "Foi à primeira aula.", earnedAt: "2026-03-10T00:00:00Z" },
    { code: "RODA_10", name: "Roda cheia", description: "10 rodas.", earnedAt: "2026-08-21T00:00:00Z" },
  ],
  availableAchievements: [{ code: "EVENT_BATIZADO", name: "Batizado", description: "Participe de um batizado." }],
  settings: { optInPublic: false, nickname: null, canOptIn: true, requiresGuardianConsent: false },
  ...over,
});

const SEASONS: SeasonsResponse = {
  current: "2026-10",
  items: [
    {
      season: "2026-09",
      champions: {
        country: { studentId: 3, displayName: "Beatriz Alves", points: 4810 },
        group: null,
      },
    },
  ],
};

interface Call {
  path: string;
  url: URL;
  method: string;
  body: string | null;
}

let calls: Call[] = [];
let root: Root | null = null;
let container: HTMLDivElement | null = null;

interface Mocks {
  students?: (url: URL) => StudentsRankingPage | Response;
  groups?: (url: URL) => GroupsRankingPage;
  me?: RankingMe;
  put?: (body: Record<string, unknown>) => Response;
  studentsList?: unknown[];
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const ST = (id: number, userId: number | null, name: string) => ({
  id,
  userId,
  unitId: 1,
  name,
  photo: null,
  coverPhoto: null,
  socialLinks: null,
  joinedAt: null,
});

function mockApi(mocks: Mocks) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input).replace(/^.*\/api/, "http://x"));
      const body = typeof init?.body === "string" ? init.body : null;
      calls.push({ path: url.pathname, url, method: init?.method ?? "GET", body });
      switch (url.pathname) {
        case "/students/me":
          return json(200, mocks.studentsList ?? [ST(11, 1, "Camila Souza")]);
        case "/ranking/seasons":
          return json(200, SEASONS);
        case "/ranking/students": {
          const result = mocks.students?.(url) ?? studentsPage([row(1), row(2, { isMe: true }), row(3), row(4), row(5)]);
          return result instanceof Response ? result : json(200, result);
        }
        case "/ranking/groups":
          return json(
            200,
            mocks.groups?.(url) ?? {
              items: [
                { rank: 1, groupId: 1, name: "Grupo Alfa", logoUrl: null, city: "Salvador", state: "BA", studentsCount: 30, totalPoints: 9000, avgPoints: 300, isMine: false },
                { rank: 2, groupId: 2, name: "Grupo Beta", logoUrl: null, city: "Salvador", state: "BA", studentsCount: 20, totalPoints: 7000, avgPoints: 350, isMine: true },
                { rank: 3, groupId: 3, name: "Grupo Gama", logoUrl: null, city: "Recife", state: "PE", studentsCount: 10, totalPoints: 3000, avgPoints: 300, isMine: false },
                { rank: 4, groupId: 4, name: "Grupo Delta", logoUrl: null, city: "Recife", state: "PE", studentsCount: 12, totalPoints: 2400, avgPoints: 200, isMine: false },
              ],
              total: 4,
              season: "2026-10",
              scope: "CITY",
            },
          );
        case "/ranking/me":
          return json(200, mocks.me ?? baseMe());
        case "/ranking/me/settings":
          return mocks.put ? mocks.put(JSON.parse(body ?? "{}") as Record<string, unknown>) : json(200, baseMe().settings);
        default:
          return json(404, { message: `sem rota ${url.pathname}` });
      }
    }),
  );
}

const callsTo = (path: string) => calls.filter((c) => c.path === path);
const lastStudents = () => callsTo("/ranking/students").at(-1)!.url.searchParams;

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

async function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}><RankingPage /></QueryClientProvider>));
  await settle();
  await settle();
  await settle();
}

const q = <T extends Element = HTMLElement>(selector: string) => document.body.querySelector<T>(selector);
const qa = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)];
const byText = (selector: string, text: string) => qa(selector).find((el) => el.textContent?.trim() === text);

async function click(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  act(() => (el as HTMLElement).click());
  await settle();
  await settle();
}

async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

beforeEach(() => {
  localStorage.clear();
  // jsdom não tem ResizeObserver (o Switch/Radix usa).
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  saveSession("t", {
    id: 1, name: "Camila Souza", email: "c@x.com", userType: "MEMBER", isSuperAdmin: false,
    organizationId: 1, organizationSlug: "g", role: "ALUNO",
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("regras puras do ranking", () => {
  it("cor da liga: a do servidor, a da tabela por código ou cinza; texto legível sobre cada cor", () => {
    expect(leagueColor({ code: "AZUL", color: "#3B82F6" })).toBe("#3B82F6");
    expect(leagueColor({ code: "ROXA", color: "" })).toBe("#8B5CF6");
    expect(leagueColor(null)).toBe("#E5E5E5");
    expect(readableOn("#E5E5E5")).toBe("#111827");
    expect(readableOn("#111827")).toBe("#ffffff");
  });

  it("subiu de liga só quando a atual é MAIOR que a última vista (sem registro: não comemora)", () => {
    expect(leveledUp(null, "AZUL")).toBe(false);
    expect(leveledUp("VERDE", "AZUL")).toBe(true);
    expect(leveledUp("AZUL", "AZUL")).toBe(false);
    expect(leveledUp("ROXA", "AZUL")).toBe(false);
  });

  it("rótulo da temporada", () => {
    expect(seasonLabel("2026-10")).toBe("Outubro de 2026");
    expect(seasonLabel("ALL")).toBe("Todos os tempos");
  });
});

describe("Ginga Rank", () => {
  it("renderiza o pódio (3 primeiros) e a lista abaixo, destacando quem sou eu", async () => {
    mockApi({});
    await mount();
    expect(qa('[data-testid="rk-pod"]')).toHaveLength(3);
    expect(q('[data-testid="rk-podium"]')!.textContent).toContain("Aluno 1");
    const rows = qa('[data-testid="rk-row"]');
    expect(rows).toHaveLength(2); // 5 itens - 3 do pódio
    expect(rows[0]!.textContent).toContain("Aluno 4");
    expect(rows[0]!.querySelector('[aria-label="Subiu 2 posições"]')).not.toBeNull();
    expect(rows[1]!.querySelector('[aria-label="Desceu 1 posição"]')).not.toBeNull();
    // O "eu" (rank 2) está no pódio e marcado
    expect(q(".rk-pod.is-me")!.textContent).toContain("Você");
    // primeira consulta: escopo do grupo, geral, temporada atual, 50 por vez e o aluno ativo
    const params = lastStudents();
    expect(params.get("scope")).toBe("GROUP");
    expect(params.get("category")).toBe("GENERAL");
    expect(params.get("season")).toBe("2026-10");
    expect(params.get("limit")).toBe("50");
    expect(params.get("offset")).toBe("0");
    expect(params.get("studentId")).toBe("11");
  });

  it("a linha do usuário na lista leva o destaque 'Você'", async () => {
    mockApi({ students: () => studentsPage([row(1), row(2), row(3), row(4, { isMe: true }), row(5)]) });
    await mount();
    const mine = q('[data-testid="rk-row"][aria-current="true"]')!;
    expect(mine.textContent).toContain("Aluno 4");
    expect(mine.textContent).toContain("Você");
  });

  it("trocar escopo, categoria, faixa e temporada muda a query", async () => {
    mockApi({});
    await mount();
    await click(byText("button.rk-chip", "Cidade"));
    expect(lastStudents().get("scope")).toBe("CITY");
    await click(byText("button.rk-chip", "Estado"));
    expect(lastStudents().get("scope")).toBe("STATE");
    await click(byText("button.rk-chip", "Brasil"));
    expect(lastStudents().get("scope")).toBe("COUNTRY");
    await click(byText("button.rk-chip", "Treino"));
    expect(lastStudents().get("category")).toBe("TRAINING");
    expect(lastStudents().get("scope")).toBe("COUNTRY");
    await click(byText("button.rk-chip", "Kids"));
    expect(lastStudents().get("band")).toBe("KIDS");
    await click(byText("button.rk-chip", "Todos"));
    expect(lastStudents().has("band")).toBe(false);

    const select = q<HTMLSelectElement>('select[aria-label="Temporada"]')!;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Outubro de 2026",
      "Setembro de 2026",
      "Todos os tempos",
    ]);
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    act(() => {
      setter.call(select, "ALL");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    await settle();
    expect(lastStudents().get("season")).toBe("ALL");
  });

  it("temporada passada mostra o campeão do Brasil", async () => {
    mockApi({});
    await mount();
    const select = q<HTMLSelectElement>('select[aria-label="Temporada"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    act(() => {
      setter.call(select, "2026-09");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    await settle();
    expect(q('[data-testid="rk-champions"]')!.textContent).toContain("Beatriz Alves");
  });

  it("aba Grupos: cards com média por aluno, nº de alunos e 'Meu grupo'; sem categoria/faixa nem 'Meu grupo' no escopo", async () => {
    mockApi({});
    await mount();
    await click(byText("button[role=radio]", "Grupos"));
    expect(callsTo("/ranking/groups").length).toBeGreaterThan(0);
    const params = callsTo("/ranking/groups").at(-1)!.url.searchParams;
    expect(params.get("scope")).toBe("CITY"); // "Meu grupo" não existe para grupos
    expect(params.get("season")).toBe("2026-10");
    expect(params.has("category")).toBe(false);
    expect(byText("button.rk-chip", "Meu grupo")).toBeUndefined();
    expect(byText("button.rk-chip", "Kids")).toBeUndefined();
    expect(q('[data-testid="rk-podium"]')!.textContent).toContain("Grupo Alfa");
    expect(q('[data-testid="rk-podium"]')!.textContent).toContain("Meu grupo"); // Grupo Beta (3º? 2º) é o meu
    const rows = qa('[data-testid="rk-group-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Grupo Delta");
    expect(rows[0]!.textContent).toContain("12 alunos");
    expect(rows[0]!.textContent).toContain("média 200 pts/aluno");
  });

  it("'Ver mais' pede a próxima página; fora da página mostra a linha fixa 'Você: #N'", async () => {
    const items = Array.from({ length: 50 }, (_, i) => row(i + 1));
    mockApi({
      students: (url) =>
        studentsPage(url.searchParams.get("offset") === "0" ? items : [row(51), row(52)], {
          total: 52,
          me: { rank: 63, points: 67, inList: false },
        }),
    });
    await mount();
    expect(qa('[data-testid="rk-row"]')).toHaveLength(47);
    expect(q('[data-testid="rk-me-bar"]')!.textContent).toContain("Você: #63");
    await click(byText("button", "Ver mais"));
    expect(lastStudents().get("offset")).toBe("50");
    expect(qa('[data-testid="rk-row"]')).toHaveLength(49);
    expect(byText("button", "Ver mais")).toBeUndefined();
  });

  it("dentro da lista não aparece a linha fixa", async () => {
    mockApi({});
    await mount();
    expect(q('[data-testid="rk-me-bar"]')).toBeNull();
  });

  it("card 'Seu progresso': liga, barra até a próxima, posições, sequência e pontos", async () => {
    mockApi({});
    await mount();
    const card = q('[data-testid="rk-progress"]')!;
    expect(card.textContent).toContain("Camila Souza");
    expect(card.textContent).toContain("Azul");
    expect(card.textContent).toContain("faltam 220 pontos para ROXA");
    expect(card.querySelector('[role="progressbar"]')!.getAttribute("aria-valuenow")).toBe("69");
    for (const text of ["#6", "#8", "#14", "#63", "7", "semanas seguidas", "1.180", "6.420"]) {
      expect(card.textContent).toContain(text);
    }
    expect(callsTo("/ranking/me").at(-1)!.url.searchParams.get("studentId")).toBe("11");
  });

  it("conquistas: ganhas coloridas, disponíveis em cinza com dica no detalhe", async () => {
    mockApi({});
    await mount();
    expect(qa('[data-testid="rk-badge-earned"]')).toHaveLength(2);
    const locked = qa('[data-testid="rk-badge-locked"]');
    expect(locked).toHaveLength(1);
    await click(locked[0]);
    const dialog = q('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Batizado");
    expect(dialog.textContent).toContain("Como conquistar: Participe de um batizado.");
    act(() => (q('[role="dialog"] button') as HTMLElement).click());
    await settle();
    await click(qa('[data-testid="rk-badge-earned"]')[0]);
    expect(q('[role="dialog"]')!.textContent).toContain("Conquistada em 10/03/2026");
  });

  it("liga máxima: sem barra, com mensagem", async () => {
    mockApi({ me: baseMe({ nextLevel: null, pointsToNext: null, progressPct: 100 }) });
    await mount();
    expect(q('[data-testid="rk-progress"]')!.textContent).toContain("liga máxima");
    expect(q('[role="progressbar"]')).toBeNull();
  });

  it("configurar ranking: salva opt-in e apelido (PUT com o aluno ativo)", async () => {
    let saved: Record<string, unknown> | null = null;
    mockApi({
      put: (body) => {
        saved = body;
        return json(200, { optInPublic: true, nickname: "Cami", canOptIn: true, requiresGuardianConsent: false });
      },
    });
    await mount();
    await click(q('button[aria-label="Configurar ranking"]'));
    expect(q('[role="dialog"]')!.textContent).toContain("Configurar ranking");
    await click(q('[role="switch"]'));
    await typeInto(q<HTMLInputElement>("#rk-nick")!, "Cami");
    await click(byText('[role="dialog"] button', "Salvar"));
    expect(saved).toEqual({ optInPublic: true, nickname: "Cami" });
    const put = callsTo("/ranking/me/settings")[0]!;
    expect(put.method).toBe("PUT");
    expect(put.url.searchParams.get("studentId")).toBe("11");
    expect(q('[role="dialog"]')).toBeNull(); // fechou
  });

  it("configurar ranking: 403 GUARDIAN_CONSENT_REQUIRED mostra o aviso e desliga o switch", async () => {
    mockApi({ put: () => json(403, { statusCode: 403, code: "GUARDIAN_CONSENT_REQUIRED", message: "Consentimento do responsável necessário." }) });
    await mount();
    await click(q('button[aria-label="Configurar ranking"]'));
    await click(q('[role="switch"]'));
    expect(q('[role="switch"]')!.getAttribute("aria-checked")).toBe("true");
    await click(byText('[role="dialog"] button', "Salvar"));
    expect(q('[data-testid="rk-settings-error"]')!.textContent).toContain("responsável ainda não autorizou");
    expect(q('[role="switch"]')!.getAttribute("aria-checked")).toBe("false");
    expect(q('[role="dialog"]')).not.toBeNull(); // continua aberto
  });

  it("menor sem autorização: explica que o responsável precisa autorizar e bloqueia o switch (nada é enviado)", async () => {
    mockApi({
      me: baseMe({ settings: { optInPublic: false, nickname: null, canOptIn: false, requiresGuardianConsent: true } }),
    });
    await mount();
    await click(q('button[aria-label="Configurar ranking"]'));
    expect(q('[data-testid="rk-guardian-note"]')!.textContent).toContain("responsável precisa autorizar");
    expect(q('[role="switch"]')!.hasAttribute("disabled")).toBe(true);
    expect(callsTo("/ranking/me/settings")).toHaveLength(0);
  });

  it("sem pontos na temporada: estado vazio simpático (sem pódio)", async () => {
    mockApi({ students: () => studentsPage([], { total: 0, me: { rank: null, points: 0, inList: false } }) });
    await mount();
    expect(q('[data-testid="rk-empty"]')!.textContent).toContain("Ainda sem pontos nesta temporada — bora treinar!");
    expect(q('[data-testid="rk-podium"]')).toBeNull();
  });

  it("erro do servidor: mensagem e botão para tentar de novo", async () => {
    mockApi({ students: () => json(500, { message: "Falha no ranking" }) });
    await mount();
    expect(q('[role="alert"]')!.textContent).toContain("Falha no ranking");
    expect(byText("button", "Tentar novamente")).toBeDefined();
  });

  it("subiu de liga desde a última visita: aviso + confete; guarda a liga vista", async () => {
    localStorage.setItem("gingapp:ranking:league:11", "VERDE");
    mockApi({});
    await mount();
    expect(q('[data-testid="rk-levelup"]')!.textContent).toContain("liga Azul");
    expect(q('[data-testid="rk-confetti"]')).not.toBeNull();
    expect(localStorage.getItem("gingapp:ranking:league:11")).toBe("AZUL");
  });

  it("na primeira visita ou sem mudança de liga não comemora", async () => {
    mockApi({});
    await mount();
    expect(q('[data-testid="rk-levelup"]')).toBeNull();
    expect(q('[data-testid="rk-confetti"]')).toBeNull();
    expect(localStorage.getItem("gingapp:ranking:league:11")).toBe("AZUL");
  });

  it("com 'reduzir movimento' o aviso aparece, mas sem confete", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    localStorage.setItem("gingapp:ranking:league:11", "VERDE");
    mockApi({});
    await mount();
    expect(q('[data-testid="rk-levelup"]')).not.toBeNull();
    expect(q('[data-testid="rk-confetti"]')).toBeNull();
  });

  it("dependente: tudo segue o aluno ativo (studentId nas consultas)", async () => {
    // usuário 1 é o aluno 12 (o "próprio"); o 11 é um dependente
    mockApi({ studentsList: [ST(11, null, "Bruno"), ST(12, 1, "Alice")] });
    await mount();
    expect(lastStudents().get("studentId")).toBe("12");
    expect(callsTo("/ranking/me").at(-1)!.url.searchParams.get("studentId")).toBe("12");
  });
});
