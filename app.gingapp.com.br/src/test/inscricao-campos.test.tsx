import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { formatCpf, formatPhone, isValidCpf, isValidPhone } from "@/lib/cpf";
import {
  buildAnswers,
  classifySubmitError,
  closedMessage,
  isRegistrationPhone,
  lookupIdentity,
  paymentStatusLabel,
  splitLinks,
  uploadErrorMessage,
  validateAnswers,
  validateField,
  validateProofFile,
  visibleFields,
  type AnswerValue,
  type Answers,
  type FormFieldDef,
} from "@/lib/inscricao";
import { FieldBlock, FormattedText } from "@/components/gingapp/inscricao-campos";
import {
  FIELDS,
  byLabelText,
  byTestId,
  buttonText,
  chooseFile,
  cleanup,
  click,
  field,
  json,
  makeForm,
  mockApi,
  pngFile,
  renderWith,
  setValue,
  text,
  waitFor,
} from "./inscricao-fixtures";

afterEach(cleanup);

const byKey = (key: string): FormFieldDef => FIELDS.find((f) => f.key === key)!;

describe("CPF e telefone (lib/cpf)", () => {
  it("valida os dígitos verificadores e recusa repetidos / tamanho errado", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("529.982.247-26")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("123")).toBe(false);
  });
  it("aplica as máscaras progressivas", () => {
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
    expect(formatCpf("5299")).toBe("529.9");
    expect(formatPhone("61999998888")).toBe("(61) 99999-8888");
    expect(formatPhone("6133334444")).toBe("(61) 3333-4444");
    expect(formatPhone("+55 61 99999-8888")).toBe("(61) 99999-8888");
    expect(isValidPhone("(61) 99999-8888")).toBe(true);
    expect(isValidPhone("99999-8888")).toBe(false);
  });
});

describe("showIf e envio só do que está visível", () => {
  const form = makeForm();
  it("campo condicional só aparece quando a resposta bate (e some ao mudar)", () => {
    expect(visibleFields(form, {}).some((f) => f.key === "resp")).toBe(false);
    expect(visibleFields(form, { menor: "Não" }).some((f) => f.key === "resp")).toBe(false);
    expect(visibleFields(form, { menor: "Sim" }).some((f) => f.key === "resp")).toBe(true);
  });
  it("MULTI_CHOICE: 'contém'; controlador oculto oculta o dependente", () => {
    const multi = {
      fields: [
        field({ key: "mod", type: "MULTI_CHOICE", options: ["A", "B"], order: 1 }),
        field({ key: "x", order: 2, required: true, showIf: { fieldKey: "mod", equals: "B" } }),
        field({ key: "y", order: 3, showIf: { fieldKey: "x", equals: "ok" } }),
      ],
    };
    expect(visibleFields(multi, { mod: ["A"] }).map((f) => f.key)).toEqual(["mod"]);
    expect(visibleFields(multi, { mod: ["A", "B"] }).map((f) => f.key)).toEqual(["mod", "x"]);
    // x oculto => y também, mesmo que a resposta antiga de x seja "ok"
    expect(visibleFields(multi, { mod: ["A"], x: "ok" }).map((f) => f.key)).toEqual(["mod"]);
    expect(visibleFields(multi, { mod: ["B"], x: "ok" }).map((f) => f.key)).toEqual(["mod", "x", "y"]);
  });
  it("campo oculto obrigatório não é validado nem enviado", () => {
    const answers: Answers = { nome: "Ana", email: "a@b.co", cpf: "529.982.247-25", cat: "Adulto", menor: "Não", resp: "Fulano antigo", ciente: true, comp: { fileToken: "t", originalName: "a.png", mimeType: "image/png", sizeBytes: 1 } };
    expect(validateAnswers(form, answers)).toEqual({});
    expect(buildAnswers(form, answers)).not.toHaveProperty("resp");
    const errors = validateAnswers(form, { ...answers, menor: "Sim", resp: "" });
    expect(errors["resp"]).toBe("Campo obrigatório.");
  });
});

describe("validação no cliente", () => {
  it("obrigatório, e-mail, CPF, telefone, número e tamanho", () => {
    expect(validateField(byKey("nome"), "")).toBe("Campo obrigatório.");
    expect(validateField(byKey("nome"), "   ")).toBe("Campo obrigatório.");
    expect(validateField(byKey("email"), "ana@")).toBe("Informe um e-mail válido.");
    expect(validateField(byKey("email"), "ana@exemplo.com")).toBeNull();
    expect(validateField(byKey("cpf"), "123.456.789-00")).toMatch(/CPF inválido/);
    expect(validateField(byKey("cpf"), "529.982.247-25")).toBeNull();
    expect(validateField(byKey("tel"), "")).toBeNull(); // opcional
    expect(validateField(byKey("tel"), "(61) 9999")).toMatch(/telefone válido/);
    expect(validateField(byKey("idade"), "5")).toMatch(/mínimo/);
    expect(validateField(byKey("idade"), "250")).toMatch(/máximo/);
    expect(validateField(byKey("idade"), "abc")).toMatch(/número válido/);
    expect(validateField(byKey("idade"), "70,5")).toBeNull();
    expect(validateField(byKey("ciente"), false)).toMatch(/aceitar/);
    expect(validateField(byKey("comp"), undefined)).toMatch(/Anexe/);
    expect(validateField(byKey("cat"), "Outra")).toMatch(/opções/);
    expect(validateField(field({ key: "t", validation: { maxLength: 3 } }), "abcd")).toMatch(/no máximo 3/);
  });
  it("confere como o SERVIDOR: telefone (DDD, celular com 9), data 1900..2100 e limite padrão de texto", () => {
    expect(isRegistrationPhone("(62) 99999-1001")).toBe(true);
    expect(isRegistrationPhone("(62) 3333-4444")).toBe(true);
    expect(isRegistrationPhone("+55 62 99999-1001")).toBe(true);
    expect(isRegistrationPhone("(62) 12345-6789")).toBe(false); // celular precisa do 9 depois do DDD
    expect(isRegistrationPhone("(02) 99999-1234")).toBe(false); // DDD não começa com 0
    expect(isRegistrationPhone("(60) 99999-1234")).toBe(false); // nem termina com 0
    expect(validateField(byKey("tel"), "(62) 12345-6789")).toMatch(/telefone válido/);
    expect(validateField(byKey("nasc"), "1850-01-01")).toBe("Informe uma data válida.");
    expect(validateField(byKey("nasc"), "2101-01-01")).toBe("Informe uma data válida.");
    expect(validateField(byKey("nasc"), "1995-04-12")).toBeNull();
    expect(validateField(field({ key: "t" }), "x".repeat(301))).toBe("Use no máximo 300 caracteres.");
    expect(validateField(field({ key: "t" }), "x".repeat(300))).toBeNull();
    expect(validateField(field({ key: "l", type: "LONG_TEXT" }), "x".repeat(5001))).toBe("Use no máximo 5000 caracteres.");
  });
  it("buildAnswers: aparar texto, número como number, consentimento true, arquivo só com fileToken, vazios fora", () => {
    const form = makeForm();
    const out = buildAnswers(form, {
      nome: "  Ana Souza ",
      email: "ana@exemplo.com",
      cpf: "529.982.247-25",
      tel: "",
      idade: "70,5",
      mod: ["Jogo", "Canto"],
      menor: "Não",
      ciente: true,
      comp: { fileToken: "tok-1", originalName: "p.png", mimeType: "image/png", sizeBytes: 10 },
    });
    expect(out).toEqual({
      nome: "Ana Souza",
      email: "ana@exemplo.com",
      cpf: "529.982.247-25",
      idade: 70.5,
      mod: ["Jogo", "Canto"],
      menor: "Não",
      ciente: true,
      comp: { fileToken: "tok-1" },
    });
  });
  it("CONSENT opcional: não bloqueia e vai como booleano explícito (false desmarcado, true marcado); oculto por showIf nem vai", () => {
    const optional = field({ key: "foto", type: "CONSENT", label: "Autorizo o uso da minha imagem", required: false, order: 20 });
    expect(validateField(optional, undefined)).toBeNull();
    expect(validateField(optional, false)).toBeNull();
    const form = makeForm({ fields: [byKey("nome"), byKey("ciente"), optional] });
    expect(buildAnswers(form, { nome: "Ana", ciente: true })).toEqual({ nome: "Ana", ciente: true, foto: false });
    expect(buildAnswers(form, { nome: "Ana", ciente: true, foto: true })).toEqual({ nome: "Ana", ciente: true, foto: true });
    expect(buildAnswers(form, { nome: "Ana", ciente: true, foto: false })).toEqual({ nome: "Ana", ciente: true, foto: false });
    // o obrigatório desmarcado continua sendo erro
    expect(validateAnswers(form, { nome: "Ana", ciente: false, foto: true })).toEqual({ ciente: "É preciso aceitar para continuar." });
    const hidden = field({ ...optional, key: "foto2", showIf: { fieldKey: "menor", equals: "Sim" } });
    expect(buildAnswers(makeForm({ fields: [byKey("menor"), hidden] }), { menor: "Não" })).toEqual({ menor: "Não" });
  });
});

describe("arquivo no cliente", () => {
  it("recusa tipo não aceito, vazio e mais de 5 MB", () => {
    expect(validateProofFile({ type: "application/zip", size: 100 })).toMatch(/Formato não aceito/);
    expect(validateProofFile({ type: "image/png", size: 0 })).toMatch(/vazio/);
    expect(validateProofFile({ type: "image/png", size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
    expect(validateProofFile({ type: "application/pdf", size: 5 * 1024 * 1024 })).toBeNull();
    expect(validateProofFile({ type: "image/webp", size: 10 })).toBeNull();
  });
});

describe("erros do servidor e mensagens", () => {
  it("classifica VALIDATION, 409, 410, 429 e rede", () => {
    const validation = classifySubmitError(new ApiError("x", 400, "VALIDATION", { code: "VALIDATION", fields: { cpf: "CPF já usado", vazio: "" } }));
    expect(validation).toMatchObject({ kind: "validation", fields: { cpf: "CPF já usado" } });
    expect(classifySubmitError(new ApiError("x", 409, "ALREADY_REGISTERED"))).toMatchObject({
      kind: "duplicate",
      message: "Já existe uma inscrição com estes dados. Consulte pelo protocolo.",
    });
    expect(classifySubmitError(new ApiError("interno", 409, "CONSENT_OUTDATED"))).toEqual({
      kind: "consent-outdated",
      message: "O termo foi atualizado. Leia e aceite novamente.",
    });
    expect(classifySubmitError(new ApiError("x", 409, "FORM_FULL"))).toMatchObject({ kind: "full" });
    expect(classifySubmitError(new ApiError("x", 410, "FORM_CLOSED", { closedReason: "DEADLINE" }))).toMatchObject({ kind: "closed", reason: "DEADLINE" });
    // formato REAL do corpo (statusCode/error/code/message/fields)
    const real = classifySubmitError(
      new ApiError("Confira os campos destacados.", 400, "VALIDATION", {
        statusCode: 400,
        error: "Bad Request",
        code: "VALIDATION",
        message: "Confira os campos destacados.",
        fields: { cpf: "Informe um CPF válido.", consent: "É preciso aceitar o termo de consentimento para enviar." },
      }),
    );
    expect(real).toMatchObject({
      kind: "validation",
      message: "Confira os campos destacados.",
      fields: { cpf: "Informe um CPF válido.", consent: "É preciso aceitar o termo de consentimento para enviar." },
    });
    // recusa geral (honeypot/tempo): `fields: {}` -> a mensagem é a do servidor
    expect(
      classifySubmitError(
        new ApiError("Não foi possível validar o envio. Recarregue a página e tente de novo.", 400, "VALIDATION", {
          code: "VALIDATION",
          message: "Não foi possível validar o envio. Recarregue a página e tente de novo.",
          fields: {},
        }),
      ),
    ).toMatchObject({ kind: "validation", fields: {}, message: "Não foi possível validar o envio. Recarregue a página e tente de novo." });
    expect(classifySubmitError(new ApiError("x", 429))).toMatchObject({ kind: "rate", message: "Muitas tentativas. Aguarde um minuto." });
    expect(classifySubmitError(new TypeError("Failed to fetch"))).toMatchObject({ kind: "network" });
    expect(classifySubmitError(new ApiError("x", 500))).toMatchObject({ kind: "other" });
  });
  it("falha do upload: tipo, tamanho, limite e formulário encerrado/lotado (410)", () => {
    expect(uploadErrorMessage(new ApiError("x", 415, "FILE_TYPE_NOT_ALLOWED"))).toMatch(/Formato não aceito/);
    expect(uploadErrorMessage(new ApiError("x", 413, "FILE_TOO_LARGE"))).toMatch(/5 MB/);
    expect(uploadErrorMessage(new ApiError("x", 429, "TOO_MANY_REQUESTS"))).toBe("Muitas tentativas. Aguarde um minuto.");
    expect(uploadErrorMessage(new ApiError("x", 410, "FORM_CLOSED", { closedReason: "FULL" }))).toBe("As vagas estão esgotadas.");
    expect(uploadErrorMessage(new ApiError("x", 410, "FORM_CLOSED"))).toBe("As inscrições estão encerradas.");
    expect(uploadErrorMessage(new ApiError("x", 500))).toMatch(/Não foi possível enviar o arquivo/);
  });
  it("mensagens de encerramento por motivo", () => {
    expect(closedMessage("NOT_OPEN_YET")).toMatch(/ainda não abriram/);
    expect(closedMessage("CLOSED")).toMatch(/encerradas/);
    expect(closedMessage("FULL")).toMatch(/esgotadas/);
    expect(closedMessage("DEADLINE")).toMatch(/prazo/);
  });
  it("rótulo de pagamento: sem cobrança (NOT_REQUIRED/NONE/ausente) não gera linha; com cobrança, sim", () => {
    for (const status of ["NOT_REQUIRED", "NONE", null, undefined, "", "DESCONHECIDO"]) expect(paymentStatusLabel(status)).toBeNull();
    expect(paymentStatusLabel("PENDING")).toBe("Pagamento pendente");
    expect(paymentStatusLabel("CONFIRMED")).toBe("Pagamento confirmado");
  });
  it("consulta: e-mail vs CPF", () => {
    expect(lookupIdentity(" ana@x.com ")).toEqual({ email: "ana@x.com" });
    expect(lookupIdentity("529.982.247-25")).toEqual({ document: "52998224725" });
  });
});

describe("texto simples seguro", () => {
  it("só http(s) vira link; pontuação final fica fora do link", () => {
    expect(splitLinks("veja https://a.com/x. e javascript:alert(1) e http://b.org, fim")).toEqual([
      { type: "text", text: "veja " },
      { type: "link", href: "https://a.com/x", text: "https://a.com/x" },
      { type: "text", text: ". e javascript:alert(1) e " },
      { type: "link", href: "http://b.org", text: "http://b.org" },
      { type: "text", text: ", fim" },
    ]);
  });
  it("não interpreta HTML: <script>/<img> viram texto; link ganha rel seguro e quebra de linha é preservada", () => {
    renderWith(<FormattedText text={'Oi <script>window.__x=1</script><img src=x onerror="window.__y=1">\nVeja https://exemplo.com/a'} />);
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    expect(text()).toContain("<script>window.__x=1</script>");
    const links = document.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("https://exemplo.com/a");
    expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(links[0]?.getAttribute("target")).toBe("_blank");
    expect(document.querySelector("p")?.className).toContain("whitespace-pre-line");
  });
});

/** Um campo isolado, com estado, para testar o controle real de cada tipo. */
function Harness({ def, initial, error }: { def: FormFieldDef; initial?: AnswerValue; error?: string }) {
  const [value, setValue_] = useState<AnswerValue | undefined>(initial);
  return (
    <>
      <FieldBlock slug="camp" field={def} value={value} error={error} onChange={(_k, v) => setValue_(v)} onBusyChange={() => {}} />
      <output data-testid="valor">{JSON.stringify(value ?? null)}</output>
    </>
  );
}
const shown = () => JSON.parse(byTestId("valor")!.textContent ?? "null");

describe("campos por tipo (teclado mobile, máscara, controle)", () => {
  it("texto curto, e-mail (type=email), telefone (type=tel + máscara), número (type=number), data nativa", async () => {
    renderWith(<Harness def={byKey("nome")} />);
    expect(byLabelText("Nome completo").type).toBe("text");
    expect(document.querySelector("[aria-required=true]")).toBeTruthy();
    expect(text()).toContain("(obrigatório)");
    cleanup();

    renderWith(<Harness def={byKey("email")} />);
    const email = byLabelText("E-mail");
    expect(email.type).toBe("email");
    expect(email.inputMode).toBe("email");
    cleanup();

    renderWith(<Harness def={byKey("tel")} />);
    const tel = byLabelText("Telefone");
    expect(tel.type).toBe("tel");
    await setValue(tel, "61999998888");
    expect(shown()).toBe("(61) 99999-8888");
    cleanup();

    renderWith(<Harness def={byKey("idade")} />);
    expect(byLabelText("Peso (kg)").type).toBe("number");
    expect(byLabelText("Peso (kg)").inputMode).toBe("decimal");
    cleanup();

    renderWith(<Harness def={byKey("nasc")} />);
    expect(byLabelText("Data de nascimento").type).toBe("date");
  });

  it("CPF: teclado numérico e máscara 000.000.000-00", async () => {
    renderWith(<Harness def={byKey("cpf")} />);
    const input = byLabelText("CPF");
    expect(input.inputMode).toBe("numeric");
    await setValue(input, "52998224725");
    expect(shown()).toBe("529.982.247-25");
  });

  it("texto longo, lista suspensa, uma opção e várias opções", async () => {
    renderWith(<Harness def={byKey("obs")} />);
    expect(byLabelText("Observações").tagName).toBe("TEXTAREA");
    cleanup();

    renderWith(<Harness def={byKey("grad")} />);
    const select = byLabelText("Graduação");
    expect(select.tagName).toBe("SELECT");
    expect([...select.options].map((o) => o.value)).toEqual(["", "Amarela", "Verde"]);
    await setValue(select, "Verde");
    expect(shown()).toBe("Verde");
    cleanup();

    renderWith(<Harness def={byKey("cat")} />);
    const radios = document.querySelectorAll<HTMLInputElement>("input[type=radio]");
    expect(radios).toHaveLength(2);
    await click(radios[1]);
    expect(shown()).toBe("Infantil");
    cleanup();

    renderWith(<Harness def={byKey("mod")} />);
    const checks = document.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
    await click(checks[0]);
    await click(checks[2]);
    expect(shown()).toEqual(["Jogo", "Percussão"]);
    await click(checks[0]);
    expect(shown()).toEqual(["Percussão"]);
  });

  it("aceite (CONSENT) vira true/false; INFO só exibe texto, sem controle", async () => {
    renderWith(<Harness def={byKey("ciente")} />);
    const box = document.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    await click(box);
    expect(shown()).toBe(true);
    cleanup();

    renderWith(<Harness def={byKey("aviso")} />);
    expect(text()).toContain("Leve documento com foto.");
    expect(document.querySelector("input,select,textarea")).toBeNull();
  });

  it("erro do campo aparece com role=alert e liga ao controle (aria-describedby / aria-invalid)", () => {
    renderWith(<Harness def={byKey("nome")} error="Campo obrigatório." />);
    const input = byLabelText("Nome completo");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const alert = document.querySelector("[role=alert]")!;
    expect(alert.textContent).toBe("Campo obrigatório.");
    expect(input.getAttribute("aria-describedby")).toContain(alert.id);
  });
});

describe("upload do comprovante", () => {
  const FILE_FIELD = byKey("comp");

  it("tipo inválido e >5 MB: mensagem amigável e nenhuma chamada de rede", async () => {
    const calls = mockApi({});
    renderWith(<Harness def={FILE_FIELD} />);
    const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
    expect(input.accept).toBe("image/*,application/pdf");
    await chooseFile(input, new File(["x"], "virus.exe", { type: "application/x-msdownload" }));
    expect(text()).toContain("Formato não aceito");
    await chooseFile(input, pngFile("grande.png", 6 * 1024 * 1024));
    expect(text()).toContain("maior que 5 MB");
    expect(calls).toHaveLength(0);
    expect(shown()).toBeNull();
  });

  it("sucesso: envia multipart (file + fieldKey) sem token, mostra o nome e guarda o fileToken; remover limpa", async () => {
    localStorage.setItem("mb_token", "TOKEN-DO-ALUNO");
    const calls = mockApi({
      "POST /public/forms/camp/files": () => json(201, { fileToken: "tok-123", originalName: "comprovante.png", mimeType: "image/png", sizeBytes: 2048 }),
    });
    renderWith(<Harness def={FILE_FIELD} />);
    expect(buttonText(/Anexar comprovante/)).toBeTruthy();
    await chooseFile(document.querySelector<HTMLInputElement>("input[type=file]")!, pngFile());
    await waitFor(() => expect(shown()).toMatchObject({ fileToken: "tok-123" }));
    expect(text()).toContain("comprovante.png");
    expect(calls).toHaveLength(1);
    const form = calls[0]!.body as FormData;
    expect(form.get("fieldKey")).toBe("comp");
    expect((form.get("file") as File).name).toBe("comprovante.png");
    expect(calls[0]!.headers["Authorization"]).toBeUndefined();
    localStorage.clear();

    await click(document.querySelector("button[aria-label='Remover arquivo']"));
    expect(shown()).toBeNull();
    expect(buttonText(/Anexar comprovante/)).toBeTruthy();
  });

  it("erro do servidor / 429 / rede: mostra o motivo e permite tentar de novo", async () => {
    let attempt = 0;
    mockApi({
      "POST /public/forms/camp/files": () => {
        attempt += 1;
        if (attempt === 1) return json(429, { message: "Too Many Requests" });
        return json(201, { fileToken: "tok-9", originalName: "comprovante.png", mimeType: "image/png", sizeBytes: 2048 });
      },
    });
    renderWith(<Harness def={FILE_FIELD} />);
    await chooseFile(document.querySelector<HTMLInputElement>("input[type=file]")!, pngFile());
    await waitFor(() => expect(text()).toContain("Muitas tentativas"));
    expect(shown()).toBeNull();
    await click(buttonText(/Tentar de novo/));
    await waitFor(() => expect(shown()).toMatchObject({ fileToken: "tok-9" }));
  });

  it("falha de rede mostra 'tentar de novo' sem perder o arquivo", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    renderWith(<Harness def={FILE_FIELD} />);
    await chooseFile(document.querySelector<HTMLInputElement>("input[type=file]")!, pngFile());
    await waitFor(() => expect(text()).toContain("Falha de conexão"));
    expect(buttonText(/Tentar de novo/)).toBeTruthy();
  });
});
