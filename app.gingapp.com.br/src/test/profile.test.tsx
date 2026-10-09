import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildProfilePayload } from "@/lib/derive";
import type { Student } from "@/lib/queries";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { ProfileForm } from "@/components/gingapp/profile";

const empty = { photo: "", coverPhoto: "", instagram: "", youtube: "", tiktok: "", facebook: "", whatsapp: "" };

describe("buildProfilePayload", () => {
  it("campos vazios viram null (limpa no servidor), nunca undefined", () => {
    expect(buildProfilePayload(empty)).toEqual({ photo: null, coverPhoto: null, socialLinks: null });
    expect(buildProfilePayload({ ...empty, photo: "   ", instagram: "  " })).toEqual({
      photo: null,
      coverPhoto: null,
      socialLinks: null,
    });
  });

  it("redes: reenvia só as preenchidas (sem a chave das removidas) e faz trim", () => {
    const payload = buildProfilePayload({
      ...empty,
      photo: " https://x.com/a.jpg ",
      instagram: "https://instagram.com/a",
      whatsapp: "https://wa.me/5511999999999",
    });
    expect(payload).toEqual({
      photo: "https://x.com/a.jpg",
      coverPhoto: null,
      socialLinks: { instagram: "https://instagram.com/a", whatsapp: "https://wa.me/5511999999999" },
    });
    expect(Object.keys(payload.socialLinks ?? {})).toEqual(["instagram", "whatsapp"]);
  });
});

const student: Student = {
  id: 7,
  userId: 3,
  unitId: null,
  name: "Ana",
  photo: "https://img.test/foto.jpg",
  coverPhoto: "https://img.test/capa.jpg",
  socialLinks: { instagram: "https://instagram.com/ana", youtube: "https://youtube.com/@ana" },
  joinedAt: null,
};

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

// Sem @testing-library/dom instalado (peer do RTL ausente no lockfile): react-dom + act bastam.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderForm(s: Student = student) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <ProfileForm student={s} />
      </QueryClientProvider>,
    );
  });
  return { invalidate };
}

const byLabel = (text: string) => {
  const label = [...container!.querySelectorAll("label")].find((l) => l.textContent === text);
  return container!.querySelector<HTMLInputElement>(`#${label!.htmlFor}`)!;
};
const button = (name: string | RegExp) =>
  [...container!.querySelectorAll("button")].find((b) => {
    const accessible = b.getAttribute("aria-label") ?? b.textContent ?? "";
    return typeof name === "string" ? accessible === name : name.test(accessible);
  });
const click = (name: string | RegExp) => {
  const el = button(name);
  expect(el, `botão ${String(name)}`).toBeTruthy();
  act(() => el!.click());
};
const typeInto = (input: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const waitFor = (assertion: () => void) =>
  act(async () => {
    await vi.waitFor(assertion, { timeout: 2000 });
  });

const sentBody = (fetchMock: ReturnType<typeof mockFetch>) => {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toMatch(/\/students\/me\/profile$/);
  expect(init.method).toBe("PATCH");
  return JSON.parse(init.body as string) as Record<string, unknown>;
};

describe("ProfileForm: limpar foto, capa e redes", () => {
  beforeEach(() => {
    localStorage.clear();
    toastMock.success.mockClear();
    toastMock.error.mockClear();
  });
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.unstubAllGlobals();
  });

  it("esvaziar foto e capa envia null; rede removida sai do objeto; invalida a query de alunos", async () => {
    const fetchMock = mockFetch(200, {});
    const { invalidate } = renderForm();

    typeInto(byLabel("Foto (URL)"), "");
    click("Remover foto de capa");
    click("Remover YouTube");
    click(/Salvar alterações/);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(fetchMock)).toEqual({
      photo: null,
      coverPhoto: null,
      socialLinks: { instagram: "https://instagram.com/ana" },
    });
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Perfil atualizado."));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["students"] });
  });

  it("remover todas as redes envia socialLinks: null (foto/capa intactas)", async () => {
    const fetchMock = mockFetch(200, {});
    renderForm();
    click("Remover Instagram");
    click("Remover YouTube");
    click(/Salvar alterações/);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(fetchMock)).toEqual({
      photo: "https://img.test/foto.jpg",
      coverPhoto: "https://img.test/capa.jpg",
      socialLinks: null,
    });
  });

  it("o botão Remover só aparece em campos preenchidos e limpa o campo", () => {
    mockFetch(200, {});
    renderForm();
    expect(button("Remover TikTok")).toBeUndefined();
    const photo = byLabel("Foto (URL)");
    expect(photo.value).toBe("https://img.test/foto.jpg");
    click("Remover foto");
    expect(byLabel("Foto (URL)").value).toBe("");
    expect(button("Remover foto")).toBeUndefined();
  });

  it("400 do backend é exibido ao usuário e a query não é invalidada", async () => {
    const fetchMock = mockFetch(400, { message: ["socialLinks.instagram must be a URL address"] });
    const { invalidate } = renderForm();
    click(/Salvar alterações/);

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("socialLinks.instagram must be a URL address"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});