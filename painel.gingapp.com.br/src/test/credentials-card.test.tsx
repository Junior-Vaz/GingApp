import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { CredentialsCard } from "@/components/painel/credentials-card";
import { credentialsMessage, whatsappLink } from "@/lib/credentials";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PASSWORD = "Berimbau-Axe-4821";
const EMAIL = "ana@x.com";
const MESSAGE =
  "App GingApp: https://app.gingapp.com.br — Login: ana@x.com — Senha provisória: Berimbau-Axe-4821 (você troca no primeiro acesso)";

function stubClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

beforeEach(() => {
  vi.stubEnv("VITE_APP_URL", "https://app.gingapp.com.br");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("credentials: texto e link do WhatsApp", () => {
  it("mensagem pronta com a URL do app, login e senha", () => {
    expect(credentialsMessage(EMAIL, PASSWORD)).toBe(MESSAGE);
  });

  it("telefone BR com DDD ganha 55; já com 55 não duplica; texto vai codificado", () => {
    const text = "olá & tchau";
    const encoded = encodeURIComponent(text);
    expect(whatsappLink("(11) 99999-8888", text)).toBe(`https://wa.me/5511999998888?text=${encoded}`);
    expect(whatsappLink("1133334444", text)).toBe(`https://wa.me/551133334444?text=${encoded}`);
    expect(whatsappLink("+55 11 99999-8888", text)).toBe(`https://wa.me/5511999998888?text=${encoded}`);
  });

  it("sem telefone (ou fora do padrão) abre o WhatsApp para escolher o contato", () => {
    expect(whatsappLink(null, "x")).toBe("https://wa.me/?text=x");
    expect(whatsappLink("", "x")).toBe("https://wa.me/?text=x");
    expect(whatsappLink("99999", "x")).toBe("https://wa.me/?text=x");
  });
});

describe("CredentialsCard", () => {
  it("mostra título, nome, login e a senha em fonte monoespaçada, sem esconder, com o aviso de anotar", () => {
    render(<CredentialsCard title="Aluno cadastrado" name="Ana Souza" email={EMAIL} password={PASSWORD} phone="11999998888" />);
    expect(screen.getByRole("status")).toHaveTextContent("Aluno cadastrado");
    expect(screen.getByText("Ana Souza")).toBeInTheDocument();
    expect(screen.getByTestId("credentials-email")).toHaveTextContent(EMAIL);
    const password = screen.getByTestId("credentials-password");
    expect(password).toHaveTextContent(PASSWORD);
    expect(password.className).toContain("font-mono");
    expect(screen.getByText(/Anote agora: a senha não será mostrada de novo\. O aluno troca no primeiro acesso\./)).toBeInTheDocument();
  });

  it("recebe o foco ao aparecer", () => {
    render(<CredentialsCard title="t" name="Ana" email={EMAIL} password={PASSWORD} />);
    expect(screen.getByTestId("credentials-card")).toHaveFocus();
  });

  it("Copiar senha / Copiar login e senha chamam o clipboard com o texto certo", async () => {
    const writeText = stubClipboard();
    render(<CredentialsCard title="t" name="Ana" email={EMAIL} password={PASSWORD} />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar senha" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PASSWORD));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Senha copiada."));
    fireEvent.click(screen.getByRole("button", { name: "Copiar login e senha" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MESSAGE));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Login e senha copiados."));
  });

  it("clipboard negado vira toast de erro (sem quebrar)", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("negado")));
    render(<CredentialsCard title="t" name="Ana" email={EMAIL} password={PASSWORD} />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar senha" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Não foi possível copiar")));
  });

  it("Enviar por WhatsApp: link wa.me/55<telefone> com o texto codificado, em nova aba", () => {
    render(<CredentialsCard title="t" name="Ana" email={EMAIL} password={PASSWORD} phone="(11) 99999-8888" />);
    const link = screen.getByRole("link", { name: "Enviar por WhatsApp" });
    expect(link).toHaveAttribute("href", `https://wa.me/5511999998888?text=${encodeURIComponent(MESSAGE)}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("sem telefone: wa.me/?text= para escolher o contato", () => {
    render(<CredentialsCard title="t" name="Ana" email={EMAIL} password={PASSWORD} />);
    expect(screen.getByRole("link", { name: "Enviar por WhatsApp" })).toHaveAttribute(
      "href",
      `https://wa.me/?text=${encodeURIComponent(MESSAGE)}`,
    );
  });

  it("renderiza os botões de ação recebidos (children)", () => {
    render(
      <CredentialsCard title="t" name="Ana" email={EMAIL} password={PASSWORD}>
        <button type="button">Concluir</button>
      </CredentialsCard>,
    );
    expect(within(screen.getByTestId("credentials-card")).getByRole("button", { name: "Concluir" })).toBeInTheDocument();
  });
});
