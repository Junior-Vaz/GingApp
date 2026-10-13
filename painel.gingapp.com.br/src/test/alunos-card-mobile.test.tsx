import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, loginAs } from "./login-as";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AlunosPage } from "@/modules/alunos/alunos-page";
import { STUDENTS_VIEW_KEY } from "@/modules/alunos/students-view";
import { queryMenuAction } from "./row-menu";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const students = [
  {
    id: 1, unitId: 7, userId: 50, name: "Ana Souza", birthDate: "1990-05-10T00:00:00.000Z", document: null, phone: "11999", email: "ana@x.com",
    photo: "https://exemplo.com/ana.jpg", status: "ACTIVE", joinedAt: null, classNames: ["Adulto", "Infantil"],
  },
  { id: 2, unitId: null, userId: null, name: "José Álvaro", birthDate: null, document: null, phone: null, email: null, photo: null, status: "INACTIVE", joinedAt: null },
];

function mockApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?")[0]!;
      if (path === "/students") return Promise.resolve(json(200, students, { "X-Total-Count": "2" }));
      if (path === "/units") return Promise.resolve(json(200, [{ id: 7, name: "Sede Centro" }], { "X-Total-Count": "1" }));
      if (path === "/units/7") return Promise.resolve(json(200, { id: 7, name: "Sede Centro" }));
      if (path === "/finance/billing") return Promise.resolve(json(200, [{ studentId: 1, monthlyFeeCents: 15000, dueDay: 10 }]));
      return Promise.resolve(json(404, { message: `sem rota ${path}` }));
    }),
  );
}

const originalWidth = window.innerWidth;
const setWidth = (w: number) => Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: w });

beforeEach(() => {
  localStorage.removeItem(STUDENTS_VIEW_KEY);
  loginAs("MESTRE");
  setWidth(375);
});
afterEach(() => {
  setWidth(originalWidth);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AlunosPage />
    </QueryClientProvider>,
  );
}

describe("Card de aluno no celular (< md): compacto", () => {
  it("foto quadrada pequena + nome, selos, unidade·turma, corda e as ações viram ícones + menu ⋯ (nenhuma se perde)", async () => {
    mockApi();
    renderPage();
    const cards = await screen.findAllByTestId("student-card");
    const ana = within(cards[0]!);
    expect(cards[0]).toHaveAttribute("data-compact", "true");
    expect(ana.getByRole("heading", { name: "Ana Souza" })).toBeInTheDocument();
    expect(ana.getByTestId("student-card-photo").className).toMatch(/size-\[4\.5rem\]/); // 72px, quadrada
    expect(ana.getByTestId("student-card-photo").className).toMatch(/rounded-lg/);
    expect(ana.getByAltText("Foto de Ana Souza")).toHaveAttribute("src", "https://exemplo.com/ana.jpg");
    expect(ana.getByText("Ativo")).toBeInTheDocument();
    expect(ana.getByText("Com acesso")).toBeInTheDocument();
    expect(await ana.findByText(/Sede Centro · Adulto \+1/)).toBeInTheDocument(); // unidade · turma principal (+ outras)
    expect(await ana.findByText(/R\$\s?150,00/)).toBeInTheDocument();

    // Editar, Ficha e Acesso: botões de ícone (44px = size-11) na faixa de ações
    for (const name of ["Editar Ana Souza", "Ficha de Ana Souza", "Acesso de Ana Souza"]) {
      const b = ana.getByRole("button", { name });
      expect(b.className).toMatch(/w-11/);
      expect(b.className).toMatch(/h-11/);
    }
    // texto longo (Responsáveis, Inativar…) fora da faixa: dentro do menu ⋯
    expect(ana.queryByRole("button", { name: "Responsáveis de Ana Souza" })).not.toBeInTheDocument();
    expect(ana.queryByRole("button", { name: "Inativar" })).not.toBeInTheDocument();
    expect(ana.getByRole("button", { name: "Mais ações de Ana Souza" })).toBeInTheDocument();
    expect(queryMenuAction("Responsáveis de Ana Souza", cards[0]!)).not.toBeNull();
    expect(queryMenuAction("Inativar", cards[0]!)).not.toBeNull();
    expect(ana.getByText("11999")).toBeInTheDocument(); // contato numa linha só
  });

  it("sem foto: iniciais; inativo não oferece 'Inativar'; PROFESSOR não vê Inativar nem a edição de financeiro", async () => {
    mockApi();
    renderPage();
    const cards = await screen.findAllByTestId("student-card");
    const jose = within(cards[1]!);
    expect(jose.getByTestId("student-card-initials")).toHaveTextContent("JÁ");
    expect(cards[1]!.querySelector("img")).toBeNull();
    expect(queryMenuAction("Inativar", cards[1]!)).toBeNull();
    expect(queryMenuAction("Responsáveis de José Álvaro", cards[1]!)).not.toBeNull();
  });

  it("abrir o editor pelo ícone funciona, e PROFESSOR não tem 'Inativar' no menu", async () => {
    loginAs("PROFESSOR");
    mockApi();
    renderPage();
    const [ana] = await screen.findAllByTestId("student-card");
    expect(queryMenuAction("Responsáveis de Ana Souza", ana!)).not.toBeNull();
    expect(queryMenuAction("Inativar", ana!)).toBeNull();
    fireEvent.click(within(ana!).getByRole("button", { name: "Editar Ana Souza" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Nome")).toHaveValue("Ana Souza"));
  });

  it("no desktop (>= md) o card largo continua igual (foto grande, ações com texto)", async () => {
    setWidth(1280);
    mockApi();
    renderPage();
    const [ana] = await screen.findAllByTestId("student-card");
    expect(ana).not.toHaveAttribute("data-compact");
    expect(within(ana!).getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(within(ana!).getByRole("button", { name: "Responsáveis de Ana Souza" })).toBeInTheDocument();
  });
});
