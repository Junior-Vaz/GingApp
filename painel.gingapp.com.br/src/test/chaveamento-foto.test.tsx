import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";

// Recorte/compressão (canvas) não existem no jsdom: o teste controla o que `prepareImage` devolve.
const prepareMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/photo/prepare-image", () => ({ prepareImage: prepareMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ChaveamentoPage } from "@/modules/chaveamento";
import { TOURNAMENT_ERROR_MESSAGES } from "@/modules/chaveamento/errors";
import { photoHiddenReason } from "@/modules/chaveamento/helpers";
import { clearSession, loginAs } from "./login-as";
import { mkCategory, mkCompetitor, mkMatch, mkTournament, summaryOf } from "./chaveamento-fixtures";
import { errorBody, installFakeBackend, json, newFake, sent, type Fake } from "./chaveamento-server";
import { PREPARED, chooseInPicker, confirmCrop, installPhotoMocks, restorePhotoMocks } from "./photo-flow";
import { fakeFile } from "./photo-test-utils";
import type { UrlMocks } from "./photo-test-utils";
import {
  REAL_ERROR_PHOTO_PROCESSING_UNAVAILABLE,
  REAL_ERROR_PHOTO_QUOTA,
  REAL_ERROR_PHOTO_TOO_LARGE,
  REAL_ERROR_PHOTO_TYPE_NOT_ALLOWED,
  REAL_IMPORT_PARTICIPANTS_WITH_PHOTOS,
} from "./real-contract-chaveamento";

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const BASE = "/events/7/tournament";
let fake: Fake;
let urls: UrlMocks;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChaveamentoPage eventId={7} />
    </QueryClientProvider>,
  );
}

function withCategory(category: ReturnType<typeof mkCategory>): void {
  fake.category = category;
  fake.tournament = mkTournament({ categories: [summaryOf(category)] });
}

beforeEach(() => {
  loginAs("MESTRE");
  urls = installPhotoMocks();
  prepareMock.mockReset();
  prepareMock.mockImplementation(async () => PREPARED());
  fake = newFake();
  installFakeBackend(fake);
});

afterEach(() => {
  restorePhotoMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

/** Abre "Adicionar de fora" e preenche o nome. */
async function openGuestDialog(name = "Fulano de Tal"): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: /Adicionar de fora/ }));
  const dialog = await screen.findByTestId("competitor-dialog");
  fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: name } });
  return dialog;
}

const photoPosts = () => sent(fake, "POST", "/photo");

describe("atleta de fora: foto por câmera/arquivo (PhotoPicker) em 2 chamadas por id", () => {
  it("cria o atleta e DEPOIS envia a foto pelo `createdCompetitorId` (nunca por nome); o corpo é multipart `file` = foto.webp", async () => {
    withCategory(mkCategory());
    // O id criado NÃO é o que um "achar pelo nome" daria: o painel só pode usar o `createdCompetitorId`.
    fake.overrides[`POST ${BASE}/categories/5/competitors`] = () => {
      fake.category!.competitors.push(mkCompetitor(555, "Fulano de Tal"), mkCompetitor(777, "Fulano de Tal"));
      return json(201, { ...fake.category!, createdCompetitorId: 777 });
    };
    renderPage();
    const dialog = await openGuestDialog();
    chooseInPicker(fakeFile("eu.jpg"), dialog);
    await confirmCrop();
    expect(prepareMock).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ shape: "square" }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(photoPosts()).toHaveLength(1));
    expect(photoPosts()[0]!.path).toBe(`${BASE}/categories/5/competitors/777/photo`);
    expect(photoPosts()[0]!.body).toEqual({ file: { name: "foto.webp", type: "image/webp", size: 1500 } });
    // ordem: primeiro o atleta, depois a foto; o corpo do atleta NÃO leva photoUrl
    const order = fake.calls.filter((c) => c.method === "POST").map((c) => c.path);
    expect(order.indexOf(`${BASE}/categories/5/competitors`)).toBeLessThan(order.indexOf(`${BASE}/categories/5/competitors/777/photo`));
    expect(JSON.stringify(sent(fake, "POST", "/competitors")[0]!.body)).not.toContain("photoUrl");
    await waitFor(() => expect(screen.queryByTestId("competitor-dialog")).not.toBeInTheDocument());
  });

  it("sem foto escolhida: só o POST do atleta (nenhuma chamada de foto)", async () => {
    withCategory(mkCategory());
    renderPage();
    const dialog = await openGuestDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(sent(fake, "POST", "/competitors")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId("competitor-dialog")).not.toBeInTheDocument());
    expect(photoPosts()).toHaveLength(0);
  });

  it("a foto falhou (503): o atleta FICA, a tela mostra a mensagem do código e 'Tentar enviar a foto de novo' repete SÓ a foto, sem recriar", async () => {
    withCategory(mkCategory());
    let attempt = 0;
    fake.overrides[`POST ${BASE}/categories/5/competitors/101/photo`] = () => {
      attempt += 1;
      if (attempt === 1) return json(503, REAL_ERROR_PHOTO_PROCESSING_UNAVAILABLE);
      const c = fake.category!.competitors.find((x) => x.id === 101)!;
      c.hasOwnPhoto = true;
      c.photoVersion = 1_794_000_000_000;
      return json(200, fake.category);
    };
    renderPage();
    const dialog = await openGuestDialog("Maria Foto");
    chooseInPicker(fakeFile("maria.jpg"), dialog);
    await confirmCrop();
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar" }));

    const failure = await screen.findByTestId("photo-failure");
    expect(failure).toHaveAttribute("role", "alert");
    expect(within(failure).getByText(/O atleta foi adicionado, mas a foto não/)).toBeInTheDocument();
    expect(screen.getByTestId("photo-failure-message")).toHaveTextContent(TOURNAMENT_ERROR_MESSAGES.PHOTO_PROCESSING_UNAVAILABLE);
    expect(toast.error).not.toHaveBeenCalled(); // o erro é mostrado na própria tela (sem toast duplicado)
    // o atleta está salvo e já aparece na lista de trás
    expect(sent(fake, "POST", "/competitors")).toHaveLength(1);
    expect(fake.category!.competitors.map((c) => c.displayName)).toEqual(["Maria Foto"]);
    // os campos ficam travados (nada de criar de novo por engano)
    expect(within(dialog).getByLabelText("Nome")).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Adicionar" })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Tentar enviar a foto de novo" }));
    await waitFor(() => expect(screen.queryByTestId("competitor-dialog")).not.toBeInTheDocument());
    expect(photoPosts()).toHaveLength(2);
    expect(photoPosts()[1]!.path).toBe(`${BASE}/categories/5/competitors/101/photo`);
    expect(sent(fake, "POST", "/competitors")).toHaveLength(1); // NÃO recriou o atleta
  });

  it.each([
    ["413 PHOTO_TOO_LARGE", 413, REAL_ERROR_PHOTO_TOO_LARGE, "PHOTO_TOO_LARGE"],
    ["415 PHOTO_TYPE_NOT_ALLOWED", 415, REAL_ERROR_PHOTO_TYPE_NOT_ALLOWED, "PHOTO_TYPE_NOT_ALLOWED"],
    ["429 PHOTO_QUOTA", 429, REAL_ERROR_PHOTO_QUOTA, "PHOTO_QUOTA"],
  ] as const)("erro real %s: a tela mostra a mensagem em português do código (e não o texto técnico do servidor)", async (_name, status, body, code) => {
    withCategory(mkCategory());
    fake.overrides[`POST ${BASE}/categories/5/competitors/101/photo`] = () => json(status, body);
    renderPage();
    const dialog = await openGuestDialog();
    chooseInPicker(fakeFile("x.jpg"), dialog);
    await confirmCrop();
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar" }));
    const message = await screen.findByTestId("photo-failure-message");
    expect(message).toHaveTextContent(TOURNAMENT_ERROR_MESSAGES[code]);
    expect(message.textContent).not.toBe(body.message);
  });

  it("o servidor não devolveu `createdCompetitorId` (versão antiga): o atleta fica e a tela orienta a usar Editar; sem 'tentar de novo' (não adivinha por nome)", async () => {
    withCategory(mkCategory());
    fake.overrides[`POST ${BASE}/categories/5/competitors`] = () => {
      fake.category!.competitors.push(mkCompetitor(101, "Sem Id"));
      return json(201, fake.category);
    };
    renderPage();
    const dialog = await openGuestDialog("Sem Id");
    chooseInPicker(fakeFile("a.jpg"), dialog);
    await confirmCrop();
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar" }));
    expect(await screen.findByTestId("photo-failure-message")).toHaveTextContent(/Abra Editar no atleta/);
    expect(within(dialog).queryByRole("button", { name: /Tentar enviar a foto de novo/ })).not.toBeInTheDocument();
    expect(photoPosts()).toHaveLength(0);
  });

  it("recusa de nome/semente continua antes de qualquer chamada (nem atleta nem foto)", async () => {
    withCategory(mkCategory());
    renderPage();
    const dialog = await openGuestDialog("A");
    chooseInPicker(fakeFile("x.jpg"), dialog);
    await confirmCrop();
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar" }));
    expect(await within(dialog).findByText(/mínimo 2 caracteres/)).toBeInTheDocument();
    expect(sent(fake, "POST", "/competitors")).toHaveLength(0);
    expect(photoPosts()).toHaveLength(0);
  });

  it("cada abertura do diálogo começa limpa: a foto e o nome do atleta anterior não ficam para o próximo", async () => {
    withCategory(mkCategory());
    renderPage();
    const first = await openGuestDialog("Primeiro");
    chooseInPicker(fakeFile("x.jpg"), first);
    await confirmCrop();
    fireEvent.click(within(first).getByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(screen.queryByTestId("competitor-dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Adicionar de fora/ }));
    const second = await screen.findByTestId("competitor-dialog");
    expect(within(second).getByLabelText("Nome")).toHaveValue("");
    expect(within(second).queryByTestId("photo-remove")).not.toBeInTheDocument();
    expect(within(second).queryByAltText(/Foto de/)).not.toBeInTheDocument();
  });
});

describe("atleta existente: ver, trocar e remover a foto própria (blob autenticado)", () => {
  const OWN = () => mkCompetitor(101, "Com Foto", { hasOwnPhoto: true, photoVersion: 1_794_457_114_882, photoPublic: true });

  function withOwnPhoto() {
    withCategory(mkCategory({ competitors: [OWN(), mkCompetitor(102, "Sem Foto")] }));
    fake.photos.set(101, new Blob([new Uint8Array(900)], { type: "image/webp" }));
  }

  it("a lista mostra a foto própria baixada COM Authorization (blob), nunca por URL de rede, e a Blob URL é revogada ao sair", async () => {
    withOwnPhoto();
    const view = renderPage();
    const list = await screen.findByTestId("competitors-list");
    await waitFor(() => expect(list.querySelector("img[data-own-photo]")).not.toBeNull());
    const img = list.querySelector("img[data-own-photo]") as HTMLImageElement;
    expect(img.getAttribute("src")).toMatch(/^blob:test\//);
    expect(img.hasAttribute("referrerpolicy")).toBe(false);
    expect(fake.photoAuth.length).toBeGreaterThan(0);
    for (const auth of fake.photoAuth) expect(auth).toBe("Bearer tok");
    // um único download por (atleta, versão), mesmo com o avatar aparecendo em vários lugares
    expect(sent(fake, "GET", "/competitors/101/photo")).toHaveLength(1);
    // o atleta sem foto próprio não baixa nada
    expect(sent(fake, "GET", "/competitors/102/photo")).toHaveLength(0);
    expect(urls.revoked).toHaveLength(0);
    view.unmount();
    expect(urls.revoked.length).toBeGreaterThan(0);
    expect(urls.revoked).toEqual(urls.created);
  });

  it("a foto do ALUNO vem de photoUrl (/api/uploads) e não baixa nada pela rota privada", async () => {
    const uploaded = "/api/uploads/3f2b8c1e-5d4a-4c3b-9a7e-1b2c3d4e5f60.webp";
    withCategory(mkCategory({ competitors: [mkCompetitor(101, "Aluna", { studentId: 9, photoUrl: uploaded, photoPublic: true })] }));
    renderPage();
    const list = await screen.findByTestId("competitors-list");
    const img = list.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toMatch(new RegExp(`${uploaded.replace(/\./g, "\\.")}$`));
    expect(sent(fake, "GET", "/photo")).toHaveLength(0);
  });

  it("editar: o PhotoPicker mostra a foto atual (blob autenticado); trocar envia PATCH e depois POST .../photo, com 'Enviando…' no picker", async () => {
    withOwnPhoto();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Editar Com Foto" }));
    const dialog = await screen.findByTestId("competitor-dialog");
    await waitFor(() => expect(within(dialog).getByAltText("Foto de Com Foto")).toBeInTheDocument());
    expect(within(dialog).getByRole("button", { name: /Remover/ })).toBeInTheDocument();

    // segura o POST da foto para ver o picker "ocupado" (busy) durante o envio
    const inner = globalThis.fetch;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (init?.method === "POST" && String(input).endsWith("/photo")) await held;
        return inner(input, init);
      }),
    );
    chooseInPicker(fakeFile("nova.jpg"), dialog);
    await confirmCrop();
    // a foto nova aparece na hora (pré-visualização do Blob), ainda sem enviar
    expect(photoPosts()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(within(dialog).getByTestId("photo-status")).toHaveTextContent(/Enviando a foto/));
    for (const busy of within(dialog).getAllByRole("button", { name: /Enviando/ })) expect(busy).toBeDisabled();
    expect(within(dialog).getByTestId("photo-upload")).toBeDisabled();
    release();
    await waitFor(() => expect(photoPosts()).toHaveLength(1));
    expect(fake.calls.some((c) => c.method === "PATCH" && /competitors\/101$/.test(c.path))).toBe(true);
    expect(photoPosts()[0]!.path).toBe(`${BASE}/categories/5/competitors/101/photo`);
    expect(photoPosts()[0]!.body).toEqual({ file: { name: "foto.webp", type: "image/webp", size: 1500 } });
    await waitFor(() => expect(screen.queryByTestId("competitor-dialog")).not.toBeInTheDocument());
    // o PATCH não leva nenhum campo de foto (nem photoUrl)
    const patch = fake.calls.find((c) => c.method === "PATCH" && /competitors\/101$/.test(c.path))!;
    expect(JSON.stringify(patch.body)).not.toContain("photoUrl");
  });

  it("'Remover' + Salvar apaga a foto própria (DELETE .../photo) e o atleta volta às iniciais", async () => {
    withOwnPhoto();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Editar Com Foto" }));
    const dialog = await screen.findByTestId("competitor-dialog");
    await waitFor(() => expect(within(dialog).getByAltText("Foto de Com Foto")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("button", { name: /Remover/ }));
    expect(within(dialog).queryByAltText("Foto de Com Foto")).not.toBeInTheDocument();
    expect(sent(fake, "DELETE", "/photo")).toHaveLength(0); // só ao salvar
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(sent(fake, "DELETE", "/photo")).toHaveLength(1));
    expect(sent(fake, "DELETE", "/photo")[0]!.path).toBe(`${BASE}/categories/5/competitors/101/photo`);
    expect(photoPosts()).toHaveLength(0);
    await waitFor(() => expect(screen.queryByTestId("competitor-dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(fake.category!.competitors[0]!.hasOwnPhoto).toBe(false));
  });

  it("editar SEM mexer na foto não chama POST nem DELETE de foto", async () => {
    withOwnPhoto();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Editar Com Foto" }));
    const dialog = await screen.findByTestId("competitor-dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Com Foto Renomeado" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(fake.calls.some((c) => c.method === "PATCH")).toBe(true));
    await waitFor(() => expect(screen.queryByTestId("competitor-dialog")).not.toBeInTheDocument());
    expect(photoPosts()).toHaveLength(0);
    expect(sent(fake, "DELETE", "/photo")).toHaveLength(0);
  });

  it("falha ao trocar a foto na edição: os dados já foram salvos; 'Tentar enviar a foto de novo' repete só a foto (sem novo PATCH)", async () => {
    withOwnPhoto();
    let attempt = 0;
    fake.overrides[`POST ${BASE}/categories/5/competitors/101/photo`] = () => {
      attempt += 1;
      return attempt === 1 ? errorBody(429, "PHOTO_QUOTA") : json(200, fake.category);
    };
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Editar Com Foto" }));
    const dialog = await screen.findByTestId("competitor-dialog");
    chooseInPicker(fakeFile("nova.jpg"), dialog);
    await confirmCrop();
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText(/Os dados do atleta foram salvos, mas a foto não/)).toBeInTheDocument();
    expect(screen.getByTestId("photo-failure-message")).toHaveTextContent(TOURNAMENT_ERROR_MESSAGES.PHOTO_QUOTA);
    const patches = () => fake.calls.filter((c) => c.method === "PATCH" && /competitors\/101$/.test(c.path)).length;
    expect(patches()).toBe(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Tentar enviar a foto de novo" }));
    await waitFor(() => expect(photoPosts()).toHaveLength(2));
    expect(patches()).toBe(1);
  });

  it("o Blob da foto atual do diálogo é revogado ao fechar (nada de Blob URL solta)", async () => {
    withOwnPhoto();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Editar Com Foto" }));
    const dialog = await screen.findByTestId("competitor-dialog");
    await waitFor(() => expect(within(dialog).getByAltText("Foto de Com Foto")).toBeInTheDocument());
    const createdBefore = urls.created.length;
    expect(createdBefore).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByTestId("competitor-dialog")).not.toBeInTheDocument());
    // as Blob URLs do PICKER (pré-visualização) foram revogadas; só a do avatar da lista segue viva enquanto a tela está aberta
    const stillLive = urls.created.filter((url) => !urls.revoked.includes(url));
    expect(stillLive.length).toBe(1);
  });
});

describe("atleta ligado a aluno: sem upload de foto", () => {
  it("o diálogo mostra a foto do aluno e o aviso 'A foto vem do cadastro do aluno'; nenhum PhotoPicker, nenhuma chamada de foto", async () => {
    withCategory(
      mkCategory({
        status: "RUNNING",
        competitors: [mkCompetitor(101, "Aluna Ana", { studentId: 9, photoUrl: "/api/uploads/3f2b8c1e-5d4a-4c3b-9a7e-1b2c3d4e5f60.webp", photoPublic: true }), mkCompetitor(102, "Bia")],
        matches: [mkMatch(50, { slotAId: 101, slotBId: 102, status: "READY" })],
      }),
    );
    renderPage();
    await screen.findByTestId("bracket");
    fireEvent.click(screen.getByText(/Atletas \(2\)/));
    fireEvent.click(await screen.findByRole("button", { name: "Editar Aluna Ana" }));
    const dialog = await screen.findByTestId("competitor-dialog");
    const note = within(dialog).getByTestId("student-photo-note");
    expect(note).toHaveTextContent("A foto vem do cadastro do aluno.");
    expect(within(dialog).queryByTestId("photo-picker")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Enviar foto" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Tirar foto/ })).not.toBeInTheDocument();
    expect(note.querySelector("img")?.getAttribute("src")).toMatch(/3f2b8c1e-5d4a-4c3b-9a7e-1b2c3d4e5f60\.webp$/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(fake.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(photoPosts()).toHaveLength(0);
    expect(sent(fake, "DELETE", "/photo")).toHaveLength(0);
  });
});

describe("selo 'Foto no telão' e importação com fotos das inscrições", () => {
  it("quando a foto NÃO vai ao telão o painel explica o porquê (menor sem autorização, sem foto); quando vai, não diz nada", async () => {
    withCategory(
      mkCategory({
        competitors: [
          mkCompetitor(101, "Adulta", { hasOwnPhoto: true, photoVersion: 1, photoPublic: true }),
          mkCompetitor(102, "Menor Sem Aut", { ageGroup: "MINOR", hasOwnPhoto: true, photoVersion: 2, photoPublic: false }),
          mkCompetitor(103, "Sem Foto", { photoPublic: false }),
        ],
      }),
    );
    renderPage();
    await screen.findByTestId("competitors-list");
    expect(screen.getByTestId("photo-indicator-101")).toHaveTextContent("Foto no telão: sim");
    expect(screen.queryByTestId("photo-reason-101")).not.toBeInTheDocument();
    expect(screen.getByTestId("photo-indicator-102")).toHaveTextContent("Foto no telão: não");
    expect(screen.getByTestId("photo-reason-102")).toHaveTextContent(/sem autorização do responsável/);
    expect(screen.getByTestId("photo-reason-103")).toHaveTextContent(/Sem foto cadastrada/);
  });

  it("photoHiddenReason: foto de adulto que não aparece sem motivo claro cai na mensagem genérica", () => {
    const base = { photoPublic: false, hasOwnPhoto: true, photoUrl: null, ageGroup: "ADULT" as const, photoAuthorized: false };
    expect(photoHiddenReason(base)).toBe("A foto não aparece no telão agora.");
    expect(photoHiddenReason({ ...base, photoPublic: true })).toBeNull();
    expect(photoHiddenReason({ ...base, ageGroup: "UNKNOWN" })).toMatch(/sem autorização do responsável/);
    expect(photoHiddenReason({ ...base, ageGroup: "MINOR", photoAuthorized: true })).toBe("A foto não aparece no telão agora.");
  });

  it("importar do evento mostra 'N fotos importadas das inscrições' (aviso fixo na lista + toast) a partir de photosImported", async () => {
    withCategory(mkCategory());
    fake.overrides["GET /events/7/participants"] = () =>
      json(200, [
        { id: 14109, status: "CONFIRMED", student: null, guestName: "Adulta Com Foto" },
        { id: 14110, status: "CONFIRMED", student: null, guestName: "Menor Com Foto" },
      ]);
    fake.overrides[`POST ${BASE}/categories/5/competitors/from-participants`] = () =>
      json(200, { ...REAL_IMPORT_PARTICIPANTS_WITH_PHOTOS, category: { ...fake.category!, competitors: [] } });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Adicionar do evento/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: "Selecionar todos" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Importar 2/ }));
    const notice = await screen.findByTestId("import-notice");
    expect(notice).toHaveTextContent("6 atletas adicionados, 1 já estavam na categoria ou não puderam entrar. 2 fotos importadas das inscrições.");
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("2 fotos importadas das inscrições"));
    fireEvent.click(within(notice).getByRole("button", { name: "Fechar aviso" }));
    expect(screen.queryByTestId("import-notice")).not.toBeInTheDocument();
  });

  it("importação sem foto de inscrição não inventa a frase de fotos", async () => {
    withCategory(mkCategory());
    fake.overrides["GET /events/7/participants"] = () => json(200, [{ id: 14109, status: "CONFIRMED", student: null, guestName: "Só Um" }]);
    fake.overrides[`POST ${BASE}/categories/5/competitors/from-participants`] = () =>
      json(200, { added: 1, skipped: 0, photosImported: 0, addedCompetitorIds: [3], category: fake.category });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Adicionar do evento/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: "Selecionar todos" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Importar 1/ }));
    expect(await screen.findByTestId("import-notice")).toHaveTextContent(/^1 atleta adicionado\.$/);
  });
});
