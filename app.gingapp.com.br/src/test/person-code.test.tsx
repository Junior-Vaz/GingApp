import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersonCodeCard } from "@/components/gingapp/ficha-code-card";
import type { Student } from "@/lib/queries";

/** Ficha única: cartão "Meu código GingApp" no Perfil (backend mockado via fetch). */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CODE = "GING-7K3Q-9XPM";
const QR = "data:image/png;base64,iVBORw0KGgo=";
const student: Student = {
  id: 7,
  userId: 3,
  unitId: null,
  name: "Ana",
  photo: null,
  coverPhoto: null,
  socialLinks: null,
  joinedAt: null,
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let urls: string[] = [];
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

function mockApi(codeResponse: () => Response) {
  urls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).replace(/^https?:\/\/[^/]+\/api/, "");
      urls.push(path);
      if (path.startsWith("/students/me")) return json(200, [student]);
      if (path.startsWith("/people/me/code")) return codeResponse();
      return json(404, { message: `sem rota ${path}` });
    }),
  );
}

async function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <QueryClientProvider client={queryClient}>
        <PersonCodeCard />
      </QueryClientProvider>,
    ),
  );
  await settle();
  await settle();
}

const button = (name: RegExp) => [...container!.querySelectorAll("button")].find((b) => name.test(b.textContent ?? ""));

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
  localStorage.clear();
});

describe("PersonCodeCard", () => {
  it("mostra o código e o QR (recolhido até clicar em Mostrar QR), respeitando o aluno ativo", async () => {
    mockApi(() => json(200, { personId: 1, gingappCode: CODE, qrDataUrl: QR }));
    await mount();

    expect(container!.querySelector("[data-testid=person-code-value]")?.textContent).toBe(CODE);
    expect(container!.textContent).toContain("levar sua ficha");
    expect(urls).toContain("/people/me/code?studentId=7");
    expect(container!.querySelector("img")).toBeNull();

    act(() => button(/Mostrar QR/)!.click());
    const img = container!.querySelector("img");
    expect(img?.getAttribute("src")).toBe(QR);
    expect(img?.getAttribute("alt")).toContain(CODE);
  });

  it("Copiar chama o clipboard com o código e mostra 'Copiado'", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    mockApi(() => json(200, { personId: 1, gingappCode: CODE, qrDataUrl: QR }));
    await mount();

    await act(async () => button(/^Copiar$/)!.click());
    expect(writeText).toHaveBeenCalledWith(CODE);
    expect(button(/^Copiado$/)).toBeTruthy();
  });

  it("404 PERSON_NOT_FOUND: o cartão não aparece", async () => {
    mockApi(() => json(404, { code: "PERSON_NOT_FOUND", message: "Sem ficha" }));
    await mount();

    expect(urls.some((u) => u.startsWith("/people/me/code"))).toBe(true);
    expect(container!.querySelector("[data-testid=person-code-card]")).toBeNull();
    expect(container!.textContent).toBe("");
  });
});
