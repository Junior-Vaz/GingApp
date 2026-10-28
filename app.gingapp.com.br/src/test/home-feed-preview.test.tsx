import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { HomePage } from "@/components/gingapp/home";
import { FEED_PREVIEW_SIZE, feedKeys, insertPostInCache, patchPostInCache, type FeedPage, type FeedPost } from "@/lib/feed";
import type { StoryGroup } from "@/lib/stories";
import {
  $,
  $$,
  callsOf,
  cleanup,
  click,
  json,
  makeMedia,
  makePost,
  makeSettings,
  mockFeedApi,
  mount,
  reactions,
  settle,
  until,
  type MockState,
} from "./feed-fixtures";

/**
 * Home: stories -> banner -> prévia do Grupo -> "Minha graduação". Ordem, até 3 posts, vazio com/sem permissão, oculto
 * com o feed desligado (Home igual à de antes), variante compacta, reações/comentários/apagar e cache da prévia.
 */

const storyGroup: StoryGroup = {
  author: { userId: 2, name: "Bruno Lima", nickname: null, photo: null, roleLabel: null },
  isMine: false,
  hasUnseen: true,
  items: [
    {
      id: 21,
      media: makeMedia(21, 1080, 1920),
      caption: null,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      seen: false,
      status: "PUBLISHED",
    },
  ],
};

interface HomeOpts {
  settings?: Partial<ReturnType<typeof makeSettings>>;
  posts?: FeedPost[];
  groups?: StoryGroup[];
  /** Status do GET /feed (padrão 200). */
  feedStatus?: number;
  storiesStatus?: number;
  /** GET /feed/settings que nunca responde ("pending") ou dá 500 ("error"). */
  settingsBehavior?: "pending" | "error";
}

function setupHome(opts: HomeOpts = {}): MockState {
  const feedOwn = new Set(["/classes/me", "/students/me", "/organizations", "/passport/me"]);
  return mockFeedApi({
    settings: makeSettings(opts.settings),
    pages: { "": { items: opts.posts ?? [], nextCursor: null } },
    respond: (call) => {
      if (call.method === "GET" && call.path === "/feed/settings" && opts.settingsBehavior === "pending") return new Promise<Response>(() => {});
      if (call.method === "GET" && call.path === "/feed/settings" && opts.settingsBehavior === "error") return json(500, { message: "x" });
      if (call.method === "GET" && call.path === "/feed/stories") {
        return opts.storiesStatus && opts.storiesStatus !== 200
          ? json(opts.storiesStatus, { message: "erro" })
          : json(200, { groups: opts.groups ?? [] });
      }
      if (call.method === "GET" && call.path === "/feed" && opts.feedStatus && opts.feedStatus !== 200) {
        return json(opts.feedStatus, { message: "erro" });
      }
      // O resto da Home (aulas, eventos, ranking, aniversariantes...) responde vazio.
      if (call.method === "GET" && !call.path.startsWith("/feed") && !feedOwn.has(call.path)) return json(200, []);
      return undefined;
    },
  });
}

const preview = () => $("[data-testid=home-feed-preview]");
const storiesRow = () => $("[data-testid=stories-row]");
const cards = () => $$("[data-testid=home-feed-preview] [data-testid=post-card]");
const feedGets = (state: MockState) => callsOf(state, "GET", /^\/feed$/);

async function mountHome(state: MockState, ready: () => boolean = () => preview() !== null) {
  await mount(<HomePage />);
  await until(ready, "Home pronta");
  void state;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.info.mockClear();
  localStorage.clear();
});

describe("ordem das seções na Home", () => {
  it("stories -> banner -> prévia do Grupo -> Minha graduação -> resto", async () => {
    const state = setupHome({ posts: [makePost({ id: 1 })], groups: [storyGroup] });
    await mountHome(state, () => preview() !== null && storiesRow() !== null);
    const banner = $("[data-testid=hero-carousel]")!;
    const graduation = $(".grad-link")!;
    const stats = $("[aria-label='Minha evolução']")!;
    const order = [storiesRow()!, banner, preview()!, graduation, stats];
    for (let i = 0; i < order.length - 1; i += 1) {
      const relation = order[i]!.compareDocumentPosition(order[i + 1]!);
      expect(relation & Node.DOCUMENT_POSITION_FOLLOWING, `posição ${i} -> ${i + 1}`).toBeTruthy();
    }
    // os blocos são irmãos diretos na ordem pedida (nada no meio)
    const kids = [...banner.parentElement!.children];
    const at = kids.indexOf(banner);
    expect(kids[at - 1]?.contains(storiesRow())).toBe(true);
    expect(kids[at + 1]?.contains(preview())).toBe(true);
    expect(kids[at + 2]).toBe(graduation);
  });

  it("o atalho antigo 'Grupo' foi substituído pela prévia", async () => {
    const state = setupHome({ posts: [makePost({ id: 1 })] });
    await mountHome(state);
    expect($("[data-testid=home-feed-shortcut]")).toBeNull();
    expect($("[data-testid=home-feed-preview] h2")?.textContent).toBe("Grupo");
  });
});

describe("prévia do Grupo", () => {
  it("mostra até 3 posts (pede limit=3, uma única consulta, sem a lista infinita de 15)", async () => {
    const posts = [1, 2, 3, 4, 5].map((id) => makePost({ id, body: `post ${id}` }));
    const state = setupHome({ posts });
    await mountHome(state);
    await until(() => cards().length > 0, "posts");
    expect(cards()).toHaveLength(FEED_PREVIEW_SIZE);
    expect(cards().map((card) => card.getAttribute("data-post-id"))).toEqual(["1", "2", "3"]);
    const gets = feedGets(state);
    expect(gets).toHaveLength(1);
    expect(gets[0]!.query.get("limit")).toBe("3");
    expect(gets.some((call) => call.query.get("limit") === "15")).toBe(false);
  });

  it("nunca mostra stories na prévia (defesa)", async () => {
    const state = setupHome({ posts: [makePost({ id: 1 }), makePost({ id: 2, kind: "STORY", expiresAt: "2026-10-28T00:00:00Z" })] });
    await mountHome(state);
    await until(() => cards().length > 0, "posts");
    expect(cards().map((card) => card.getAttribute("data-post-id"))).toEqual(["1"]);
  });

  it("'Ver tudo' leva ao feed", async () => {
    const state = setupHome({ posts: [makePost({ id: 1 })] });
    await mountHome(state);
    expect($("[data-testid=home-feed-see-all]")?.getAttribute("href")).toBe("/feed");
    expect($("[data-testid=home-feed-see-all]")?.textContent).toContain("Ver tudo");
  });

  it("vazio COM permissão de postar: convite 'Seja o primeiro a postar!' que leva ao feed", async () => {
    const state = setupHome({ posts: [] });
    await mountHome(state);
    expect($("[data-testid=home-feed-empty]")?.textContent).toContain("Seja o primeiro a postar!");
    expect($("[data-testid=home-feed-post-cta]")?.getAttribute("href")).toBe("/feed");
    expect(cards()).toHaveLength(0);
  });

  it("vazio SEM permissão de postar: a seção inteira some", async () => {
    const state = setupHome({ posts: [], settings: { canPost: false, postingMode: "STAFF_ONLY" } });
    await mount(<HomePage />);
    await until(() => feedGets(state).length === 1, "prévia pedida");
    await settle(60);
    expect(preview()).toBeNull();
  });

  it("carregando, erro ou feed desligado: oculta, sem mensagem de erro", async () => {
    // erro na prévia
    let state = setupHome({ posts: [makePost({ id: 1 })], feedStatus: 500 });
    await mount(<HomePage />);
    await until(() => feedGets(state).length === 1, "prévia pedida");
    await settle(60);
    expect(preview()).toBeNull();
    expect($("[data-testid=feed-error]")).toBeNull();
    cleanup();

    // configuração do feed que nunca responde
    state = setupHome({ posts: [makePost({ id: 1 })], groups: [storyGroup], settingsBehavior: "pending" });
    await mount(<HomePage />);
    await settle(80);
    expect(preview()).toBeNull();
    expect(storiesRow()).toBeNull();
    expect(feedGets(state)).toHaveLength(0);
    cleanup();

    // erro na configuração do feed
    state = setupHome({ posts: [makePost({ id: 1 })], groups: [storyGroup], settingsBehavior: "error" });
    await mount(<HomePage />);
    await settle(80);
    expect(preview()).toBeNull();
    expect(storiesRow()).toBeNull();
  });

  it("erro nos stories não derruba a prévia, e erro na prévia não derruba os stories", async () => {
    let state = setupHome({ posts: [makePost({ id: 1 })], storiesStatus: 500 });
    await mountHome(state);
    expect(storiesRow()).toBeNull();
    expect(cards()).toHaveLength(1);
    cleanup();
    state = setupHome({ posts: [], feedStatus: 500, groups: [storyGroup] });
    await mount(<HomePage />);
    await until(() => storiesRow() !== null, "stories");
    expect(preview()).toBeNull();
    void state;
  });
});

describe("Home com o feed desligado fica IDÊNTICA à de antes", () => {
  it("nenhuma chamada de feed além da configuração e a estrutura dos blocos é a de sempre", async () => {
    const state = setupHome({ settings: { enabled: false }, posts: [makePost({ id: 1 })], groups: [storyGroup] });
    const { container } = await mount(<HomePage />);
    await until(() => state.calls.some((call) => call.path === "/feed/settings"), "configuração pedida");
    await settle(120);
    expect(preview()).toBeNull();
    expect(storiesRow()).toBeNull();
    expect(feedGets(state)).toHaveLength(0);
    expect(callsOf(state, "GET", /^\/feed\/stories$/)).toHaveLength(0);
    // Blocos de primeiro nível: título, aviso (sem aluno vinculado neste mock), banner, graduação, evolução e as colunas
    // do painel. Nada de wrapper vazio no lugar de stories/prévia.
    const blocks = [...container.children].map((child) => child.className.trim().split(/\s+/)[0]);
    expect(blocks).toEqual(["page-heading", "empty-state", "welcome-banner", "grad-link", "stats-grid", "dashboard-columns"]);
    expect(container.querySelector("[data-reveal]")).toBeNull();
  });
});

describe("variante compacta do PostCard", () => {
  it("foto única grande (as outras viram '+N'), texto curto sem 'ver mais', autor e tempo no topo", async () => {
    const post = makePost({ id: 1, body: "Treino bom", media: [makeMedia(11), makeMedia(12), makeMedia(13)] });
    const state = setupHome({ posts: [post] });
    await mountHome(state);
    await until(() => cards().length === 1, "post");
    const card = cards()[0]!;
    expect(card.getAttribute("data-compact")).toBe("true");
    expect(card.querySelectorAll("img").length).toBe(1);
    expect(card.querySelector("img")?.getAttribute("src")).toContain("/media/11?");
    expect(card.querySelector("[data-testid=post-more-photos]")?.textContent).toBe("+2");
    expect(card.querySelector("[data-testid=post-more-photos]")?.getAttribute("href")).toBe("/feed");
    expect(card.querySelector("[data-testid=post-see-more]")).toBeNull();
    expect(card.querySelector("[data-testid=post-author]")?.textContent).toContain("Ana Souza");
    expect(card.querySelector("time")?.textContent).toBe("há 5 minutos");
    // foto antes do texto (como nos prints de referência)
    const media = card.querySelector("[data-testid=media-gallery]")!;
    const body = card.querySelector("[data-testid=post-body]")!;
    expect(media.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.querySelector("[data-testid=reaction-bar]")).not.toBeNull();
  });

  it("texto longo é cortado em 3 linhas com 'ver mais' que abre o feed", async () => {
    const state = setupHome({ posts: [makePost({ id: 1, body: "Muito texto. ".repeat(30) }), makePost({ id: 2, body: "a\nb\nc\nd\ne" })] });
    await mountHome(state);
    await until(() => cards().length === 2, "posts");
    for (const card of cards()) {
      expect(card.querySelector("[data-testid=post-body]")?.className).toContain("line-clamp-3");
      expect(card.querySelector("[data-testid=post-see-more]")?.getAttribute("href")).toBe("/feed");
    }
  });

  it("o PostCard normal (feed) continua igual: sem compacto, sem 'ver mais'", async () => {
    const { PostCard } = await import("@/components/gingapp/feed/post-card");
    mockFeedApi();
    await mount(<PostCard post={makePost({ id: 1, body: "x".repeat(400), media: [makeMedia(11), makeMedia(12)] })} />);
    const card = $("[data-testid=post-card]")!;
    expect(card.getAttribute("data-compact")).toBeNull();
    expect(card.querySelector("[data-testid=post-see-more]")).toBeNull();
    expect(card.querySelector("[data-testid=post-body]")?.className).not.toContain("line-clamp");
    expect(card.querySelectorAll("img").length).toBe(2);
  });

  it("post meu pendente aparece com o aviso e sem barra de reações", async () => {
    const state = setupHome({ posts: [makePost({ id: 1, status: "PENDING_APPROVAL", canEdit: false, canDelete: true })] });
    await mountHome(state);
    await until(() => cards().length === 1, "post");
    expect(cards()[0]!.querySelector("[data-testid=pending-banner]")).not.toBeNull();
    expect(cards()[0]!.querySelector("[data-testid=reaction-bar]")).toBeNull();
  });
});

describe("interações na prévia", () => {
  it("reagir funciona como no feed: PUT na API e contagem atualizada na prévia (cache da prévia)", async () => {
    const state = setupHome({ posts: [makePost({ id: 1, reactions: reactions({ AXE: 2 }) })] });
    await mount(<HomePage />);
    await until(() => cards().length === 1, "post");
    expect(cards()[0]!.querySelector("[data-testid=count-AXE]")?.textContent).toBe("2");
    click(cards()[0]!.querySelector("[data-testid=react-main]"));
    await until(() => callsOf(state, "PUT", /^\/feed\/posts\/1\/reaction$/).length === 1, "PUT da reação");
    expect(callsOf(state, "PUT", /reaction$/)[0]!.body).toEqual({ type: "AXE" });
    await until(() => cards()[0]!.querySelector("[data-testid=count-AXE]")?.textContent === "3", "contagem 3");
    expect(cards()[0]!.querySelector("[data-testid=react-main]")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("a reação também atualiza o mesmo post na lista do feed (caches compartilham as mutações)", async () => {
    const state = setupHome({ posts: [makePost({ id: 1 })] });
    const { queryClient } = await mount(<HomePage />);
    await until(() => cards().length === 1, "post");
    const list: FeedPage = { items: [makePost({ id: 1 })], nextCursor: null };
    queryClient.setQueryData(feedKeys.list, { pages: [list], pageParams: [null] });
    click(cards()[0]!.querySelector("[data-testid=react-main]"));
    await until(() => callsOf(state, "PUT", /reaction$/).length === 1, "PUT");
    const cached = queryClient.getQueryData<{ pages: FeedPage[] }>(feedKeys.list)!;
    expect(cached.pages[0]!.items[0]!.reactions.mine).toBe("AXE");
  });

  it("comentários abrem a folha do feed", async () => {
    const state = setupHome({ posts: [makePost({ id: 1, commentsCount: 2 })] });
    await mount(<HomePage />);
    await until(() => cards().length === 1, "post");
    click(cards()[0]!.querySelector("[data-testid=open-comments]"));
    await until(() => callsOf(state, "GET", /^\/feed\/posts\/1\/comments$/).length === 1, "comentários pedidos");
  });

  it("apagar meu post pela prévia: remove da tela e a prévia é recarregada (volta a ter 3)", async () => {
    const state = setupHome({ posts: [makePost({ id: 1, canDelete: true, canEdit: true }), makePost({ id: 2 })] });
    await mount(<HomePage />);
    await until(() => cards().length === 2, "posts");
    click(cards()[0]!.querySelector("[data-testid=post-menu]"));
    await until(() => $("[data-testid=menu-delete]") !== null, "menu");
    click($("[data-testid=menu-delete]"));
    await until(() => $("[role=alertdialog]") !== null, "confirmação");
    click([...document.querySelectorAll("[role=alertdialog] button")].find((b) => b.textContent === "Apagar"));
    await until(() => callsOf(state, "DELETE", /^\/feed\/posts\/1$/).length === 1, "DELETE");
    await until(() => feedGets(state).length === 2, "prévia recarregada");
  });

  it("foto quebrada (URL assinada vencida): refaz a prévia UMA vez por mídia", async () => {
    const state = setupHome({ posts: [makePost({ id: 1, media: [makeMedia(11)] })] });
    await mount(<HomePage />);
    await until(() => cards().length === 1, "post");
    act(() => void cards()[0]!.querySelector("img")!.dispatchEvent(new Event("error")));
    await until(() => feedGets(state).length === 2, "recarga");
    act(() => void cards()[0]!.querySelector("img")!.dispatchEvent(new Event("error")));
    await settle(80);
    expect(feedGets(state)).toHaveLength(2);
  });
});

describe("cache da prévia", () => {
  const page = (): FeedPage => ({ items: [makePost({ id: 1, pinned: true }), makePost({ id: 2 }), makePost({ id: 3 })], nextCursor: null });

  it("insertPostInCache põe o post novo na prévia depois dos fixados; patchPostInCache altera e remove", async () => {
    const { queryClient } = await mount(<span />);
    queryClient.setQueryData(feedKeys.preview, page());
    insertPostInCache(queryClient, makePost({ id: 9 }));
    expect(queryClient.getQueryData<FeedPage>(feedKeys.preview)!.items.map((p) => p.id)).toEqual([1, 9, 2, 3]);
    patchPostInCache(queryClient, 2, (post) => ({ ...post, commentsCount: 7 }));
    expect(queryClient.getQueryData<FeedPage>(feedKeys.preview)!.items.find((p) => p.id === 2)!.commentsCount).toBe(7);
    patchPostInCache(queryClient, 1, () => null);
    expect(queryClient.getQueryData<FeedPage>(feedKeys.preview)!.items.map((p) => p.id)).toEqual([9, 2, 3]);
  });

  it("a chave da prévia é própria (['feed','preview']) e não casa com a lista nem com os stories", () => {
    expect(feedKeys.preview).toEqual(["feed", "preview"]);
    expect(feedKeys.list).toEqual(["feed", "list"]);
    expect(feedKeys.stories).toEqual(["feed", "stories"]);
  });
});
