import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { FeedPage } from "@/components/gingapp/feed/feed-page";
import { applyReaction, authorLabel, feedMediaSrc, linkify } from "@/lib/feed";
import {
  $,
  $$,
  buttonByLabel,
  buttonByText,
  callsOf,
  cleanup,
  click,
  json,
  makeComment,
  makeMedia,
  makePost,
  makeSettings,
  mockFeedApi,
  mount,
  reactions,
  settle,
  typeInto,
  until,
} from "./feed-fixtures";

/** Feed do grupo (app): lista, estados, cartão, reações, comentários, denúncia, apagar/editar, pendente. */

afterEach(() => {
  cleanup();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.info.mockClear();
  localStorage.clear();
});

const cards = () => $$("[data-testid=post-card]");
const text = () => document.body.textContent ?? "";

async function openMenuOf(card: Element) {
  click(card.querySelector("[data-testid=post-menu]"));
  await settle();
}

describe("funções puras do feed", () => {
  it("linkify: só http(s) vira link; pontuação final fica fora; javascript: nunca vira link", () => {
    const parts = linkify("Veja https://exemplo.com/a?b=1, depois javascript:alert(1) e http://x.org.");
    const links = parts.filter((part) => part.type === "link");
    expect(links.map((part) => part.value)).toEqual(["https://exemplo.com/a?b=1", "http://x.org"]);
    expect(parts.map((part) => part.value).join("")).toBe("Veja https://exemplo.com/a?b=1, depois javascript:alert(1) e http://x.org.");
  });

  it("applyReaction: troca, remove e nunca fica abaixo de zero", () => {
    const base = reactions({ AXE: 2 }, "AXE");
    expect(applyReaction(base, "GINGA")).toMatchObject({ mine: "GINGA", total: 2, counts: { AXE: 1, GINGA: 1 } });
    expect(applyReaction(base, null)).toMatchObject({ mine: null, total: 1, counts: { AXE: 1 } });
    expect(applyReaction(reactions({}, null), "SALVE")).toMatchObject({ mine: "SALVE", total: 1 });
    expect(applyReaction(reactions({ AXE: 0 }, "AXE"), null).counts.AXE).toBe(0);
  });

  it("authorLabel e feedMediaSrc", () => {
    expect(authorLabel({ userId: 1, name: "Ana", nickname: "Aninha", photo: null, roleLabel: null })).toBe("Ana (Aninha)");
    expect(authorLabel({ userId: 1, name: "Ana", nickname: null, photo: null, roleLabel: null })).toBe("Ana");
    expect(authorLabel(null)).toBe("Ex-integrante");
    expect(feedMediaSrc("/api/feed/media/1?e=1&s=2")).toMatch(/\/api\/feed\/media\/1\?e=1&s=2$/);
    expect(feedMediaSrc("https://cdn.x/y.jpg")).toBe("https://cdn.x/y.jpg");
  });
});

describe("estados da página Grupo", () => {
  it("tem o ponto de encaixe do topo (feed-top-slot) e o título Grupo", async () => {
    mockFeedApi({ pages: { "": { items: [makePost()], nextCursor: null } } });
    await mount(<FeedPage />);
    expect($("[data-testid=feed-top-slot]")).not.toBeNull();
    expect(document.body.querySelector("h1")?.textContent).toBe("Grupo");
  });

  it("mostra skeleton enquanto carrega e depois a lista", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => (release = resolve));
    mockFeedApi({
      pages: { "": { items: [makePost()], nextCursor: null } },
      respond: async (call) => {
        if (call.method === "GET" && call.path === "/feed") await gate;
        return undefined;
      },
    });
    const mounted = await mount(<FeedPage />);
    await until(() => mounted.container.querySelector("[data-testid=feed-loading]") !== null, "skeleton");
    expect(cards()).toHaveLength(0);
    release!();
    await until(() => cards().length === 1, "1 post");
    expect($("[data-testid=feed-loading]")).toBeNull();
  });

  it("vazio: 'Seja o primeiro a postar!'", async () => {
    mockFeedApi();
    await mount(<FeedPage />);
    await until(() => $("[data-testid=feed-empty]") !== null, "estado vazio");
    expect(text()).toContain("Seja o primeiro a postar!");
  });

  it("vazio sem permissão de postar não convida a postar", async () => {
    mockFeedApi({ settings: makeSettings({ canPost: false, postingMode: "STAFF_ONLY" }) });
    await mount(<FeedPage />);
    await until(() => $("[data-testid=feed-empty]") !== null, "estado vazio");
    expect(text()).not.toContain("Seja o primeiro a postar!");
    expect($("[data-testid=cannot-post]")?.textContent).toContain("só a equipe publica");
    expect($("[data-testid=composer-open]")).toBeNull();
  });

  it("erro na lista: mensagem e 'Tentar de novo' busca de novo", async () => {
    let failing = true;
    const state = mockFeedApi({
      pages: { "": { items: [makePost({ id: 5 })], nextCursor: null } },
      respond: (call) => (call.method === "GET" && call.path === "/feed" && failing ? json(500, { message: "Falha no servidor" }) : undefined),
    });
    await mount(<FeedPage />);
    await until(() => $("[data-testid=feed-error]") !== null, "erro");
    expect($("[data-testid=feed-error]")?.textContent).toContain("Falha no servidor");
    failing = false;
    click(buttonByText("Tentar de novo"));
    await until(() => cards().length === 1, "post após retry");
    expect(callsOf(state, "GET", /^\/feed$/).length).toBe(2);
  });

  it("feed desligado: mensagem e nenhuma busca de posts", async () => {
    const state = mockFeedApi({ settings: makeSettings({ enabled: false }) });
    await mount(<FeedPage />);
    await until(() => $("[data-testid=feed-disabled]") !== null, "desligado");
    expect(text()).toContain("O feed deste grupo está desligado");
    expect(callsOf(state, "GET", /^\/feed$/).length).toBe(0);
    expect($("[data-testid=composer]")).toBeNull();
  });

  it("falha ao ler as configurações mostra erro com 'Tentar de novo'", async () => {
    const state = mockFeedApi({
      respond: (call) => (call.path === "/feed/settings" ? json(500, { message: "Sem configurações" }) : undefined),
    });
    await mount(<FeedPage />);
    await until(() => $("[data-testid=feed-error]") !== null, "erro de settings");
    expect(callsOf(state, "GET", /^\/feed$/).length).toBe(0);
  });
});

describe("lista e paginação por cursor", () => {
  it("'Ver mais' pede o próximo cursor e acrescenta, sem duplicar; no fim some o botão", async () => {
    const state = mockFeedApi({
      pages: {
        "": { items: [makePost({ id: 1, body: "um" }), makePost({ id: 2, body: "dois" })], nextCursor: "c2" },
        c2: { items: [makePost({ id: 2, body: "dois" }), makePost({ id: 3, body: "três" })], nextCursor: null },
      },
    });
    await mount(<FeedPage />);
    await until(() => cards().length === 2, "2 posts");
    expect($("[data-testid=feed-more]")).not.toBeNull();
    click($("[data-testid=feed-more]"));
    await until(() => cards().length === 3, "3 posts");
    const feedCalls = callsOf(state, "GET", /^\/feed$/);
    expect(feedCalls.map((call) => call.query.get("cursor"))).toEqual([null, "c2"]);
    expect(feedCalls[0]?.query.get("limit")).toBe("15");
    expect($("[data-testid=feed-more]")).toBeNull();
    expect(text()).toContain("Você viu tudo por enquanto");
    expect(cards().map((card) => card.getAttribute("data-post-id"))).toEqual(["1", "2", "3"]);
  });

  it("'Atualizar' volta para a 1ª página e busca só ela", async () => {
    const state = mockFeedApi({
      pages: {
        "": { items: [makePost({ id: 1 })], nextCursor: "c2" },
        c2: { items: [makePost({ id: 2 })], nextCursor: null },
      },
    });
    await mount(<FeedPage />);
    await until(() => cards().length === 1, "1 post");
    click($("[data-testid=feed-more]"));
    await until(() => cards().length === 2, "2 posts");
    state.pages[""] = { items: [makePost({ id: 9, body: "novo" }), makePost({ id: 1 })], nextCursor: "c2" };
    const before = callsOf(state, "GET", /^\/feed$/).length;
    click($("[data-testid=feed-refresh]"));
    await until(() => cards().some((card) => card.getAttribute("data-post-id") === "9"), "post novo");
    expect(callsOf(state, "GET", /^\/feed$/).length).toBe(before + 1);
    expect(cards().map((card) => card.getAttribute("data-post-id"))).toEqual(["9", "1"]);
  });
});

describe("cartão do post", () => {
  it("mostra autor (apelido), papel, tempo relativo, fixado, editado e texto com quebras de linha", async () => {
    mockFeedApi({
      pages: { "": { items: [makePost({ pinned: true, edited: true, body: "linha 1\nlinha 2" })], nextCursor: null } },
    });
    await mount(<FeedPage />);
    await until(() => cards().length === 1, "post");
    const card = cards()[0]!;
    expect(card.querySelector("[data-testid=post-author]")?.textContent).toBe("Ana Souza (Aninha)");
    expect(card.querySelector("[data-testid=post-role]")?.textContent).toBe("Aluna");
    expect(card.querySelector("time")?.textContent).toBe("há 5 minutos");
    expect(card.querySelector("[data-testid=post-pinned]")?.textContent).toContain("Fixado");
    expect(card.querySelector("[data-testid=post-edited]")?.textContent).toBe("editado");
    const body = card.querySelector("[data-testid=post-body]") as HTMLElement;
    expect(body.textContent).toBe("linha 1\nlinha 2");
    expect(body.className).toContain("whitespace-pre-wrap");
  });

  it("links sanitizados: rel noopener noreferrer nofollow; HTML bruto vira texto; javascript: não vira link", async () => {
    mockFeedApi({
      pages: {
        "": {
          items: [makePost({ body: 'Veja https://exemplo.com/roda e <script>window.__xss=1</script> <img src=x onerror="window.__xss=1"> javascript:alert(1)' })],
          nextCursor: null,
        },
      },
    });
    await mount(<FeedPage />);
    await until(() => cards().length === 1, "post");
    const body = $("[data-testid=post-body]") as HTMLElement;
    const anchors = [...body.querySelectorAll("a")];
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.getAttribute("href")).toBe("https://exemplo.com/roda");
    expect(anchors[0]?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(anchors[0]?.getAttribute("target")).toBe("_blank");
    expect(body.querySelector("script")).toBeNull();
    expect(body.querySelector("img")).toBeNull();
    expect(body.textContent).toContain("<script>window.__xss=1</script>");
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });

  it("autor anonimizado aparece como 'Ex-integrante'", async () => {
    mockFeedApi({ pages: { "": { items: [makePost({ author: null })], nextCursor: null } } });
    await mount(<FeedPage />);
    await until(() => cards().length === 1, "post");
    expect($("[data-testid=post-author]")?.textContent).toBe("Ex-integrante");
  });

  it("post pendente: cartão esmaecido, explicação e sem reações/comentários", async () => {
    mockFeedApi({
      pages: { "": { items: [makePost({ status: "PENDING_APPROVAL", canEdit: false, canDelete: true })], nextCursor: null } },
    });
    await mount(<FeedPage />);
    await until(() => cards().length === 1, "post");
    const card = cards()[0]!;
    expect(card.getAttribute("data-status")).toBe("PENDING_APPROVAL");
    expect(card.className).toContain("opacity-75");
    expect(card.querySelector("[data-testid=pending-banner]")?.textContent).toContain("Aguardando aprovação");
    expect(card.querySelector("[data-testid=pending-banner]")?.textContent).toContain("Seu post será publicado depois que um professor aprovar.");
    expect(card.querySelector("[data-testid=reaction-bar]")).toBeNull();
  });

  it("post pendente do próprio autor (backend real manda canEdit:false, conferido em 2026-10-28): menu sem 'Editar' (PATCH dá 409 INVALID_STATE) e sem 'Denunciar' o próprio post, só 'Apagar'", async () => {
    mockFeedApi({
      pages: { "": { items: [makePost({ id: 31, status: "PENDING_APPROVAL", canEdit: false, canDelete: true })], nextCursor: null } },
    });
    await mount(<FeedPage />);
    await until(() => cards().length === 1, "post");
    await openMenuOf(cards()[0]!);
    expect($("[data-testid=menu-edit]")).toBeNull();
    expect($("[data-testid=menu-report]")).toBeNull();
    expect($("[data-testid=menu-delete]")).not.toBeNull();
  });

  it("comentários desligados: não mostra o botão de comentar", async () => {
    mockFeedApi({ settings: makeSettings({ allowComments: false }), pages: { "": { items: [makePost()], nextCursor: null } } });
    await mount(<FeedPage />);
    await until(() => cards().length === 1, "post");
    expect($("[data-testid=open-comments]")).toBeNull();
    expect($("[data-testid=react-main]")).not.toBeNull();
  });
});

describe("galeria de fotos", () => {
  it("1 foto: grande, lazy, decoding async e proporção reservada (width/height do contrato)", async () => {
    mockFeedApi({ pages: { "": { items: [makePost({ media: [makeMedia(1, 1600, 1200)] })], nextCursor: null } } });
    await mount(<FeedPage />);
    await until(() => $("[data-testid=media-gallery]") !== null, "galeria");
    const gallery = $("[data-testid=media-gallery]") as HTMLElement;
    const img = gallery.querySelector("img")!;
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.getAttribute("width")).toBe("1600");
    expect(img.getAttribute("height")).toBe("1200");
    expect(gallery.style.aspectRatio).toBe("1.3333333333333333");
    expect(img.getAttribute("src")).toContain("/api/feed/media/1?e=9999999999&s=sig1");
  });

  it("2-6 fotos: grade com miniaturas; toque abre o visualizador, avança, volta e fecha", async () => {
    mockFeedApi({
      pages: { "": { items: [makePost({ media: [makeMedia(1), makeMedia(2), makeMedia(3)] })], nextCursor: null } },
    });
    await mount(<FeedPage />);
    await until(() => $("[data-testid=media-gallery]") !== null, "galeria");
    const thumbs = $$("[data-testid=media-gallery] img");
    expect(thumbs).toHaveLength(3);
    expect(thumbs[0]?.getAttribute("src")).toContain("s=thumb1");
    click(buttonByLabel("Abrir foto 2 de 3"));
    await settle();
    const viewer = $("[data-testid=photo-viewer]");
    expect(viewer).not.toBeNull();
    expect($("[data-testid=viewer-counter]")?.textContent).toBe("2 / 3");
    expect(viewer?.querySelector("img")?.getAttribute("src")).toContain("s=sig2");
    click(buttonByLabel("Próxima foto"));
    expect($("[data-testid=viewer-counter]")?.textContent).toBe("3 / 3");
    click(buttonByLabel("Foto anterior"));
    expect($("[data-testid=viewer-counter]")?.textContent).toBe("2 / 3");
    // deslize para a esquerda (dedo vai da direita para a esquerda) = próxima foto
    act(() => {
      const touch = (x: number) => ({ clientX: x }) as Touch;
      const start = new Event("touchstart", { bubbles: true });
      Object.defineProperty(start, "touches", { value: [touch(300)] });
      viewer!.dispatchEvent(start);
      const end = new Event("touchend", { bubbles: true });
      Object.defineProperty(end, "changedTouches", { value: [touch(100)] });
      viewer!.dispatchEvent(end);
    });
    expect($("[data-testid=viewer-counter]")?.textContent).toBe("3 / 3");
    click(buttonByLabel("Fechar visualizador"));
    await settle();
    expect($("[data-testid=photo-viewer]")).toBeNull();
  });

  it("imagem que falha (URL assinada expirada) refaz a lista UMA vez por foto", async () => {
    const state = mockFeedApi({ pages: { "": { items: [makePost({ media: [makeMedia(1, 800, 800)] })], nextCursor: null } } });
    await mount(<FeedPage />);
    await until(() => $("[data-testid=media-gallery] img") !== null, "imagem");
    const before = callsOf(state, "GET", /^\/feed$/).length;
    act(() => {
      $("[data-testid=media-gallery] img")!.dispatchEvent(new Event("error"));
    });
    await until(() => callsOf(state, "GET", /^\/feed$/).length === before + 1, "refetch da lista");
    await settle();
    act(() => {
      $("[data-testid=media-gallery] img")!.dispatchEvent(new Event("error"));
    });
    await settle(60);
    expect(callsOf(state, "GET", /^\/feed$/).length).toBe(before + 1);
  });
});

describe("reações", () => {
  const withPost = (over = {}) => ({ pages: { "": { items: [makePost({ id: 4, reactions: reactions({ AXE: 2 }, null), ...over })], nextCursor: null } } });

  it("botão principal alterna AXE com atualização otimista (antes da resposta do servidor)", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const state = mockFeedApi({
      ...withPost(),
      respond: async (call) => {
        if (call.method === "PUT") {
          await gate;
        }
        return undefined;
      },
    });
    await mount(<FeedPage />);
    await until(() => $("[data-testid=react-main]") !== null, "barra");
    expect($("[data-testid=count-AXE]")?.textContent).toBe("2");
    click($("[data-testid=react-main]"));
    await settle(10);
    // servidor ainda não respondeu e a tela já mostra 3 e o botão destacado
    expect($("[data-testid=count-AXE]")?.textContent).toBe("3");
    expect($("[data-testid=react-main]")?.getAttribute("aria-pressed")).toBe("true");
    release!();
    await until(() => callsOf(state, "PUT", /reaction$/).length === 1, "PUT");
    await settle(40);
    expect(callsOf(state, "PUT", /reaction$/)[0]?.body).toEqual({ type: "AXE" });
    expect($("[data-testid=count-AXE]")?.textContent).toBe("3");
  });

  it("trocar a reação pelo seletor (AXE -> GINGA) e remover tocando de novo", async () => {
    const state = mockFeedApi(withPost({ reactions: reactions({ AXE: 2 }, "AXE") }));
    await mount(<FeedPage />);
    await until(() => $("[data-testid=react-main]") !== null, "barra");
    expect($("[data-testid=react-main]")?.getAttribute("aria-pressed")).toBe("true");
    click($("[data-testid=react-more]"));
    expect($$("[data-testid=reaction-picker] button")).toHaveLength(5);
    click($("[data-testid=reaction-picker] [data-reaction=GINGA]"));
    await settle(40);
    expect(callsOf(state, "PUT", /reaction$/)[0]?.body).toEqual({ type: "GINGA" });
    expect($("[data-testid=count-AXE]")?.textContent).toBe("1");
    expect($("[data-testid=count-GINGA]")?.textContent).toBe("1");
    expect($("[data-testid=react-main]")?.textContent).toContain("Ginga");
    // tocar no botão principal (que agora mostra a minha reação) remove
    click($("[data-testid=react-main]"));
    await settle(40);
    expect(callsOf(state, "PUT", /reaction$/)[1]?.body).toEqual({ type: null });
    expect($("[data-testid=count-GINGA]")).toBeNull();
    expect($("[data-testid=react-main]")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("erro do servidor desfaz a reação otimista (rollback) e avisa", async () => {
    mockFeedApi({
      ...withPost(),
      respond: (call) => (call.method === "PUT" ? json(500, { message: "Falha ao reagir" }) : undefined),
    });
    await mount(<FeedPage />);
    await until(() => $("[data-testid=react-main]") !== null, "barra");
    click($("[data-testid=react-main]"));
    await until(() => toastMock.error.mock.calls.length === 1, "toast de erro");
    expect($("[data-testid=count-AXE]")?.textContent).toBe("2");
    expect($("[data-testid=react-main]")?.getAttribute("aria-pressed")).toBe("false");
    expect(toastMock.error.mock.calls[0]?.[0]).toBe("Falha ao reagir");
  });

  it("segurar o botão abre as 5 reações (Axé, Salve, Ginga, Parabéns, Coração)", async () => {
    const state = mockFeedApi(withPost());
    await mount(<FeedPage />);
    await until(() => $("[data-testid=react-main]") !== null, "barra");
    act(() => {
      $("[data-testid=react-main]")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    await settle(520);
    expect($$("[data-testid=reaction-picker] button").map((b) => b.getAttribute("aria-label"))).toEqual(["Axé", "Salve", "Ginga", "Parabéns", "Coração"]);
    // o clique que encerra o toque longo não dispara AXE
    click($("[data-testid=react-main]"));
    await settle(30);
    expect(callsOf(state, "PUT", /reaction$/)).toHaveLength(0);
  });
});

describe("comentários", () => {
  const base = () => ({
    pages: { "": { items: [makePost({ id: 4, commentsCount: 2 })], nextCursor: null } },
    comments: {
      4: {
        "": {
          items: [
            makeComment({ id: 100, body: "Primeiro!" }),
            makeComment({ id: 101, parentId: 100, body: "Resposta", canDelete: true }),
          ],
          nextCursor: "k2",
        },
        k2: { items: [makeComment({ id: 102, body: "Mais um" })], nextCursor: null },
      },
    },
  });

  it("abre a folha, lista com resposta aninhada e pagina com 'Ver mais comentários'", async () => {
    const state = mockFeedApi(base());
    await mount(<FeedPage />);
    await until(() => $("[data-testid=open-comments]") !== null, "botão");
    expect($("[data-testid=comments-count]")?.textContent).toBe("2");
    click($("[data-testid=open-comments]"));
    await until(() => $$("[data-testid=comment]").length === 1, "comentários");
    expect($$("[data-testid=comment-reply]")).toHaveLength(1);
    expect($("[data-testid=comment-reply]")?.textContent).toContain("Resposta");
    click($("[data-testid=comments-more]"));
    await until(() => $$("[data-testid=comment]").length === 2, "2ª página");
    expect(callsOf(state, "GET", /comments$/).map((call) => call.query.get("cursor"))).toEqual([null, "k2"]);
  });

  it("vazio: 'Seja o primeiro a comentar.'", async () => {
    mockFeedApi({ pages: { "": { items: [makePost({ id: 4 })], nextCursor: null } } });
    await mount(<FeedPage />);
    await until(() => $("[data-testid=open-comments]") !== null, "botão");
    click($("[data-testid=open-comments]"));
    await until(() => $("[data-testid=comments-empty]") !== null, "vazio");
  });

  it("adiciona comentário (POST), atualiza a lista e o contador do post", async () => {
    const state = mockFeedApi(base());
    await mount(<FeedPage />);
    await until(() => $("[data-testid=open-comments]") !== null, "botão");
    click($("[data-testid=open-comments]"));
    await until(() => $$("[data-testid=comment]").length === 1, "comentários");
    expect((buttonByLabel("Enviar comentário") as HTMLButtonElement).disabled).toBe(true);
    typeInto($("#comment-field-4") as HTMLTextAreaElement, "  Que treino!  ");
    click(buttonByLabel("Enviar comentário"));
    await until(() => callsOf(state, "POST", /comments$/).length === 1, "POST");
    expect(callsOf(state, "POST", /comments$/)[0]?.body).toEqual({ body: "Que treino!" });
    await until(() => text().includes("Que treino!"), "novo comentário na lista");
    expect(($("#comment-field-4") as HTMLTextAreaElement).value).toBe("");
    expect($("[data-testid=comments-count]")?.textContent).toBe("3");
  });

  it("responder a um comentário envia parentId (um nível: responder a uma resposta usa o pai)", async () => {
    const state = mockFeedApi(base());
    await mount(<FeedPage />);
    await until(() => $("[data-testid=open-comments]") !== null, "botão");
    click($("[data-testid=open-comments]"));
    await until(() => $$("[data-testid=comment]").length === 1, "comentários");
    click(buttonByText("Responder"));
    expect($("[data-testid=reply-target]")?.textContent).toContain("Respondendo a Bruno Lima");
    typeInto($("#comment-field-4") as HTMLTextAreaElement, "Valeu!");
    click(buttonByLabel("Enviar comentário"));
    await until(() => callsOf(state, "POST", /comments$/).length === 1, "POST");
    expect(callsOf(state, "POST", /comments$/)[0]?.body).toEqual({ body: "Valeu!", parentId: 100 });
    await until(() => $("[data-testid=reply-target]") === null, "resposta limpa");
    // responder a uma RESPOSTA (id 101) continua apontando para o comentário de 1º nível (100)
    const replyButtons = $$("[data-testid=comment-reply] button").filter((b) => b.textContent === "Responder");
    click(replyButtons[0]);
    typeInto($("#comment-field-4") as HTMLTextAreaElement, "De novo");
    click(buttonByLabel("Enviar comentário"));
    await until(() => callsOf(state, "POST", /comments$/).length === 2, "2º POST");
    expect(callsOf(state, "POST", /comments$/)[1]?.body).toEqual({ body: "De novo", parentId: 100 });
  });

  it("apagar o meu comentário pede confirmação e chama DELETE; o dos outros oferece Denunciar", async () => {
    const state = mockFeedApi(base());
    await mount(<FeedPage />);
    await until(() => $("[data-testid=open-comments]") !== null, "botão");
    click($("[data-testid=open-comments]"));
    await until(() => $$("[data-testid=comment]").length === 1, "comentários");
    const mineReply = $("[data-testid=comment-reply]")!;
    expect(mineReply.textContent).toContain("Apagar");
    expect(mineReply.textContent).not.toContain("Denunciar");
    expect($("[data-testid=comment]")?.textContent).toContain("Denunciar");
    click([...mineReply.querySelectorAll("button")].find((b) => b.textContent === "Apagar"));
    await settle();
    expect(text()).toContain("Apagar comentário?");
    expect(callsOf(state, "DELETE", /comments\/101$/)).toHaveLength(0);
    state.comments[4] = { "": { items: [makeComment({ id: 100, body: "Primeiro!" })], nextCursor: null } };
    click([...document.body.querySelectorAll("[role=alertdialog] button")].find((b) => b.textContent === "Apagar"));
    await until(() => callsOf(state, "DELETE", /comments\/101$/).length === 1, "DELETE");
    await until(() => $$("[data-testid=comment-reply]").length === 0, "resposta removida");
    expect($("[data-testid=comments-count]")?.textContent).toBe("1");
  });

  it("denunciar um comentário: motivo + nota -> POST /feed/comments/:id/report", async () => {
    const state = mockFeedApi(base());
    await mount(<FeedPage />);
    await until(() => $("[data-testid=open-comments]") !== null, "botão");
    click($("[data-testid=open-comments]"));
    await until(() => $$("[data-testid=comment]").length === 1, "comentários");
    click([...$("[data-testid=comment]")!.querySelectorAll("button")].find((b) => b.textContent === "Denunciar"));
    await settle();
    expect(text()).toContain("Denunciar comentário");
    expect((buttonByText("Enviar denúncia") as HTMLButtonElement).disabled).toBe(true);
    click($("input[name=report-reason][value=SPAM]"));
    typeInto($("#report-note") as HTMLTextAreaElement, "propaganda");
    click(buttonByText("Enviar denúncia"));
    await until(() => callsOf(state, "POST", /comments\/100\/report$/).length === 1, "POST report");
    expect(callsOf(state, "POST", /comments\/100\/report$/)[0]?.body).toEqual({ reason: "SPAM", note: "propaganda" });
    await until(() => toastMock.success.mock.calls.length === 1, "toast");
  });
});

describe("menu do post: denunciar, apagar e editar", () => {
  it("menu de outra pessoa: só Denunciar (sem Editar/Apagar); envia motivo e nota", async () => {
    const state = mockFeedApi({ pages: { "": { items: [makePost({ id: 8 })], nextCursor: null } } });
    await mount(<FeedPage />);
    await until(() => cards().length === 1, "post");
    await openMenuOf(cards()[0]!);
    expect($("[data-testid=menu-edit]")).toBeNull();
    expect($("[data-testid=menu-delete]")).toBeNull();
    click($("[data-testid=menu-report]"));
    await settle();
    expect(text()).toContain("Denunciar publicação");
    const reasons = $$("input[name=report-reason]").map((input) => (input as HTMLInputElement).value);
    expect(reasons).toEqual(["OFENSIVO", "IMPROPRIO", "SPAM", "MENOR", "OUTRO"]);
    click($("input[name=report-reason][value=OUTRO]"));
    typeInto($("#report-note") as HTMLTextAreaElement, "não gostei");
    click(buttonByText("Enviar denúncia"));
    await until(() => callsOf(state, "POST", /posts\/8\/report$/).length === 1, "POST report");
    expect(callsOf(state, "POST", /posts\/8\/report$/)[0]?.body).toEqual({ reason: "OUTRO", note: "não gostei" });
  });

  it("denúncia repetida: o backend real responde 200 { ok:true } de novo (sem 409) e a tela agradece como na primeira", async () => {
    // mockFeedApi já responde 200 { ok: true } a QUALQUER denúncia, igual ao backend real (provado em PLANO_PROJETO.md).
    mockFeedApi({ pages: { "": { items: [makePost({ id: 8 })], nextCursor: null } } });
    await mount(<FeedPage />);
    await until(() => cards().length === 1, "post");
    for (let round = 0; round < 2; round += 1) {
      await openMenuOf(cards()[0]!);
      click($("[data-testid=menu-report]"));
      await settle();
      click($("input[name=report-reason][value=SPAM]"));
      click(buttonByText("Enviar denúncia"));
      await until(() => toastMock.success.mock.calls.length === round + 1, "aviso de sucesso");
    }
    expect(toastMock.info).not.toHaveBeenCalled();
  });

  it("denúncia repetida (409, tolerância a um backend que devolva conflito) avisa que já denunciou", async () => {
    mockFeedApi({
      pages: { "": { items: [makePost({ id: 8 })], nextCursor: null } },
      respond: (call) => (/report$/.test(call.path) ? json(409, { message: "duplicada", code: "ALREADY_REPORTED" }) : undefined),
    });
    await mount(<FeedPage />);
    await until(() => cards().length === 1, "post");
    await openMenuOf(cards()[0]!);
    click($("[data-testid=menu-report]"));
    await settle();
    click($("input[name=report-reason][value=SPAM]"));
    click(buttonByText("Enviar denúncia"));
    await until(() => toastMock.info.mock.calls.length === 1, "aviso");
    expect(toastMock.info.mock.calls[0]?.[0]).toBe("Você já denunciou este conteúdo.");
  });

  it("autor: Editar e Apagar, sem Denunciar", async () => {
    mockFeedApi({ pages: { "": { items: [makePost({ id: 8, canEdit: true, canDelete: true })], nextCursor: null } } });
    await mount(<FeedPage />);
    await until(() => cards().length === 1, "post");
    await openMenuOf(cards()[0]!);
    expect($("[data-testid=menu-edit]")).not.toBeNull();
    expect($("[data-testid=menu-delete]")).not.toBeNull();
    expect($("[data-testid=menu-report]")).toBeNull();
  });

  it("moderador (não autor): Apagar e Denunciar, sem Editar", async () => {
    mockFeedApi({ pages: { "": { items: [makePost({ id: 8, canDelete: true, canModerate: true })], nextCursor: null } } });
    await mount(<FeedPage />);
    await until(() => cards().length === 1, "post");
    await openMenuOf(cards()[0]!);
    expect($("[data-testid=menu-edit]")).toBeNull();
    expect($("[data-testid=menu-delete]")).not.toBeNull();
    expect($("[data-testid=menu-report]")).not.toBeNull();
  });

  it("apagar pede confirmação; cancelar não chama a API; confirmar remove o cartão", async () => {
    const state = mockFeedApi({
      pages: { "": { items: [makePost({ id: 8, canEdit: true, canDelete: true }), makePost({ id: 9 })], nextCursor: null } },
    });
    await mount(<FeedPage />);
    await until(() => cards().length === 2, "posts");
    await openMenuOf(cards()[0]!);
    click($("[data-testid=menu-delete]"));
    await settle();
    expect(text()).toContain("Apagar publicação?");
    click([...document.body.querySelectorAll("[role=alertdialog] button")].find((b) => b.textContent === "Cancelar"));
    await settle();
    expect(callsOf(state, "DELETE", /posts\/8$/)).toHaveLength(0);
    expect(cards()).toHaveLength(2);
    await openMenuOf(cards()[0]!);
    click($("[data-testid=menu-delete]"));
    await settle();
    click([...document.body.querySelectorAll("[role=alertdialog] button")].find((b) => b.textContent === "Apagar"));
    await until(() => cards().length === 1, "cartão removido");
    expect(callsOf(state, "DELETE", /posts\/8$/)).toHaveLength(1);
    expect(cards()[0]?.getAttribute("data-post-id")).toBe("9");
  });

  it("editar: abre com o texto atual, salva (PATCH) e marca como editado", async () => {
    const state = mockFeedApi({ pages: { "": { items: [makePost({ id: 8, body: "texto antigo", canEdit: true })], nextCursor: null } } });
    await mount(<FeedPage />);
    await until(() => cards().length === 1, "post");
    await openMenuOf(cards()[0]!);
    click($("[data-testid=menu-edit]"));
    await settle();
    const field = $("#edit-post-8") as HTMLTextAreaElement;
    expect(field.value).toBe("texto antigo");
    expect((buttonByText("Salvar") as HTMLButtonElement).disabled).toBe(true);
    typeInto(field, "texto novo");
    click($("[data-testid=edit-save]"));
    await until(() => callsOf(state, "PATCH", /posts\/8$/).length === 1, "PATCH");
    expect(callsOf(state, "PATCH", /posts\/8$/)[0]?.body).toEqual({ body: "texto novo" });
    await until(() => $("[data-testid=post-edited]") !== null, "marcado editado");
    expect($("[data-testid=post-body]")?.textContent).toBe("texto novo");
  });
});
