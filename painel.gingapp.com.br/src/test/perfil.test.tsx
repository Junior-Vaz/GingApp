import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { routeTree } from "@/routeTree.gen";
import { canAccessRoute } from "@/lib/nav";
import { clearSession, getUser, saveSession, type AuthUser } from "@/lib/session";

vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));

type Call = { method: string; path: string; body: unknown };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const UPLOADED = "/api/uploads/11111111-2222-4333-8444-555555555555.webp";

function makeUser(over: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 7,
    name: "Mestre Bimba",
    email: "bimba@axe.com",
    userType: "MEMBER",
    isSuperAdmin: false,
    organizationId: 1,
    organizationSlug: "axe",
    organizationName: "Capoeira Axé",
    role: "MESTRE",
    ...over,
  };
}

/** Responde por "MÉTODO /caminho"; registra as chamadas (com o corpo JSON) para conferir os payloads. */
function mockApi(routes: Record<string, (body: unknown) => Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?")[0] ?? "";
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : init.body;
      calls.push({ method, path, body });
      const handler = routes[`${method} ${path}`];
      return Promise.resolve(
        handler ? handler(body) : json(404, { message: `sem rota ${method} ${path}` }),
      );
    }),
  );
  return calls;
}

function openPanel(path: string, user: AuthUser) {
  saveSession("tok", user);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const ficha = (over: Record<string, unknown> = {}) => ({
  person: {
    id: 3,
    gingappCode: "GA-ABC123",
    name: "Mestre Bimba",
    nickname: "Bimba",
    photo: null,
    ...over,
  },
});

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("Cabeçalho: grupo + avatar", () => {
  it("mostra o nome do grupo e o avatar com a FOTO da sessão (link para o perfil)", async () => {
    mockApi({ "GET /auth/me": () => json(200, makeUser({ photo: "https://x.test/eu.png" })) });
    openPanel("/alunos", makeUser({ photo: "https://x.test/eu.png" }));
    const group = await screen.findByTestId("topbar-group");
    expect(group).toHaveTextContent("Capoeira Axé");
    const avatar = screen.getByTestId("topbar-avatar");
    expect(avatar).toHaveAttribute("href", "/perfil");
    expect(avatar.querySelector("img")).toHaveAttribute("src", "https://x.test/eu.png");
  });

  it("sem foto o avatar mostra as iniciais; o nome do grupo cai no slug se a sessão não o trouxer", async () => {
    mockApi({});
    openPanel("/alunos", makeUser({ organizationName: null, name: "Mestre Bimba" }));
    const avatar = await screen.findByTestId("topbar-avatar");
    expect(avatar).toHaveTextContent("MB");
    expect(avatar.querySelector("img")).toBeNull();
    expect(screen.getByTestId("topbar-group")).toHaveTextContent("axe");
  });

  it("o nome do grupo é truncado (não estoura a largura) e o avatar não encolhe", async () => {
    mockApi({});
    openPanel(
      "/alunos",
      makeUser({
        organizationName: "Associação Cultural de Capoeira Angola Palmares do Mundo Todo",
      }),
    );
    const group = await screen.findByTestId("topbar-group");
    expect(group.querySelector(".truncate")).not.toBeNull();
    expect(group.querySelector(".truncate")!.className).toMatch(/max-w-\[7\.5rem\]/);
    expect(screen.getByTestId("topbar-avatar").className).toContain("shrink-0");
  });

  it("sessão antiga sem foto: GET /auth/me traz a foto e o avatar passa a mostrá-la", async () => {
    mockApi({
      "GET /auth/me": () =>
        json(200, makeUser({ photo: "https://x.test/nova.png", organizationName: "Axé Renovado" })),
    });
    openPanel("/alunos", makeUser());
    await waitFor(() =>
      expect(screen.getByTestId("topbar-avatar").querySelector("img")).toHaveAttribute(
        "src",
        "https://x.test/nova.png",
      ),
    );
    expect(screen.getByTestId("topbar-group")).toHaveTextContent("Axé Renovado");
    expect(getUser()?.photo).toBe("https://x.test/nova.png");
  });

  it("o caminho relativo de upload da foto é resolvido com imageSrc (origem da API)", async () => {
    mockApi({});
    openPanel("/alunos", makeUser({ photo: UPLOADED }));
    const img = (await screen.findByTestId("topbar-avatar")).querySelector("img");
    expect(img?.getAttribute("src")).toMatch(
      /\/api\/uploads\/11111111-2222-4333-8444-555555555555\.webp$/,
    );
  });
});

describe("Menu 'Mais' (celular)", () => {
  it("tem o item 'Meu perfil' com o avatar da foto da sessão e leva a /perfil", async () => {
    mockApi({});
    const router = openPanel("/alunos", makeUser({ photo: "https://x.test/eu.png" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mais" }));
    const link = await screen.findByTestId("mobile-profile-link");
    expect(link).toHaveAttribute("href", "/perfil");
    expect(link.querySelector("img")).toHaveAttribute("src", "https://x.test/eu.png");
    expect(within(link).getByTestId("drawer-user")).toHaveTextContent(
      "Mestre Bimba · Mestre · Capoeira Axé",
    );
    fireEvent.click(link);
    await waitFor(() => expect(router.state.location.pathname).toBe("/perfil"));
  });
});

describe("Rota /perfil", () => {
  it("é acessível por todos os papéis do painel (MESTRE, PROFESSOR, INSTRUTOR, MONITOR)", async () => {
    for (const role of ["MESTRE", "PROFESSOR", "INSTRUTOR", "MONITOR"] as const) {
      expect(canAccessRoute(role, "/perfil")).toBe(true);
      cleanup();
      localStorage.clear();
      mockApi({
        "GET /people/me/ficha": () => json(200, ficha()),
        "GET /people/me/code": () => json(404, {}),
      });
      const router = openPanel("/perfil", makeUser({ role }));
      expect(await screen.findByTestId("perfil-page")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/perfil");
    }
  });

  it("sem sessão vai para o login", async () => {
    const queryClient = new QueryClient();
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/perfil"] }),
      context: { queryClient },
    });
    await router.load();
    expect(router.state.location.pathname).toBe("/login");
  });
});

describe("Tela de perfil", () => {
  const baseRoutes = (over: Record<string, (body: unknown) => Response> = {}) => ({
    "GET /auth/me": () =>
      json(200, {
        ...makeUser(),
        phone: "62 99999-0000",
        twoFactorEnabled: false,
        recoveryCodesRemaining: 0,
      }),
    "GET /people/me/ficha": () => json(200, ficha()),
    "GET /people/me/code": () =>
      json(200, { personId: 3, gingappCode: "GA-ABC123", qrDataUrl: "data:image/png;base64,AAAA" }),
    ...over,
  });

  it("carrega nome, apelido, telefone, e-mail (somente leitura), cargos, grupo e código GingApp", async () => {
    mockApi(baseRoutes());
    openPanel(
      "/perfil",
      makeUser({
        roles: [
          {
            id: 1,
            name: "Contramestre",
            slug: "contramestre",
            color: "#7c3aed",
            icon: null,
            accessRole: "MESTRE",
            rank: 90,
          },
        ],
      }),
    );
    expect(await screen.findByDisplayValue("Bimba")).toBeInTheDocument(); // apelido
    expect(screen.getByLabelText("Nome")).toHaveValue("Mestre Bimba");
    await waitFor(() => expect(screen.getByLabelText("Telefone")).toHaveValue("62 99999-0000"));
    expect(screen.getByLabelText("E-mail")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("E-mail")).toHaveValue("bimba@axe.com");
    expect(screen.getByTestId("profile-hero")).toHaveTextContent("Contramestre");
    expect(screen.getByTestId("profile-group")).toHaveTextContent("Capoeira Axé");
    expect(await screen.findByTestId("profile-code-value")).toHaveTextContent("GA-ABC123");
    expect(screen.getByTestId("profile-security")).toBeInTheDocument();
    expect(screen.getByTestId("profile-data")).toBeInTheDocument();
  });

  it("troca a foto: POST /uploads, PATCH /auth/me/profile { photo } e PATCH /people/me { photo }; o avatar passa a usá-la", async () => {
    const calls = mockApi(
      baseRoutes({
        "POST /uploads": () => json(201, { url: UPLOADED }),
        "PATCH /auth/me/profile": () => json(200, { ...makeUser(), photo: UPLOADED }),
        "PATCH /people/me": () => json(200, ficha({ photo: UPLOADED })),
      }),
    );
    openPanel("/perfil", makeUser());
    await screen.findByDisplayValue("Bimba");
    const input = screen.getByTestId("profile-photo-input");
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array([1, 2, 3])], "eu.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Foto atualizada."));
    expect(calls.find((c) => c.method === "POST" && c.path === "/uploads")).toBeDefined();
    expect(calls.find((c) => c.method === "PATCH" && c.path === "/auth/me/profile")?.body).toEqual({
      photo: UPLOADED,
    });
    expect(calls.find((c) => c.method === "PATCH" && c.path === "/people/me")?.body).toEqual({
      photo: UPLOADED,
    });
    expect(getUser()?.photo).toBe(UPLOADED);
    await waitFor(() =>
      expect(screen.getByTestId("topbar-avatar").querySelector("img")).not.toBeNull(),
    );
  });

  it("recusa arquivo que não é imagem (sem rede) e remove a foto com null", async () => {
    const calls = mockApi(
      baseRoutes({
        "PATCH /auth/me/profile": () => json(200, { ...makeUser(), photo: null }),
        "PATCH /people/me": () => json(200, ficha()),
      }),
    );
    openPanel("/perfil", makeUser({ photo: "https://x.test/eu.png" }));
    await screen.findByDisplayValue("Bimba");
    fireEvent.change(screen.getByTestId("profile-photo-input"), {
      target: { files: [new File(["x"], "doc.pdf", { type: "application/pdf" })] },
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(calls.some((c) => c.method === "POST" && c.path === "/uploads")).toBe(false);

    fireEvent.click(screen.getByTestId("profile-photo-remove"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Foto removida."));
    expect(calls.find((c) => c.method === "PATCH" && c.path === "/auth/me/profile")?.body).toEqual({
      photo: null,
    });
    expect(getUser()?.photo).toBeNull();
  });

  it("salva nome, apelido e telefone com PATCH /people/me e atualiza o nome da sessão", async () => {
    const calls = mockApi(
      baseRoutes({ "PATCH /people/me": () => json(200, ficha({ name: "Mestre Pastinha" })) }),
    );
    openPanel("/perfil", makeUser());
    const nome = await screen.findByLabelText("Nome");
    await waitFor(() => expect(screen.getByLabelText("Telefone")).toHaveValue("62 99999-0000"));
    fireEvent.change(nome, { target: { value: "  Mestre Pastinha " } });
    fireEvent.change(screen.getByLabelText("Apelido"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Telefone"), { target: { value: "62 98888-7777" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar alterações/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Dados atualizados."));
    expect(calls.find((c) => c.method === "PATCH" && c.path === "/people/me")?.body).toEqual({
      name: "Mestre Pastinha",
      nickname: null,
      phone: "62 98888-7777",
    });
    expect(getUser()?.name).toBe("Mestre Pastinha");
  });

  it("nome curto demais não vai para a API", async () => {
    const calls = mockApi(baseRoutes());
    openPanel("/perfil", makeUser());
    const nome = await screen.findByLabelText("Nome");
    await screen.findByDisplayValue("Bimba");
    fireEvent.change(nome, { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar alterações/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("mínimo de 2");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("usuário sem ficha de pessoa (404): dados somente leitura, sem botão de salvar, sem código; a foto continua alterável", async () => {
    const calls = mockApi({
      "GET /auth/me": () =>
        json(200, {
          ...makeUser(),
          phone: null,
          twoFactorEnabled: true,
          recoveryCodesRemaining: 4,
        }),
      "GET /people/me/ficha": () => json(404, { message: "Pessoa não encontrada" }),
      "GET /people/me/code": () => json(404, { message: "Pessoa não encontrada" }),
      "POST /uploads": () => json(201, { url: UPLOADED }),
      "PATCH /auth/me/profile": () => json(200, { ...makeUser(), photo: UPLOADED }),
    });
    openPanel("/perfil", makeUser());
    expect(await screen.findByRole("note")).toHaveTextContent("só a foto pode ser alterada");
    expect(screen.getByLabelText("Nome")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: /Salvar alterações/ })).toBeNull();
    expect(screen.queryByTestId("profile-code")).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId("profile-2fa-status")).toHaveTextContent("ligada"),
    );

    fireEvent.change(screen.getByTestId("profile-photo-input"), {
      target: { files: [new File([new Uint8Array([1])], "eu.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Foto atualizada."));
    expect(calls.find((c) => c.method === "PATCH" && c.path === "/auth/me/profile")?.body).toEqual({
      photo: UPLOADED,
    });
    expect(calls.some((c) => c.method === "PATCH" && c.path === "/people/me")).toBe(false);
  });
});
