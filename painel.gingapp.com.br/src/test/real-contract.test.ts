import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { flattenQueue, itemKey } from "@/modules/feed/api";
import { changedCount, commErrorMessage, resendMessage } from "@/modules/comunicar/utils";
import {
  REAL_BIRTHDAY,
  REAL_BIRTHDAY_LIST,
  REAL_BIRTHDAY_SUMMARY,
  REAL_COMM_DETAIL,
  REAL_COMM_ITEM,
  REAL_CREATED,
  REAL_GREET,
  REAL_GREET_AGAIN,
  REAL_QUEUE_COMMENT,
  REAL_QUEUE_PAGE,
  REAL_QUEUE_POST,
  REAL_RESEND,
} from "./real-contract";

/**
 * Amostras do backend REAL (ver real-contract.ts) contra as funções puras do painel. Os formatos dos hooks foram
 * provados contra `node dist/main.js` (PLANO_PROJETO.md, conferência de contrato); aqui ficam as regressões baratas.
 */
describe("contrato real: Comunicar", () => {
  it("resend-unread responde { sent }: a mensagem usa `sent` (e 0 não vira 'reenviada para 0')", () => {
    expect(resendMessage(REAL_RESEND)).toBe("Mensagem reenviada para 54 pessoas.");
    expect(resendMessage({ sent: 1 })).toBe("Mensagem reenviada para 1 pessoa.");
    expect(resendMessage({ sent: 0 })).toBe("Ninguém ficou sem ler: não há para quem reenviar.");
    expect(resendMessage(undefined)).toBe("Mensagem reenviada para quem não leu.");
    expect(resendMessage({})).toBe("Mensagem reenviada para quem não leu.");
  });

  it("409 RECIPIENTS_CHANGED traz { count } no corpo; 429 COMM_QUOTA_EXCEEDED traz limit/scope", () => {
    const changed = new ApiError("O alcance tem 54 destinatários; confirme a contagem para enviar.", 409, "RECIPIENTS_CHANGED", {
      statusCode: 409,
      error: "Conflict",
      code: "RECIPIENTS_CHANGED",
      count: 54,
    });
    expect(changedCount(changed)).toBe(54);
    const quota = new ApiError("Você atingiu o limite de 6 comunicados por dia. Tente amanhã.", 429, "COMM_QUOTA_EXCEEDED", {
      code: "COMM_QUOTA_EXCEEDED",
      limit: 6,
      scope: "AUTHOR",
    });
    expect(commErrorMessage(quota, "fb")).toMatch(/limite de envios/);
  });

  it("403 com texto próprio do backend (turma que não é do professor) mostra esse texto; 403 sem texto cai na frase genérica", () => {
    const own = new ApiError("Você só pode enviar para as suas turmas.", 403, undefined, { statusCode: 403, error: "Forbidden" });
    expect(commErrorMessage(own, "fb")).toBe("Você só pode enviar para as suas turmas.");
    expect(commErrorMessage(new ApiError("Apenas o Mestre pode enviar para este alcance.", 403), "fb")).toBe("Apenas o Mestre pode enviar para este alcance.");
    expect(commErrorMessage(new ApiError("Forbidden", 403), "fb")).toBe("Você não tem permissão para esta ação.");
    expect(commErrorMessage(new ApiError("Erro 403 ao chamar /communications", 403), "fb")).toBe("Você não tem permissão para esta ação.");
    // Nest manda o texto técnico do throttler sem `code`: a tela mostra a frase amigável.
    expect(commErrorMessage(new ApiError("ThrottlerException: Too Many Requests", 429), "fb")).toMatch(/Muitas tentativas/);
  });

  it("as amostras reais têm as chaves que os tipos descrevem", () => {
    expect(Object.keys(REAL_CREATED).sort()).toEqual(["id", "recipients", "status"]);
    expect(Object.keys(REAL_COMM_ITEM).sort()).toEqual(
      ["ackCount", "createdAt", "createdByName", "id", "lastResendAt", "pinToFeed", "pinnedUntil", "readCount", "recipientsCount", "requiresAck", "scheduledAt", "scopeType", "sentAt", "status", "title"].sort(),
    );
    expect(Object.keys(REAL_COMM_DETAIL.scope).sort()).toEqual(["className", "classId", "role", "type", "unitId", "unitName"].sort());
  });
});

describe("contrato real: Aniversariantes", () => {
  it("greet repetido responde 200 { sent:false, alreadyGreeted:true } (sem 409) e mantém o whatsappUrl", () => {
    expect(REAL_GREET.sent).toBe(true);
    expect(REAL_GREET_AGAIN).toMatchObject({ sent: false, alreadyGreeted: true });
    expect(REAL_GREET_AGAIN.whatsappUrl).toMatch(/^https:\/\/wa\.me\/55\d+\?text=/);
  });

  it("age e turnsAge valem o mesmo número; menor aparece para a equipe com isMinor", () => {
    expect(REAL_BIRTHDAY.age).toBe(REAL_BIRTHDAY.turnsAge);
    expect(REAL_BIRTHDAY_LIST.items.some((i) => i.isMinor)).toBe(true);
    expect(REAL_BIRTHDAY_SUMMARY.todayTotal).toBe(REAL_BIRTHDAY_SUMMARY.today.length);
  });
});

describe("contrato real: fila de moderação do Feed", () => {
  it("comentário denunciado vem em `comment` ao lado de `post`; a identidade do item é a do comentário", () => {
    expect(REAL_QUEUE_POST.comment).toBeUndefined();
    expect(REAL_QUEUE_COMMENT.comment?.id).toBe(52);
    expect(itemKey(REAL_QUEUE_POST)).toBe("p-320");
    expect(itemKey(REAL_QUEUE_COMMENT)).toBe("c-52");
    expect(flattenQueue({ pages: [REAL_QUEUE_PAGE] }).map(itemKey)).toEqual(["p-320", "c-52"]);
  });
});
