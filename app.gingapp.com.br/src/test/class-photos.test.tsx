import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children, to, className }: { children?: React.ReactNode; to?: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

import { ClassesPage } from "@/components/gingapp/pages";
import { HomePage } from "@/components/gingapp/home";
import { ClassCover } from "@/components/gingapp/class-parts";
import { resolveClassInfo } from "@/lib/derive";
import type { ClassItem, Lesson } from "@/lib/queries";

/**
 * Fotos de treinos (turma), unidades e professores: o cartão da aula mostra a foto da turma, a miniatura da unidade e o
 * professor com avatar; sem os campos novos do backend (ou com foto quebrada) cai em iniciais/ícone, sem imagem
 * quebrada e sem erro.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

type Handler = (path: string, url: URL) => unknown;
function mockApi(handler: Handler) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input).replace(/^.*\/api/, "http://x"));
      return new Response(JSON.stringify(handler(url.pathname, url) ?? []), { status: 200 });
    }),
  );
}

function render(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>));
}

const waitFor = (assertion: () => void) => act(async () => void (await vi.waitFor(assertion, { timeout: 3000 })));
const text = () => (container?.textContent ?? "").replace(/\u00a0/g, " ");

beforeEach(() => localStorage.clear());
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

const FUTURE = "2099-01-01T00:00:00.000Z";
const baseLesson: Lesson = {
  id: 1,
  classId: 1,
  unitId: 5,
  teacherUserId: 9,
  date: FUTURE,
  startTime: "19:00",
  endTime: "20:30",
  notes: null,
  status: "ACTIVE",
};
const baseClass: ClassItem = {
  id: 1,
  name: "Adulto Noite",
  description: null,
  weekday: 4,
  startTime: "19:00",
  endTime: "20:30",
  unitId: 5,
};
const withPhotos: Lesson = {
  ...baseLesson,
  class: { id: 1, name: "Adulto Noite", photo: "https://img.test/turma.jpg" },
  unit: { id: 5, name: "Matriz", photo: "https://img.test/unidade.jpg" },
  teacher: { id: 9, name: "Mestre Bimba Filho", photo: "https://img.test/prof.jpg" },
};

const srcs = () => [...container!.querySelectorAll("img")].map((img) => img.getAttribute("src"));

describe("resolveClassInfo", () => {
  it("junta aula + turma e prefere os dados da aula; sem campos novos mantém o comportamento antigo", () => {
    const rich = resolveClassInfo(withPhotos, [{ ...baseClass, name: "Outro nome" }], { name: "Passaporte" });
    expect(rich).toMatchObject({
      name: "Adulto Noite",
      photo: "https://img.test/turma.jpg",
      unit: { name: "Matriz", photo: "https://img.test/unidade.jpg" },
      teacher: { name: "Mestre Bimba Filho", photo: "https://img.test/prof.jpg" },
      time: "19:00 – 20:30",
    });
    const plain = resolveClassInfo({ ...baseLesson, startTime: null, endTime: null }, [baseClass], { name: "Matriz", photo: null });
    expect(plain).toEqual({ name: "Adulto Noite", photo: null, unit: { name: "Matriz", photo: null }, teacher: null, time: "19:00 – 20:30" });
    expect(resolveClassInfo(null, undefined)).toEqual({ name: "Aula", photo: null, unit: null, teacher: null, time: "" });
  });
});

describe("ClassCover", () => {
  it("mostra a foto; foto quebrada (onError) ou ausente vira iniciais da turma", () => {
    render(<ClassCover name="Adulto Noite" src="https://img.test/turma.jpg" />);
    const img = container!.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://img.test/turma.jpg");
    act(() => void img.dispatchEvent(new Event("error")));
    expect(container!.querySelector("img")).toBeNull();
    expect(container!.querySelector(".cls-cover-ini")?.textContent).toBe("AN");
  });
});

describe("Minhas aulas com fotos", () => {
  const api =
    (lesson: Lesson, cls: ClassItem): Handler =>
    (path, url) => {
      if (path === "/lessons/me") return url.searchParams.get("from") ? [lesson] : [];
      if (path === "/classes/me") return [cls];
      if (path === "/passport/me") return { student: { id: 1, name: "Aluno" }, organization: { name: "Grupo X" }, unit: { name: "Matriz" }, currentGraduation: null, stats: {}, publicProfile: null };
      return undefined;
    };

  it("cartão mostra foto da turma, miniatura redonda da unidade e professor com avatar", async () => {
    mockApi(api(withPhotos, { ...baseClass, photo: "https://img.test/turma.jpg" }));
    render(<ClassesPage />);
    await waitFor(() => expect(container!.querySelector('[data-testid="teacher-line"]')).toBeTruthy());
    expect(srcs()).toEqual(expect.arrayContaining(["https://img.test/turma.jpg", "https://img.test/unidade.jpg", "https://img.test/prof.jpg"]));
    expect(container!.querySelector('[data-testid="unit-line"] [data-testid="avatar"]')).toBeTruthy();
    expect(text()).toContain("Adulto Noite");
    expect(text()).toContain("Matriz");
    expect(text()).toContain("Mestre Bimba Filho");
    expect(text()).toContain("19:00 – 20:30");
  });

  it("sem os campos novos (backend antigo): sem professor, sem imagem, capa com iniciais e unidade do passaporte", async () => {
    mockApi(api(baseLesson, baseClass));
    render(<ClassesPage />);
    await waitFor(() => expect(text()).toContain("Adulto Noite"));
    await waitFor(() => expect(container!.querySelector('[data-testid="unit-line"]')).toBeTruthy());
    expect(container!.querySelector('[data-testid="teacher-line"]')).toBeNull();
    expect(container!.querySelectorAll("img")).toHaveLength(0);
    expect(container!.querySelector(".cls-cover.is-fallback .cls-cover-ini")?.textContent).toBe("AN");
    expect(text()).toContain("Matriz");
  });
});

describe("Home: próxima aula", () => {
  it("capa larga com a foto da turma, unidade e professor; sem foto usa o fallback e não quebra", async () => {
    const passport = { student: { id: 1, name: "Aluno" }, organization: { name: "Grupo X" }, unit: { name: "Matriz" }, currentGraduation: null, stats: { aulas: 0, rodas: 0, eventos: 0, graduacoes: 0, certificados: 0 }, publicProfile: null };
    mockApi((path) => {
      if (path === "/lessons/me") return [withPhotos];
      if (path === "/classes/me") return [{ ...baseClass, photo: "https://img.test/turma.jpg" }];
      if (path === "/passport/me") return passport;
      if (path === "/attendance/me") return { records: [], last30dPercent: null };
      return undefined;
    });
    render(<HomePage />);
    await waitFor(() => expect(container!.querySelector(".next-class")).toBeTruthy());
    await waitFor(() => expect(container!.querySelector(".next-class .cls-cover.is-wide img")).toBeTruthy());
    expect(container!.querySelector(".next-class .cls-cover.is-wide img")?.getAttribute("src")).toBe("https://img.test/turma.jpg");
    expect(container!.querySelector(".next-class [data-testid='teacher-line']")?.textContent).toContain("Mestre Bimba Filho");
    expect(container!.querySelector(".next-class [data-testid='unit-line']")?.textContent).toContain("Matriz");
  });

  it("sem fotos nem professor: cartão normal, capa de iniciais", async () => {
    mockApi((path) => {
      if (path === "/lessons/me") return [baseLesson];
      if (path === "/classes/me") return [baseClass];
      if (path === "/passport/me") return { student: { id: 1, name: "Aluno" }, organization: { name: "Grupo X" }, unit: { name: "Matriz" }, currentGraduation: null, stats: {}, publicProfile: null };
      return undefined;
    });
    render(<HomePage />);
    await waitFor(() => expect(container!.querySelector(".next-class")).toBeTruthy());
    expect(container!.querySelector(".next-class .cls-cover.is-fallback")).toBeTruthy();
    expect(container!.querySelector(".next-class [data-testid='teacher-line']")).toBeNull();
    expect(container!.querySelector(".next-class")?.textContent).toContain("Adulto Noite");
  });
});
