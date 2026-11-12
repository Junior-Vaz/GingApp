import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Avatar } from "@/components/chaveamento/avatar";
import { asImageRef, parsePublicSnapshot } from "@/lib/chaveamento/parse";
import { isTournamentPhotoPath } from "@/lib/chaveamento/photo-ref";
import { imageSrc } from "@/lib/uploads";
import { API_URL } from "@/lib/api";
import { MockEventSource } from "./chaveamento-mocks";
import { cleanupMounted, feed, mountLive } from "./chaveamento-dom";
import { REAL_WITH_PHOTO, type Json } from "./real-contract-chaveamento";

/**
 * Foto PRÓPRIA do atleta de fora no telão: o snapshot manda `/api/public/tournaments/<token>/photos/<uuid>.webp` (caminho
 * relativo). O parser aceita esse formato (e continua aceitando `/api/uploads/...` e https), rejeita o resto, e o Avatar
 * carrega a foto sem referrer (o caminho carrega o token do link) caindo nas iniciais se a imagem falhar.
 */
const LONG = 60_000;
const TOKEN = "7ed6_LIoTJVQuTPpi-75hpCFJ50Z9uQg";
const UUID = "11e94462-4f77-4c0d-9433-7514783343fc";
const OWN = `/api/public/tournaments/${TOKEN}/photos/${UUID}.webp`;

describe("parse.ts: referência de foto do atleta", () => {
  it("aceita a foto própria (/api/public/tournaments/<token>/photos/<uuid>.webp), o upload do aluno e https", () => {
    expect(asImageRef(OWN)).toBe(OWN);
    expect(asImageRef(`  ${OWN}  `)).toBe(OWN); // aparado
    expect(asImageRef("/api/uploads/aaaaaaaa-aaaa-4aaa-8aaa-000000000002.webp")).toBe("/api/uploads/aaaaaaaa-aaaa-4aaa-8aaa-000000000002.webp");
    expect(asImageRef("https://cdn.exemplo.com/a.jpg")).toBe("https://cdn.exemplo.com/a.jpg");
    expect(isTournamentPhotoPath(OWN)).toBe(true);
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:image/png;base64,AAAA"],
    ["//host (protocolo relativo)", `//evil.example.com${OWN}`],
    ["com .. (voltar diretório)", `/api/public/tournaments/${TOKEN}/photos/../../../uploads/x.webp`],
    ["com .. no lugar do token", `/api/public/tournaments/../photos/${UUID}.webp`],
    ["arquivo que não é uuid", `/api/public/tournaments/${TOKEN}/photos/foto.webp`],
    ["extensão diferente de .webp", `/api/public/tournaments/${TOKEN}/photos/${UUID}.jpg`],
    ["sem extensão", `/api/public/tournaments/${TOKEN}/photos/${UUID}`],
    ["token curto demais", `/api/public/tournaments/abc/photos/${UUID}.webp`],
    ["token com caractere inválido", `/api/public/tournaments/${TOKEN.slice(0, -1)}%/photos/${UUID}.webp`],
    ["query string", `${OWN}?x=1`],
    ["âncora", `${OWN}#x`],
    ["barra a mais depois do arquivo", `${OWN}/`],
    ["subcaminho extra", `/api/public/tournaments/${TOKEN}/photos/sub/${UUID}.webp`],
    ["rota de outro recurso", `/api/public/tournaments/${TOKEN}/${UUID}.webp`],
    ["sem a barra inicial", OWN.slice(1)],
    ["maiúsculas no uuid", `/api/public/tournaments/${TOKEN}/photos/${UUID.toUpperCase()}.webp`],
    ["vazio", ""],
  ])("rejeita %s", (_label, value) => {
    expect(asImageRef(value)).toBeNull();
    expect(isTournamentPhotoPath(value)).toBe(false);
  });

  it("não-string vira null", () => {
    for (const value of [undefined, null, 5, {}, [OWN]]) expect(asImageRef(value)).toBeNull();
  });

  it("no snapshot: a foto própria do atleta sobrevive ao parser; um caminho malformado vira null (o atleta continua na chave)", () => {
    const raw = {
      revision: 1,
      serverTime: "2026-11-12T00:00:00.000Z",
      event: { title: "Camp", date: "2026-11-13T00:00:00.000Z", location: null, imageUrl: null },
      organizationName: "Grupo",
      categories: [
        {
          id: 1,
          name: "Adulto",
          format: "SINGLE_ELIMINATION",
          status: "RUNNING",
          thirdPlace: false,
          competitors: [
            { id: 1, name: "Com foto", group: null, graduation: null, photoUrl: OWN, seed: null, poolIndex: null },
            { id: 2, name: "Malformada", group: null, graduation: null, photoUrl: `/api/public/tournaments/${TOKEN}/photos/../x.webp`, seed: null, poolIndex: null },
            { id: 3, name: "Oculta", group: null, graduation: null, photoUrl: null, seed: null, poolIndex: null },
          ],
          matches: [],
          standings: [],
          podium: [],
        },
      ],
    };
    const parsed = parsePublicSnapshot(raw)!;
    expect(parsed.categories[0]!.competitors.map((c) => c.photoUrl)).toEqual([OWN, null, null]);
    expect(parsed.categories[0]!.competitors.map((c) => c.name)).toEqual(["Com foto", "Malformada", "Oculta"]);
  });
});

describe("imageSrc: a foto própria do atleta é resolvida contra a origem da API (como /api/uploads)", () => {
  it("prefixa a origem da API (sem o /api final); URLs externas e caminhos desconhecidos passam como vieram", () => {
    const origin = API_URL.replace(/\/api\/?$/, "");
    expect(imageSrc(OWN)).toBe(`${origin}${OWN}`);
    expect(imageSrc("https://cdn.exemplo.com/a.jpg")).toBe("https://cdn.exemplo.com/a.jpg");
    expect(imageSrc(`/api/public/tournaments/${TOKEN}/photos/foto.webp`)).toBe(`/api/public/tournaments/${TOKEN}/photos/foto.webp`);
    expect(imageSrc(null)).toBe("");
  });
});

describe("Avatar com a foto própria", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("<img> sem referrer, com alt vazio e src na origem da API; se quebrar, iniciais", () => {
    act(() => root.render(<Avatar id={4895} name="Rafaela Adulta" photoUrl={OWN} />));
    const img = host.querySelector("img")!;
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("src")).toBe(imageSrc(OWN));
    expect(host.querySelector("[data-testid=cv-avatar]")!.getAttribute("data-kind")).toBe("photo");
    act(() => {
      img.dispatchEvent(new Event("error"));
    });
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toBe("RA");
    expect(host.querySelector("[data-testid=cv-avatar]")!.getAttribute("data-kind")).toBe("initials");
  });
});

describe("telão com o JSON real que tem foto própria de atleta", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  });
  afterEach(() => {
    cleanupMounted();
    vi.unstubAllGlobals();
  });

  const competitors = (): Array<{ name: string; photoUrl: Json }> => {
    const cats = (REAL_WITH_PHOTO as { categories: Array<{ competitors: Array<{ name: string; photoUrl: Json }> }> }).categories;
    return cats.flatMap((c) => c.competitors);
  };

  it("o real tem foto própria (adulto e menor autorizado) e atletas ocultos com photoUrl null", () => {
    const list = competitors();
    expect(list.filter((c) => typeof c.photoUrl === "string").map((c) => c.name).sort()).toEqual(["Lia Menor Autorizada", "Rafaela Adulta"]);
    for (const c of list) expect(c.photoUrl === null || isTournamentPhotoPath(String(c.photoUrl)), c.name).toBe(true);
    expect(list.find((c) => c.name === "Pedro Menor Sem Autorizacao")!.photoUrl).toBeNull();
    expect(list.find((c) => c.name === "Caio Sem Foto")!.photoUrl).toBeNull();
  });

  it("na tela: só os atletas com foto ganham <img> (sem referrer, alt vazio, src na origem da API); os ocultos ficam com iniciais", () => {
    const m = mountLive("tok", false);
    feed(JSON.stringify(REAL_WITH_PHOTO));
    const images = [...m.host.querySelectorAll("img")];
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) {
      expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
      expect(img.getAttribute("alt")).toBe("");
      expect(img.getAttribute("src")).toMatch(/\/api\/public\/tournaments\/[A-Za-z0-9_-]+\/photos\/[0-9a-f-]{36}\.webp$/);
    }
    const sources = new Set(images.map((img) => img.getAttribute("src")));
    expect(sources.size).toBe(2); // Rafaela e Lia: duas fotos distintas
    const text = m.host.textContent ?? "";
    expect(text).toContain("Pedro Menor Sem Autorizacao"); // oculto, mas segue na chave (com iniciais)
    expect(m.host.querySelectorAll("[data-testid=cv-avatar][data-kind=initials]").length).toBeGreaterThan(0);
  }, LONG);
});
