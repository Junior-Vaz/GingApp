import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckinPage } from "@/components/gingapp/checkin";
import { GeoCheckinHomeCard, GeoCheckinSection } from "@/components/gingapp/geo-checkin";
import { ApiError } from "@/lib/api";
import {
  GEO_CHECKIN_SECTION_ID,
  GEO_FAILURE_MESSAGE,
  GeolocationFailure,
  geoCheckinErrorMessage,
  pendingGeoOptions,
  type GeoCheckinOption,
} from "@/lib/geo-checkin";
import { clearSession } from "@/lib/session";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, hash, children, ...rest }: { to: string; hash?: string; children?: ReactNode }) => (
    <a href={hash ? `${to}#${hash}` : to} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * Check-in por localização (GPS) no app: lista de opções, leitura da posição só no toque, corpo exato do POST do contrato,
 * erros da geolocalização e do servidor, privacidade (nada de coordenadas guardadas) e cartão da Home. API e GPS mockados.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Call {
  path: string;
  method: string;
  body: unknown;
}
interface Reply {
  status?: number;
  body: unknown;
}

const LAT = -16.686891;
const LNG = -49.264794;
const ACCURACY = 18;

const option = (over: Partial<GeoCheckinOption> = {}): GeoCheckinOption => ({
  lessonId: 31,
  studentId: 5,
  studentName: "Ana",
  className: "Capoeira Infantil",
  date: new Date().toISOString().slice(0, 10) + "T00:00:00.000Z",
  startTime: "18:00",
  endTime: "19:00",
  opensAt: new Date(Date.now() - 3_600_000).toISOString(),
  closesAt: new Date(Date.now() + 7_200_000).toISOString(),
  radiusMeters: 150,
  alreadyCheckedIn: false,
  ...over,
});

const student = (id: number, name: string, userId: number | null = null) => ({
  id,
  userId,
  unitId: 1,
  name,
  photo: null,
  coverPhoto: null,
  socialLinks: null,
  joinedAt: null,
});

const okResult = { lessonId: 31, studentId: 5, present: true, alreadyCheckedIn: false, distanceMeters: 42 };

let calls: Call[] = [];
let availableReply: () => Reply = () => ({ body: [] });
let postReply: (call: Call) => Reply = () => ({ body: okResult });
let studentsReply: unknown[] = [student(5, "Ana", 7)];
let queryClient: QueryClient;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mockApi() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input).replace(/^.*\/api/, "http://x")).pathname;
      const method = init?.method ?? "GET";
      const call: Call = { path, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined };
      calls.push(call);
      if (path === "/students/me") return new Response(JSON.stringify(studentsReply));
      let reply: Reply = { body: [] };
      if (path === "/attendance/geo-checkin/available") reply = availableReply();
      else if (path === "/attendance/geo-checkin" && method === "POST") reply = postReply(call);
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
    }),
  );
}
const availableGets = () => calls.filter((c) => c.path === "/attendance/geo-checkin/available" && c.method === "GET");
const geoPosts = () => calls.filter((c) => c.path === "/attendance/geo-checkin" && c.method === "POST");

type GeoImpl = (success: PositionCallback, failure: PositionErrorCallback, options?: PositionOptions) => void;
const getCurrentPosition = vi.fn<GeoImpl>();
const positionOk: GeoImpl = (success) =>
  success({
    coords: { latitude: LAT, longitude: LNG, accuracy: ACCURACY, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
    timestamp: Date.now(),
  } as unknown as GeolocationPosition);
const positionFails =
  (code: number): GeoImpl =>
  (_success, failure) =>
    failure({ code, message: `erro ${code}`, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);

function mount(ui: ReactNode) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>));
}
function unmount() {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
}

const all = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)];
const byTestId = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const allByTestId = (id: string) => all(`[data-testid="${id}"]`);
const bodyText = () => (document.body.textContent ?? "").split(String.fromCharCode(160)).join(" ");
const nameOf = (el: HTMLElement) => el.getAttribute("aria-label") ?? el.textContent ?? "";
const button = (name: RegExp | string, scope: ParentNode = document.body) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => (typeof name === "string" ? nameOf(b) === name : name.test(nameOf(b))));
const waitFor = (assertion: () => void) => act(async () => void (await vi.waitFor(assertion, { timeout: 3000 })));
const settle = (ms = 50) => act(async () => void (await new Promise((resolve) => setTimeout(resolve, ms))));
const click = (el: HTMLElement | undefined) => act(async () => el!.click());
const tapHere = () => click(button(/Estou aqui/));
const alertText = () => document.body.querySelector('[role="alert"]')?.textContent ?? "";

beforeEach(() => {
  clearSession();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(
    "mb_user",
    JSON.stringify({ id: 7, name: "Ana", email: "a@x", userType: "MEMBER", isSuperAdmin: false, organizationSlug: "x", organizationId: 1, role: "ALUNO" }),
  );
  availableReply = () => ({ body: [option()] });
  postReply = () => ({ body: okResult });
  studentsReply = [student(5, "Ana", 7)];
  getCurrentPosition.mockReset();
  getCurrentPosition.mockImplementation(positionOk);
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
  mockApi();
});
afterEach(() => {
  unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  delete (navigator as { geolocation?: unknown }).geolocation;
  clearSession();
  localStorage.clear();
});

describe("lista de opções (GET /attendance/geo-checkin/available)", () => {
  it("mostra aula, horário e o botão 'Estou aqui' com o texto de privacidade; NÃO lê a posição ao abrir", async () => {
    mount(<GeoCheckinSection />);
    await waitFor(() => expect(byTestId("geo-checkin-item")).not.toBeNull());
    const item = byTestId("geo-checkin-item")!;
    expect(item.textContent).toContain("Capoeira Infantil");
    expect(item.textContent).toContain("Hoje · 18:00–19:00");
    expect(button(/Estou aqui/, item)).toBeDefined();
    expect(item.textContent).toContain("Sua localização é usada só para confirmar que você está na aula e não é guardada.");
    expect(item.textContent).not.toContain("Ana"); // só um aluno: sem nome do aluno
    expect(availableGets()).toHaveLength(1);
    expect(getCurrentPosition).not.toHaveBeenCalled(); // nunca lê a posição sozinho
  });

  it("botão com alvo de toque >= 44px (min-h-11) e rótulo acessível", async () => {
    mount(<GeoCheckinSection />);
    await waitFor(() => expect(button("Estou aqui: Capoeira Infantil")).toBeDefined());
    expect(button("Estou aqui: Capoeira Infantil")!.className).toContain("min-h-11");
  });

  it("com dependentes mostra o nome do aluno em cada item", async () => {
    studentsReply = [student(5, "Ana", 7), student(6, "Bia")];
    availableReply = () => ({ body: [option(), option({ studentId: 6, studentName: "Bia" })] });
    mount(<GeoCheckinSection />);
    await waitFor(() => expect(allByTestId("geo-checkin-item")).toHaveLength(2));
    const [first, second] = allByTestId("geo-checkin-item");
    expect(first!.textContent).toContain("Ana");
    expect(second!.textContent).toContain("Bia");
    expect(button("Estou aqui: Capoeira Infantil (Bia)")).toBeDefined();
  });

  it("item já registrado mostra 'Presença registrada' e nenhum botão", async () => {
    availableReply = () => ({ body: [option({ alreadyCheckedIn: true })] });
    mount(<GeoCheckinSection />);
    await waitFor(() => expect(byTestId("geo-checkin-item")).not.toBeNull());
    const item = byTestId("geo-checkin-item")!;
    expect(item.textContent).toContain("Presença registrada");
    expect(item.querySelector("button")).toBeNull();
  });

  it("lista vazia explica que não há check-in agora", async () => {
    availableReply = () => ({ body: [] });
    mount(<GeoCheckinSection />);
    await waitFor(() => expect(byTestId("geo-checkin-empty")).not.toBeNull());
    expect(byTestId("geo-checkin-item")).toBeNull();
  });

  it("falha ao listar mostra o erro do servidor e 'Tentar de novo' recarrega", async () => {
    availableReply = () => ({ status: 500, body: { message: "Falha no servidor." } });
    mount(<GeoCheckinSection />);
    await waitFor(() => expect(bodyText()).toContain("Falha no servidor."));
    availableReply = () => ({ body: [option()] });
    await click(button("Tentar de novo"));
    await waitFor(() => expect(byTestId("geo-checkin-item")).not.toBeNull());
  });

  it("conta sem aluno: nem consulta as opções", async () => {
    studentsReply = [];
    mount(<GeoCheckinSection />);
    await waitFor(() => expect(calls.some((c) => c.path === "/students/me")).toBe(true));
    await settle();
    expect(availableGets()).toHaveLength(0);
  });

  it("a página /checkin inclui a seção (âncora para o cartão da Home) e continua com o QR", async () => {
    mount(<CheckinPage />);
    await waitFor(() => expect(byTestId("geo-checkin-item")).not.toBeNull());
    expect(byTestId("geo-checkin-section")!.id).toBe(GEO_CHECKIN_SECTION_ID);
    expect(button(/Confirmar presença/)).toBeDefined();
  });
});

describe("toque em 'Estou aqui'", () => {
  it("lê a posição (alta precisão, 15 s, sem cache) e faz POST com o corpo exato do contrato; sucesso vira 'Presença registrada'", async () => {
    mount(<GeoCheckinSection />);
    await waitFor(() => expect(byTestId("geo-checkin-item")).not.toBeNull());
    // depois do POST o servidor passa a listar a opção como registrada
    postReply = () => {
      availableReply = () => ({ body: [option({ alreadyCheckedIn: true })] });
      return { body: okResult };
    };
    await tapHere();

    await waitFor(() => expect(geoPosts()).toHaveLength(1));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition.mock.calls[0]![2]).toEqual({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    expect(geoPosts()[0]!.body).toEqual({ lessonId: 31, latitude: LAT, longitude: LNG, accuracyMeters: ACCURACY, studentId: 5 });

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Presença registrada! Bom treino."));
    await waitFor(() => expect(byTestId("geo-checkin-item")!.textContent).toContain("Presença registrada"));
    expect(button(/Estou aqui/)).toBeUndefined();
    // atualiza a lista (nova consulta) depois de registrar
    await waitFor(() => expect(availableGets().length).toBeGreaterThanOrEqual(2));
  });

  it("enquanto lê/envia: botão desabilitado, aria-busy e texto de carregando; não dispara duas vezes", async () => {
    let finish: PositionCallback = () => undefined;
    getCurrentPosition.mockImplementation((success) => {
      finish = success;
    });
    mount(<GeoCheckinSection />);
    await waitFor(() => expect(byTestId("geo-checkin-item")).not.toBeNull());
    await tapHere();
    const busy = button(/Estou aqui/)!;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.textContent).toContain("Obtendo sua localização…");
    await click(busy);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    await act(async () => finish({ coords: { latitude: LAT, longitude: LNG, accuracy: ACCURACY }, timestamp: 0 } as unknown as GeolocationPosition));
    await waitFor(() => expect(geoPosts()).toHaveLength(1));
  });

  it("precisão não numérica do aparelho: accuracyMeters é omitido do corpo", async () => {
    getCurrentPosition.mockImplementation((success) =>
      success({ coords: { latitude: LAT, longitude: LNG, accuracy: Number.NaN }, timestamp: 0 } as unknown as GeolocationPosition),
    );
    mount(<GeoCheckinSection />);
    await waitFor(() => expect(byTestId("geo-checkin-item")).not.toBeNull());
    await tapHere();
    await waitFor(() => expect(geoPosts()).toHaveLength(1));
    expect(geoPosts()[0]!.body).toEqual({ lessonId: 31, latitude: LAT, longitude: LNG, studentId: 5 });
  });

  it("já estava presente (alreadyCheckedIn: true): avisa que a presença já constava", async () => {
    postReply = () => ({ body: { ...okResult, alreadyCheckedIn: true, distanceMeters: 10 } });
    mount(<GeoCheckinSection />);
    await waitFor(() => expect(byTestId("geo-checkin-item")).not.toBeNull());
    await tapHere();
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Sua presença já estava registrada."));
    await waitFor(() => expect(byTestId("geo-checkin-item")!.textContent).toContain("Presença registrada"));
  });

  it("dependente: o POST leva o studentId do item tocado", async () => {
    studentsReply = [student(5, "Ana", 7), student(6, "Bia")];
    availableReply = () => ({ body: [option(), option({ studentId: 6, studentName: "Bia" })] });
    mount(<GeoCheckinSection />);
    await waitFor(() => expect(allByTestId("geo-checkin-item")).toHaveLength(2));
    await click(button("Estou aqui: Capoeira Infantil (Bia)"));
    await waitFor(() => expect(geoPosts()).toHaveLength(1));
    expect(geoPosts()[0]!.body).toMatchObject({ lessonId: 31, studentId: 6 });
  });
});

describe("erros da geolocalização (nenhum POST é feito)", () => {
  const cases: Array<[string, GeoImpl | null, RegExp]> = [
    ["permissão negada", positionFails(1), /Libere nas configurações do navegador \(ou do aparelho/],
    ["posição indisponível", positionFails(2), /Não foi possível obter sua posição agora/],
    ["tempo esgotado", positionFails(3), /A localização demorou demais/],
    ["navegador sem geolocalização", null, /Este navegador não tem localização disponível/],
  ];
  it.each(cases)("%s", async (_name, impl, expected) => {
    if (impl) getCurrentPosition.mockImplementation(impl);
    else delete (navigator as { geolocation?: unknown }).geolocation;
    mount(<GeoCheckinSection />);
    await waitFor(() => expect(byTestId("geo-checkin-item")).not.toBeNull());
    await tapHere();
    await waitFor(() => expect(alertText()).toMatch(expected));
    expect(geoPosts()).toHaveLength(0);
    expect(button(/Estou aqui/)!.disabled).toBe(false); // pode tentar de novo
  });
});

describe("erros do servidor (contrato §3)", () => {
  const serverCases: Array<[string, number, Record<string, unknown>, string]> = [
    ["LESSON_CANCELLED", 409, { code: "LESSON_CANCELLED", message: "Esta aula foi cancelada." }, "Esta aula foi cancelada."],
    ["OUTSIDE_WINDOW", 409, { code: "OUTSIDE_WINDOW", message: "O check-in só abre 2 horas antes da aula." }, "O check-in só abre 2 horas antes da aula."],
    ["GEO_CHECKIN_DISABLED", 403, { code: "GEO_CHECKIN_DISABLED", message: "Esta turma não usa check-in por localização." }, "Esta turma não usa check-in por localização."],
    ["GEO_NO_LOCATION", 409, { code: "GEO_NO_LOCATION", message: "A turma ainda não tem local definido." }, "A turma ainda não tem local definido."],
    ["GEO_ACCURACY_LOW", 400, { code: "GEO_ACCURACY_LOW", message: "Sinal de GPS fraco. Vá para um lugar aberto e tente de novo." }, "Sinal de GPS fraco. Vá para um lugar aberto e tente de novo."],
    ["aluno não matriculado (403 sem code)", 403, { message: "O aluno não está matriculado nesta turma." }, "O aluno não está matriculado nesta turma."],
    ["aula inexistente (404)", 404, { message: "Aula não encontrada." }, "Aula não encontrada."],
    ["limite de uso (429)", 429, { message: "ThrottlerException: Too Many Requests" }, "Muitas tentativas seguidas. Espere um minuto e tente de novo."],
  ];
  it.each(serverCases)("%s mostra a mensagem certa e permite tentar de novo", async (_name, status, body, expected) => {
    postReply = () => ({ status, body });
    mount(<GeoCheckinSection />);
    await waitFor(() => expect(byTestId("geo-checkin-item")).not.toBeNull());
    await tapHere();
    await waitFor(() => expect(alertText()).toBe(expected));
    expect(geoPosts()).toHaveLength(1);
    expect(button(/Estou aqui/)!.disabled).toBe(false);
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("GEO_TOO_FAR usa distanceMeters/radiusMeters do corpo: 'Você está a 320 m do local; chegue a até 150 m.'", async () => {
    postReply = () => ({
      status: 403,
      body: { code: "GEO_TOO_FAR", message: "Você está longe do local da aula.", distanceMeters: 320, radiusMeters: 150 },
    });
    mount(<GeoCheckinSection />);
    await waitFor(() => expect(byTestId("geo-checkin-item")).not.toBeNull());
    await tapHere();
    await waitFor(() => expect(alertText()).toBe("Você está a 320 m do local; chegue a até 150 m."));
    // a mensagem some ao tentar de novo
    postReply = () => ({ body: { ...okResult, distanceMeters: 40 } });
    await tapHere();
    await waitFor(() => expect(bodyText()).not.toContain("Você está a 320 m"));
  });

  it("GEO_TOO_FAR sem os números no corpo cai na mensagem do servidor", () => {
    const error = new ApiError("Você está longe do local da aula.", 403, "GEO_TOO_FAR", { code: "GEO_TOO_FAR" });
    expect(geoCheckinErrorMessage(error)).toBe("Você está longe do local da aula.");
  });

  it("falha de rede (erro que não é do servidor) mostra mensagem genérica; mensagens da geolocalização vêm da lib", () => {
    expect(geoCheckinErrorMessage(new TypeError("Failed to fetch"))).toMatch(/Verifique a conexão/);
    expect(geoCheckinErrorMessage(new GeolocationFailure("denied"))).toBe(GEO_FAILURE_MESSAGE.denied);
  });
});

describe("privacidade: a posição não é guardada", () => {
  const leaks = (spies: Array<{ mock: { calls: unknown[][] } }>) =>
    [
      JSON.stringify({ ...localStorage }),
      JSON.stringify({ ...sessionStorage }),
      JSON.stringify(queryClient.getQueryCache().getAll().map((query) => query.state.data)),
      JSON.stringify(queryClient.getMutationCache().getAll().map((mutation) => [mutation.state.variables, mutation.state.data])),
      document.body.innerHTML,
      JSON.stringify(spies.map((spy) => spy.mock.calls)),
    ].join("\n");

  it("depois do envio não há coordenadas em localStorage/sessionStorage, no cache do Query, no DOM nem em console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
    const storageBefore = JSON.stringify({ ...localStorage });
    mount(<GeoCheckinSection />);
    await waitFor(() => expect(byTestId("geo-checkin-item")).not.toBeNull());
    await tapHere();
    await waitFor(() => expect(geoPosts()).toHaveLength(1));
    await waitFor(() => expect(byTestId("geo-checkin-item")!.textContent).toContain("Presença registrada"));
    await settle();

    const everywhere = leaks(spies);
    for (const needle of [String(LAT), String(LNG), "16.6868", "49.2647"]) expect(everywhere).not.toContain(needle);
    expect(JSON.stringify({ ...localStorage })).toBe(storageBefore); // nada novo no storage
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0); // sem useMutation: o corpo não fica no cache de mutações
  });

  it("uma falha do servidor também não vaza coordenadas para console/DOM/storage", async () => {
    postReply = () => ({ status: 403, body: { code: "GEO_TOO_FAR", message: "longe", distanceMeters: 320, radiusMeters: 150 } });
    const spies = (["log", "warn", "error"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
    mount(<GeoCheckinSection />);
    await waitFor(() => expect(byTestId("geo-checkin-item")).not.toBeNull());
    await tapHere();
    await waitFor(() => expect(alertText()).not.toBe(""));
    const everywhere = leaks(spies);
    expect(everywhere).not.toContain(String(LAT));
    expect(everywhere).not.toContain(String(LNG));
  });
});

describe("cartão da Home", () => {
  it("aparece com 'Check-in disponível: <turma>' e leva à seção quando há opção em janela ainda não registrada", async () => {
    mount(<GeoCheckinHomeCard />);
    await waitFor(() => expect(byTestId("geo-checkin-home-card")).not.toBeNull());
    const card = byTestId("geo-checkin-home-card")!;
    expect(card.textContent).toContain("Check-in disponível: Capoeira Infantil");
    expect(card.getAttribute("href")).toBe(`/checkin#${GEO_CHECKIN_SECTION_ID}`);
    expect(getCurrentPosition).not.toHaveBeenCalled(); // o cartão nunca lê a posição
  });

  it("várias turmas: mostra a primeira e 'e mais N'", async () => {
    availableReply = () => ({ body: [option(), option({ lessonId: 32, className: "Adulto" }), option({ lessonId: 33, className: "Juvenil" })] });
    mount(<GeoCheckinHomeCard />);
    await waitFor(() => expect(byTestId("geo-checkin-home-card")).not.toBeNull());
    expect(byTestId("geo-checkin-home-card")!.textContent).toContain("Check-in disponível: Capoeira Infantil");
    expect(byTestId("geo-checkin-home-card")!.textContent).toContain("e mais 2 turmas");
  });

  it("não aparece quando a lista é vazia", async () => {
    availableReply = () => ({ body: [] });
    mount(<GeoCheckinHomeCard />);
    await waitFor(() => expect(availableGets()).toHaveLength(1));
    await settle(30);
    expect(byTestId("geo-checkin-home-card")).toBeNull();
  });

  it("não aparece quando tudo já foi registrado", async () => {
    availableReply = () => ({ body: [option({ alreadyCheckedIn: true })] });
    mount(<GeoCheckinHomeCard />);
    await waitFor(() => expect(availableGets()).toHaveLength(1));
    await settle(30);
    expect(byTestId("geo-checkin-home-card")).toBeNull();
  });

  it("sem aluno na conta: nenhuma requisição ao check-in e nenhum cartão", async () => {
    studentsReply = [];
    mount(<GeoCheckinHomeCard />);
    await waitFor(() => expect(calls.some((c) => c.path === "/students/me")).toBe(true));
    await settle();
    expect(availableGets()).toHaveLength(0);
    expect(byTestId("geo-checkin-home-card")).toBeNull();
  });

  it("pendingGeoOptions ignora o que já foi registrado", () => {
    expect(pendingGeoOptions(undefined)).toEqual([]);
    expect(pendingGeoOptions([option(), option({ lessonId: 2, alreadyCheckedIn: true })]).map((o) => o.lessonId)).toEqual([31]);
  });
});
