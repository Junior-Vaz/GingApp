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
import { PAINEL_URL, normalizeRoles } from "@/lib/roles";
import { isRoleNotification } from "@/lib/queries";
import { saveSession, type AuthUser } from "@/lib/session";

/** Ficha única, Fase 3: cargos acumuláveis (backend mockado via fetch). */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("cargos acumuláveis no Perfil", () => {
  it("com roles: mostra os selos (maior primeiro) e o atalho do painel em nova aba", async () => {
    saveSession("t", user("PROFESSOR", { roles: ["PROFESSOR", "MONITOR"] }));
    mockApi({ roles: ["PROFESSOR", "MONITOR"], pendingDeletionRequest: null });
    await mountProfile();

    const badges = [...container!.querySelectorAll("[data-testid^=role-badge-]")].map((b) => b.textContent);
    expect(badges).toEqual(["Professor", "Monitor"]);
    const link = container!.querySelector<HTMLAnchorElement>("[data-testid=panel-shortcut] a");
    expect(link?.textContent).toContain("Abrir o painel do grupo");
    expect(link?.getAttribute("href")).toBe(PAINEL_URL);
    expect(link?.getAttribute("target")).toBe("_blank");
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

    expect(container!.querySelector("[data-testid=role-badge-MONITOR]")?.textContent).toBe("Monitor");
    expect(container!.querySelector("[data-testid=panel-shortcut]")).not.toBeNull();
    expect(container!.textContent).toContain("Meu perfil");
  });
});

describe("cargo na Jornada", () => {
  it("o cartão de graduação mostra o cargo atual; sem cargo não mostra nada", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<GraduationCard name="Corda Verde" rope={null} subtitle="Grupo" roleLabel="Instrutor" />));
    expect(container.querySelector("[data-testid=journey-role]")?.textContent).toBe("Instrutor");
    act(() => root!.render(<GraduationCard name="Corda Verde" rope={null} subtitle="Grupo" />));
    expect(container.querySelector("[data-testid=journey-role]")).toBeNull();
  });
});

describe("helpers de cargo", () => {
  it("normalizeRoles ordena MESTRE > PROFESSOR > INSTRUTOR > MONITOR e ignora desconhecidos", () => {
    expect(normalizeRoles(["MONITOR", "FOO", "MESTRE", "INSTRUTOR", "MESTRE"])).toEqual(["MESTRE", "INSTRUTOR", "MONITOR"]);
    expect(normalizeRoles(undefined)).toEqual([]);
  });

  it("isRoleNotification reconhece os avisos ROLE_*", () => {
    expect(["ROLE_GRANTED", "ROLE_REVOKED", "ROLE_SUGGESTION"].every(isRoleNotification)).toBe(true);
    expect(isRoleNotification("TRANSFER_REQUESTED")).toBe(false);
    expect(isRoleNotification(null)).toBe(false);
  });
});
