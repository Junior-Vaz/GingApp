import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isImageRef, validateImageFile } from "@/lib/uploads";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { ImageUploadControl } from "@/components/gingapp/image-upload";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UPLOADED = "/api/uploads/3f2b8c1e-5d4a-4c3b-9a7e-1b2c3d4e5f60.webp";

function Harness() {
  const [value, setValue] = useState("");
  return (
    <>
      <ImageUploadControl label="foto" value={value} onChange={setValue} />
      <output data-testid="valor">{value}</output>
    </>
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const fileOf = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });
const pick = (file: File) =>
  act(() => {
    const input = container!.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
const valor = () => container!.querySelector("[data-testid=valor]")!.textContent;

describe("ImageUploadControl (foto/capa do perfil no app)", () => {
  beforeEach(() => {
    localStorage.setItem("gingapp.token", "tok");
    toastMock.error.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Harness />));
  });
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.unstubAllGlobals();
  });

  it("envia o arquivo por POST /uploads (multipart), guarda o caminho devolvido e mostra a pré-visualização", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: UPLOADED }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    pick(fileOf("eu.png", "image/png"));

    // deixa o fetch simulado resolver e o React aplicar o setState (dentro de act)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(valor()).toBe(UPLOADED);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/uploads$/);
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
    expect(container!.querySelector("img")?.getAttribute("src")).toContain(UPLOADED);
  });

  it("formato e tamanho inválidos são recusados antes de enviar; helpers aceitam só o caminho de upload e URL http(s)", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    pick(fileOf("a.svg", "image/svg+xml"));
    pick(fileOf("b.jpg", "image/jpeg", 5 * 1024 * 1024 + 1));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledTimes(2);
    expect(valor()).toBe("");

    expect(isImageRef(UPLOADED)).toBe(true);
    expect(isImageRef("https://exemplo.com/a.png")).toBe(true);
    for (const bad of ["/api/uploads/../x.webp", "javascript:alert(1)", "foto.png"]) expect(isImageRef(bad)).toBe(false);
    expect(validateImageFile(fileOf("x.webp", "image/webp"))).toBeNull();
  });
});
