import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicRegistrationPage } from "@/components/gingapp/inscricao-publica";
import { saveSession } from "@/lib/session";
import type { PublicForm, SubmissionResult } from "@/lib/inscricao";
import {
  byLabelText,
  byTestId,
  buttonText,
  chooseFile,
  cleanup,
  click,
  field,
  FIELDS,
  flush,
  json,
  makeForm,
  mockApi,
  pngFile,
  renderWith,
  setValue,
  text,
  waitFor,
  type Call,
} from "./inscricao-fixtures";

const SLUG = "campeonato";
const GET = `GET /public/forms/${SLUG}`;
const SUBMIT = `POST /public/forms/${SLUG}/submissions`;
const FILES = `POST /public/forms/${SLUG}/files`;
const LOOKUP = `POST /public/forms/${SLUG}/lookup`;

// Valores REAIS do backend: paymentStatus = NOT_REQUIRED | PENDING | CONFIRMED.
const OK_RESULT: SubmissionResult = {
  protocol: "INS-7K3Q",
  status: "PENDING",
  paymentStatus: "PENDING",
  message: "Recebemos sua inscrição.",
  payment: { mode: "PIX_MANUAL", amountCents: 2500, pix: { key: "11122233396", keyType: "CPF", beneficiary: "Grupo Capoeira Exemplo" } },
  proofRequired: false,
};

const UPLOADED = { fileToken: "tok-777", originalName: "comprovante.png", mimeType: "image/png", sizeBytes: 2048 };

/** Rotas básicas do formulário aberto (cada teste sobrescreve o que quiser). */
const routes = (form: PublicForm = makeForm(), extra: Record<string, (call: Call) => Response | Promise<Response>> = {}) => ({
  [GET]: () => json(200, form),
  [FILES]: () => json(201, UPLOADED),
  [SUBMIT]: () => json(201, OK_RESULT),
  ...extra,
});

const open = async (form?: PublicForm, extra?: Record<string, (call: Call) => Response | Promise<Response>>) => {
  const calls = mockApi(routes(form, extra));
  renderWith(<PublicRegistrationPage slug={SLUG} />);
  await waitFor(() => expect(byTestId("inscricao-carregando")).toBeNull());
  return calls;
};

/** Preenche tudo o que é obrigatório, com dados válidos. */
async function fillValid() {
  await setValue(byLabelText("Nome completo"), "  Ana Souza ");
  await setValue(byLabelText("E-mail"), "ana@exemplo.com");
  await setValue(byLabelText("CPF"), "52998224725");
  await click([...document.querySelectorAll<HTMLInputElement>("input[type=radio]")].find((r) => r.value === "Adulto"));
  await click(document.querySelector("input[id='campo-ciente']"));
  await chooseFile(document.querySelector<HTMLInputElement>("input[type=file]")!, pngFile());
  await waitFor(() => expect(text()).toContain("comprovante.png"));
  await click(byTestId("consentimento"));
}
const submit = () => click(buttonText(/Enviar inscrição/));

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
});
afterEach(cleanup);

describe("página pública de inscrição: carregamento e estados", () => {
  it("mostra skeleton enquanto carrega", () => {
    mockApi({ [GET]: () => new Promise<Response>(() => {}) as unknown as Response });
    renderWith(<PublicRegistrationPage slug={SLUG} />);
    expect(byTestId("inscricao-carregando")).toBeTruthy();
  });

  it("404 mostra a mensagem neutra e nenhum formulário", async () => {
    mockApi({ [GET]: () => json(404, { message: "Form 'x' inexistente no grupo Y" }) });
    renderWith(<PublicRegistrationPage slug={SLUG} />);
    await waitFor(() => expect(text()).toContain("Formulário não encontrado ou indisponível."));
    expect(document.querySelector("form")).toBeNull();
    expect(text()).not.toContain("inexistente no grupo");
  });

  it("falha de rede ao carregar oferece tentar de novo", async () => {
    let fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => (fail ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve(json(200, makeForm())))),
    );
    renderWith(<PublicRegistrationPage slug={SLUG} />);
    await waitFor(() => expect(text()).toContain("Não foi possível carregar o formulário"));
    fail = false;
    await click(buttonText(/Tentar de novo/));
    await waitFor(() => expect(document.querySelector("form")).toBeTruthy());
  });

  it.each([
    ["NOT_OPEN_YET", /ainda não abriram/],
    ["CLOSED", /encerradas/],
    ["FULL", /esgotadas/],
    ["DEADLINE", /prazo de inscrição terminou/],
  ] as const)("formulário fechado (%s): mostra o motivo e o título do evento, sem formulário", async (reason, message) => {
    mockApi({ [GET]: () => json(200, makeForm({ isOpen: false, closedReason: reason })) });
    renderWith(<PublicRegistrationPage slug={SLUG} />);
    await waitFor(() => expect(byTestId("inscricao-encerrada")).toBeTruthy());
    expect(byTestId("inscricao-encerrada")!.textContent).toMatch(message);
    expect(text()).toContain("Campeonato do Varjão");
    expect(document.querySelector("form")).toBeNull();
    expect(buttonText(/Enviar inscrição/)).toBeUndefined();
    expect(buttonText(/Consultar minha inscrição/)).toBeTruthy();
  });
});

describe("página pública de inscrição: cabeçalho e campos", () => {
  it("mostra título, evento (data e local), vagas, valor, seções e o título da aba", async () => {
    await open();
    expect(document.querySelector("h1")?.textContent).toBe("1º Campeonato de Capoeira");
    expect(document.title).toBe("1º Campeonato de Capoeira");
    const evento = byTestId("inscricao-evento")!.textContent!;
    expect(evento).toContain("Campeonato do Varjão");
    expect(evento).toContain("20/11/2026");
    expect(evento).toContain("Ginásio do Varjão, DF");
    expect(evento).toContain("R$");
    expect(byTestId("inscricao-vagas")!.textContent).toBe("Restam 12 vagas");
    expect([...document.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(
      expect.arrayContaining(["Dados do competidor", "Responsável e termo", "Pagamento", "Termo e privacidade"]),
    );
    expect(byTestId("inscricao-banner-padrao")).toBeTruthy(); // sem bannerUrl: fallback com o logo
  });

  it("introdução: links viram <a> seguros, nada de HTML bruto", async () => {
    await open(makeForm({ intro: 'Oi <b>negrito</b> <script>window.__x=1</script>\nRegras: https://exemplo.com/regras.' }));
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
    expect(text()).toContain("<b>negrito</b>");
    const link = [...document.querySelectorAll("a")].find((a) => a.getAttribute("href") === "https://exemplo.com/regras");
    expect(link).toBeTruthy();
    expect(link!.getAttribute("rel")).toBe("noopener noreferrer nofollow");
  });

  it("banner com URL http(s) usa <img>; URL perigosa cai no fallback", async () => {
    await open(makeForm({ bannerUrl: "https://cdn.exemplo.com/banner.jpg" }));
    expect(byTestId("inscricao-banner")?.getAttribute("src")).toBe("https://cdn.exemplo.com/banner.jpg");
    cleanup();
    await open(makeForm({ bannerUrl: "javascript:alert(1)" }));
    expect(byTestId("inscricao-banner")).toBeNull();
    expect(byTestId("inscricao-banner-padrao")).toBeTruthy();
  });

  it("showIf: campo do responsável aparece só com 'Sim' e some de novo", async () => {
    await open();
    expect(text()).not.toContain("Nome do responsável");
    const sim = () => [...document.querySelectorAll<HTMLInputElement>("input[type=radio]")].find((r) => r.value === "Sim");
    const nao = () => [...document.querySelectorAll<HTMLInputElement>("input[type=radio]")].find((r) => r.value === "Não");
    await click(sim());
    expect(text()).toContain("Nome do responsável");
    await click(nao());
    expect(text()).not.toContain("Nome do responsável");
  });

  it("honeypot: presente, fora da tela (não display:none), sem foco por Tab e vazio", async () => {
    await open();
    const hp = byTestId("hp") as HTMLInputElement;
    expect(hp).toBeTruthy();
    expect(hp.value).toBe("");
    expect(hp.tabIndex).toBe(-1);
    expect(hp.autocomplete).toBe("off");
    const holder = hp.closest("[aria-hidden=true]") as HTMLElement;
    expect(holder).toBeTruthy();
    expect(holder.style.position).toBe("absolute");
    expect(holder.style.left).toBe("-10000px");
    expect(holder.style.display).not.toBe("none");
  });
});

describe("página pública de inscrição: validação no cliente", () => {
  it("enviar vazio mostra os erros por campo, foca o primeiro e não chama a API", async () => {
    const calls = await open();
    await submit();
    await flush();
    await flush();
    expect(text()).toContain("Campo obrigatório.");
    expect(text()).toContain("Para se inscrever é preciso aceitar o termo.");
    expect(text()).toContain("Anexe o arquivo para continuar.");
    expect(byTestId("inscricao-aviso")!.textContent).toContain("Confira os campos destacados.");
    expect(document.activeElement).toBe(byLabelText("Nome completo"));
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("e-mail e CPF inválidos geram mensagem própria e o erro some ao corrigir", async () => {
    await open();
    await setValue(byLabelText("Nome completo"), "Ana");
    await setValue(byLabelText("E-mail"), "ana@");
    await setValue(byLabelText("CPF"), "11111111111");
    await submit();
    expect(text()).toContain("Informe um e-mail válido.");
    expect(text()).toContain("CPF inválido");
    await setValue(byLabelText("E-mail"), "ana@exemplo.com");
    expect(text()).not.toContain("Informe um e-mail válido.");
  });
});

describe("página pública de inscrição: envio", () => {
  it("fluxo feliz: payload correto (answers por key, consent, consentVersion, hp vazio, startedToken do GET) e tela de sucesso", async () => {
    const calls = await open();
    await fillValid();
    await submit();
    await waitFor(() => expect(byTestId("inscricao-sucesso")).toBeTruthy());

    const post = calls.find((c) => c.path === `/public/forms/${SLUG}/submissions`)!;
    expect(post.method).toBe("POST");
    const body = post.body as Record<string, unknown> & { answers: Record<string, unknown> };
    expect(body.answers).toEqual({
      nome: "Ana Souza",
      email: "ana@exemplo.com",
      cpf: "529.982.247-25",
      cat: "Adulto",
      ciente: true,
      comp: { fileToken: "tok-777" },
    });
    expect(body["consent"]).toBe(true);
    expect(body["consentVersion"]).toBe(1); // a `consent.version` que estava na tela
    expect(body["hp"]).toBe("");
    expect(body["startedToken"]).toBe(makeForm().startedToken); // exatamente o token assinado do GET
    expect(body).not.toHaveProperty("startedAt"); // o legado não é mais enviado
    expect(post.headers["Authorization"]).toBeUndefined();

    expect(byTestId("inscricao-protocolo")!.textContent).toBe("INS-7K3Q");
    expect(byTestId("inscricao-status")!.textContent).toBe("Recebida, aguardando análise");
    expect(text()).toContain("Recebemos sua inscrição.");
    expect(text()).toContain("Ana Souza");
    expect(byTestId("inscricao-lembrete-comprovante")!.textContent).toMatch(/Guarde o comprovante/);
    expect(buttonText(/imprimir comprovante/)).toBeTruthy();
    expect(buttonText(/Consultar minha inscrição/)).toBeTruthy();
  });

  it("campos ocultos por showIf não são enviados (mesmo digitados antes de ocultar)", async () => {
    const calls = await open();
    await fillValid();
    const radio = (v: string) => [...document.querySelectorAll<HTMLInputElement>("input[type=radio]")].find((r) => r.value === v);
    await click(radio("Sim"));
    await setValue(byLabelText("Nome do responsável"), "Fulano");
    await click(radio("Não"));
    await submit();
    await waitFor(() => expect(byTestId("inscricao-sucesso")).toBeTruthy());
    const body = calls.find((c) => c.path.endsWith("/submissions"))!.body as { answers: Record<string, unknown> };
    expect(body.answers).not.toHaveProperty("resp");
    expect(body.answers["menor"]).toBe("Não");
  });

  it("duplo toque envia uma única vez e o botão fica desabilitado enquanto envia", async () => {
    let release!: (r: Response) => void;
    const calls = await open(undefined, { [SUBMIT]: () => new Promise<Response>((r) => (release = r)) as unknown as Response });
    await fillValid();
    const button = buttonText(/Enviar inscrição/) as HTMLButtonElement;
    await click(button);
    await click(button);
    expect(calls.filter((c) => c.path.endsWith("/submissions"))).toHaveLength(1);
    expect((buttonText(/Enviando/) as HTMLButtonElement).disabled).toBe(true);
    release(json(201, OK_RESULT));
    await waitFor(() => expect(byTestId("inscricao-sucesso")).toBeTruthy());
    expect(calls.filter((c) => c.path.endsWith("/submissions"))).toHaveLength(1);
  });

  it("botão de enviar fica bloqueado enquanto o comprovante ainda está subindo", async () => {
    let release!: (r: Response) => void;
    await open(undefined, { [FILES]: () => new Promise<Response>((r) => (release = r)) as unknown as Response });
    await chooseFile(document.querySelector<HTMLInputElement>("input[type=file]")!, pngFile());
    expect((buttonText(/Enviar inscrição/) as HTMLButtonElement).disabled).toBe(true);
    expect(text()).toContain("Aguarde o envio do arquivo terminar.");
    release(json(201, UPLOADED));
    await waitFor(() => expect((buttonText(/Enviar inscrição/) as HTMLButtonElement).disabled).toBe(false));
  });

  it("VALIDATION do servidor vira erro no campo certo, foca o primeiro e mantém os dados", async () => {
    await open(undefined, {
      [SUBMIT]: () =>
        json(400, {
          statusCode: 400,
          error: "Bad Request",
          code: "VALIDATION",
          message: "Confira os campos destacados.",
          fields: { cpf: "Este CPF não pode ser usado.", email: "E-mail em uso." },
        }),
    });
    await fillValid();
    await submit();
    await waitFor(() => expect(text()).toContain("Este CPF não pode ser usado."));
    expect(text()).toContain("E-mail em uso.");
    expect(document.activeElement).toBe(byLabelText("E-mail")); // primeiro na ordem de exibição
    expect(byLabelText("Nome completo").value).toBe("  Ana Souza ");
    expect(byTestId("inscricao-sucesso")).toBeNull();
    // pode corrigir e reenviar
    expect((buttonText(/Enviar inscrição/) as HTMLButtonElement).disabled).toBe(false);
  });

  it("VALIDATION sem campos (honeypot/tempo de preenchimento) mostra a mensagem do servidor; o termo (consent) vai ao aviso", async () => {
    let mode: "spam" | "consent" = "spam";
    await open(undefined, {
      [SUBMIT]: () =>
        mode === "spam"
          ? json(400, {
              statusCode: 400,
              error: "Bad Request",
              code: "VALIDATION",
              message: "Não foi possível validar o envio. Recarregue a página e tente de novo.",
              fields: {},
            })
          : json(400, {
              statusCode: 400,
              error: "Bad Request",
              code: "VALIDATION",
              message: "Confira os campos destacados.",
              fields: { consent: "É preciso aceitar o termo de consentimento para enviar." },
            }),
    });
    await fillValid();
    await submit();
    await waitFor(() => expect(byTestId("inscricao-aviso")!.textContent).toBe("Não foi possível validar o envio. Recarregue a página e tente de novo."));
    mode = "consent";
    await submit();
    await waitFor(() => expect(byTestId("inscricao-aviso")!.textContent).toContain("É preciso aceitar o termo de consentimento para enviar."));
  });

  it("arquivo recusado pelo servidor (token expirado) tira o anexo para a pessoa enviar de novo", async () => {
    await open(undefined, {
      [SUBMIT]: () =>
        json(400, {
          statusCode: 400,
          error: "Bad Request",
          code: "VALIDATION",
          message: "Confira os campos destacados.",
          fields: { comp: "Arquivo inválido ou expirado: envie o arquivo de novo." },
        }),
    });
    await fillValid();
    expect(text()).toContain("comprovante.png");
    await submit();
    await waitFor(() => expect(text()).toContain("Arquivo inválido ou expirado: envie o arquivo de novo."));
    expect(byTestId("arquivo-comp")!.textContent).not.toContain("enviado"); // sem miniatura/“enviado”: volta ao botão de anexar
    expect(buttonText(/Anexar comprovante/)).toBeTruthy();
  });

  it("409 CONSENT_OUTDATED: recarrega o formulário, avisa, desmarca o aceite, mantém o que foi digitado e reenvia com a versão e o token novos", async () => {
    const v2 = makeForm({
      consent: { text: "Termo NOVO, versão dois.", version: 2 },
      startedToken: "1760000999999.novo-token",
    });
    let served = makeForm();
    const submissions: Record<string, unknown>[] = [];
    const calls = await open(undefined, {
      [GET]: () => json(200, served),
      [SUBMIT]: (call) => {
        const body = call.body as Record<string, unknown>;
        submissions.push(body);
        return body["consentVersion"] === 2
          ? json(201, OK_RESULT)
          : (served = v2) && json(409, { statusCode: 409, error: "Conflict", code: "CONSENT_OUTDATED", message: "interno" });
      },
    });
    await fillValid();
    await submit();
    await waitFor(() => expect(byTestId("inscricao-aviso")!.textContent).toBe("O termo foi atualizado. Leia e aceite novamente."));
    // o GET foi refeito e o termo novo está na tela
    await waitFor(() => expect(text()).toContain("Termo NOVO, versão dois."));
    expect(calls.filter((c) => c.method === "GET" && c.path === `/public/forms/${SLUG}`)).toHaveLength(2);
    // o aceite foi desmarcado, mas nada do que foi digitado se perdeu
    expect((byTestId("consentimento") as HTMLInputElement).checked).toBe(false);
    expect(text()).toContain("O termo foi atualizado. Leia e aceite novamente.");
    expect(byLabelText("Nome completo").value).toBe("  Ana Souza ");
    expect(byLabelText("E-mail").value).toBe("ana@exemplo.com");
    expect(text()).toContain("comprovante.png");
    expect(byTestId("inscricao-sucesso")).toBeNull();

    // sem aceitar de novo não envia
    await submit();
    expect(submissions).toHaveLength(1);
    expect(text()).toContain("Para se inscrever é preciso aceitar o termo.");

    await click(byTestId("consentimento"));
    await submit();
    await waitFor(() => expect(byTestId("inscricao-sucesso")).toBeTruthy());
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toMatchObject({ consentVersion: 2, startedToken: "1760000999999.novo-token" });
    expect(submissions[0]).toMatchObject({ consentVersion: 1, startedToken: makeForm().startedToken });
  });

  describe("aceite (CONSENT) opcional", () => {
    const withOptionalConsent = () =>
      makeForm({
        fields: [
          ...FIELDS,
          field({ key: "foto", type: "CONSENT", label: "Autorizo o uso da minha imagem", required: false, sectionId: 2, order: 16 }),
        ],
      });
    const answersOf = (calls: Call[]) => (calls.find((c) => c.path.endsWith("/submissions"))!.body as { answers: Record<string, unknown> }).answers;

    it("desmarcado não bloqueia o envio e vai como false (booleano explícito)", async () => {
      const calls = await open(withOptionalConsent());
      expect(text()).toContain("Autorizo o uso da minha imagem");
      await fillValid();
      await submit();
      await waitFor(() => expect(byTestId("inscricao-sucesso")).toBeTruthy());
      expect(answersOf(calls)["foto"]).toBe(false);
      expect(answersOf(calls)["ciente"]).toBe(true); // o obrigatório continua true
    });

    it("marcado vai como true", async () => {
      const calls = await open(withOptionalConsent());
      await fillValid();
      await click(document.querySelector("input[id='campo-foto']"));
      await submit();
      await waitFor(() => expect(byTestId("inscricao-sucesso")).toBeTruthy());
      expect(answersOf(calls)["foto"]).toBe(true);
    });

    it("o obrigatório desmarcado continua bloqueando, mesmo com o opcional marcado", async () => {
      const calls = await open(withOptionalConsent());
      await fillValid();
      await click(document.querySelector("input[id='campo-ciente']")); // desmarca o obrigatório
      await submit();
      expect(text()).toContain("É preciso aceitar para continuar.");
      expect(calls.filter((c) => c.path.endsWith("/submissions"))).toHaveLength(0);
    });

    it("CONSENT oculto por showIf não é enviado", async () => {
      const form = makeForm({
        fields: [
          ...FIELDS,
          field({ key: "foto", type: "CONSENT", label: "Autorizo o uso da minha imagem", sectionId: 2, order: 16, showIf: { fieldKey: "menor", equals: "Sim" } }),
        ],
      });
      const calls = await open(form);
      await fillValid();
      await submit();
      await waitFor(() => expect(byTestId("inscricao-sucesso")).toBeTruthy());
      expect(answersOf(calls)).not.toHaveProperty("foto");
    });
  });

  it("409 ALREADY_REGISTERED, 429 e falha de rede: mensagens certas e dados mantidos", async () => {
    let mode: "dup" | "rate" | "net" | "ok" = "dup";
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit = {}) => {
        const path = url.replace(/^https?:\/\/[^/]+\/api/, "");
        if (path.endsWith("/submissions")) {
          if (mode === "net") return Promise.reject(new TypeError("Failed to fetch"));
          if (mode === "dup") return Promise.resolve(json(409, { statusCode: 409, error: "Conflict", code: "ALREADY_REGISTERED", message: "interno" }));
          if (mode === "rate") return Promise.resolve(json(429, { statusCode: 429, error: "Too Many Requests", code: "TOO_MANY_REQUESTS", message: "Muitas tentativas. Aguarde um minuto e tente de novo." }));
          return Promise.resolve(json(201, OK_RESULT));
        }
        if (path.endsWith("/files")) return Promise.resolve(json(201, UPLOADED));
        void init;
        return Promise.resolve(json(200, makeForm()));
      }),
    );
    renderWith(<PublicRegistrationPage slug={SLUG} />);
    await waitFor(() => expect(document.querySelector("form")).toBeTruthy());
    await fillValid();

    await submit();
    await waitFor(() => expect(byTestId("inscricao-aviso")!.textContent).toBe("Já existe uma inscrição com estes dados. Consulte pelo protocolo."));
    mode = "rate";
    await submit();
    await waitFor(() => expect(byTestId("inscricao-aviso")!.textContent).toBe("Muitas tentativas. Aguarde um minuto."));
    mode = "net";
    await submit();
    await waitFor(() => expect(byTestId("inscricao-aviso")!.textContent).toMatch(/Sem conexão/));
    expect(byLabelText("E-mail").value).toBe("ana@exemplo.com");
    mode = "ok";
    await submit();
    await waitFor(() => expect(byTestId("inscricao-sucesso")).toBeTruthy());
  });

  it("410 FORM_CLOSED e 409 FORM_FULL levam à tela de encerrado com o motivo", async () => {
    await open(undefined, {
      [SUBMIT]: () => json(410, { statusCode: 410, error: "Gone", code: "FORM_CLOSED", closedReason: "DEADLINE", message: "O prazo de inscrição terminou." }),
    });
    await fillValid();
    await submit();
    await waitFor(() => expect(byTestId("inscricao-encerrada")!.textContent).toMatch(/prazo de inscrição terminou/));
    expect(document.querySelector("form")).toBeNull();
    cleanup();

    await open(undefined, {
      [SUBMIT]: () => json(409, { statusCode: 409, error: "Conflict", code: "FORM_FULL", message: "As vagas estão esgotadas." }),
    });
    await fillValid();
    await submit();
    await waitFor(() => expect(byTestId("inscricao-encerrada")!.textContent).toMatch(/esgotadas/));
  });
});

describe("página pública de inscrição: Pix manual", () => {
  it("mostra valor, chave com tipo, favorecido e copia a chave", async () => {
    await open();
    const bloco = byTestId("inscricao-pagamento")!;
    expect(bloco).toBeTruthy();
    expect(byTestId("inscricao-valor")!.textContent).toMatch(/25,00/);
    expect(byTestId("inscricao-chave-pix")!.textContent).toBe("11122233396");
    expect(bloco.textContent).toContain("CPF");
    expect(bloco.textContent).toContain("Grupo Capoeira Exemplo");
    expect(bloco.textContent).toMatch(/anexe o comprovante/);
    // o bloco fica logo acima do campo de comprovante
    const fileField = byTestId("arquivo-comp")!;
    expect(bloco.compareDocumentPosition(fileField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await click(buttonText(/Copiar chave Pix/));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("11122233396");
    expect(text()).toContain("Chave Pix copiada!");
  });

  it("sem pagamento (NONE) não mostra o bloco; PIX_AUTO é tratado como sem Pix, com aviso discreto", async () => {
    await open(makeForm({ paymentMode: "NONE", priceCents: null, pix: null })); // gratuito = null no backend real
    expect(byTestId("inscricao-pagamento")).toBeNull();
    expect(byTestId("inscricao-pix-auto")).toBeNull();
    cleanup();
    await open(makeForm({ paymentMode: "PIX_AUTO", priceCents: 2500, pix: null }));
    expect(byTestId("inscricao-pagamento")).toBeNull();
    expect(byTestId("inscricao-pix-auto")).toBeTruthy();
  });

  it("sem fallback de clipboard disponível, avisa para copiar manualmente", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("negado")) }, configurable: true });
    await open();
    await click(buttonText(/Copiar chave Pix/));
    expect(text()).toContain("copie manualmente");
    expect(text()).not.toContain("Chave Pix copiada!");
  });

  it("sucesso com proofRequired avisa que falta o comprovante; copia o protocolo", async () => {
    await open(undefined, { [SUBMIT]: () => json(201, { ...OK_RESULT, proofRequired: true }) });
    await fillValid();
    await submit();
    await waitFor(() => expect(byTestId("inscricao-sucesso")).toBeTruthy());
    expect(byTestId("inscricao-lembrete-comprovante")!.textContent).toMatch(/ainda não foi recebido/);
    await click(buttonText(/Copiar protocolo/));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("INS-7K3Q");
  });

  it("imprimir chama window.print", async () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    await open();
    await fillValid();
    await submit();
    await waitFor(() => expect(byTestId("inscricao-sucesso")).toBeTruthy());
    await click(buttonText(/imprimir comprovante/));
    expect(print).toHaveBeenCalledTimes(1);
  });
});

describe("página pública de inscrição: consulta por protocolo", () => {
  it("abre pela tela inicial ?consultar=1, consulta com protocolo + e-mail e mostra a situação", async () => {
    const calls = mockApi(
      routes(makeForm(), {
        [LOOKUP]: () => json(200, { protocol: "INS-7K3Q", status: "CONFIRMED", paymentStatus: "CONFIRMED", message: "Nos vemos no evento!" }),
      }),
    );
    renderWith(<PublicRegistrationPage slug={SLUG} initialView="consult" />);
    await waitFor(() => expect(byTestId("inscricao-consulta")).toBeTruthy());
    await setValue(byLabelText("Protocolo"), "ins-7k3q");
    await setValue(byLabelText("E-mail ou CPF"), "ana@exemplo.com");
    await click(buttonText(/^\s*Consultar\s*$/));
    await waitFor(() => expect(byTestId("inscricao-consulta-resultado")).toBeTruthy());
    const resultado = byTestId("inscricao-consulta-resultado")!.textContent!;
    expect(resultado).toContain("Confirmada");
    expect(resultado).toContain("Pagamento confirmado");
    expect(resultado).toContain("Nos vemos no evento!");
    const post = calls.find((c) => c.path.endsWith("/lookup"))!;
    expect(post.body).toEqual({ protocol: "INS-7K3Q", email: "ana@exemplo.com" });
    expect(post.headers["Authorization"]).toBeUndefined();
  });

  it("inscrição recusada/cancelada não mostra 'Pagamento pendente' (o servidor ainda manda paymentStatus PENDING nela)", async () => {
    mockApi(
      routes(makeForm(), {
        [LOOKUP]: () =>
          json(200, { protocol: "INS-7K3Q", status: "REJECTED", paymentStatus: "PENDING", message: "A inscrição não foi aceita pelo organizador." }),
      }),
    );
    renderWith(<PublicRegistrationPage slug={SLUG} initialView="consult" />);
    await waitFor(() => expect(byTestId("inscricao-consulta")).toBeTruthy());
    await setValue(byLabelText("Protocolo"), "INS-7K3Q");
    await setValue(byLabelText("E-mail ou CPF"), "ana@exemplo.com");
    await click(buttonText(/^\s*Consultar\s*$/));
    await waitFor(() => expect(byTestId("inscricao-consulta-resultado")).toBeTruthy());
    const resultado = byTestId("inscricao-consulta-resultado")!.textContent!;
    expect(resultado).toContain("Não aprovada");
    expect(resultado).not.toContain("Pagamento pendente");
  });

  it.each([["NOT_REQUIRED"], [null], [undefined]])(
    "paymentStatus %s (sem cobrança) não mostra linha de pagamento na consulta",
    async (paymentStatus) => {
      mockApi(
        routes(makeForm(), {
          [LOOKUP]: () => json(200, { protocol: "INS-7K3Q", status: "PENDING", paymentStatus, message: null }),
        }),
      );
      renderWith(<PublicRegistrationPage slug={SLUG} initialView="consult" />);
      await waitFor(() => expect(byTestId("inscricao-consulta")).toBeTruthy());
      await setValue(byLabelText("Protocolo"), "INS-7K3Q");
      await setValue(byLabelText("E-mail ou CPF"), "ana@exemplo.com");
      await click(buttonText(/^\s*Consultar\s*$/));
      await waitFor(() => expect(byTestId("inscricao-consulta-resultado")).toBeTruthy());
      const resultado = byTestId("inscricao-consulta-resultado")!.textContent!;
      expect(resultado).toContain("Recebida, aguardando análise");
      expect(resultado).not.toMatch(/pagamento/i);
    },
  );

  it("sucesso com paymentStatus NOT_REQUIRED (inscrição gratuita) não mostra a linha 'Pagamento'", async () => {
    await open(makeForm({ paymentMode: "NONE", priceCents: null, pix: null }), {
      [SUBMIT]: () => json(201, { ...OK_RESULT, paymentStatus: "NOT_REQUIRED", payment: null }),
    });
    await fillValid();
    await submit();
    await waitFor(() => expect(byTestId("inscricao-sucesso")).toBeTruthy());
    const resumo = byTestId("inscricao-sucesso")!.querySelector("dl")!.textContent!;
    expect(resumo).toContain("Situação");
    expect(resumo).not.toMatch(/pagamento/i);
  });

  it("por CPF envia só os dígitos como 'document'; erro 404 vira resposta genérica; CPF inválido nem chama a API", async () => {
    const calls = mockApi(
      routes(makeForm(), {
        [LOOKUP]: () => json(404, { statusCode: 404, error: "Not Found", code: "NOT_FOUND", message: "Inscrição 99 não existe no grupo X" }),
      }),
    );
    renderWith(<PublicRegistrationPage slug={SLUG} initialView="consult" />);
    await waitFor(() => expect(byTestId("inscricao-consulta")).toBeTruthy());
    await setValue(byLabelText("Protocolo"), "INS-0000");
    await setValue(byLabelText("E-mail ou CPF"), "111.111.111-11");
    await click(buttonText(/^\s*Consultar\s*$/));
    expect(text()).toContain("Informe um e-mail válido ou um CPF válido.");
    expect(calls.filter((c) => c.path.endsWith("/lookup"))).toHaveLength(0);

    await setValue(byLabelText("E-mail ou CPF"), "529.982.247-25");
    await click(buttonText(/^\s*Consultar\s*$/));
    await waitFor(() => expect(text()).toContain("Não encontramos uma inscrição com estes dados."));
    expect(text()).not.toContain("não existe no grupo X");
    expect(calls.find((c) => c.path.endsWith("/lookup"))!.body).toEqual({ protocol: "INS-0000", document: "52998224725" });
  });

  it("depois do sucesso, 'Consultar minha inscrição' abre a consulta já com o protocolo e avisa a rota", async () => {
    mockApi(routes());
    const onViewChange = vi.fn();
    renderWith(<PublicRegistrationPage slug={SLUG} onViewChange={onViewChange} />);
    await waitFor(() => expect(document.querySelector("form")).toBeTruthy());
    await fillValid();
    await submit();
    await waitFor(() => expect(byTestId("inscricao-sucesso")).toBeTruthy());
    await click(buttonText(/Consultar minha inscrição/));
    expect(onViewChange).toHaveBeenCalledWith("consult");
    expect((byLabelText("Protocolo") as HTMLInputElement).value).toBe("INS-7K3Q");
  });
});

describe("página pública de inscrição: visitante x logado", () => {
  it("visitante só chama /public/forms: nenhuma chamada autenticada (students/people/finance...) e sem Authorization", async () => {
    const calls = await open();
    await fillValid();
    await submit();
    await waitFor(() => expect(byTestId("inscricao-sucesso")).toBeTruthy());
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.path.startsWith("/public/forms/")).toBe(true);
      expect(call.headers["Authorization"]).toBeUndefined();
    }
  });

  it("logado: pré-preenche pelos mapsTo (nome, e-mail, nascimento) sem sobrescrever o digitado; chamadas públicas seguem sem token", async () => {
    saveSession("TOKEN-DO-ALUNO", {
      id: 7, name: "Ana da Conta", email: "ana@conta.com", userType: "MEMBER", isSuperAdmin: false,
      organizationId: 1, organizationSlug: "g", role: "ALUNO",
    });
    const calls = mockApi(
      routes(makeForm(), {
        "GET /people/me/ficha": () =>
          json(200, { person: { id: 1, gingappCode: "G-1", name: "Ana Souza Ficha", nickname: "Aninha", birthDate: "2001-04-05T00:00:00.000Z", photo: null, documentMasked: "***", documentKind: "CPF" } }),
      }),
    );
    renderWith(<PublicRegistrationPage slug={SLUG} />);
    await waitFor(() => expect(byLabelText("Nome completo").value).toBe("Ana Souza Ficha"));
    expect(byLabelText("E-mail").value).toBe("ana@conta.com");
    expect(byLabelText("Data de nascimento").value).toBe("2001-04-05");
    expect(byLabelText("CPF").value).toBe(""); // a ficha só tem o CPF mascarado: nunca preenche
    const ficha = calls.find((c) => c.path === "/people/me/ficha");
    expect(ficha).toBeTruthy();
    for (const call of calls.filter((c) => c.path.startsWith("/public/forms/"))) {
      expect(call.headers["Authorization"]).toBeUndefined();
    }
  });

  it("logado com token vencido (401 na ficha): a página continua e NÃO redireciona nem apaga a sessão", async () => {
    saveSession("TOKEN-VENCIDO", {
      id: 7, name: "Ana da Conta", email: "ana@conta.com", userType: "MEMBER", isSuperAdmin: false,
      organizationId: 1, organizationSlug: "g", role: "ALUNO",
    });
    mockApi(routes(makeForm(), { "GET /people/me/ficha": () => json(401, { message: "Unauthorized" }) }));
    renderWith(<PublicRegistrationPage slug={SLUG} />);
    await waitFor(() => expect(byLabelText("E-mail").value).toBe("ana@conta.com"));
    expect(localStorage.getItem("mb_token")).toBe("TOKEN-VENCIDO");
    expect(document.querySelector("form")).toBeTruthy();
  });
});
