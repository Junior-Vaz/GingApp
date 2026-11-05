import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import {
  SPONSOR_CATEGORIES,
  SPONSOR_IMAGE_MAX_BYTES,
  activateBlockReason,
  campaignPayload,
  campaignToForm,
  centsToReaisText,
  checkDestinationUrl,
  contentChanged,
  defaultReportRange,
  emptyCampaignForm,
  fillDays,
  formatInstant,
  isoToLocal,
  localToIso,
  reaisToCents,
  reportCsvFilename,
  serverFieldErrors,
  sponsorPayload,
  validateCampaignForm,
  validateDestinationUrl,
  validateSponsorForm,
  validateSponsorImageFile,
  type CampaignFormState,
  type GroupCampaign,
} from "@/modules/patrocinadores/sponsor-utils";

const validForm = (): CampaignFormState => ({
  ...emptyCampaignForm(),
  sponsorId: "3",
  title: "Berimbau com 20% de desconto",
  text: "Instrumentos artesanais para a sua roda.",
  ctaLabel: "Conhecer",
  destinationUrl: "https://www.loja.com.br/promo?x=1",
  category: "INSTRUMENTOS",
  startsAt: "2026-11-10T08:00",
  endsAt: "2026-12-10T08:00",
});

describe("validação ao vivo da URL de destino", () => {
  it("aceita https público por nome (com caminho e parâmetros)", () => {
    expect(checkDestinationUrl("https://www.loja.com.br/pagina?a=1#x")).toEqual({ error: null, warning: null });
    expect(validateDestinationUrl("  https://loja.com.br  ")).toBeNull();
  });

  it.each([
    ["", /Informe o endereço/],
    ["www.loja.com.br", /Comece o endereço com https/],
    ["http://www.loja.com.br", /links seguros/],
    ["ftp://loja.com.br", /começam com https/],
    ["https://usuario:senha@loja.com.br", /usuário ou senha/],
    ["https://127.0.0.1/x", /numéricos \(IP\)/],
    ["https://2130706433/x", /numéricos \(IP\)/],
    ["https://[::1]/x", /numéricos \(IP\)/],
    ["https://localhost/x", /locais ou de rede interna/],
    ["https://servidor.local/x", /locais ou de rede interna/],
    ["https://intranet/x", /locais ou de rede interna/],
    ["https://loja.com.br:8443/x", /não pode ter porta/],
    ["https://loja.com.br:443/x", /não pode ter porta/],
    ["https://lojá.com.br/x", /acentos/],
    ["https://xn--loj-fqa.com.br/x", /acentos/],
    ["https://exemplo.test/x", /\.test, \.onion, \.arpa/],
    ["https://abc.onion/x", /\.test, \.onion, \.arpa/],
    ["https://loja.com.br\\x", /barra invertida/],
    ["https://loja.com.br/a b", /espaços/],
    ["https://loja.com.br/​x", /invisíveis/],
  ])("recusa %j", (value, message) => {
    expect(validateDestinationUrl(value)).toMatch(message);
  });

  it("http traz também um aviso de link não seguro; recusa mais de 500 caracteres", () => {
    expect(checkDestinationUrl("http://loja.com.br").warning).toMatch(/não é seguro/);
    const long = `https://loja.com.br/${"a".repeat(500)}`;
    expect(validateDestinationUrl(long)).toMatch(/no máximo 500 caracteres/);
  });
});

describe("formulário de campanha do grupo", () => {
  it("o formulário válido não tem erros; aceita exatamente 60/90/24 caracteres e recusa 61/91/25", () => {
    expect(validateCampaignForm(validForm())).toEqual({});
    expect(validateCampaignForm({ ...validForm(), title: "a".repeat(60), text: "b".repeat(90), ctaLabel: "c".repeat(24) })).toEqual({});
    const over = validateCampaignForm({ ...validForm(), title: "a".repeat(61), text: "b".repeat(91), ctaLabel: "c".repeat(25) });
    expect(Object.keys(over).sort()).toEqual(["ctaLabel", "text", "title"]);
  });

  it("categoria só da lista branca (7, rótulos em português)", () => {
    expect(SPONSOR_CATEGORIES.map((c) => c.value)).toEqual([
      "INSTRUMENTOS",
      "VESTUARIO",
      "SAUDE",
      "EDUCACAO",
      "EVENTOS_TURISMO",
      "ALIMENTACAO",
      "ESPORTES",
    ]);
    expect(SPONSOR_CATEGORIES.map((c) => c.label)).toContain("Eventos e turismo");
    expect(validateCampaignForm({ ...validForm(), category: "APOSTAS" }).category).toMatch(/categoria da lista/);
    expect(validateCampaignForm({ ...validForm(), category: "" }).category).toBeDefined();
  });

  it("datas: fim depois do início e janela de no máximo 366 dias", () => {
    expect(validateCampaignForm({ ...validForm(), endsAt: "2026-11-10T08:00" }).endsAt).toMatch(/depois do início/);
    expect(validateCampaignForm({ ...validForm(), endsAt: "2026-11-09T08:00" }).endsAt).toMatch(/depois do início/);
    expect(validateCampaignForm({ ...validForm(), startsAt: "2026-01-01T00:00", endsAt: "2027-01-02T00:00" }).endsAt).toBeUndefined(); // 366 dias
    expect(validateCampaignForm({ ...validForm(), startsAt: "2026-01-01T00:00", endsAt: "2027-01-02T00:01" }).endsAt).toMatch(/no máximo 366 dias/);
    expect(validateCampaignForm({ ...validForm(), startsAt: "" }).startsAt).toBeDefined();
  });

  it("preço privado: aceita formatos pt-BR e recusa lixo", () => {
    expect(reaisToCents("1.500,00")).toBe(150000);
    expect(reaisToCents("R$ 10")).toBe(1000);
    expect(reaisToCents("")).toBeNull();
    expect(reaisToCents("abc")).toBe("invalid");
    expect(centsToReaisText(150050)).toBe("1500,50");
    expect(validateCampaignForm({ ...validForm(), price: "12x" }).price).toMatch(/Valor inválido/);
  });

  it("o corpo enviado NUNCA leva UF (states) nem peso (weight) e usa horário de Brasília em ISO", () => {
    const body = campaignPayload({ ...validForm(), price: "1.500,00", billingNote: " combinado " });
    expect(body).toEqual({
      sponsorId: 3,
      title: "Berimbau com 20% de desconto",
      text: "Instrumentos artesanais para a sua roda.",
      imageRef: null,
      ctaLabel: "Conhecer",
      destinationUrl: "https://www.loja.com.br/promo?x=1",
      category: "INSTRUMENTOS",
      startsAt: "2026-11-10T11:00:00.000Z",
      endsAt: "2026-12-10T11:00:00.000Z",
      priceCents: 150000,
      billingNote: "combinado",
    });
    expect(body).not.toHaveProperty("states");
    expect(body).not.toHaveProperty("weight");
    expect(emptyCampaignForm()).not.toHaveProperty("states");
    expect(emptyCampaignForm()).not.toHaveProperty("weight");
    expect(emptyCampaignForm().ctaLabel).toBe("Conhecer");
  });

  it("conversões de data: Brasília <-> UTC e exibição independente do fuso do navegador", () => {
    expect(localToIso("2026-11-10T08:00")).toBe("2026-11-10T11:00:00.000Z");
    expect(isoToLocal("2026-11-10T11:00:00.000Z")).toBe("2026-11-10T08:00");
    expect(formatInstant("2026-11-10T11:00:00.000Z")).toBe("10/11/2026 08:00");
    expect(localToIso("10/11/2026")).toBeNull();
  });

  it("campanha -> formulário -> payload é fiel; só os campos de conteúdo contam para 'volta a rascunho'", () => {
    const campaign = {
      id: 9,
      sponsorId: 3,
      title: "T1",
      text: "Texto",
      imageRef: "/api/uploads/3f2b8c1e-5d4a-4c3b-9a7e-1b2c3d4e5f60.webp",
      ctaLabel: "Ver",
      destinationUrl: "https://loja.com.br/x",
      category: "SAUDE",
      startsAt: "2026-11-10T11:00:00.000Z",
      endsAt: "2026-12-10T11:00:00.000Z",
      priceCents: 1990,
      billingNote: null,
    } as GroupCampaign;
    const form = campaignToForm(campaign);
    expect(form.price).toBe("19,90");
    expect(campaignPayload(form).priceCents).toBe(1990);
    expect(contentChanged(form, { ...form, price: "5,00", startsAt: "2026-11-11T08:00" })).toBe(false);
    expect(contentChanged(form, { ...form, title: "T2" })).toBe(true);
    expect(contentChanged(form, { ...form, destinationUrl: "https://loja.com.br/y" })).toBe(true);
  });
});

describe("formulário de patrocinador", () => {
  it("valida nome (2..80), e-mail e observações (1000); campos vazios viram null no corpo", () => {
    expect(validateSponsorForm({ name: "A", logo: "", contactName: "", contactEmail: "", contactPhone: "", document: "", notes: "" }).name).toBeDefined();
    expect(validateSponsorForm({ name: "a".repeat(81), logo: "", contactName: "", contactEmail: "", contactPhone: "", document: "", notes: "" }).name).toBeDefined();
    expect(validateSponsorForm({ name: "Loja", logo: "", contactName: "", contactEmail: "x@", contactPhone: "", document: "", notes: "n".repeat(1001) })).toMatchObject({
      contactEmail: expect.any(String),
      notes: expect.any(String),
    });
    expect(sponsorPayload({ name: " Loja ", logo: "", contactName: "", contactEmail: "a@b.com", contactPhone: "", document: "", notes: "" })).toEqual({
      name: "Loja",
      logo: null,
      contactName: null,
      contactEmail: "a@b.com",
      contactPhone: null,
      document: null,
      notes: null,
    });
  });
});

describe("imagem: limites no navegador", () => {
  it("recusa > 250 KB, formato fora de JPEG/PNG/WebP e arquivo vazio; aceita no limite", () => {
    expect(SPONSOR_IMAGE_MAX_BYTES).toBe(250 * 1024);
    expect(validateSponsorImageFile({ type: "image/webp", size: SPONSOR_IMAGE_MAX_BYTES })).toBeNull();
    expect(validateSponsorImageFile({ type: "image/png", size: SPONSOR_IMAGE_MAX_BYTES + 1 })).toMatch(/limite é 250 KB/);
    expect(validateSponsorImageFile({ type: "image/gif", size: 10 })).toMatch(/JPEG, PNG ou WebP/);
    expect(validateSponsorImageFile({ type: "application/pdf", size: 10 })).toMatch(/JPEG, PNG ou WebP/);
    expect(validateSponsorImageFile({ type: "image/jpeg", size: 0 })).toMatch(/vazio/);
  });
});

describe("erros do servidor por campo", () => {
  it("liga cada frase de um 400 ao campo; o resto vai para o bloco geral", () => {
    const error = new ApiError("x", 400, undefined, { message: ["title deve ter até 60 caracteres", "algo inesperado"] });
    expect(serverFieldErrors(error, ["title", "text"])).toEqual({
      fields: { title: "title deve ter até 60 caracteres" },
      general: ["algo inesperado"],
    });
  });

  it("aceita { code, field, message } (INVALID_DESTINATION_URL)", () => {
    const error = new ApiError("URL ruim", 400, "INVALID_DESTINATION_URL", { code: "INVALID_DESTINATION_URL", field: "destinationUrl", message: "URL ruim" });
    expect(serverFieldErrors(error, ["destinationUrl"]).fields).toEqual({ destinationUrl: "URL ruim" });
    expect(serverFieldErrors(new Error("x"), ["a"])).toEqual({ fields: {}, general: [] });
  });
});

describe("relatório: período, dias e nome do CSV", () => {
  it("período padrão = 30 dias limitados à vigência", () => {
    // campanha de 10/11 a 10/12 (fim exclusivo), "hoje" = 20/11 -> 10/11..20/11
    expect(defaultReportRange("2026-11-10T11:00:00.000Z", "2026-12-10T11:00:00.000Z", new Date("2026-11-20T15:00:00Z"))).toEqual({
      from: "2026-11-10",
      to: "2026-11-20",
    });
    // depois do fim: termina no último dia da vigência e recua 29 dias
    expect(defaultReportRange("2026-01-01T03:00:00.000Z", "2026-06-01T03:00:00.000Z", new Date("2026-11-20T15:00:00Z"))).toEqual({
      from: "2026-05-02", // 02/05..31/05 = 30 dias corridos
      to: "2026-05-31",
    });
  });

  it("completa os dias sem dado com zero e nomeia o arquivo", () => {
    expect(fillDays([{ day: "2026-11-11", impressions: 5, clicks: 1 }], "2026-11-10", "2026-11-12")).toEqual([
      { day: "2026-11-10", impressions: 0, clicks: 0 },
      { day: "2026-11-11", impressions: 5, clicks: 1 },
      { day: "2026-11-12", impressions: 0, clicks: 0 },
    ]);
    expect(reportCsvFilename(12, { from: "2026-11-10", to: "2026-11-20" })).toBe("campanha-12-2026-11-10_a_2026-11-20.csv");
  });
});

describe("travas de ativação", () => {
  const base = { version: "1", text: "t", accepted: true, acceptedAt: "2026-11-01T12:00:00Z", blocked: false, blockedReason: null };
  it("sem termo aceito, bloqueado pela plataforma ou sem o termo carregado: não ativa (com explicação)", () => {
    expect(activateBlockReason(base)).toBeNull();
    expect(activateBlockReason({ ...base, accepted: false })).toMatch(/Aceite o termo/);
    expect(activateBlockReason({ ...base, blocked: true })).toMatch(/bloqueado pela plataforma/);
    expect(activateBlockReason(undefined)).toMatch(/verificar o termo/);
  });
});
