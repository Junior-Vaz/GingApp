import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { CoordinatesFields } from "@/components/painel/coordinates-fields";
import { Form } from "@/components/ui/form";
import {
  coordinatesCreatePayload,
  coordinatesUpdatePayload,
  googleMapsLink,
  hasHalfCoordinates,
  latitudeField,
  longitudeField,
  parseCoordinate,
} from "@/lib/map";
import { unitSchema, unitToCreatePayload, unitToForm, unitToUpdatePayload, type Unit } from "@/modules/unidades/units";
import { clearSession } from "./login-as";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function mockApi(config: Record<string, unknown> | null, geocode: () => Response = () => json(404, { message: "Endereço não encontrado." })) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api/, "");
      calls.push({ method: init.method ?? "GET", path, body: init.body ? (JSON.parse(init.body as string) as unknown) : undefined });
      if (path === "/map/config") return Promise.resolve(config ? json(200, config) : json(500, { message: "x" }));
      if (path === "/map/geocode") return Promise.resolve(geocode());
      return Promise.resolve(json(404, {}));
    }),
  );
  return calls;
}

function Harness() {
  const form = useForm({ defaultValues: { latitude: "", longitude: "", address: "Rua A, 10" } });
  return (
    <Form {...form}>
      <CoordinatesFields buildQuery={() => `${form.getValues("address")}, Goiânia, GO`} />
    </Form>
  );
}

function renderHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

const unit = (extra: Partial<Unit> = {}): Unit => ({
  id: 1, organizationId: 1, name: "Matriz", address: "Rua A", city: "Goiânia", state: "GO", isMain: true, status: "ACTIVE", ...extra,
});

describe("coordenadas do mapa (lib/map)", () => {
  it("parseCoordinate aceita vírgula decimal; vazio/inválido => null; limites -90..90 e -180..180", () => {
    expect(parseCoordinate("-16,6869")).toBe(-16.6869);
    expect(parseCoordinate(" ")).toBeNull();
    expect(parseCoordinate("abc")).toBeNull();
    expect(latitudeField.safeParse("90").success).toBe(true);
    expect(latitudeField.safeParse("91").success).toBe(false);
    expect(longitudeField.safeParse("-181").success).toBe(false);
    expect(longitudeField.safeParse("").success).toBe(true);
    expect(hasHalfCoordinates({ latitude: "1", longitude: "" })).toBe(true);
    expect(googleMapsLink(-16.68, -49.26)).toBe("https://www.google.com/maps/search/?api=1&query=-16.68,-49.26");
  });

  it("criar envia o par só quando completo; editar só envia quando o usuário MUDOU (senão o servidor re-geocodifica)", () => {
    expect(coordinatesCreatePayload({ latitude: "-16.6", longitude: "-49.2" })).toEqual({ latitude: -16.6, longitude: -49.2 });
    expect(coordinatesCreatePayload({ latitude: "-16.6", longitude: "" })).toEqual({});
    const original = { latitude: -16.6, longitude: -49.2 };
    expect(coordinatesUpdatePayload({ latitude: "-16.6", longitude: "-49.2" }, original)).toEqual({});
    expect(coordinatesUpdatePayload({ latitude: "-17", longitude: "-49.2" }, original)).toEqual({ latitude: -17, longitude: -49.2 });
    expect(coordinatesUpdatePayload({ latitude: "", longitude: "" }, original)).toEqual({ latitude: null, longitude: null });
  });

  it("unidade: schema recusa só uma das coordenadas; payloads de criar/editar levam (ou omitem) latitude/longitude", () => {
    const form = unitToForm(unit({ latitude: -16.6869, longitude: -49.2648 }));
    expect(form).toMatchObject({ latitude: "-16.6869", longitude: "-49.2648" });
    expect(unitSchema.safeParse(form).success).toBe(true);
    expect(unitSchema.safeParse({ ...form, longitude: "" }).success).toBe(false);
    expect(unitSchema.safeParse({ ...form, latitude: "100" }).success).toBe(false);
    expect(unitToCreatePayload(form)).toMatchObject({ latitude: -16.6869, longitude: -49.2648 });
    const original = unit({ latitude: -16.6869, longitude: -49.2648 });
    expect(unitToUpdatePayload({ ...form, address: "Rua B" }, original)).not.toHaveProperty("latitude");
    expect(unitToUpdatePayload({ ...form, latitude: "", longitude: "" }, original)).toMatchObject({ latitude: null, longitude: null });
  });
});

describe("CoordinatesFields", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    clearSession();
  });

  it("sem chave de geocodificação no servidor: sem botão 'Localizar', com aviso; com coordenadas válidas aparece 'Ver no Google Maps'", async () => {
    mockApi({ enabled: false, apiKey: null, mapId: null, geocodingEnabled: false });
    renderHarness();
    expect(await screen.findByText(/localização automática pelo endereço não está disponível/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Localizar pelo endereço/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Ver no Google Maps")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "-16.6869" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-49,2648" } });
    expect(await screen.findByRole("link", { name: /Ver no Google Maps/ })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=-16.6869,-49.2648",
    );
  });

  it("com chave: 'Localizar pelo endereço' chama POST /map/geocode e preenche; 404 mostra a mensagem do servidor", async () => {
    let found = true;
    const calls = mockApi({ enabled: true, apiKey: "k", mapId: null, geocodingEnabled: true }, () =>
      found ? json(200, { latitude: -16.6869, longitude: -49.2648 }) : json(404, { message: "Endereço não encontrado." }),
    );
    renderHarness();
    fireEvent.click(await screen.findByRole("button", { name: "Localizar pelo endereço" }));
    await waitFor(() => expect(screen.getByLabelText("Latitude")).toHaveValue("-16.6869"));
    expect(screen.getByLabelText("Longitude")).toHaveValue("-49.2648");
    expect(calls.find((c) => c.path === "/map/geocode")).toMatchObject({ method: "POST", body: { query: "Rua A, 10, Goiânia, GO" } });

    found = false;
    fireEvent.click(screen.getByRole("button", { name: "Localizar pelo endereço" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Endereço não encontrado."));
  });
});
