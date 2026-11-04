import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { clearSession, loginAs } from "./login-as";
import { TurmasPage } from "@/modules/turmas/turmas-page";
import {
  classSchema,
  classToCreatePayload,
  classToForm,
  classToUpdatePayload,
  emptyClassForm,
  parseGeoRadius,
  type ClassItem,
} from "@/modules/turmas/schema";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string; body: unknown };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function mockApi(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const [path = ""] = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
      const method = init.method ?? "GET";
      calls.push({ method, path, body: init.body ? JSON.parse(init.body as string) : undefined });
      const handler = routes[`${method} ${path}`];
      return Promise.resolve(handler ? handler(calls[calls.length - 1]!) : json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
  return calls;
}

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TurmasPage />
    </QueryClientProvider>,
  );

const base: ClassItem = {
  id: 1, unitId: 7, name: "Infantil", description: null, weekday: 2, startTime: "18:00", endTime: "19:00", teacherUserId: null, status: "ACTIVE",
  locationLabel: null, address: null, city: null, state: null, latitude: null, longitude: null,
  geoCheckinEnabled: false, geoCheckinRadiusMeters: 150, geoCheckinLocation: "UNIT",
};
const geoOn: ClassItem = { ...base, id: 2, name: "Adulto", geoCheckinEnabled: true, geoCheckinRadiusMeters: 200, geoCheckinLocation: "CLASS" };
const noLocation: ClassItem = { ...base, id: 3, name: "Sem local", geoCheckinLocation: null };

const routesFor = (rows: ClassItem[], extra: Record<string, (call: Call) => Response> = {}) => ({
  "GET /classes": () => json(200, rows, { "X-Total-Count": String(rows.length) }),
  "GET /units": () => json(200, [{ id: 7, name: "Sede Centro" }], { "X-Total-Count": "1" }),
  "GET /units/7": () => json(200, { id: 7, name: "Sede Centro" }),
  "GET /map/config": () => json(200, { enabled: true, apiKey: "k", mapId: null, geocodingEnabled: false }),
  ...extra,
});

const SWITCH = "Permitir que o aluno registre a própria presença por localização (GPS)";

beforeEach(() => loginAs("MESTRE"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("turmas: check-in por GPS (schema)", () => {
  it("parseGeoRadius só aceita inteiro de 50 a 500", () => {
    expect(parseGeoRadius("150")).toBe(150);
    expect(parseGeoRadius(" 50 ")).toBe(50);
    expect(parseGeoRadius("500")).toBe(500);
    for (const bad of ["49", "501", "", "abc", "12.5", "-60", undefined]) expect(parseGeoRadius(bad)).toBeNull();
  });

  it("padrão desligado/150; classToForm lê os campos do servidor (e cai no padrão em respostas antigas)", () => {
    expect(emptyClassForm).toMatchObject({ geoCheckinEnabled: false, geoCheckinRadiusMeters: "150" });
    expect(classToForm(geoOn)).toMatchObject({ geoCheckinEnabled: true, geoCheckinRadiusMeters: "200" });
    const legacy: ClassItem = { ...base };
    delete legacy.geoCheckinEnabled;
    delete legacy.geoCheckinRadiusMeters;
    delete legacy.geoCheckinLocation;
    expect(classToForm(legacy)).toMatchObject({ geoCheckinEnabled: false, geoCheckinRadiusMeters: "150" });
  });

  it("validação: ligado exige raio inteiro 50..500; desligado ignora o raio", () => {
    const ok = { ...emptyClassForm, name: "Ab" };
    expect(classSchema.safeParse({ ...ok, geoCheckinEnabled: true, geoCheckinRadiusMeters: "150" }).success).toBe(true);
    const low = classSchema.safeParse({ ...ok, geoCheckinEnabled: true, geoCheckinRadiusMeters: "10" });
    expect(low.success).toBe(false);
    expect(!low.success && low.error.issues[0]?.path).toEqual(["geoCheckinRadiusMeters"]);
    expect(classSchema.safeParse({ ...ok, geoCheckinEnabled: true, geoCheckinRadiusMeters: "501" }).success).toBe(false);
    expect(classSchema.safeParse({ ...ok, geoCheckinEnabled: false, geoCheckinRadiusMeters: "abc" }).success).toBe(true);
  });

  it("payloads: criar desligada não manda nada; ligada manda interruptor+raio; editar: desligar só manda false se estava ligada", () => {
    const form = { ...emptyClassForm, name: "Ab" };
    const off = classToCreatePayload(form);
    expect(off).not.toHaveProperty("geoCheckinEnabled");
    expect(off).not.toHaveProperty("geoCheckinRadiusMeters");
    expect(classToCreatePayload({ ...form, geoCheckinEnabled: true, geoCheckinRadiusMeters: "300" })).toMatchObject({
      geoCheckinEnabled: true, geoCheckinRadiusMeters: 300,
    });

    const patchOffStillOff = classToUpdatePayload(classToForm(base), base);
    expect(patchOffStillOff).not.toHaveProperty("geoCheckinEnabled");
    expect(patchOffStillOff).not.toHaveProperty("geoCheckinRadiusMeters");
    expect(classToUpdatePayload({ ...classToForm(geoOn), geoCheckinEnabled: false }, geoOn)).toMatchObject({ geoCheckinEnabled: false });
    expect(classToUpdatePayload({ ...classToForm(geoOn), geoCheckinEnabled: false }, geoOn)).not.toHaveProperty("geoCheckinRadiusMeters");
    expect(classToUpdatePayload({ ...classToForm(geoOn), geoCheckinRadiusMeters: "80" }, geoOn)).toMatchObject({
      geoCheckinEnabled: true, geoCheckinRadiusMeters: 80,
    });
  });
});

describe("TurmasPage: interruptor de check-in por localização (GPS)", () => {
  it("nova turma: interruptor desligado, raio só aparece ligado (padrão 150) e a dica está visível", async () => {
    mockApi(routesFor([base]));
    renderPage();
    await screen.findByText("Infantil");
    fireEvent.click(screen.getByRole("button", { name: /Nova turma/ }));
    const dialog = await screen.findByRole("dialog");
    const toggle = within(dialog).getByRole("switch", { name: SWITCH });
    expect(toggle).not.toBeChecked();
    expect(within(dialog).getByText("Usa o local da turma; se ela não tiver, usa o da unidade. Defina o local antes.")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Raio permitido (metros)")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(await within(dialog).findByLabelText("Raio permitido (metros)")).toHaveValue(150);
  });

  it("criar com GPS ligado e raio 250 envia geoCheckinEnabled e geoCheckinRadiusMeters no POST", async () => {
    const calls = mockApi(routesFor([base], { "POST /classes": () => json(201, { id: 9 }) }));
    renderPage();
    await screen.findByText("Infantil");
    fireEvent.click(screen.getByRole("button", { name: /Nova turma/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Turma GPS" } });
    fireEvent.click(within(dialog).getByRole("switch", { name: SWITCH }));
    fireEvent.change(await within(dialog).findByLabelText("Raio permitido (metros)"), { target: { value: "250" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({ name: "Turma GPS", geoCheckinEnabled: true, geoCheckinRadiusMeters: 250 });
  });

  it("criar com GPS desligado não manda os campos de GPS", async () => {
    const calls = mockApi(routesFor([base], { "POST /classes": () => json(201, { id: 9 }) }));
    renderPage();
    await screen.findByText("Infantil");
    fireEvent.click(screen.getByRole("button", { name: /Nova turma/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Turma comum" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const body = calls.find((c) => c.method === "POST")!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("geoCheckinEnabled");
    expect(body).not.toHaveProperty("geoCheckinRadiusMeters");
  });

  it("raio fora da faixa (10) bloqueia o envio e mostra a mensagem no campo", async () => {
    const calls = mockApi(routesFor([base], { "POST /classes": () => json(201, { id: 9 }) }));
    renderPage();
    await screen.findByText("Infantil");
    fireEvent.click(screen.getByRole("button", { name: /Nova turma/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Turma GPS" } });
    fireEvent.click(within(dialog).getByRole("switch", { name: SWITCH }));
    fireEvent.change(await within(dialog).findByLabelText("Raio permitido (metros)"), { target: { value: "10" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText(/Informe o raio em metros/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("erro 400 GEO_CHECKIN_NO_LOCATION: a mensagem do servidor aparece junto do interruptor e o diálogo continua aberto", async () => {
    const message = "Defina o local da turma (ou da unidade) antes de ligar o check-in por localização.";
    mockApi(
      routesFor([base], {
        "PATCH /classes/1": () => json(400, { statusCode: 400, code: "GEO_CHECKIN_NO_LOCATION", message }),
      }),
    );
    renderPage();
    await screen.findByText("Infantil");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("switch", { name: SWITCH }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByTestId("geo-checkin-error")).toHaveTextContent(message);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(message);
    // mexer no interruptor limpa o erro
    fireEvent.click(within(dialog).getByRole("switch", { name: SWITCH }));
    expect(within(dialog).queryByTestId("geo-checkin-error")).not.toBeInTheDocument();
  });

  it("editar turma ligada mostra a origem do local (turma/unidade) e o PATCH leva interruptor + raio", async () => {
    const calls = mockApi(routesFor([geoOn], { "PATCH /classes/2": () => json(200, {}) }));
    renderPage();
    await screen.findByText("Adulto");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("switch", { name: SWITCH })).toBeChecked();
    await waitFor(() => expect(within(dialog).getByLabelText("Raio permitido (metros)")).toHaveValue(200));
    expect(within(dialog).getByTestId("geo-checkin-location")).toHaveTextContent("Usando o local da turma.");
    fireEvent.change(within(dialog).getByLabelText("Raio permitido (metros)"), { target: { value: "300" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ geoCheckinEnabled: true, geoCheckinRadiusMeters: 300 });
  });

  it("origem 'unidade' mostra 'Usando o local da unidade.'", async () => {
    mockApi(routesFor([{ ...base, geoCheckinEnabled: true }]));
    renderPage();
    await screen.findByText("Infantil");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByTestId("geo-checkin-location")).toHaveTextContent("Usando o local da unidade.");
    expect(within(dialog).queryByTestId("geo-checkin-no-location")).not.toBeInTheDocument();
  });

  it("geoCheckinLocation nulo com o interruptor ligado mostra o aviso de que falta definir o local", async () => {
    mockApi(routesFor([noLocation]));
    renderPage();
    await screen.findByText("Sem local");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByTestId("geo-checkin-no-location")).not.toBeInTheDocument(); // desligado: sem aviso
    fireEvent.click(within(dialog).getByRole("switch", { name: SWITCH }));
    expect(await within(dialog).findByTestId("geo-checkin-no-location")).toHaveTextContent(/ainda não tem local/);
  });
});
