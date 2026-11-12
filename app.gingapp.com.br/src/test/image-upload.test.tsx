import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isImageRef, uploadImage, validateImageFile } from "@/lib/uploads";
import { PhotoError } from "@/lib/photo/types";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
const prepareMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/photo/prepare-image", () => ({ prepareImage: prepareMock }));

import { ImageUploadControl } from "@/components/gingapp/image-upload";
import { act, cleanup, fireEvent, render, screen, waitFor } from "./photo-dom";
import { fakeFile, installUrlMocks, type UrlMocks } from "./photo-test-utils";

const UPLOADED = "/api/uploads/3f2b8c1e-5d4a-4c3b-9a7e-1b2c3d4e5f60.webp";
const OUT = new Blob([new Uint8Array(2000)], { type: "image/webp" });

let urls: UrlMocks;

function Harness({ shape, initial = "", label = "foto" }: { shape?: "square" | "wide"; initial?: string; label?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ImageUploadControl label={label} value={value} onChange={setValue} {...(shape ? { shape } : {})} />
      <output data-testid="valor">{value}</output>
    </>
  );
}

const valor = () => screen.getByTestId("valor").textContent;
const fileInput = () => screen.getByTestId("photo-file-input") as HTMLInputElement;

function loadCropImage(width = 3000, height = 4000) {
  const img = screen.getByTestId("crop-image") as HTMLImageElement;
  Object.defineProperty(img, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(img, "naturalHeight", { configurable: true, value: height });
  fireEvent.load(img);
}

async function cropAndConfirm(file = fakeFile("eu.png", "image/png")) {
  fireEvent.change(fileInput(), { target: { files: [file] } });
  await screen.findByRole("dialog", { name: "Ajustar foto" });
  loadCropImage();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Usar esta foto" }));
  });
}

describe("ImageUploadControl (foto/capa do perfil no app, com PhotoPicker)", () => {
  beforeEach(() => {
    localStorage.setItem("gingapp.token", "tok");
    toastMock.error.mockClear();
    prepareMock.mockReset();
    prepareMock.mockResolvedValue(OUT);
    urls = installUrlMocks();
  });
  afterEach(() => {
    cleanup();
    urls.restore();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("foto do perfil (square): enviar ou tirar na hora; recorta, comprime e envia por POST /uploads como foto.webp; guarda o caminho devolvido", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: UPLOADED }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness />);
    expect(screen.getByTestId("photo-picker").getAttribute("data-shape")).toBe("square");
    expect(screen.getByRole("button", { name: "Enviar foto" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tirar foto/ })).toBeInTheDocument();

    await cropAndConfirm();
    await waitFor(() => expect(valor()).toBe(UPLOADED));

    expect(prepareMock).toHaveBeenCalledTimes(1);
    expect((prepareMock.mock.calls[0]?.[1] as { shape: string }).shape).toBe("square");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/uploads$/);
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const sent = (init.body as FormData).get("file") as File;
    expect(sent.name).toBe("foto.webp"); // nunca o nome do arquivo do celular
    expect(sent.type).toBe("image/webp");
    expect(sent.size).toBe(OUT.size);
    expect(screen.getByAltText("Pré-visualização: foto").getAttribute("src")).toContain(UPLOADED);
  });

  it("foto grande do celular (12 MB) NÃO é recusada: vai para o recorte e a compressão; nenhuma mensagem de 'excede 5 MB'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: UPLOADED }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness />);
    const big = fakeFile("IMG_9999.jpg", "image/jpeg");
    Object.defineProperty(big, "size", { value: 12 * 1024 * 1024 });
    await cropAndConfirm(big);
    await waitFor(() => expect(valor()).toBe(UPLOADED));
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/5 MB/);
    // o que sobe é o Blob já comprimido, não os 12 MB originais
    expect(((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData).get("file")).toHaveProperty("size", OUT.size);
  });

  it("capa (wide): sem câmera nem recorte, só compressão (lado maior 1600) e envio", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: UPLOADED }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness shape="wide" label="foto de capa" />);
    expect(screen.getByTestId("photo-picker").getAttribute("data-shape")).toBe("wide");
    expect(screen.queryByRole("button", { name: /Tirar foto/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Enviar imagem" })).toBeInTheDocument();

    fireEvent.change(fileInput(), { target: { files: [fakeFile("capa.jpg")] } });
    await waitFor(() => expect(valor()).toBe(UPLOADED));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((prepareMock.mock.calls[0]?.[1] as { shape: string }).shape).toBe("wide");
    expect(((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData).get("file")).toBeInstanceOf(Blob);
  });

  it("formato que o navegador não consegue ler: mensagem em português no campo (nada de rede)", async () => {
    prepareMock.mockRejectedValue(new PhotoError("UNSUPPORTED_FORMAT", "x"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness shape="wide" label="foto de capa" />);
    fireEvent.change(fileInput(), { target: { files: [fakeFile("a.svg", "image/svg+xml")] } });
    await waitFor(() => expect(screen.getByTestId("photo-error").textContent).toMatch(/Formato de imagem não suportado/));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(valor()).toBe("");
  });

  it("falha no POST /uploads: aviso (toast), a foto anterior continua e nada é gravado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Falha no servidor" }), { status: 500 })));
    render(<Harness initial={UPLOADED} />);
    await cropAndConfirm();
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(valor()).toBe(UPLOADED);
    expect(screen.getByAltText("Pré-visualização: foto").getAttribute("src")).toContain(UPLOADED);
  });

  it("Remover limpa o valor (para salvar sem foto) e some com a pré-visualização", async () => {
    render(<Harness initial={UPLOADED} />);
    expect(screen.getByAltText("Pré-visualização: foto")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remover/ }));
    });
    expect(valor()).toBe("");
    expect(screen.queryByAltText("Pré-visualização: foto")).toBeNull();
  });

  it("Blob URLs da pré-visualização são revogadas ao desmontar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: UPLOADED }), { status: 201 })));
    const view = render(<Harness />);
    await cropAndConfirm();
    await waitFor(() => expect(valor()).toBe(UPLOADED));
    view.unmount();
    for (const url of urls.created) expect(urls.revoked, url).toContain(url);
  });
});

describe("lib/uploads: Blob com nome foto.webp e helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("uploadImage aceita um Blob (vai como foto.webp, ou foto.jpg no JPEG de reserva) e mantém o nome de um File", async () => {
    localStorage.setItem("gingapp.token", "tok");
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ url: UPLOADED }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const bodyOf = (index: number) => ((fetchMock.mock.calls[index] as [string, RequestInit])[1].body as FormData).get("file") as File;

    expect(await uploadImage(new Blob([new Uint8Array(10)], { type: "image/webp" }))).toBe(UPLOADED);
    expect(bodyOf(0).name).toBe("foto.webp");
    await uploadImage(new Blob([new Uint8Array(10)], { type: "image/jpeg" }));
    expect(bodyOf(1).name).toBe("foto.jpg");
    await uploadImage(fakeFile("minha.png", "image/png"));
    expect(bodyOf(2).name).toBe("minha.png");
  });

  it("uploadImage ainda recusa o que o servidor recusaria (tipo e tamanho > 5 MB) antes de gastar rede", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(uploadImage(new Blob([new Uint8Array(10)], { type: "image/svg+xml" }))).rejects.toThrow(/Formato não suportado/);
    await expect(uploadImage(new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/webp" }))).rejects.toThrow(/5 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("helpers aceitam só o caminho de upload e URL http(s)", () => {
    expect(isImageRef(UPLOADED)).toBe(true);
    expect(isImageRef("https://exemplo.com/a.png")).toBe(true);
    for (const bad of ["/api/uploads/../x.webp", "javascript:alert(1)", "foto.png"]) expect(isImageRef(bad)).toBe(false);
    expect(validateImageFile(fakeFile("x.webp", "image/webp"))).toBeNull();
    expect(validateImageFile({ type: "image/webp", size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
  });
});
