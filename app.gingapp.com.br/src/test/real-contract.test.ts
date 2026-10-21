import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { communicationIdOf, notificationRequiresAck } from "@/lib/communications";
import { applyReaction, feedErrorMessage, feedMediaSrc } from "@/lib/feed";
import {
  REAL_COMMENTS,
  REAL_COMMUNICATION_NOTICE,
  REAL_FEED_NOTICE_ACTIVITY,
  REAL_POST_PENDING,
  REAL_POST_PUBLISHED,
  REAL_UPLOAD,
  REAL_WEEK_SELF,
} from "./real-contract";

/** Amostras do backend REAL (real-contract.ts) contra as funções puras do app. */
describe("contrato real: Comunicar na notificação", () => {
  it("data.communicationId e data.requiresAck vêm no GET /notifications", () => {
    expect(communicationIdOf(REAL_COMMUNICATION_NOTICE)).toBe(7953);
    expect(notificationRequiresAck(REAL_COMMUNICATION_NOTICE)).toBe("GOING");
    // FEED_*: tem postId, não communicationId.
    expect(communicationIdOf(REAL_FEED_NOTICE_ACTIVITY)).toBeNull();
    expect(REAL_FEED_NOTICE_ACTIVITY.data?.["postId"]).toBe(319);
  });
});

describe("contrato real: Feed", () => {
  it("códigos de erro do backend viram mensagem amigável (e o resto cai na mensagem do servidor)", () => {
    const codes: Array<[string, number, RegExp]> = [
      ["VISIBILITY_NOT_ALLOWED", 403, /não pode publicar para esse público/],
      ["MEDIA_INVALID", 400, /foto expirou/],
      ["INVALID_STATE", 409, /mudou/],
      ["POST_LIMIT", 429, /limite de publicações/],
      ["COMMENT_LIMIT", 429, /limite de comentários/],
      ["FEED_DISABLED", 403, /desligado/],
      ["POSTING_NOT_ALLOWED", 403, /permissão para publicar/],
      ["FILE_TOO_LARGE", 413, /5 MB/],
      ["FILE_TYPE_NOT_ALLOWED", 415, /JPEG, PNG ou WebP/],
    ];
    for (const [code, status, message] of codes) {
      expect(feedErrorMessage(new ApiError("msg do servidor", status, code), "fb"), code).toMatch(message);
    }
    // Código sem tradução: vale o texto (já em pt-BR) do servidor.
    expect(feedErrorMessage(new ApiError("Você não pode denunciar o seu próprio post.", 400, "VALIDATION"), "fb")).toBe(
      "Você não pode denunciar o seu próprio post.",
    );
    // 429 do throttler (TOO_MANY_REQUESTS) e 503 sem código conhecido.
    expect(feedErrorMessage(new ApiError("Muitas tentativas. Aguarde um minuto.", 429, "TOO_MANY_REQUESTS"), "fb")).toMatch(/Muitas tentativas/);
  });

  it("URL assinada do servidor ganha a origem da API em desenvolvimento (e a de revisão traz &r=1)", () => {
    expect(REAL_UPLOAD.url).toMatch(/^\/api\/feed\/media\/\d+\?e=\d+&s=[\w-]+&r=1$/);
    expect(REAL_UPLOAD.thumbUrl).toMatch(/^\/api\/feed\/media\/\d+\/thumb\?e=\d+&s=/);
    expect(feedMediaSrc(REAL_UPLOAD.url)).toMatch(/^https?:\/\/[^/]+\/api\/feed\/media\/81\?e=/);
    expect(feedMediaSrc("https://cdn.exemplo/x.png")).toBe("https://cdn.exemplo/x.png");
  });

  it("reação: o servidor devolve { counts, total, mine } e o otimista usa a mesma conta", () => {
    const next = applyReaction(REAL_POST_PUBLISHED.reactions, "AXE");
    expect(next).toEqual({ counts: { AXE: 1, SALVE: 0, GINGA: 0, PARABENS: 0, CORACAO: 0 }, total: 1, mine: "AXE" });
    expect(applyReaction(next, null)).toEqual(REAL_POST_PUBLISHED.reactions);
  });

  it("post pendente do autor vem com canEdit:true mas o PATCH é recusado: o app trata pelo status, não pelo canEdit", () => {
    expect(REAL_POST_PENDING.status).toBe("PENDING_APPROVAL");
    expect(REAL_POST_PENDING.canEdit).toBe(true);
    expect(REAL_POST_PENDING.media[0]?.url).toContain("&r=1");
  });

  it("comentários: ordem cronológica, respostas com parentId (um nível) e quem não é dono não apaga", () => {
    expect(REAL_COMMENTS.map((c) => c.id)).toEqual([61, 62, 63]);
    expect(REAL_COMMENTS[1]?.parentId).toBe(61);
    expect(REAL_COMMENTS[1]?.canDelete).toBe(false);
  });

  it("aniversário: o próprio usuário aparece na semana sem poder se parabenizar", () => {
    expect(REAL_WEEK_SELF.canCongratulate).toBe(false);
    expect(REAL_WEEK_SELF).not.toHaveProperty("age");
  });
});
