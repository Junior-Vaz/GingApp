import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConfiguracoesPage } from "@/modules/configuracoes/configuracoes-page";
import { QuickAttendance } from "@/modules/frequencia/chamada-rapida";
import { clearSession, loginAs } from "./login-as";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const ORG = { id: 1, name: "Ginga Brasil", slug: "gb", type: "GROUP", status: "ACTIVE", document: null, email: null, phone: null };

type Call = { method: string; path: string; body: unknown };

function stub(org: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const path = input.replace(/^.*\/api/, "").split("?")[0]!;
      calls.push({ method, path, body: init.body ? JSON.parse(init.body as string) : undefined });
      if (path === "/organizations" && method === "GET") return Promise.resolve(json(200, org));
      if (path === "/organizations/me" && method === "PATCH") return Promise.resolve(json(200, { ...org, ...JSON.parse(init.body as string) }));
      if (path === "/subscriptions/me") return Promise.resolve(json(200, null));
      if (path === "/dashboard") return Promise.resolve(json(404, { message: "?" }));
      if (path === "/attendance/quick-sessions")
        return Promise.resolve(
          json(200, [{ lessonId: 2, classId: 2, className: "Adulto", classPhoto: null, startTime: "19:00", endTime: "20:00", unitName: null, status: "ONGOING", studentsCount: 1, markedCount: 0 }]),
        );
      if (path === "/attendance/lessons/2" && method === "GET")
        return Promise.resolve(json(200, [{ studentId: 11, studentName: "Ana Souza", present: null, justification: null, photo: null }]));
      if (path === "/attendance/lessons/2" && method === "POST") return Promise.resolve(json(201, { count: 1 }));
      return Promise.resolve(json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
  return calls;
}
const wrap = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("Configurações: avisar quando a presença for registrada", () => {
  const label = "Avisar responsáveis e alunos quando a presença for registrada";

  it("MESTRE liga o interruptor: PATCH /organizations/me { attendanceNotifications: true }", async () => {
    loginAs("MESTRE");
    const calls = stub({ ...ORG, attendanceNotifications: false });
    wrap(<ConfiguracoesPage />);
    const sw = await screen.findByRole("switch", { name: label });
    await waitFor(() => expect(sw).toBeEnabled());
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && c.path === "/organizations/me")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ attendanceNotifications: true });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Avisos de presença ligados."));
  });

  it("mostra o estado atual (ligado) com texto explicativo; quem não é MESTRE só lê (desabilitado)", async () => {
    loginAs("PROFESSOR");
    stub({ ...ORG, attendanceNotifications: true });
    wrap(<ConfiguracoesPage />);
    const sw = await screen.findByRole("switch", { name: label });
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));
    expect(sw).toBeDisabled();
    expect(screen.getByText(/recebem uma notificação no app assim que a chamada é salva/)).toBeInTheDocument();
  });
});

describe("Chamada rápida: toast depois de salvar", () => {
  async function saveCall() {
    fireEvent.click(await screen.findByRole("button", { name: /Chamada rápida/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Presente: Ana Souza" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar chamada" }));
  }

  it("com attendanceNotifications ligado: 'Chamada salva — presentes foram avisados'", async () => {
    loginAs("PROFESSOR");
    stub({ ...ORG, attendanceNotifications: true });
    wrap(<QuickAttendance />);
    await saveCall();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Chamada salva — presentes foram avisados"));
  });

  it("desligado (ou sem poder ler a organização): mantém o toast de sempre", async () => {
    loginAs("PROFESSOR");
    stub({ ...ORG, attendanceNotifications: false });
    wrap(<QuickAttendance />);
    await saveCall();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Frequência salva (1 aluno)."));
  });
});
