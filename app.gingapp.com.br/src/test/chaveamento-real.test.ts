import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveConnection, signatureOf, type LiveState } from "@/lib/chaveamento/connection";
import { parsePublicSnapshot } from "@/lib/chaveamento/parse";
import { announcementFor, diffSnapshots } from "@/lib/chaveamento/snapshot-diff";
import { computeBracketLayout } from "@/lib/chaveamento/bracket-layout";
import { FORBIDDEN_PUBLIC_KEYS, SNAPSHOT_KEYS, type PublicSnapshot } from "@/lib/chaveamento/types";
import { MockEventSource, lastSource } from "./chaveamento-mocks";
import { cleanupMounted, click, feed, mountLive, setReducedMotion, tabs } from "./chaveamento-dom";
import {
  REAL_GROUPS_FINISHED,
  REAL_GROUPS_RUNNING,
  REAL_ROUNDROBIN_FINISHED,
  REAL_ROUNDROBIN_RUNNING,
  REAL_ROUNDROBIN_RUNNING_4,
  REAL_SINGLE_FINISHED,
  REAL_SINGLE_RUNNING,
  REAL_SSE_EVENT,
  REAL_WITH_PHOTO,
  type Json,
} from "./real-contract-chaveamento";

/**
 * Conformidade com o backend REAL (amostras capturadas pelo e2e de chaveamento, copiadas de D:\tmp\chaveamento-capture):
 * o parser e a tela leem EXATAMENTE as chaves que o servidor manda, nenhuma chave proibida existe e nada aparece como
 * undefined/null/NaN. Timeouts generosos: instáveis sob a carga do gate completo.
 */
const LONG = 60_000;

const SAMPLES: Array<[string, Json]> = [
  ["single running", REAL_SINGLE_RUNNING],
  ["single finished", REAL_SINGLE_FINISHED],
  ["roundrobin running", REAL_ROUNDROBIN_RUNNING],
  ["roundrobin running (4 atletas)", REAL_ROUNDROBIN_RUNNING_4],
  ["roundrobin finished", REAL_ROUNDROBIN_FINISHED],
  ["groups running", REAL_GROUPS_RUNNING],
  ["groups finished", REAL_GROUPS_FINISHED],
  ["com foto própria de atleta (/api/public/tournaments/<token>/photos/<uuid>.webp)", REAL_WITH_PHOTO],
];

type Obj = { [key: string]: Json };
const isObj = (value: Json | undefined): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const arr = (value: Json | undefined): Json[] => (Array.isArray(value) ? value : []);
const sorted = (list: readonly string[]): string[] => [...list].sort();
const keysOf = (value: Json | undefined): string[] => sorted(isObj(value) ? Object.keys(value) : []);

/** Todas as chaves de objeto em qualquer profundidade. */
function allKeys(value: Json, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, into));
  else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      allKeys(v, into);
    }
  }
  return into;
}

describe("chaveamento: conformidade com o JSON real do backend", () => {
  for (const [label, raw] of SAMPLES) {
    describe(label, () => {
      it("conjunto de chaves de cada objeto == contrato (nem a mais, nem a menos)", () => {
        expect(keysOf(raw), "topo").toEqual(sorted(SNAPSHOT_KEYS.top));
        const top = raw as Obj;
        expect(keysOf(top["event"]), "event").toEqual(sorted(SNAPSHOT_KEYS.event));
        expect(arr(top["categories"]).length).toBeGreaterThan(0);
        for (const category of arr(top["categories"]) as Obj[]) {
          expect(keysOf(category), "category").toEqual(sorted(SNAPSHOT_KEYS.category));
          for (const c of arr(category["competitors"])) expect(keysOf(c), "competitor").toEqual(sorted(SNAPSHOT_KEYS.competitor));
          for (const m of arr(category["matches"])) expect(keysOf(m), "match").toEqual(sorted(SNAPSHOT_KEYS.match));
          for (const g of arr(category["standings"]) as Obj[]) {
            expect(keysOf(g), "standings").toEqual(sorted(SNAPSHOT_KEYS.standingsGroup));
            for (const r of arr(g["rows"])) expect(keysOf(r), "row").toEqual(sorted(SNAPSHOT_KEYS.standingRow));
          }
          for (const p of arr(category["podium"])) expect(keysOf(p), "podium").toEqual(sorted(SNAPSHOT_KEYS.podium));
        }
      });

      it("nenhuma chave proibida (studentId, eventParticipantId, ageGroup, photoAuthorized*, birthDate, note, organizationId, publicToken)", () => {
        const keys = allKeys(raw);
        for (const forbidden of FORBIDDEN_PUBLIC_KEYS) expect(keys.has(forbidden), forbidden).toBe(false);
        expect(JSON.stringify(raw)).not.toMatch(/studentId|eventParticipantId|ageGroup|photoAuthorized|birthDate|publicToken|organizationId/);
      });

      it("o parser devolve o MESMO conteúdo (nada descartado, nada inventado) e as mesmas chaves", () => {
        const parsed = parsePublicSnapshot(raw);
        expect(parsed).not.toBeNull();
        expect(parsed).toEqual(raw);
        expect(sorted(Object.keys(parsed!))).toEqual(sorted(SNAPSHOT_KEYS.top));
        for (const category of parsed!.categories) {
          expect(sorted(Object.keys(category))).toEqual(sorted(SNAPSHOT_KEYS.category));
          for (const c of category.competitors) expect(sorted(Object.keys(c))).toEqual(sorted(SNAPSHOT_KEYS.competitor));
          for (const m of category.matches) expect(sorted(Object.keys(m))).toEqual(sorted(SNAPSHOT_KEYS.match));
        }
      });

      it("a tela renderiza o snapshot real (todas as categorias) sem lançar e sem undefined/null/NaN", () => {
        setReducedMotion(false);
        const m = mountLive("tok", false);
        expect(() => feed(JSON.stringify(raw))).not.toThrow();
        const parsed = parsePublicSnapshot(raw)!;
        const visit = (): void => {
          const html = m.host.innerHTML;
          const text = m.host.textContent ?? "";
          expect(text).not.toMatch(/undefined|\bnull\b|NaN/);
          expect(html).not.toMatch(/undefined|NaN|="null"/);
        };
        visit();
        for (const tab of tabs(m.host)) {
          click(tab);
          visit();
        }
        // o modo telão também aguenta o formato real
        cleanupMounted();
        MockEventSource.instances = [];
        const tv = mountLive("tok", true);
        expect(() => feed(JSON.stringify(raw))).not.toThrow();
        expect(tv.host.textContent ?? "").not.toMatch(/undefined|\bnull\b|NaN/);
        expect(tv.host.textContent).toContain(parsed.event.title);
      }, LONG);
    });
  }

  it("evento SSE bruto: event=snapshot, id=revision, data é o MESMO formato do GET", () => {
    expect(Object.keys(REAL_SSE_EVENT).sort()).toEqual(["data", "event", "id"]);
    expect(REAL_SSE_EVENT.event).toBe("snapshot");
    const data = JSON.parse(REAL_SSE_EVENT.data) as Json;
    expect(keysOf(data)).toEqual(sorted(SNAPSHOT_KEYS.top));
    const parsed = parsePublicSnapshot(data);
    expect(parsed).not.toBeNull();
    expect(REAL_SSE_EVENT.id).toBe(String(parsed!.revision));
    expect(parsed).toEqual(data);
    expect([...allKeys(data)].filter((k) => (FORBIDDEN_PUBLIC_KEYS as readonly string[]).includes(k))).toEqual([]);
  });

  it("o evento SSE real passa pela máquina de conexão e vira estado; a assinatura ignora o serverTime", () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", MockEventSource);
    MockEventSource.instances = [];
    const states: LiveState[] = [];
    const connection = new LiveConnection("tok", (s) => states.push(s));
    connection.start();
    lastSource().emit("open");
    lastSource().emit("snapshot", REAL_SSE_EVENT.data);
    const last = states[states.length - 1]!;
    expect(last.status).toBe("live");
    expect(last.snapshot?.revision).toBe(Number(REAL_SSE_EVENT.id));
    expect(last.snapshot?.categories[0]?.competitors.length).toBeGreaterThan(0);
    expect(signatureOf(REAL_SSE_EVENT.data)).not.toContain("serverTime");
    expect(signatureOf(REAL_SSE_EVENT.data)).toBe(signatureOf(REAL_SSE_EVENT.data.replace(/"serverTime":"[^"]*"/, '"serverTime":"2099-01-01T00:00:00.000Z"')));
    connection.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }, LONG);

  describe("detalhes do formato real que a tela e a lógica assumem", () => {
    const parsed = (raw: Json): PublicSnapshot => parsePublicSnapshot(raw)!;

    it("`mat` é string ou null; status e resultType só usam os valores do contrato", () => {
      for (const [, raw] of SAMPLES) {
        for (const category of parsed(raw).categories) {
          for (const m of category.matches) {
            expect(m.mat === null || typeof m.mat === "string").toBe(true);
            expect(["PENDING", "READY", "LIVE", "FINISHED"]).toContain(m.status);
            expect(m.resultType === null || ["NORMAL", "WALKOVER", "DISQUALIFICATION", "DRAW"].includes(m.resultType)).toBe(true);
          }
        }
      }
    });

    it("mata-mata real: folgas nascem FINISHED com um lado só; o layout liga todas as lutas e tem o 3º lugar à parte", () => {
      const single = parsed(REAL_SINGLE_RUNNING).categories[0]!;
      expect(single.matches.some((m) => m.isBye && m.status === "FINISHED" && m.slotBId === null)).toBe(true);
      const layout = computeBracketLayout(single.matches);
      expect(layout.cards.length).toBe(single.matches.length);
      expect(layout.third).not.toBeNull();
      expect(layout.connectors.length).toBe(single.matches.filter((m) => m.stage === "MAIN" && m.nextMatchId !== null).length);
    });

    it("pódio real: 3 colocados que existem na categoria; categoria terminada tem pódio", () => {
      const finished = parsed(REAL_SINGLE_FINISHED).categories[0]!;
      expect(finished.status).toBe("FINISHED");
      expect(finished.podium.map((p) => p.place)).toEqual([1, 2, 3]);
      const ids = new Set(finished.competitors.map((c) => c.id));
      for (const p of finished.podium) expect(ids.has(p.competitorId)).toBe(true);
    });

    it("grupos reais: classificação por grupo e mata-mata gerado depois dos grupos", () => {
      const g = parsed(REAL_GROUPS_FINISHED).categories.find((c) => c.status === "FINISHED")!;
      expect(g.format).toBe("GROUPS_KNOCKOUT");
      expect(g.standings.map((s) => s.groupIndex)).toEqual([0, 1]);
      expect(g.matches.some((m) => m.stage === "GROUP")).toBe(true);
      expect(g.matches.some((m) => m.stage === "MAIN")).toBe(true);
      expect(g.matches.some((m) => m.stage === "THIRD_PLACE")).toBe(true);
    });

    it("fotos reais: só caminho de upload do backend, foto própria do atleta (/api/public/tournaments/<token>/photos/<uuid>.webp) ou https; foto nula existe (menor sem autorização)", () => {
      const all = [REAL_ROUNDROBIN_RUNNING, REAL_WITH_PHOTO].flatMap((raw) => parsed(raw).categories.flatMap((c) => c.competitors));
      expect(all.some((c) => c.photoUrl === null)).toBe(true);
      const allowed = /^(\/api\/uploads\/|\/api\/public\/tournaments\/[A-Za-z0-9_-]{24,64}\/photos\/[0-9a-f-]{36}\.webp$|https:\/\/)/;
      for (const c of all) expect(c.photoUrl === null || allowed.test(c.photoUrl)).toBe(true);
    });

    it("diff entre dois snapshots reais consecutivos (single running -> finished): anuncia os resultados e o pódio", () => {
      const before = parsed(REAL_SINGLE_RUNNING);
      const after = parsed(REAL_SINGLE_FINISHED);
      const diff = diffSnapshots(before, after);
      expect(diff.initial).toBe(false);
      expect(diff.categoriesFinished).toEqual([after.categories[0]!.id]);
      expect(diff.finished.length).toBeGreaterThan(0);
      expect(announcementFor(diff)).toMatch(/venceu/);
      expect(diff.finished.every((e) => !before.categories[0]!.matches.find((m) => m.id === e.matchId)!.isBye)).toBe(true);
    });
  });
});

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
});
afterEach(() => {
  cleanupMounted();
  vi.unstubAllGlobals();
  setReducedMotion(false);
});
