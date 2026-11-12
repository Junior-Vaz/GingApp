import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { toast } from "sonner";

// Compressão/recorte (canvas) não existe no jsdom: o teste controla o que `prepareImage` devolve.
const prepareMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/photo/prepare-image", () => ({ prepareImage: prepareMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ImageUploader, WIDE_IMAGE_MAX_BYTES } from "@/components/painel/image-upload-field";
import { imageSrc, isImageRef, uploadFileName, uploadImage, validateImageFile } from "@/lib/uploads";
import { clearSession } from "@/lib/session";
import { loginAs } from "./login-as";
import { fakeFile } from "./photo-test-utils";
import { PREPARED, chooseInPicker, installPhotoMocks, pickSquarePhoto, restorePhotoMocks } from "./photo-flow";

const UPLOADED = "/api/uploads/3f2b8c1e-5d4a-4c3b-9a7e-1b2c3d4e5f60.webp";

function Harness({ initial = "", shape }: { initial?: string; shape?: "wide" | "square" }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ImageUploader
        value={value}
        onChange={setValue}
        label="Foto do aluno"
        previewAlt="Foto do aluno"
        {...(shape ? { shape } : {})}
      />
      <output data-testid="valor">{value}</output>
    </>
  );
}

const fileOf = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });

function uploadFetch() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: UPLOADED }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  loginAs("MESTRE");
  installPhotoMocks();
  prepareMock.mockReset();
  prepareMock.mockImplementation(async () => PREPARED());
});
afterEach(() => {
  restorePhotoMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("ImageUploader wide (logo/capa/banner): SÓ comprime antes de enviar", () => {
  it("comprime no navegador (sem câmera nem recorte), envia o Blob por POST /uploads como foto.webp, grava o caminho e mostra a pré-visualização; Remover limpa", async () => {
    const fetchMock = uploadFetch();
    render(<Harness />);
    expect(screen.queryByRole("button", { name: /Tirar foto/ })).not.toBeInTheDocument();

    const original = fileOf("logo-enorme.png", "image/png", 6 * 1024 * 1024);
    chooseInPicker(original);
    await waitFor(() => expect(screen.getByTestId("valor")).toHaveTextContent(UPLOADED));

    // a ORIGINAL nunca vai ao servidor: só o resultado da compressão
    expect(prepareMock).toHaveBeenCalledWith(original, { shape: "wide", maxBytes: WIDE_IMAGE_MAX_BYTES });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); // sem recorte
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/uploads$/);
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const sent = (init.body as FormData).get("file") as File;
    expect(sent).toBeInstanceOf(File);
    expect(sent.name).toBe("foto.webp");
    expect(sent.size).toBe(1500);
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
    expect(await screen.findByAltText("Foto do aluno")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Remover/ }));
    expect(screen.getByTestId("valor")).toHaveTextContent("");
    expect(screen.queryByAltText("Foto do aluno")).not.toBeInTheDocument();
  });

  it("imagem de 6 MB não gera mais a mensagem de 'excede 5 MB': a compressão resolve; quando NÃO resolve, o erro é claro e nada é enviado", async () => {
    const fetchMock = uploadFetch();
    render(<Harness />);
    chooseInPicker(fileOf("grande.jpg", "image/jpeg", 6 * 1024 * 1024));
    await waitFor(() => expect(screen.getByTestId("valor")).toHaveTextContent(UPLOADED));
    expect(screen.queryByText(/5 MB/)).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();

    fetchMock.mockClear();
    prepareMock.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ENCODE_FAILED" }));
    chooseInPicker(fileOf("impossivel.jpg", "image/jpeg", 6 * 1024 * 1024));
    expect((await screen.findByTestId("photo-error")).textContent).toMatch(/preparar a foto/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("o link manual continua valendo (e não passa pelo servidor)", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Link da imagem: Foto do aluno"), { target: { value: "https://exemplo.com/f.jpg" } });
    expect(screen.getByTestId("valor")).toHaveTextContent("https://exemplo.com/f.jpg");
    expect(screen.getByAltText("Foto do aluno")).toHaveAttribute("src", "https://exemplo.com/f.jpg");
  });

  it("falha do servidor no envio: toast de erro e o valor não muda", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Falhou" }), { status: 500 })));
    render(<Harness />);
    chooseInPicker(fileOf("a.png", "image/png"));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByTestId("valor")).toHaveTextContent("");
  });
});

describe("ImageUploader square (foto de pessoa): câmera + recorte, sem link", () => {
  it("oferece 'Tirar foto', recorta em quadrado e envia o Blob pronto (foto.webp); não há campo de link", async () => {
    const fetchMock = uploadFetch();
    render(<Harness shape="square" />);
    expect(screen.getByRole("button", { name: /Tirar foto/ })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Link da imagem/)).not.toBeInTheDocument();

    await pickSquarePhoto(fakeFile("eu.jpg"));
    await waitFor(() => expect(screen.getByTestId("valor")).toHaveTextContent(UPLOADED));
    const [, opts] = prepareMock.mock.calls[0] as [Blob, { shape: string; maxBytes: number; crop: object }];
    expect(opts.shape).toBe("square");
    expect(opts.maxBytes).toBe(400 * 1024);
    expect(opts.crop).toBeDefined();
    const sent = ((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData).get("file") as File;
    expect(sent.name).toBe("foto.webp");
    expect(sent.type).toBe("image/webp");
  });
});

describe("helpers de upload", () => {
  it("caminho de upload e URL http(s) são válidos; outras coisas não; imageSrc só prefixa o caminho de upload", () => {
    expect(isImageRef(UPLOADED)).toBe(true);
    expect(isImageRef("https://exemplo.com/a.png")).toBe(true);
    for (const bad of ["/api/uploads/../x.webp", "ftp://x.com/a.png", "javascript:alert(1)", "foto.png"]) expect(isImageRef(bad)).toBe(false);
    expect(imageSrc("https://exemplo.com/a.png")).toBe("https://exemplo.com/a.png");
    expect(imageSrc(UPLOADED).endsWith(UPLOADED)).toBe(true);
    expect(imageSrc(null)).toBe("");
    expect(validateImageFile(fileOf("x.webp", "image/webp"))).toBeNull();
  });

  it("uploadImage aceita o Blob do PhotoPicker e o nomeia foto.webp (ou .jpg/.png pelo tipo); File mantém o nome", async () => {
    const fetchMock = uploadFetch();
    expect(uploadFileName(new Blob([new Uint8Array(3)], { type: "image/webp" }))).toBe("foto.webp");
    expect(uploadFileName(new Blob([new Uint8Array(3)], { type: "image/jpeg" }))).toBe("foto.jpg");
    expect(uploadFileName(new Blob([new Uint8Array(3)], { type: "image/png" }))).toBe("foto.png");
    expect(uploadFileName(fileOf("minha.png", "image/png"))).toBe("minha.png");
    await expect(uploadImage(new Blob([new Uint8Array(30)], { type: "image/jpeg" }))).resolves.toBe(UPLOADED);
    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect((form.get("file") as File).name).toBe("foto.jpg");
  });

  it("uploadImage ainda recusa o que o servidor recusaria (tipo, vazio, > 5 MB) sem gastar rede", async () => {
    const fetchMock = uploadFetch();
    await expect(uploadImage(new Blob([new Uint8Array(5)], { type: "image/gif" }))).rejects.toThrow(/Formato não suportado/);
    await expect(uploadImage(new Blob([], { type: "image/webp" }))).rejects.toThrow(/vazio/);
    expect(validateImageFile(fileOf("b.png", "image/png", 5 * 1024 * 1024 + 1))).toMatch(/5 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
