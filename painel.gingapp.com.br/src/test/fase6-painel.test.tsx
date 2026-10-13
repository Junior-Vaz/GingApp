import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { clearSession, loginAs } from "./login-as";
import { roleCan, type OrgRole, type PermissionAction, type PermissionResource } from "@/lib/session";
import { navItemsFor } from "@/lib/nav";
import { AlunosPage } from "@/modules/alunos/alunos-page";
import { StudentCard } from "@/modules/alunos/aluno-card";
import { currentCordOf, type Student } from "@/modules/alunos/schema";
import { TurmasPage } from "@/modules/turmas/turmas-page";
import { AulasPage } from "@/modules/aulas/aulas-page";
import { CertificadosPage } from "@/modules/certificados/certificados-page";
import { InadimplentesPanel } from "@/modules/financeiro/inadimplentes-panel";
import { LevelRuler } from "@/modules/graduacoes/level-ruler";
import { TransferenciasPage } from "@/modules/transferencias/transferencias-page";
import { SolicitarTransferenciaForm } from "@/modules/transferencias/solicitar-transferencia-form";
import { ApprovalLinkDialog } from "@/modules/transferencias/link-aprovacao-dialog";
import { approvalWhatsAppUrl } from "@/modules/transferencias/approval-link";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string; query: URLSearchParams; body: unknown };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

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
      return Promise.resolve(handler ? handler(call) : json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
  return calls;
}

function renderUi(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

/** Matriz do backend (prisma/permission-matrix.ts) para os cargos novos: V=view C=create E=edit D=delete, "-" = nada. */
const RESOURCES: PermissionResource[] = [
  "students", "classes", "lessons", "attendance", "graduations", "finance", "events", "rodas",
  "announcements", "teachers", "dashboard", "certificates", "units",
];
const BACKEND_MATRIX: Record<"INSTRUTOR" | "MONITOR", string[]> = {
  //          students classes lessons attendance graduations finance events rodas announcements teachers dashboard certificates units
  INSTRUTOR: ["VCE", "VCE", "VCE", "VCE", "V", "-", "VCE", "VCE", "VCE", "V", "VCE", "V", "V"],
  MONITOR: ["V", "V", "V", "VCE", "V", "-", "V", "V", "V", "-", "-", "-", "V"],
};
const CODE: Record<string, PermissionAction> = { V: "view", C: "create", E: "edit", D: "delete" };
const granted = (role: OrgRole, resource: PermissionResource) =>
  (["view", "create", "edit", "delete"] as const).filter((a) => roleCan(role, resource, a));

describe("Permissões: espelho da matriz do backend (INSTRUTOR e MONITOR)", () => {
  it("as 13 células de cada cargo batem com permission-matrix.ts (INSTRUTOR nunca exclui; MONITOR só leitura + chamada)", () => {
    for (const role of ["INSTRUTOR", "MONITOR"] as const) {
      RESOURCES.forEach((resource, i) => {
        const expected = BACKEND_MATRIX[role][i]!.split("").filter((c) => c !== "-").map((c) => CODE[c]!);
        expect(granted(role, resource), `${role}/${resource}`).toEqual(expected);
      });
    }
  });

  it("MONITOR: sem financeiro, equipe, dashboard e certificados no menu; só os itens de leitura/chamada", () => {
    const labels = navItemsFor("MONITOR").map((i) => i.label);
    for (const hidden of ["Financeiro", "Equipe", "Dashboard", "Certificados", "Transferências"]) expect(labels).not.toContain(hidden);
    for (const shown of ["Alunos", "Turmas", "Aulas", "Frequência", "Graduações", "Eventos", "Rodas", "Comunicados"]) expect(labels).toContain(shown);
  });

  it("papéis fora do painel (e sessão ausente) não ganham nada, mesmo em recursos que o backend libera ao ALUNO", () => {
    for (const role of [undefined, "ALUNO", "RESPONSAVEL"] as const) expect(roleCan(role, "events", "view")).toBe(false);
  });
});

describe("Botões de criação por permissão", () => {
  it("MONITOR não vê 'Novo aluno', 'Nova turma' nem 'Nova aula'", async () => {
    loginAs("MONITOR");
    mockApi();
    for (const [Page, label] of [
      [AlunosPage, /Novo aluno/],
      [TurmasPage, /Nova turma/],
      [AulasPage, /Nova aula/],
    ] as const) {
      const { unmount } = renderUi(<Page />);
      await screen.findByRole("heading", { level: 1 });
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
      unmount();
    }
  });

  it("INSTRUTOR vê criar aluno/turma/aula, mas não 'Emitir certificado' (só leitura)", async () => {
    loginAs("INSTRUTOR");
    mockApi();
    for (const [Page, label, expected] of [
      [AlunosPage, /Novo aluno/, true],
      [TurmasPage, /Nova turma/, true],
      [AulasPage, /Nova aula/, true],
      [CertificadosPage, /Emitir certificado/, false],
    ] as const) {
      const { unmount } = renderUi(<Page />);
      await screen.findByRole("heading", { level: 1 });
      expect(!!screen.queryByRole("button", { name: label })).toBe(expected);
      unmount();
    }
  });

  it("MESTRE continua vendo os botões de criação", async () => {
    loginAs("MESTRE");
    mockApi();
    renderUi(<TurmasPage />);
    expect(await screen.findByRole("button", { name: /Nova turma/ })).toBeInTheDocument();
  });
});

describe("Corda atual do aluno (contrato novo: currentCord objeto)", () => {
  const base: Student = { id: 1, unitId: null, name: "Ana Souza", birthDate: null, document: null, phone: null, email: null, status: "ACTIVE", joinedAt: null };
  const card = (s: Student) => render(<StudentCard student={s} unitName="Sede" actions={null} />);

  it("objeto { name, style, colors } desenha a corda (SVG) e escreve o nome; turmas aparecem", () => {
    card({ ...base, classNames: ["Infantil", "Adulto"], currentCord: { name: "Verde e amarela", style: "BRAIDED", colors: ["#16a34a", "#facc15"] } });
    const art = screen.getByTestId("student-card");
    expect(art).toHaveTextContent("Verde e amarela");
    expect(art).toHaveTextContent("Infantil, Adulto");
    expect(art.querySelector("svg[aria-label^='Corda trançada']")).not.toBeNull();
  });

  it("formato antigo (string) segue aceito: mostra só o nome, sem desenho", () => {
    card({ ...base, currentCord: "Corda azul" });
    const art = screen.getByTestId("student-card");
    expect(art).toHaveTextContent("Corda azul");
    expect(art.querySelector("svg[aria-label^='Corda']")).toBeNull();
    expect(currentCordOf({ currentCord: "Corda azul" })).toEqual({ name: "Corda azul", rope: null });
  });

  it("currentCord null (sem graduação) não mostra 'Corda atual'", () => {
    card({ ...base, currentCord: null });
    expect(screen.getByTestId("student-card")).not.toHaveTextContent("Corda atual");
    expect(currentCordOf({ currentCord: null })).toBeNull();
  });
});

describe("Graduações: studentCount por nível", () => {
  const level = (id: number, studentCount: number | null | undefined) => ({
    id, graduationSystemId: 1, name: `Nível ${id}`, order: id, color: null, style: "SOLID" as const, colors: ["#16a34a"], studentCount,
  });
  it("mostra '3 alunos' / '1 aluno' e esconde zero, null e ausente", () => {
    const system = { id: 1, name: "Sistema", description: null, isActive: true, levels: [level(1, 3), level(2, 1), level(3, 0), level(4, null), level(5, undefined)] };
    render(
      <LevelRuler system={system} canCreate={false} canEdit={false} canDelete={false} busy={false} onEdit={() => {}} onRemove={() => {}} onDuplicate={() => {}} onReorder={() => {}} />,
    );
    const list = screen.getByRole("list", { name: "Níveis de Sistema" });
    expect(list).toHaveTextContent("Ordem 1 · 3 alunos");
    expect(list).toHaveTextContent("Ordem 2 · 1 aluno");
    expect(list).not.toHaveTextContent(/Ordem 3 · 0/);
    expect(within(list).queryByText(/Ordem 4 ·/)).toBeNull();
  });
});

describe("Avatar do aluno em Certificados e Inadimplentes", () => {
  it("Certificados: foto quando existir e iniciais quando não", async () => {
    loginAs("MESTRE");
    const certs = [
      { id: 1, studentId: 1, studentGraduationId: null, title: "A", issuedAt: "2024-03-10T00:00:00.000Z", verificationCode: "c1", fileUrl: null, student: { id: 1, name: "Ana Souza", photo: "https://x.com/ana.jpg" } },
      { id: 2, studentId: 2, studentGraduationId: null, title: "B", issuedAt: "2024-03-10T00:00:00.000Z", verificationCode: "c2", fileUrl: null, student: { id: 2, name: "Bia Lima" } },
    ];
    mockApi({ "GET /certificates": () => json(200, certs, { "X-Total-Count": "2" }) });
    renderUi(<CertificadosPage />);
    await screen.findByText("Ana Souza");
    const avatars = screen.getAllByTestId("student-avatar");
    expect(avatars).toHaveLength(2);
    expect(avatars[0]!.querySelector("img")?.getAttribute("src")).toBe("https://x.com/ana.jpg");
    expect(avatars[1]).toHaveTextContent("BL");
  });

  it("Inadimplentes: sem campo de foto na API cai nas iniciais (ausência não quebra)", async () => {
    loginAs("MESTRE");
    const row = { studentId: 1, studentName: "Caio Dias", phone: null, email: null, unitId: null, guardians: [], overdueCents: 1000, overdueCount: 1, openCents: 1000, oldestDueDate: "2026-01-10T00:00:00.000Z", daysLate: 5 };
    mockApi({ "GET /finance/delinquents": () => json(200, [row], { "X-Total-Count": "1" }) });
    renderUi(<InadimplentesPanel onViewRecords={() => {}} />);
    await screen.findByText("Caio Dias");
    expect(screen.getByTestId("student-avatar")).toHaveTextContent("CD");
  });
});

describe("Link de aprovação de transferência", () => {
  const link = { url: "https://app.gingapp.com.br/aprovar-transferencia?t=abc123", expiresAt: "2026-10-25T15:00:00.000Z", emailed: false };

  it("copia o link, monta o WhatsApp (wa.me + texto codificado) e avisa a validade e que serve só para adulto", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ApprovalLinkDialog link={link} personName="Joana Mestra" groupName="Ginga Brasil" onClose={() => {}} />);
    const dialog = await screen.findByTestId("approval-link-dialog");
    expect(within(dialog).getByLabelText("Link")).toHaveValue(link.url);
    fireEvent.click(within(dialog).getByRole("button", { name: /Copiar/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(link.url));
    expect(toast.success).toHaveBeenCalledWith("Link copiado.");

    const wa = within(dialog).getByRole("link", { name: /Enviar por WhatsApp/ });
    expect(wa.getAttribute("href")).toBe(approvalWhatsAppUrl(link, "Joana Mestra", "Ginga Brasil"));
    expect(wa.getAttribute("href")!.startsWith("https://wa.me/?text=")).toBe(true);
    const text = decodeURIComponent(wa.getAttribute("href")!.slice("https://wa.me/?text=".length));
    expect(text).toContain(link.url);
    expect(text).toContain("Ginga Brasil");
    expect(text).toMatch(/vale até 25\/10\/2026/);
    expect(within(dialog).getByTestId("approval-link-expiry")).toHaveTextContent(/vale até 25\/10\/2026.*só para adulto/);
    expect(within(dialog).queryByTestId("approval-link-emailed")).toBeNull();
  });

  it("emailed=true diz que também foi enviado por e-mail; falha ao copiar vira toast de erro", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("negado")) }, configurable: true });
    render(<ApprovalLinkDialog link={{ ...link, emailed: true }} personName="Joana" onClose={() => {}} />);
    expect(await screen.findByTestId("approval-link-emailed")).toHaveTextContent("também foi enviado por e-mail");
    fireEvent.click(screen.getByRole("button", { name: /Copiar/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Não foi possível copiar")));
  });

  it("POST /transfers com approvalLink abre o diálogo e só conclui o fluxo (onSent) ao fechar", async () => {
    loginAs("MESTRE");
    const onSent = vi.fn();
    mockApi({
      "GET /units": () => json(200, [], { "X-Total-Count": "0" }),
      "POST /transfers": () => json(201, { id: 31, status: "PENDING_PERSON", approvalLink: link, needsApprovalLink: false }),
    });
    renderUi(<SolicitarTransferenciaForm personId={77} personName="Joana Mestra" onBack={() => {}} onSent={onSent} />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar pedido" }));
    const dialog = await screen.findByTestId("approval-link-dialog");
    expect(onSent).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Fechar" })[0]!);
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
  });

  it("POST /transfers sem approvalLink (menor ou adulto com login) conclui direto, sem diálogo", async () => {
    loginAs("MESTRE");
    const onSent = vi.fn();
    mockApi({
      "GET /units": () => json(200, [], { "X-Total-Count": "0" }),
      "POST /transfers": () => json(201, { id: 31, status: "PENDING_PERSON", approvalLink: null }),
    });
    renderUi(<SolicitarTransferenciaForm personId={77} personName="Joana Mestra" onBack={() => {}} onSent={onSent} />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar pedido" }));
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("approval-link-dialog")).toBeNull();
  });

  const transfer = (over: Record<string, unknown> = {}) => ({
    id: 31, status: "PENDING_PERSON", direction: "SENT",
    person: { id: 77, name: "Joana Mestra", nickname: null, photo: null, gingappCode: "GING-7K3Q-9XPM" },
    fromOrganization: { id: 3, name: "Grupo Antigo Axé", logoUrl: null },
    toOrganization: { id: 1, name: "Ginga Brasil", logoUrl: null },
    toUnit: null, requestedAt: "2026-10-10T15:00:00.000Z", expiresAt: "2026-10-24T15:00:00.000Z", contestUntil: "2026-10-17T15:00:00.000Z",
    decidedAt: null, note: null, toStudentId: null, canContest: false, canCancel: true, contests: [], needsApprovalLink: true, ...over,
  });

  it("pedido enviado com needsApprovalLink: 'Gerar link de aprovação' chama POST /transfers/:id/approval-link e mostra o diálogo", async () => {
    loginAs("MESTRE");
    const calls = mockApi({
      "GET /transfers": () => json(200, [transfer(), transfer({ id: 32, needsApprovalLink: false })]),
      "POST /transfers/31/approval-link": () => json(200, link),
    });
    renderUi(<TransferenciasPage />);
    await waitFor(() => expect(screen.getAllByTestId("transfer-card")).toHaveLength(2));
    expect(screen.getAllByRole("button", { name: /Gerar link de aprovação/ })).toHaveLength(1); // só no que precisa
    fireEvent.click(screen.getByRole("button", { name: "Gerar link de aprovação de Joana Mestra" }));
    const dialog = await screen.findByTestId("approval-link-dialog");
    expect(within(dialog).getByLabelText("Link")).toHaveValue(link.url);
    expect(calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual(["/transfers/31/approval-link"]);
    expect(calls.find((c) => c.method === "POST")!.body).toBeUndefined(); // sem corpo
  });

  it("409 APPROVAL_LINK_NOT_NEEDED mostra a mensagem em português e não abre o diálogo", async () => {
    loginAs("MESTRE");
    mockApi({
      "GET /transfers": () => json(200, [transfer()]),
      "POST /transfers/31/approval-link": () => json(409, { message: "Link não necessário", code: "APPROVAL_LINK_NOT_NEEDED" }),
    });
    renderUi(<TransferenciasPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Gerar link de aprovação de Joana Mestra" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("já tem login ou é menor")));
    expect(screen.queryByTestId("approval-link-dialog")).toBeNull();
  });

  it("409 TRANSFER_NOT_PENDING usa a mensagem de pedido que já não aguarda a pessoa", async () => {
    loginAs("MESTRE");
    mockApi({
      "GET /transfers": () => json(200, [transfer()]),
      "POST /transfers/31/approval-link": () => json(409, { message: "x", code: "TRANSFER_NOT_PENDING" }),
    });
    renderUi(<TransferenciasPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Gerar link de aprovação de Joana Mestra" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("já não está aguardando")));
  });
});

describe("Cabeçalho mobile", () => {
  beforeEach(() => loginAs("MESTRE"));
  it("usa o logo do GingApp quando a sessão não traz logo do grupo", async () => {
    const { AppShell } = await import("@/components/painel/app-shell");
    const { createRouter, createMemoryHistory, RouterProvider, createRootRoute } = await import("@tanstack/react-router");
    const root = createRootRoute({ component: () => <AppShell>conteúdo</AppShell> });
    const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
    renderUi(<RouterProvider router={router} />);
    const logo = await screen.findByTestId("topbar-logo");
    expect(logo.getAttribute("src")).toBe("/icone.png");
    expect(logo.className).toContain("md:hidden");
  });
});
