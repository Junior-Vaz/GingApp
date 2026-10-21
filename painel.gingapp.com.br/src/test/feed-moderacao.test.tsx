import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { FeedModeracaoPage } from "@/modules/feed";
import { addBlockedWords } from "@/modules/feed/blocked-words";
import { mediaSrc } from "@/modules/feed/api";
import { routeTree } from "@/routeTree.gen";
import { clearSession, loginAs } from "./login-as";
import { REAL_QUEUE_COMMENT } from "./real-contract";

vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

type Kind = "PENDING" | "REPORTED" | "HIDDEN";
type Item = Record<string, unknown> & { post: Record<string, unknown> };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const AUTHOR = { userId: 5, name: "Maria Souza", nickname: "Mari", photo: null, roleLabel: "Aluna" };

function media(id: number) {
  return {
    id,
    url: `/api/feed/media/${String(id)}?e=1893456000&s=big${String(id)}`,
    thumbUrl: `/api/feed/media/${String(id)}?e=1893456000&s=th${String(id)}`,
    width: 1600,
    height: 1200,
  };
}

function post(id: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    type: "POST",
    author: AUTHOR,
    body: `Texto da publicação ${String(id)}`,
    media: [],
    visibility: "GROUP",
    unitId: null,
    classId: null,
    pinned: false,
    status: "PENDING_APPROVAL",
    createdAt: "2026-10-20T15:30:00.000Z",
    edited: false,
    commentsCount: 0,
    canModerate: true,
    ...over,
  };
}

const pending = (id: number, over: Record<string, unknown> = {}): Item => ({
  post: post(id, over),
  reports: [],
  reportsCount: 0,
});
const reported = (id: number, over: Record<string, unknown> = {}, reports?: unknown[]): Item => ({
  post: post(id, { status: "PUBLISHED", ...over }),
  reports: reports ?? [
    { reason: "OFENSIVO", note: "Palavrão no texto", createdAt: "2026-10-20T16:00:00.000Z" },
    { reason: "SPAM", note: null, createdAt: "2026-10-20T16:05:00.000Z" },
    { reason: "OFENSIVO", note: null, createdAt: "2026-10-20T16:10:00.000Z" },
  ],
  reportsCount: reports ? reports.length : 3,
});
const hidden = (id: number, over: Record<string, unknown> = {}): Item => ({
  post: post(id, { status: "HIDDEN", ...over }),
  reports: [],
  reportsCount: 0,
});

let calls: Call[];
let queues: Record<Kind, Item[]>;
let pageSize: number;
let settings: Record<string, unknown>;
let overrides: Record<string, () => Response | Promise<Response>>;

function installFetch() {
  calls = [];
  const handler = (input: string, init?: RequestInit): Response | Promise<Response> => {
    const [path = "", search = ""] = input.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    const query = new URLSearchParams(search);
    calls.push({ method, path, query, body });
    const override = overrides[`${method} ${path}`];
    if (override) return override();

    if (method === "GET" && path === "/feed/moderation/queue") {
      const kind = (query.get("kind") ?? "PENDING") as Kind;
      const limit = Number(query.get("limit") ?? pageSize);
      const offset = Number(query.get("cursor") ?? 0);
      const items = queues[kind].slice(offset, offset + Math.min(limit, pageSize));
      const next = offset + items.length;
      return json(200, { items, nextCursor: next < queues[kind].length ? String(next) : null });
    }
    if (method === "GET" && path === "/feed/settings/admin") return json(200, settings);
    if (method === "PUT" && path === "/feed/settings") {
      settings = { ...settings, ...(body as object) };
      return json(200, settings);
    }

    const act = /^\/feed\/posts\/(\d+)\/(approve|hide|restore|pin|unpin)$/.exec(path);
    if (method === "POST" && act) {
      const id = Number(act[1]);
      const status: Record<string, string> = { approve: "PUBLISHED", hide: "HIDDEN", restore: "PUBLISHED" };
      for (const kind of Object.keys(queues) as Kind[]) {
        queues[kind] = queues[kind].flatMap((item) => {
          if (Number(item.post["id"]) !== id) return [item];
          const action = act[2]!;
          if (action === "pin" || action === "unpin")
            return [{ ...item, post: { ...item.post, pinned: action === "pin" } }];
          if (kind === "REPORTED") return [{ ...item, post: { ...item.post, status: status[action] } }];
          return [];
        });
      }
      // Formato REAL: approve/hide/restore/pin/unpin => 200 com o FeedPost (não 201).
      return json(200, post(id, { status: status[act[2]!] ?? "PUBLISHED" }));
    }
    if (method === "DELETE" && /^\/feed\/posts\/\d+$/.test(path)) {
      const id = Number(path.split("/")[3]);
      for (const kind of Object.keys(queues) as Kind[])
        queues[kind] = queues[kind].filter((item) => Number(item.post["id"]) !== id);
      return new Response(null, { status: 204 });
    }
    if (method === "DELETE" && /^\/feed\/comments\/\d+$/.test(path)) {
      const id = Number(path.split("/")[3]);
      queues.REPORTED = queues.REPORTED.filter((item) => (item["comment"] as { id?: number } | undefined)?.id !== id);
      return new Response(null, { status: 204 });
    }
    const resolve = /^\/feed\/moderation\/reports\/(\d+)\/resolve$/.exec(path);
    if (method === "POST" && resolve) {
      const id = Number(resolve[1]);
      const commentId = (body as { commentId?: number } | undefined)?.commentId;
      // Extensão real: com `commentId` o resolve decide só as denúncias DESSE comentário.
      queues.REPORTED = queues.REPORTED.filter((item) =>
        commentId !== undefined ? (item["comment"] as { id?: number } | undefined)?.id !== commentId : Number(item.post["id"]) !== id,
      );
      return json(200, { ok: true });
    }
    return json(404, { message: "Rota não mockada." });
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => Promise.resolve(handler(input, init))),
  );
}

const sent = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);
const queueCalls = (kind: Kind) =>
  sent("GET", "/feed/moderation/queue").filter((c) => c.query.get("kind") === kind);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FeedModeracaoPage />
    </QueryClientProvider>,
  );
}

function openTab(name: string) {
  const tab = screen.getByRole("tab", { name: new RegExp(name) });
  fireEvent.mouseDown(tab, { button: 0 });
  return tab;
}

const cardOf = async (text: string) => {
  const element = await screen.findByText(text);
  return within(element.closest("[data-testid='queue-item']") as HTMLElement);
};

beforeEach(() => {
  loginAs("MESTRE");
  queues = { PENDING: [pending(1), pending(2)], REPORTED: [], HIDDEN: [] };
  pageSize = 15;
  settings = {
    enabled: true,
    postingMode: "MODERATED",
    canPost: true,
    allowComments: true,
    requiresApproval: false,
    blockedWords: ["palavrao"],
  };
  overrides = {};
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("fila de moderação: abas", () => {
  it("abre em Pendentes, pede kind=PENDING com limite e mostra autor, papel, texto, visibilidade, situação e data", async () => {
    renderPage();
    const card = await cardOf("Texto da publicação 1");
    expect(queueCalls("PENDING")[0]!.query.get("limit")).toBe("15");
    expect(queueCalls("PENDING")[0]!.query.has("cursor")).toBe(false);
    expect(card.getByText("Maria Souza")).toBeInTheDocument();
    expect(card.getByText("(Mari)")).toBeInTheDocument();
    expect(card.getByText(/Aluna/)).toBeInTheDocument();
    expect(card.getByText("Aguardando aprovação")).toBeInTheDocument();
    expect(card.getByText("Todo o grupo")).toBeInTheDocument();
    expect(card.getByText(/20\/10\/2026/)).toBeInTheDocument();
    expect(screen.getAllByTestId("queue-item")).toHaveLength(2);
    // Não inventa o selo "Menor": o FeedPost do contrato não traz a idade do autor.
    expect(screen.queryByText("Menor")).toBeNull();
  });

  it("Denunciados pede kind=REPORTED e mostra contagem, motivos agrupados e observações", async () => {
    queues.REPORTED = [reported(10)];
    renderPage();
    await screen.findByText("Texto da publicação 1");
    openTab("Denunciados");
    const card = await cardOf("Texto da publicação 10");
    expect(queueCalls("REPORTED")).toHaveLength(1);
    expect(card.getByText("3 denúncias")).toBeInTheDocument();
    expect(card.getByText("Ofensivo · 2")).toBeInTheDocument();
    expect(card.getByText("Spam")).toBeInTheDocument();
    expect(card.getByText(/Palavrão no texto/)).toBeInTheDocument();
    expect(card.getByText("Publicado")).toBeInTheDocument();
  });

  it("Ocultos pede kind=HIDDEN", async () => {
    queues.HIDDEN = [hidden(20, { visibility: "UNIT", unitId: 3 })];
    renderPage();
    await screen.findByText("Texto da publicação 1");
    openTab("Ocultos");
    const card = await cardOf("Texto da publicação 20");
    expect(queueCalls("HIDDEN")).toHaveLength(1);
    expect(card.getByText("Oculto")).toBeInTheDocument();
    expect(card.getByText("Uma unidade")).toBeInTheDocument();
  });

  it("selo da aba Pendentes mostra quantos foram carregados e '+' quando há mais páginas", async () => {
    pageSize = 1;
    renderPage();
    await screen.findByText("Texto da publicação 1");
    expect(await screen.findByLabelText("1+ pendentes")).toBeInTheDocument();
  });

  it("autor anonimizado aparece como 'Autor removido'", async () => {
    queues.PENDING = [pending(1, { author: null })];
    renderPage();
    const card = await cardOf("Texto da publicação 1");
    expect(card.getByText("Autor removido")).toBeInTheDocument();
  });

  it("publicação só com fotos (sem texto) mostra a galeria e não o aviso de 'sem texto'", async () => {
    queues.PENDING = [pending(1, { body: null, media: [media(7)] })];
    renderPage();
    expect(await screen.findByTestId("post-gallery")).toBeInTheDocument();
    expect(screen.queryByText("Publicação sem texto.")).toBeNull();
  });
});

describe("estados: carregando, vazio, erro e paginação", () => {
  it("mostra 'carregando' enquanto a fila não responde", async () => {
    let release!: (r: Response) => void;
    overrides["GET /feed/moderation/queue"] = () => new Promise<Response>((resolve) => (release = resolve));
    renderPage();
    expect(await screen.findByRole("status", { name: "Carregando publicações" })).toBeInTheDocument();
    release(json(200, { items: [], nextCursor: null }));
    expect(await screen.findByText("Nenhuma publicação aguardando aprovação.")).toBeInTheDocument();
  });

  it("vazio por aba", async () => {
    queues.PENDING = [];
    renderPage();
    expect(await screen.findByText("Nenhuma publicação aguardando aprovação.")).toBeInTheDocument();
    openTab("Denunciados");
    expect(await screen.findByText("Nenhuma publicação denunciada.")).toBeInTheDocument();
    openTab("Ocultos");
    expect(await screen.findByText("Nenhuma publicação oculta.")).toBeInTheDocument();
  });

  it("erro 403 mostra mensagem amigável e 'Tentar de novo' refaz a chamada", async () => {
    overrides["GET /feed/moderation/queue"] = () => json(403, { message: "Forbidden" });
    renderPage();
    expect(
      await screen.findByText("Você não tem permissão para fazer isso no feed deste grupo."),
    ).toBeInTheDocument();
    delete overrides["GET /feed/moderation/queue"];
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Texto da publicação 1")).toBeInTheDocument();
  });

  it("'Carregar mais' pede a próxima página com o cursor e acrescenta os itens; some no fim", async () => {
    pageSize = 2;
    queues.PENDING = [pending(1), pending(2), pending(3)];
    renderPage();
    await screen.findByText("Texto da publicação 2");
    expect(screen.queryByText("Texto da publicação 3")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("Texto da publicação 3")).toBeInTheDocument();
    expect(queueCalls("PENDING").map((c) => c.query.get("cursor"))).toEqual([null, "2"]);
    expect(screen.getAllByTestId("queue-item")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });
});

describe("falha ao carregar mais", () => {
  it("erro em 'Carregar mais' mantém os itens na tela e mostra o aviso", async () => {
    pageSize = 1;
    queues.PENDING = [pending(1), pending(2)];
    renderPage();
    await screen.findByText("Texto da publicação 1");
    overrides["GET /feed/moderation/queue"] = () => json(500, { message: "Falhou ao paginar" });
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falhou ao paginar");
    expect(screen.getByText("Texto da publicação 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Carregar mais" })).toBeEnabled();
  });
});

describe("galeria", () => {
  beforeEach(() => {
    queues.PENDING = [pending(1, { media: [media(10), media(11)] })];
  });

  it("miniaturas usam o caminho assinado /api/feed/media e ampliar abre o visualizador com a foto grande", async () => {
    renderPage();
    const gallery = await screen.findByTestId("post-gallery");
    const thumbs = within(gallery).getAllByRole("img");
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0]!.getAttribute("src")).toContain("/api/feed/media/10?e=1893456000&s=th10");

    fireEvent.click(screen.getByRole("button", { name: "Ampliar foto 2 de 2" }));
    const viewer = await screen.findByTestId("photo-viewer");
    expect(within(viewer).getByText("Foto 2 de 2")).toBeInTheDocument();
    expect(within(viewer).getByRole("img").getAttribute("src")).toContain("s=big11");
    expect(within(viewer).getByRole("button", { name: /Próxima/ })).toBeDisabled();

    fireEvent.click(within(viewer).getByRole("button", { name: /Anterior/ }));
    expect(within(viewer).getByText("Foto 1 de 2")).toBeInTheDocument();
    expect(within(viewer).getByRole("img").getAttribute("src")).toContain("s=big10");
    expect(within(viewer).getByRole("button", { name: /Anterior/ })).toBeDisabled();
  });

  it("foto que não carrega vira aviso 'Foto indisponível'", async () => {
    renderPage();
    const gallery = await screen.findByTestId("post-gallery");
    fireEvent.error(within(gallery).getAllByRole("img")[0]!);
    expect(await within(gallery).findByText("Foto indisponível")).toBeInTheDocument();
  });

  it("mediaSrc só aceita caminho do feed ou http(s); o resto vira vazio", () => {
    expect(mediaSrc("/api/feed/media/1?e=2&s=3")).toMatch(/\/api\/feed\/media\/1\?e=2&s=3$/);
    expect(mediaSrc("https://cdn.x.com/a.jpg")).toBe("https://cdn.x.com/a.jpg");
    expect(mediaSrc("javascript:alert(1)")).toBe("");
    expect(mediaSrc("/api/uploads/x.png")).toBe("");
    expect(mediaSrc(null)).toBe("");
  });
});

describe("ações de moderação", () => {
  it("Pendentes oferece Aprovar, Ocultar e Remover (e não Fixar)", async () => {
    renderPage();
    const card = await cardOf("Texto da publicação 1");
    expect(card.getByRole("button", { name: /^Aprovar/ })).toBeInTheDocument();
    expect(card.getByRole("button", { name: /^Ocultar/ })).toBeInTheDocument();
    expect(card.getByRole("button", { name: /^Remover/ })).toBeInTheDocument();
    expect(card.queryByRole("button", { name: /Fixar/ })).toBeNull();
  });

  it("Aprovar chama POST /feed/posts/:id/approve, tira o item da lista e avisa", async () => {
    renderPage();
    const card = await cardOf("Texto da publicação 1");
    fireEvent.click(card.getByRole("button", { name: /^Aprovar/ }));
    await waitFor(() => expect(screen.queryByText("Texto da publicação 1")).toBeNull());
    await waitFor(() => expect(sent("POST", "/feed/posts/1/approve")).toHaveLength(1));
    expect(toast.success).toHaveBeenCalledWith("Publicação aprovada.");
    expect(screen.getByText("Texto da publicação 2")).toBeInTheDocument();
    // Depois da ação a fila é refeita (o post pode ter ido para outra aba).
    await waitFor(() => expect(queueCalls("PENDING").length).toBeGreaterThanOrEqual(2));
  });

  it("Ocultar (pendente) chama POST /feed/posts/:id/hide", async () => {
    renderPage();
    const card = await cardOf("Texto da publicação 2");
    fireEvent.click(card.getByRole("button", { name: /^Ocultar/ }));
    await waitFor(() => expect(sent("POST", "/feed/posts/2/hide")).toHaveLength(1));
    expect(toast.success).toHaveBeenCalledWith("Publicação ocultada.");
  });

  it("Restaurar (aba Ocultos) chama POST /feed/posts/:id/restore", async () => {
    queues.HIDDEN = [hidden(20)];
    renderPage();
    await screen.findByText("Texto da publicação 1");
    openTab("Ocultos");
    const card = await cardOf("Texto da publicação 20");
    expect(card.queryByRole("button", { name: /Fixar/ })).toBeNull();
    fireEvent.click(card.getByRole("button", { name: /^Restaurar/ }));
    await waitFor(() => expect(sent("POST", "/feed/posts/20/restore")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("Texto da publicação 20")).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("Publicação restaurada.");
  });

  it("Fixar e Desafixar (post publicado na fila de denúncias) chamam pin/unpin e trocam o selo na hora", async () => {
    queues.REPORTED = [reported(10)];
    renderPage();
    await screen.findByText("Texto da publicação 1");
    openTab("Denunciados");
    let card = await cardOf("Texto da publicação 10");
    expect(card.queryByText("Fixado")).toBeNull();
    fireEvent.click(card.getByRole("button", { name: /^Fixar/ }));
    await waitFor(() => expect(sent("POST", "/feed/posts/10/pin")).toHaveLength(1));
    card = await cardOf("Texto da publicação 10");
    expect(await card.findByText("Fixado")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Publicação fixada no topo.");

    fireEvent.click(await card.findByRole("button", { name: /^Desafixar/ }));
    await waitFor(() => expect(sent("POST", "/feed/posts/10/unpin")).toHaveLength(1));
    await waitFor(() => expect(card.queryByText("Fixado")).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("Publicação desafixada.");
  });

  it("Remover pede confirmação: cancelar não chama nada; confirmar chama DELETE /feed/posts/:id", async () => {
    renderPage();
    const card = await cardOf("Texto da publicação 1");
    fireEvent.click(card.getByRole("button", { name: /^Remover/ }));
    let dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Remover a publicação?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(sent("DELETE", "/feed/posts/1")).toHaveLength(0);

    fireEvent.click(card.getByRole("button", { name: /^Remover/ }));
    dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(sent("DELETE", "/feed/posts/1")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("Texto da publicação 1")).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("Publicação removida.");
  });
});

describe("denúncias: resolver", () => {
  beforeEach(() => {
    queues.REPORTED = [reported(10), reported(11), reported(12)];
  });

  async function openReported() {
    renderPage();
    await screen.findByText("Texto da publicação 1");
    openTab("Denunciados");
  }

  it("a aba oferece Manter (ignorar denúncias), Ocultar e Remover", async () => {
    await openReported();
    const card = await cardOf("Texto da publicação 10");
    expect(card.getByRole("button", { name: /Manter a publicação de Maria Souza e ignorar as denúncias/ })).toBeInTheDocument();
    expect(card.getByText("Manter (ignorar denúncias)")).toBeInTheDocument();
    expect(card.getByRole("button", { name: /^Ocultar/ })).toBeInTheDocument();
    expect(card.getByRole("button", { name: /^Remover/ })).toBeInTheDocument();
  });

  it("Manter envia resolve { action: 'DISMISS' }", async () => {
    await openReported();
    const card = await cardOf("Texto da publicação 10");
    fireEvent.click(card.getByRole("button", { name: /ignorar as denúncias/ }));
    await waitFor(() => expect(sent("POST", "/feed/moderation/reports/10/resolve")).toHaveLength(1));
    expect(sent("POST", "/feed/moderation/reports/10/resolve")[0]!.body).toEqual({ action: "DISMISS" });
    await waitFor(() => expect(screen.queryByText("Texto da publicação 10")).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("Denúncias ignoradas. A publicação foi mantida.");
  });

  it("Ocultar envia resolve { action: 'HIDE' }", async () => {
    await openReported();
    const card = await cardOf("Texto da publicação 11");
    fireEvent.click(card.getByRole("button", { name: /^Ocultar/ }));
    await waitFor(() => expect(sent("POST", "/feed/moderation/reports/11/resolve")).toHaveLength(1));
    expect(sent("POST", "/feed/moderation/reports/11/resolve")[0]!.body).toEqual({ action: "HIDE" });
  });

  it("Remover (com confirmação) envia resolve { action: 'REMOVE' }", async () => {
    await openReported();
    const card = await cardOf("Texto da publicação 12");
    fireEvent.click(card.getByRole("button", { name: /^Remover/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(sent("POST", "/feed/moderation/reports/12/resolve")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(sent("POST", "/feed/moderation/reports/12/resolve")).toHaveLength(1));
    expect(sent("POST", "/feed/moderation/reports/12/resolve")[0]!.body).toEqual({ action: "REMOVE" });
    expect(sent("DELETE", "/feed/posts/12")).toHaveLength(0);
  });

  it("post já oculto automaticamente não oferece Ocultar nem Fixar", async () => {
    queues.REPORTED = [reported(13, { status: "HIDDEN" })];
    await openReported();
    const card = await cardOf("Texto da publicação 13");
    expect(card.getByText("Oculto")).toBeInTheDocument();
    expect(card.queryByRole("button", { name: /^Ocultar/ })).toBeNull();
    expect(card.queryByRole("button", { name: /Fixar/ })).toBeNull();
    expect(card.getByRole("button", { name: /ignorar as denúncias/ })).toBeInTheDocument();
  });

  it("comentário denunciado (formato real: `comment` ao lado de `post`) oferece manter ou remover só o comentário", async () => {
    queues.REPORTED = [
      {
        ...reported(14),
        comment: { ...REAL_QUEUE_COMMENT.comment, id: 77, body: "Comentário ofensivo aqui", author: { ...AUTHOR, name: "João Lima", nickname: null } },
      },
    ];
    await openReported();
    const card = await cardOf("Comentário ofensivo aqui");
    expect(card.getByText("Comentário denunciado")).toBeInTheDocument();
    expect(card.getByText("João Lima")).toBeInTheDocument();
    // Nada das ações do POST (aprovar/ocultar/remover publicação): só as do comentário.
    expect(card.queryByRole("button", { name: /^Aprovar|^Ocultar|^Remover publicação/ })).toBeNull();
    expect(card.getByRole("button", { name: /^Manter o comentário/ })).toBeInTheDocument();
    fireEvent.click(card.getByRole("button", { name: /^Remover comentário/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Remover o comentário?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(sent("DELETE", "/feed/comments/77")).toHaveLength(1));
    expect(toast.success).toHaveBeenCalledWith("Comentário removido.");
  });

  it("comentário denunciado: 'Manter comentário' chama resolve DISMISS com commentId (devolve ao feed o que 3 denúncias ocultaram)", async () => {
    queues.REPORTED = [
      { ...reported(14), comment: { ...REAL_QUEUE_COMMENT.comment, id: 77, body: "Comentário oculto pelo limite", status: "HIDDEN" } },
      { ...reported(14), comment: { ...REAL_QUEUE_COMMENT.comment, id: 78, body: "Outro comentário do mesmo post" } },
    ];
    await openReported();
    const card = await cardOf("Comentário oculto pelo limite");
    expect(card.getByText("Comentário oculto")).toBeInTheDocument();
    fireEvent.click(card.getByRole("button", { name: /^Manter o comentário/ }));
    await waitFor(() => expect(sent("POST", "/feed/moderation/reports/14/resolve")).toHaveLength(1));
    expect(sent("POST", "/feed/moderation/reports/14/resolve")[0]?.body).toEqual({ action: "DISMISS", commentId: 77 });
    expect(toast.success).toHaveBeenCalledWith("Denúncias ignoradas. O comentário foi mantido.");
    // O outro comentário do MESMO post continua na fila.
    await waitFor(() => expect(screen.queryByText("Comentário oculto pelo limite")).toBeNull());
    expect(screen.getByText("Outro comentário do mesmo post")).toBeInTheDocument();
  });

  it("sem permissão para moderar o post (canModerate: false) mostra o post sem botões de ação", async () => {
    queues.REPORTED = [reported(15, { canModerate: false })];
    await openReported();
    const card = await cardOf("Texto da publicação 15");
    expect(card.queryByRole("button", { name: /^Ocultar|^Remover|Manter/ })).toBeNull();
    expect(card.getByText(/só o Mestre decide/)).toBeInTheDocument();
  });
});

describe("erros e rollback", () => {
  it("item some na hora (otimista) e VOLTA se o servidor recusar, com a mensagem de 403 e sem refazer a fila no meio", async () => {
    let fail!: (r: Response) => void;
    overrides["POST /feed/posts/1/approve"] = () => new Promise<Response>((resolve) => (fail = resolve));
    renderPage();
    const card = await cardOf("Texto da publicação 1");
    fireEvent.click(card.getByRole("button", { name: /^Aprovar/ }));
    await waitFor(() => expect(screen.queryByText("Texto da publicação 1")).toBeNull());
    expect(screen.getByText("Texto da publicação 2")).toBeInTheDocument();
    fail(json(403, { message: "Forbidden" }));
    expect(await screen.findByText("Texto da publicação 1")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("Você não tem permissão para fazer isso no feed deste grupo.");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("404 (outro moderador já decidiu) mostra aviso amigável e a lista é refeita", async () => {
    overrides["POST /feed/posts/1/approve"] = () => json(404, { message: "Not found" });
    renderPage();
    const card = await cardOf("Texto da publicação 1");
    fireEvent.click(card.getByRole("button", { name: /^Aprovar/ }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Esta publicação não existe mais (talvez outro moderador já tenha decidido). A lista foi atualizada.",
      ),
    );
    await waitFor(() => expect(queueCalls("PENDING").length).toBeGreaterThanOrEqual(2));
  });

  it("erro ao remover: o diálogo continua aberto, o post volta e o toast avisa", async () => {
    overrides["DELETE /feed/posts/1"] = () => json(500, { message: "Falha no servidor" });
    renderPage();
    const card = await cardOf("Texto da publicação 1");
    fireEvent.click(card.getByRole("button", { name: /^Remover/ }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Falha no servidor"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(await screen.findByText("Texto da publicação 1")).toBeInTheDocument();
  });
});

describe("configurações do feed", () => {
  it("só o Mestre vê o cartão; ele carrega GET /feed/settings/admin e mostra o estado salvo", async () => {
    renderPage();
    const section = await screen.findByRole("region", { name: "Configurações do feed" });
    expect(await within(section).findByRole("switch", { name: "Feed ativo" })).toBeChecked();
    expect(within(section).getByRole("switch", { name: "Permitir comentários" })).toBeChecked();
    expect(within(section).getByRole("radio", { name: /Alunos com aprovação/ })).toBeChecked();
    expect(within(section).getByText("palavrao")).toBeInTheDocument();
    expect(within(section).getByText(/Menores de 18 anos sempre passam por aprovação/)).toBeInTheDocument();
    expect(within(section).queryByTestId("feed-disabled-notice")).toBeNull(); // ligado: sem o aviso de "desligado"
    expect(within(section).getByText(/Todos podem postar/)).toBeInTheDocument();
    expect(within(section).getByText(/Só equipe/)).toBeInTheDocument();
    expect(within(section).getByText(/ficam aguardando aprovação/)).toBeInTheDocument();
    expect(sent("GET", "/feed/settings/admin")).toHaveLength(1);
    expect(within(section).getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(within(section).queryByText("Alterações não salvas")).toBeNull();
  });

  it.each(["PROFESSOR", "INSTRUTOR"] as const)("%s não vê as configurações nem chama a rota admin, mas modera a fila", async (role) => {
    loginAs(role);
    renderPage();
    expect(await screen.findByText("Texto da publicação 1")).toBeInTheDocument();
    expect(screen.queryByText("Configurações do feed")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(sent("GET", "/feed/settings/admin")).toHaveLength(0);
    expect(sent("PUT", "/feed/settings")).toHaveLength(0);
  });

  it("alterar mostra 'Alterações não salvas'; Salvar envia o PUT /feed/settings completo e volta ao estado limpo", async () => {
    renderPage();
    const section = await screen.findByRole("region", { name: "Configurações do feed" });
    fireEvent.click(await within(section).findByRole("switch", { name: "Feed ativo" }));
    fireEvent.click(within(section).getByRole("switch", { name: "Permitir comentários" }));
    fireEvent.click(within(section).getByRole("radio", { name: /Só equipe/ }));
    expect(within(section).getByText("Alterações não salvas")).toBeInTheDocument();
    expect(within(section).getByText(/Desligado: ninguém vê nem publica/)).toBeInTheDocument();
    // Desligado: aviso para o Mestre conferir o modo e avisar os responsáveis antes de ligar.
    const notice = within(section).getByTestId("feed-disabled-notice");
    expect(notice).toHaveTextContent("O feed está desligado neste grupo. Ligue para os membros poderem postar.");
    expect(notice).toHaveTextContent("Antes de ligar, confira o modo de postagem (padrão: alunos com aprovação) e avise os responsáveis sobre fotos de menores.");

    fireEvent.click(within(section).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(sent("PUT", "/feed/settings")).toHaveLength(1));
    expect(sent("PUT", "/feed/settings")[0]!.body).toEqual({
      enabled: false,
      postingMode: "STAFF_ONLY",
      allowComments: false,
      blockedWords: ["palavrao"],
    });
    expect(toast.success).toHaveBeenCalledWith("Configurações do feed salvas.");
    await waitFor(() => expect(within(section).queryByText("Alterações não salvas")).toBeNull());
    expect(within(section).getByRole("switch", { name: "Feed ativo" })).not.toBeChecked();
    expect(within(section).getByRole("radio", { name: /Só equipe/ })).toBeChecked();
    expect(within(section).getByRole("button", { name: "Salvar" })).toBeDisabled();
  });

  it("Descartar desfaz as alterações; voltar ao valor salvo também limpa o aviso", async () => {
    renderPage();
    const section = await screen.findByRole("region", { name: "Configurações do feed" });
    const comments = await within(section).findByRole("switch", { name: "Permitir comentários" });
    fireEvent.click(comments);
    expect(within(section).getByText("Alterações não salvas")).toBeInTheDocument();
    fireEvent.click(comments);
    expect(within(section).queryByText("Alterações não salvas")).toBeNull();

    fireEvent.click(within(section).getByRole("radio", { name: /Todos podem postar/ }));
    fireEvent.click(within(section).getByRole("button", { name: "Descartar" }));
    expect(within(section).getByRole("radio", { name: /Alunos com aprovação/ })).toBeChecked();
    expect(within(section).queryByText("Alterações não salvas")).toBeNull();
    expect(sent("PUT", "/feed/settings")).toHaveLength(0);
  });

  it("palavras bloqueadas: adiciona (botão e Enter), remove pelo chip, ignora repetida e salva a lista", async () => {
    renderPage();
    const section = await screen.findByRole("region", { name: "Configurações do feed" });
    const input = await within(section).findByLabelText("Palavras bloqueadas");
    expect(within(section).getByText("1 de 50 palavras")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "  golpe  " } });
    fireEvent.click(within(section).getByRole("button", { name: /Adicionar/ }));
    fireEvent.change(input, { target: { value: "Palavrao" } }); // repetida (ignora maiúsculas)
    fireEvent.submit(input.closest("form")!);
    fireEvent.change(input, { target: { value: "spam, venda" } }); // várias de uma vez
    fireEvent.submit(input.closest("form")!);
    expect(within(section).getByText("4 de 50 palavras")).toBeInTheDocument();
    expect(input).toHaveValue("");

    fireEvent.click(within(section).getByRole("button", { name: "Remover a palavra palavrao" }));
    expect(within(section).getByText("3 de 50 palavras")).toBeInTheDocument();
    expect(within(section).getByText("Alterações não salvas")).toBeInTheDocument();

    fireEvent.click(within(section).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(sent("PUT", "/feed/settings")).toHaveLength(1));
    expect((sent("PUT", "/feed/settings")[0]!.body as { blockedWords: string[] }).blockedWords).toEqual([
      "golpe",
      "spam",
      "venda",
    ]);
  });

  it("palavra com mais de 40 caracteres é recusada com aviso e não entra na lista", async () => {
    renderPage();
    const section = await screen.findByRole("region", { name: "Configurações do feed" });
    const input = await within(section).findByLabelText("Palavras bloqueadas");
    fireEvent.change(input, { target: { value: "a".repeat(41) } });
    fireEvent.submit(input.closest("form")!);
    expect(await within(section).findByRole("alert")).toHaveTextContent("até 40 caracteres");
    expect(within(section).getByText("1 de 50 palavras")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "a".repeat(40) } });
    fireEvent.submit(input.closest("form")!);
    expect(within(section).getByText("2 de 50 palavras")).toBeInTheDocument();
    expect(within(section).queryByRole("alert")).toBeNull();
  });

  it("addBlockedWords: limite de 50 palavras, vazio e repetidas", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => `w${String(i)}`);
    expect(addBlockedWords(fifty, "nova").error).toMatch(/Limite de 50/);
    expect(addBlockedWords(fifty, "nova").words).toBe(fifty);
    expect(addBlockedWords(fifty, "W1").error).toBeNull(); // repetida: nada a acrescentar, sem erro
    expect(addBlockedWords([], "   ").error).toMatch(/Digite uma palavra/);
    expect(addBlockedWords(["a"], "b,c\nd").words).toEqual(["a", "b", "c", "d"]);
    expect(addBlockedWords(fifty.slice(0, 49), "x, y").error).toMatch(/Limite de 50/);
  });

  it("403 ao salvar avisa que só o Mestre altera e mantém as alterações na tela", async () => {
    overrides["PUT /feed/settings"] = () => json(403, { message: "Forbidden" });
    renderPage();
    const section = await screen.findByRole("region", { name: "Configurações do feed" });
    fireEvent.click(await within(section).findByRole("switch", { name: "Permitir comentários" }));
    fireEvent.click(within(section).getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Somente o Mestre pode alterar as configurações do feed."),
    );
    expect(within(section).getByText("Alterações não salvas")).toBeInTheDocument();
    expect(within(section).getByRole("switch", { name: "Permitir comentários" })).not.toBeChecked();
    expect(within(section).getByRole("button", { name: "Salvar" })).toBeEnabled();
  });

  it("erro ao carregar as configurações mostra mensagem e permite tentar de novo", async () => {
    overrides["GET /feed/settings/admin"] = () => json(500, { message: "Falhou" });
    renderPage();
    const section = await screen.findByRole("region", { name: "Configurações do feed" });
    expect(await within(section).findByRole("alert")).toHaveTextContent("Falhou");
    delete overrides["GET /feed/settings/admin"];
    fireEvent.click(within(section).getByRole("button", { name: "Tentar de novo" }));
    expect(await within(section).findByRole("switch", { name: "Feed ativo" })).toBeInTheDocument();
  });
});

describe("rota /feed-moderacao", () => {
  function makeRouter(path: string) {
    return createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: [path] }),
      context: { queryClient: new QueryClient() },
    });
  }

  it.each(["MESTRE", "PROFESSOR", "INSTRUTOR"] as const)("%s entra em /feed-moderacao", async (role) => {
    loginAs(role);
    const router = makeRouter("/feed-moderacao");
    await router.load();
    expect(router.state.location.pathname).toBe("/feed-moderacao");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("MONITOR é mandado para /alunos com aviso", async () => {
    loginAs("MONITOR");
    const router = makeRouter("/feed-moderacao");
    await router.load();
    expect(router.state.location.pathname).toBe("/alunos");
    expect(toast.error).toHaveBeenCalledWith(ROUTE_FORBIDDEN_MESSAGE);
  });
});
