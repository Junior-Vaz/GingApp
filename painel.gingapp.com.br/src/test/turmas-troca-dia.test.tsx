import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, loginAs } from "./login-as";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { AulasPage } from "@/modules/aulas/aulas-page";
import { TurmasPage } from "@/modules/turmas/turmas-page";
import {
  WEEKDAY_CHANGE_WARNING,
  lessonsSyncMessage,
  shouldWarnWeekdayChange,
} from "@/modules/turmas/lessons-sync";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string; query: URLSearchParams; body: unknown };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const page = <T,>(rows: T[]) => json(200, rows, { "X-Total-Count": String(rows.length) });

const base = { unitId: null, description: null, teacherUserId: null, startTime: "18:00", endTime: "19:00" };
const classes = [
  { ...base, id: 1, name: "Infantil", weekday: 3, status: "ACTIVE", autoGenerateLessons: true }, // quarta, contínua
  { ...base, id: 2, name: "Sem dia", weekday: null, status: "ACTIVE", autoGenerateLessons: true },
  { ...base, id: 3, name: "Manual", weekday: 4, status: "ACTIVE", autoGenerateLessons: false },
  { ...base, id: 4, name: "Antiga", weekday: 4, status: "INACTIVE", autoGenerateLessons: true },
];

function mockApi(routes: Record<string, (call: Call) => Response> = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const [path = "", search = ""] = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
      const method = init.method ?? "GET";
      const call: Call = { method, path, query: new URLSearchParams(search), body: init.body ? JSON.parse(init.body as string) : undefined };
      calls.push(call);
      const handler = routes[`${method} ${path}`];
      if (handler) return Promise.resolve(handler(call));
      if (method === "GET" && path === "/classes") return Promise.resolve(page(classes));
      if (method === "GET" && path === "/teachers") return Promise.resolve(page([]));
      if (method === "GET" && path === "/units") return Promise.resolve(page([]));
      if (method === "GET" && path === "/lessons") return Promise.resolve(page([]));
      return Promise.resolve(json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
  return calls;
}

function renderUi(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Abre o "Editar" da turma `index` (ordem do fixture) e espera o formulário carregar. */
async function openEdit(index: number, name: string) {
  await screen.findByText(name);
  fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[index]!);
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(within(dialog).getByLabelText("Nome")).toHaveValue(name));
  return dialog;
}

const warning = () => screen.queryByTestId("weekday-change-warning");
const setWeekday = (dialog: HTMLElement, value: string) =>
  fireEvent.change(within(dialog).getByLabelText("Dia da semana"), { target: { value } });

beforeEach(() => {
  loginAs("MESTRE");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("troca de dia: mensagens (helper puro)", () => {
  const sync = (cancelled: number, kept: number, created: number | null) => ({
    cancelled,
    kept,
    created,
    oldWeekday: 3,
    newWeekday: 4,
  });

  it("kept 0 e created número: só o resumo", () => {
    expect(lessonsSyncMessage(sync(8, 0, 9))).toBe("Dia alterado: 8 aulas do dia antigo canceladas, 9 geradas no dia novo.");
  });

  it("kept > 0 e created número: resumo + aviso das mantidas", () => {
    expect(lessonsSyncMessage(sync(8, 2, 9))).toBe(
      "Dia alterado: 8 aulas do dia antigo canceladas, 9 geradas no dia novo. 2 aulas do dia antigo foram mantidas por terem presença, aviso ou observação — revise em Aulas.",
    );
  });

  it("kept 0 e created null: geração em breve", () => {
    expect(lessonsSyncMessage(sync(8, 0, null))).toBe(
      "Dia alterado: 8 aulas do dia antigo canceladas. As novas aulas serão geradas automaticamente em breve.",
    );
  });

  it("kept > 0 e created null: geração em breve + aviso das mantidas", () => {
    expect(lessonsSyncMessage(sync(3, 4, null))).toBe(
      "Dia alterado: 3 aulas do dia antigo canceladas. As novas aulas serão geradas automaticamente em breve. 4 aulas do dia antigo foram mantidas por terem presença, aviso ou observação — revise em Aulas.",
    );
  });

  it("singular e zero concordam em pt-BR", () => {
    expect(lessonsSyncMessage(sync(1, 1, 1))).toBe(
      "Dia alterado: 1 aula do dia antigo cancelada, 1 gerada no dia novo. 1 aula do dia antigo foi mantida por ter presença, aviso ou observação — revise em Aulas.",
    );
    expect(lessonsSyncMessage(sync(0, 0, 0))).toBe("Dia alterado: 0 aulas do dia antigo canceladas, 0 geradas no dia novo.");
  });
});

describe("troca de dia: quando o aviso aparece (helper puro)", () => {
  const ok = { isEdit: true, originalWeekday: 3 as number | null, newWeekday: "4", autoGenerateLessons: true, status: "ACTIVE" as const };

  it("só na edição, de um dia para OUTRO dia, com contínuo ligado e turma ativa", () => {
    expect(shouldWarnWeekdayChange(ok)).toBe(true);
    expect(shouldWarnWeekdayChange({ ...ok, newWeekday: "0" })).toBe(true); // domingo é dia válido
    expect(shouldWarnWeekdayChange({ ...ok, originalWeekday: 0, newWeekday: "6" })).toBe(true);
  });

  it("não avisa nos demais casos", () => {
    expect(shouldWarnWeekdayChange({ ...ok, isEdit: false })).toBe(false);
    expect(shouldWarnWeekdayChange({ ...ok, newWeekday: "3" })).toBe(false); // mesmo dia
    expect(shouldWarnWeekdayChange({ ...ok, newWeekday: "" })).toBe(false); // limpou o dia
    expect(shouldWarnWeekdayChange({ ...ok, newWeekday: undefined })).toBe(false);
    expect(shouldWarnWeekdayChange({ ...ok, originalWeekday: null })).toBe(false); // não tinha dia
    expect(shouldWarnWeekdayChange({ ...ok, originalWeekday: undefined })).toBe(false);
    expect(shouldWarnWeekdayChange({ ...ok, autoGenerateLessons: false })).toBe(false);
    expect(shouldWarnWeekdayChange({ ...ok, autoGenerateLessons: undefined })).toBe(false);
    expect(shouldWarnWeekdayChange({ ...ok, status: "INACTIVE" })).toBe(false);
  });
});

describe("Turmas: aviso de troca de dia no formulário", () => {
  it("aparece ao mudar o dia numa turma com aulas contínuas e some ao voltar ao dia original", async () => {
    mockApi();
    renderUi(<TurmasPage />);
    const dialog = await openEdit(0, "Infantil");
    expect(warning()).toBeNull(); // recém aberto: nada mudou

    setWeekday(dialog, "4");
    expect(await screen.findByTestId("weekday-change-warning")).toHaveTextContent(WEEKDAY_CHANGE_WARNING);

    setWeekday(dialog, "3");
    await waitFor(() => expect(warning()).toBeNull());
  });

  it("não aparece ao limpar o dia, ao desligar 'Contínuo' nem ao marcar a turma Inativa; volta ao religar", async () => {
    mockApi();
    renderUi(<TurmasPage />);
    const dialog = await openEdit(0, "Infantil");

    setWeekday(dialog, "");
    await waitFor(() => expect(warning()).toBeNull());

    setWeekday(dialog, "5");
    expect(await screen.findByTestId("weekday-change-warning")).toBeInTheDocument();

    const sw = within(dialog).getByRole("switch", { name: "Contínuo (sem data final)" });
    fireEvent.click(sw); // desliga
    await waitFor(() => expect(warning()).toBeNull());
    fireEvent.click(sw); // religa
    expect(await screen.findByTestId("weekday-change-warning")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Status"), { target: { value: "INACTIVE" } });
    await waitFor(() => expect(warning()).toBeNull());
  });

  it("não aparece em turma que não tinha dia, em turma sem 'Contínuo', em turma inativa nem em 'Nova turma'", async () => {
    mockApi();
    renderUi(<TurmasPage />);

    // Sem dia antes: definir um dia não cancela nada.
    let dialog = await openEdit(1, "Sem dia");
    setWeekday(dialog, "4");
    await waitFor(() => expect(within(dialog).getByLabelText("Dia da semana")).toHaveValue("4"));
    expect(warning()).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Contínuo desligado: o dono gerencia as aulas à mão.
    dialog = await openEdit(2, "Manual");
    setWeekday(dialog, "6");
    await waitFor(() => expect(within(dialog).getByLabelText("Dia da semana")).toHaveValue("6"));
    expect(warning()).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Turma inativa.
    dialog = await openEdit(3, "Antiga");
    setWeekday(dialog, "6");
    await waitFor(() => expect(within(dialog).getByLabelText("Dia da semana")).toHaveValue("6"));
    expect(warning()).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Criação.
    fireEvent.click(screen.getByRole("button", { name: /Nova turma/ }));
    dialog = await screen.findByRole("dialog");
    setWeekday(dialog, "2");
    await waitFor(() => expect(within(dialog).getByLabelText("Dia da semana")).toHaveValue("2"));
    expect(warning()).toBeNull();
  });
});

describe("Turmas: salvar a troca de dia", () => {
  it("o PATCH envia o mesmo corpo de sempre (só o weekday muda) e NÃO envia lessonsSync", async () => {
    const calls = mockApi({ "PATCH /classes/1": () => json(200, { ...classes[0] }) });
    renderUi(<TurmasPage />);

    // Salvar sem mexer no dia (referência do corpo "de hoje").
    let dialog = await openEdit(0, "Infantil");
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Salvar trocando o dia.
    dialog = await openEdit(0, "Infantil");
    setWeekday(dialog, "4");
    await screen.findByTestId("weekday-change-warning");
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(2));

    const [without, withChange] = calls.filter((c) => c.method === "PATCH") as [Call, Call];
    expect(without.path).toBe("/classes/1");
    expect(withChange.path).toBe("/classes/1");
    expect(without.body).toMatchObject({ weekday: 3 });
    expect(withChange.body).toEqual({ ...(without.body as object), weekday: 4 });
    expect(withChange.body).not.toHaveProperty("lessonsSync");
  });

  it("com lessonsSync (kept > 0, created número): toast 'Turma atualizada.' + resumo com as mantidas", async () => {
    mockApi({
      "PATCH /classes/1": () =>
        json(200, { ...classes[0], weekday: 4, lessonsSync: { cancelled: 8, kept: 1, created: 9, oldWeekday: 3, newWeekday: 4 } }),
    });
    renderUi(<TurmasPage />);
    const dialog = await openEdit(0, "Infantil");
    setWeekday(dialog, "4");
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Dia alterado: 8 aulas do dia antigo canceladas, 9 geradas no dia novo. 1 aula do dia antigo foi mantida por ter presença, aviso ou observação — revise em Aulas.",
      ),
    );
    expect(toast.success).toHaveBeenCalledWith("Turma atualizada.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("com lessonsSync (kept 0, created null): 'geradas automaticamente em breve'", async () => {
    mockApi({
      "PATCH /classes/1": () =>
        json(200, { ...classes[0], weekday: 4, lessonsSync: { cancelled: 5, kept: 0, created: null, oldWeekday: 3, newWeekday: 4 } }),
    });
    renderUi(<TurmasPage />);
    const dialog = await openEdit(0, "Infantil");
    setWeekday(dialog, "4");
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Dia alterado: 5 aulas do dia antigo canceladas. As novas aulas serão geradas automaticamente em breve.",
      ),
    );
    expect(toast.success).toHaveBeenCalledWith("Turma atualizada.");
  });

  it("sem lessonsSync: só o toast de sempre, nada de 'Dia alterado'", async () => {
    mockApi({ "PATCH /classes/1": () => json(200, { ...classes[0], weekday: 4 }) });
    renderUi(<TurmasPage />);
    const dialog = await openEdit(0, "Infantil");
    setWeekday(dialog, "4");
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Turma atualizada."));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("erro no PATCH: toast de erro, sem mensagem de troca de dia, formulário aberto", async () => {
    mockApi({ "PATCH /classes/1": () => json(400, { message: "Dia inválido." }) });
    renderUi(<TurmasPage />);
    const dialog = await openEdit(0, "Infantil");
    setWeekday(dialog, "4");
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Dia inválido."));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("depois de salvar, recarrega a lista de turmas ('Próxima aula') e as aulas", async () => {
    const calls = mockApi({
      "PATCH /classes/1": () =>
        json(200, { ...classes[0], weekday: 4, lessonsSync: { cancelled: 1, kept: 0, created: 1, oldWeekday: 3, newWeekday: 4 } }),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AulasPage />
        <TurmasPage />
      </QueryClientProvider>,
    );
    const count = (path: string) => calls.filter((c) => c.method === "GET" && c.path === path).length;
    await screen.findByText("Infantil");
    await waitFor(() => expect(count("/lessons")).toBeGreaterThan(0));
    const classesBefore = count("/classes");
    const lessonsBefore = count("/lessons");

    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Nome")).toHaveValue("Infantil"));
    setWeekday(dialog, "4");
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(count("/classes")).toBeGreaterThan(classesBefore));
    await waitFor(() => expect(count("/lessons")).toBeGreaterThan(lessonsBefore));
  });
});
