import { vi } from "vitest";
import type { OperatorCategory, TournamentSummary } from "@/modules/chaveamento/types";
import { mkCategory, mkCompetitor, mkMatch, mkTournament, summaryOf } from "./chaveamento-fixtures";

export interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

export const errorBody = (status: number, code: string, message = "msg do servidor") => json(status, { statusCode: status, message, code });

export const EVENT = {
  id: 7,
  unitId: null,
  title: "Campeonato Gingado",
  description: null,
  date: "2026-11-20T22:00:00.000Z",
  location: "Quadra",
  isPublic: true,
  type: "CAMPEONATO",
  stateId: null,
  cityId: null,
  imageUrl: null,
};

/** Backend falso em memória: um torneio, uma categoria, e uma luta simples (2 atletas) para os fluxos do operador. */
export interface Fake {
  tournament: TournamentSummary | null;
  category: OperatorCategory | null;
  participants: unknown[];
  calls: Call[];
  /** Respostas fixas por "MÉTODO /caminho" (tem prioridade). */
  overrides: Record<string, () => Response>;
  /** Foto PRÓPRIA por id de atleta (o que o servidor guardou do `POST .../photo`). */
  photos: Map<number, Blob>;
  /** Cabeçalho `Authorization` de cada `GET .../photo` (a rota é privada). */
  photoAuth: string[];
}

export function newFake(over: Partial<Fake> = {}): Fake {
  return { tournament: null, category: null, participants: [], calls: [], overrides: {}, photos: new Map(), photoAuth: [], ...over };
}

const syncSummary = (fake: Fake) => {
  if (fake.tournament && fake.category) fake.tournament.categories = [summaryOf(fake.category)];
};

export function installFakeBackend(fake: Fake): void {
  const handler = (input: string, init?: RequestInit): Response => {
    const [path = "", search = ""] = input.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
    const method = init?.method ?? "GET";
    // multipart (foto): registra só os metadados do arquivo; JSON: o corpo.
    const form = init?.body instanceof FormData ? init.body : null;
    const sentFile = form?.get("file");
    const body = form
      ? ({ file: sentFile instanceof Blob ? { name: sentFile instanceof File ? sentFile.name : "", type: sentFile.type, size: sentFile.size } : null } as Record<string, unknown>)
      : init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
    fake.calls.push({ method, path, query: new URLSearchParams(search), body });
    const key = `${method} ${path}`;
    const override = fake.overrides[key];
    if (override) return override();

    const base = "/events/7/tournament";
    if (key === "GET /events/7") return json(200, EVENT);
    if (key === `GET ${base}`) {
      return fake.tournament ? json(200, fake.tournament) : errorBody(404, "TOURNAMENT_NOT_FOUND", "Este evento ainda não tem chaveamento.");
    }
    if (key === `POST ${base}`) {
      fake.tournament = mkTournament();
      return json(201, fake.tournament);
    }
    if (key === `PATCH ${base}` && fake.tournament) {
      fake.tournament = { ...fake.tournament, publicEnabled: Boolean(body?.["publicEnabled"]) };
      return json(200, fake.tournament);
    }
    if (key === `POST ${base}/rotate-token` && fake.tournament) {
      fake.tournament = { ...fake.tournament, publicToken: "tok_NOVONOVONOVONOVONOVONOVO" };
      return json(200, fake.tournament);
    }
    if (key === `POST ${base}/categories`) {
      fake.category = mkCategory({
        id: 5,
        name: String(body?.["name"]),
        format: body?.["format"] as OperatorCategory["format"],
        thirdPlace: Boolean(body?.["thirdPlace"]),
      });
      syncSummary(fake);
      return json(201, fake.category);
    }
    const cat = fake.category;
    if (cat) {
      if (key === `GET ${base}/categories/${String(cat.id)}`) return json(200, cat);
      if (key === `POST ${base}/categories/${String(cat.id)}/competitors`) {
        const guest = (body?.["guest"] ?? {}) as Record<string, unknown>;
        // O backend real recusa `photoUrl` em QUALQUER valor (400 PHOTO_URL_NOT_ALLOWED): a foto é arquivo.
        if ("photoUrl" in guest) return errorBody(400, "PHOTO_URL_NOT_ALLOWED", "photoUrl não é mais aceito.");
        const id = 100 + cat.competitors.length + 1;
        cat.competitors.push(
          mkCompetitor(id, String(guest["displayName"]), {
            ageGroup: (guest["ageGroup"] as "ADULT" | "MINOR" | "UNKNOWN" | undefined) ?? "UNKNOWN",
            seed: (guest["seed"] as number | undefined) ?? null,
            photoAuthorized: guest["photoAuthorized"] === true,
            photoPublic: guest["photoAuthorized"] === true,
          }),
        );
        syncSummary(fake);
        // Como o backend real: a categoria completa + o id do atleta criado.
        return json(201, { ...cat, createdCompetitorId: id });
      }
      const photoRoute = /\/competitors\/(\d+)\/photo$/.exec(path);
      if (photoRoute) {
        const c = cat.competitors.find((x) => x.id === Number(photoRoute[1]));
        if (!c) return errorBody(404, "COMPETITOR_NOT_FOUND");
        if (method === "GET") {
          fake.photoAuth.push(String((init?.headers as Record<string, string> | undefined)?.["Authorization"] ?? ""));
          const stored = fake.photos.get(c.id);
          if (!stored) return errorBody(404, "PHOTO_NOT_FOUND");
          const response = new Response(stored, { status: 200, headers: { "Content-Type": "image/webp" } });
          // jsdom e o `fetch` do Node têm classes `Blob` diferentes (num navegador é uma só): devolve o Blob do jsdom,
          // senão `instanceof Blob` no PhotoPicker falharia só no teste.
          response.blob = async () => stored;
          return response;
        }
        if (c.studentId !== null) return errorBody(400, "PHOTO_FROM_STUDENT");
        if (method === "POST") {
          const file = form?.get("file");
          if (!(file instanceof Blob)) return errorBody(400, "PHOTO_FILE_REQUIRED");
          fake.photos.set(c.id, file);
          c.hasOwnPhoto = true;
          c.photoVersion = 1_794_000_000_000 + fake.photos.size * 1000 + (c.photoVersion === null ? 0 : 1);
          c.photoPublic = c.ageGroup === "ADULT" || c.photoAuthorized;
          cat.revision += 1;
          return json(200, cat);
        }
        if (method === "DELETE") {
          fake.photos.delete(c.id);
          c.hasOwnPhoto = false;
          c.photoVersion = null;
          c.photoPublic = false;
          cat.revision += 1;
          return json(200, cat);
        }
      }
      const comp = /\/competitors\/(\d+)$/.exec(path);
      if (method === "PATCH" && comp) {
        if (body && "photoUrl" in body) return errorBody(400, "PHOTO_URL_NOT_ALLOWED", "photoUrl não é mais aceito.");
        const c = cat.competitors.find((x) => x.id === Number(comp[1]));
        if (c && body?.["photoAuthorized"] === true) {
          c.photoAuthorized = true;
          c.photoPublic = c.hasOwnPhoto || c.photoUrl !== null;
        }
        return json(200, cat);
      }
      if (key === `POST ${base}/categories/${String(cat.id)}/generate`) {
        const [a, b] = cat.competitors;
        if (!a || !b) return errorBody(409, "NOT_ENOUGH_COMPETITORS");
        cat.status = "RUNNING";
        cat.matches = [mkMatch(50, { key: "MAIN-1-0", slotAId: a.id, slotBId: b.id, status: "READY" })];
        syncSummary(fake);
        return json(200, cat);
      }
      const act = /\/matches\/(\d+)\/(start|result|undo)$/.exec(path);
      if (act && method === "POST") {
        const m = cat.matches.find((x) => x.id === Number(act[1]));
        if (!m) return errorBody(404, "MATCH_NOT_FOUND");
        if (act[2] === "start") m.status = "LIVE";
        if (act[2] === "result") {
          m.status = "FINISHED";
          m.winnerId = body?.["winnerId"] as number;
          m.scoreA = (body?.["scoreA"] as number | null | undefined) ?? null;
          m.scoreB = (body?.["scoreB"] as number | null | undefined) ?? null;
          m.resultType = "NORMAL";
          cat.status = "FINISHED";
          cat.podium = [{ place: 1, competitorId: m.winnerId }];
        }
        if (act[2] === "undo") {
          m.status = "READY";
          m.winnerId = null;
          m.scoreA = null;
          m.scoreB = null;
          m.resultType = null;
          cat.status = "RUNNING";
          cat.podium = [];
        }
        return json(200, cat);
      }
    }
    return json(404, { message: "Rota não mockada." });
  };
  vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) => Promise.resolve(handler(input, init))));
}

export const sent = (fake: Fake, method: string, pathEnd: string) =>
  fake.calls.filter((c) => c.method === method && c.path.endsWith(pathEnd));
