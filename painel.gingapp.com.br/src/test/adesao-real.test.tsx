import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
import { fetchGroupApplicationStatus, submitGroupApplication, toGroupApplicationPayload, emptyGroupApplicationForm } from "@/lib/group-application";
import { REAL_ADESAO } from "./real-contract-adesao";

/** Conformidade com o backend REAL: respostas capturadas do e2e passam no cliente e nas telas sem adaptação. */
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe("adesão: respostas reais do backend", () => {
  it("POST 201 real: statusToken + PENDING, e o cliente devolve o corpo como veio", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(201, REAL_ADESAO["post201"]))));
    const reply = await submitGroupApplication(toGroupApplicationPayload({ ...emptyGroupApplicationForm }));
    expect(reply).toEqual(REAL_ADESAO["post201"]);
    expect(reply.statusToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("GET de status real nos 3 estados mantém o formato lido pelo cliente (e sem campos pessoais)", async () => {
    for (const key of ["statusPending", "statusApproved", "statusRejected"]) {
      vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(200, REAL_ADESAO[key]))));
      const status = await fetchGroupApplicationStatus("tok");
      expect(Object.keys(status).sort()).toEqual(["createdAt", "decidedAt", "groupName", "loginUrl", "rejectionReason", "status"]);
      expect(JSON.stringify(status)).not.toMatch(/email|phone|applicantName|internalNote/i);
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

  it("tela de acompanhamento com o corpo REAL: em análise / aprovado / não aprovado com o motivo", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(200, REAL_ADESAO["statusPending"]))));
    renderStatus("a");
    expect(await screen.findByRole("heading", { name: /em análise/i })).toBeTruthy();
  });

  it("aprovado real mostra o botão de entrar; rejeitado real mostra o motivo escrito pela equipe", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(200, REAL_ADESAO["statusApproved"]))));
    renderStatus("b");
    expect(await screen.findByRole("link", { name: /entrar no painel/i })).toBeTruthy();
  });

  it("rejeitado real: motivo visível", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(200, REAL_ADESAO["statusRejected"]))));
    renderStatus("c");
    expect(await screen.findByText(REAL_ADESAO["statusRejected"]!.rejectionReason!)).toBeTruthy();
  });
});
