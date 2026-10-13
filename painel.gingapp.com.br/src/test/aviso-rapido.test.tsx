import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, loginAs } from "./login-as";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { FloatingActions } from "@/components/painel/floating-actions";
import { QuickNotice } from "@/modules/avisos/aviso-rapido";
import { QuickAttendance } from "@/modules/frequencia/chamada-rapida";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string; body: unknown };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const audiences = {
  units: [
    { id: 7, name: "Sede Centro" },
    { id: 8, name: "Filial Norte" },
  ],
  classes: [
    { id: 21, name: "Infantil", unitId: 7 },
    { id: 22, name: "Adulto", unitId: 8 },
  ],
  roles: ["ALUNO", "PROFESSOR"],
};
const studentList = [
  { id: 1, name: "Ana Souza", status: "ACTIVE", photo: null },
  { id: 2, name: "Beto Lima", status: "ACTIVE", photo: null },
];

function setup(opts: { sendStatus?: number; sendBody?: unknown } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const path = input.replace(/^.*\/api/, "").split("?")[0]!;
      calls.push({ method, path, body: init.body ? JSON.parse(init.body as string) : undefined });
      if (method === "GET" && path === "/notifications/audiences") return Promise.resolve(json(200, audiences));
      if (method === "GET" && path === "/students") return Promise.resolve(json(200, studentList, { "X-Total-Count": "2" }));
      if (method === "POST" && path === "/notifications/send")
        return Promise.resolve(json(opts.sendStatus ?? 201, opts.sendBody ?? { sent: 5, announcementId: null }));
      return Promise.resolve(json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <QuickNotice />
    </QueryClientProvider>,
  );
  return calls;
}

beforeEach(() => loginAs("PROFESSOR"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

const fab = () => screen.findByRole("button", { name: "Aviso rápido" });
const sends = (calls: Call[]) => calls.filter((c) => c.method === "POST" && c.path === "/notifications/send");

async function openPanel() {
  fireEvent.click(await fab());
  return screen.findByRole("dialog", { name: "Aviso rápido" });
}
function fillMessage(dialog: HTMLElement, title = "Treino cancelado", body = "Hoje não haverá treino.") {
  fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: title } });
  fireEvent.change(within(dialog).getByLabelText("Mensagem"), { target: { value: body } });
}

describe("Aviso rápido (botão flutuante)", () => {
  it("aparece para quem tem announcements:create (MESTRE, PROFESSOR, INSTRUTOR) e NÃO para MONITOR/ALUNO", async () => {
    for (const role of ["MESTRE", "PROFESSOR", "INSTRUTOR"] as const) {
      loginAs(role);
      setup();
      expect(await fab()).toBeInTheDocument();
      cleanup();
    }
    for (const role of ["MONITOR", "ALUNO"] as const) {
      loginAs(role);
      const calls = setup();
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.queryByRole("button", { name: "Aviso rápido" })).not.toBeInTheDocument();
      expect(calls).toHaveLength(0);
      cleanup();
    }
  });

  it("abre o painel acessível, com contadores, pré-visualização e Enviar desabilitado até validar", async () => {
    setup();
    const dialog = await openPanel();
    const send = within(dialog).getByRole("button", { name: "Enviar" });
    expect(send).toBeDisabled();
    expect(within(dialog).getByText("0/80")).toBeInTheDocument();
    expect(within(dialog).getByText("0/280")).toBeInTheDocument();

    // título curto demais (1 caractere) -> continua desabilitado e explica
    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "A" } });
    fireEvent.change(within(dialog).getByLabelText("Mensagem"), { target: { value: "Olá, turma." } });
    expect(send).toBeDisabled();
    expect(within(dialog).getByText(/Título de 2 a 80/)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "Aviso" } });
    expect(send).toBeEnabled();
    expect(within(dialog).getByText("5/80")).toBeInTheDocument();
    const preview = within(dialog).getByTestId("quick-notice-preview");
    expect(preview).toHaveTextContent("Aviso");
    expect(preview).toHaveTextContent("Olá, turma.");

    // mensagem acima de 280 -> desabilita
    fireEvent.change(within(dialog).getByLabelText("Mensagem"), { target: { value: "x".repeat(281) } });
    expect(send).toBeDisabled();
  });

  it("fecha com o X e com Esc", async () => {
    setup();
    const dialog = await openPanel();
    fireEvent.click(within(dialog).getByRole("button", { name: "Fechar aviso rápido" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await openPanel();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Todo o grupo: POST /notifications/send com título/mensagem aparados, toast 'Enviado para N pessoas' e limpa o formulário", async () => {
    const calls = setup();
    const dialog = await openPanel();
    fillMessage(dialog, "  Treino cancelado ", " Hoje não haverá treino. ");
    fireEvent.click(within(dialog).getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Enviado para 5 pessoas."));
    expect(sends(calls)).toHaveLength(1);
    expect(sends(calls)[0]!.body).toEqual({
      title: "Treino cancelado",
      body: "Hoje não haverá treino.",
      audience: { scope: "GROUP" },
    });
    // fecha ao enviar e, reaberto, está limpo
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const again = await openPanel();
    expect(within(again).getByLabelText("Título")).toHaveValue("");
    expect(within(again).getByLabelText("Mensagem")).toHaveValue("");
  });

  it("Unidade, Turma e Perfil: exigem a escolha e enviam unitId / classId / audienceRole", async () => {
    const calls = setup();
    const dialog = await openPanel();
    fillMessage(dialog);
    const send = within(dialog).getByRole("button", { name: "Enviar" });
    const scope = within(dialog).getByLabelText("Alcance");

    fireEvent.change(scope, { target: { value: "UNIT" } });
    expect(send).toBeDisabled(); // falta a unidade
    fireEvent.change(await within(dialog).findByLabelText("Unidade"), { target: { value: "8" } });
    fireEvent.click(send);
    await waitFor(() => expect(sends(calls)).toHaveLength(1));
    expect(sends(calls)[0]!.body).toMatchObject({ audience: { scope: "UNIT", unitId: 8 } });

    cleanup();
    const calls2 = setup();
    const d2 = await openPanel();
    fillMessage(d2);
    fireEvent.change(within(d2).getByLabelText("Alcance"), { target: { value: "CLASS" } });
    fireEvent.change(await within(d2).findByLabelText("Turma"), { target: { value: "21" } });
    fireEvent.click(within(d2).getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(sends(calls2)).toHaveLength(1));
    expect(sends(calls2)[0]!.body).toMatchObject({ audience: { scope: "CLASS", classId: 21 } });

    cleanup();
    const calls3 = setup();
    const d3 = await openPanel();
    fillMessage(d3);
    fireEvent.change(within(d3).getByLabelText("Alcance"), { target: { value: "ROLE" } });
    fireEvent.change(await within(d3).findByLabelText("Perfil"), { target: { value: "PROFESSOR" } });
    fireEvent.click(within(d3).getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(sends(calls3)).toHaveLength(1));
    expect(sends(calls3)[0]!.body).toMatchObject({ audience: { scope: "ROLE", audienceRole: "PROFESSOR" } });
  });

  it("Alunos específicos: escolhe vários na busca (chips removíveis) e envia studentIds", async () => {
    const calls = setup();
    const dialog = await openPanel();
    fillMessage(dialog);
    fireEvent.change(within(dialog).getByLabelText("Alcance"), { target: { value: "STUDENTS" } });
    const send = within(dialog).getByRole("button", { name: "Enviar" });
    expect(send).toBeDisabled(); // nenhum aluno
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Ana Souza/ }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Beto Lima/ }));
    const chips = within(dialog).getByTestId("student-multi-chips");
    expect(within(chips).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(within(chips).getByRole("button", { name: "Remover Beto Lima" }));
    expect(within(chips).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Beto Lima/ }));
    fireEvent.click(send);
    await waitFor(() => expect(sends(calls)).toHaveLength(1));
    expect(sends(calls)[0]!.body).toMatchObject({ audience: { scope: "STUDENTS", studentIds: [1, 2] } });
  });

  it("'Publicar também no mural' envia alsoPublish:true e avisa que foi publicado; desligado, nem envia o campo", async () => {
    const calls = setup({ sendBody: { sent: 1, announcementId: 99 } });
    const dialog = await openPanel();
    fillMessage(dialog);
    fireEvent.click(within(dialog).getByRole("switch", { name: "Publicar também no mural de comunicados" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(sends(calls)).toHaveLength(1));
    expect(sends(calls)[0]!.body).toEqual({
      title: "Treino cancelado",
      body: "Hoje não haverá treino.",
      audience: { scope: "GROUP" },
      alsoPublish: true,
    });
    expect(toast.success).toHaveBeenCalledWith("Enviado para 1 pessoa e publicado no mural.");
  });

  it("NO_RECIPIENTS: mostra 'Ninguém neste alcance', mantém o texto e não fecha", async () => {
    setup({ sendStatus: 400, sendBody: { code: "NO_RECIPIENTS", message: "Sem destinatários." } });
    const dialog = await openPanel();
    fillMessage(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Enviar" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Ninguém neste alcance");
    expect(within(dialog).getByLabelText("Título")).toHaveValue("Treino cancelado");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("403: mostra a mensagem de falta de permissão", async () => {
    setup({ sendStatus: 403, sendBody: { message: "Forbidden" } });
    const dialog = await openPanel();
    fillMessage(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Enviar" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Você não tem permissão para enviar avisos");
  });
});

describe("Pilha de botões flutuantes", () => {
  it("mostra Chamada rápida e Aviso rápido juntos numa mesma pilha (coluna, sem sobreposição) e sem o aviso para MONITOR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json(200, []))),
    );
    const view = () =>
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <FloatingActions>
            <QuickAttendance />
            <QuickNotice />
          </FloatingActions>
        </QueryClientProvider>,
      );
    view();
    const stack = screen.getByTestId("floating-actions");
    const chamada = await within(stack).findByRole("button", { name: /Chamada rápida/ });
    const aviso = within(stack).getByRole("button", { name: "Aviso rápido" });
    expect(stack.className).toMatch(/flex-col-reverse/); // um acima do outro: nunca no mesmo ponto
    expect(stack.className).toMatch(/fixed/);
    expect(stack.className).toMatch(/safe-area-inset-bottom/);
    expect(stack.className).toMatch(/gap-3/);
    expect(Array.from(stack.children)).toEqual([chamada, aviso]); // 1º filho = base da pilha
    cleanup();

    loginAs("MONITOR");
    view();
    const only = screen.getByTestId("floating-actions");
    await within(only).findByRole("button", { name: /Chamada rápida/ });
    expect(within(only).queryByRole("button", { name: "Aviso rápido" })).not.toBeInTheDocument();
  });
});
