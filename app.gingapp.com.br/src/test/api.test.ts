import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, setUnauthorizedHandler } from "@/lib/api";
import { getToken, saveSession, type AuthUser } from "@/lib/session";

const user: AuthUser = {
  id: 1,
  name: "Aluno Teste",
  email: "a@b.com",
  userType: "MEMBER",
  isSuperAdmin: false,
  organizationId: 1,
  organizationSlug: "grupo",
  role: "ALUNO",
};

function mockFetch(status: number, body: string) {
  const fn = vi.fn().mockResolvedValue(new Response(body, { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("api client", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
  });

  it("envia Authorization quando há token e usa o fallback de URL", async () => {
    saveSession("tok123", user);
    const fetchMock = mockFetch(200, JSON.stringify({ ok: true }));
    await expect(api.get("/students/me")).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/students\/me$/);
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok123");
  });

  it("junta message em array do NestJS", async () => {
    mockFetch(400, JSON.stringify({ message: ["email inválido", "senha curta"] }));
    await expect(api.post("/x", { a: 1 })).rejects.toMatchObject({
      message: "email inválido senha curta",
      status: 400,
    });
  });

  it("aceita corpo vazio em 200/201/204", async () => {
    mockFetch(201, "");
    await expect(api.post("/rodas/1/participants")).resolves.toBeUndefined();
  });

  it("401 limpa a sessão e chama o handler de redirecionamento", async () => {
    saveSession("tok", user);
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockFetch(401, JSON.stringify({ message: "Unauthorized" }));
    await expect(api.get("/finance/me")).rejects.toBeInstanceOf(ApiError);
    expect(getToken()).toBeNull();
    expect(localStorage.getItem("mb_user")).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("401 no login (skipAuthRedirect) não dispara redirecionamento", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockFetch(401, JSON.stringify({ message: "Credenciais inválidas." }));
    await expect(api.post("/auth/login", {}, { skipAuthRedirect: true })).rejects.toThrow("Credenciais inválidas.");
    expect(handler).not.toHaveBeenCalled();
  });
});
