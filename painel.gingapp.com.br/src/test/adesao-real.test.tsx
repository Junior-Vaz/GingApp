import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
import {
  confirmGroupApplicationEmail,
  emptyGroupApplicationForm,
  fetchGroupApplicationStatus,
  resendGroupApplicationEmail,
  submitGroupApplication,
  toGroupApplicationPayload,
} from "@/lib/group-application";
import { REAL_ADESAO } from "./real-contract-adesao";

/** Conformidade com o backend REAL: respostas capturadas do e2e passam no cliente e nas telas sem adaptação. */
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const real = (key: string) => REAL_ADESAO[key]!;

afterEach(() => vi.unstubAllGlobals());

describe("adesão: respostas reais do backend", () => {
  it("POST 201 real nos dois modos: statusToken + estado + emailVerification, e o cliente devolve o corpo como veio", async () => {
    for (const [key, status, verification] of [
      ["post201Unverified", "UNVERIFIED", "PENDING"],
      ["post201Pending", "PENDING", "SKIPPED"],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(201, real(key)))));
      const reply = await submitGroupApplication(toGroupApplicationPayload({ ...emptyGroupApplicationForm }));
      expect(reply).toEqual(real(key));
      expect(reply.statusToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(reply.status).toBe(status);
      expect(reply.emailVerification).toBe(verification);
    }
  });

  it("GET de status real nos estados: chaves esperadas e nenhum dado pessoal", async () => {
    const base = ["createdAt", "decidedAt", "emailVerification", "groupName", "loginUrl", "rejectionReason", "status"];
    for (const key of ["statusPendingVerified", "statusPendingSkipped", "statusApproved", "statusRejected"]) {
      vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(200, real(key)))));
      const status = await fetchGroupApplicationStatus("tok");
      expect(Object.keys(status).sort(), key).toEqual(base);
    }
    for (const key of ["statusUnverified", "statusUnverifiedCanResend"]) {
      vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(200, real(key)))));
      const status = await fetchGroupApplicationStatus("tok");
      expect(Object.keys(status).sort(), key).toEqual([...base, "canResend", "resendAvailableAt"].sort());
    }
    const text = JSON.stringify(REAL_ADESAO);
    expect(text).not.toMatch(/"(email|phone|applicantName|internalNote|instagram|passwordHash)"/);
  });

  it("espera de reenvio real: canResend false com horário; liberado: canResend true e horário nulo", () => {
    expect(real("statusUnverified")).toMatchObject({ canResend: false });
    expect(typeof real("statusUnverified")["resendAvailableAt"]).toBe("string");
    expect(real("statusUnverifiedCanResend")).toMatchObject({ canResend: true, resendAvailableAt: null });
  });

  it("confirm 200 real e 404 real; reenvio 204 sem corpo; 429 reais com code", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(200, real("confirm200")))));
    await expect(confirmGroupApplicationEmail("tok")).resolves.toMatchObject({ status: "PENDING" });

    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(404, real("confirm404")))));
    await expect(confirmGroupApplicationEmail("tok")).rejects.toMatchObject({ status: 404 });

    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))));
    await expect(resendGroupApplicationEmail("tok")).resolves.not.toThrow();

    for (const [key, code] of [
      ["resend429Cooldown", "RESEND_COOLDOWN"],
      ["resend429Limit", "RESEND_LIMIT"],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(429, real(key)))));
      await expect(resendGroupApplicationEmail("tok"), key).rejects.toMatchObject({ status: 429, code });
    }
  });

  function renderStatus(token: string) {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: [`/comecar/acompanhar/${token}`] }),
      context: { queryClient: new QueryClient() },
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  }

  it("tela de acompanhamento com o corpo REAL: em análise", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(200, real("statusPendingVerified")))));
    renderStatus("a");
    expect(await screen.findByRole("heading", { name: /em análise/i })).toBeTruthy();
  });

  it("tela de acompanhamento com o corpo REAL: aguardando confirmação do e-mail", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(200, real("statusUnverified")))));
    renderStatus("u");
    expect(await screen.findByTestId("status-unverified")).toBeTruthy();
  });

  it("aprovado real mostra o botão de entrar", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(200, real("statusApproved")))));
    renderStatus("b");
    expect(await screen.findByRole("link", { name: /entrar no painel/i })).toBeTruthy();
  });

  it("rejeitado real: motivo visível", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(200, real("statusRejected")))));
    renderStatus("c");
    expect(await screen.findByText(real("statusRejected")["rejectionReason"] as string)).toBeTruthy();
  });
});
