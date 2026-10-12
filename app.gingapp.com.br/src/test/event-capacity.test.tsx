import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DiscoveryPage } from "@/components/gingapp/discovery";
import { eventSituation, priceLabel, recurrenceText, spotsLabel } from "@/lib/event-info";
import { clearSession } from "@/lib/session";

/**
 * Vagas, preco, lista de espera e recorrencia nos cards de evento/roda. O servidor manda capacity/spotsLeft/
 * waitlistCount/priceCents/status; o app mostra "Lotado" e troca "Quero participar" por "Entrar na lista de
 * espera" (POST com joinWaitlist: true).
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Call {
  path: string;
  method: string;
  body: string | null;
}
interface Reply {
  body: unknown;
  status?: number;
  total?: number;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let calls: Call[] = [];

function mockApi(handler: (call: Call) => Reply | undefined) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input).replace(/^.*\/api/, "http://x")).pathname;
      const call: Call = { path, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null };
      calls.push(call);
      const reply: Reply =
        path === "/students/me"
          ? { body: [{ id: 5, userId: 7, unitId: 1, name: "Ana", photo: null, coverPhoto: null, socialLinks: null, joinedAt: null }] }
          : (handler(call) ?? { body: [], total: 0 });
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: reply.total === undefined ? {} : { "X-Total-Count": String(reply.total) },
      });
    }),
  );
}

function render(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>));
}

const text = () => (container?.textContent ?? "").replace(/\u00a0/g, " ");
const bodyText = () => document.body.textContent?.replace(/\u00a0/g, " ") ?? "";
const waitFor = (assertion: () => void) => act(async () => void (await vi.waitFor(assertion, { timeout: 3000 })));
const buttons = () => [...document.body.querySelectorAll("button")];
const clickBody = async (name: RegExp) => {
  const el = buttons().find((b) => name.test(b.textContent ?? ""));
  expect(el, `botão ${String(name)}`).toBeTruthy();
  await act(async () => el!.click());
};

const event = (extra: Record<string, unknown>) => ({
  id: 1,
  title: "Batizado",
  type: "BATIZADO",
  description: null,
  date: "2099-12-01T00:00:00.000Z",
  location: "Ginásio",
  imageUrl: null,
  isPublic: true,
  participantsCount: 10,
  confirmedCount: 10,
  myParticipation: null,
  status: "PUBLISHED",
  capacity: 10,
  spotsLeft: 0,
  waitlistCount: 3,
  priceCents: 15000,
  registrationDeadline: null,
  ...extra,
});

beforeEach(() => {
  clearSession();
  localStorage.clear();
  localStorage.setItem(
    "mb_user",
    JSON.stringify({ id: 7, name: "Ana", email: "a@x", userType: "MEMBER", isSuperAdmin: false, organizationSlug: "x", organizationId: 1, role: "ALUNO" }),
  );
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("rótulos de vagas, preço e situação", () => {
  it("vagas, preço, prazo e recorrência", () => {
    expect(spotsLabel({ capacity: 20, spotsLeft: 12 })).toBe("12 vagas restantes");
    expect(spotsLabel({ capacity: 20, spotsLeft: 1 })).toBe("1 vaga restante");
    expect(spotsLabel({ capacity: 20, spotsLeft: 0 })).toBe("Lotado");
    expect(spotsLabel({ capacity: null, spotsLeft: null })).toBe("Vagas ilimitadas");
    expect(spotsLabel({})).toBeNull(); // backend antigo: nada a mostrar
    expect(priceLabel({ priceCents: 15000 })).toBe("R$\u00a0150,00");
    expect(priceLabel({ priceCents: null })).toBe("Gratuito");
    expect(priceLabel({})).toBeNull();
    expect(eventSituation({ eventStatus: "CANCELLED" })).toEqual({ label: "Cancelado", closed: true });
    expect(eventSituation({ eventStatus: "CLOSED" })).toEqual({ label: "Encerrado", closed: true });
    expect(eventSituation({ registrationDeadline: "2099-03-05T12:00:00.000Z" })).toEqual({ label: "Inscrições até 05/03", closed: false });
    expect(eventSituation({ registrationDeadline: "2000-03-05T12:00:00.000Z" })?.closed).toBe(true);
    expect(recurrenceText({ inSeries: true, recurrenceRule: "toda 1ª sexta do mês" })).toBe("toda 1ª sexta do mês");
    expect(recurrenceText({})).toBeNull();
  });
});

describe("Evento com vagas", () => {
  it("lotado: mostra 'Lotado', preço e fila; o botão vira 'Entrar na lista de espera' e o POST leva joinWaitlist: true", async () => {
    mockApi((call) => {
      if (call.path === "/events" && call.method === "GET") return { body: [event({})], total: 1 };
      if (call.path === "/events/1/participants" && call.method === "POST") return { body: { id: 77, status: "WAITLIST" }, status: 201 };
      return undefined;
    });
    render(<DiscoveryPage mode="events" />);
    await waitFor(() => expect(text()).toContain("Lotado"));
    expect(text()).toContain("R$ 150,00");
    expect(text()).toContain("3 na lista de espera");

    await clickBody(/Ver detalhes/);
    expect(buttons().some((b) => /Quero participar/.test(b.textContent ?? ""))).toBe(false);
    await clickBody(/Entrar na lista de espera/);
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.path).toBe("/events/1/participants");
    expect(JSON.parse(post.body!)).toEqual({ studentId: 5, joinWaitlist: true });
  });

  it("na lista de espera: 'Você está na lista de espera' + botão de sair (DELETE pelo id da inscrição)", async () => {
    mockApi((call) => {
      if (call.path === "/events" && call.method === "GET")
        return { body: [event({ myParticipation: { id: 77, studentId: 5, status: "WAITLIST" } })], total: 1 };
      return undefined;
    });
    render(<DiscoveryPage mode="events" />);
    await waitFor(() => expect(text()).toContain("Na lista de espera"));
    expect(text()).not.toContain("Confirmado");
    await clickBody(/Na lista de espera/);
    expect(bodyText()).toContain("Você está na lista de espera");
    await clickBody(/Sair da lista de espera/);
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/events/1/participants/77")).toBe(true);
  });

  it("409 EVENT_FULL ao se inscrever: mostra a mensagem e passa a oferecer a lista de espera", async () => {
    mockApi((call) => {
      if (call.path === "/events" && call.method === "GET") return { body: [event({ spotsLeft: 2, waitlistCount: 0 })], total: 1 };
      if (call.path === "/events/1/participants" && call.method === "POST")
        return { status: 409, body: { statusCode: 409, code: "EVENT_FULL", message: "Evento lotado." } };
      return undefined;
    });
    render(<DiscoveryPage mode="events" />);
    await waitFor(() => expect(text()).toContain("2 vagas restantes"));
    await clickBody(/Ver detalhes/);
    await clickBody(/Quero participar/);
    await waitFor(() => expect(buttons().some((b) => /Entrar na lista de espera/.test(b.textContent ?? ""))).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === "POST")!.body!)).toEqual({ studentId: 5 });
  });

  it("roda recorrente: selo 'Roda recorrente' com a regra", async () => {
    mockApi((call) => {
      if (call.path === "/calendar")
        return {
          body: [
            {
              id: 9,
              source: "RODA",
              type: "RODA",
              title: "Roda de sexta",
              description: null,
              date: "2099-12-05T00:00:00.000Z",
              location: "Praça",
              imageUrl: null,
              state: null,
              city: null,
              inSeries: true,
              recurrenceRule: "toda 1ª sexta do mês",
            },
          ],
          total: 1,
        };
      return undefined;
    });
    render(<DiscoveryPage mode="rodas" />);
    await waitFor(() => expect(text()).toContain("Roda recorrente · toda 1ª sexta do mês"));
  });
});
