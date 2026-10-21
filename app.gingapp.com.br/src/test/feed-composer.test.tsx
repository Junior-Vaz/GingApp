import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { FeedPage } from "@/components/gingapp/feed/feed-page";
import { validateFeedPhoto } from "@/lib/feed";
import {
  $,
  $$,
  callsOf,
  cleanup,
  chooseFiles,
  click,
  json,
  makePost,
  makeSettings,
  mockFeedApi,
  mount,
  photo,
  settle,
  typeInto,
  until,
} from "./feed-fixtures";

/** Compositor do feed (app): limites, upload de fotos, tipos inválidos, publicar, 403/429/rede e aprovação. */

afterEach(() => {
  cleanup();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.info.mockClear();
  localStorage.clear();
});

const cards = () => $$("[data-testid=post-card]");
const publishButton = () => $("[data-testid=composer-publish]") as HTMLButtonElement;
const bodyField = () => $("#composer-body") as HTMLTextAreaElement;
const fileInput = () => $("[data-testid=composer-file-input]") as HTMLInputElement;

async function openComposer(options: Parameters<typeof mockFeedApi>[0] = {}) {
  const state = mockFeedApi({ pages: { "": { items: [makePost({ id: 1, body: "post existente" })], nextCursor: null } }, ...options });
  await mount(<FeedPage />);
  await until(() => $("[data-testid=composer-open]") !== null, "composer");
  click($("[data-testid=composer-open]"));
  await until(() => bodyField() !== null, "folha do composer");
  return state;
}

describe("validateFeedPhoto", () => {
  it("aceita JPEG/PNG/WebP até 5 MB; recusa o resto com mensagem amigável (HEIC incluso)", () => {
    expect(validateFeedPhoto(photo("a.jpg", "image/jpeg"))).toBeNull();
    expect(validateFeedPhoto(photo("a.png", "image/png"))).toBeNull();
    expect(validateFeedPhoto(photo("a.webp", "image/webp"))).toBeNull();
    expect(validateFeedPhoto(photo("a.heic", "image/heic"))).toContain("HEIC");
    expect(validateFeedPhoto(photo("a.HEIF", ""))).toContain("HEIC");
    expect(validateFeedPhoto(photo("a.gif", "image/gif"))).toContain("JPEG, PNG ou WebP");
    expect(validateFeedPhoto(photo("a.pdf", "application/pdf"))).toContain("JPEG, PNG ou WebP");
    expect(validateFeedPhoto(photo("grande.jpg", "image/jpeg", 5 * 1024 * 1024 + 1))).toContain("5 MB");
    expect(validateFeedPhoto(photo("vazia.jpg", "image/jpeg", 0))).toContain("vazio");
  });
});

describe("quem pode postar", () => {
  it("canPost=false esconde o compositor e mostra explicação discreta", async () => {
    mockFeedApi({ settings: makeSettings({ canPost: false, postingMode: "STAFF_ONLY" }), pages: { "": { items: [makePost()], nextCursor: null } } });
    await mount(<FeedPage />);
    await until(() => cards().length === 1, "post");
    expect($("[data-testid=composer-open]")).toBeNull();
    expect($("[data-testid=cannot-post]")?.textContent).toContain("só a equipe publica");
  });

  it("modo moderado: o compositor avisa que o post depende de aprovação", async () => {
    await openComposer({ settings: makeSettings({ requiresApproval: true }) });
    expect($("[data-testid=composer-approval-hint]")?.textContent).toContain("Seu post será publicado depois que um professor aprovar.");
  });
});

describe("texto e limite de 2000", () => {
  it("contador, Publicar desabilitado sem conteúdo e limite de 2000 caracteres", async () => {
    await openComposer();
    expect($("[data-testid=composer-counter]")?.textContent).toBe("0/2000");
    expect(publishButton().disabled).toBe(true);
    typeInto(bodyField(), "Bora treinar!");
    expect($("[data-testid=composer-counter]")?.textContent).toBe("13/2000");
    expect(publishButton().disabled).toBe(false);
    typeInto(bodyField(), "   ");
    expect(publishButton().disabled).toBe(true);
    typeInto(bodyField(), "x".repeat(2100));
    expect(bodyField().value.length).toBe(2000);
    expect($("[data-testid=composer-counter]")?.textContent).toBe("2000/2000");
  });

  it("o foco vai para o campo de texto ao abrir a folha", async () => {
    await openComposer();
    await settle();
    expect(document.activeElement).toBe(bodyField());
  });

  it("o rascunho não vai para o localStorage", async () => {
    await openComposer();
    typeInto(bodyField(), "segredo do rascunho");
    await settle();
    const dump = JSON.stringify(Object.entries(localStorage));
    expect(dump).not.toContain("segredo do rascunho");
  });
});

describe("fotos", () => {
  it("a foto é enviada assim que escolhida (multipart em /feed/media) e libera o Publicar sem texto", async () => {
    const state = await openComposer();
    chooseFiles(fileInput(), [photo("treino.jpg")]);
    expect(publishButton().disabled).toBe(true); // enviando
    await until(() => $$("[data-testid=composer-photos] li[data-status=done]").length === 1, "upload concluído");
    const upload = callsOf(state, "POST", /^\/feed\/media$/);
    expect(upload).toHaveLength(1);
    expect((upload[0]?.form?.get("file") as File).name).toBe("treino.jpg");
    expect(publishButton().disabled).toBe(false);
    expect(fileInput().getAttribute("accept")).toBe("image/jpeg,image/png,image/webp");
    expect(fileInput().multiple).toBe(true);
    expect($("[data-testid=composer-camera-input]")?.getAttribute("capture")).toBe("environment");
  });

  it("enquanto envia, o botão fica desabilitado e diz 'Enviando fotos…'", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await openComposer({
      respond: async (call) => {
        if (call.path === "/feed/media") await gate;
        return undefined;
      },
    });
    typeInto(bodyField(), "com foto");
    chooseFiles(fileInput(), [photo()]);
    await settle(10);
    expect(publishButton().disabled).toBe(true);
    expect(publishButton().textContent).toBe("Enviando fotos…");
    expect($("[data-testid=composer-photos] [role=status]")).not.toBeNull();
    release!();
    await until(() => !publishButton().disabled, "upload terminou");
    expect(publishButton().textContent).toBe("Publicar");
  });

  it("tipos inválidos e arquivos grandes são recusados antes de ir à rede, com mensagem amigável", async () => {
    const state = await openComposer();
    chooseFiles(fileInput(), [
      photo("animacao.gif", "image/gif"),
      photo("iphone.heic", "image/heic"),
      photo("doc.pdf", "application/pdf"),
      photo("enorme.jpg", "image/jpeg", 5 * 1024 * 1024 + 1),
    ]);
    const message = $("[data-testid=composer-file-error]")?.textContent ?? "";
    expect(message).toContain("animacao.gif");
    expect(message).toContain("HEIC");
    expect(message).toContain("doc.pdf");
    expect(message).toContain("5 MB");
    expect(callsOf(state, "POST", /^\/feed\/media$/)).toHaveLength(0);
    expect($("[data-testid=composer-photos]")).toBeNull();
  });

  it("máximo de 6 fotos: a 7ª é recusada com aviso e só 6 sobem", async () => {
    const state = await openComposer();
    chooseFiles(fileInput(), Array.from({ length: 7 }, (_, i) => photo(`f${i}.jpg`)));
    await until(() => $$("[data-testid=composer-photos] li[data-status=done]").length === 6, "6 uploads");
    expect(callsOf(state, "POST", /^\/feed\/media$/)).toHaveLength(6);
    expect($("[data-testid=composer-file-error]")?.textContent).toContain("Máximo de 6 fotos");
    const gallery = [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Galeria")) as HTMLButtonElement;
    expect(gallery.disabled).toBe(true);
  });

  it("foto com erro bloqueia o Publicar até remover ou tentar de novo; remover libera", async () => {
    let failing = true;
    const state = await openComposer({
      respond: (call) => (call.path === "/feed/media" && failing ? json(415, { message: "tipo", code: "FILE_TYPE_NOT_ALLOWED" }) : undefined),
    });
    typeInto(bodyField(), "texto");
    chooseFiles(fileInput(), [photo("a.jpg")]);
    await until(() => $("[data-testid=photo-error]") !== null, "erro de upload");
    expect($("[data-testid=photo-error]")?.textContent).toContain("Formato não aceito");
    expect(publishButton().disabled).toBe(true);
    failing = false;
    click($("[aria-label='Tentar enviar a foto de novo']"));
    await until(() => $$("[data-testid=composer-photos] li[data-status=done]").length === 1, "reenvio");
    expect(publishButton().disabled).toBe(false);
    expect(callsOf(state, "POST", /^\/feed\/media$/)).toHaveLength(2);
    click($("[data-testid=photo-remove]"));
    expect($("[data-testid=composer-photos]")).toBeNull();
  });
});

describe("publicar", () => {
  it("envia texto + mediaIds + visibilidade; o post novo aparece no topo e a folha fecha", async () => {
    const state = await openComposer();
    typeInto(bodyField(), "  Roda linda hoje  ");
    chooseFiles(fileInput(), [photo("a.jpg"), photo("b.png", "image/png")]);
    await until(() => $$("[data-testid=composer-photos] li[data-status=done]").length === 2, "uploads");
    click(publishButton());
    await until(() => callsOf(state, "POST", /^\/feed\/posts$/).length === 1, "POST /feed/posts");
    expect(callsOf(state, "POST", /^\/feed\/posts$/)[0]?.body).toEqual({ visibility: "GROUP", body: "Roda linda hoje", mediaIds: [501, 502] });
    await until(() => cards().length === 2, "post novo na lista");
    expect(cards()[0]?.getAttribute("data-post-id")).toBe("777");
    expect(cards()[0]?.textContent).toContain("Roda linda hoje");
    expect(cards()[1]?.getAttribute("data-post-id")).toBe("1");
    expect($("#composer-body")).toBeNull();
    expect(toastMock.success).toHaveBeenCalledWith("Publicado no grupo!");
  });

  it("depois de publicar o rascunho é limpo (abrir de novo traz tudo vazio)", async () => {
    await openComposer();
    typeInto(bodyField(), "primeiro");
    click(publishButton());
    await until(() => $("#composer-body") === null, "folha fechada");
    click($("[data-testid=composer-open]"));
    await until(() => bodyField() !== null, "folha reaberta");
    expect(bodyField().value).toBe("");
    expect($("[data-testid=composer-photos]")).toBeNull();
  });

  it("post que fica pendente de aprovação: aviso 'enviado para aprovação' e cartão esmaecido", async () => {
    await openComposer({
      respond: (call) =>
        call.method === "POST" && call.path === "/feed/posts"
          ? json(201, makePost({ id: 778, body: "aguarde", status: "PENDING_APPROVAL", canEdit: true, canDelete: true }))
          : undefined,
    });
    typeInto(bodyField(), "aguarde");
    click(publishButton());
    await until(() => $("[data-testid=composer-pending-notice]") !== null, "aviso");
    expect($("[data-testid=composer-pending-notice]")?.textContent).toContain("enviado para aprovação");
    expect(toastMock.success.mock.calls[0]?.[0]).toContain("Enviado para aprovação");
    await until(() => cards().length === 2, "post pendente no topo");
    expect(cards()[0]?.getAttribute("data-status")).toBe("PENDING_APPROVAL");
    expect(cards()[0]?.querySelector("[data-testid=pending-banner]")).not.toBeNull();
  });

  it("403 POSTING_NOT_ALLOWED: explica, mantém o rascunho e relê as configurações", async () => {
    const state = await openComposer({
      respond: (call) =>
        call.method === "POST" && call.path === "/feed/posts" ? json(403, { message: "negado", code: "POSTING_NOT_ALLOWED" }) : undefined,
    });
    typeInto(bodyField(), "meu texto");
    chooseFiles(fileInput(), [photo("a.jpg")]);
    await until(() => $$("[data-testid=composer-photos] li[data-status=done]").length === 1, "upload");
    const settingsBefore = callsOf(state, "GET", /feed\/settings$/).length;
    click(publishButton());
    await until(() => $("[data-testid=composer-error]") !== null, "erro");
    expect($("[data-testid=composer-error]")?.textContent).toContain("não tem permissão");
    expect(bodyField().value).toBe("meu texto");
    expect($$("[data-testid=composer-photos] li")).toHaveLength(1);
    await until(() => callsOf(state, "GET", /feed\/settings$/).length > settingsBefore, "settings relido");
  });

  it("403 FEED_DISABLED mostra a mensagem do feed desligado", async () => {
    await openComposer({
      respond: (call) => (call.method === "POST" && call.path === "/feed/posts" ? json(403, { message: "x", code: "FEED_DISABLED" }) : undefined),
    });
    typeInto(bodyField(), "oi");
    click(publishButton());
    await until(() => $("[data-testid=composer-error]") !== null, "erro");
    expect($("[data-testid=composer-error]")?.textContent).toContain("desligado");
  });

  it("429 POST_LIMIT: avisa o limite diário e mantém o texto", async () => {
    await openComposer({
      respond: (call) => (call.method === "POST" && call.path === "/feed/posts" ? json(429, { message: "limite", code: "POST_LIMIT" }) : undefined),
    });
    typeInto(bodyField(), "mais um");
    click(publishButton());
    await until(() => $("[data-testid=composer-error]") !== null, "erro");
    expect($("[data-testid=composer-error]")?.textContent).toContain("limite de publicações de hoje");
    expect(bodyField().value).toBe("mais um");
    expect(publishButton().disabled).toBe(false);
  });

  it("erro de rede: rascunho preservado (texto e fotos) e dá para tentar de novo", async () => {
    let offline = true;
    const state = await openComposer({
      respond: (call) => {
        if (call.method === "POST" && call.path === "/feed/posts" && offline) throw new TypeError("Failed to fetch");
        return undefined;
      },
    });
    typeInto(bodyField(), "sem sinal");
    chooseFiles(fileInput(), [photo("a.jpg")]);
    await until(() => $$("[data-testid=composer-photos] li[data-status=done]").length === 1, "upload");
    click(publishButton());
    await until(() => $("[data-testid=composer-error]") !== null, "erro");
    expect($("[data-testid=composer-error]")?.textContent).toContain("Sem conexão");
    expect(bodyField().value).toBe("sem sinal");
    expect($$("[data-testid=composer-photos] li")).toHaveLength(1);
    offline = false;
    click(publishButton());
    await until(() => cards().length === 2, "publicou na 2ª tentativa");
    expect(callsOf(state, "POST", /^\/feed\/posts$/)).toHaveLength(2);
    expect(callsOf(state, "POST", /^\/feed\/posts$/)[1]?.body).toEqual({ visibility: "GROUP", body: "sem sinal", mediaIds: [501] });
  });

  it("o botão fica desabilitado enquanto publica (sem envio duplo)", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const state = await openComposer({
      respond: async (call) => {
        if (call.method === "POST" && call.path === "/feed/posts") await gate;
        return undefined;
      },
    });
    typeInto(bodyField(), "uma vez só");
    click(publishButton());
    await settle(10);
    expect(publishButton().disabled).toBe(true);
    expect(publishButton().textContent).toBe("Publicando…");
    click(publishButton());
    release!();
    await until(() => cards().length === 2, "publicado");
    expect(callsOf(state, "POST", /^\/feed\/posts$/)).toHaveLength(1);
  });
});

describe("visibilidade", () => {
  it("sem unidade/turma: mostra fixo 'Todo o grupo' (sem seletor)", async () => {
    await openComposer();
    expect($("#composer-visibility")).toBeNull();
    expect($("[data-testid=composer-visibility-fixed]")?.textContent).toContain("Todo o grupo");
  });

  it("com turma/unidade do usuário: seletor com Grupo, Minha unidade e Minha turma; envia classId", async () => {
    const state = await openComposer({
      classes: [{ id: 7, name: "Iniciantes", unitId: 3, unit: { id: 3, name: "Sede Centro" }, description: null, weekday: null, startTime: null, endTime: null }],
    });
    await until(() => $("#composer-visibility") !== null, "seletor");
    const select = $("#composer-visibility") as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "Todo o grupo",
      "Minha unidade (Sede Centro)",
      "Minha turma: Iniciantes",
    ]);
    typeInto(bodyField(), "só da turma");
    // troca de valor num <select> controlado: define e dispara change
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "CLASS:7");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    click(publishButton());
    await until(() => callsOf(state, "POST", /^\/feed\/posts$/).length === 1, "POST");
    expect(callsOf(state, "POST", /^\/feed\/posts$/)[0]?.body).toEqual({ visibility: "CLASS", body: "só da turma", classId: 7 });
  });
});
