import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { PatrocinadoresPage } from "@/modules/patrocinadores";
import { defaultReportRange } from "@/modules/patrocinadores/sponsor-utils";
import { canAccessRoute, navItemsFor } from "@/lib/nav";
import { clearSession, updateSessionUser, type OrgRole } from "@/lib/session";
import { loginAs } from "./login-as";
import {
  CAMPAIGNS,
  REPORT,
  SPONSORS,
  TERMS,
  UPLOADED,
  baseRoutes,
  campaign,
  fileOf,
  json,
  list,
  mockApi,
  renderWithClient,
  sent,
  type Call,
} from "./patrocinadores-fixtures";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SLOW = 30_000; // telas pesadas (Sheet/Dialog do Radix): o gate completo roda sob carga

beforeEach(() => {
  loginAs("MESTRE");
  updateSessionUser({ organizationName: "Grupo Cordão" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  clearSession();
});

const openTab = (name: string) => fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
const dialog = () => screen.getByRole("dialog");

/** Abre a página já com o termo aceito e espera a lista de campanhas. */
async function openCampaigns(routes = baseRoutes()) {
  const calls = mockApi(routes);
  renderWithClient(<PatrocinadoresPage />);
  await screen.findByText("Rascunho promo");
  return calls;
}

describe("acesso: só o MESTRE", () => {
  it("o menu e a rota só existem para o MESTRE (professor, instrutor, monitor, aluno e sem papel não veem nem acessam)", () => {
    expect(navItemsFor("MESTRE").map((i) => i.label)).toContain("Patrocinadores");
    for (const role of ["PROFESSOR", "INSTRUTOR", "MONITOR", "ALUNO", "RESPONSAVEL", undefined] as Array<OrgRole | undefined>) {
      expect(navItemsFor(role).map((i) => i.label), String(role)).not.toContain("Patrocinadores");
      expect(canAccessRoute(role, "/patrocinadores"), String(role)).toBe(false);
    }
    expect(canAccessRoute("MESTRE", "/patrocinadores")).toBe(true);
  });

  it("segunda barreira na própria tela: PROFESSOR vê o aviso e NENHUMA requisição é feita", () => {
    clearSession();
    loginAs("PROFESSOR");
    const calls = mockApi(baseRoutes());
    renderWithClient(<PatrocinadoresPage />);
    expect(screen.getByTestId("patrocinadores-forbidden")).toHaveTextContent("Você não tem permissão para acessar esta área.");
    expect(screen.queryByRole("tab", { name: "Campanhas" })).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it(
    "o item aparece no menu lateral do MESTRE (link /patrocinadores) e não no do PROFESSOR",
    async () => {
      const { AppShell } = await import("@/components/painel/app-shell");
      const { createRouter, createMemoryHistory, RouterProvider, createRootRoute } = await import("@tanstack/react-router");
      const mount = async () => {
        const root = createRootRoute({ component: () => <AppShell>conteúdo</AppShell> });
        const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
        renderWithClient(<RouterProvider router={router} />);
        await screen.findByTestId("painel-main");
        return within(screen.getAllByLabelText("Menu principal")[0]!);
      };
      const mestre = await mount();
      expect(mestre.getByRole("link", { name: /Patrocinadores/ })).toHaveAttribute("href", "/patrocinadores");
      document.body.innerHTML = "";
      clearSession();
      loginAs("PROFESSOR");
      const prof = await mount();
      expect(prof.queryByRole("link", { name: /Patrocinadores/ })).not.toBeInTheDocument();
    },
    SLOW,
  );
});

describe("termo de responsabilidade", () => {
  const pending = { ...TERMS, accepted: false, acceptedAt: null };

  it(
    "sem aceite: abre na aba Termo com o texto completo; o botão só habilita com 'Li e aceito' e o aceite manda { version }",
    async () => {
      let accepted = false;
      const calls = mockApi(
        baseRoutes({
          "GET /group-sponsors/terms": () => json(200, accepted ? TERMS : pending),
          "POST /group-sponsors/terms/accept": () => {
            accepted = true;
            return json(201, {});
          },
        }),
      );
      renderWithClient(<PatrocinadoresPage />);
      const text = await screen.findByTestId("terms-text");
      expect(text).toHaveTextContent("Eu respondo pelo conteúdo.");
      expect(text).toHaveTextContent("Não anuncio bebidas alcoólicas.");
      expect(screen.getByTestId("terms-version")).toHaveTextContent("2026-11-v1");
      expect(screen.getByTestId("terms-pending-alert")).toBeInTheDocument();

      const button = screen.getByRole("button", { name: "Aceitar o termo" });
      expect(button).toBeDisabled();
      fireEvent.click(screen.getByLabelText(/Li e aceito o termo de responsabilidade/));
      expect(button).toBeEnabled();
      fireEvent.click(button);

      await waitFor(() => expect(sent(calls, "POST", "/group-sponsors/terms/accept")).toHaveLength(1));
      expect(sent(calls, "POST", "/group-sponsors/terms/accept")[0]?.body).toEqual({ version: "2026-11-v1" });
      // Depois do aceite a tela segue para Campanhas (já com o termo vigente aceito: o aviso de pendência some e 'Ativar' libera).
      expect(await screen.findByText("Rascunho promo")).toBeInTheDocument();
      expect(screen.queryByTestId("terms-pending-alert")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Ativar Rascunho promo" })).toBeEnabled();
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Termo aceito"));
      openTab("Termo");
      expect(await screen.findByTestId("terms-accepted")).toBeInTheDocument();
    },
    SLOW,
  );

  it(
    "sem aceite o resto fica em leitura: as campanhas aparecem, 'Ativar' fica desabilitado com explicação e nunca chama a API",
    async () => {
      const calls = await openCampaignsWith({ "GET /group-sponsors/terms": () => json(200, pending) });
      openTab("Campanhas");
      const activate = await screen.findByRole("button", { name: "Ativar Rascunho promo" });
      expect(activate).toBeDisabled();
      expect(screen.getByTestId("activate-reason")).toHaveTextContent("Aceite o termo de responsabilidade (aba Termo) para ativar campanhas.");
      expect(activate).toHaveAccessibleDescription(/Aceite o termo/);
      fireEvent.click(activate);
      expect(sent(calls, "POST", "/group-sponsor-campaigns/1/activate")).toHaveLength(0);
      // Retomar/pausar não dependem do aceite no painel (o servidor decide); o resto da tela segue utilizável
      expect(screen.getByRole("button", { name: "Pausar No ar promo" })).toBeEnabled();
    },
    SLOW,
  );

  it(
    "409 TERMS_VERSION_MISMATCH: recarrega o termo (nova versão), desmarca 'Li e aceito' e avisa",
    async () => {
      let version = "2026-11-v1";
      const calls = mockApi(
        baseRoutes({
          "GET /group-sponsors/terms": () => json(200, { ...pending, version, text: `Texto da ${version}` }),
          "POST /group-sponsors/terms/accept": () => {
            version = "2026-12-v2";
            return json(409, { code: "TERMS_VERSION_MISMATCH", message: "versão diferente" });
          },
        }),
      );
      renderWithClient(<PatrocinadoresPage />);
      await screen.findByText("Texto da 2026-11-v1");
      fireEvent.click(screen.getByLabelText(/Li e aceito/));
      fireEvent.click(screen.getByRole("button", { name: "Aceitar o termo" }));
      expect(await screen.findByText("Texto da 2026-12-v2")).toBeInTheDocument();
      expect(sent(calls, "GET", "/group-sponsors/terms").length).toBeGreaterThanOrEqual(2);
      expect(screen.getByTestId("terms-version")).toHaveTextContent("2026-12-v2");
      expect(screen.getByLabelText(/Li e aceito/)).not.toBeChecked();
      expect(screen.getByRole("button", { name: "Aceitar o termo" })).toBeDisabled();
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("termo foi atualizado"));
    },
    SLOW,
  );

  it("termo já aceito na versão vigente: mostra a data do aceite e não pede de novo", async () => {
    mockApi(baseRoutes());
    renderWithClient(<PatrocinadoresPage />);
    await screen.findByText("Rascunho promo");
    openTab("Termo");
    expect(await screen.findByTestId("terms-accepted")).toBeInTheDocument();
    expect(screen.getByText(/aceito em 02\/11\/2026 12:30/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aceitar o termo" })).not.toBeInTheDocument();
  });

  it("falha ao carregar o termo: erro com 'Tentar novamente' e 'Ativar' continua travado", async () => {
    let ok = false;
    mockApi(baseRoutes({ "GET /group-sponsors/terms": () => (ok ? json(200, TERMS) : json(500, { message: "falhou" })) }));
    renderWithClient(<PatrocinadoresPage />);
    await screen.findByText("Rascunho promo");
    expect(screen.getByRole("button", { name: "Ativar Rascunho promo" })).toBeDisabled();
    openTab("Termo");
    expect(await screen.findByTestId("terms-error")).toHaveTextContent("falhou");
    ok = true;
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByTestId("terms-accepted")).toBeInTheDocument();
  });
});

/** Como openCampaigns, mas sobrescrevendo rotas. */
async function openCampaignsWith(over: Parameters<typeof baseRoutes>[0]) {
  return openCampaigns(baseRoutes(over));
}

describe("bloqueio e suspensão pela plataforma", () => {
  it("grupo bloqueado: aviso destacado com o motivo e 'Ativar' desabilitado", async () => {
    await openCampaignsWith({
      "GET /group-sponsors/terms": () => json(200, { ...TERMS, blocked: true, blockedReason: "Denúncia de anúncio proibido" }),
    });
    const alert = await screen.findByTestId("blocked-alert");
    expect(alert).toHaveTextContent("Patrocínio bloqueado pela plataforma");
    expect(alert).toHaveTextContent("Denúncia de anúncio proibido");
    expect(screen.getByRole("button", { name: "Ativar Rascunho promo" })).toBeDisabled();
    expect(screen.getByTestId("activate-reason")).toHaveTextContent("bloqueado pela plataforma");
  });

  it("campanha suspensa pela plataforma: mostra o motivo e NÃO oferece ativar, retomar nem pausar", async () => {
    await openCampaigns();
    const card = screen.getByText("Suspensa promo").closest("[data-testid='campaign-card']") as HTMLElement;
    const alert = within(card).getByTestId("suspended-alert");
    expect(alert).toHaveTextContent("Suspensa pela plataforma");
    expect(alert).toHaveTextContent("Conteúdo duvidoso");
    expect(within(card).queryByRole("button", { name: /Retomar|Ativar|Pausar/ })).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: /Editar/ })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: /Relatório/ })).toBeInTheDocument();
  });
});

describe("campanhas: lista, chips e filtros", () => {
  it("mostra os chips de situação de cada campanha (texto sempre visível) e os avisos fixos", async () => {
    await openCampaigns();
    const chipOf = (title: string) => within(screen.getByText(title).closest("[data-testid='campaign-card']") as HTMLElement).getByTestId("status-chip");
    expect(chipOf("Rascunho promo")).toHaveTextContent("Rascunho");
    expect(chipOf("No ar promo")).toHaveTextContent("No ar agora");
    expect(chipOf("Pausada promo")).toHaveTextContent("Pausada");
    expect(chipOf("Encerrada promo")).toHaveTextContent("Encerrada");
    expect(chipOf("Agendada promo")).toHaveTextContent("Agendada");
    expect(chipOf("No ar promo")).toHaveAttribute("data-status", "ACTIVE_NOW");

    const rules = screen.getByTestId("rules-notice");
    expect(rules).toHaveTextContent("Menores de 18 anos não veem patrocinadores.");
    expect(rules).toHaveTextContent("O anúncio sempre mostra o selo Patrocinado.");
    expect(rules).toHaveTextContent("No máximo 3 campanhas ativas ao mesmo tempo.");
    expect(rules).toHaveTextContent("Categorias proibidas: bebidas alcoólicas, apostas, tabaco, conteúdo adulto, crédito predatório, política partidária.");
  });

  it("as ações oferecidas dependem da situação: rascunho ativa, no ar/agendada pausa, pausada retoma, encerrada nenhuma das três", async () => {
    await openCampaigns();
    const names = (title: string) =>
      within(screen.getByText(title).closest("[data-testid='campaign-card']") as HTMLElement)
        .getAllByRole("button")
        .map((b) => b.textContent?.trim());
    expect(names("Rascunho promo")).toEqual(["Ativar", "Editar", "Relatório", "Excluir"]);
    expect(names("No ar promo")).toEqual(["Pausar", "Editar", "Relatório", "Excluir"]);
    expect(names("Agendada promo")).toEqual(["Pausar", "Editar", "Relatório", "Excluir"]);
    expect(names("Pausada promo")).toEqual(["Retomar", "Editar", "Relatório", "Excluir"]);
    expect(names("Encerrada promo")).toEqual(["Editar", "Relatório", "Excluir"]);
  });

  it("chip de filtro, patrocinador e busca vão para a API (effective, sponsorId, q)", async () => {
    const calls = await openCampaigns();
    const lastQuery = () => sent(calls, "GET", "/group-sponsor-campaigns").at(-1)!.query;
    const filter = screen.getByTestId("status-filter");
    expect(within(filter).getByRole("button", { name: "Todas" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(filter).getByRole("button", { name: "No ar agora" }));
    await waitFor(() => expect(lastQuery().get("effective")).toBe("ACTIVE_NOW"));
    expect(within(filter).getByRole("button", { name: "No ar agora" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText("Patrocinador"), { target: { value: "2" } });
    await waitFor(() => expect(lastQuery().get("sponsorId")).toBe("2"));
    fireEvent.change(screen.getByLabelText("Buscar campanha"), { target: { value: "promo" } });
    await waitFor(() => expect(lastQuery().get("q")).toBe("promo"));
    expect(lastQuery().get("effective")).toBe("ACTIVE_NOW");
    fireEvent.click(within(filter).getByRole("button", { name: "Todas" }));
    await waitFor(() => expect(lastQuery().get("effective")).toBeNull());
  });

  it("lista vazia: sem filtros convida a criar; com filtros diz que nada foi encontrado", async () => {
    mockApi(baseRoutes({ "GET /group-sponsor-campaigns": () => list([]) }));
    renderWithClient(<PatrocinadoresPage />);
    expect(await screen.findByTestId("campaigns-empty")).toHaveTextContent("Você ainda não tem campanhas");
    fireEvent.click(within(screen.getByTestId("status-filter")).getByRole("button", { name: "Pausada" }));
    await waitFor(() => expect(screen.getByTestId("campaigns-empty")).toHaveTextContent("Nenhuma campanha encontrada com esses filtros."));
  });

  it("carregando mostra o esqueleto; erro do servidor mostra a mensagem e 'Tentar novamente' recarrega", async () => {
    let fail = true;
    mockApi(baseRoutes({ "GET /group-sponsor-campaigns": () => (fail ? json(500, { message: "Servidor fora do ar" }) : list(CAMPAIGNS)) }));
    renderWithClient(<PatrocinadoresPage />);
    expect(screen.getByTestId("campaigns-loading")).toHaveAttribute("aria-busy", "true");
    expect(await screen.findByTestId("campaigns-error")).toHaveTextContent("Servidor fora do ar");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Rascunho promo")).toBeInTheDocument();
  });
});

describe("campanhas: ativar, pausar, retomar e excluir", () => {
  const actionRoutes = () =>
    baseRoutes({
      "POST /group-sponsor-campaigns/1/activate": () => json(201, campaign()),
      "POST /group-sponsor-campaigns/2/pause": () => json(201, campaign()),
      "POST /group-sponsor-campaigns/3/resume": () => json(201, campaign()),
      "DELETE /group-sponsor-campaigns/4": () => new Response(null, { status: 204 }),
    });

  it(
    "ativar pede confirmação dizendo o que vai ao ar e que o Mestre responde pelo conteúdo; só então chama a API",
    async () => {
      const calls = await openCampaigns(actionRoutes());
      fireEvent.click(screen.getByRole("button", { name: "Ativar Rascunho promo" }));
      const confirm = await screen.findByRole("alertdialog");
      expect(confirm).toHaveTextContent("vai ao ar no app dos alunos adultos do seu grupo");
      expect(confirm).toHaveTextContent("10/11/2026 08:00 até 10/12/2026 08:00");
      expect(confirm).toHaveTextContent("Você responde pelo conteúdo e pelo link deste anúncio");
      expect(confirm).toHaveTextContent("Menores de 18 anos não veem patrocinadores.");
      expect(sent(calls, "POST", "/group-sponsor-campaigns/1/activate")).toHaveLength(0);
      fireEvent.click(within(confirm).getByRole("button", { name: "Ativar e publicar" }));
      await waitFor(() => expect(sent(calls, "POST", "/group-sponsor-campaigns/1/activate")).toHaveLength(1));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Campanha ativada")));
    },
    SLOW,
  );

  it(
    "cancelar a confirmação não chama a API; pausar, retomar e excluir chamam o endpoint certo",
    async () => {
      const calls = await openCampaigns(actionRoutes());
      fireEvent.click(screen.getByRole("button", { name: "Ativar Rascunho promo" }));
      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(sent(calls, "POST", "/group-sponsor-campaigns/1/activate")).toHaveLength(0);

      for (const [button, confirmLabel, method, path] of [
        ["Pausar No ar promo", "Pausar", "POST", "/group-sponsor-campaigns/2/pause"],
        ["Retomar Pausada promo", "Retomar", "POST", "/group-sponsor-campaigns/3/resume"],
        ["Excluir Encerrada promo", "Excluir", "DELETE", "/group-sponsor-campaigns/4"],
      ] as const) {
        fireEvent.click(screen.getByRole("button", { name: button }));
        const confirm = await screen.findByRole("alertdialog");
        fireEvent.click(within(confirm).getByRole("button", { name: confirmLabel }));
        await waitFor(() => expect(sent(calls, method, path), path).toHaveLength(1));
        await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      }
    },
    SLOW,
  );

  it.each([
    ["activate", "Ativar Rascunho promo", "Ativar e publicar", 403, "SPONSOR_TERMS_REQUIRED", /Aceite o termo de responsabilidade/, "POST /group-sponsor-campaigns/1/activate"],
    ["activate", "Ativar Rascunho promo", "Ativar e publicar", 403, "SPONSORS_BLOCKED", /plataforma bloqueou o patrocínio local/, "POST /group-sponsor-campaigns/1/activate"],
    ["activate", "Ativar Rascunho promo", "Ativar e publicar", 409, "SPONSOR_LIMIT", /no máximo 10 patrocinadores, 10 campanhas e 3 campanhas ativas/, "POST /group-sponsor-campaigns/1/activate"],
    ["resume", "Retomar Pausada promo", "Retomar", 403, "SUSPENDED_BY_PLATFORM", /suspensa pela plataforma e não pode ser retomada/, "POST /group-sponsor-campaigns/3/resume"],
  ])(
    "erro do servidor em %s (%s) vira mensagem clara no toast e fecha a confirmação",
    async (_kind, button, confirmLabel, status, code, message, route) => {
      await openCampaigns(baseRoutes({ [route]: () => json(status, { code, message: "msg crua do servidor" }) }));
      fireEvent.click(screen.getByRole("button", { name: button }));
      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: confirmLabel }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(message)));
      expect(toast.error).not.toHaveBeenCalledWith("msg crua do servidor");
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    },
    SLOW,
  );
});

describe("formulário de campanha", () => {
  async function openNewForm(routes = baseRoutes()) {
    const calls = await openCampaigns(routes);
    fireEvent.click(screen.getByRole("button", { name: "Nova campanha" }));
    await screen.findByRole("dialog");
    return calls;
  }
  const field = (label: RegExp) => within(dialog()).getByLabelText(label);
  const type = (label: RegExp, value: string) => fireEvent.change(field(label), { target: { value } });
  function fillValid() {
    type(/Patrocinador \*/, "1");
    type(/^Título \*/, "Berimbau em oferta");
    type(/^Texto \*/, "Instrumentos artesanais para a sua roda.");
    type(/Link de destino/, "https://www.berimbau.com.br/promo");
    type(/Categoria \*/, "INSTRUMENTOS");
    type(/^Início/, "2026-11-10T08:00");
    type(/^Fim/, "2026-12-10T08:00");
  }

  it(
    "tem exatamente as 7 categorias permitidas e NÃO tem campo de UF nem de peso; avisos fixos presentes; botão começa com 'Conhecer'",
    async () => {
      await openNewForm();
      const options = within(field(/Categoria \*/)).getAllByRole("option").map((o) => o.textContent);
      expect(options).toEqual(["Escolha…", "Instrumentos", "Vestuário", "Saúde", "Educação", "Eventos e turismo", "Alimentação", "Esportes"]);
      const d = within(dialog());
      expect(d.queryByLabelText(/\bUF\b|Estado|Região/i)).not.toBeInTheDocument();
      expect(d.queryByLabelText(/Peso/i)).not.toBeInTheDocument();
      expect(d.getByTestId("rules-notice")).toHaveTextContent("No máximo 3 campanhas ativas ao mesmo tempo.");
      expect(field(/Texto do botão/)).toHaveValue("Conhecer");
    },
    SLOW,
  );

  it(
    "pré-visualização a 375 px atualiza ao vivo (título, texto, botão, patrocinador) com selo 'Patrocinado' e faixa 'Parceiro do <grupo>'; contadores acompanham",
    async () => {
      await openNewForm();
      const frame = screen.getByTestId("slide-frame");
      expect(frame.className).toContain("w-[375px]");
      expect(screen.getByTestId("preview-badge")).toHaveTextContent("Patrocinado");
      expect(screen.getByTestId("preview-partner")).toHaveTextContent("Parceiro do Grupo Cordão");
      expect(screen.getByTestId("preview-title")).toHaveTextContent("Título da campanha");

      type(/^Título \*/, "Berimbau");
      type(/^Texto \*/, "Oferta da semana");
      type(/Texto do botão/, "Ver loja");
      type(/Patrocinador \*/, "2");
      expect(screen.getByTestId("preview-title")).toHaveTextContent("Berimbau");
      expect(screen.getByTestId("preview-text")).toHaveTextContent("Oferta da semana");
      expect(screen.getByTestId("preview-cta")).toHaveTextContent("Ver loja");
      expect(screen.getByTestId("preview-sponsor")).toHaveTextContent("Casa do Capoeirista");
      expect(within(dialog()).getByText("8/60")).toBeInTheDocument();
      expect(within(dialog()).getByText("16/90")).toBeInTheDocument();
      expect(within(dialog()).getByText("8/24")).toBeInTheDocument();
      expect(screen.queryByTestId("preview-image")).not.toBeInTheDocument();
    },
    SLOW,
  );

  it(
    "URL validada ao vivo enquanto digita (http, IP, porta, acento) e some quando o endereço fica válido",
    async () => {
      await openNewForm();
      const url = field(/Link de destino/);
      for (const [value, message] of [
        ["http://loja.com.br", /links seguros/],
        ["https://127.0.0.1/x", /numéricos \(IP\)/],
        ["https://localhost", /locais ou de rede interna/],
        ["https://loja.com.br:8080/x", /não pode ter porta/],
        ["https://lojá.com.br", /acentos/],
        ["https://user:pw@loja.com.br", /usuário ou senha/],
      ] as const) {
        type(/Link de destino/, value);
        expect(await within(dialog()).findByText(message)).toBeInTheDocument();
        expect(url).toHaveAttribute("aria-invalid", "true");
      }
      type(/Link de destino/, "http://loja.com.br");
      expect(screen.getByTestId("url-warning")).toHaveTextContent("não é seguro");
      type(/Link de destino/, "https://www.loja.com.br/ok");
      expect(url).not.toHaveAttribute("aria-invalid");
      expect(within(dialog()).getByText("Endereço aceito.")).toBeInTheDocument();
    },
    SLOW,
  );

  it(
    "datas: o fim precisa ser depois do início e a janela cabe em 366 dias (erro ao vivo)",
    async () => {
      await openNewForm();
      type(/^Início/, "2026-11-10T08:00");
      type(/^Fim/, "2026-11-09T08:00");
      expect(await within(dialog()).findByText("O fim deve ser depois do início.")).toBeInTheDocument();
      type(/^Fim/, "2028-11-09T08:00");
      expect(await within(dialog()).findByText(/no máximo 366 dias/)).toBeInTheDocument();
    },
    SLOW,
  );

  it(
    "salvar inválido não chama a API, mostra os erros nos campos e leva o foco ao primeiro inválido",
    async () => {
      const calls = await openNewForm();
      fireEvent.click(within(dialog()).getByRole("button", { name: "Criar campanha" }));
      expect(await within(dialog()).findByText("Escolha o patrocinador.")).toBeInTheDocument();
      expect(within(dialog()).getByText("Escolha uma categoria da lista.")).toBeInTheDocument();
      expect(within(dialog()).getByText(/O título deve ter de 2 a 60/)).toBeInTheDocument();
      expect(field(/Patrocinador \*/)).toHaveFocus();
      expect(field(/Patrocinador \*/)).toHaveAttribute("aria-invalid", "true");
      expect(sent(calls, "POST", "/group-sponsor-campaigns")).toHaveLength(0);
    },
    SLOW,
  );

  it(
    "criar: POST com o corpo do contrato (sem states/weight, datas em ISO de Brasília), fecha o formulário e avisa que nasce como rascunho",
    async () => {
      const calls = await openNewForm(baseRoutes({ "POST /group-sponsor-campaigns": () => json(201, campaign({ id: 9 })) }));
      fillValid();
      type(/Preço combinado/, "1.500,00");
      fireEvent.click(within(dialog()).getByRole("button", { name: "Criar campanha" }));
      await waitFor(() => expect(sent(calls, "POST", "/group-sponsor-campaigns")).toHaveLength(1));
      const body = sent(calls, "POST", "/group-sponsor-campaigns")[0]!.body as Record<string, unknown>;
      expect(body).toEqual({
        sponsorId: 1,
        title: "Berimbau em oferta",
        text: "Instrumentos artesanais para a sua roda.",
        imageRef: null,
        ctaLabel: "Conhecer",
        destinationUrl: "https://www.berimbau.com.br/promo",
        category: "INSTRUMENTOS",
        startsAt: "2026-11-10T11:00:00.000Z",
        endsAt: "2026-12-10T11:00:00.000Z",
        priceCents: 150000,
        billingNote: null,
      });
      expect(body).not.toHaveProperty("states");
      expect(body).not.toHaveProperty("weight");
      await waitFor(() => expect(screen.queryByTestId("campaign-form")).not.toBeInTheDocument());
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("rascunho"));
    },
    SLOW,
  );

  it(
    "erro 400 do servidor no link aparece no campo; 409 SPONSOR_LIMIT aparece em bloco e o formulário continua aberto",
    async () => {
      let mode: "field" | "limit" = "field";
      await openNewForm(
        baseRoutes({
          "POST /group-sponsor-campaigns": () =>
            mode === "field"
              ? json(400, { code: "INVALID_DESTINATION_URL", field: "destinationUrl", message: "Esse endereço não é aceito pelo servidor" })
              : json(409, { code: "SPONSOR_LIMIT", message: "limite" }),
        }),
      );
      fillValid();
      fireEvent.click(within(dialog()).getByRole("button", { name: "Criar campanha" }));
      const urlError = await within(dialog()).findByText("Esse endereço não é aceito pelo servidor");
      expect(urlError).toHaveAttribute("id", `${field(/Link de destino/).id}-error`);
      expect(field(/Link de destino/)).toHaveFocus();

      mode = "limit";
      fireEvent.click(within(dialog()).getByRole("button", { name: "Criar campanha" }));
      expect(await within(dialog()).findByTestId("campaign-form-error")).toHaveTextContent("no máximo 10 patrocinadores, 10 campanhas e 3 campanhas ativas");
      expect(screen.getByTestId("campaign-form")).toBeInTheDocument();
    },
    SLOW,
  );

  it(
    "imagem: recusa > 250 KB e formato errado NO NAVEGADOR (mensagem, sem upload); válida sobe por /group-sponsor-uploads e aparece na pré-visualização",
    async () => {
      const calls = await openNewForm(baseRoutes({ "POST /group-sponsor-uploads": () => json(201, { url: UPLOADED }) }));
      const input = screen.getByTestId("campaign-image-file");
      fireEvent.change(input, { target: { files: [fileOf("grande.png", "image/png", 250 * 1024 + 1)] } });
      expect(await within(dialog()).findByText(/limite é 250 KB/)).toBeInTheDocument();
      fireEvent.change(input, { target: { files: [fileOf("a.gif", "image/gif")] } });
      expect(await within(dialog()).findByText(/Formato não aceito/)).toBeInTheDocument();
      expect(sent(calls, "POST", "/group-sponsor-uploads")).toHaveLength(0);
      expect(screen.queryByTestId("preview-image")).not.toBeInTheDocument();

      fireEvent.change(input, { target: { files: [fileOf("ok.webp", "image/webp", 100 * 1024)] } });
      await waitFor(() => expect(sent(calls, "POST", "/group-sponsor-uploads")).toHaveLength(1));
      expect(((sent(calls, "POST", "/group-sponsor-uploads")[0]!.body) as FormData).get("file")).toBeInstanceOf(File);
      const preview = await screen.findByTestId("preview-image");
      expect(preview.getAttribute("src")).toMatch(/\/api\/uploads\/3f2b8c1e-5d4a-4c3b-9a7e-1b2c3d4e5f60\.webp$/);
    },
    SLOW,
  );

  it(
    "editar campanha ATIVA: avisa que mudar o conteúdo a devolve a rascunho; só preço/datas não avisam; PATCH leva o corpo completo",
    async () => {
      const calls = await openCampaigns(baseRoutes({ "PATCH /group-sponsor-campaigns/2": () => json(200, campaign({ id: 2 })) }));
      fireEvent.click(screen.getByRole("button", { name: "Editar No ar promo" }));
      await screen.findByRole("dialog");
      expect(screen.getByTestId("edit-live-hint")).toHaveTextContent("ativa");
      expect(screen.getByTestId("edit-live-hint")).toHaveTextContent("rascunho");
      expect(field(/^Título \*/)).toHaveValue("No ar promo");
      type(/Preço combinado/, "10,00");
      expect(screen.queryByTestId("revert-warning")).not.toBeInTheDocument();
      type(/^Título \*/, "No ar promo v2");
      expect(screen.getByTestId("revert-warning")).toHaveTextContent("volta para rascunho");
      fireEvent.click(within(dialog()).getByRole("button", { name: "Salvar alterações" }));
      await waitFor(() => expect(sent(calls, "PATCH", "/group-sponsor-campaigns/2")).toHaveLength(1));
      const body = sent(calls, "PATCH", "/group-sponsor-campaigns/2")[0]!.body as Record<string, unknown>;
      expect(body).toMatchObject({ title: "No ar promo v2", priceCents: 1000, sponsorId: 1, category: "INSTRUMENTOS" });
      expect(body).not.toHaveProperty("states");
      expect(body).not.toHaveProperty("weight");
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("devolvida para rascunho")));
    },
    SLOW,
  );

  it(
    "editar campanha em rascunho não mostra o aviso de 'volta para rascunho'",
    async () => {
      await openCampaigns();
      fireEvent.click(screen.getByRole("button", { name: "Editar Rascunho promo" }));
      await screen.findByRole("dialog");
      expect(screen.queryByTestId("edit-live-hint")).not.toBeInTheDocument();
      type(/^Título \*/, "Outro título");
      expect(screen.queryByTestId("revert-warning")).not.toBeInTheDocument();
    },
    SLOW,
  );
});

describe("patrocinadores do grupo", () => {
  async function openSponsors(routes = baseRoutes()) {
    const calls = mockApi(routes);
    renderWithClient(<PatrocinadoresPage />);
    await screen.findByText("Rascunho promo");
    openTab("Patrocinadores");
    await screen.findByTestId("sponsor-card", {}, { timeout: 3000 }).catch(() => undefined);
    return calls;
  }

  it("lista com contato, contador do limite (2 de 10) e estado vazio", async () => {
    await openSponsors();
    const cards = await screen.findAllByTestId("sponsor-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Loja Berimbau");
    expect(cards[0]).toHaveTextContent("joana@berimbau.com.br");
    expect(cards[1]).toHaveTextContent("Sem contato cadastrado");
    expect(screen.getByTestId("sponsors-count")).toHaveTextContent("2 de 10 patrocinadores");
  });

  it("lista vazia e erro de carregamento têm mensagem própria", async () => {
    let fail = false;
    mockApi(baseRoutes({ "GET /group-sponsors": () => (fail ? json(500, { message: "Falha ao listar" }) : list([])) }));
    const { client } = renderWithClient(<PatrocinadoresPage />);
    await screen.findByText("Rascunho promo");
    openTab("Patrocinadores");
    expect(await screen.findByTestId("sponsors-empty")).toHaveTextContent("Você ainda não tem patrocinadores");
    fail = true;
    await act(async () => {
      await client.invalidateQueries();
    });
    expect(await screen.findByTestId("sponsors-error")).toHaveTextContent("Falha ao listar");
  });

  it(
    "criar: valida o nome, manda o corpo do contrato e avisa que contato/documento/observações são privados do grupo",
    async () => {
      const calls = await openSponsors(baseRoutes({ "POST /group-sponsors": () => json(201, SPONSORS[0]) }));
      fireEvent.click(screen.getByRole("button", { name: "Novo patrocinador" }));
      const form = await screen.findByTestId("sponsor-form");
      expect(dialog()).toHaveTextContent("privados do seu grupo");
      fireEvent.click(within(form).getByRole("button", { name: "Salvar" }));
      expect(await within(form).findByText(/O nome deve ter de 2 a 80/)).toBeInTheDocument();
      expect(sent(calls, "POST", "/group-sponsors")).toHaveLength(0);

      fireEvent.change(within(form).getByLabelText(/Nome do patrocinador/), { target: { value: "Capoeira Store" } });
      fireEvent.change(within(form).getByLabelText(/E-mail do contato/), { target: { value: "contato@capoeira.com.br" } });
      fireEvent.change(within(form).getByLabelText(/Observações/), { target: { value: "Fala com a Ana" } });
      expect(within(form).getByText(/14\/1000/)).toBeInTheDocument();
      fireEvent.click(within(form).getByRole("button", { name: "Salvar" }));
      await waitFor(() => expect(sent(calls, "POST", "/group-sponsors")).toHaveLength(1));
      expect(sent(calls, "POST", "/group-sponsors")[0]!.body).toEqual({
        name: "Capoeira Store",
        logo: null,
        contactName: null,
        contactEmail: "contato@capoeira.com.br",
        contactPhone: null,
        document: null,
        notes: "Fala com a Ana",
      });
      await waitFor(() => expect(screen.queryByTestId("sponsor-form")).not.toBeInTheDocument());
    },
    SLOW,
  );

  it(
    "logo: > 250 KB ou formato inválido é recusado no navegador (sem upload); válido sobe pelo /group-sponsor-uploads e vai no corpo",
    async () => {
      const calls = await openSponsors(baseRoutes({ "POST /group-sponsor-uploads": () => json(201, { url: UPLOADED }), "POST /group-sponsors": () => json(201, SPONSORS[0]) }));
      fireEvent.click(screen.getByRole("button", { name: "Novo patrocinador" }));
      const form = await screen.findByTestId("sponsor-form");
      const input = screen.getByTestId("sponsor-logo-file");
      fireEvent.change(input, { target: { files: [fileOf("logo.png", "image/png", 251 * 1024)] } });
      expect(await within(form).findByText(/limite é 250 KB/)).toBeInTheDocument();
      fireEvent.change(input, { target: { files: [fileOf("logo.svg", "image/svg+xml")] } });
      expect(await within(form).findByText(/Formato não aceito/)).toBeInTheDocument();
      expect(sent(calls, "POST", "/group-sponsor-uploads")).toHaveLength(0);

      fireEvent.change(input, { target: { files: [fileOf("logo.png", "image/png", 50 * 1024)] } });
      await waitFor(() => expect(sent(calls, "POST", "/group-sponsor-uploads")).toHaveLength(1));
      fireEvent.change(within(form).getByLabelText(/Nome do patrocinador/), { target: { value: "Com Logo" } });
      await waitFor(() => expect(within(form).getByRole("button", { name: "Remover imagem: Logo (opcional)" })).toBeInTheDocument());
      fireEvent.click(within(form).getByRole("button", { name: "Salvar" }));
      await waitFor(() => expect(sent(calls, "POST", "/group-sponsors")).toHaveLength(1));
      expect(sent(calls, "POST", "/group-sponsors")[0]!.body).toMatchObject({ name: "Com Logo", logo: UPLOADED });
    },
    SLOW,
  );

  it(
    "editar manda PATCH com o patrocinador carregado no formulário",
    async () => {
      const calls = await openSponsors(baseRoutes({ "PATCH /group-sponsors/1": () => json(200, SPONSORS[0]) }));
      fireEvent.click(screen.getByRole("button", { name: "Editar Loja Berimbau" }));
      const form = await screen.findByTestId("sponsor-form");
      const name = within(form).getByLabelText(/Nome do patrocinador/);
      expect(name).toHaveValue("Loja Berimbau");
      fireEvent.change(name, { target: { value: "Loja Berimbau Plus" } });
      fireEvent.click(within(form).getByRole("button", { name: "Salvar" }));
      await waitFor(() => expect(sent(calls, "PATCH", "/group-sponsors/1")).toHaveLength(1));
      expect(sent(calls, "PATCH", "/group-sponsors/1")[0]!.body).toMatchObject({ name: "Loja Berimbau Plus", contactEmail: "joana@berimbau.com.br" });
    },
    SLOW,
  );

  it(
    "excluir pede confirmação; 409 SPONSOR_HAS_CAMPAIGNS mostra mensagem clara; 409 SPONSOR_LIMIT na criação também",
    async () => {
      let mode: "ok" | "has" = "has";
      const calls = await openSponsors(
        baseRoutes({
          "DELETE /group-sponsors/1": () => (mode === "has" ? json(409, { code: "SPONSOR_HAS_CAMPAIGNS", message: "tem campanhas" }) : new Response(null, { status: 204 })),
          "POST /group-sponsors": () => json(409, { code: "SPONSOR_LIMIT", message: "limite" }),
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Excluir Loja Berimbau" }));
      const confirm = await screen.findByRole("alertdialog");
      expect(confirm).toHaveTextContent("Só é possível excluir patrocinadores que não têm campanhas.");
      fireEvent.click(within(confirm).getByRole("button", { name: "Excluir" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("ainda tem campanhas")));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(sent(calls, "DELETE", "/group-sponsors/1")).toHaveLength(1);

      mode = "ok";
      fireEvent.click(screen.getByRole("button", { name: "Excluir Loja Berimbau" }));
      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Excluir" }));
      await waitFor(() => expect(sent(calls, "DELETE", "/group-sponsors/1")).toHaveLength(2));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Patrocinador excluído."));

      fireEvent.click(screen.getByRole("button", { name: "Novo patrocinador" }));
      const form = await screen.findByTestId("sponsor-form");
      fireEvent.change(within(form).getByLabelText(/Nome do patrocinador/), { target: { value: "Mais um" } });
      fireEvent.click(within(form).getByRole("button", { name: "Salvar" }));
      expect(await within(form).findByTestId("sponsor-form-error")).toHaveTextContent("no máximo 10 patrocinadores");
    },
    SLOW,
  );
});

describe("relatório da campanha", () => {
  // Campanha no passado: o período padrão (30 dias dentro da vigência) é determinístico em qualquer dia de execução.
  const past = campaign({
    id: 2,
    title: "No ar promo",
    status: "ACTIVE",
    effectiveStatus: "ENDED",
    startsAt: "2026-09-01T03:00:00.000Z",
    endsAt: "2026-10-01T03:00:00.000Z",
  });
  const range = defaultReportRange(past.startsAt, past.endsAt);
  const report = {
    ...REPORT,
    campaign: { ...REPORT.campaign, startsAt: past.startsAt, endsAt: past.endsAt },
    byDay: [
      { day: "2026-09-10", impressions: 600, clicks: 20 },
      { day: "2026-09-12", impressions: 634, clicks: 36 },
    ],
  };
  const routes = (over: Record<string, (c: Call) => Response> = {}) =>
    baseRoutes({ "GET /group-sponsor-campaigns": () => list([past]), "GET /group-sponsor-campaigns/2/report": () => json(200, report), ...over });

  async function openReport(over: Record<string, (c: Call) => Response> = {}) {
    const calls = mockApi(routes(over));
    renderWithClient(<PatrocinadoresPage />);
    await screen.findByText("No ar promo");
    fireEvent.click(screen.getByRole("button", { name: "Relatório de No ar promo" }));
    await screen.findByTestId("report");
    return calls;
  }

  it(
    "período padrão de 30 dias na vigência, totais (impressões, cliques, CTR), barras por dia, tabela por UF e aviso de privacidade",
    async () => {
      const calls = await openReport();
      expect(range).toEqual({ from: "2026-09-01", to: "2026-09-30" });
      await waitFor(() => expect(screen.getByTestId("total-impressions")).toHaveTextContent("1.234"));
      const q = sent(calls, "GET", "/group-sponsor-campaigns/2/report")[0]!.query;
      expect([q.get("from"), q.get("to")]).toEqual([range.from, range.to]);
      expect(screen.getByTestId("total-clicks")).toHaveTextContent("56");
      expect(screen.getByTestId("total-ctr")).toHaveTextContent("4,54%");
      // 30 dias de 01/09 a 30/09: uma barra por dia em cada gráfico (dias sem dado entram com zero)
      for (const id of ["chart-impressions", "chart-clicks"]) {
        const bars = within(screen.getByTestId(id)).getByRole("img").querySelectorAll("rect[data-value]");
        expect(bars).toHaveLength(30);
      }
      const values = [...within(screen.getByTestId("chart-impressions")).getByRole("img").querySelectorAll("rect[data-value]")].map((r) => r.getAttribute("data-value"));
      expect(values[9]).toBe("600"); // 10/09
      expect(values[11]).toBe("634"); // 12/09
      expect(values[0]).toBe("0");
      const states = within(screen.getByTestId("table-states"));
      expect(states.getByRole("row", { name: /GO.*1\.000.*50.*5,00%/ })).toBeInTheDocument();
      expect(states.getByText("Não identificada")).toBeInTheDocument();
      expect(screen.getByTestId("report-privacy")).toHaveTextContent("Os números são agregados e não identificam pessoas.");
    },
    SLOW,
  );

  it(
    "trocar o período consulta de novo; período invertido mostra erro e não consulta",
    async () => {
      const calls = await openReport();
      await waitFor(() => expect(screen.getByTestId("total-clicks")).toBeInTheDocument());
      const reports = () => sent(calls, "GET", "/group-sponsor-campaigns/2/report");
      fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-09-05" } });
      await waitFor(() => expect(reports()).toHaveLength(2));
      expect(reports()[1]!.query.get("from")).toBe("2026-09-05");
      fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-09-01" } });
      expect(await screen.findByTestId("report-range-error")).toBeInTheDocument();
      expect(reports()).toHaveLength(2);
      expect(screen.getByRole("button", { name: /Exportar CSV/ })).toBeDisabled();
    },
    SLOW,
  );

  it(
    "Exportar CSV: GET autenticado em report.csv com o período e arquivo campanha-<id>-<from>_a_<to>.csv",
    async () => {
      const calls = await openReport({
        "GET /group-sponsor-campaigns/2/report.csv": () => new Response("﻿dia;impressoes;cliques\r\n", { status: 200, headers: { "Content-Type": "text/csv" } }),
      });
      await waitFor(() => expect(screen.getByTestId("total-clicks")).toBeInTheDocument());
      URL.createObjectURL = vi.fn(() => "blob:x");
      URL.revokeObjectURL = vi.fn();
      const names: string[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        names.push(this.download);
      });
      fireEvent.click(screen.getByRole("button", { name: /Exportar CSV/ }));
      await waitFor(() => expect(names).toEqual([`campanha-2-${range.from}_a_${range.to}.csv`]));
      const csv = sent(calls, "GET", "/group-sponsor-campaigns/2/report.csv")[0]!;
      expect(csv.headers["Authorization"]).toBe("Bearer tok");
      expect([csv.query.get("from"), csv.query.get("to")]).toEqual([range.from, range.to]);
    },
    SLOW,
  );

  it(
    "sem impressões nem cliques: estado vazio explicado; erro do relatório: mensagem e 'Tentar novamente'",
    async () => {
      let mode: "empty" | "error" = "empty";
      await openReport({
        "GET /group-sponsor-campaigns/2/report": () =>
          mode === "empty"
            ? json(200, { ...report, totals: { impressions: 0, clicks: 0, ctr: 0 }, byDay: [], byState: [] })
            : json(500, { message: "Relatório indisponível" }),
      });
      expect(await screen.findByTestId("report-empty")).toHaveTextContent("Ainda não há impressões nem cliques neste período.");
      expect(screen.getByTestId("report-privacy")).toBeInTheDocument();
      mode = "error";
      fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-09-03" } });
      expect(await screen.findByTestId("report-error")).toHaveTextContent("Relatório indisponível");
    },
    SLOW,
  );
});
