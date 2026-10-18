import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, vi } from "vitest";
import type { FormFieldDef, PublicForm } from "@/lib/inscricao";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

export const field = (o: Partial<FormFieldDef> & { key: string }): FormFieldDef => ({
  type: "SHORT_TEXT",
  label: o.key,
  helpText: null,
  required: false,
  options: null,
  validation: null,
  showIf: null,
  sectionId: 1, // o backend real manda o id da seção como NÚMERO
  order: 0,
  mapsTo: null,
  ...o,
});

export const FIELDS: FormFieldDef[] = [
  field({ key: "nome", label: "Nome completo", required: true, mapsTo: "name", order: 1 }),
  field({ key: "email", type: "EMAIL", label: "E-mail", required: true, mapsTo: "email", order: 2 }),
  field({ key: "cpf", type: "CPF", label: "CPF", required: true, mapsTo: "document", order: 3 }),
  field({ key: "tel", type: "PHONE", label: "Telefone", mapsTo: "phone", order: 4 }),
  field({ key: "nasc", type: "DATE", label: "Data de nascimento", mapsTo: "birthDate", order: 5 }),
  field({ key: "cat", type: "SINGLE_CHOICE", label: "Categoria", required: true, options: ["Adulto", "Infantil"], order: 6 }),
  field({ key: "mod", type: "MULTI_CHOICE", label: "Modalidades", options: ["Jogo", "Canto", "Percussão"], order: 7 }),
  field({ key: "grad", type: "SELECT", label: "Graduação", options: ["Amarela", "Verde"], order: 8 }),
  field({ key: "obs", type: "LONG_TEXT", label: "Observações", order: 9 }),
  field({ key: "idade", type: "NUMBER", label: "Peso (kg)", validation: { min: 10, max: 200 }, order: 10 }),
  field({ key: "menor", type: "SINGLE_CHOICE", label: "É menor de idade?", options: ["Sim", "Não"], order: 11 }),
  field({ key: "resp", label: "Nome do responsável", required: true, showIf: { fieldKey: "menor", equals: "Sim" }, sectionId: 2, order: 12 }),
  field({ key: "aviso", type: "INFO", label: "Atenção", helpText: "Leve documento com foto.", sectionId: 2, order: 13 }),
  field({ key: "ciente", type: "CONSENT", label: "Assumo os riscos da prática", required: true, sectionId: 2, order: 14 }),
  field({ key: "comp", type: "FILE", label: "Comprovante do Pix", required: true, sectionId: 3, order: 15 }),
];

export const makeForm = (o: Partial<PublicForm> = {}): PublicForm => ({
  slug: "campeonato",
  title: "1º Campeonato de Capoeira",
  intro: "Leia com atenção.\nRegras: https://exemplo.com/regras.",
  bannerUrl: null,
  status: "OPEN",
  isOpen: true,
  closedReason: null,
  event: { title: "Campeonato do Varjão", date: "2026-11-20T00:00:00.000Z", location: "Ginásio do Varjão, DF" },
  paymentMode: "PIX_MANUAL",
  priceCents: 2500,
  pix: { key: "11122233396", keyType: "CPF", beneficiary: "Grupo Capoeira Exemplo" },
  sections: [
    { id: 1, order: 0, title: "Dados do competidor", description: null },
    { id: 2, order: 1, title: "Responsável e termo", description: "Menores precisam de autorização." },
    { id: 3, order: 2, title: "Pagamento", description: null },
  ],
  fields: FIELDS,
  consent: { text: "Autorizo o uso dos meus dados para esta inscrição.", version: 1 },
  spotsLeft: 12,
  startedToken: "1760000000000.assinatura-do-servidor", // assinado pelo servidor; volta no POST no lugar de `startedAt`
  ...o,
});

export interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/** fetch falso por "METHOD /caminho" (sem prefixo /api nem query); registra método, headers e corpo. */
export function mockApi(routes: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?")[0] ?? "";
      const method = init.method ?? "GET";
      const rawBody = init.body;
      const call: Call = {
        method,
        path,
        headers: { ...(init.headers as Record<string, string> | undefined) },
        body: typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody,
      };
      calls.push(call);
      const handler = routes[`${method} ${path}`];
      return Promise.resolve(handler ? handler(call) : json(404, { message: "não mockado" }));
    }),
  );
  return calls;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
export const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

export function renderWith(ui: ReactNode, client = makeClient()) {
  if (!container) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() => root!.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>));
  return client;
}

export function cleanup() {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
}

/**
 * Espera a asserção passar, dando a cada volta um `act` curto: atualizações encadeadas (resposta da API -> efeito ->
 * novo estado) só são aplicadas quando o `act` termina, então um único `act` em volta do polling não as enxerga.
 */
export async function waitFor(assertion: () => void, timeout = 3000) {
  const end = Date.now() + timeout;
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() > end) throw error;
    }
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));
  }
}
export const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
export const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
export const byTestId = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
export const byLabelText = (label: string) => {
  const el = [...document.body.querySelectorAll("label")].find((l) => (l.textContent ?? "").replace(/\s+/g, " ").trim().startsWith(label));
  const target = el?.htmlFor ? document.getElementById(el.htmlFor) : (el?.querySelector("input,select,textarea") ?? null);
  expect(target, `campo com rótulo "${label}"`).toBeTruthy();
  return target as HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement;
};
export const buttonText = (name: RegExp) => [...document.body.querySelectorAll("button")].find((b) => name.test(b.textContent ?? ""));
export const click = (el: Element | null | undefined) => {
  expect(el, "elemento para clicar").toBeTruthy();
  return act(async () => (el as HTMLElement).click());
};

/** Digita num input/textarea/select controlado pelo React. */
export function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
  return act(async () => {
    descriptor!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

/** Escolhe um arquivo num <input type=file>. */
export function chooseFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  return act(async () => void input.dispatchEvent(new Event("change", { bubbles: true })));
}

export const pngFile = (name = "comprovante.png", size = 2048) => {
  const file = new File(["x"], name, { type: "image/png" });
  Object.defineProperty(file, "size", { value: size });
  return file;
};
