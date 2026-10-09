import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { CertificadosPage } from "@/modules/certificados/certificados-page";
import { applyCertificateFilters, type Certificate } from "@/modules/certificados/certificate-utils";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const certs: Certificate[] = [
  { id: 1, studentId: 1, studentGraduationId: null, title: "Workshop Angola", issuedAt: "2024-03-10T00:00:00.000Z", verificationCode: "cabc123", fileUrl: null, student: { id: 1, name: "Ana Souza" } },
  { id: 2, studentId: 2, studentGraduationId: null, title: "Batizado", issuedAt: "2025-06-01T00:00:00.000Z", verificationCode: "cxyz789", fileUrl: "https://x.com/a.pdf", student: { id: 2, name: "Bia Lima" } },
];

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function setup(handler?: (url: string, init: RequestInit) => Response | undefined) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const custom = handler?.(url, init);
    if (custom) return custom;
    if (url.endsWith("/students")) return json(200, [{ id: 1, name: "Ana Souza" }, { id: 2, name: "Bia Lima" }]);
    if (url.endsWith("/certificates") && (init.method ?? "GET") === "GET") return json(200, certs);
    return json(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CertificadosPage />
    </QueryClientProvider>,
  );
  return fetchMock;
}

const calls = (m: ReturnType<typeof vi.fn>, method: string) =>
  m.mock.calls.filter((c) => ((c[1] as RequestInit | undefined)?.method ?? "GET") === method);

describe("CertificadosPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("filtro de período (util)", () => {
    expect(applyCertificateFilters(certs, { from: "2025-01-01", to: "" }).map((c) => c.id)).toEqual([2]);
    expect(applyCertificateFilters(certs, { from: "", to: "2024-12-31" }).map((c) => c.id)).toEqual([1]);
  });

  it("lista com data sem deslocar o dia e filtra por período", async () => {
    setup();
    await screen.findByText("Ana Souza");
    expect(screen.getByText("10/03/2024")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Emitido de"), { target: { value: "2025-01-01" } });
    expect(screen.queryByText("Ana Souza")).not.toBeInTheDocument();
    expect(screen.getByText("Bia Lima")).toBeInTheDocument();
  });

  it("busca por código de verificação", async () => {
    setup();
    await screen.findByText("Ana Souza");
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "xyz789" } });
    expect(screen.queryByText("Ana Souza")).not.toBeInTheDocument();
    expect(screen.getByText("Bia Lima")).toBeInTheDocument();
  });

  it("estados de erro e vazio", async () => {
    setup((url) => (url.endsWith("/certificates") ? json(500, { message: "Falhou." }) : undefined));
    expect(await screen.findByTestId("table-error")).toHaveTextContent("Falhou.");
  });

  it("vazio", async () => {
    setup((url) => (url.endsWith("/certificates") ? json(200, []) : undefined));
    expect(await screen.findByTestId("table-empty")).toHaveTextContent("Nenhum certificado emitido ainda.");
  });

  it("mostra código e link de verificação", async () => {
    setup();
    await screen.findByText("Ana Souza");
    const row = screen.getByText("Ana Souza").closest("tr")!;
    fireEvent.click(within(row).getByText("Verificação"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("cert-code")).toHaveTextContent("cabc123");
    expect(within(dialog).getByTestId("cert-link")).toHaveTextContent(/\/verificar\/cabc123$/);
  });

  it("valida e emite (POST /certificates)", async () => {
    const fetchMock = setup();
    await screen.findByText("Ana Souza");
    fireEvent.click(screen.getByText("Emitir certificado", { selector: "button" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText("Emitir"));
    expect(await within(dialog).findByText("Selecione o aluno.")).toBeInTheDocument();
    expect(within(dialog).getByText("Informe o título (mínimo 2 caracteres).")).toBeInTheDocument();
    expect(calls(fetchMock, "POST")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText("Aluno"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: " Roda de formatura " } });
    fireEvent.click(within(dialog).getByText("Emitir"));
    await waitFor(() => expect(calls(fetchMock, "POST")).toHaveLength(1));
    expect(JSON.parse((calls(fetchMock, "POST")[0] as [string, RequestInit])[1].body as string)).toEqual({
      studentId: 2,
      title: "Roda de formatura",
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Certificado emitido."));
  });

  it("edita (PATCH sem studentId)", async () => {
    const fetchMock = setup();
    await screen.findByText("Bia Lima");
    const row = screen.getByText("Bia Lima").closest("tr")!;
    fireEvent.click(within(row).getByText("Editar"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Título"), { target: { value: "Batizado 2025" } });
    fireEvent.click(within(dialog).getByText("Salvar"));
    await waitFor(() => expect(calls(fetchMock, "PATCH")).toHaveLength(1));
    const [url, init] = calls(fetchMock, "PATCH")[0] as [string, RequestInit];
    expect(url).toMatch(/\/certificates\/2$/);
    expect(JSON.parse(init.body as string)).toEqual({
      title: "Batizado 2025",
      issuedAt: "2025-06-01",
      fileUrl: "https://x.com/a.pdf",
    });
  });

  it("apaga só depois de confirmar", async () => {
    const fetchMock = setup();
    await screen.findByText("Ana Souza");
    const row = screen.getByText("Ana Souza").closest("tr")!;
    fireEvent.click(within(row).getByText("Apagar"));
    expect(calls(fetchMock, "DELETE")).toHaveLength(0);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByText("Apagar"));
    await waitFor(() => expect(calls(fetchMock, "DELETE")).toHaveLength(1));
    expect((calls(fetchMock, "DELETE")[0] as [string])[0]).toMatch(/\/certificates\/1$/);
  });
});
