import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { clearSession } from "@/lib/session";
import {
  downloadCampaignCsv,
  sponsorsErrorMessage,
  uploadSponsorImage,
  useAcceptTerms,
  useCampaignMutations,
  useCampaignReport,
  useCampaigns,
  useSponsorMutations,
  useSponsors,
  useTerms,
} from "@/modules/patrocinadores/api";
import { loginAs } from "./login-as";
import { CAMPAIGNS, REPORT, SPONSORS, TERMS, UPLOADED, baseRoutes, campaign, fileOf, json, mockApi, sent } from "./patrocinadores-fixtures";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => loginAs("MESTRE"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("API do Mestre (formatos do contrato, com fetch falso)", () => {
  it("GET /group-sponsors/terms devolve { version, text, accepted, acceptedAt, blocked, blockedReason } com o Bearer do Mestre", async () => {
    const calls = mockApi(baseRoutes());
    const { result } = renderHook(() => useTerms(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toEqual(TERMS));
    expect(calls[0]?.headers["Authorization"]).toBe("Bearer tok");
    expect(sent(calls, "GET", "/group-sponsors/terms")).toHaveLength(1);
  });

  it("POST /group-sponsors/terms/accept manda { version } e recarrega o termo", async () => {
    let accepted = false;
    const calls = mockApi(
      baseRoutes({
        "GET /group-sponsors/terms": () => json(200, { ...TERMS, accepted }),
        "POST /group-sponsors/terms/accept": () => {
          accepted = true;
          return json(201, {});
        },
      }),
    );
    const { result } = renderHook(() => ({ terms: useTerms(), accept: useAcceptTerms() }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.terms.data?.accepted).toBe(false));
    await act(async () => {
      await result.current.accept.mutateAsync("2026-11-v1");
    });
    expect(sent(calls, "POST", "/group-sponsors/terms/accept")[0]?.body).toEqual({ version: "2026-11-v1" });
    await waitFor(() => expect(result.current.terms.data?.accepted).toBe(true));
  });

  it("409 TERMS_VERSION_MISMATCH no aceite recarrega o termo (GET de novo) e o erro vira mensagem clara", async () => {
    const calls = mockApi(
      baseRoutes({
        "POST /group-sponsors/terms/accept": () => json(409, { code: "TERMS_VERSION_MISMATCH", message: "versão diferente" }),
      }),
    );
    const { result } = renderHook(() => ({ terms: useTerms(), accept: useAcceptTerms() }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.terms.data).toBeDefined());
    const before = sent(calls, "GET", "/group-sponsors/terms").length;
    let error: unknown;
    await act(async () => {
      await result.current.accept.mutateAsync("antiga").catch((e: unknown) => (error = e));
    });
    await waitFor(() => expect(sent(calls, "GET", "/group-sponsors/terms").length).toBeGreaterThan(before));
    expect(sponsorsErrorMessage(error, "x")).toMatch(/termo foi atualizado/);
  });

  it("lista de patrocinadores: GET com limit/offset (+ q) e total do X-Total-Count", async () => {
    const calls = mockApi(baseRoutes());
    const { result } = renderHook(() => useSponsors({ q: "berim" }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.items).toHaveLength(2));
    expect(result.current.data?.total).toBe(2);
    const call = sent(calls, "GET", "/group-sponsors")[0]!;
    expect(call.query.get("q")).toBe("berim");
    expect(call.query.get("limit")).toBe("100");
    expect(call.query.get("offset")).toBe("0");
  });

  it("lista de campanhas: filtros effective/sponsorId/q vão na query; vazios são omitidos", async () => {
    const calls = mockApi(baseRoutes());
    const { result, rerender } = renderHook(({ p }) => useCampaigns(p), {
      wrapper: wrapper(),
      initialProps: { p: {} as Parameters<typeof useCampaigns>[0] },
    });
    await waitFor(() => expect(result.current.data?.items).toHaveLength(CAMPAIGNS.length));
    expect([...sent(calls, "GET", "/group-sponsor-campaigns")[0]!.query.keys()].sort()).toEqual(["limit", "offset"]);
    rerender({ p: { effective: "ACTIVE_NOW", sponsorId: 2, q: "promo" } });
    await waitFor(() => expect(sent(calls, "GET", "/group-sponsor-campaigns")).toHaveLength(2));
    const q = sent(calls, "GET", "/group-sponsor-campaigns")[1]!.query;
    expect(q.get("effective")).toBe("ACTIVE_NOW");
    expect(q.get("sponsorId")).toBe("2");
    expect(q.get("q")).toBe("promo");
  });

  it("mutações de patrocinador: POST, PATCH, DELETE em /group-sponsors", async () => {
    const calls = mockApi(
      baseRoutes({
        "POST /group-sponsors": () => json(201, SPONSORS[0]),
        "PATCH /group-sponsors/1": () => json(200, SPONSORS[0]),
        "DELETE /group-sponsors/1": () => new Response(null, { status: 204 }),
      }),
    );
    const { result } = renderHook(() => useSponsorMutations(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.create.mutateAsync({ name: "Loja" });
      await result.current.update.mutateAsync({ id: 1, body: { name: "Loja 2" } });
      await result.current.remove.mutateAsync(1);
    });
    expect(sent(calls, "POST", "/group-sponsors")[0]?.body).toEqual({ name: "Loja" });
    expect(sent(calls, "PATCH", "/group-sponsors/1")[0]?.body).toEqual({ name: "Loja 2" });
    expect(sent(calls, "DELETE", "/group-sponsors/1")).toHaveLength(1);
  });

  it("mutações de campanha: POST/PATCH/DELETE e ações activate, pause, resume (sem corpo)", async () => {
    const calls = mockApi(
      baseRoutes({
        "POST /group-sponsor-campaigns": () => json(201, campaign()),
        "PATCH /group-sponsor-campaigns/1": () => json(200, campaign()),
        "DELETE /group-sponsor-campaigns/1": () => new Response(null, { status: 204 }),
        "POST /group-sponsor-campaigns/1/activate": () => json(201, campaign()),
        "POST /group-sponsor-campaigns/1/pause": () => json(201, campaign()),
        "POST /group-sponsor-campaigns/1/resume": () => json(201, campaign()),
      }),
    );
    const { result } = renderHook(() => useCampaignMutations(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.create.mutateAsync({ title: "T" });
      await result.current.update.mutateAsync({ id: 1, body: { title: "T2" } });
      await result.current.activate.mutateAsync(1);
      await result.current.pause.mutateAsync(1);
      await result.current.resume.mutateAsync(1);
      await result.current.remove.mutateAsync(1);
    });
    for (const [method, path] of [
      ["POST", "/group-sponsor-campaigns"],
      ["PATCH", "/group-sponsor-campaigns/1"],
      ["POST", "/group-sponsor-campaigns/1/activate"],
      ["POST", "/group-sponsor-campaigns/1/pause"],
      ["POST", "/group-sponsor-campaigns/1/resume"],
      ["DELETE", "/group-sponsor-campaigns/1"],
    ] as const) {
      expect(sent(calls, method, path), `${method} ${path}`).toHaveLength(1);
    }
    expect(sent(calls, "POST", "/group-sponsor-campaigns/1/activate")[0]?.body).toBeUndefined();
  });

  it("relatório: GET /group-sponsor-campaigns/:id/report?from&to; período invertido não consulta", async () => {
    const calls = mockApi(baseRoutes({ "GET /group-sponsor-campaigns/2/report": () => json(200, REPORT) }));
    const { result } = renderHook(() => useCampaignReport(2, { from: "2026-11-10", to: "2026-11-20" }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toEqual(REPORT));
    const q = sent(calls, "GET", "/group-sponsor-campaigns/2/report")[0]!.query;
    expect([q.get("from"), q.get("to")]).toEqual(["2026-11-10", "2026-11-20"]);

    const calls2 = mockApi(baseRoutes());
    renderHook(() => useCampaignReport(2, { from: "2026-11-20", to: "2026-11-10" }), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 30));
    expect(calls2).toHaveLength(0);
  });

  it("upload: recusa no navegador (> 250 KB, formato) SEM chamar a rede; válido vai por POST /group-sponsor-uploads (multipart 'file')", async () => {
    const calls = mockApi({ "POST /group-sponsor-uploads": () => json(201, { url: UPLOADED }) });
    await expect(uploadSponsorImage(fileOf("grande.png", "image/png", 250 * 1024 + 1))).rejects.toMatchObject({ message: expect.stringContaining("250 KB") });
    await expect(uploadSponsorImage(fileOf("a.gif", "image/gif"))).rejects.toMatchObject({ message: expect.stringContaining("JPEG, PNG ou WebP") });
    expect(calls).toHaveLength(0);
    await expect(uploadSponsorImage(fileOf("ok.webp", "image/webp", 250 * 1024))).resolves.toBe(UPLOADED);
    const form = calls[0]?.body as FormData;
    expect(calls[0]?.method).toBe("POST");
    expect(form.get("file")).toBeInstanceOf(File);
    expect(calls[0]?.headers["Authorization"]).toBe("Bearer tok");
  });

  it("CSV: GET autenticado (Bearer) em report.csv?from&to e entrega o arquivo campanha-<id>-<from>_a_<to>.csv", async () => {
    const calls = mockApi({
      "GET /group-sponsor-campaigns/7/report.csv": () => new Response("﻿dia;impressoes\r\n", { status: 200, headers: { "Content-Type": "text/csv" } }),
    });
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    await downloadCampaignCsv(7, { from: "2026-11-01", to: "2026-11-30" });
    const call = calls[0]!;
    expect(call.headers["Authorization"]).toBe("Bearer tok");
    expect(call.query.get("from")).toBe("2026-11-01");
    expect(call.query.get("to")).toBe("2026-11-30");
    expect(names).toEqual(["campanha-7-2026-11-01_a_2026-11-30.csv"]);
  });
});

describe("mensagens de erro do servidor mapeadas", () => {
  const err = (status: number, code?: string, message = "msg do servidor") => new ApiError(message, status, code);

  it.each([
    [err(409, "SPONSOR_HAS_CAMPAIGNS"), /ainda tem campanhas/],
    [err(409, "SPONSOR_LIMIT"), /no máximo 10 patrocinadores, 10 campanhas e 3 campanhas ativas/],
    [err(403, "SPONSOR_TERMS_REQUIRED"), /Aceite o termo de responsabilidade/],
    [err(403, "SPONSORS_BLOCKED"), /plataforma bloqueou o patrocínio local/],
    [err(403, "SUSPENDED_BY_PLATFORM"), /suspensa pela plataforma e não pode ser retomada/],
    [err(409, "TERMS_VERSION_MISMATCH"), /termo foi atualizado/],
    [err(400, "CAMPAIGN_ENDED"), /já terminou/],
    [err(409, "INVALID_TRANSITION"), /situação da campanha mudou/],
    [err(403), /Somente o Mestre/],
    [err(404), /não encontrado/],
    [err(413), /250 KB/],
    [err(429), /Muitas tentativas/],
    [err(400, undefined, "title deve ter até 60 caracteres"), /title deve ter/],
    [new TypeError("Failed to fetch"), /Sem conexão/],
  ])("%#", (error, expected) => {
    expect(sponsorsErrorMessage(error, "fallback")).toMatch(expected);
  });

  it("erro desconhecido usa o fallback", () => {
    expect(sponsorsErrorMessage(new Error("boom"), "fallback")).toBe("fallback");
  });
});
