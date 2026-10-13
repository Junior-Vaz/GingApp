import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearSession, loginAs } from "./login-as";
import { AlunosPage } from "@/modules/alunos/alunos-page";
import { occurrenceBody } from "@/modules/alunos/ocorrencias";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string; query: URLSearchParams; body: unknown };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function mockApi(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const [path = "", search = ""] = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
      const method = init.method ?? "GET";
      const call: Call = {
        method,
        path,
        query: new URLSearchParams(search),
        body: init.body ? JSON.parse(init.body as string) : undefined,
      };
      calls.push(call);
      const handler = routes[`${method} ${path}`];
      return Promise.resolve(handler ? handler(call) : json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
  return calls;
}

function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const students = [
  { id: 1, unitId: null, name: "Ana Souza", birthDate: "1990-05-10T00:00:00.000Z", document: null, phone: null, email: null, status: "ACTIVE", joinedAt: null },
];
const base = () => ({
  "GET /students": () => json(200, students, { "X-Total-Count": "1" }),
  "GET /units": () => json(200, [], { "X-Total-Count": "0" }),
});

const BLUE = { id: 4, name: "Corda Azul", order: 4, color: "#2563eb", style: "SOLID", colors: ["#2563eb"] };
const FICHA = {
  person: { id: 10, gingappCode: "GING-7K3Q-9XPM", name: "Ana Souza", nickname: null, birthDate: null, photo: null, documentMasked: null, documentKind: null },
  enrollments: [
    { studentId: 1, organization: { id: 1, name: "Ginga Brasil", logoUrl: null }, unit: null, status: "ACTIVE", since: "2024-02-01T00:00:00.000Z", until: null, isCurrent: true },
  ],
  graduations: [
    { id: 1, studentId: 1, organization: { id: 1, name: "Ginga Brasil" }, graduatedAt: "2025-03-01T00:00:00.000Z", level: BLUE, system: { id: 1, name: "Sistema Padrão" }, recognizedFromLevelId: 2 },
    { id: 2, studentId: 1, organization: { id: 1, name: "Ginga Brasil" }, graduatedAt: "2024-03-01T00:00:00.000Z", level: { ...BLUE, id: 3, name: "Corda Verde", order: 3 }, system: { id: 1, name: "Sistema Padrão" }, recognizedFromLevelId: null },
  ],
  attendanceByGroup: [],
  certificates: [],
  sharedFromOtherGroups: [],
  scope: "OWN_GROUP",
};
const SHARED = {
  shareId: 1,
  organization: { id: 3, name: "Grupo Antigo Axé", logoUrl: null },
  studentId: 40,
  since: "2022-01-10T00:00:00.000Z",
  until: "2024-01-31T00:00:00.000Z",
  leftReason: null,
  sharedAt: "2026-10-01T12:00:00.000Z",
  graduations: [],
  attendanceByClass: [],
  certificates: [],
};

const OCCURRENCES = [
  { id: 7, kind: "SUSPENSAO", occurredAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-15T00:00:00.000Z", reason: "Briga na roda", status: "CONTESTED", expelledEnrollment: false, createdAt: "2026-09-01T10:00:00.000Z", createdBy: { id: 1, name: "Mestre" }, contestedAt: "2026-09-02T10:00:00.000Z", contestNote: "Não foi bem assim", retractedAt: null, retractNote: null },
  { id: 8, kind: "ADVERTENCIA", occurredAt: "2026-08-01T00:00:00.000Z", endsAt: null, reason: "Atraso repetido", status: "RETRACTED", expelledEnrollment: false, createdAt: "2026-08-01T10:00:00.000Z", createdBy: null, contestedAt: null, contestNote: null, retractedAt: "2026-08-05T10:00:00.000Z", retractNote: "Erro de registro" },
];
const created = { ...OCCURRENCES[1]!, id: 9, status: "ACTIVE" };

const SYSTEMS = [
  {
    id: 1,
    name: "Sistema Padrão",
    description: null,
    isActive: true,
    levels: [
      { id: 10, graduationSystemId: 1, name: "Corda Azul", order: 4, color: "#2563eb", style: "SOLID", colors: ["#2563eb"] },
      { id: 11, graduationSystemId: 1, name: "Corda Roxa", order: 5, color: "#7c3aed", style: "SOLID", colors: ["#7c3aed"] },
    ],
  },
];
const FROM = { id: 2, name: "Corda Verde e Amarela", order: 2, color: "#16a34a", style: "BRAIDED", colors: ["#16a34a", "#facc15"] };
const SUGGESTION = {
  fromLevel: FROM,
  fromSystem: { id: 5, name: "Sistema Antigo", levelsCount: 8 },
  fromOrganization: { id: 3, name: "Grupo Antigo Axé", logoUrl: null },
  graduatedAt: "2023-06-01T00:00:00.000Z",
  declared: null,
  suggested: { id: 11, name: "Corda Roxa", order: 5, color: "#7c3aed", style: "SOLID", colors: ["#7c3aed"] },
  toSystem: { id: 1, name: "Sistema Padrão" },
  recognized: false,
};

async function openFicha() {
  renderPage(<AlunosPage />);
  await screen.findByText("Ana Souza");
  fireEvent.click(screen.getByRole("button", { name: "Ficha de Ana Souza" }));
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByTestId("ficha-content");
  return dialog;
}

beforeEach(() => {
  localStorage.setItem("painel:alunos:view", "table");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("Ocorrências: corpo do POST", () => {
  it("endsAt só em suspensão; expel só em expulsão marcada", () => {
    const f = { occurredAt: "2026-10-01", reason: "  Motivo  ", endsAt: "2026-10-10", expel: true };
    expect(occurrenceBody({ ...f, kind: "ADVERTENCIA" })).toEqual({ kind: "ADVERTENCIA", occurredAt: "2026-10-01", reason: "Motivo" });
    expect(occurrenceBody({ ...f, kind: "SUSPENSAO" })).toEqual({ kind: "SUSPENSAO", occurredAt: "2026-10-01", reason: "Motivo", endsAt: "2026-10-10" });
    expect(occurrenceBody({ ...f, kind: "EXPULSAO" })).toEqual({ kind: "EXPULSAO", occurredAt: "2026-10-01", reason: "Motivo", expel: true });
    expect(occurrenceBody({ ...f, kind: "EXPULSAO", expel: false })).toEqual({ kind: "EXPULSAO", occurredAt: "2026-10-01", reason: "Motivo" });
  });
});

describe("Ficha: Ocorrências (só MESTRE)", () => {
  it("MESTRE vê a lista com os selos Contestada (com a nota) e Retratada e o aviso de confidencialidade", async () => {
    loginAs("MESTRE");
    mockApi({ ...base(), "GET /students/1/ficha": () => json(200, FICHA), "GET /students/1/occurrences": () => json(200, OCCURRENCES) });
    const dialog = await openFicha();
    const section = await within(dialog).findByTestId("ficha-ocorrencias");
    expect(await within(section).findAllByTestId("ocorrencia-item")).toHaveLength(2);
    expect(section).toHaveTextContent("Informação confidencial, visível só ao Mestre");
    expect(section).toHaveTextContent("Suspensão");
    expect(section).toHaveTextContent("01/09/2026 até 15/09/2026");
    expect(section).toHaveTextContent("Contestada");
    expect(section).toHaveTextContent("Não foi bem assim");
    expect(section).toHaveTextContent("Retratada");
    expect(section).toHaveTextContent("Erro de registro");
  });

  it("PROFESSOR não vê a seção e a rota de ocorrências nem é chamada", async () => {
    loginAs("PROFESSOR");
    const calls = mockApi({ ...base(), "GET /students/1/ficha": () => json(200, FICHA) });
    const dialog = await openFicha();
    expect(within(dialog).queryByTestId("ficha-ocorrencias")).not.toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("Ocorrências");
    expect(calls.some((c) => c.path.includes("/occurrences"))).toBe(false);
    expect(calls.some((c) => c.path.includes("/equivalences"))).toBe(false);
  });

  it("criar advertência envia kind/data/motivo, sem endsAt nem expel", async () => {
    loginAs("MESTRE");
    const calls = mockApi({
      ...base(),
      "GET /students/1/ficha": () => json(200, FICHA),
      "GET /students/1/occurrences": () => json(200, []),
      "POST /students/1/occurrences": () => json(201, created),
    });
    const dialog = await openFicha();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Registrar ocorrência" }));
    fireEvent.change(within(dialog).getByLabelText("Data"), { target: { value: "2026-10-01" } });
    fireEvent.change(within(dialog).getByLabelText("Motivo"), { target: { value: "Atraso repetido" } });
    expect(within(dialog).getByText("15/280")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Fim da suspensão/)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ kind: "ADVERTENCIA", occurredAt: "2026-10-01", reason: "Atraso repetido" });
  });

  it("suspensão envia o fim; expulsão com 'Encerrar a matrícula' pede confirmação forte e envia expel:true", async () => {
    loginAs("MESTRE");
    const calls = mockApi({
      ...base(),
      "GET /students/1/ficha": () => json(200, FICHA),
      "GET /students/1/occurrences": () => json(200, []),
      "POST /students/1/occurrences": () => json(201, created),
    });
    const dialog = await openFicha();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Registrar ocorrência" }));
    fireEvent.change(within(dialog).getByLabelText("Tipo"), { target: { value: "SUSPENSAO" } });
    fireEvent.change(within(dialog).getByLabelText("Data"), { target: { value: "2026-10-01" } });
    fireEvent.change(within(dialog).getByLabelText("Fim da suspensão"), { target: { value: "2026-10-08" } });
    fireEvent.change(within(dialog).getByLabelText("Motivo"), { target: { value: "Briga" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ kind: "SUSPENSAO", occurredAt: "2026-10-01", reason: "Briga", endsAt: "2026-10-08" });

    fireEvent.click(await within(dialog).findByRole("button", { name: "Registrar ocorrência" }));
    fireEvent.change(within(dialog).getByLabelText("Tipo"), { target: { value: "EXPULSAO" } });
    fireEvent.change(within(dialog).getByLabelText("Data"), { target: { value: "2026-10-02" } });
    fireEvent.change(within(dialog).getByLabelText("Motivo"), { target: { value: "Agressão grave" } });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1); // ainda não enviou
    fireEvent.click(within(confirm).getByRole("button", { name: "Expulsar e encerrar a matrícula" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(2));
    expect(calls.filter((c) => c.method === "POST")[1]?.body).toEqual({ kind: "EXPULSAO", occurredAt: "2026-10-02", reason: "Agressão grave", expel: true });
  });

  it("Retratar chama PATCH .../retract com a nota; a retratada não oferece o botão", async () => {
    loginAs("MESTRE");
    const calls = mockApi({
      ...base(),
      "GET /students/1/ficha": () => json(200, FICHA),
      "GET /students/1/occurrences": () => json(200, OCCURRENCES),
      "PATCH /students/1/occurrences/7/retract": () => json(200, { ...OCCURRENCES[0]!, status: "RETRACTED" }),
    });
    const dialog = await openFicha();
    const items = await within(dialog).findAllByTestId("ocorrencia-item");
    expect(within(items[1]!).queryByRole("button", { name: "Retratar" })).not.toBeInTheDocument();
    fireEvent.click(within(items[0]!).getByRole("button", { name: "Retratar" }));
    fireEvent.change(within(items[0]!).getByLabelText(/Nota da retratação/), { target: { value: "Pedido de desculpas aceito" } });
    fireEvent.click(within(items[0]!).getByRole("button", { name: "Confirmar retratação" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.path).toBe("/students/1/occurrences/7/retract");
    expect(patch.body).toEqual({ note: "Pedido de desculpas aceito" });
  });
});

describe("Ficha: histórico de outros grupos", () => {
  it("MESTRE: ocorrências de outros grupos aparecem como leitura, com o aviso de confidencialidade e a contestação", async () => {
    loginAs("MESTRE");
    const shared = {
      ...SHARED,
      occurrences: [
        { id: 3, kind: "ADVERTENCIA", occurredAt: "2023-05-01T00:00:00.000Z", endsAt: null, reason: "Faltou com respeito", status: "CONTESTED", contestNote: "Discordo do relato" },
      ],
    };
    mockApi({
      ...base(),
      "GET /students/1/ficha": () => json(200, { ...FICHA, sharedFromOtherGroups: [shared] }),
      "GET /students/1/occurrences": () => json(200, []),
      "GET /graduations/equivalences/suggestions": () => json(200, []),
      "GET /graduations/systems": () => json(200, SYSTEMS),
    });
    const dialog = await openFicha();
    const box = await within(dialog).findByTestId("ficha-shared-ocorrencias");
    expect(box).toHaveTextContent("Ocorrências em outros grupos");
    expect(box).toHaveTextContent("Informação confidencial, visível só ao Mestre; registrada pelo grupo de origem; pode ter sido contestada");
    expect(box).toHaveTextContent("Faltou com respeito");
    expect(box).toHaveTextContent("Contestada");
    expect(box).toHaveTextContent("Discordo do relato");
    expect(within(box).queryByRole("button")).not.toBeInTheDocument(); // somente leitura
  });

  it("sem a chave occurrences (outros papéis), a subseção não aparece e nada de Mestre é consultado", async () => {
    loginAs("PROFESSOR");
    const calls = mockApi({ ...base(), "GET /students/1/ficha": () => json(200, { ...FICHA, sharedFromOtherGroups: [SHARED] }) });
    const dialog = await openFicha();
    await within(dialog).findByTestId("ficha-shared");
    expect(within(dialog).queryByTestId("ficha-shared-ocorrencias")).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId("ficha-reconhecer")).not.toBeInTheDocument();
    expect(calls.some((c) => c.path.includes("/equivalences"))).toBe(false);
  });
});

describe("Ficha: Reconhecer corda", () => {
  const routes = () => ({
    ...base(),
    "GET /students/1/ficha": () => json(200, { ...FICHA, sharedFromOtherGroups: [{ ...SHARED, occurrences: [] }] }),
    "GET /students/1/occurrences": () => json(200, []),
    "GET /graduations/systems": () => json(200, SYSTEMS),
    "GET /graduations/equivalences/suggestions": () => json(200, [SUGGESTION]),
  });

  it("graduação reconhecida na lista da ficha mostra a marca 'Reconhecida'", async () => {
    loginAs("MESTRE");
    mockApi({ ...base(), "GET /students/1/ficha": () => json(200, FICHA), "GET /students/1/occurrences": () => json(200, []) });
    const dialog = await openFicha();
    const list = within(dialog).getByText("Graduações").closest("section")!;
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Reconhecida");
    expect(items[1]).not.toHaveTextContent("Reconhecida");
  });

  it("pré-seleciona a sugestão (com a marca) e 'Reconhecer' envia o POST com recognizeForStudentId", async () => {
    loginAs("MESTRE");
    const calls = mockApi({
      ...routes(),
      "POST /graduations/equivalences": () =>
        json(201, { equivalence: { id: 1, fromLevel: FROM, toLevel: SUGGESTION.suggested, fromOrganization: { id: 3, name: "Grupo Antigo Axé" } }, recognizedGraduation: { id: 50, graduatedAt: "2026-10-12T00:00:00.000Z", graduationLevelId: 11, notes: "Reconhecida de Grupo Antigo Axé" } }),
    });
    const dialog = await openFicha();
    const row = await within(dialog).findByTestId("equivalencia-item");
    expect(calls.find((c) => c.path === "/graduations/equivalences/suggestions")?.query.get("studentId")).toBe("1");
    expect(row).toHaveTextContent("Corda Verde e Amarela");
    expect(row).toHaveTextContent("Grupo Antigo Axé");
    const select = within(row).getByLabelText("Nível equivalente a Corda Verde e Amarela") as HTMLSelectElement;
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(3)); // vazio + 2 níveis do grupo
    expect(select.value).toBe("11");
    expect(within(row).getByTestId("equivalencia-marca")).toHaveTextContent("sugerida");
    fireEvent.click(within(row).getByRole("button", { name: "Reconhecer" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ fromLevelId: 2, toLevelId: 11, recognizeForStudentId: 1 });
  });

  it("'Só declarar equivalência' envia o POST sem recognizeForStudentId, com o nível escolhido", async () => {
    loginAs("MESTRE");
    const calls = mockApi({
      ...routes(),
      "POST /graduations/equivalences": () =>
        json(201, { equivalence: { id: 1, fromLevel: FROM, toLevel: SUGGESTION.suggested, fromOrganization: { id: 3, name: "Grupo Antigo Axé" } }, recognizedGraduation: null }),
    });
    const dialog = await openFicha();
    const row = await within(dialog).findByTestId("equivalencia-item");
    const select = within(row).getByLabelText("Nível equivalente a Corda Verde e Amarela");
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(3));
    fireEvent.change(select, { target: { value: "10" } });
    fireEvent.click(within(row).getByRole("button", { name: "Só declarar equivalência" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ fromLevelId: 2, toLevelId: 10 });
  });

  it("corda já reconhecida mostra o selo e não oferece os botões", async () => {
    loginAs("MESTRE");
    mockApi({ ...routes(), "GET /graduations/equivalences/suggestions": () => json(200, [{ ...SUGGESTION, recognized: true }]) });
    const dialog = await openFicha();
    const row = await within(dialog).findByTestId("equivalencia-item");
    expect(row).toHaveTextContent("Reconhecida");
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
  });

  it("erro do backend (INVALID_TO_LEVEL) aparece na linha", async () => {
    loginAs("MESTRE");
    mockApi({ ...routes(), "POST /graduations/equivalences": () => json(400, { code: "INVALID_TO_LEVEL", message: "x" }) });
    const dialog = await openFicha();
    const row = await within(dialog).findByTestId("equivalencia-item");
    const select = within(row).getByLabelText("Nível equivalente a Corda Verde e Amarela");
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(3));
    fireEvent.click(within(row).getByRole("button", { name: "Reconhecer" }));
    expect(await within(row).findByRole("alert")).toHaveTextContent("Escolha um nível que pertença a um sistema de graduação do seu grupo.");
  });
});
