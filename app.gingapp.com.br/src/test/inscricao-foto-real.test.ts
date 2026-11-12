import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { buildAnswers, classifySubmitError, sortedFields, uploadErrorMessage, validateAnswers, type Answers, type FormFieldDef, type PublicForm } from "@/lib/inscricao";
import {
  REAL_FORM_WITH_PHOTO,
  REAL_SUBMISSION_201,
  REAL_SUBMISSION_400_PHOTO_INVALID_TOKEN,
  REAL_SUBMISSION_400_PHOTO_MISSING,
  REAL_UPLOAD_FILE_201,
  REAL_UPLOAD_PHOTO_201,
  REAL_UPLOAD_PHOTO_413,
  REAL_UPLOAD_PHOTO_415_PDF,
  REAL_UPLOAD_PHOTO_415_UNREADABLE,
  REAL_UPLOAD_PHOTO_429,
  REAL_UPLOAD_PHOTO_503,
  type Json,
} from "./real-contract-form-photo";

/**
 * Conformidade com o backend REAL (backend/test/forms-photo-capture.e2e-spec.ts, copiado de D:\tmp\form-capture): o app lê
 * EXATAMENTE as chaves que o servidor manda no formulário com campo PHOTO, nos uploads e nos erros (413/415/429/503).
 */
type Obj = { [key: string]: Json };
const isObj = (value: Json | undefined): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const keysOf = (value: Json | undefined): string[] => (isObj(value) ? Object.keys(value).sort() : []);
const sorted = (list: readonly string[]): string[] => [...list].sort();
const obj = (value: Json | undefined): Obj => {
  if (!isObj(value)) throw new Error("esperava um objeto");
  return value;
};

/** Erro como o `api.ts` o monta a partir do corpo do servidor (status + code + body). */
function apiErrorOf(status: number, body: Json): ApiError {
  const o = obj(body);
  const code = typeof o["code"] === "string" ? o["code"] : undefined;
  const message = typeof o["message"] === "string" ? o["message"] : `Erro ${status}`;
  return new ApiError(message, status, code, body);
}

const FORM_KEYS = ["bannerUrl", "closedReason", "consent", "event", "fields", "intro", "isOpen", "paymentMode", "pix", "priceCents", "sections", "slug", "spotsLeft", "startedToken", "status", "title"];
const FIELD_KEYS = ["helpText", "key", "label", "mapsTo", "options", "order", "required", "sectionId", "showIf", "type", "validation"];
const UPLOAD_KEYS = ["fileToken", "mimeType", "originalName", "sizeBytes"];
const ERROR_KEYS = ["code", "error", "message", "statusCode"];

const form = REAL_FORM_WITH_PHOTO as unknown as PublicForm;
const fieldByKey = (key: string): FormFieldDef => {
  const found = form.fields.find((f) => f.key === key);
  if (!found) throw new Error(`campo ${key} ausente`);
  return found;
};

describe("formulário real com campo PHOTO: GET /public/forms/:slug", () => {
  it("chaves do formulário e de cada campo == contrato (nem a mais, nem a menos)", () => {
    expect(keysOf(REAL_FORM_WITH_PHOTO)).toEqual(sorted(FORM_KEYS));
    for (const f of (obj(REAL_FORM_WITH_PHOTO)["fields"] as Json[]) ?? []) expect(keysOf(f)).toEqual(sorted(FIELD_KEYS));
  });

  it("o campo PHOTO chega como tipo 'PHOTO', obrigatório, com texto de ajuda e sem mapsTo/validação/opções; o FILE segue como antes", () => {
    const photo = fieldByKey("foto");
    expect(photo).toMatchObject({ type: "PHOTO", required: true, mapsTo: null, validation: null, options: null, showIf: null });
    expect(photo.helpText).toMatch(/rosto/);
    expect(fieldByKey("comprovante")).toMatchObject({ type: "FILE", required: false });
    expect(sortedFields(form).map((f) => f.type)).toEqual(["SHORT_TEXT", "DATE", "EMAIL", "SELECT", "PHOTO", "FILE"]);
    expect(typeof form.startedToken).toBe("string");
    expect(form.consent.version).toBe(1);
  });

  it("validação do app: sem a foto -> 'Envie a foto para continuar.'; com a resposta real do upload -> ok; buildAnswers manda só o fileToken", () => {
    const base: Answers = { nome: "Rafaela Souza", nascimento: "1995-04-12", email: "rafaela@exemplo.com", categoria: "Adulto até 70 kg" };
    expect(validateAnswers(form, base)).toEqual({ foto: "Envie a foto para continuar." });
    const uploaded = obj(REAL_UPLOAD_PHOTO_201);
    const answers: Answers = {
      ...base,
      foto: { fileToken: String(uploaded["fileToken"]), originalName: String(uploaded["originalName"]), mimeType: String(uploaded["mimeType"]), sizeBytes: Number(uploaded["sizeBytes"]) },
    };
    expect(validateAnswers(form, answers)).toEqual({});
    const out = buildAnswers(form, answers);
    expect(out["foto"]).toEqual({ fileToken: uploaded["fileToken"] });
    expect(Object.keys(out).sort()).toEqual(["categoria", "email", "foto", "nascimento", "nome"]);
  });
});

describe("formulário real com campo PHOTO: uploads e envio", () => {
  it("resposta do upload da foto e do arquivo: { fileToken, originalName, mimeType, sizeBytes }; a foto sempre sai como foto.webp (image/webp)", () => {
    expect(keysOf(REAL_UPLOAD_PHOTO_201)).toEqual(UPLOAD_KEYS);
    expect(keysOf(REAL_UPLOAD_FILE_201)).toEqual(UPLOAD_KEYS);
    const photo = obj(REAL_UPLOAD_PHOTO_201);
    expect(photo["originalName"]).toBe("foto.webp");
    expect(photo["mimeType"]).toBe("image/webp");
    expect(typeof photo["fileToken"]).toBe("string");
    expect(photo["sizeBytes"]).toBeGreaterThan(0);
  });

  it("201 do envio: { protocol, status, paymentStatus, message, payment, proofRequired }", () => {
    expect(keysOf(REAL_SUBMISSION_201)).toEqual(sorted(["message", "payment", "paymentStatus", "proofRequired", "protocol", "status"]));
  });

  it("erros de upload: { statusCode, error, code, message } com os códigos que o app mapeia", () => {
    const errors: Array<[Json, number, string]> = [
      [REAL_UPLOAD_PHOTO_413, 413, "FILE_TOO_LARGE"],
      [REAL_UPLOAD_PHOTO_415_PDF, 415, "FILE_TYPE_NOT_ALLOWED"],
      [REAL_UPLOAD_PHOTO_415_UNREADABLE, 415, "FILE_TYPE_NOT_ALLOWED"],
      [REAL_UPLOAD_PHOTO_429, 429, "TOO_MANY_REQUESTS"],
      [REAL_UPLOAD_PHOTO_503, 503, "PHOTO_PROCESSING_UNAVAILABLE"],
    ];
    for (const [body, status, code] of errors) {
      expect(keysOf(body)).toEqual(ERROR_KEYS);
      expect(obj(body)["statusCode"]).toBe(status);
      expect(obj(body)["code"]).toBe(code);
    }
  });

  it("cada erro real de upload vira uma mensagem em português própria (foto) e nunca o texto cru do servidor", () => {
    const expected: Array<[Json, number, RegExp]> = [
      [REAL_UPLOAD_PHOTO_413, 413, /grande demais/],
      [REAL_UPLOAD_PHOTO_415_PDF, 415, /JPG, PNG ou WEBP/],
      [REAL_UPLOAD_PHOTO_415_UNREADABLE, 415, /JPG, PNG ou WEBP/],
      [REAL_UPLOAD_PHOTO_429, 429, /Aguarde um pouco/],
      [REAL_UPLOAD_PHOTO_503, 503, /indisponível no momento/],
    ];
    for (const [body, status, pattern] of expected) {
      const message = uploadErrorMessage(apiErrorOf(status, body), "photo");
      expect(message).toMatch(pattern);
      expect(message).not.toBe(String(obj(body)["message"]));
    }
    // o campo FILE continua com os textos de antes para os mesmos códigos
    expect(uploadErrorMessage(apiErrorOf(413, REAL_UPLOAD_PHOTO_413))).toMatch(/5 MB/);
    expect(uploadErrorMessage(apiErrorOf(415, REAL_UPLOAD_PHOTO_415_PDF))).toMatch(/Formato não aceito/);
  });

  it("400 de foto obrigatória ausente / token inválido: fields.foto e o app reconhece como erro de validação do campo", () => {
    for (const body of [REAL_SUBMISSION_400_PHOTO_MISSING, REAL_SUBMISSION_400_PHOTO_INVALID_TOKEN]) {
      expect(keysOf(body)).toEqual(sorted([...ERROR_KEYS, "fields"]));
      expect(obj(body)["code"]).toBe("VALIDATION");
      expect(Object.keys(obj(obj(body)["fields"]))).toEqual(["foto"]);
      const failure = classifySubmitError(apiErrorOf(400, body));
      expect(failure.kind).toBe("validation");
      if (failure.kind === "validation") expect(Object.keys(failure.fields)).toEqual(["foto"]);
    }
    expect(obj(obj(REAL_SUBMISSION_400_PHOTO_INVALID_TOKEN)["fields"])["foto"]).toMatch(/inválido ou expirado/);
  });
});
