import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { applyReaction } from "@/lib/feed";
import type {
  CommentsPage,
  FeedComment,
  FeedPage,
  FeedPost,
  FeedSettings,
  ReactionSummary,
  ReactionType,
} from "@/lib/feed";

/** Apoio dos testes do feed (act + createRoot; API mockada por fetch). Não é um teste (sem sufixo .test). */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const json = (status: number, body?: unknown) =>
  body === undefined ? new Response(null, { status }) : new Response(JSON.stringify(body), { status });

export const emptyCounts = (): Record<ReactionType, number> => ({ AXE: 0, SALVE: 0, GINGA: 0, PARABENS: 0, CORACAO: 0 });

export function reactions(counts: Partial<Record<ReactionType, number>> = {}, mine: ReactionType | null = null): ReactionSummary {
  const full = { ...emptyCounts(), ...counts };
  return { counts: full, total: Object.values(full).reduce((sum, value) => sum + value, 0), mine };
}

export function makePost(over: Partial<FeedPost> = {}): FeedPost {
  return {
    id: 1,
    type: "POST",
    author: { userId: 10, name: "Ana Souza", nickname: "Aninha", photo: null, roleLabel: "Aluna" },
    body: "Treino de hoje foi ótimo",
    media: [],
    visibility: "GROUP",
    unitId: null,
    classId: null,
    pinned: false,
    status: "PUBLISHED",
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    edited: false,
    reactions: reactions(),
    commentsCount: 0,
    canEdit: false,
    canDelete: false,
    canModerate: false,
    ...over,
  };
}

export const makeMedia = (id: number, width = 1200, height = 900) => ({
  id,
  url: `/api/feed/media/${id}?e=9999999999&s=sig${id}`,
  thumbUrl: `/api/feed/media/${id}?e=9999999999&s=thumb${id}`,
  width,
  height,
});

export function makeComment(over: Partial<FeedComment> = {}): FeedComment {
  return {
    id: 100,
    parentId: null,
    author: { userId: 11, name: "Bruno Lima", nickname: null, photo: null, roleLabel: null },
    body: "Axé!",
    createdAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    canDelete: false,
    ...over,
  };
}

export const makeSettings = (over: Partial<FeedSettings> = {}): FeedSettings => ({
  enabled: true,
  postingMode: "MODERATED",
  canPost: true,
  allowComments: true,
  requiresApproval: false,
  ...over,
});

export interface ApiCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  form: FormData | null;
}

export interface MockState {
  calls: ApiCall[];
  settings: FeedSettings;
  /** Páginas do feed por cursor ("" = primeira). */
  pages: Record<string, FeedPage>;
  /** Comentários por post e cursor ("" = primeira). */
  comments: Record<number, Record<string, CommentsPage>>;
  classes: unknown[];
  /** Resposta própria por chamada (devolver undefined/null cai no comportamento padrão). */
  respond: ((call: ApiCall) => Response | undefined | null | Promise<Response | undefined | null>) | undefined;
  mediaSeq: number;
}

export function mockFeedApi(init: Partial<Omit<MockState, "calls" | "mediaSeq">> = {}): MockState {
  const state: MockState = {
    calls: [],
    settings: makeSettings(),
    pages: { "": { items: [], nextCursor: null } },
    comments: {},
    classes: [],
    respond: undefined,
    mediaSeq: 500,
    ...init,
  };
  const allPosts = () => Object.values(state.pages).flatMap((page) => page.items);

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, request?: RequestInit) => {
      const full = String(input).replace(/^https?:\/\/[^/]+\/api/, "");
      const [path = "", search = ""] = full.split("?");
      const method = request?.method ?? "GET";
      const rawBody = request?.body;
      const call: ApiCall = {
        method,
        path,
        query: new URLSearchParams(search),
        body: typeof rawBody === "string" ? JSON.parse(rawBody) : undefined,
        form: rawBody instanceof FormData ? rawBody : null,
      };
      state.calls.push(call);

      const custom = await state.respond?.(call);
      if (custom) return custom;

      if (method === "GET" && path === "/feed/settings") return json(200, state.settings);
      if (method === "GET" && path === "/feed") {
        const page = state.pages[call.query.get("cursor") ?? ""];
        return page ? json(200, page) : json(404, { message: "cursor desconhecido" });
      }
      if (method === "GET" && path === "/classes/me") return json(200, state.classes);
      if (method === "GET" && path === "/students/me") return json(200, []);
      if (method === "GET" && path === "/organizations") return json(200, []);
      if (method === "GET" && path === "/passport/me") return json(404, { message: "sem passaporte" });

      const comments = path.match(/^\/feed\/posts\/(\d+)\/comments$/);
      if (comments && method === "GET") {
        const byCursor = state.comments[Number(comments[1])] ?? { "": { items: [], nextCursor: null } };
        return json(200, byCursor[call.query.get("cursor") ?? ""] ?? { items: [], nextCursor: null });
      }
      if (comments && method === "POST") {
        const input = call.body as { body: string; parentId?: number };
        const created = makeComment({ id: 900, body: input.body, parentId: input.parentId ?? null, canDelete: true });
        const key = Number(comments[1]);
        const first = state.comments[key]?.[""] ?? { items: [], nextCursor: null };
        state.comments[key] = { ...state.comments[key], "": { ...first, items: [...first.items, created] } };
        return json(201, created);
      }

      if (method === "POST" && path === "/feed/media") {
        state.mediaSeq += 1;
        const id = state.mediaSeq;
        return json(201, { mediaId: id, url: makeMedia(id).url, thumbUrl: makeMedia(id).thumbUrl, width: 1200, height: 900 });
      }
      if (method === "POST" && path === "/feed/posts") {
        const input = call.body as { body?: string; mediaIds?: number[]; visibility: FeedPost["visibility"] };
        return json(201, makePost({ id: 777, body: input.body ?? null, media: (input.mediaIds ?? []).map((id) => makeMedia(id)), visibility: input.visibility, canEdit: true, canDelete: true }));
      }

      const reaction = path.match(/^\/feed\/posts\/(\d+)\/reaction$/);
      if (reaction && method === "PUT") {
        const post = allPosts().find((item) => item.id === Number(reaction[1]));
        const type = (call.body as { type: ReactionType | null }).type;
        return json(200, applyReaction(post?.reactions ?? reactions(), type));
      }
      const post = path.match(/^\/feed\/posts\/(\d+)$/);
      if (post && method === "PATCH") {
        const found = allPosts().find((item) => item.id === Number(post[1]));
        return json(200, { ...(found ?? makePost()), body: (call.body as { body: string }).body, edited: true });
      }
      if ((post && method === "DELETE") || (/^\/feed\/comments\/\d+$/.test(path) && method === "DELETE")) return json(204);
      if (/^\/feed\/(posts|comments)\/\d+\/report$/.test(path) && method === "POST") return json(200, { ok: true });

      return json(404, { message: `sem rota ${method} ${path}` });
    }),
  );
  return state;
}

export interface Mounted {
  container: HTMLDivElement;
  queryClient: QueryClient;
  unmount: () => void;
}

let current: Mounted | null = null;

export const settle = (ms = 30) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

/** Espera (com act) até a condição ficar verdadeira; falha com mensagem útil se estourar. */
export async function until(condition: () => boolean, label = "condição", timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timeout esperando: ${label}`);
    await settle(10);
  }
}

export async function mount(ui: React.ReactNode): Promise<Mounted> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>));
  current = {
    container,
    queryClient,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
  await settle();
  return current;
}

export function cleanup() {
  current?.unmount();
  current = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
}

/** Radix usa portais: botões/sheets ficam em document.body, não no container. */
export const $ = <T extends Element = HTMLElement>(selector: string) => document.body.querySelector<T>(selector);
export const $$ = <T extends Element = HTMLElement>(selector: string) => [...document.body.querySelectorAll<T>(selector)];
export const buttonByText = (text: RegExp | string) =>
  [...document.body.querySelectorAll("button")].find((b) => (typeof text === "string" ? (b.textContent ?? "").includes(text) : text.test(b.textContent ?? "")));
export const buttonByLabel = (label: RegExp | string) =>
  [...document.body.querySelectorAll("button")].find((b) => {
    const aria = b.getAttribute("aria-label") ?? "";
    return typeof label === "string" ? aria.includes(label) : label.test(aria);
  });

export const click = (element: Element | null | undefined) => {
  if (!element) throw new Error("elemento não encontrado para clicar");
  act(() => (element as HTMLElement).click());
};

export function typeInto(element: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export function chooseFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", { configurable: true, value: files });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

export const photo = (name = "foto.jpg", type = "image/jpeg", size = 1024) =>
  new File([new Uint8Array(size)], name, { type });

export const callsOf = (state: MockState, method: string, pattern: RegExp) =>
  state.calls.filter((call) => call.method === method && pattern.test(call.path));
