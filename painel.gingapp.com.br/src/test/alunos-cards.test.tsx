import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, loginAs } from "./login-as";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AlunosPage } from "@/modules/alunos/alunos-page";
import { STUDENTS_VIEW_KEY, readStudentsView } from "@/modules/alunos/students-view";
import { queryMenuAction } from "./row-menu";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string; query: URLSearchParams };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const PHOTO = "https://exemplo.com/ana.jpg";
const students = [
  { id: 1, unitId: 7, userId: 50, name: "Ana Souza", birthDate: "1990-05-10T00:00:00.000Z", document: null, phone: "11999", email: "ana@x.com", photo: PHOTO, status: "ACTIVE", joinedAt: null },
  { id: 2, unitId: null, userId: null, name: "José Álvaro", birthDate: null, document: null, phone: null, email: null, photo: null, status: "INACTIVE", joinedAt: null },
];

function mockApi() {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const [path = "", search = ""] = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
      calls.push({ method: init.method ?? "GET", path, query: new URLSearchParams(search) });
      if (path === "/students") return Promise.resolve(json(200, students, { "X-Total-Count": "2" }));
      if (path === "/units") return Promise.resolve(json(200, [{ id: 7, name: "Sede Centro" }], { "X-Total-Count": "1" }));
      if (path === "/units/7") return Promise.resolve(json(200, { id: 7, name: "Sede Centro" }));
      if (path === "/finance/billing") return Promise.resolve(json(200, [{ studentId: 1, monthlyFeeCents: 15000, dueDay: 10 }]));
      return Promise.resolve(json(404, { message: `sem rota ${path}` }));
    }),
  );
  return calls;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AlunosPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.removeItem(STUDENTS_VIEW_KEY);
  loginAs("MESTRE");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
  localStorage.removeItem(STUDENTS_VIEW_KEY);
});

describe("Alunos em cards", () => {
  it("padrão é Cards: foto grande com fade, iniciais quando não há foto, e todos os dados e ações do aluno", async () => {
    mockApi();
    renderPage();
    const cards = await screen.findAllByTestId("student-card");
    expect(cards).toHaveLength(2);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    const ana = within(cards[0]!);
    expect(ana.getByRole("heading", { name: "Ana Souza" })).toBeInTheDocument();
    expect(ana.getByAltText("Foto de Ana Souza")).toHaveAttribute("src", PHOTO);
    expect(ana.getByAltText("Foto de Ana Souza").className).toMatch(/object-cover/);
    expect(ana.getByText("Com acesso")).toBeInTheDocument();
    expect(ana.getByText("Ativo")).toBeInTheDocument();
    expect(await ana.findByText("Sede Centro")).toBeInTheDocument();
    expect(ana.getByText("11999")).toBeInTheDocument();
    expect(ana.getByText("ana@x.com")).toBeInTheDocument();
    expect(await ana.findByText(/R\$\s?150,00/)).toBeInTheDocument(); // mensalidade (finance:view)
    for (const name of ["Editar", "Acesso de Ana Souza", "Responsáveis de Ana Souza", "Inativar"]) {
      expect(ana.getByRole("button", { name })).toBeInTheDocument();
    }
    // o fade (gradiente até a cor do card) existe sobre a foto
    expect(within(ana.getByTestId("student-card-photo")).queryByText("AS")).not.toBeInTheDocument();
    expect(cards[0]!.querySelector('[class*="bg-linear-to"]')).not.toBeNull();

    // sem foto: iniciais grandes (mesmo fade), sem <img>
    const jose = within(cards[1]!);
    expect(jose.getByTestId("student-card-initials")).toHaveTextContent("JÁ");
    expect(cards[1]!.querySelector("img")).toBeNull();
    expect(jose.getByText("Sem acesso")).toBeInTheDocument();
    expect(jose.getByText("Inativo")).toBeInTheDocument();
    expect(jose.queryByRole("button", { name: "Inativar" })).not.toBeInTheDocument(); // já inativo
    // paginação/contagem continuam nos cards
    expect(screen.getByTestId("table-count")).toHaveTextContent("2 registros");
  });

  it("foto que falha ao carregar cai nas iniciais (sem imagem quebrada)", async () => {
    mockApi();
    renderPage();
    const [ana] = await screen.findAllByTestId("student-card");
    fireEvent.error(within(ana!).getByAltText("Foto de Ana Souza"));
    expect(within(ana!).getByTestId("student-card-initials")).toHaveTextContent("AS");
    expect(ana!.querySelector("img")).toBeNull();
  });

  it("alternador Cards | Tabela: troca a visão, mantém as ações e lembra a escolha em localStorage", async () => {
    mockApi();
    renderPage();
    await screen.findAllByTestId("student-card");
    const group = screen.getByRole("group", { name: "Modo de visualização" });
    expect(within(group).getByRole("button", { name: "Cards" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(group).getByRole("button", { name: "Tabela" }));
    const table = await screen.findByRole("table");
    expect(screen.queryByTestId("student-card")).not.toBeInTheDocument();
    expect(within(table).getByText("Ana Souza")).toBeInTheDocument();
    expect(queryMenuAction("Acesso de Ana Souza", table)).not.toBeNull(); // na tabela, as ações secundárias ficam no menu "⋯"
    expect(within(table).getByRole("button", { name: "Ficha de Ana Souza" })).toBeInTheDocument();
    expect(localStorage.getItem(STUDENTS_VIEW_KEY)).toBe("table");
    expect(readStudentsView()).toBe("table");
  });

  it("lembra a escolha: com 'table' salvo abre na tabela; e abrir o editor pelo card funciona", async () => {
    localStorage.setItem(STUDENTS_VIEW_KEY, "table");
    mockApi();
    const first = renderPage();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    first.unmount();

    localStorage.setItem(STUDENTS_VIEW_KEY, "cards");
    renderPage();
    const [ana] = await screen.findAllByTestId("student-card");
    fireEvent.click(within(ana!).getByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Nome")).toHaveValue("Ana Souza"));
  });

  it("PROFESSOR não vê 'Inativar' no card; localStorage indisponível não quebra (volta ao padrão cards)", async () => {
    loginAs("PROFESSOR");
    mockApi();
    const original = Storage.prototype.getItem;
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      if (key === STUDENTS_VIEW_KEY) throw new Error("bloqueado");
      return original.call(this, key);
    });
    renderPage();
    const [ana] = await screen.findAllByTestId("student-card");
    expect(within(ana!).queryByRole("button", { name: "Inativar" })).not.toBeInTheDocument();
    expect(within(ana!).getByRole("button", { name: "Editar" })).toBeInTheDocument();
    getItem.mockRestore();
  });
});
