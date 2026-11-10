import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { ChaveamentoPage } from "@/modules/chaveamento";
import { applyResponse, chaveamentoKeys } from "@/modules/chaveamento/api";
import { BracketView } from "@/modules/chaveamento/bracket-view";
import { TOURNAMENT_ERROR_MESSAGES, chaveamentoErrorMessage, isTournamentErrorCode } from "@/modules/chaveamento/errors";
import { GroupStageView, PodiumView } from "@/modules/chaveamento/group-stage-view";
import { competitorMap } from "@/modules/chaveamento/helpers";
import {
  CATEGORY_KEYS,
  CATEGORY_SUMMARY_KEYS,
  TOURNAMENT_KEYS,
  COMPETITOR_KEYS,
  ERROR_BODY_KEYS,
  MATCH_KEYS,
  PODIUM_KEYS,
  STANDINGS_GROUP_KEYS,
  STANDING_ROW_KEYS,
  type OperatorCategory,
} from "@/modules/chaveamento/types";
import { clearSession, loginAs } from "./login-as";
import { mkTournament, summaryOf } from "./chaveamento-fixtures";
import { installFakeBackend, json, newFake, type Fake } from "./chaveamento-server";
import {
  REAL_ERROR_DEPENDENT_MATCH_PLAYED,
  REAL_ERROR_MATCH_ALREADY_FINISHED,
  REAL_OPERATOR_GROUPS_FINISHED,
  REAL_OPERATOR_GROUPS_RUNNING,
  REAL_TOURNAMENT_CREATED,
  REAL_TOURNAMENT_DELETE_CATEGORY,
  REAL_TOURNAMENT_PATCH_PUBLIC,
  REAL_TOURNAMENT_ROTATE_TOKEN,
  REAL_TOURNAMENT_SUMMARY,
  REAL_OPERATOR_ROUNDROBIN_RUNNING,
  REAL_OPERATOR_SINGLE_FINISHED,
  REAL_OPERATOR_SINGLE_RUNNING,
} from "./real-contract-chaveamento";

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const SAMPLES: Array<[string, OperatorCategory]> = [
  ["eliminatória simples em andamento (com folgas e 3º lugar)", REAL_OPERATOR_SINGLE_RUNNING],
  ["eliminatória simples encerrada (com pódio)", REAL_OPERATOR_SINGLE_FINISHED],
  ["todos contra todos em andamento (empate e W.O.)", REAL_OPERATOR_ROUNDROBIN_RUNNING],
  ["grupos + mata-mata, só grupos", REAL_OPERATOR_GROUPS_RUNNING],
  ["grupos + mata-mata encerrado", REAL_OPERATOR_GROUPS_FINISHED],
];

const sorted = (keys: readonly string[]) => [...keys].sort();

describe("chaveamento: conformidade com o backend REAL (visão do operador)", () => {
  it.each(SAMPLES)("chaves exatas: %s", (_name, sample) => {
    expect(sorted(Object.keys(sample))).toEqual(sorted(CATEGORY_KEYS));
    expect(sample.competitors.length).toBeGreaterThan(0);
    for (const c of sample.competitors) expect(sorted(Object.keys(c))).toEqual(sorted(COMPETITOR_KEYS));
    expect(sample.matches.length).toBeGreaterThan(0);
    for (const m of sample.matches) expect(sorted(Object.keys(m))).toEqual(sorted(MATCH_KEYS));
    for (const g of sample.standings) {
      expect(sorted(Object.keys(g))).toEqual(sorted(STANDINGS_GROUP_KEYS));
      for (const row of g.rows) expect(sorted(Object.keys(row))).toEqual(sorted(STANDING_ROW_KEYS));
    }
    for (const p of sample.podium) expect(sorted(Object.keys(p))).toEqual(sorted(PODIUM_KEYS));
  });

  it("tipos reais dos campos que o painel usa (mat é número; photoPublic é booleano; ids numéricos)", () => {
    for (const [, sample] of SAMPLES) {
      for (const m of sample.matches) {
        expect(m.mat === null || typeof m.mat === "number").toBe(true);
        expect(typeof m.id).toBe("number");
        expect(["GROUP", "MAIN", "THIRD_PLACE"]).toContain(m.stage);
        expect(["PENDING", "READY", "LIVE", "FINISHED"]).toContain(m.status);
        expect(m.slotAId === null || typeof m.slotAId === "number").toBe(true);
      }
      for (const c of sample.competitors) {
        expect(typeof c.photoPublic).toBe("boolean");
        expect(["ADULT", "MINOR", "UNKNOWN"]).toContain(c.ageGroup);
      }
    }
  });

  it("as lutas de folga reais têm só um atleta e já vêm encerradas", () => {
    const byes = REAL_OPERATOR_SINGLE_RUNNING.matches.filter((m) => m.isBye);
    expect(byes.length).toBeGreaterThan(0);
    for (const m of byes) {
      expect(m.status).toBe("FINISHED");
      expect(m.slotBId).toBeNull();
      expect(m.winnerId).toBe(m.slotAId);
    }
  });

  it("erros 409 reais: corpo { statusCode, message, code } e mensagem do painel por code", () => {
    for (const body of [REAL_ERROR_DEPENDENT_MATCH_PLAYED, REAL_ERROR_MATCH_ALREADY_FINISHED]) {
      expect(sorted(Object.keys(body))).toEqual(sorted(ERROR_BODY_KEYS));
      expect(body.statusCode).toBe(409);
      expect(isTournamentErrorCode(body.code)).toBe(true);
    }
    const dep = REAL_ERROR_DEPENDENT_MATCH_PLAYED;
    const error = new ApiError(dep.message, dep.statusCode, dep.code, { ...dep });
    expect(error.code).toBe("DEPENDENT_MATCH_PLAYED");
    expect(chaveamentoErrorMessage(error)).toBe(TOURNAMENT_ERROR_MESSAGES.DEPENDENT_MATCH_PLAYED);
    const fin = REAL_ERROR_MATCH_ALREADY_FINISHED;
    expect(chaveamentoErrorMessage(new ApiError(fin.message, 409, fin.code))).toBe(TOURNAMENT_ERROR_MESSAGES.MATCH_ALREADY_FINISHED);
  });
});

const SUMMARIES = [
  ["GET / (resumo com 2 categorias)", REAL_TOURNAMENT_SUMMARY],
  ["DELETE de categoria (devolve o resumo)", REAL_TOURNAMENT_DELETE_CATEGORY],
  ["PATCH / (telão ligado)", REAL_TOURNAMENT_PATCH_PUBLIC],
  ["POST /rotate-token", REAL_TOURNAMENT_ROTATE_TOKEN],
  ["POST / (torneio recém-criado)", REAL_TOURNAMENT_CREATED],
] as const;

describe("chaveamento: conformidade com o backend REAL (resumo do torneio)", () => {
  it.each(SUMMARIES)("chaves exatas do resumo e das categorias: %s", (_name, summary) => {
    expect(sorted(Object.keys(summary))).toEqual(sorted(TOURNAMENT_KEYS));
    for (const c of summary.categories) {
      expect(sorted(Object.keys(c))).toEqual(sorted(CATEGORY_SUMMARY_KEYS));
      expect(typeof c.competitorsCount).toBe("number");
      expect(["SETUP", "RUNNING", "FINISHED"]).toContain(c.status);
    }
    expect(typeof summary.publicToken).toBe("string");
    expect(summary.publicToken.length).toBeGreaterThanOrEqual(24);
  });

  it("o DELETE de categoria é tratado como resumo do torneio (cache do torneio, não da categoria)", () => {
    const client = new QueryClient();
    applyResponse(client, 14132, REAL_TOURNAMENT_DELETE_CATEGORY);
    expect(client.getQueryData(chaveamentoKeys.tournament(14132))).toEqual(REAL_TOURNAMENT_DELETE_CATEGORY);
    expect(client.getQueryData(chaveamentoKeys.category(14132, 661))).toBeUndefined();
    // e a categoria completa continua indo para o cache da categoria
    applyResponse(client, 14132, REAL_OPERATOR_SINGLE_RUNNING);
    expect(client.getQueryData(chaveamentoKeys.category(14132, REAL_OPERATOR_SINGLE_RUNNING.id))).toEqual(REAL_OPERATOR_SINGLE_RUNNING);
  });
});

describe("chaveamento: renderiza a chave REAL sem lançar", () => {
  it.each(SAMPLES)("componentes de chave/classificação/pódio: %s", (_name, sample) => {
    const competitors = competitorMap(sample);
    const hasMain = sample.matches.some((m) => m.stage !== "GROUP");
    const hasGroup = sample.matches.some((m) => m.stage === "GROUP");
    const { container } = render(
      createElement("div", null, [
        createElement(BracketView, { key: "b", matches: sample.matches, competitors, onSelectMatch: () => undefined }),
        createElement(GroupStageView, { key: "g", category: sample, competitors, onSelectMatch: () => undefined }),
        createElement(PodiumView, { key: "p", podium: sample.podium, competitors }),
      ]),
    );
    // toda luta aparece como cartão/botão (chave ou grupo)
    for (const m of sample.matches) expect(within(container).getByTestId(`match-${String(m.id)}`)).toBeInTheDocument();
    expect(Boolean(container.querySelector("[data-testid=bracket]"))).toBe(hasMain);
    expect(Boolean(container.querySelector("[data-testid=group-stage]"))).toBe(hasGroup);
    expect(Boolean(container.querySelector("[data-testid=podium]"))).toBe(sample.podium.length > 0);
    // nenhum nome de atleta real vira HTML: tudo é texto
    expect(container.querySelector("script")).toBeNull();
  });
});

describe("chaveamento: página inteira com o JSON REAL como resposta da API", () => {
  let fake: Fake;
  beforeEach(() => {
    loginAs("MESTRE");
    fake = newFake();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearSession();
  });

  it("resumo real: abas com nome e status em texto, e link do telão com o token real", async () => {
    fake.tournament = REAL_TOURNAMENT_SUMMARY;
    installFakeBackend(fake);
    fake.overrides["GET /events/7/tournament/categories/661"] = () => json(200, REAL_OPERATOR_SINGLE_RUNNING);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(ChaveamentoPage, { eventId: 7 })));
    expect(await screen.findByRole("tab", { name: /Renomeada.*Em andamento · 4 atl\./ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Segunda.*Montando · 0 atl\./ })).toBeInTheDocument();
    expect((screen.getByLabelText("Link do telão") as HTMLInputElement).value).toMatch(/\/ao-vivo\/eDIxc4QT78N_vRFlr4E0uA36rqBZQbM6$/);
  }, 60_000);

  it("torneio recém-criado real (sem categorias) mostra o vazio de categorias", async () => {
    fake.tournament = REAL_TOURNAMENT_CREATED;
    installFakeBackend(fake);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(ChaveamentoPage, { eventId: 7 })));
    expect(await screen.findByTestId("categories-empty")).toBeInTheDocument();
  }, 60_000);

  it.each(SAMPLES)(
    "abre a categoria: %s",
    async (_name, sample) => {
      fake.tournament = mkTournament({ categories: [summaryOf(sample)] });
      installFakeBackend(fake);
      fake.overrides[`GET /events/7/tournament/categories/${String(sample.id)}`] = () => json(200, sample);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(createElement(QueryClientProvider, { client }, createElement(ChaveamentoPage, { eventId: 7 })));

      expect(await screen.findByTestId("category-body", undefined, { timeout: 30_000 })).toBeInTheDocument();
      for (const m of sample.matches) expect(screen.getByTestId(`match-${String(m.id)}`)).toBeInTheDocument();
      if (sample.format === "ROUND_ROBIN" || sample.format === "GROUPS_KNOCKOUT") {
        expect(screen.getAllByTestId("standings-table").length).toBeGreaterThan(0);
      }
      if (sample.podium.length > 0) expect(screen.getByTestId("podium")).toBeInTheDocument();
      // a aba traz o status em TEXTO (não só cor)
      expect(screen.getByRole("tab", { name: new RegExp(sample.name) })).toBeInTheDocument();
    },
    60_000,
  );
});
