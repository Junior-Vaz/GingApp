import { useQuery } from "@tanstack/react-query";
import { API_URL, api } from "@/lib/api";
import { isMinorByBirthDate } from "@/lib/birthdays";
import { withQuery } from "@/lib/queries";

/* ------------------------------------------------------------------------------------------------
 * Slides "Patrocinado" do banner da Home (docs/CONTRATO_PATROCINADORES.md, secoes 2, 4.1 e 6, e
 * docs/CONTRATO_PATROCINADORES_GRUPO.md, secoes 2 e 6).
 * GET /sponsors/active?studentId= -> { items: SponsorSlide[] } (0 a 2 itens: no maximo 1 do GRUPO + 1 da
 * PLATAFORMA, o do grupo primeiro) e POST /sponsors/:id/impression (sem corpo -> 204).
 *
 * PRIVACIDADE: nada de rastreamento no app. Nenhum script/pixel/imagem de terceiro (as imagens vem de
 * /api/uploads), nada do patrocinador vai para localStorage, e da impressao so' fica na sessao do
 * navegador o ID da campanha (sessionStorage), para contar UMA vez por campanha por sessao.
 * ---------------------------------------------------------------------------------------------- */

/** Escopo do patrocinador: do GRUPO do aluno (patrocinio local do Mestre) ou da PLATAFORMA (nacional/regional). */
export type SponsorScope = "GROUP" | "PLATFORM";

/** Item devolvido por GET /sponsors/active (contrato 4.1 + contrato de grupo 2). Nunca traz contato, preco nem notas. */
export interface SponsorSlide {
  /** Id da campanha. */
  id: number;
  sponsorName: string;
  /** `/api/uploads/<arquivo>` ou null. */
  logoUrl: string | null;
  /** `/api/uploads/<arquivo>` ou null (sem imagem = degrade neutro da marca). */
  imageUrl: string | null;
  title: string;
  text: string;
  ctaLabel: string;
  /** `/api/sponsors/<id>/click?s=<UF>`: o redirecionador do SERVIDOR (o app nunca monta a URL do patrocinador). */
  clickPath: string;
  /** UF usada na contagem ('' se desconhecida). */
  state: string;
  /** 'GROUP' = patrocinador do grupo do aluno; 'PLATFORM' = da plataforma (resposta antiga, sem este campo, = PLATFORM). */
  scope: SponsorScope;
  /** Nome do grupo quando `scope` = 'GROUP' (null se o servidor nao mandou); sempre null na PLATAFORMA. */
  groupName: string | null;
}

export interface SponsorsActiveResponse {
  items: SponsorSlide[];
}

/** Tempo minimo com o slide ativo E a aba visivel antes de contar a impressao. */
export const SPONSOR_IMPRESSION_DELAY_MS = 1000;
/** Quanto a resposta vale antes de uma nova busca. */
export const SPONSOR_STALE_MS = 5 * 60_000;

const CLICK_PATH = /^\/api\/sponsors\/\d+\/click(\?s=[A-Za-z]{2})?$/;
const UPLOAD_PATH = /^\/api\/uploads\/[A-Za-z0-9._-]+$/;

/** Origem da API (sem o sufixo /api): vazia quando a API divide o dominio do app (VITE_API_URL=/api). */
const apiOrigin = (): string => API_URL.replace(/\/api\/?$/, "");

/**
 * Caminho `/api/...` do servidor -> URL usavel em `href`/`src` (prefixa a origem da API em desenvolvimento).
 * Aceita SO' o formato que o contrato promete (clique do redirecionador e `/api/uploads/`); qualquer outra
 * coisa (URL externa, `//host`, `javascript:`) vira null: o app nao abre nem carrega nada de terceiro.
 */
export function sponsorAssetUrl(path: string | null | undefined, kind: "click" | "upload"): string | null {
  if (typeof path !== "string") return null;
  const ok = kind === "click" ? CLICK_PATH.test(path) : UPLOAD_PATH.test(path);
  return ok ? `${apiOrigin()}${path}` : null;
}

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** Valida UM item do servidor; formato fora do contrato = null (o slide simplesmente nao aparece). */
export function parseSponsorSlide(raw: unknown): SponsorSlide | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const { id, sponsorName, title, text, ctaLabel, clickPath, logoUrl, imageUrl, state, scope: rawScope, groupName } = item;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return null;
  if (!isText(sponsorName) || !isText(title) || !isText(text) || !isText(ctaLabel)) return null;
  if (typeof clickPath !== "string" || !CLICK_PATH.test(clickPath)) return null;
  // Sem `scope` (backend antigo) = PLATAFORMA; valor desconhecido = item fora do contrato (descartado).
  if (rawScope !== undefined && rawScope !== null && rawScope !== "GROUP" && rawScope !== "PLATFORM") return null;
  const scope: SponsorScope = rawScope === "GROUP" ? "GROUP" : "PLATFORM";
  return {
    id,
    sponsorName,
    title,
    text,
    ctaLabel,
    clickPath,
    logoUrl: typeof logoUrl === "string" && UPLOAD_PATH.test(logoUrl) ? logoUrl : null,
    imageUrl: typeof imageUrl === "string" && UPLOAD_PATH.test(imageUrl) ? imageUrl : null,
    state: typeof state === "string" ? state : "",
    scope,
    groupName: scope === "GROUP" && isText(groupName) ? groupName.trim() : null,
  };
}

/**
 * Itens validos de `{ items }` (o contrato manda 0 a 2): no maximo 1 por escopo (o primeiro valido de cada escopo ganha,
 * duplicados sao descartados) e o do GRUPO sempre primeiro. Item invalido some em silencio; resposta vazia/torta = [].
 */
export function pickSponsorSlides(response: unknown): SponsorSlide[] {
  const items = (response as { items?: unknown } | null | undefined)?.items;
  if (!Array.isArray(items)) return [];
  let group: SponsorSlide | null = null;
  let platform: SponsorSlide | null = null;
  for (const raw of items) {
    const parsed = parseSponsorSlide(raw);
    if (!parsed) continue;
    if (parsed.scope === "GROUP") group ??= parsed;
    else platform ??= parsed;
  }
  return [...(group ? [group] : []), ...(platform ? [platform] : [])];
}

export interface ViewerMinorInput {
  /** `viewer.isMinor` do passaporte do aluno ATIVO (o servidor so' marca true quando ha data de nascimento < 18 anos). */
  passportIsMinor?: boolean | null | undefined;
  /** Data de nascimento, SE o app a conhecer (ISO). */
  birthDate?: string | null | undefined;
  now?: Date | undefined;
}

/**
 * O perfil ativo e' MENOR de 18 anos pelo que o app sabe? true = o app nem pede nem renderiza o slide.
 * O app so' recebe a menoridade quando existe data de nascimento (passaporte do aluno ativo); "sem data" aqui
 * NAO significa adulto: e' o SERVIDOR quem decide (contrato 5: papel ALUNO sem nenhuma data conta como menor e
 * `/sponsors/active` volta vazio). Por isso falso = "o app nao sabe de nada que o impeca de perguntar".
 */
export function isViewerMinor({ passportIsMinor, birthDate, now }: ViewerMinorInput): boolean {
  if (passportIsMinor === true) return true;
  return isMinorByBirthDate(birthDate, now);
}

export const SPONSORS_ACTIVE_KEY = ["sponsors", "active"] as const;

/**
 * Patrocinadores do banner para o aluno ativo. `data` = a lista (0 a 2 slides; [] = nenhum, resposta vazia/torta).
 * Erro nao e' repetido e nao gera mensagem: o carrossel fica como sempre foi. `enabled=false` NAO faz requisicao.
 */
export function useActiveSponsor(studentId: number | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...SPONSORS_ACTIVE_KEY, studentId ?? null],
    queryFn: async (): Promise<SponsorSlide[]> =>
      pickSponsorSlides(await api.get<SponsorsActiveResponse>(withQuery("/sponsors/active", { studentId }))),
    enabled,
    retry: false,
    staleTime: SPONSOR_STALE_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/* ---------- Impressao (uma vez por campanha por sessao) ---------- */

const IMPRESSION_KEY_PREFIX = "mb_sponsor_imp:";
/** Plano B quando o sessionStorage esta bloqueado (modo privado/cota): vale pela vida da pagina. */
const memorySeen = new Set<number>();

/** Esquece as impressoes em memoria (so' para testes). */
export function resetSponsorImpressionMemory(): void {
  memorySeen.clear();
}

/** true na PRIMEIRA vez que a campanha e' vista nesta sessao (e a marca); false se ja' foi contada. */
function markImpressionSeen(id: number): boolean {
  const key = `${IMPRESSION_KEY_PREFIX}${id}`;
  try {
    if (sessionStorage.getItem(key) !== null) return false;
    sessionStorage.setItem(key, "1");
    return true;
  } catch {
    if (memorySeen.has(id)) return false;
    memorySeen.add(id);
    return true;
  }
}

/**
 * POST /sponsors/:id/impression (sem corpo -> 204), UMA vez por campanha por sessao do navegador. Falha
 * silenciosa (nada de erro/toast/retry: a contagem nao pode atrapalhar o aluno). So' o id da campanha fica
 * guardado (sessionStorage).
 */
export function reportImpressionOnce(id: number): void {
  if (!Number.isInteger(id) || id <= 0) return;
  if (!markImpressionSeen(id)) return;
  void api.post(`/sponsors/${id}/impression`).catch(() => undefined);
}
