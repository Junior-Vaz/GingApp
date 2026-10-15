import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearSession, loginAs } from "./login-as";
import { TurmasPage } from "@/modules/turmas/turmas-page";
import {
  classLocationMissingPin,
  classLocationSummary,
  classToCreatePayload,
  classToForm,
  classToUpdatePayload,
  emptyClassForm,
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

const inherit: ClassItem = {
  id: 1, unitId: 7, name: "Infantil", description: null, weekday: 2, startTime: "18:00", endTime: "19:00", teacherUserId: null, status: "ACTIVE",
  locationLabel: null, address: null, city: null, state: null, latitude: null, longitude: null,
};
const own: ClassItem = {
  ...inherit, id: 2, name: "Praça", unitId: null, locationLabel: "Praça da Liberdade", address: "Av. Central, 10", city: "Goiânia", state: "GO",
  latitude: -16.68, longitude: -49.25,
};
const noPin: ClassItem = { ...inherit, id: 3, name: "Sem pino", locationLabel: null, address: "Rua Sem GPS, 5", city: "Anápolis", state: "GO" };

const routesFor = (rows: ClassItem[], extra: Record<string, (call: Call) => Response> = {}) => ({
  "GET /classes": () => json(200, rows, { "X-Total-Count": String(rows.length) }),
  "GET /units": () => json(200, [{ id: 7, name: "Sede Centro" }], { "X-Total-Count": "1" }),
  "GET /units/7": () => json(200, { id: 7, name: "Sede Centro" }),
  "GET /map/config": () => json(200, { enabled: true, apiKey: "k", mapId: null, geocodingEnabled: false }),
  ...extra,
});

beforeEach(() => loginAs("MESTRE"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("turmas: local do treino (schema)", () => {
  it("resumo e aviso: herda = sem resumo; próprio = rótulo · endereço · cidade/UF; endereço sem posição avisa", () => {
    expect(classLocationSummary(inherit)).toBeNull();
    expect(classLocationSummary(own)).toBe("Praça da Liberdade · Av. Central, 10 · Goiânia / GO");
    expect(classLocationMissingPin(own)).toBe(false);
    expect(classLocationMissingPin(noPin)).toBe(true);
    expect(classLocationMissingPin(inherit)).toBe(false);
  });

  it("payloads: unidade = nada (criar) e tudo null só se tinha local (editar); local diferente manda os campos", () => {
    const base = { ...emptyClassForm, name: "Ab" };
    expect(classToCreatePayload(base)).not.toHaveProperty("address");
    expect(classToUpdatePayload(base, inherit)).not.toHaveProperty("address"); // já herdava: nada a limpar
    expect(classToUpdatePayload(base, own)).toMatchObject({
      locationLabel: null, address: null, city: null, state: null, latitude: null, longitude: null,
    });

    const custom = { ...base, locationMode: "custom" as const, locationLabel: " Praça X ", address: "Rua A, 1", city: "Goiânia", state: "GO", latitude: "-16,68", longitude: "-49.25" };
    expect(classToCreatePayload(custom)).toMatchObject({ locationLabel: "Praça X", address: "Rua A, 1", city: "Goiânia", state: "GO", latitude: -16.68, longitude: -49.25 });
    // editar sem mexer nas coordenadas: não manda lat/lng (o servidor re-geocodifica se o endereço mudou)
    const same = classToForm(own);
    const patch = classToUpdatePayload({ ...same, address: "Av. Nova, 99" }, own);
    expect(patch).toMatchObject({ address: "Av. Nova, 99", city: "Goiânia" });
    expect(patch).not.toHaveProperty("latitude");
    expect(classToForm(own).locationMode).toBe("custom");
    expect(classToForm(inherit).locationMode).toBe("unit");
  });
});

describe("TurmasPage: seção Local do treino", () => {
  it("lista mostra o resumo do local próprio e o aviso de endereço sem posição; turma que herda não mostra nada", async () => {
    mockApi(routesFor([inherit, own, noPin]));
    renderPage();
    await screen.findByText("Infantil");
    const summaries = screen.getAllByTestId("class-location").map((e) => e.textContent);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toContain("Praça da Liberdade · Av. Central, 10 · Goiânia / GO");
    expect(screen.getAllByTestId("class-location-warning")).toHaveLength(1);
  });

  it("padrão 'Usar o endereço da unidade'; 'Local diferente' mostra endereço e posição; criar envia o local no POST", async () => {
    const calls = mockApi(routesFor([inherit], { "POST /classes": () => json(201, { id: 9 }) }));
    renderPage();
    await screen.findByText("Infantil");
    fireEvent.click(screen.getByRole("button", { name: /Nova turma/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: "Usar o endereço da unidade" })).toBeChecked();
    expect(within(dialog).queryByLabelText("Endereço do treino")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("radio", { name: "Local diferente" }));
    fireEvent.change(await within(dialog).findByLabelText("Nome do local"), { target: { value: "Praça X" } });
    fireEvent.change(within(dialog).getByLabelText("Endereço do treino"), { target: { value: "Rua A, 1" } });
    fireEvent.change(within(dialog).getByLabelText("Cidade do treino"), { target: { value: "Goiânia" } });
    fireEvent.change(within(dialog).getByLabelText("UF do treino"), { target: { value: "GO" } });
    expect(within(dialog).getByTestId("coordinates-fields")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Latitude"), { target: { value: "-16.68" } });
    fireEvent.change(within(dialog).getByLabelText("Longitude"), { target: { value: "-49.25" } });
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Treino Praça" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toMatchObject({
      name: "Treino Praça", locationLabel: "Praça X", address: "Rua A, 1", city: "Goiânia", state: "GO", latitude: -16.68, longitude: -49.25,
    });
  });

  it("editar turma com local próprio abre em 'Local diferente'; voltar para 'Usar o endereço da unidade' limpa tudo (PATCH null)", async () => {
    const calls = mockApi(routesFor([own], { "PATCH /classes/2": () => json(200, {}) }));
    renderPage();
    await screen.findByText("Praça");
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Endereço do treino")).toHaveValue("Av. Central, 10"));
    expect(within(dialog).getByRole("radio", { name: "Local diferente" })).toBeChecked();
    expect(within(dialog).getByLabelText("Latitude")).toHaveValue("-16.68");

    fireEvent.click(within(dialog).getByRole("radio", { name: "Usar o endereço da unidade" }));
    await waitFor(() => expect(within(dialog).queryByLabelText("Endereço do treino")).not.toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({
      locationLabel: null, address: null, city: null, state: null, latitude: null, longitude: null,
    });
  });
});
