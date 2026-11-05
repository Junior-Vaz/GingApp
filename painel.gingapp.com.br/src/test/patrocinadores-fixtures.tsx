import { vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { CampaignReport, GroupCampaign, GroupSponsor, SponsorTerms } from "@/modules/patrocinadores/sponsor-utils";

/** Formatos do contrato (docs/CONTRATO_PATROCINADORES_GRUPO.md §3) com fetch falso. */

export const UPLOADED = "/api/uploads/3f2b8c1e-5d4a-4c3b-9a7e-1b2c3d4e5f60.webp";

export const TERMS: SponsorTerms = {
  version: "2026-11-v1",
  text: "1. Eu respondo pelo conteúdo.\n2. Não anuncio bebidas alcoólicas.",
  accepted: true,
  acceptedAt: "2026-11-02T15:30:00.000Z",
  blocked: false,
  blockedReason: null,
};

export const sponsor = (over: Partial<GroupSponsor> = {}): GroupSponsor => ({
  id: 1,
  name: "Loja Berimbau",
  logo: null,
  contactName: "Joana",
  contactEmail: "joana@berimbau.com.br",
  contactPhone: "62999990000",
  document: null,
  notes: null,
  createdAt: "2026-11-01T12:00:00.000Z",
  updatedAt: "2026-11-01T12:00:00.000Z",
  ...over,
});

export const campaign = (over: Partial<GroupCampaign> = {}): GroupCampaign => ({
  id: 1,
  sponsorId: 1,
  sponsor: { id: 1, name: "Loja Berimbau", logo: null },
  sponsorName: "Loja Berimbau",
  title: "Rascunho promo",
  text: "Texto da campanha",
  imageRef: null,
  ctaLabel: "Conhecer",
  destinationUrl: "https://www.berimbau.com.br/promo",
  destinationHost: "www.berimbau.com.br",
  category: "INSTRUMENTOS",
  startsAt: "2026-11-10T11:00:00.000Z",
  endsAt: "2026-12-10T11:00:00.000Z",
  status: "DRAFT",
  effectiveStatus: "DRAFT",
  priceCents: null,
  billingNote: null,
  approvedByUserId: null,
  approvedAt: null,
  approvedBy: null,
  platformSuspended: false,
  platformSuspendReason: null,
  createdAt: "2026-11-01T12:00:00.000Z",
  updatedAt: "2026-11-01T12:00:00.000Z",
  ...over,
});

export const SPONSORS = [sponsor(), sponsor({ id: 2, name: "Casa do Capoeirista", contactName: null, contactEmail: null, contactPhone: null })];

export const CAMPAIGNS: GroupCampaign[] = [
  campaign(),
  campaign({ id: 2, title: "No ar promo", status: "ACTIVE", effectiveStatus: "ACTIVE_NOW", approvedByUserId: 1, approvedAt: "2026-11-05T13:00:00.000Z", approvedBy: { id: 1, name: "Mestre" } }),
  campaign({ id: 3, title: "Pausada promo", status: "PAUSED", effectiveStatus: "PAUSED" }),
  campaign({ id: 4, title: "Encerrada promo", status: "ACTIVE", effectiveStatus: "ENDED" }),
  campaign({ id: 5, title: "Agendada promo", status: "ACTIVE", effectiveStatus: "SCHEDULED" }),
  campaign({ id: 6, title: "Suspensa promo", status: "PAUSED", effectiveStatus: "PAUSED", platformSuspended: true, platformSuspendReason: "Conteúdo duvidoso" }),
];

export const REPORT: CampaignReport = {
  campaign: { id: 2, title: "No ar promo", sponsorName: "Loja Berimbau", startsAt: "2026-11-10T11:00:00.000Z", endsAt: "2026-12-10T11:00:00.000Z", status: "ACTIVE" },
  totals: { impressions: 1234, clicks: 56, ctr: 4.54 },
  byDay: [
    { day: "2026-11-10", impressions: 600, clicks: 20 },
    { day: "2026-11-12", impressions: 634, clicks: 36 },
  ],
  byState: [
    { state: "GO", impressions: 1000, clicks: 50 },
    { state: "", impressions: 234, clicks: 6 },
  ],
};

export type Call = { method: string; path: string; query: URLSearchParams; body: unknown; headers: Record<string, string>; raw: RequestInit };
export const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
export const list = (items: unknown[]) => json(200, items, { "X-Total-Count": String(items.length) });

/** fetch falso roteado por "METHOD /caminho" (sem prefixo da API nem query); registra as chamadas. */
export function mockApi(routes: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const [path = "", search = ""] = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
      const method = init.method ?? "GET";
      let body: unknown;
      if (typeof init.body === "string") body = JSON.parse(init.body);
      else if (init.body instanceof FormData) body = init.body;
      const call: Call = { method, path, query: new URLSearchParams(search), body, headers: (init.headers ?? {}) as Record<string, string>, raw: init };
      calls.push(call);
      const handler = routes[`${method} ${path}`];
      return Promise.resolve(handler ? handler(call) : json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
  return calls;
}

/** Rotas de leitura padrão (termo aceito, 2 patrocinadores, 6 campanhas). */
export function baseRoutes(over: Record<string, (call: Call) => Response | Promise<Response>> = {}) {
  return {
    "GET /group-sponsors/terms": () => json(200, TERMS),
    "GET /group-sponsors": () => list(SPONSORS),
    "GET /group-sponsor-campaigns": () => list(CAMPAIGNS),
    ...over,
  };
}

export const sent = (calls: Call[], method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);

export function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

export const fileOf = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });
