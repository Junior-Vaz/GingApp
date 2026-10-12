import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { toast } from "sonner";
import { ImageUploader } from "@/components/painel/image-upload-field";
import { imageSrc, isImageRef, validateImageFile } from "@/lib/uploads";
import { clearSession } from "@/lib/session";
import { loginAs } from "./login-as";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const UPLOADED = "/api/uploads/3f2b8c1e-5d4a-4c3b-9a7e-1b2c3d4e5f60.webp";

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ImageUploader value={value} onChange={setValue} label="Foto do aluno" previewAlt="Foto do aluno" />
      <output data-testid="valor">{value}</output>
    </>
  );
}

const fileOf = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });

beforeEach(() => loginAs("MESTRE"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("ImageUploader (envio de imagem pelo painel)", () => {
  it("envia o arquivo por POST /uploads (multipart, com token), grava o caminho devolvido e mostra a pré-visualização; Remover limpa", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: UPLOADED }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness />);

    fireEvent.change(screen.getByTestId("image-file-input"), { target: { files: [fileOf("foto.png", "image/png")] } });

    await waitFor(() => expect(screen.getByTestId("valor")).toHaveTextContent(UPLOADED));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/uploads$/);
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
    expect(await screen.findByAltText("Foto do aluno")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Remover/ }));
    expect(screen.getByTestId("valor")).toHaveTextContent("");
    expect(screen.queryByAltText("Foto do aluno")).not.toBeInTheDocument();
  });

  it("recusa formato e tamanho inválidos ANTES de enviar (toast), e a URL manual continua valendo", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness />);

    fireEvent.change(screen.getByTestId("image-file-input"), { target: { files: [fileOf("a.gif", "image/gif")] } });
    fireEvent.change(screen.getByTestId("image-file-input"), { target: { files: [fileOf("b.png", "image/png", 5 * 1024 * 1024 + 1)] } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(2);

    fireEvent.change(screen.getByLabelText("Foto do aluno"), { target: { value: "https://exemplo.com/f.jpg" } });
    expect(screen.getByTestId("valor")).toHaveTextContent("https://exemplo.com/f.jpg");
    expect(screen.getByAltText("Foto do aluno")).toHaveAttribute("src", "https://exemplo.com/f.jpg");
  });

  it("helpers: caminho de upload e URL http(s) são válidos; outras coisas não; imageSrc só prefixa o caminho de upload", () => {
    expect(isImageRef(UPLOADED)).toBe(true);
    expect(isImageRef("https://exemplo.com/a.png")).toBe(true);
    for (const bad of ["/api/uploads/../x.webp", "ftp://x.com/a.png", "javascript:alert(1)", "foto.png"]) expect(isImageRef(bad)).toBe(false);
    expect(imageSrc("https://exemplo.com/a.png")).toBe("https://exemplo.com/a.png");
    expect(imageSrc(UPLOADED).endsWith(UPLOADED)).toBe(true);
    expect(imageSrc(null)).toBe("");
    expect(validateImageFile(fileOf("x.webp", "image/webp"))).toBeNull();
  });
});
