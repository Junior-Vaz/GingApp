import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DiscoveryPage } from "@/components/gingapp/discovery";
import { fmt, startOfToday } from "@/lib/format";
import {
  directionsUrl,
  haversineKm,
  formatDistance,
  periodRange,
  type MapConfig,
  type MapPlace,
} from "@/lib/map";
import { saveSession } from "@/lib/session";

/**
 * Mapa da Comunidade (Lista | Mapa). O Google NÃO é carregado de verdade: o loader e o agrupador são
 * substituídos por fakes (e window.google por um stub mínimo). Testa o contrato com o backend
 * (/map/config e /map/places), o toggle, os filtros por chip/período/busca/"perto de mim", o estado vazio
 * e o cartão do local — não os pixels do mapa.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fake = vi.hoisted(() => {
  const state = {
    failMarkers: false,
    markers: [] as FakeMarker[],
    maps: [] as { opts: Record<string, unknown> }[],
    clusters: [] as { markers: FakeMarker[] }[],
  };
  interface FakeMarker {
    opts: Record<string, unknown>;
    listeners: Record<string, () => void>;
  }
  const marker = () =>
    class implements FakeMarker {
      listeners: Record<string, () => void> = {};
      constructor(public opts: Record<string, unknown>) {
        if (state.failMarkers) throw new TypeError("SDK em estado inválido");
        state.markers.push(this);
      }
      addListener(name: string, handler: () => void) {
        this.listeners[name] = handler;
      }
      // Pins avançados usam addEventListener("gmp-click"); os clássicos, addListener("click").
      addEventListener(name: string, handler: () => void) {
        this.listeners[name] = handler;
      }
      setMap() {}
      setIcon() {}
      setZIndex() {}
    };
  class FakeMap {
    zoom = 4;
    constructor(
      public el: HTMLElement,
      public opts: Record<string, unknown>,
    ) {
      state.maps.push(this);
    }
    setCenter() {}
    setZoom(zoom: number) {
      this.zoom = zoom;
    }
    getZoom() {
      return this.zoom;
    }
    panTo() {}
    panBy() {}
    fitBounds() {}
  }
  class FakeBounds {
    extend() {
      return this;
    }
  }
  class FakeCircle {
    setMap() {}
    setOptions() {}
  }
  const api = {
    Map: FakeMap,
    Circle: FakeCircle,
    Marker: marker(),
    AdvancedMarkerElement: marker(),
    LatLngBounds: FakeBounds,
  };
  class FakeClusterer {
    markers: FakeMarker[] = [];
    constructor() {
      state.clusters.push(this);
    }
    clearMarkers() {
      this.markers = [];
    }
    addMarkers(markers: FakeMarker[]) {
      this.markers = markers;
    }
  }
  return { state, api, FakeClusterer };
});

vi.mock("@/lib/google-maps", () => ({ loadGoogleMaps: async () => fake.api }));
vi.mock("@googlemaps/markerclusterer", () => ({
  MarkerClusterer: fake.FakeClusterer,
  SuperClusterAlgorithm: class {},
}));

const org = {
  id: 1,
  name: "Grupo Cordão de Ouro",
  slug: "cordao",
  logoUrl: null,
  description: "Capoeira desde 1990.",
};
const place = (
  id: string,
  type: MapPlace["type"],
  title: string,
  extra: Partial<MapPlace> = {},
): MapPlace => ({
  id,
  type,
  title,
  description: `${title} — descrição do local.`,
  latitude: -23.55,
  longitude: -46.63,
  address: "Rua da Roda, 10",
  city: "São Paulo",
  state: "SP",
  organization: org,
  isMine: false,
  ...extra,
});
const PLACES: MapPlace[] = [
  place("UNIT:1", "UNIT", "Sede Cordão de Ouro", { isMine: true }),
  place("CLASS:9", "CLASS", "Treino de quinta", {
    weekday: 4,
    startTime: "19:00",
    endTime: "20:00",
  }),
  place("RODA:3", "RODA", "Roda da Praça", { startsAt: "2026-11-14T15:00:00.000Z" }),
  place("EVENT:7", "EVENT", "Batizado 2026", { startsAt: "2026-11-21T13:00:00.000Z" }),
  place("EVENT:8", "EVENT", "Workshop de berimbau", { startsAt: "2026-11-28T13:00:00.000Z" }),
];

interface Route {
  body: unknown;
  status?: number;
}
let root: Root | null = null;
let container: HTMLDivElement | null = null;
let calls: { url: URL; method: string }[] = [];

function mockApi(options: { config?: Route; places?: (url: URL) => MapPlace[] } = {}) {
  calls = [];
  const config: Route = options.config ?? {
    body: { enabled: true, apiKey: "TESTE", mapId: "MAP1" } satisfies MapConfig,
  };
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input).replace(/^.*\/api/, "http://x"));
    calls.push({ url, method: init?.method ?? "GET" });
    let route: Route = { body: [] };
    if (url.pathname === "/map/config") route = config;
    else if (url.pathname === "/map/places") {
      const items = (options.places ?? (() => PLACES))(url);
      route = { body: { items, total: items.length } };
    }
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  });
  vi.stubGlobal("fetch", fn);
}
const placesCalls = () => calls.filter((c) => c.url.pathname === "/map/places").map((c) => c.url);
const lastPlaces = () => placesCalls().at(-1)!;

function render(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>));
}

const text = () => (container?.textContent ?? "").replace(/\u00a0/g, " ");
const waitFor = (assertion: () => void) =>
  act(async () => void (await vi.waitFor(assertion, { timeout: 2500 })));
const byRole = (role: string, name: RegExp) =>
  [...container!.querySelectorAll<HTMLElement>(`[role="${role}"]`)].find((el) =>
    name.test(el.textContent ?? ""),
  );
const button = (name: RegExp) =>
  [...container!.querySelectorAll("button")].find((b) =>
    name.test(b.getAttribute("aria-label") ?? b.textContent ?? ""),
  );
const click = async (el: HTMLElement | undefined) => {
  expect(el, "elemento para clicar").toBeTruthy();
  await act(async () => el!.click());
};
const toggle = () => container!.querySelector('[role="radiogroup"]');
const resultTitles = () =>
  [...container!.querySelectorAll(".map-result-title")].map((e) => e.textContent);

/** Altera o campo como o navegador (o setter do protótipo escapa do rastreio de valor do React) e dispara o evento. */
function setNative(el: HTMLElement, proto: object, value: string, event: "input" | "change") {
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(event, { bubbles: true }));
}
/** Digita na busca e deixa o debounce (350 ms) vencer dentro de um act, para o React aplicar a atualização. */
async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => setNative(input, HTMLInputElement.prototype, value, "input"));
  await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 450))));
}
const stubGeolocation = (value: object) =>
  Object.defineProperty(navigator, "geolocation", { value, configurable: true });

async function openMap() {
  await waitFor(() => expect(toggle()).toBeTruthy());
  await click(byRole("radio", /Mapa/));
  await waitFor(() => expect(resultTitles().length).toBeGreaterThan(0));
}

// Aquece o chunk lazy do mapa (a 1ª transformação a frio do vitest é lenta e estouraria o timeout do 1º teste).
beforeAll(async () => {
  await import("@/components/gingapp/map-explorer");
}, 60000);

beforeEach(() => {
  localStorage.clear();
  fake.state.failMarkers = false;
  fake.state.markers.length = 0;
  fake.state.maps.length = 0;
  fake.state.clusters.length = 0;
  vi.stubGlobal("google", { maps: { Size: class {}, Point: class {} } });
  saveSession("t", {
    id: 1,
    name: "Ana",
    email: "a@b.c",
    userType: "MEMBER",
    isSuperAdmin: false,
    organizationId: 1,
    organizationSlug: "g",
    role: "ALUNO",
  });
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "geolocation");
});

describe("toggle Lista | Mapa da Comunidade", () => {
  it("fica oculto com enabled=false, sem chave ou se /map/config falhar — e sem mensagem de erro", async () => {
    for (const config of [
      { body: { enabled: false, apiKey: "K", mapId: null } },
      { body: { enabled: true, apiKey: null, mapId: null } },
      { body: { message: "indisponível" }, status: 500 },
    ] as Route[]) {
      mockApi({ config });
      render(<DiscoveryPage mode="community" />);
      await waitFor(() => expect(calls.some((c) => c.url.pathname === "/map/config")).toBe(true));
      await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));
      expect(toggle()).toBeNull();
      expect(text()).not.toContain("indisponível");
      expect(container!.querySelector('[role="alert"]')).toBeNull();
      expect(placesCalls()).toHaveLength(0);
      act(() => root?.unmount());
      container?.remove();
    }
  });

  it("só existe na Comunidade (Eventos e Rodas não consultam o mapa)", async () => {
    mockApi();
    render(<DiscoveryPage mode="rodas" />);
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));
    expect(toggle()).toBeNull();
    expect(calls.some((c) => c.url.pathname === "/map/config")).toBe(false);
  });

  it("aparece com enabled + chave, começa em Lista (aria-checked) e ainda não busca locais", async () => {
    mockApi();
    render(<DiscoveryPage mode="community" />);
    await waitFor(() => expect(toggle()).toBeTruthy());
    expect(byRole("radio", /Lista/)?.getAttribute("aria-checked")).toBe("true");
    expect(byRole("radio", /Mapa/)?.getAttribute("aria-checked")).toBe("false");
    expect(placesCalls()).toHaveLength(0);
    expect(container!.querySelector(".filter-bar")).toBeTruthy();
  });

  it("trocar para Mapa pede /map/places com os 4 tipos, mostra os locais e lembra a escolha", async () => {
    mockApi();
    render(<DiscoveryPage mode="community" />);
    await openMap();

    const url = lastPlaces();
    expect(url.searchParams.get("types")).toBe("UNIT,CLASS,RODA,EVENT");
    expect(url.searchParams.get("limit")).toBe("500");
    expect(url.searchParams.has("q")).toBe(false);
    expect(url.searchParams.has("from")).toBe(false);
    expect(url.searchParams.has("lat")).toBe(false);
    expect(resultTitles()).toEqual(PLACES.map((p) => p.title));
    expect(localStorage.getItem("gingapp:community-view")).toBe("map");
    // A lista de encontros sai de cena; o mapa foi criado com o Map ID (pins em HTML).
    expect(container!.querySelector(".filter-bar")).toBeNull();
    await waitFor(() => expect(fake.state.maps).toHaveLength(1));
    expect(fake.state.maps[0]!.opts["mapId"]).toBe("MAP1");
    expect(fake.state.maps[0]!.opts["styles"]).toBeUndefined();
  });

  it("lembra a escolha: com 'map' guardado já abre no Mapa; voltar para Lista reexibe os filtros", async () => {
    localStorage.setItem("gingapp:community-view", "map");
    mockApi();
    render(<DiscoveryPage mode="community" />);
    await waitFor(() => expect(resultTitles().length).toBe(PLACES.length));
    expect(byRole("radio", /Mapa/)?.getAttribute("aria-checked")).toBe("true");
    await click(byRole("radio", /Lista/));
    expect(container!.querySelector(".filter-bar")).toBeTruthy();
    expect(localStorage.getItem("gingapp:community-view")).toBe("list");
  });

  it("sem Map ID usa o estilo verde da marca e marcadores clássicos", async () => {
    mockApi({ config: { body: { enabled: true, apiKey: "K", mapId: null } } });
    render(<DiscoveryPage mode="community" />);
    await openMap();
    await waitFor(() => expect(fake.state.maps).toHaveLength(1));
    expect(fake.state.maps[0]!.opts["mapId"]).toBeUndefined();
    expect(Array.isArray(fake.state.maps[0]!.opts["styles"])).toBe(true);
    await waitFor(() => expect(fake.state.clusters[0]?.markers).toHaveLength(PLACES.length));
    expect(fake.state.markers.every((m) => "icon" in m.opts)).toBe(true);
  });
});

describe("falhas do Google Maps não derrubam a tela", () => {
  it("falha ao criar os pins: mostra o aviso no mapa e a lista continua navegável", async () => {
    fake.state.failMarkers = true;
    mockApi();
    render(<DiscoveryPage mode="community" />);
    await openMap();
    await waitFor(() => expect(text()).toContain("Não foi possível carregar o Google Maps agora."));
    expect(button(/Tentar novamente/)).toBeTruthy();
    expect(resultTitles()).toHaveLength(PLACES.length);
    await click(container!.querySelector<HTMLElement>('[data-place-id="UNIT:1"]')!);
    expect(container!.querySelector('[data-testid="map-card"]')).toBeTruthy();
  });

  it("chave recusada pelo Google (gm_authFailure): explica e não oferece tentar de novo", async () => {
    mockApi();
    render(<DiscoveryPage mode="community" />);
    await openMap();
    await waitFor(() => expect(fake.state.maps).toHaveLength(1));
    await act(async () => (window as unknown as { gm_authFailure: () => void }).gm_authFailure());
    expect(text()).toContain("O Google Maps recusou a chave deste site.");
    expect(button(/Tentar novamente/)).toBeUndefined();
    expect(resultTitles()).toHaveLength(PLACES.length);
  });
});

describe("filtros do mapa", () => {
  it("chips de tipo trazem contador, filtram a lista e os pins sem nova chamada", async () => {
    mockApi();
    render(<DiscoveryPage mode="community" />);
    await openMap();
    const chip = (label: RegExp) => button(label)!;
    expect(chip(/Eventos: 2/).getAttribute("aria-pressed")).toBe("true");
    expect(chip(/Grupos: 1/)).toBeTruthy();
    expect(chip(/Rodas: 1/)).toBeTruthy();
    expect(chip(/Treinos: 1/)).toBeTruthy();
    const before = placesCalls().length;

    await click(chip(/Eventos/));
    expect(chip(/Eventos/).getAttribute("aria-pressed")).toBe("false");
    expect(resultTitles()).toEqual(["Sede Cordão de Ouro", "Treino de quinta", "Roda da Praça"]);
    await waitFor(() => expect(fake.state.clusters[0]?.markers).toHaveLength(3));
    expect(placesCalls().length).toBe(before);

    await click(chip(/Grupos/));
    await click(chip(/Treinos/));
    expect(resultTitles()).toEqual(["Roda da Praça"]);
  });

  it("período, busca e 'meu grupo' mudam a consulta / a lista", async () => {
    mockApi();
    render(<DiscoveryPage mode="community" />);
    await openMap();

    await click(button(/^Hoje/));
    await waitFor(() =>
      expect(lastPlaces().searchParams.get("from")).toBe(fmt(startOfToday(), "yyyy-MM-dd")),
    );
    expect(lastPlaces().searchParams.get("to")).toBe(fmt(startOfToday(), "yyyy-MM-dd"));
    await click(button(/Esta semana/));
    await waitFor(() => expect(lastPlaces().searchParams.get("to")).toBe(periodRange("week").to));
    await click(button(/^Tudo/));
    expect(button(/^Tudo/)!.getAttribute("aria-pressed")).toBe("true");

    const input = container!.querySelector<HTMLInputElement>('input[aria-label="Buscar no mapa"]')!;
    await typeInto(input, "batizado");
    await waitFor(() => expect(lastPlaces().searchParams.get("q")).toBe("batizado"));

    await click(button(/Meu grupo/));
    expect(resultTitles()).toEqual(["Sede Cordão de Ouro"]);
  });

  it("'Perto de mim' pede a localização, envia lat/lng/radiusKm e ordena por distância", async () => {
    const position = { coords: { latitude: -23.5, longitude: -46.6 } };
    stubGeolocation({ getCurrentPosition: (ok: (p: unknown) => void) => ok(position) });
    mockApi({
      places: (url) =>
        url.searchParams.has("lat")
          ? [
              place("EVENT:8", "EVENT", "Longe", { distanceKm: 12.4 }),
              place("UNIT:1", "UNIT", "Perto", { distanceKm: 0.4 }),
            ]
          : PLACES,
    });
    render(<DiscoveryPage mode="community" />);
    await openMap();

    await click(button(/Perto de mim/));
    await waitFor(() => expect(lastPlaces().searchParams.get("lat")).toBe("-23.5"));
    expect(lastPlaces().searchParams.get("lng")).toBe("-46.6");
    expect(lastPlaces().searchParams.get("radiusKm")).toBe("25");
    await waitFor(() => expect(resultTitles()).toEqual(["Perto", "Longe"]));
    expect(text()).toContain("400 m");
    expect(text()).toContain("12 km");

    const radius = container!.querySelector<HTMLSelectElement>(
      'select[aria-label="Raio da busca"]',
    )!;
    await act(async () => setNative(radius, HTMLSelectElement.prototype, "10", "change"));
    await waitFor(() => expect(lastPlaces().searchParams.get("radiusKm")).toBe("10"));
  });

  it("permissão de localização negada: avisa, não filtra e não quebra", async () => {
    stubGeolocation({
      getCurrentPosition: (_ok: unknown, fail: (e: { code: number }) => void) => fail({ code: 1 }),
    });
    mockApi();
    render(<DiscoveryPage mode="community" />);
    await openMap();
    await click(button(/Perto de mim/));
    await waitFor(() => expect(text()).toContain("Sem permissão de localização"));
    expect(lastPlaces().searchParams.has("lat")).toBe(false);
    expect(resultTitles()).toHaveLength(PLACES.length);
  });

  it("estado vazio simpático, com 'Limpar filtros' que restaura tudo", async () => {
    mockApi({ places: (url) => (url.searchParams.get("q") === "zzz" ? [] : PLACES) });
    render(<DiscoveryPage mode="community" />);
    await openMap();
    const input = container!.querySelector<HTMLInputElement>('input[aria-label="Buscar no mapa"]')!;
    await typeInto(input, "zzz");
    await waitFor(() => expect(container!.querySelector('[data-testid="map-empty"]')).toBeTruthy());
    expect(text()).toContain("A roda ainda não chegou por aqui");
    expect(resultTitles()).toHaveLength(0);

    await click(button(/Limpar filtros/));
    await waitFor(() => expect(resultTitles()).toHaveLength(PLACES.length));
    expect(input.value).toBe("");
  });
});

describe("cartão do local", () => {
  it("clicar num item da lista abre o cartão com descrição, endereço, 'Como chegar' e sem 'Ver detalhes'", async () => {
    mockApi();
    render(<DiscoveryPage mode="community" />);
    await openMap();
    await click(container!.querySelector<HTMLElement>('[data-place-id="CLASS:9"]')!);

    const card = container!.querySelector('[data-testid="map-card"]')!;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain("Treino de quinta");
    expect(card.textContent).toContain("descrição do local");
    expect(card.textContent).toContain("Rua da Roda, 10 — São Paulo/SP");
    expect(card.textContent).toContain("Quinta");
    expect(card.textContent).toContain("19:00–20:00");
    expect(card.textContent).toContain("Grupo Cordão de Ouro");
    const directions = card.querySelector<HTMLAnchorElement>("a")!;
    expect(directions.textContent).toContain("Como chegar");
    expect(directions.href).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=-23.55,-46.63",
    );
    expect(directions.target).toBe("_blank");
    expect(card.textContent).not.toContain("Ver detalhes");
    expect(card.textContent).not.toContain("Quero participar"); // treino/grupo não têm inscrição no app

    // Esc fecha o cartão e devolve o foco ao item da lista.
    await act(async () => {
      card.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container!.querySelector('[data-testid="map-card"]')).toBeNull();
  });

  it("tocar no pin (gmp-click) abre o cartão do evento com 'Quero participar' e inscreve via /events/7/participants", async () => {
    mockApi();
    // Sem aluno vinculado (/students/me vazio) => inscrição como convidado, fluxo que o app já suporta.
    render(<DiscoveryPage mode="community" />);
    await openMap();
    await waitFor(() => expect(fake.state.clusters[0]?.markers).toHaveLength(PLACES.length));
    const pin = fake.state.markers.find(
      (m) => m.opts["title"] === "Evento: Batizado 2026 — Grupo Cordão de Ouro",
    );
    expect(pin, "pin do evento").toBeTruthy();
    expect(pin!.opts["gmpClickable"]).toBe(true);
    expect((pin!.opts["content"] as HTMLElement).textContent).toContain("NOV");
    await act(async () => pin!.listeners["gmp-click"]!());

    const card = container!.querySelector('[data-testid="map-card"]')!;
    expect(card.textContent).toContain("Batizado 2026");
    await waitFor(() => expect(button(/Quero participar/)).toBeTruthy());
    expect(
      calls.some((c) => c.url.pathname === "/events/7/participants" && c.method === "GET"),
    ).toBe(true);
    await click(button(/Quero participar/));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.pathname === "/events/7/participants" && c.method === "POST"),
      ).toBe(true),
    );
    // O item da lista fica marcado como selecionado.
    expect(
      container!.querySelector('[data-place-id="EVENT:7"]')!.getAttribute("aria-current"),
    ).toBe("true");
  });
});

describe("funções puras do mapa", () => {
  it("distância, rota e período", () => {
    expect(haversineKm({ lat: -23.55, lng: -46.63 }, { lat: -23.55, lng: -46.63 })).toBe(0);
    expect(haversineKm({ lat: -23.55, lng: -46.63 }, { lat: -22.9, lng: -43.17 })).toBeGreaterThan(
      350,
    );
    expect(haversineKm({ lat: -23.55, lng: -46.63 }, { lat: -22.9, lng: -43.17 })).toBeLessThan(
      370,
    );
    expect(formatDistance(0.43)).toBe("430 m");
    expect(formatDistance(3.24)).toBe("3,2 km");
    expect(formatDistance(48.7)).toBe("49 km");
    expect(directionsUrl({ latitude: -1.5, longitude: 2.5 })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=-1.5,2.5",
    );
    // Sexta 2026-10-09: a semana (seg-dom) termina no domingo 11; o mês, no dia 31.
    const friday = new Date(2026, 9, 9);
    expect(periodRange("today", friday)).toEqual({ from: "2026-10-09", to: "2026-10-09" });
    expect(periodRange("week", friday)).toEqual({ from: "2026-10-09", to: "2026-10-11" });
    expect(periodRange("month", friday)).toEqual({ from: "2026-10-09", to: "2026-10-31" });
    expect(periodRange("all", friday)).toEqual({});
  });
});
