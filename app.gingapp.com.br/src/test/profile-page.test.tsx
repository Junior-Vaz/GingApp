import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  Link: ({ children, to, className }: { children?: React.ReactNode; to?: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

import { ProfilePage } from "@/components/gingapp/profile";
import { clearSession, saveSession, type AuthUser } from "@/lib/session";

/** Perfil redesenhado: hero, faixa de destaques, seções, seletor de dependente e folha de edição (backend mockado via fetch). */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const user = (role: AuthUser["role"], extra: Partial<AuthUser> = {}): AuthUser => ({
  id: 3, name: "Ana Souza", email: "ana@x.com", userType: "MEMBER", isSuperAdmin: false,
  organizationId: 1, organizationSlug: "g", role, ...extra,
});
const stu = (id: number, name: string, userId: number | null) => ({
  id, userId, unitId: null, name, photo: null, coverPhoto: id === 7 ? "https://img.test/capa.jpg" : null, socialLinks: null, joinedAt: null,
});
const ROPE = { name: "Corda Verde", color: "#22c55e", style: "SOLID" };
const PASSPORT = {
  student: { id: 7, name: "Ana Souza" },
  organization: { name: "Grupo Axé" },
  unit: { name: "Matriz Goiânia" },
  currentGraduation: ROPE,
  stats: { aulas: 12, rodas: 3, eventos: 1, graduacoes: 1, certificados: 0 },
  publicProfile: null,
};
const RANKING = {
  student: { id: 7, displayName: "Ana", avatarUrl: null },
  points: { season: 1250, allTime: 4000 },
  level: { code: "AZUL", name: "Roda", color: "#3B82F6" },
  nextLevel: null, pointsToNext: null, progressPct: 40, streakWeeks: 3,
  rank: { group: 1, city: null, state: null, country: null }, achievements: [], availableAchievements: [],
  settings: { optInPublic: false, nickname: null },
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let urls: string[] = [];
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });

type Routes = Record<string, () => Response>;
function mockApi(students: unknown[], routes: Routes = {}) {
  urls = [];
  const base: Routes = {
    "/auth/me": () => json(200, { roles: [], pendingDeletionRequest: null }),
    "/students/me": () => json(200, students),
    "/organizations": () => json(200, [{ id: 1, name: "Grupo Axé", logo: null, paymentInstructions: null }]),
    ...routes,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).replace(/^https?:\/\/[^/]+\/api/, "");
      urls.push(path);
      const key = path.split("?")[0]!;
      return base[key]?.() ?? json(404, { message: `sem rota ${path}` });
    }),
  );
}

async function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}><ProfilePage /></QueryClientProvider>));
  await settle();
  await settle();
}

const q = (sel: string) => container!.querySelector<HTMLElement>(sel);
const text = () => container!.textContent ?? "";
const byTestId = (id: string) => q(`[data-testid=${id}]`);

beforeEach(() => {
  clearSession();
  localStorage.clear();
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = "";
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("Perfil: hero", () => {
  it("mostra nome, cargo do grupo, apelido, grupo · unidade, capa e a ação Editar perfil", async () => {
    saveSession("t", user("ALUNO"));
    mockApi([stu(7, "Ana Souza", 3)], {
      "/auth/me": () => json(200, { roles: [{ id: 11, name: "Contramestre", slug: "contramestre", color: "#dc2626", icon: null, accessRole: "PROFESSOR", rank: 80 }], pendingDeletionRequest: null }),
      "/passport/me": () => json(200, PASSPORT),
      "/people/me/ficha": () => json(200, { person: { id: 1, gingappCode: "G", name: "Ana Souza", nickname: "Aninha", birthDate: null, photo: null, documentMasked: null, documentKind: null }, enrollments: [], graduations: [], attendanceByGroup: [], certificates: [], sharedFromOtherGroups: [], scope: "SELF" }),
    });
    await mount();

    expect(byTestId("profile-name")?.textContent).toBe("Ana Souza");
    expect(byTestId("profile-nickname")?.textContent).toContain("Aninha");
    expect(byTestId("role-badge-contramestre")?.textContent).toBe("Contramestre");
    expect(byTestId("profile-place")?.textContent).toBe("Grupo Axé · Matriz Goiânia");
    expect(q("[data-testid=profile-cover] img")?.getAttribute("src")).toBe("https://img.test/capa.jpg");
    expect([...container!.querySelectorAll("button")].some((b) => b.textContent === "Editar perfil")).toBe(true);
    expect(q("button[aria-label='Trocar foto do perfil']")).not.toBeNull();
    expect(byTestId("avatar-group-badge")).not.toBeNull(); // selo redondo do grupo no avatar
    expect(byTestId("profile-dependents")).toBeNull(); // 1 aluno: sem seletor
  });

  it("sem capa usa o fundo em gradiente (sem imagem) e sem perfil de aluno próprio esconde a edição de foto", async () => {
    saveSession("t", user("RESPONSAVEL"));
    mockApi([stu(11, "Bruno", null)]);
    await mount();

    expect(q("[data-testid=profile-cover] img")).toBeNull();
    expect(q("button[aria-label='Trocar foto do perfil']")).toBeNull();
    expect(text()).toContain("Esta conta não tem um perfil de aluno próprio");
  });
});

describe("Perfil: faixa de destaques", () => {
  it("mostra graduação, frequência, liga com pontos e sequência quando os dados carregam", async () => {
    saveSession("t", user("ALUNO"));
    mockApi([stu(7, "Ana Souza", 3)], {
      "/passport/me": () => json(200, PASSPORT),
      "/attendance/me": () => json(200, { records: [], last30dPercent: 62.4, currentStreak: 2 }),
      "/ranking/me": () => json(200, RANKING),
    });
    await mount();

    const strip = byTestId("profile-highlights")!;
    expect(strip).not.toBeNull();
    expect(byTestId("highlight-grad")?.textContent).toContain("Corda Verde");
    expect(byTestId("highlight-grad")?.querySelector("svg[role=img], svg")).not.toBeNull();
    expect(byTestId("highlight-freq")?.textContent).toContain("62%");
    expect(byTestId("highlight-liga")?.textContent).toContain("Roda");
    expect(byTestId("highlight-liga")?.textContent).toContain("1.250");
    expect(byTestId("highlight-streak")?.textContent).toContain("3 semanas");
  });

  it("cartões sem dado (ranking e frequência com erro) somem; sem nenhum dado a faixa inteira some, sem mensagem de erro", async () => {
    saveSession("t", user("ALUNO"));
    mockApi([stu(7, "Ana Souza", 3)], { "/passport/me": () => json(200, PASSPORT) });
    await mount();
    expect(byTestId("highlight-grad")).not.toBeNull();
    expect(byTestId("highlight-freq")).toBeNull();
    expect(byTestId("highlight-liga")).toBeNull();
    expect(byTestId("highlight-streak")).toBeNull();

    act(() => root?.unmount());
    container?.remove();
    mockApi([stu(7, "Ana Souza", 3)], { "/passport/me": () => json(404, { message: "x" }) });
    await mount();
    expect(byTestId("profile-highlights")).toBeNull();
    expect(byTestId("profile-highlights-loading")).toBeNull();
  });
});

describe("Perfil: seções e ações", () => {
  it("lista as seções agrupadas e as ações principais (Sair, Editar, atalhos da jornada, termos)", async () => {
    saveSession("t", user("ALUNO"));
    mockApi([stu(7, "Ana Souza", 3)], {
      "/passport/me": () => json(200, PASSPORT),
      "/people/me/code": () => json(200, { personId: 1, gingappCode: "GING-7K3Q-9XPM", qrDataUrl: "data:image/png;base64,AA==" }),
    });
    await mount();

    const headings = [...container!.querySelectorAll("h2")].map((h) => h.textContent);
    for (const title of ["Minha jornada", "Meu código GingApp", "Dados pessoais", "Segurança", "Privacidade e dados (LGPD)", "Termos e política", "Minhas raízes"]) {
      expect(headings, title).toContain(title);
    }
    const hrefs = [...container!.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    for (const to of ["/jornada", "/ranking", "/frequencia", "/financeiro", "/termos", "/privacidade"]) expect(hrefs).toContain(to);
    expect(byTestId("person-code-value")?.textContent).toBe("GING-7K3Q-9XPM");
    const personal = byTestId("profile-personal")!;
    expect(personal.textContent).toContain("ana@x.com");
    expect([...container!.querySelectorAll("button")].map((b) => b.textContent)).toContain("Sair da conta");
    expect(byTestId("my-data")).not.toBeNull();
    expect(text()).toContain("Alterar senha");
    // sem transferências/ocorrências e sem push no servidor: esses cartões não aparecem
    expect(byTestId("profile-transfers-occurrences")).toBeNull();
    expect(byTestId("profile-push")).toBeNull();
  });

  it("transferência pendente aparece na seção 'Transferências e ocorrências' com o selo de pendência", async () => {
    saveSession("t", user("ALUNO"));
    mockApi([stu(7, "Ana Souza", 3)], {
      "/people/me/transfers": () => json(200, [{ id: 1, status: "PENDING_PERSON", canDecide: true, person: { id: 1, name: "Ana", photo: null }, fromOrganization: { id: 1, name: "A", logoUrl: null } }]),
    });
    await mount();

    const card = byTestId("profile-transfers-occurrences")!;
    expect(card).not.toBeNull();
    expect(card.querySelector("[data-testid=transfers-badge]")?.textContent).toBe("1");
  });

  it("troca de senha obrigatória: mostra o aviso e esconde as seções que dependem de senha definitiva", async () => {
    saveSession("t", user("ALUNO", { mustChangePassword: true }));
    mockApi([stu(7, "Ana Souza", 3)]);
    await mount();

    expect(byTestId("must-change-password")).not.toBeNull();
    expect(byTestId("profile-journey")).toBeNull();
    expect(byTestId("my-data")).toBeNull();
    expect(text()).toContain("Alterar senha");
  });
});

describe("Perfil: dependentes e edição", () => {
  it("responsável com 2+ dependentes vê os chips no hero e tudo segue o aluno escolhido", async () => {
    saveSession("t", user("RESPONSAVEL"));
    mockApi([stu(11, "Bruno", null), stu(12, "Alice", null)], { "/passport/me": () => json(200, PASSPORT) });
    await mount();

    const group = q("[role=radiogroup]")!;
    const chips = [...group.querySelectorAll<HTMLElement>("[role=radio]")];
    const label = (c: Element) => c.querySelector(":scope > span:last-child")?.textContent; // o avatar decorativo traz só as iniciais
    expect(chips.map(label)).toEqual(["Alice", "Bruno"]); // ordem por nome
    expect(chips[0]!.getAttribute("aria-checked")).toBe("true");
    expect(urls.some((u) => u === "/passport/me?studentId=12")).toBe(true);

    act(() => chips[1]!.click());
    await settle();
    expect(label(q("[role=radiogroup] [role=radio][aria-checked=true]")!)).toBe("Bruno");
    expect(urls.some((u) => u === "/passport/me?studentId=11")).toBe(true);
    expect(urls.some((u) => u === "/ranking/me?studentId=11")).toBe(true);
  });

  it("'Editar perfil' abre a folha com foto, capa, redes e dados da ficha", async () => {
    saveSession("t", user("ALUNO"));
    mockApi([stu(7, "Ana Souza", 3)], {
      "/people/me/ficha": () => json(200, { person: { id: 1, gingappCode: "G", name: "Ana", nickname: null, birthDate: null, photo: null, documentMasked: null, documentKind: null }, enrollments: [], graduations: [], attendanceByGroup: [], certificates: [], sharedFromOtherGroups: [], scope: "SELF" }),
    });
    await mount();
    expect(document.body.querySelector("[data-testid=profile-edit-sheet]")).toBeNull();

    const edit = [...container!.querySelectorAll("button")].find((b) => b.textContent === "Editar perfil")!;
    act(() => edit.click());
    await settle();

    const sheet = document.body.querySelector("[data-testid=profile-edit-sheet]")!;
    expect(sheet).not.toBeNull();
    expect(sheet.textContent).toContain("Editar perfil");
    expect(sheet.querySelector("#photo")).not.toBeNull();
    expect(sheet.querySelector("#coverPhoto")).not.toBeNull();
    expect(sheet.querySelector("#instagram")).not.toBeNull();
    expect(sheet.querySelector("[data-testid=ficha-edit]")).not.toBeNull();
  });
});
