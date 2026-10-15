import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, loginAs } from "./login-as";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { QuickNotice } from "@/modules/avisos/aviso-rapido";
import { splitLeadingEmoji, templateTitle } from "@/modules/avisos/aviso-api";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string; body: unknown };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const BUILTIN = { id: "builtin:rain", title: "Treino cancelado por chuva", body: "Por causa da chuva, o treino de hoje está cancelado.", emoji: "🌧️", sortOrder: 0, builtin: true };
const mine = (id: number, title: string, sortOrder: number) => ({ id, title, body: `Texto de ${title}`, emoji: null, sortOrder, builtin: false });

function setup(initial = [mine(5, "Reunião de pais", 0), mine(6, "Roda de sábado", 1), BUILTIN]) {
  const calls: Call[] = [];
  let templates = [...initial];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const path = input.replace(/^.*\/api/, "").split("?")[0]!;
      const body = init.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ method, path, body });
      if (method === "GET" && path === "/notifications/audiences")
        return Promise.resolve(json(200, { units: [], classes: [], roles: ["ALUNO"], groupWide: true }));
      if (method === "GET" && path === "/notifications/quick-templates") return Promise.resolve(json(200, templates));
      if (method === "POST" && path === "/notifications/quick-templates") {
        const created = { id: 99, emoji: null, sortOrder: 2, builtin: false, ...body };
        templates = [...templates.filter((t) => !t.builtin), created, ...templates.filter((t) => t.builtin)];
        return Promise.resolve(json(201, created));
      }
      const one = /^\/notifications\/quick-templates\/(\d+)$/.exec(path);
      if (one && method === "DELETE") {
        templates = templates.filter((t) => String(t.id) !== one[1]);
        return Promise.resolve(json(200, { id: Number(one[1]) }));
      }
      if (one && method === "PATCH") return Promise.resolve(json(200, { id: Number(one[1]), ...body }));
      if (method === "POST" && path === "/notifications/send") return Promise.resolve(json(201, { sent: 4, announcementId: null }));
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

async function openPanel() {
  fireEvent.click(await screen.findByRole("button", { name: "Aviso rápido" }));
  return screen.findByRole("dialog", { name: "Aviso rápido" });
}
const writes = (calls: Call[], path: string, method: string) => calls.filter((c) => c.method === method && c.path === path);

describe("Aviso rápido: modelos (professor só USA)", () => {
  it("mostra os modelos em faixa rolável na horizontal; tocar PREENCHE título e mensagem e leva o foco ao Enviar", async () => {
    setup();
    const dialog = await openPanel();
    const strip = await within(dialog).findByTestId("quick-notice-templates");
    const list = within(strip).getByRole("list", { name: "Modelos de aviso" });
    expect(list.className).toMatch(/overflow-x-auto/); // rolagem horizontal dentro da faixa, não na página
    const chips = within(list).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual(["Reunião de pais", "Roda de sábado", "🌧️ Treino cancelado por chuva"]);
    expect(chips.every((c) => c.parentElement?.className.includes("shrink-0"))).toBe(true);

    fireEvent.click(within(list).getByRole("button", { name: /Treino cancelado por chuva/ }));
    expect(within(dialog).getByLabelText("Título")).toHaveValue("🌧️ Treino cancelado por chuva");
    expect(within(dialog).getByLabelText("Mensagem")).toHaveValue(BUILTIN.body);
    expect(within(list).getByRole("button", { name: /Treino cancelado por chuva/ })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Enviar" })).toHaveFocus());
    // continua editável
    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "Treino cancelado hoje" } });
    expect(within(list).getByRole("button", { name: /Treino cancelado por chuva/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("professor NÃO vê 'Gerenciar modelos' nem 'Salvar como modelo'", async () => {
    setup();
    const dialog = await openPanel();
    await within(dialog).findByTestId("quick-notice-templates");
    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "Aviso novo" } });
    fireEvent.change(within(dialog).getByLabelText("Mensagem"), { target: { value: "Texto do aviso novo." } });
    expect(within(dialog).queryByRole("button", { name: "Gerenciar modelos" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Salvar como modelo/ })).not.toBeInTheDocument();
  });

  it("'Enviar já' pede confirmação de 1 toque e então envia o modelo para o alcance escolhido", async () => {
    const calls = setup();
    const dialog = await openPanel();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Roda de sábado" }));
    expect(writes(calls, "/notifications/send", "POST")).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: /Enviar já/ }));
    expect(within(dialog).getByText("Enviar agora para todo o grupo?")).toBeInTheDocument();
    expect(writes(calls, "/notifications/send", "POST")).toHaveLength(0); // ainda não enviou
    fireEvent.click(within(dialog).getByRole("button", { name: "Sim, enviar" }));

    await waitFor(() => expect(writes(calls, "/notifications/send", "POST")).toHaveLength(1));
    expect(writes(calls, "/notifications/send", "POST")[0]!.body).toEqual({
      title: "Roda de sábado",
      body: "Texto de Roda de sábado",
      audience: { scope: "GROUP" },
    });
    expect(toast.success).toHaveBeenCalledWith("Enviado para 4 pessoas.");
  });

  it("'Enviar já' pode ser cancelado sem enviar nada", async () => {
    const calls = setup();
    const dialog = await openPanel();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Roda de sábado" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Enviar já/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(within(dialog).getByRole("button", { name: /Enviar já/ })).toBeInTheDocument();
    expect(writes(calls, "/notifications/send", "POST")).toHaveLength(0);
  });

  it("se a lista de modelos falhar, a faixa some e o aviso manual continua funcionando", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json(500, { message: "erro" }))),
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <QuickNotice />
      </QueryClientProvider>,
    );
    const dialog = await openPanel();
    await waitFor(() => expect(within(dialog).queryByTestId("quick-notice-templates")).not.toBeInTheDocument());
    expect(within(dialog).getByLabelText("Título")).toBeInTheDocument();
  });
});

describe("Aviso rápido: modelos (MESTRE gerencia)", () => {
  beforeEach(() => loginAs("MESTRE"));

  it("'Salvar como modelo' chama POST /notifications/quick-templates com título/mensagem aparados e atualiza a faixa", async () => {
    const calls = setup();
    const dialog = await openPanel();
    await within(dialog).findByTestId("quick-notice-templates");
    const save = within(dialog).getByRole("button", { name: /Salvar como modelo/ });
    expect(save).toBeDisabled(); // nada digitado
    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "  Aula extra amanhã " } });
    fireEvent.change(within(dialog).getByLabelText("Mensagem"), { target: { value: " Teremos aula extra amanhã às 19h. " } });
    fireEvent.click(save);

    await waitFor(() => expect(writes(calls, "/notifications/quick-templates", "POST")).toHaveLength(1));
    expect(writes(calls, "/notifications/quick-templates", "POST")[0]!.body).toEqual({
      title: "Aula extra amanhã",
      body: "Teremos aula extra amanhã às 19h.",
    });
    expect(toast.success).toHaveBeenCalledWith("Modelo salvo.");
    // a lista foi invalidada e relida: o novo modelo aparece na faixa
    expect(await within(dialog).findByRole("button", { name: "Aula extra amanhã" })).toBeInTheDocument();
    expect(writes(calls, "/notifications/quick-templates", "GET").length).toBeGreaterThanOrEqual(2);
  });

  it("emoji no começo do título vira o ícone do modelo (campo emoji)", async () => {
    const calls = setup();
    const dialog = await openPanel();
    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "🥋 Treino especial" } });
    fireEvent.change(within(dialog).getByLabelText("Mensagem"), { target: { value: "Treino especial no sábado." } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Salvar como modelo/ }));
    await waitFor(() => expect(writes(calls, "/notifications/quick-templates", "POST")).toHaveLength(1));
    expect(writes(calls, "/notifications/quick-templates", "POST")[0]!.body).toEqual({
      title: "Treino especial",
      body: "Treino especial no sábado.",
      emoji: "🥋",
    });
  });

  it("Gerenciar modelos: cria, edita, reordena, apaga com confirmação na linha e duplica um padrão", async () => {
    const calls = setup();
    const dialog = await openPanel();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Gerenciar modelos" }));
    const manager = await within(dialog).findByTestId("quick-notice-manager");
    expect(within(manager).getAllByTestId("own-template")).toHaveLength(2);
    expect(within(manager).getAllByTestId("builtin-template")).toHaveLength(1);
    // padrão: sem editar/apagar, só duplicar
    expect(within(manager).queryByRole("button", { name: /Editar Treino cancelado/ })).not.toBeInTheDocument();
    expect(within(manager).queryByRole("button", { name: /Apagar Treino cancelado/ })).not.toBeInTheDocument();

    // criar
    fireEvent.click(within(manager).getByRole("button", { name: /Novo modelo/ }));
    fireEvent.change(within(manager).getByLabelText("Título do modelo"), { target: { value: "Prova de faixa" } });
    fireEvent.change(within(manager).getByLabelText("Mensagem do modelo"), { target: { value: "A prova de faixa será no dia 20." } });
    fireEvent.click(within(manager).getByRole("button", { name: "Salvar modelo" }));
    await waitFor(() => expect(writes(calls, "/notifications/quick-templates", "POST")).toHaveLength(1));
    expect(writes(calls, "/notifications/quick-templates", "POST")[0]!.body).toEqual({
      title: "Prova de faixa",
      body: "A prova de faixa será no dia 20.",
      emoji: null,
    });
    await waitFor(() => expect(within(manager).getAllByTestId("own-template")).toHaveLength(3));

    // editar
    fireEvent.click(within(manager).getByRole("button", { name: "Editar Reunião de pais" }));
    fireEvent.change(within(manager).getByLabelText("Título do modelo"), { target: { value: "Reunião geral" } });
    fireEvent.click(within(manager).getByRole("button", { name: "Salvar modelo" }));
    await waitFor(() => expect(writes(calls, "/notifications/quick-templates/5", "PATCH")).toHaveLength(1));
    expect(writes(calls, "/notifications/quick-templates/5", "PATCH")[0]!.body).toMatchObject({ title: "Reunião geral" });

    // reordenar: descer o 1º troca as posições dos dois primeiros
    fireEvent.click(within(manager).getByRole("button", { name: "Descer Reunião de pais" }));
    await waitFor(() => expect(writes(calls, "/notifications/quick-templates/6", "PATCH")).toHaveLength(1));
    expect(writes(calls, "/notifications/quick-templates/6", "PATCH")[0]!.body).toEqual({ sortOrder: 0 });
    expect(writes(calls, "/notifications/quick-templates/5", "PATCH").at(-1)!.body).toEqual({ sortOrder: 1 });

    // apagar: 1º toque só pergunta
    fireEvent.click(within(manager).getByRole("button", { name: "Apagar Roda de sábado" }));
    expect(writes(calls, "/notifications/quick-templates/6", "DELETE")).toHaveLength(0);
    expect(within(manager).getByText("Apagar este modelo?")).toBeInTheDocument();
    fireEvent.click(within(manager).getByRole("button", { name: "Sim, apagar" }));
    await waitFor(() => expect(writes(calls, "/notifications/quick-templates/6", "DELETE")).toHaveLength(1));
    await waitFor(() => expect(within(manager).getAllByTestId("own-template")).toHaveLength(2));

    // duplicar o padrão: abre um modelo novo já preenchido (e salva como POST, nunca PATCH no builtin)
    fireEvent.click(within(manager).getByRole("button", { name: "Duplicar Treino cancelado por chuva" }));
    expect(within(manager).getByLabelText("Título do modelo")).toHaveValue("Treino cancelado por chuva");
    expect(within(manager).getByLabelText("Emoji do modelo")).toHaveValue("🌧️");
    fireEvent.click(within(manager).getByRole("button", { name: "Salvar modelo" }));
    await waitFor(() => expect(writes(calls, "/notifications/quick-templates", "POST")).toHaveLength(2));
    expect(writes(calls, "/notifications/quick-templates/builtin:rain", "PATCH")).toHaveLength(0);

    // voltar ao aviso
    fireEvent.click(within(dialog).getByRole("button", { name: "Voltar ao aviso" }));
    expect(await within(dialog).findByLabelText("Título")).toBeInTheDocument();
  });
});

describe("helpers de modelo", () => {
  it("splitLeadingEmoji separa o emoji inicial; templateTitle junta de volta respeitando 80 caracteres", () => {
    expect(splitLeadingEmoji("🥋 Treino hoje")).toEqual({ emoji: "🥋", title: "Treino hoje" });
    expect(splitLeadingEmoji("🌧️ Chuva forte")).toEqual({ emoji: "🌧️", title: "Chuva forte" });
    expect(splitLeadingEmoji("Sem emoji")).toEqual({ emoji: null, title: "Sem emoji" });
    expect(splitLeadingEmoji("🥋")).toEqual({ emoji: null, title: "🥋" });
    expect(templateTitle({ emoji: "🥋", title: "Treino" })).toBe("🥋 Treino");
    expect(templateTitle({ emoji: null, title: "x".repeat(100) })).toHaveLength(80);
  });
});
