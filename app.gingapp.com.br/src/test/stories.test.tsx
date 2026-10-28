import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { StoriesRow } from "@/components/gingapp/stories/stories-row";
import {
  STORY_CAPTION_MAX,
  STORY_DURATION_MS,
  allPending,
  firstUnseenIndex,
  markStorySeenInCache,
  orderStoryGroups,
  removeStoryFromCache,
  storyGroupKey,
  type StoriesResponse,
  type StoryGroup,
  type StoryItem,
} from "@/lib/stories";
import { feedErrorMessage, feedKeys } from "@/lib/feed";
import { ApiError } from "@/lib/api";
import {
  $,
  $$,
  callsOf,
  chooseFiles,
  cleanup,
  click,
  json,
  makeMedia,
  makeSettings,
  mockFeedApi,
  mount,
  photo,
  settle,
  typeInto,
  until,
  type ApiCall,
  type MockState,
} from "./feed-fixtures";

/**
 * Stories da Home (app): linha (ordem, anel, "Seu story", ocultação), visualizador (toque, barras, auto-avanço, pausa,
 * Esc, view, apagar, reduced-motion) e criador (validações, upload, publicar, erros, aprovação). API 100% mockada.
 */

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

function item(id: number, over: Partial<StoryItem> = {}): StoryItem {
  return {
    id,
    media: makeMedia(id, 1080, 1920),
    caption: null,
    createdAt: minutesAgo(5),
    expiresAt: inHours(20),
    seen: false,
    status: "PUBLISHED",
    ...over,
  };
}

function group(userId: number, name: string, items: StoryItem[], over: Partial<StoryGroup> = {}): StoryGroup {
  return {
    author: { userId, name, nickname: null, photo: null, roleLabel: null },
    isMine: false,
    hasUnseen: items.some((entry) => !entry.seen),
    items,
    ...over,
  };
}

interface Ctx {
  groups: StoryGroup[];
  /** Status do GET /feed/stories (200 = devolve `groups`). */
  storiesStatus: number;
  /** Resposta própria do POST /feed/stories. */
  create: ((call: ApiCall) => Response) | undefined;
  state: MockState;
}

function setup(groups: StoryGroup[], opts: { settings?: Partial<ReturnType<typeof makeSettings>>; classes?: unknown[] } = {}): Ctx {
  const ctx = { groups, storiesStatus: 200, create: undefined as Ctx["create"] } as Ctx;
  ctx.state = mockFeedApi({
    settings: makeSettings(opts.settings),
    classes: opts.classes ?? [],
    respond: (call) => {
      if (call.path === "/feed/stories" && call.method === "GET") {
        return ctx.storiesStatus === 200 ? json(200, { groups: ctx.groups }) : json(ctx.storiesStatus, { message: "erro no servidor" });
      }
      if (call.path === "/feed/stories" && call.method === "POST") {
        return (
          ctx.create?.(call) ??
          json(201, { id: 900, type: "POST", kind: "STORY", status: "PUBLISHED", expiresAt: inHours(24) })
        );
      }
      if (/^\/feed\/stories\/\d+\/view$/.test(call.path) && call.method === "POST") return json(204);
      return undefined;
    },
  });
  return ctx;
}

const row = () => $("[data-testid=stories-row]");
const cardIds = () => $$("[data-testid=stories-list] > li").map((li) => (li.getAttribute("data-testid") === "my-story-card" ? "mine" : li.getAttribute("data-author-id")));
const viewer = () => $("[data-testid=story-viewer]");
const bars = () => $$("[data-testid=story-bar]").map((bar) => bar.getAttribute("data-state"));
const imageSrc = () => $<HTMLImageElement>("[data-testid=story-image]")?.getAttribute("src") ?? "";
const storyCard = (userId: number) => $<HTMLButtonElement>(`[data-testid=story-card][data-author-id="${userId}"] button`)!;
const loadImage = () => act(() => void $("[data-testid=story-image]")?.dispatchEvent(new Event("load")));
const viewCalls = (ctx: Ctx) => callsOf(ctx.state, "POST", /^\/feed\/stories\/\d+\/view$/).map((call) => call.path);

async function mountRow(ctx: Ctx) {
  const mounted = await mount(<StoriesRow />);
  await settle();
  void ctx;
  return mounted;
}

async function openViewer(userId: number) {
  const button = storyCard(userId);
  button.focus();
  click(button);
  await until(() => viewer() !== null, "visualizador");
  loadImage();
  await settle();
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.info.mockClear();
  localStorage.clear();
});

describe("funções puras de stories", () => {
  const a = group(1, "Ana", [item(1, { seen: true })]);
  const b = group(2, "Bruno", [item(2)]);
  const c = group(3, "Carla", [item(3)]);
  const mine = group(9, "Eu", [item(9, { seen: true })], { isMine: true });

  it("ordena: meu grupo, depois não vistos (ordem do servidor), depois vistos; descarta grupo vazio", () => {
    const empty = group(4, "Vazio", []);
    expect(orderStoryGroups([a, b, mine, empty, c]).map(storyGroupKey)).toEqual(["mine", "u2", "u3", "u1"]);
  });

  it("chave do grupo é estável para o autor, para mim e para autor anonimizado", () => {
    expect(storyGroupKey(mine)).toBe("mine");
    expect(storyGroupKey(b)).toBe("u2");
    expect(storyGroupKey({ ...b, author: null })).toBe("a2");
  });

  it("começa no primeiro não visto (ou no primeiro) e detecta tudo pendente", () => {
    const g = group(5, "Duda", [item(10, { seen: true }), item(11, { seen: true }), item(12), item(13)]);
    expect(firstUnseenIndex(g)).toBe(2);
    expect(firstUnseenIndex(a)).toBe(0);
    expect(allPending(group(9, "Eu", [item(1, { status: "PENDING_APPROVAL" })]))).toBe(true);
    expect(allPending(group(9, "Eu", [item(1, { status: "PENDING_APPROVAL" }), item(2)]))).toBe(false);
    expect(allPending(undefined)).toBe(false);
  });

  it("mensagens de erro do story: STORY_LIMIT, MEDIA_INVALID e POSTING_NOT_ALLOWED", () => {
    expect(feedErrorMessage(new ApiError("x", 429, "STORY_LIMIT"), "fb")).toContain("limite de stories");
    expect(feedErrorMessage(new ApiError("x", 400, "MEDIA_INVALID"), "fb")).toContain("expirou");
    expect(feedErrorMessage(new ApiError("x", 403, "POSTING_NOT_ALLOWED"), "fb")).toContain("permissão");
  });
});

describe("linha de stories", () => {
  it("ordem: meu primeiro, depois não vistos, depois vistos (mesmo se o servidor mandar fora de ordem)", async () => {
    const ctx = setup([
      group(1, "Ana Souza", [item(11, { seen: true })]),
      group(2, "Bruno Lima", [item(21)]),
      group(9, "Eu Mesmo", [item(91, { seen: true })], { isMine: true }),
      group(3, "Carla Dias", [item(31)]),
    ]);
    await mountRow(ctx);
    await until(() => row() !== null, "linha de stories");
    expect(cardIds()).toEqual(["mine", "2", "3", "1"]);
  });

  it("anel de marca para não visto e cinza para já visto; o nome vem embaixo (apelido, senão primeiro nome)", async () => {
    const ctx = setup([
      group(1, "Ana Souza", [item(11, { seen: true })]),
      group(2, "Bruno Lima", [item(21)], { author: { userId: 2, name: "Bruno Lima", nickname: "Brunão", photo: null, roleLabel: null } }),
    ]);
    await mountRow(ctx);
    await until(() => row() !== null, "linha");
    const ring = (userId: number) => $(`[data-testid=story-card][data-author-id="${userId}"] [data-testid=story-ring]`)?.getAttribute("data-unseen");
    expect(ring(2)).toBe("true");
    expect(ring(1)).toBe("false");
    const names = $$("[data-testid=story-name]").map((node) => node.textContent);
    expect(names).toEqual(["Brunão", "Ana"]);
    expect(storyCard(2).getAttribute("aria-label")).toBe("Ver story de Bruno Lima (Brunão) (novo)");
  });

  it("cartão vertical: foto de fundo (miniatura, lazy, com largura/altura), avatar sobreposto e rolagem horizontal DENTRO da linha", async () => {
    const ctx = setup([group(2, "Bruno Lima", [item(21)])]);
    await mountRow(ctx);
    await until(() => row() !== null, "linha");
    const img = $<HTMLImageElement>("[data-testid=story-card] img")!;
    expect(img.getAttribute("src")).toContain("/api/feed/media/21?e=9999999999&s=thumb21");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("width")).toBe("1080");
    expect(img.getAttribute("height")).toBe("1920");
    expect(img.className).toContain("object-cover");
    expect($("[data-testid=story-card] [data-testid=avatar]")).not.toBeNull();
    const list = $("[data-testid=stories-list]")!;
    expect(list.className).toContain("overflow-x-auto");
    expect(list.className).toContain("snap-x");
    expect(row()!.className).toContain("max-w-full");
    expect($("[data-testid=story-card]")!.className).toContain("w-[104px]");
  });

  it("'Seu story' sem story meu e com permissão: cartão com + que abre o criador", async () => {
    const ctx = setup([group(2, "Bruno Lima", [item(21)])]);
    await mountRow(ctx);
    await until(() => $("[data-testid=my-story-card]") !== null, "Seu story");
    expect($("[data-testid=my-story-card]")?.getAttribute("data-state")).toBe("empty");
    expect($("[data-testid=my-story-plus]")).not.toBeNull();
    click($("[data-testid=my-story-card] button"));
    await until(() => $("[data-testid=story-composer]") !== null, "criador");
  });

  it("'Seu story' com story publicado: miniatura minha, abre o visualizador; '+' separado cria outro", async () => {
    const ctx = setup([group(9, "Eu Mesmo", [item(91, { seen: true })], { isMine: true })]);
    await mountRow(ctx);
    await until(() => $("[data-testid=my-story-card]") !== null, "Seu story");
    expect($("[data-testid=my-story-card]")?.getAttribute("data-state")).toBe("active");
    expect($("[data-testid=my-story-card] img")?.getAttribute("src")).toContain("thumb91");
    click($("[data-testid=my-story-add]"));
    await until(() => $("[data-testid=story-composer]") !== null, "criador");
  });

  it("'Seu story' com tudo pendente: estado 'aguardando aprovação'", async () => {
    const ctx = setup([group(9, "Eu Mesmo", [item(91, { status: "PENDING_APPROVAL", seen: true })], { isMine: true })]);
    await mountRow(ctx);
    await until(() => $("[data-testid=my-story-card]") !== null, "Seu story");
    expect($("[data-testid=my-story-card]")?.getAttribute("data-state")).toBe("pending");
    expect($("[data-testid=my-story-pending]")?.textContent).toContain("Aguardando aprovação");
    expect($("[data-testid=my-story-card] button")?.getAttribute("aria-label")).toContain("aguardando aprovação");
  });

  it("sem permissão de postar (canPost=false): sem '+' e sem criador, mas os stories dos outros aparecem", async () => {
    const ctx = setup([group(2, "Bruno Lima", [item(21)])], { settings: { canPost: false, postingMode: "STAFF_ONLY" } });
    await mountRow(ctx);
    await until(() => row() !== null, "linha");
    expect($("[data-testid=my-story-card]")).toBeNull();
    expect($("[data-testid=my-story-plus]")).toBeNull();
    expect(cardIds()).toEqual(["2"]);
    expect($("[data-testid=story-composer]")).toBeNull();
  });

  it("sem nenhum story E sem permissão de postar: a linha inteira se esconde", async () => {
    const ctx = setup([], { settings: { canPost: false } });
    await mountRow(ctx);
    await until(() => callsOf(ctx.state, "GET", /^\/feed\/stories$/).length === 1, "stories pedidos");
    await settle();
    expect(row()).toBeNull();
  });

  it("sem nenhum story mas com permissão: só o 'Seu story'", async () => {
    const ctx = setup([]);
    await mountRow(ctx);
    await until(() => row() !== null, "linha");
    expect(cardIds()).toEqual(["mine"]);
  });

  it("feed DESLIGADO: nada na tela e /feed/stories nem é pedido", async () => {
    const ctx = setup([group(2, "Bruno Lima", [item(21)])], { settings: { enabled: false } });
    await mountRow(ctx);
    await settle(80);
    expect(row()).toBeNull();
    expect(callsOf(ctx.state, "GET", /^\/feed\/stories$/)).toHaveLength(0);
  });

  it("carregando (configuração do feed nunca responde) ou erro nos stories: oculto, sem mensagem de erro", async () => {
    const ctx = setup([group(2, "Bruno Lima", [item(21)])]);
    ctx.storiesStatus = 500;
    await mountRow(ctx);
    await until(() => callsOf(ctx.state, "GET", /^\/feed\/stories$/).length === 1, "stories pedidos");
    await settle();
    expect(row()).toBeNull();
    expect(document.body.textContent).not.toMatch(/erro|tentar/i);
  });

  it("configuração do feed pendente: oculto", async () => {
    mockFeedApi({ respond: (call) => (call.path === "/feed/settings" ? new Promise<Response>(() => {}) : undefined) });
    await mount(<StoriesRow />);
    await settle(60);
    expect(row()).toBeNull();
  });

  it("imagem quebrada (URL assinada vencida): refaz a consulta UMA vez por mídia", async () => {
    const ctx = setup([group(2, "Bruno Lima", [item(21)])]);
    await mountRow(ctx);
    await until(() => row() !== null, "linha");
    const img = $("[data-testid=story-card] img")!;
    act(() => void img.dispatchEvent(new Event("error")));
    await until(() => callsOf(ctx.state, "GET", /^\/feed\/stories$/).length === 2, "recarga dos stories");
    act(() => void $("[data-testid=story-card] img")!.dispatchEvent(new Event("error")));
    await settle(80);
    expect(callsOf(ctx.state, "GET", /^\/feed\/stories$/)).toHaveLength(2);
  });

  it("não guarda nada em localStorage", async () => {
    const ctx = setup([group(2, "Bruno Lima", [item(21)])]);
    await mountRow(ctx);
    await until(() => row() !== null, "linha");
    await openViewer(2);
    expect(localStorage.length).toBe(0);
  });
});

describe("visualizador", () => {
  const trio = () => [item(11, { caption: "Primeira foto" }), item(12, { caption: "Segunda" }), item(13)];

  it("abre em tela cheia como diálogo acessível, com cabeçalho, legenda, barras por foto e rolagem da página bloqueada", async () => {
    const ctx = setup([group(1, "Ana Souza", trio())]);
    await mountRow(ctx);
    await until(() => row() !== null, "linha");
    await openViewer(1);
    const dialog = $("[role=dialog]")!;
    expect(dialog.getAttribute("aria-label")).toBe("Story de Ana Souza");
    expect($("[data-testid=story-author]")?.textContent).toBe("Ana Souza");
    expect($("[data-testid=story-time]")?.textContent).toContain("5 minutos");
    expect($("[data-testid=story-caption]")?.textContent).toBe("Primeira foto");
    expect(bars()).toEqual(["active", "todo", "todo"]);
    expect(imageSrc()).toContain("/api/feed/media/11?e=");
    expect($("[data-testid=story-image]")?.getAttribute("width")).toBe("1080");
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(true);
  });

  it("começa no primeiro story ainda não visto do autor", async () => {
    const ctx = setup([group(1, "Ana Souza", [item(11, { seen: true }), item(12), item(13)])]);
    await mountRow(ctx);
    await until(() => row() !== null, "linha");
    await openViewer(1);
    expect(bars()).toEqual(["done", "active", "todo"]);
    expect(imageSrc()).toContain("/media/12?");
  });

  it("toque na metade direita avança, na esquerda volta; barras acompanham", async () => {
    const ctx = setup([group(1, "Ana Souza", trio())]);
    await mountRow(ctx);
    await until(() => row() !== null, "linha");
    await openViewer(1);
    click($("[data-testid=story-next]"));
    expect(bars()).toEqual(["done", "active", "todo"]);
    expect(imageSrc()).toContain("/media/12?");
    expect($("[data-testid=story-caption]")?.textContent).toBe("Segunda");
    click($("[data-testid=story-next]"));
    expect(bars()).toEqual(["done", "done", "active"]);
    click($("[data-testid=story-prev]"));
    expect(bars()).toEqual(["done", "active", "todo"]);
    expect($("[data-testid=story-next]")?.className).toContain("right-0");
    expect($("[data-testid=story-prev]")?.className).toContain("left-0");
  });

  it("setas do teclado navegam", async () => {
    const ctx = setup([group(1, "Ana Souza", trio())]);
    await mountRow(ctx);
    await until(() => row() !== null, "linha");
    await openViewer(1);
    act(() => void viewer()!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(bars()).toEqual(["done", "active", "todo"]);
    act(() => void viewer()!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(bars()).toEqual(["active", "todo", "todo"]);
  });

  it("ao terminar as fotos de um autor passa para o próximo; no fim da fila fecha", async () => {
    const ctx = setup([group(1, "Ana Souza", [item(11)]), group(2, "Bruno Lima", [item(21), item(22)])]);
    await mountRow(ctx);
    await until(() => row() !== null, "linha");
    await openViewer(1);
    expect($("[data-testid=story-author]")?.textContent).toBe("Ana Souza");
    click($("[data-testid=story-next]"));
    expect($("[data-testid=story-author]")?.textContent).toBe("Bruno Lima");
    expect(bars()).toEqual(["active", "todo"]);
    click($("[data-testid=story-next]"));
    click($("[data-testid=story-next]"));
    await until(() => viewer() === null, "viewer fechado");
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
  });

  it("voltar na primeira foto do segundo autor leva à ÚLTIMA foto do autor anterior", async () => {
    const ctx = setup([group(1, "Ana Souza", [item(11), item(12)]), group(2, "Bruno Lima", [item(21)])]);
    await mountRow(ctx);
    await until(() => row() !== null, "linha");
    await openViewer(2);
    expect($("[data-testid=story-author]")?.textContent).toBe("Bruno Lima");
    click($("[data-testid=story-prev]"));
    expect($("[data-testid=story-author]")?.textContent).toBe("Ana Souza");
    expect(bars()).toEqual(["done", "active"]);
  });

  it("fecha pelo X e pelo Esc e devolve o foco ao cartão", async () => {
    const ctx = setup([group(1, "Ana Souza", trio())]);
    await mountRow(ctx);
    await until(() => row() !== null, "linha");
    await openViewer(1);
    click($("[data-testid=story-close]"));
    await until(() => viewer() === null, "fechou pelo X");
    await settle(); // o Radix devolve o foco num timeout de 0 ms depois de desmontar
    expect(document.activeElement).toBe(storyCard(1));
    await openViewer(1);
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await until(() => viewer() === null, "fechou pelo Esc");
    await settle();
    expect(document.activeElement).toBe(storyCard(1));
  });

  it("marca 'visto' ao exibir cada foto dos outros (uma vez), atualiza o anel e não marca as minhas nem as já vistas", async () => {
    const ctx = setup([
      group(1, "Ana Souza", [item(11, { seen: true }), item(12), item(13)]),
      group(9, "Eu Mesmo", [item(91, { seen: true })], { isMine: true }),
    ]);
    await mountRow(ctx);
    await until(() => row() !== null, "linha");
    await openViewer(1);
    await until(() => viewCalls(ctx).length === 1, "view da foto 12");
    expect(viewCalls(ctx)).toEqual(["/feed/stories/12/view"]);
    click($("[data-testid=story-next]"));
    await until(() => viewCalls(ctx).length === 2, "view da foto 13");
    click($("[data-testid=story-prev]"));
    click($("[data-testid=story-next]"));
    await settle();
    expect(viewCalls(ctx)).toEqual(["/feed/stories/12/view", "/feed/stories/13/view"]);
    click($("[data-testid=story-close]"));
    await until(() => viewer() === null, "fechou");
    expect($("[data-testid=story-card] [data-testid=story-ring]")?.getAttribute("data-unseen")).toBe("false");
    await openViewer(1); // tudo visto: abre, mas não marca de novo
    expect(viewCalls(ctx)).toHaveLength(2);
    click($("[data-testid=story-close]"));
    // o meu: nunca marca
    click($("[data-testid=my-story-card] button"));
    await until(() => viewer() !== null, "meu viewer");
    await settle();
    expect(viewCalls(ctx)).toHaveLength(2);
  });

  it("falha do /view não incomoda: sem toast de erro", async () => {
    const ctx = setup([group(1, "Ana Souza", [item(11)])]);
    const original = ctx.state.respond;
    ctx.state.respond = (call) => (/\/view$/.test(call.path) ? json(500, { message: "x" }) : original?.(call));
    await mountRow(ctx);
    await until(() => row() !== null, "linha");
    await openViewer(1);
    await settle(60);
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(viewer()).not.toBeNull();
  });

  it("'Apagar' só aparece nos meus; pede confirmação, apaga (DELETE /feed/posts/:id), fecha e avisa", async () => {
    const ctx = setup([group(1, "Ana Souza", [item(11)]), group(9, "Eu Mesmo", [item(91, { seen: true })], { isMine: true })]);
    await mountRow(ctx);
    await until(() => row() !== null, "linha");
    await openViewer(1);
    expect($("[data-testid=story-delete]")).toBeNull();
    click($("[data-testid=story-close]"));
    await until(() => viewer() === null, "fechou");

    click($("[data-testid=my-story-card] button"));
    await until(() => $("[data-testid=story-delete]") !== null, "Apagar nos meus");
    click($("[data-testid=story-delete]"));
    await until(() => $("[role=alertdialog]") !== null, "confirmação");
    expect($("[role=alertdialog]")?.textContent).toContain("Apagar story?");
    // Cancelar não apaga
    click([...document.querySelectorAll("[role=alertdialog] button")].find((b) => b.textContent === "Cancelar"));
    await until(() => $("[role=alertdialog]") === null, "confirmação fechou");
    expect(callsOf(ctx.state, "DELETE", /^\/feed\/posts\//)).toHaveLength(0);

    click($("[data-testid=story-delete]"));
    await until(() => $("[role=alertdialog]") !== null, "confirmação 2");
    ctx.groups = [group(1, "Ana Souza", [item(11)])]; // o servidor já não devolve o meu
    click([...document.querySelectorAll("[role=alertdialog] button")].find((b) => b.textContent === "Apagar"));
    await until(() => callsOf(ctx.state, "DELETE", /^\/feed\/posts\/91$/).length === 1, "DELETE");
    await until(() => viewer() === null || $("[data-testid=story-author]")?.textContent === "Ana Souza", "seguiu em frente");
    expect(toastMock.success).toHaveBeenCalledWith("Story apagado.");
    await until(() => $("[data-testid=my-story-card]")?.getAttribute("data-state") === "empty", "meu cartão voltou ao +");
  });

  it("mostra 'Aguardando aprovação' no meu story pendente", async () => {
    const ctx = setup([group(9, "Eu Mesmo", [item(91, { seen: true, status: "PENDING_APPROVAL" })], { isMine: true })]);
    await mountRow(ctx);
    await until(() => row() !== null, "linha");
    click($("[data-testid=my-story-card] button"));
    await until(() => viewer() !== null, "viewer");
    expect($("[data-testid=story-pending]")?.textContent).toContain("Aguardando aprovação");
    expect($("[data-testid=story-author]")?.textContent).toBe("Seu story");
  });
});

describe("auto-avanço (relógio falso)", () => {
  const trio = () => [item(11), item(12), item(13)];

  async function openWithClock(groups: StoryGroup[]) {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ctx = setup(groups);
    await mountRow(ctx);
    await until(() => row() !== null, "linha");
    await openViewer(1);
    return ctx;
  }
  const advance = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

  it("avança sozinho depois de 5 s (não antes) e a barra ativa anda", async () => {
    await openWithClock([group(1, "Ana Souza", trio())]);
    expect(STORY_DURATION_MS).toBe(5000);
    await advance(3000);
    expect(bars()).toEqual(["active", "todo", "todo"]);
    const fill = $<HTMLElement>("[data-testid=story-bar][data-state=active] span")!;
    expect(fill.style.animation).toContain("story-progress 5000ms linear");
    expect(fill.style.animationPlayState).toBe("running");
    await advance(2300);
    expect(bars()).toEqual(["done", "active", "todo"]);
  });

  it("só começa a contar depois que a foto carregou", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ctx = setup([group(1, "Ana Souza", trio())]);
    await mountRow(ctx);
    await until(() => row() !== null, "linha");
    click(storyCard(1));
    await until(() => viewer() !== null, "viewer");
    await advance(12000);
    expect(bars()).toEqual(["active", "todo", "todo"]); // sem load, não avança
    expect($<HTMLElement>("[data-testid=story-bar][data-state=active] span")?.style.animationPlayState).toBe("paused");
    loadImage();
    await advance(5500);
    expect(bars()).toEqual(["done", "active", "todo"]);
  });

  it("segurar pausa (e soltar retoma de onde parou); segurar não troca de foto ao soltar", async () => {
    await openWithClock([group(1, "Ana Souza", trio())]);
    await advance(3000);
    const media = $("[data-testid=story-image]")!.parentElement!;
    act(() => void media.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    await advance(20000);
    expect(bars()).toEqual(["active", "todo", "todo"]);
    expect($<HTMLElement>("[data-testid=story-bar][data-state=active] span")?.style.animationPlayState).toBe("paused");
    act(() => void media.dispatchEvent(new Event("pointerup", { bubbles: true })));
    click($("[data-testid=story-next]")); // clique logo após uma retenção longa é ignorado
    expect(bars()).toEqual(["active", "todo", "todo"]);
    await advance(1000);
    expect(bars()).toEqual(["active", "todo", "todo"]); // falta ~2 s
    await advance(1800);
    expect(bars()).toEqual(["done", "active", "todo"]);
  });

  it("aba oculta pausa; ao voltar retoma", async () => {
    await openWithClock([group(1, "Ana Souza", trio())]);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    await advance(15000);
    expect(bars()).toEqual(["active", "todo", "todo"]);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    await advance(5500);
    expect(bars()).toEqual(["done", "active", "todo"]);
  });

  it("a confirmação de apagar também pausa", async () => {
    const mine = group(9, "Eu Mesmo", [item(91, { seen: true }), item(92, { seen: true })], { isMine: true });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ctx = setup([mine]);
    await mountRow(ctx);
    await until(() => row() !== null, "linha");
    click($("[data-testid=my-story-card] button"));
    await until(() => viewer() !== null, "viewer");
    loadImage();
    await advance(1000);
    click($("[data-testid=story-delete]"));
    await until(() => $("[role=alertdialog]") !== null, "confirmação");
    await advance(15000);
    expect(bars()).toEqual(["active", "todo"]);
  });

  it("depois da última foto do último autor, fecha sozinho", async () => {
    await openWithClock([group(1, "Ana Souza", [item(11)])]);
    await advance(5500);
    await until(() => viewer() === null, "fechou sozinho");
  });

  it("prefers-reduced-motion: sem avanço automático; barra ativa cheia e estática; navegação manual segue", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: /reduce/.test(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    try {
      await openWithClock([group(1, "Ana Souza", trio())]);
      await advance(30000);
      expect(bars()).toEqual(["active", "todo", "todo"]);
      expect($<HTMLElement>("[data-testid=story-bar][data-state=active] span")?.style.animation).toBe("");
      expect($("[role=dialog]")?.textContent).toContain("avanço automático está desligado");
      click($("[data-testid=story-next]"));
      expect(bars()).toEqual(["done", "active", "todo"]);
    } finally {
      window.matchMedia = original;
    }
  });
});

describe("cache de stories", () => {
  const base = (): StoriesResponse => ({
    groups: [group(1, "Ana", [item(11), item(12)]), group(9, "Eu", [item(91, { seen: true })], { isMine: true })],
  });

  it("markStorySeenInCache recalcula hasUnseen; removeStoryFromCache tira o grupo vazio", async () => {
    const { queryClient } = await mount(<span />);
    queryClient.setQueryData(feedKeys.stories, base());
    markStorySeenInCache(queryClient, 11);
    let data = queryClient.getQueryData<StoriesResponse>(feedKeys.stories)!;
    expect(data.groups[0]!.hasUnseen).toBe(true);
    markStorySeenInCache(queryClient, 12);
    data = queryClient.getQueryData<StoriesResponse>(feedKeys.stories)!;
    expect(data.groups[0]!.hasUnseen).toBe(false);
    removeStoryFromCache(queryClient, 91);
    data = queryClient.getQueryData<StoriesResponse>(feedKeys.stories)!;
    expect(data.groups.map(storyGroupKey)).toEqual(["u1"]);
  });
});

describe("criador de story", () => {
  const fileInput = () => $("[data-testid=story-file-input]") as HTMLInputElement;
  const publish = () => $("[data-testid=story-publish]") as HTMLButtonElement;
  const caption = () => $("#story-caption") as HTMLTextAreaElement;

  async function openComposer(ctx: Ctx = setup([])) {
    await mountRow(ctx);
    await until(() => $("[data-testid=my-story-card]") !== null, "Seu story");
    click($("[data-testid=my-story-card] button"));
    await until(() => caption() !== null, "folha do criador");
    return ctx;
  }

  it("abre como folha, com Galeria/Câmera, contador 0/140 e Publicar desligado sem foto", async () => {
    await openComposer();
    expect($("[data-testid=story-composer]")).not.toBeNull();
    expect($("[data-testid=story-pick-gallery]")).not.toBeNull();
    expect($("[data-testid=story-pick-camera]")).not.toBeNull();
    expect(fileInput().getAttribute("accept")).toBe("image/jpeg,image/png,image/webp");
    expect($("[data-testid=story-camera-input]")?.getAttribute("capture")).toBe("environment");
    expect($("[data-testid=story-counter]")?.textContent).toBe(`0/${STORY_CAPTION_MAX}`);
    expect(publish().disabled).toBe(true);
  });

  it("legenda: contador e limite de 140", async () => {
    await openComposer();
    typeInto(caption(), "Roda boa!");
    expect($("[data-testid=story-counter]")?.textContent).toBe("9/140");
    typeInto(caption(), "x".repeat(300));
    expect(caption().value.length).toBe(140);
    expect($("[data-testid=story-counter]")?.textContent).toBe("140/140");
    expect(caption().getAttribute("maxlength")).toBe("140");
  });

  it("valida no cliente: tipo, 5 MB e HEIC (mensagem amigável) sem gastar rede", async () => {
    const ctx = await openComposer();
    chooseFiles(fileInput(), [photo("anim.gif", "image/gif")]);
    expect($("[data-testid=story-file-error]")?.textContent).toContain("JPEG, PNG ou WebP");
    chooseFiles(fileInput(), [photo("grande.jpg", "image/jpeg", 5 * 1024 * 1024 + 1)]);
    expect($("[data-testid=story-file-error]")?.textContent).toContain("5 MB");
    chooseFiles(fileInput(), [photo("iphone.heic", "image/heic")]);
    expect($("[data-testid=story-file-error]")?.textContent).toContain("HEIC");
    await settle();
    expect(callsOf(ctx.state, "POST", /^\/feed\/media$/)).toHaveLength(0);
    expect($("[data-testid=story-preview]")).toBeNull();
    expect(publish().disabled).toBe(true);
  });

  it("envia a foto ao escolher, mostra a miniatura e publica com legenda e visibilidade 'Todo o grupo'", async () => {
    const ctx = await openComposer();
    chooseFiles(fileInput(), [photo("treino.jpg")]);
    expect(publish().disabled).toBe(true);
    await until(() => $("[data-testid=story-preview]")?.getAttribute("data-status") === "done", "upload concluído");
    const upload = callsOf(ctx.state, "POST", /^\/feed\/media$/);
    expect(upload).toHaveLength(1);
    expect((upload[0]?.form?.get("file") as File).name).toBe("treino.jpg");
    expect($("[data-testid=story-preview] img")).not.toBeNull();
    typeInto(caption(), "  Treino de hoje  ");
    expect(publish().disabled).toBe(false);
    ctx.groups = [group(9, "Eu Mesmo", [item(901, { seen: true, caption: "Treino de hoje" })], { isMine: true })];
    click(publish());
    await until(() => callsOf(ctx.state, "POST", /^\/feed\/stories$/).length === 1, "POST /feed/stories");
    const body = callsOf(ctx.state, "POST", /^\/feed\/stories$/)[0]!.body as Record<string, unknown>;
    expect(body).toEqual({ mediaId: 501, caption: "Treino de hoje", visibility: "GROUP" });
    await until(() => $("[data-testid=story-composer]") === null, "folha fechou");
    expect(toastMock.success).toHaveBeenCalledWith("Story publicado!");
    // aparece em "Seu story" depois da recarga
    await until(() => $("[data-testid=my-story-card]")?.getAttribute("data-state") === "active", "meu story na linha");
    expect(localStorage.length).toBe(0);
  });

  it("story que fica PENDING_APPROVAL: avisa 'Enviado para aprovação' e o cartão mostra o estado pendente", async () => {
    const ctx = setup([], { settings: { requiresApproval: true } });
    ctx.create = () => json(201, { id: 902, type: "POST", kind: "STORY", status: "PENDING_APPROVAL", expiresAt: inHours(24) });
    await openComposer(ctx);
    expect($("[data-testid=story-approval-hint]")?.textContent).toContain("professor aprovar");
    chooseFiles(fileInput(), [photo("a.png", "image/png")]);
    await until(() => !publish().disabled, "pronto para publicar");
    ctx.groups = [group(9, "Eu Mesmo", [item(902, { seen: true, status: "PENDING_APPROVAL" })], { isMine: true })];
    click(publish());
    await until(() => toastMock.success.mock.calls.length === 1, "aviso");
    expect(String(toastMock.success.mock.calls[0]?.[0])).toContain("Enviado para aprovação");
    await until(() => $("[data-testid=my-story-card]")?.getAttribute("data-state") === "pending", "estado pendente");
  });

  it("escolhe 'Minha turma' quando há turmas e manda classId", async () => {
    const ctx = setup([], { classes: [{ id: 7, name: "Adulto Noite", unit: { id: 5, name: "Matriz" } }] });
    await openComposer(ctx);
    const select = $("#story-visibility") as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(["GROUP", "UNIT:5", "CLASS:7"]);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "CLASS:7");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    chooseFiles(fileInput(), [photo("t.jpg")]);
    await until(() => !publish().disabled, "pronto");
    click(publish());
    await until(() => callsOf(ctx.state, "POST", /^\/feed\/stories$/).length === 1, "POST");
    expect(callsOf(ctx.state, "POST", /^\/feed\/stories$/)[0]!.body).toEqual({ mediaId: 501, visibility: "CLASS", classId: 7 });
  });

  it.each([
    [403, "POSTING_NOT_ALLOWED", "Você não tem permissão para publicar"],
    [403, "FEED_DISABLED", "feed deste grupo está desligado"],
    [429, "STORY_LIMIT", "limite de stories"],
    [400, "MEDIA_INVALID", "expirou"],
  ])("erro %i %s: mensagem amigável e o rascunho (legenda) é mantido", async (status, code, message) => {
    const ctx = setup([]);
    ctx.create = () => json(status, { message: "do servidor", code });
    await openComposer(ctx);
    chooseFiles(fileInput(), [photo("t.jpg")]);
    await until(() => !publish().disabled, "pronto");
    typeInto(caption(), "minha legenda");
    click(publish());
    await until(() => $("[data-testid=story-error]") !== null, "mensagem de erro");
    expect($("[data-testid=story-error]")?.textContent).toContain(message);
    expect(caption().value).toBe("minha legenda");
    expect($("[data-testid=story-composer]")).not.toBeNull();
    if (code === "MEDIA_INVALID") {
      expect($("[data-testid=story-photo-error]")?.textContent).toContain("expirou");
      expect(publish().disabled).toBe(true);
    }
    if (code === "POSTING_NOT_ALLOWED" || code === "FEED_DISABLED") {
      await until(() => callsOf(ctx.state, "GET", /^\/feed\/settings$/).length >= 2, "configuração recarregada");
    }
  });

  it("falha no upload: erro na miniatura e 'tentar de novo' reenvia", async () => {
    const ctx = setup([]);
    let uploads = 0;
    const base = ctx.state.respond;
    ctx.state.respond = (call) => {
      if (call.method === "POST" && call.path === "/feed/media") {
        uploads += 1;
        if (uploads === 1) return json(413, { message: "grande", code: "FILE_TOO_LARGE" });
      }
      return base?.(call);
    };
    await openComposer(ctx);
    chooseFiles(fileInput(), [photo("t.jpg")]);
    await until(() => $("[data-testid=story-photo-error]") !== null, "erro no upload");
    expect($("[data-testid=story-photo-error]")?.textContent).toContain("5 MB");
    expect(publish().disabled).toBe(true);
    click($("[aria-label='Tentar enviar a foto de novo']"));
    await until(() => $("[data-testid=story-preview]")?.getAttribute("data-status") === "done", "reenvio");
    expect(uploads).toBe(2);
  });

  it("remover a foto volta para Galeria/Câmera", async () => {
    await openComposer();
    chooseFiles(fileInput(), [photo("t.jpg")]);
    await until(() => $("[data-testid=story-preview]") !== null, "miniatura");
    click($("[data-testid=story-photo-remove]"));
    expect($("[data-testid=story-preview]")).toBeNull();
    expect($("[data-testid=story-pick-gallery]")).not.toBeNull();
  });

  it("o rascunho (foto e legenda) sobrevive a fechar e reabrir a folha, mas só em memória", async () => {
    await openComposer();
    typeInto(caption(), "rascunho secreto");
    chooseFiles(fileInput(), [photo("t.jpg")]);
    await until(() => !publish().disabled, "pronto");
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await until(() => $("[data-testid=story-composer]") === null, "fechou");
    click($("[data-testid=my-story-card] button"));
    await until(() => caption() !== null, "reabriu");
    expect(caption().value).toBe("rascunho secreto");
    expect($("[data-testid=story-preview]")).not.toBeNull();
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain("rascunho secreto");
  });
});
