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
    maps: [] as { opts: Record<string, unknown>; listeners: Record<string, () => void> }[],
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
    listeners: Record<string, () => void> = {};
    addListener(name: string, handler: () => void) {
      this.listeners[name] = handler;
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
let calls: { url: URL; method: string; body: unknown }[] = [];

function mockApi(options: { config?: Route; places?: (url: URL) => MapPlace[] } = {}) {
  calls = [];
  const config: Route = options.config ?? {
    body: { enabled: true, apiKey: "TESTE", mapId: "MAP1" } satisfies MapConfig,
  };
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input).replace(/^.*\/api/, "http://x"));
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
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
const lastMarkers = () => fake.state.clusters.at(-1)?.markers ?? [];
/** Títulos dos pins que o mapa recebeu (sem a lista: o que está filtrado é o que está no mapa), na ordem enviada. */
const pinTitles = () =>
  lastMarkers().map((m) => String(m.opts["title"]).replace(/^[^:]+: /, "").replace(/ — .*$/, ""));
const markerFor = (title: string) =>
  lastMarkers().find((m) => String(m.opts["title"]).includes(title));
const openPin = async (title: string) => {
  const pin = markerFor(title);
  expect(pin, `pin ${title}`).toBeTruthy();
  await act(async () => pin!.listeners["gmp-click"]!());
};
const card = () => container!.querySelector<HTMLElement>('[data-testid="map-card"]');
const pill = () => container!.querySelector<HTMLElement>(".map-count");

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
  await waitFor(() => expect(pinTitles().length).toBeGreaterThan(0));
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
    expect(pinTitles()).toEqual(PLACES.map((p) => p.title));
    expect(localStorage.getItem("gingapp:community-view")).toBe("map");
    // Tela cheia: título, filtros da lista e qualquer listagem saem de cena; o alternador passa a flutuar sobre o mapa.
    expect(container!.querySelector(".filter-bar")).toBeNull();
    expect(container!.querySelector(".page-heading")).toBeNull();
    expect(text()).not.toContain("Na roda, juntos.");
    expect(container!.querySelector(".map-fullscreen")).toBeTruthy();
    expect(container!.querySelector(".map-results, .map-panel, ol")).toBeNull();
    expect(container!.querySelector(".map-hud [role='radiogroup']")).toBeTruthy();
    expect(byRole("radio", /Mapa/)?.getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(fake.state.maps).toHaveLength(1));
    expect(fake.state.maps[0]!.opts["mapId"]).toBe("MAP1");
    expect(fake.state.maps[0]!.opts["styles"]).toBeUndefined();
  });

  it("lembra a escolha: com 'map' guardado já abre no Mapa; voltar para Lista reexibe os filtros", async () => {
    localStorage.setItem("gingapp:community-view", "map");
    mockApi();
    render(<DiscoveryPage mode="community" />);
    await waitFor(() => expect(pinTitles().length).toBe(PLACES.length));
    expect(byRole("radio", /Mapa/)?.getAttribute("aria-checked")).toBe("true");
    await click(byRole("radio", /Lista/));
    expect(container!.querySelector(".filter-bar")).toBeTruthy();
    expect(container!.querySelector(".map-fullscreen")).toBeNull();
    expect(text()).toContain("Na roda, juntos.");
    // Na Lista só existe um alternador (o do mapa, escondido, não duplica).
    expect(container!.querySelectorAll('[role="radiogroup"]')).toHaveLength(1);
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
  it("falha ao criar os pins: mostra o aviso no mapa com 'Tentar novamente'", async () => {
    fake.state.failMarkers = true;
    mockApi();
    render(<DiscoveryPage mode="community" />);
    await waitFor(() => expect(toggle()).toBeTruthy());
    await click(byRole("radio", /Mapa/));
    await waitFor(() => expect(text()).toContain("Não foi possível carregar o Google Maps agora."));
    expect(button(/Tentar novamente/)).toBeTruthy();
    // O alternador continua à mão para voltar à Lista.
    expect(byRole("radio", /Lista/)).toBeTruthy();
  });

  it("chave recusada pelo Google (gm_authFailure): explica e não oferece tentar de novo", async () => {
    mockApi();
    render(<DiscoveryPage mode="community" />);
    await openMap();
    await waitFor(() => expect(fake.state.maps).toHaveLength(1));
    await act(async () => (window as unknown as { gm_authFailure: () => void }).gm_authFailure());
    expect(text()).toContain("O Google Maps recusou a chave deste site.");
    expect(button(/Tentar novamente/)).toBeUndefined();
  });
});

describe("filtros do mapa", () => {
  it("chips de tipo trazem contador, filtram os pins e a contagem sem nova chamada", async () => {
    mockApi();
    render(<DiscoveryPage mode="community" />);
    await openMap();
    const chip = (label: RegExp) => button(label)!;
    expect(chip(/Eventos: 2/).getAttribute("aria-pressed")).toBe("true");
    expect(chip(/Grupos: 1/)).toBeTruthy();
    expect(chip(/Rodas: 1/)).toBeTruthy();
    expect(chip(/Treinos: 1/)).toBeTruthy();
    // Pílula flutuante de contagem, anunciada por leitores de tela.
    expect(pill()?.getAttribute("aria-live")).toBe("polite");
    expect(pill()?.textContent).toContain("5 locais");
    const before = placesCalls().length;

    await click(chip(/Eventos/));
    expect(chip(/Eventos/).getAttribute("aria-pressed")).toBe("false");
    await waitFor(() =>
      expect(pinTitles()).toEqual(["Sede Cordão de Ouro", "Treino de quinta", "Roda da Praça"]),
    );
    expect(pill()?.textContent).toContain("3 locais");
    expect(placesCalls().length).toBe(before);

    await click(chip(/Grupos/));
    await click(chip(/Treinos/));
    await waitFor(() => expect(pinTitles()).toEqual(["Roda da Praça"]));
    expect(pill()?.textContent).toContain("1 local");
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
    await waitFor(() => expect(pinTitles()).toEqual(["Sede Cordão de Ouro"]));
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
    await waitFor(() => expect(pinTitles()).toEqual(["Perto", "Longe"]));
    // A distância aparece no cartão do local (não há lista).
    await openPin("Perto");
    expect(card()?.textContent).toContain("400 m de você");
    await click(button(/Próximo local/));
    expect(card()?.textContent).toContain("12 km de você");

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
    expect(pinTitles()).toHaveLength(PLACES.length);
  });

  it("estado vazio simpático, com 'Limpar filtros' que restaura tudo", async () => {
    mockApi({ places: (url) => (url.searchParams.get("q") === "zzz" ? [] : PLACES) });
    render(<DiscoveryPage mode="community" />);
    await openMap();
    const input = container!.querySelector<HTMLInputElement>('input[aria-label="Buscar no mapa"]')!;
    await typeInto(input, "zzz");
    await waitFor(() => expect(container!.querySelector('[data-testid="map-empty"]')).toBeTruthy());
    expect(text()).toContain("A roda ainda não chegou por aqui");
    expect(pinTitles()).toHaveLength(0);
    expect(pill()?.textContent).toContain("0 locais");

    await click(button(/Limpar filtros/));
    await waitFor(() => expect(pinTitles()).toHaveLength(PLACES.length));
    expect(input.value).toBe("");
  });
});

describe("cartão do local (horizontal, flutuante)", () => {
  it("tocar no pin abre o cartão com descrição, endereço, 'Como chegar' e sem 'Ver detalhes'; Esc fecha", async () => {
    mockApi();
    render(<DiscoveryPage mode="community" />);
    await openMap();
    expect(card()).toBeNull();
    await openPin("Treino de quinta");

    const el = card()!;
    expect(el).toBeTruthy();
    // Região rotulada, não diálogo modal: o mapa continua à vista e acessível.
    expect(el.tagName).toBe("SECTION");
    expect(el.getAttribute("aria-label")).toBe("Treino: Treino de quinta");
    expect(el.getAttribute("role")).not.toBe("dialog");
    expect(el.textContent).toContain("Treino de quinta");
    expect(el.textContent).toContain("descrição do local");
    expect(el.textContent).toContain("Rua da Roda, 10 — São Paulo/SP");
    expect(el.textContent).toContain("Quinta");
    expect(el.textContent).toContain("19:00–20:00");
    expect(el.textContent).toContain("Grupo Cordão de Ouro");
    const directions = el.querySelector<HTMLAnchorElement>("a")!;
    expect(directions.textContent).toContain("Como chegar");
    expect(directions.href).toBe("https://www.google.com/maps/dir/?api=1&destination=-23.55,-46.63");
    expect(directions.target).toBe("_blank");
    expect(el.textContent).not.toContain("Ver detalhes");
    expect(el.textContent).not.toContain("Quero participar"); // treino/grupo não têm inscrição no app
    // Sem capa: o logo do grupo (iniciais) ocupa o quadrado da esquerda.
    expect(el.querySelector('[data-testid="map-card-cover"]')).toBeNull();
    expect(el.querySelector(".map-card-media .map-card-logo")?.textContent).toBe("GO");

    await act(async () => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(card()).toBeNull();
  });

  it("botão X e clique no mapa vazio fecham o cartão", async () => {
    mockApi();
    render(<DiscoveryPage mode="community" />);
    await openMap();
    await openPin("Sede Cordão");
    expect(card()).toBeTruthy();
    await click(button(/Fechar cartão/));
    expect(card()).toBeNull();

    await openPin("Roda da Praça");
    expect(card()).toBeTruthy();
    await act(async () => fake.state.maps[0]!.listeners["click"]!());
    expect(card()).toBeNull();
  });

  it("Anterior/Próximo percorrem os locais filtrados em círculo (acesso sem lista)", async () => {
    mockApi();
    render(<DiscoveryPage mode="community" />);
    await openMap();
    await openPin("Sede Cordão");
    const title = () => card()?.querySelector("h3")?.textContent;
    expect(title()).toBe("Sede Cordão de Ouro");
    expect(card()?.textContent).toContain("1/5");

    await click(button(/Próximo local/));
    expect(title()).toBe("Treino de quinta");
    await click(button(/Próximo local/));
    expect(title()).toBe("Roda da Praça");
    await click(button(/Local anterior/));
    expect(title()).toBe("Treino de quinta");
    // Do primeiro volta ao último, e do último ao primeiro.
    await click(button(/Local anterior/));
    await click(button(/Local anterior/));
    expect(title()).toBe("Workshop de berimbau");
    await click(button(/Próximo local/));
    expect(title()).toBe("Sede Cordão de Ouro");

    // Respeita os filtros: sem eventos, o ciclo só passa pelos outros 3.
    await click(button(/Eventos/));
    await click(button(/Local anterior/));
    expect(title()).toBe("Roda da Praça");
  });

  it("com um único local não há Anterior/Próximo", async () => {
    mockApi({ places: () => [PLACES[0]!] });
    render(<DiscoveryPage mode="community" />);
    await openMap();
    await openPin("Sede Cordão");
    expect(card()).toBeTruthy();
    expect(button(/Próximo local/)).toBeUndefined();
    expect(button(/Local anterior/)).toBeUndefined();
  });

  it("pin do evento: cartão com 'Quero participar' e inscreve via /events/7/participants", async () => {
    mockApi();
    // Sem aluno vinculado (/students/me vazio) => inscrição como convidado, fluxo que o app já suporta.
    render(<DiscoveryPage mode="community" />);
    await openMap();
    const pin = markerFor("Evento: Batizado 2026 — Grupo Cordão de Ouro");
    expect(pin, "pin do evento").toBeTruthy();
    expect(pin!.opts["gmpClickable"]).toBe(true);
    expect((pin!.opts["content"] as HTMLElement).textContent).toContain("NOV");
    await openPin("Batizado 2026");

    expect(card()!.textContent).toContain("Batizado 2026");
    await waitFor(() => expect(button(/Quero participar/)).toBeTruthy());
    expect(calls.some((c) => c.url.pathname === "/events/7/participants" && c.method === "GET")).toBe(true);
    await click(button(/Quero participar/));
    await waitFor(() =>
      expect(calls.some((c) => c.url.pathname === "/events/7/participants" && c.method === "POST")).toBe(true),
    );
  });
});

describe("cartão do evento: vagas, lista de espera e capa", () => {
  const withEvent = (extra: Partial<MapPlace>) => (): MapPlace[] => [
    place("EVENT:7", "EVENT", "Batizado 2026", { startsAt: "2026-11-21T13:00:00.000Z", ...extra }),
  ];

  it("evento lotado: mostra 'Lotado' e a capa; o botão vira 'Entrar na lista de espera' (POST com joinWaitlist)", async () => {
    mockApi({ places: withEvent({ capacity: 20, spotsLeft: 0, imageUrl: "https://cdn.test/batizado.png" }) });
    render(<DiscoveryPage mode="community" />);
    await openMap();
    await openPin("Batizado 2026");

    const el = card()!;
    expect(el.querySelector<HTMLImageElement>('[data-testid="map-card-cover"]')?.src).toBe(
      "https://cdn.test/batizado.png",
    );
    expect(el.querySelector('[data-testid="map-card-spots"]')?.textContent).toBe("Lotado");
    await waitFor(() => expect(button(/Entrar na lista de espera/)).toBeTruthy());
    expect(button(/Quero participar/)).toBeUndefined();
    await click(button(/Entrar na lista de espera/));
    await waitFor(() => {
      const post = calls.find((c) => c.url.pathname === "/events/7/participants" && c.method === "POST");
      expect(post?.body).toMatchObject({ joinWaitlist: true });
    });
  });

  it("evento com vagas: mostra quantas restam e mantém 'Quero participar'; sem imageUrl não há capa", async () => {
    mockApi({ places: withEvent({ capacity: 20, spotsLeft: 5 }) });
    render(<DiscoveryPage mode="community" />);
    await openMap();
    await openPin("Batizado 2026");

    const el = card()!;
    expect(el.querySelector('[data-testid="map-card-spots"]')?.textContent).toBe("5 vagas restantes");
    expect(el.querySelector('[data-testid="map-card-cover"]')).toBeNull();
    await waitFor(() => expect(button(/Quero participar/)).toBeTruthy());
    expect(button(/lista de espera/)).toBeUndefined();
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
