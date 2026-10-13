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

import { GraduationCard } from "@/components/gingapp/graduation-parts";
import { ProfilePage } from "@/components/gingapp/profile";
import { PAINEL_URL, badgeStyle, normalizeBadges, primaryBadge, roleIcon, toBadge, type Badge } from "@/lib/roles";
import { isRoleNotification } from "@/lib/queries";
import { saveSession, type AuthUser } from "@/lib/session";

/** Ficha única, Fase 3: cargos acumuláveis (backend mockado via fetch). */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const badge = (over: Partial<Badge> & Pick<Badge, "name" | "slug">): Badge => ({
  id: 1, color: null, icon: null, accessRole: "PROFESSOR", rank: 10, ...over,
});
const CONTRAMESTRE = badge({ id: 11, name: "Contramestre", slug: "contramestre", color: "#dc2626", icon: "crown", accessRole: "PROFESSOR", rank: 80 });
const FORMADO = badge({ id: 12, name: "Formado", slug: "formado", color: "#facc15", icon: "graduation-cap", accessRole: "INSTRUTOR", rank: 50 });
const MONITOR = badge({ id: 13, name: "Monitor", slug: "monitor", accessRole: "MONITOR", rank: 10 });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const user = (role: AuthUser["role"], extra: Partial<AuthUser> = {}): AuthUser => ({
  id: 3, name: "Ana", email: "a@x", userType: "MEMBER", isSuperAdmin: false,
  organizationId: 1, organizationSlug: "g", role, ...extra,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });

function mockApi(me: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).replace(/^https?:\/\/[^/]+\/api/, "");
      if (path.startsWith("/auth/me")) return json(200, me);
      if (path.startsWith("/students/me")) return json(200, [{ id: 7, userId: 3, unitId: null, name: "Ana", photo: null, coverPhoto: null, socialLinks: null, joinedAt: null }]);
      return json(404, { message: `sem rota ${path}` });
    }),
  );
}

async function mountProfile() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}><ProfilePage /></QueryClientProvider>));
  await settle();
  await settle();
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("cargos do grupo no Perfil", () => {
  it("com roles (Badge[]): mostra nome do cargo do grupo, cor e ícone (maior rank primeiro) e o atalho do painel", async () => {
    saveSession("t", user("PROFESSOR"));
    // o servidor manda fora de ordem: o app ordena por rank
    mockApi({ roles: [MONITOR, CONTRAMESTRE], roleKeys: ["monitor", "contramestre"], pendingDeletionRequest: null });
    await mountProfile();

    const badges = [...container!.querySelectorAll<HTMLElement>("[data-testid^=role-badge-]")];
    expect(badges.map((b) => b.textContent)).toEqual(["Contramestre", "Monitor"]);
    expect(badges[0]!.style.backgroundColor).toBe("rgb(220, 38, 38)");
    expect(badges[0]!.querySelector("svg")).not.toBeNull(); // ícone crown
    expect(badges[1]!.style.backgroundColor).toBe(""); // sem cor: selo neutro
    expect(badges[1]!.querySelector("svg")).toBeNull();
    const link = container!.querySelector<HTMLAnchorElement>("[data-testid=panel-shortcut] a");
    expect(link?.textContent).toContain("Abrir o painel do grupo");
    expect(link?.getAttribute("href")).toBe(PAINEL_URL);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(container!.querySelector("[data-testid=panel-shortcut]")!.textContent).toContain("Como contramestre");
  });

  it("resposta antiga (roles: string[]) vira selos com o nome capitalizado", async () => {
    saveSession("t", user("PROFESSOR"));
    mockApi({ roles: ["MONITOR", "PROFESSOR"], pendingDeletionRequest: null });
    await mountProfile();

    const badges = [...container!.querySelectorAll("[data-testid^=role-badge-]")].map((b) => b.textContent);
    expect(badges).toEqual(["Professor", "Monitor"]);
  });

  it("sem cargo: nenhum selo e nenhum atalho do painel", async () => {
    saveSession("t", user("ALUNO"));
    mockApi({ roles: [], pendingDeletionRequest: null });
    await mountProfile();

    expect(container!.querySelector("[data-testid=role-badges]")).toBeNull();
    expect(container!.querySelector("[data-testid=panel-shortcut]")).toBeNull();
    expect(container!.textContent).toContain("Aluno");
  });

  it("app não quebra com role MONITOR (backend sem roles): trata como equipe que também é aluno", async () => {
    saveSession("t", user("MONITOR"));
    mockApi({ pendingDeletionRequest: null });
    await mountProfile();

    expect(container!.querySelector("[data-testid=role-badge-monitor]")?.textContent).toBe("Monitor");
    expect(container!.querySelector("[data-testid=panel-shortcut]")).not.toBeNull();
    expect(container!.textContent).toContain("Meu perfil");
  });
});

describe("cargo na Jornada", () => {
  it("o cartão de graduação mostra o cargo atual; sem cargo não mostra nada", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<GraduationCard name="Corda Verde" rope={null} subtitle="Grupo" role={FORMADO} />));
    const chip = container.querySelector<HTMLElement>("[data-testid=journey-role]")!;
    expect(chip.textContent).toBe("Formado");
    expect(chip.style.backgroundColor).toBe("rgb(250, 204, 21)");
    expect(chip.style.color).toBe("rgb(17, 17, 17)"); // fundo claro: texto escuro
    act(() => root!.render(<GraduationCard name="Corda Verde" rope={null} subtitle="Grupo" />));
    expect(container.querySelector("[data-testid=journey-role]")).toBeNull();
  });
});

describe("helpers de cargo", () => {
  it("normalizeBadges ordena por rank (maior primeiro), tira repetidos e ignora inválidos", () => {
    const result = normalizeBadges([MONITOR, "FOO", CONTRAMESTRE, null, FORMADO, CONTRAMESTRE, { name: "" }]);
    expect(result.map((b) => b.slug)).toEqual(["contramestre", "formado", "monitor"]);
    expect(normalizeBadges(undefined)).toEqual([]);
  });

  it("legado: string[] vira Badge por papel de acesso (MESTRE > PROFESSOR > INSTRUTOR > MONITOR), nome capitalizado", () => {
    const result = normalizeBadges(["MONITOR", "FOO", "MESTRE", "INSTRUTOR", "MESTRE"]);
    expect(result.map((b) => b.name)).toEqual(["Mestre", "Instrutor", "Monitor"]);
    expect(result.map((b) => b.accessRole)).toEqual(["MESTRE", "INSTRUTOR", "MONITOR"]);
    expect(result.every((b) => b.color === null && b.icon === null)).toBe(true);
  });

  it("primaryBadge = maior rank; toBadge tolera campos ausentes/cor inválida", () => {
    expect(primaryBadge([MONITOR, FORMADO, CONTRAMESTRE])?.name).toBe("Contramestre");
    expect(primaryBadge([])).toBeNull();
    const loose = toBadge({ name: "Aspirante", color: "vermelho", icon: 3 });
    expect(loose).toMatchObject({ name: "Aspirante", slug: "aspirante", color: null, icon: null });
  });

  it("ícone por nome kebab (com fallback) e cor do selo (texto legível)", () => {
    expect(roleIcon("graduation-cap")).not.toBeNull();
    expect(roleIcon("nao-existe")).toBeNull();
    expect(roleIcon(null)).toBeNull();
    expect(badgeStyle("#000000")).toEqual({ backgroundColor: "#000000", color: "#ffffff" });
    expect(badgeStyle("#facc15")?.color).toBe("#111111");
    expect(badgeStyle(null)).toBeUndefined();
    expect(badgeStyle("amarelo")).toBeUndefined();
  });

  it("isRoleNotification reconhece os avisos ROLE_*", () => {
    expect(["ROLE_GRANTED", "ROLE_REVOKED", "ROLE_SUGGESTION"].every(isRoleNotification)).toBe(true);
    expect(isRoleNotification("TRANSFER_REQUESTED")).toBe(false);
    expect(isRoleNotification(null)).toBe(false);
  });
});
