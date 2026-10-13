import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { StudentAvatar } from "@/components/painel/student-avatar";
import { AcessoAlunoDialog } from "@/modules/alunos/acesso-aluno-dialog";
import type { Student } from "@/modules/alunos/schema";
import { ProfessoresPage } from "@/modules/professores/professores-page";
import { clearSession, loginAs } from "./login-as";
import { clickMenuAction, queryMenuAction } from "./row-menu";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function mockApi(routes: Record<string, () => Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = (url.replace(/^https?:\/\/[^/]+\/api/, "").split("?")[0] ?? "");
      const method = init.method ?? "GET";
      calls.push({ method, path });
      const handler = routes[`${method} ${path}`];
      return Promise.resolve(handler ? handler() : json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
  return calls;
}

function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("StudentAvatar", () => {
  it("com foto mostra a imagem; sem foto (ou foto que falha) cai nas iniciais", () => {
    const { rerender } = render(<StudentAvatar name="Ana Maria" photo="https://x.test/ana.png" />);
    expect(screen.getByTestId("student-avatar").querySelector("img")).toHaveAttribute("src", "https://x.test/ana.png");

    rerender(<StudentAvatar name="Ana Maria" photo={null} />);
    expect(screen.getByTestId("student-avatar")).toHaveTextContent("AM");
    expect(screen.getByTestId("student-avatar").querySelector("img")).toBeNull();

    rerender(<StudentAvatar name="Ana Maria" photo="https://x.test/quebrada.png" />);
    fireEvent.error(screen.getByTestId("student-avatar").querySelector("img")!);
    expect(screen.getByTestId("student-avatar")).toHaveTextContent("AM");
  });
});

describe("Redefinir 2FA no painel (só Mestre)", () => {
  const teachers = [
    { id: 11, role: "PROFESSOR", status: "ACTIVE", user: { id: 21, name: "Pastinha", email: "p@x.com", phone: null, twoFactorEnabled: true } },
    { id: 12, role: "PROFESSOR", status: "ACTIVE", user: { id: 22, name: "Sem Dois", email: "s@x.com", phone: null, twoFactorEnabled: false } },
  ];
  const list = () => json(200, teachers, { "X-Total-Count": "2" });

  beforeEach(() => loginAs("MESTRE"));

  it("professor com 2FA: confirmar chama POST /auth/2fa/reset/:userId e avisa; sem 2FA não há botão", async () => {
    const calls = mockApi({
      "GET /teachers": list,
      "GET /units": () => json(200, []),
      "POST /auth/2fa/reset/21": () => json(200, { twoFactorEnabled: false }),
    });
    renderPage(<ProfessoresPage />);
    await screen.findByText("Pastinha");
    expect(queryMenuAction("Redefinir 2FA de Sem Dois")).toBeNull();

    await clickMenuAction("Redefinir 2FA de Pastinha");
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Redefinir 2FA" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST" && c.path === "/auth/2fa/reset/21")).toHaveLength(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("2FA redefinido. As sessões abertas foram encerradas."));
  });

  it("erro do servidor vira toast e o diálogo continua aberto; PROFESSOR não vê o botão", async () => {
    mockApi({
      "GET /teachers": list,
      "GET /units": () => json(200, []),
      "POST /auth/2fa/reset/21": () => json(400, { message: "A verificação em duas etapas não está ativa para este usuário." }),
    });
    renderPage(<ProfessoresPage />);
    await screen.findByText("Pastinha");
    await clickMenuAction("Redefinir 2FA de Pastinha");
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Redefinir 2FA" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("PROFESSOR logado não vê 'Redefinir 2FA'", async () => {
    clearSession();
    loginAs("PROFESSOR");
    mockApi({ "GET /teachers": list, "GET /units": () => json(200, []) });
    renderPage(<ProfessoresPage />);
    await screen.findByText("Pastinha");
    expect(queryMenuAction(/Redefinir 2FA/)).toBeNull();
  });

  it("acesso do aluno: conta com 2FA mostra o botão e chama o reset com o id do USUÁRIO", async () => {
    const student = { id: 5, name: "Aluno Teste", unitId: null, birthDate: null, document: null, phone: null, email: null, status: "ACTIVE", joinedAt: null } as Student;
    const calls = mockApi({
      "GET /students/5/account": () =>
        json(200, {
          hasAccount: true,
          account: { userId: 77, name: "Aluno Teste", email: "a@x.com", status: "ACTIVE", role: "ALUNO", mustChangePassword: false, twoFactorEnabled: true },
        }),
      "POST /auth/2fa/reset/77": () => json(200, { twoFactorEnabled: false }),
    });
    renderPage(<AcessoAlunoDialog student={student} onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Redefinir 2FA" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Redefinir 2FA" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/auth/2fa/reset/77")).toBe(true));
  });
});
