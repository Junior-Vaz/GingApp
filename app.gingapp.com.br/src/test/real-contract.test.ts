import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { communicationIdOf, notificationRequiresAck } from "@/lib/communications";
import { applyReaction, feedErrorMessage, feedKeys, feedMediaSrc } from "@/lib/feed";
import { allPending, firstUnseenIndex, markStorySeenInCache, orderStoryGroups, removeStoryFromCache, storyGroupKey, type StoriesResponse } from "@/lib/stories";
import {
  REAL_COMMENTS,
  REAL_COMMUNICATION_NOTICE,
  REAL_FEED_NOTICE_ACTIVITY,
  REAL_POST_PENDING,
  REAL_POST_PUBLISHED,
  REAL_STORIES,
  REAL_STORY_POST,
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

  it("post pendente do autor vem com canEdit:false (PATCH no pendente é 409): o menu não oferece editar nem denunciar o próprio post", () => {
    expect(REAL_POST_PENDING.status).toBe("PENDING_APPROVAL");
    expect(REAL_POST_PENDING.canEdit).toBe(false);
    expect(REAL_POST_PENDING.media[0]?.url).toContain("&r=1");
    // Só o publicado do próprio autor edita.
    expect(REAL_POST_PUBLISHED.canEdit).toBe(true);
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

describe("contrato real: Stories (capturados em 2026-10-28)", () => {
  it("POST /feed/stories: 201 FeedPost kind STORY, type POST, expira em 24 h, não edita e traz a foto de revisão (&r=1) quando pendente", () => {
    expect(REAL_STORY_POST).toMatchObject({ type: "POST", kind: "STORY", status: "PENDING_APPROVAL", canEdit: false, canDelete: true, canModerate: false });
    expect(REAL_STORY_POST.media).toHaveLength(1);
    expect(REAL_STORY_POST.media[0]?.url).toContain("&r=1");
    const ttlHours = (Date.parse(REAL_STORY_POST.expiresAt!) - Date.parse(REAL_STORY_POST.createdAt)) / 3_600_000;
    expect(Math.round(ttlHours)).toBe(24);
  });

  it("GET /feed/stories: a ordem do servidor já é a do app (meu grupo, não vistos, vistos) e orderStoryGroups não mexe", () => {
    expect(orderStoryGroups(REAL_STORIES.groups)).toEqual(REAL_STORIES.groups);
    expect(REAL_STORIES.groups.map(storyGroupKey)).toEqual(["mine", "u2423", "u2422"]);
    const [mine, professor, mestre] = REAL_STORIES.groups;
    // meu story: sempre "visto" e sem anel, mesmo pendente
    expect(mine).toMatchObject({ isMine: true, hasUnseen: false });
    expect(mine?.items.every((item) => item.seen)).toBe(true);
    expect(allPending(mine)).toBe(true);
    expect(allPending(professor)).toBe(false);
    // vários itens do mesmo autor: do mais antigo para o mais novo; o visualizador começa no primeiro não visto
    expect(mestre?.items.map((item) => item.id)).toEqual([851, 852]);
    expect(firstUnseenIndex(mestre!)).toBe(0);
    expect(firstUnseenIndex({ ...mestre!, items: mestre!.items.map((item, index) => (index === 0 ? { ...item, seen: true } : item)) })).toBe(1);
  });

  it("marcar como visto / apagar no cache usa o mesmo formato do servidor", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(feedKeys.stories, REAL_STORIES);
    markStorySeenInCache(queryClient, 853);
    const after = queryClient.getQueryData<StoriesResponse>(feedKeys.stories)!;
    expect(after.groups[1]).toMatchObject({ hasUnseen: false });
    expect(after.groups[2]).toMatchObject({ hasUnseen: true });
    removeStoryFromCache(queryClient, 854);
    expect(queryClient.getQueryData<StoriesResponse>(feedKeys.stories)!.groups.map(storyGroupKey)).toEqual(["u2423", "u2422"]);
  });

  it("URLs assinadas dos stories: publicado sem &r=1, pendente do autor com &r=1; ambas ganham a origem da API", () => {
    const published = REAL_STORIES.groups[1]!.items[0]!.media;
    expect(published.url).toMatch(/^\/api\/feed\/media\/\d+\?e=\d+&s=[\w-]+$/);
    expect(published.thumbUrl).toMatch(/^\/api\/feed\/media\/\d+\/thumb\?e=\d+&s=[\w-]+$/);
    expect(feedMediaSrc(published.thumbUrl)).toMatch(/^https?:\/\/[^/]+\/api\/feed\/media\/367\/thumb\?e=/);
  });

  it("códigos de erro dos stories viram mensagem amigável", () => {
    expect(feedErrorMessage(new ApiError("Você chegou ao limite de stories de hoje. Tente amanhã.", 429, "STORY_LIMIT"), "fb")).toMatch(/limite de stories/);
    expect(feedErrorMessage(new ApiError("Stories não recebem reações nem comentários.", 409, "INVALID_STATE"), "fb")).toMatch(/mudou/);
    expect(feedErrorMessage(new ApiError("Story não encontrado.", 404, "NOT_FOUND"), "fb")).toMatch(/não está mais disponível/);
    expect(feedErrorMessage(new ApiError("O feed do grupo está desligado.", 403, "FEED_DISABLED"), "fb")).toMatch(/desligado/);
  });
});
