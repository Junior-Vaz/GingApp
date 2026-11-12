import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/photo/prepare-image", () => ({ prepareImage: prepareMock }));

import { FieldBlock } from "@/components/gingapp/inscricao-campos";
import { PublicRegistrationPage } from "@/components/gingapp/inscricao-publica";
import { buildAnswers, validateAnswers, type AnswerValue, type FormFieldDef, type PublicForm } from "@/lib/inscricao";
import { PhotoError } from "@/lib/photo/types";
import {
  byLabelText,
  byTestId,
  buttonText,
  cleanup as cleanupFixtures,
  click,
  field,
  json,
  makeForm,
  mockApi,
  renderWith,
  setValue,
  text,
  waitFor as waitForFixtures,
  type Call,
} from "./inscricao-fixtures";
import { REAL_FORM_WITH_PHOTO, REAL_UPLOAD_PHOTO_201, REAL_UPLOAD_FILE_201 } from "./real-contract-form-photo";
import { act, cleanup, fireEvent, render, screen, waitFor } from "./photo-dom";
import { fakeFile, installUrlMocks, type UrlMocks } from "./photo-test-utils";

/**
 * Campo "Foto do participante" (PHOTO) e compressão do campo de arquivo (FILE) no formulário público de inscrição:
 * escolher -> recortar -> enviar com `fileToken`, erros por código com "Tentar de novo", obrigatório, remover e Blob URLs revogadas.
 */

const FILES = "POST /public/forms/camp/files";
const OUT = new Blob([new Uint8Array(1500)], { type: "image/webp" });
const PHOTO_FIELD: FormFieldDef = field({
  key: "foto",
  type: "PHOTO",
  label: "Foto do participante",
  helpText: "Foto de rosto, bem iluminada.",
  required: true,
  order: 1,
});
const FILE_FIELD: FormFieldDef = field({ key: "comp", type: "FILE", label: "Comprovante do Pix", order: 2 });
const UPLOADED = { fileToken: "tok-foto-1", originalName: "foto.webp", mimeType: "image/webp", sizeBytes: 1500 };

let urls: UrlMocks;

beforeEach(() => {
  urls = installUrlMocks();
  prepareMock.mockReset();
  prepareMock.mockResolvedValue(OUT);
});

afterEach(() => {
  cleanup();
  cleanupFixtures();
  urls.restore();
  vi.unstubAllGlobals();
});

function Harness({ def, error, onAnswer }: { def: FormFieldDef; error?: string; onAnswer?: (value: AnswerValue | undefined) => void }) {
  const [value, setValue] = useState<AnswerValue | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <FieldBlock
        slug="camp"
        field={def}
        value={value}
        error={error}
        onChange={(_key, next) => {
          setValue(next);
          onAnswer?.(next);
        }}
        onBusyChange={(_key, isBusy) => setBusy(isBusy)}
      />
      <output data-testid="answer">{JSON.stringify(value ?? null)}</output>
      <output data-testid="busy">{String(busy)}</output>
    </>
  );
}

const answer = (): unknown => JSON.parse(byTestId("answer")!.textContent ?? "null");

function loadCropImage(width = 3000, height = 4000) {
  const img = screen.getByTestId("crop-image") as HTMLImageElement;
  Object.defineProperty(img, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(img, "naturalHeight", { configurable: true, value: height });
  fireEvent.load(img);
}

/** Escolhe um arquivo na galeria, confirma o recorte e espera o `prepareImage` simulado entregar o Blob. */
async function pickPhoto(file: File = fakeFile("IMG_Joao_da_Silva.jpg")) {
  fireEvent.change(screen.getByTestId("photo-file-input"), { target: { files: [file] } });
  await screen.findByRole("dialog", { name: "Ajustar foto" });
  loadCropImage();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Usar esta foto" }));
  });
}

const uploadCalls = (calls: Call[]) => calls.filter((call) => call.method === "POST" && call.path.endsWith("/files"));

describe("campo PHOTO: escolher -> recortar -> enviar", () => {
  it("renderiza com PhotoPicker (enviar + câmera), rótulo com *, ajuda do formulário e o aviso de privacidade; sem o texto fixo do arquivo", () => {
    mockApi({});
    render(<Harness def={PHOTO_FIELD} />);
    expect(screen.getByTestId("photo-picker")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar foto" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tirar foto/ })).toBeInTheDocument();
    const body = text();
    expect(body).toContain("Foto do participante");
    expect(body).toContain("(obrigatório)");
    expect(body).toContain("Foto de rosto, bem iluminada.");
    expect(body).toContain("A foto será vista só pela organização do evento.");
    expect(body).not.toMatch(/PDF|até 5 MB/);
    // o rótulo do seletor não duplica o do campo na tela (só leitores de tela)
    expect(screen.getByRole("group", { name: "Foto do participante (obrigatório)" })).toBeInTheDocument();
  });

  it("escolher -> recortar -> envia o Blob preparado como foto.webp com fieldKey, sem token de login, e guarda só o fileToken", async () => {
    localStorage.setItem("mb_token", "TOKEN-DO-ALUNO");
    const calls = mockApi({ [FILES]: () => json(201, UPLOADED) });
    render(<Harness def={PHOTO_FIELD} />);
    await pickPhoto();

    await waitFor(() => expect(answer()).toMatchObject({ fileToken: "tok-foto-1" }));
    expect(prepareMock).toHaveBeenCalledTimes(1);
    const sent = uploadCalls(calls);
    expect(sent).toHaveLength(1);
    const form = sent[0]!.body as FormData;
    expect(form.get("fieldKey")).toBe("foto");
    const file = form.get("file") as File;
    expect(file.name).toBe("foto.webp"); // nunca o nome do arquivo do celular
    expect(file.type).toBe("image/webp");
    expect(file.size).toBe(OUT.size);
    expect(sent[0]!.headers["Authorization"]).toBeUndefined();
    localStorage.clear();

    // pré-visualização local (Blob URL) e o campo vira só { fileToken } no POST da inscrição
    expect((screen.getByAltText("Pré-visualização da foto escolhida") as HTMLImageElement).src).toMatch(/^blob:test\//);
    expect(screen.getByRole("button", { name: /Remover/ })).toBeInTheDocument();
    expect(buildAnswers({ fields: [PHOTO_FIELD] }, { foto: answer() as AnswerValue })).toEqual({ foto: { fileToken: "tok-foto-1" } });
    expect(screen.getByTestId("busy").textContent).toBe("false");
  });

  it("durante o envio o campo fica ocupado (bloqueia o envio da inscrição) e o seletor mostra 'Enviando…'", async () => {
    let release: (response: Response) => void = () => undefined;
    mockApi({ [FILES]: () => new Promise<Response>((resolve) => (release = resolve)) as unknown as Response });
    render(<Harness def={PHOTO_FIELD} />);
    await pickPhoto();
    await waitFor(() => expect(screen.getByTestId("busy").textContent).toBe("true"));
    expect(screen.getByRole("button", { name: "Enviando…" })).toBeDisabled();
    await act(async () => release(json(201, UPLOADED)));
    await waitFor(() => expect(screen.getByTestId("busy").textContent).toBe("false"));
    expect(answer()).toMatchObject({ fileToken: "tok-foto-1" });
  });

  it("remover limpa a resposta e a pré-visualização", async () => {
    mockApi({ [FILES]: () => json(201, UPLOADED) });
    render(<Harness def={PHOTO_FIELD} />);
    await pickPhoto();
    await waitFor(() => expect(answer()).not.toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remover/ }));
    });
    expect(answer()).toBeNull();
    expect(screen.queryByRole("button", { name: /Remover/ })).toBeNull();
    expect(screen.queryByAltText("Pré-visualização da foto escolhida")).toBeNull();
  });

  it("trocar a foto reenvia e substitui o fileToken", async () => {
    let n = 0;
    mockApi({ [FILES]: () => json(201, { ...UPLOADED, fileToken: `tok-${++n}` }) });
    render(<Harness def={PHOTO_FIELD} />);
    await pickPhoto();
    await waitFor(() => expect(answer()).toMatchObject({ fileToken: "tok-1" }));
    await pickPhoto(fakeFile("outra.jpg"));
    await waitFor(() => expect(answer()).toMatchObject({ fileToken: "tok-2" }));
  });

  it("Blob URLs são revogadas ao desmontar (e nenhuma foto vai para localStorage/sessionStorage)", async () => {
    mockApi({ [FILES]: () => json(201, UPLOADED) });
    const view = render(<Harness def={PHOTO_FIELD} />);
    await pickPhoto();
    await waitFor(() => expect(answer()).not.toBeNull());
    expect(urls.created.length).toBeGreaterThan(0);
    view.unmount();
    for (const url of urls.created) expect(urls.revoked, url).toContain(url);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("obrigatório: sem foto não passa na validação (mensagem própria) e o erro do campo liga o realce da pré-visualização", () => {
    expect(validateAnswers({ fields: [PHOTO_FIELD] }, {})).toEqual({ foto: "Envie a foto para continuar." });
    expect(validateAnswers({ fields: [{ ...PHOTO_FIELD, required: false }] }, {})).toEqual({});
    mockApi({});
    render(<Harness def={PHOTO_FIELD} error="Envie a foto para continuar." />);
    expect(screen.getByRole("alert").textContent).toContain("Envie a foto para continuar.");
    expect(screen.getByTestId("photo-preview").getAttribute("data-invalid")).toBe("true");
  });
});

describe("campo PHOTO: erros de envio por código (retry quando vale a pena)", () => {
  const CASES: Array<[string, number, string, RegExp]> = [
    ["413 FILE_TOO_LARGE", 413, "FILE_TOO_LARGE", /grande demais/],
    ["415 FILE_TYPE_NOT_ALLOWED", 415, "FILE_TYPE_NOT_ALLOWED", /não foi aceita.*JPG, PNG ou WEBP/],
    ["429 TOO_MANY_REQUESTS", 429, "TOO_MANY_REQUESTS", /Muitas tentativas de envio/],
    ["503 PHOTO_PROCESSING_UNAVAILABLE", 503, "PHOTO_PROCESSING_UNAVAILABLE", /indisponível no momento/],
    ["500 sem código", 500, "", /Não foi possível enviar a foto/],
  ];

  it.each(CASES.filter(([, status]) => status !== 413 && status !== 415))("%s: mostra a mensagem em português, mantém a foto na tela, não preenche a resposta e o retry envia de novo", async (_name, status, code, message) => {
    let attempt = 0;
    const calls = mockApi({
      [FILES]: () => {
        attempt += 1;
        if (attempt === 1) return json(status, { statusCode: status, ...(code ? { code } : {}), message: "texto técnico do servidor" });
        return json(201, UPLOADED);
      },
    });
    render(<Harness def={PHOTO_FIELD} />);
    await pickPhoto();
    await waitFor(() => expect(screen.getByTestId("foto-erro-envio")).toBeInTheDocument());
    expect(screen.getByTestId("foto-erro-envio").textContent).toMatch(message);
    expect(screen.getByTestId("foto-erro-envio").textContent).not.toContain("texto técnico");
    expect(answer()).toBeNull();
    expect(screen.getByAltText("Pré-visualização da foto escolhida")).toBeInTheDocument(); // a foto continua lá

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/ }));
    });
    await waitFor(() => expect(answer()).toMatchObject({ fileToken: "tok-foto-1" }));
    expect(screen.queryByTestId("foto-erro-envio")).toBeNull();
    expect(uploadCalls(calls)).toHaveLength(2);
    // o retry reenvia a MESMA imagem já preparada (sem refazer recorte nem compressão)
    expect(prepareMock).toHaveBeenCalledTimes(1);
  });

  it.each(CASES.filter(([, status]) => status === 413 || status === 415))("%s: mensagem em português que manda escolher outra foto; SEM 'Tentar de novo' (a mesma imagem seria recusada); escolher outra limpa o erro e envia", async (_name, status, code, message) => {
    let attempt = 0;
    const calls = mockApi({
      [FILES]: () => {
        attempt += 1;
        if (attempt === 1) return json(status, { statusCode: status, code, message: "texto técnico do servidor" });
        return json(201, UPLOADED);
      },
    });
    render(<Harness def={PHOTO_FIELD} />);
    await pickPhoto();
    await waitFor(() => expect(screen.getByTestId("foto-erro-envio")).toBeInTheDocument());
    expect(screen.getByTestId("foto-erro-envio").textContent).toMatch(message);
    expect(screen.getByTestId("foto-erro-envio").textContent).not.toContain("texto técnico");
    expect(screen.queryByRole("button", { name: /Tentar de novo/ })).toBeNull();
    expect(answer()).toBeNull();
    expect(screen.getByAltText("Pré-visualização da foto escolhida")).toBeInTheDocument();

    await pickPhoto(fakeFile("outra.jpg"));
    await waitFor(() => expect(answer()).toMatchObject({ fileToken: "tok-foto-1" }));
    expect(screen.queryByTestId("foto-erro-envio")).toBeNull();
    expect(uploadCalls(calls)).toHaveLength(2);
  });

  it("falha de rede: mensagem de conexão e retry", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    render(<Harness def={PHOTO_FIELD} />);
    await pickPhoto();
    await waitFor(() => expect(screen.getByTestId("foto-erro-envio").textContent).toContain("Falha de conexão ao enviar a foto"));
    expect(screen.getByRole("button", { name: /Tentar de novo/ })).toBeInTheDocument();
  });

  it("foto OPCIONAL: o erro avisa que dá para enviar a inscrição sem a foto; obrigatória: não", async () => {
    mockApi({ [FILES]: () => json(503, { code: "PHOTO_PROCESSING_UNAVAILABLE" }) });
    render(<Harness def={{ ...PHOTO_FIELD, required: false }} />);
    await pickPhoto();
    await waitFor(() => expect(screen.getByTestId("foto-erro-envio")).toBeInTheDocument());
    expect(screen.getByTestId("foto-erro-envio").textContent).toContain("Você também pode enviar a inscrição sem a foto.");
    cleanup();
    mockApi({ [FILES]: () => json(503, { code: "PHOTO_PROCESSING_UNAVAILABLE" }) });
    render(<Harness def={PHOTO_FIELD} />);
    await pickPhoto();
    await waitFor(() => expect(screen.getByTestId("foto-erro-envio")).toBeInTheDocument());
    expect(screen.getByTestId("foto-erro-envio").textContent).not.toContain("sem a foto");
  });

  it("remover depois de um erro limpa a mensagem e o retry", async () => {
    mockApi({ [FILES]: () => json(503, { code: "PHOTO_PROCESSING_UNAVAILABLE" }) });
    render(<Harness def={PHOTO_FIELD} />);
    await pickPhoto();
    await waitFor(() => expect(screen.getByTestId("foto-erro-envio")).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remover/ }));
    });
    expect(screen.queryByTestId("foto-erro-envio")).toBeNull();
    expect(screen.queryByRole("button", { name: /Tentar de novo/ })).toBeNull();
  });
});

describe("campo FILE: compressão de imagem antes do envio; PDF intocado", () => {
  const chooseProof = (file: File) =>
    act(async () => {
      const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  const bigFile = (name: string, type: string, size: number) => {
    const file = new File([new Uint8Array(8)], name, { type });
    Object.defineProperty(file, "size", { value: size });
    return file;
  };

  it("imagem de 6 MB deixa de ser recusada: vai por prepareImage (lado maior 1600, até 1 MB) e o que sobe é o WebP reduzido", async () => {
    const calls = mockApi({ [FILES]: () => json(201, { fileToken: "tok-c", originalName: "comprovante.webp", mimeType: "image/webp", sizeBytes: 1500 }) });
    render(<Harness def={FILE_FIELD} />);
    await chooseProof(bigFile("IMG_2025.jpg", "image/jpeg", 6 * 1024 * 1024));
    await waitFor(() => expect(answer()).toMatchObject({ fileToken: "tok-c" }));
    expect(prepareMock).toHaveBeenCalledTimes(1);
    expect(prepareMock.mock.calls[0]?.[1]).toEqual({ shape: "wide", maxBytes: 1024 * 1024 });
    const form = uploadCalls(calls)[0]!.body as FormData;
    const file = form.get("file") as File;
    expect(file.type).toBe("image/webp");
    expect(file.name).toBe("IMG_2025.webp");
    expect(file.size).toBe(OUT.size); // o enviado é o reduzido, não os 6 MB
    expect(form.get("fieldKey")).toBe("comp");
    expect(text()).not.toContain("maior que 5 MB");
  });

  it("PDF vai intacto (prepareImage nem é chamado) e PDF > 5 MB continua recusado sem rede", async () => {
    const calls = mockApi({ [FILES]: () => json(201, { fileToken: "tok-pdf", originalName: "recibo.pdf", mimeType: "application/pdf", sizeBytes: 100 }) });
    render(<Harness def={FILE_FIELD} />);
    const pdf = new File(["%PDF-1.4"], "recibo.pdf", { type: "application/pdf" });
    await chooseProof(pdf);
    await waitFor(() => expect(answer()).toMatchObject({ fileToken: "tok-pdf" }));
    expect(prepareMock).not.toHaveBeenCalled();
    const sent = (uploadCalls(calls)[0]!.body as FormData).get("file") as File;
    expect(sent.name).toBe("recibo.pdf");
    expect(sent.type).toBe("application/pdf");
    expect(sent.size).toBe(pdf.size);

    calls.length = 0;
    await chooseProof(bigFile("enorme.pdf", "application/pdf", 6 * 1024 * 1024));
    expect(text()).toContain("maior que 5 MB");
    expect(uploadCalls(calls)).toHaveLength(0);
  });

  it("HEIC que o navegador não abre: orienta a usar JPG/PNG ou tirar a foto, sem rede e sem retry", async () => {
    prepareMock.mockRejectedValue(new PhotoError("UNSUPPORTED_FORMAT", "x", { heic: true }));
    const calls = mockApi({});
    render(<Harness def={FILE_FIELD} />);
    await chooseProof(bigFile("IMG_0001.HEIC", "image/heic", 3 * 1024 * 1024));
    await waitFor(() => expect(text()).toContain("não abre fotos no formato HEIC"));
    expect(text()).toMatch(/JPG ou PNG/);
    expect(uploadCalls(calls)).toHaveLength(0);
    expect(buttonText(/Tentar de novo/)).toBeUndefined();
    expect(answer()).toBeNull();
  });

  it("não conseguiu reduzir uma foto JPEG pequena: manda a original (o servidor a reprocessa); grande demais: orienta e não envia", async () => {
    prepareMock.mockRejectedValue(new PhotoError("DECODE_FAILED", "x"));
    const calls = mockApi({ [FILES]: () => json(201, { fileToken: "tok-o", originalName: "a.jpg", mimeType: "image/jpeg", sizeBytes: 100 }) });
    render(<Harness def={FILE_FIELD} />);
    const small = bigFile("a.jpg", "image/jpeg", 900 * 1024);
    await chooseProof(small);
    await waitFor(() => expect(answer()).toMatchObject({ fileToken: "tok-o" }));
    expect(((uploadCalls(calls)[0]!.body as FormData).get("file") as File).name).toBe("a.jpg");

    cleanup();
    calls.length = 0;
    render(<Harness def={FILE_FIELD} />);
    await chooseProof(bigFile("grande.jpg", "image/jpeg", 8 * 1024 * 1024));
    await waitFor(() => expect(text()).toContain("Não foi possível abrir esta imagem"));
    expect(uploadCalls(calls)).toHaveLength(0);
  });

  it("imagem de mais de 25 MB: recusada antes de qualquer processamento", async () => {
    const calls = mockApi({});
    render(<Harness def={FILE_FIELD} />);
    await chooseProof(bigFile("gigante.jpg", "image/jpeg", 26 * 1024 * 1024));
    expect(text()).toContain("acima de 25 MB");
    expect(prepareMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("o texto de ajuda do FILE descreve a compressão (não promete mais 'até 5 MB' para foto)", () => {
    render(<Harness def={FILE_FIELD} />);
    expect(text()).toContain("A foto é reduzida automaticamente");
    expect(text()).toContain("o PDF pode ter até 5 MB");
  });
});

describe("formulário público inteiro com o campo PHOTO (JSON real do backend)", () => {
  const form = REAL_FORM_WITH_PHOTO as unknown as PublicForm;
  const slug = form.slug;
  const GET = `GET /public/forms/${slug}`;
  const FILES_REAL = `POST /public/forms/${slug}/files`;
  const SUBMIT = `POST /public/forms/${slug}/submissions`;

  async function openReal(extra: Record<string, (call: Call) => Response | Promise<Response>> = {}) {
    const calls = mockApi({
      [GET]: () => json(200, form),
      [FILES_REAL]: (call) => json(201, (call.body as FormData).get("fieldKey") === "foto" ? REAL_UPLOAD_PHOTO_201 : REAL_UPLOAD_FILE_201),
      [SUBMIT]: () => json(201, { protocol: "INS-ABC123", status: "CONFIRMED", paymentStatus: "NOT_REQUIRED", message: "Inscrição confirmada!", payment: null, proofRequired: false }),
      ...extra,
    });
    renderWith(<PublicRegistrationPage slug={slug} />);
    await waitForFixtures(() => expect(byTestId("inscricao-carregando")).toBeNull());
    return calls;
  }

  async function fillText() {
    await setValue(byLabelText("Nome completo"), "Rafaela Souza");
    await setValue(byLabelText("Data de nascimento"), "1995-04-12");
    await setValue(byLabelText("E-mail"), "rafaela@exemplo.com");
    await setValue(byLabelText("Categoria"), "Adulto até 70 kg");
    await click(byTestId("consentimento"));
  }

  it("sem a foto obrigatória: bloqueia o envio, mostra o erro no campo, não chama a API", async () => {
    const calls = await openReal();
    await fillText();
    await click(buttonText(/Enviar inscrição/));
    await waitForFixtures(() => expect(text()).toContain("Envie a foto para continuar."));
    expect(calls.some((call) => call.path.endsWith("/submissions"))).toBe(false);
    expect(byTestId("foto-foto")).toBeTruthy();
  });

  it("com a foto: envia a inscrição só com o fileToken da foto (e o do comprovante)", async () => {
    const calls = await openReal();
    await fillText();
    await pickPhoto();
    await waitForFixtures(() => expect(text()).toContain("Foto enviada."));
    await click(buttonText(/Enviar inscrição/));
    await waitForFixtures(() => expect(calls.some((call) => call.path.endsWith("/submissions"))).toBe(true));
    const submitted = calls.find((call) => call.path.endsWith("/submissions"))!.body as { answers: Record<string, unknown> };
    expect(submitted.answers["foto"]).toEqual({ fileToken: (REAL_UPLOAD_PHOTO_201 as { fileToken: string }).fileToken });
    expect(submitted.answers["nome"]).toBe("Rafaela Souza");
  });

  it("o servidor recusa o token da foto (expirou): a foto some do campo para a pessoa enviar outra", async () => {
    await openReal({
      [SUBMIT]: () => json(400, { statusCode: 400, error: "Bad Request", code: "VALIDATION", message: "Confira os campos destacados.", fields: { foto: "Arquivo inválido ou expirado: envie o arquivo de novo." } }),
    });
    await fillText();
    await pickPhoto();
    await waitForFixtures(() => expect(text()).toContain("Foto enviada."));
    await click(buttonText(/Enviar inscrição/));
    await waitForFixtures(() => expect(text()).toContain("Arquivo inválido ou expirado"));
    await waitForFixtures(() => expect(screen.queryByAltText("Pré-visualização da foto escolhida")).toBeNull());
    expect(text()).not.toContain("Foto enviada.");
  });

  it("layout de celular: botões do seletor com 44 px, nenhum campo de texto novo (sem zoom do iOS) e o aviso de privacidade", async () => {
    await openReal();
    for (const name of ["photo-upload", "photo-camera"]) {
      const button = byTestId(name)!;
      expect(button.className, name).toMatch(/\bh-11\b/); // 44 px
    }
    expect(byTestId("foto-foto")!.querySelector("input:not([type=file])")).toBeNull();
    expect(text()).toContain("A foto será vista só pela organização do evento.");
  });
});

// fixture sintética usada só para garantir que `makeForm` continua aceitando o novo tipo
describe("tipos", () => {
  it("PHOTO é um tipo de campo válido do formulário", () => {
    const f = makeForm({ fields: [PHOTO_FIELD] });
    expect(f.fields[0]!.type).toBe("PHOTO");
  });
});
