import { SponsorCampaignStatus } from '@prisma/client';
import { BR_UFS } from '../../../shared/geo/br-states';

/**
 * Regras PURAS dos patrocinadores (docs/CONTRATO_PATROCINADORES.md), sem banco nem Nest: validacao/normalizacao da URL de
 * destino (secao 2.6), UFs, sorteio ponderado, status efetivo, CTR, anti-robo por User-Agent, URL do redirecionamento e o
 * interruptor SPONSORS_ENABLED. Testadas em test/sponsors.spec.ts.
 */

// ---------------------------------------------------------------------------------------------------------------
// Limites (contrato secoes 3 e 4.3)
// ---------------------------------------------------------------------------------------------------------------

export const SPONSOR_LIMITS = {
  nameMin: 2,
  nameMax: 80,
  contactNameMax: 120,
  contactEmailMax: 200,
  contactPhoneMax: 40,
  documentMax: 30,
  notesMax: 1000,
  titleMin: 2,
  titleMax: 60,
  textMin: 2,
  textMax: 90,
  ctaMin: 2,
  ctaMax: 24,
  urlMax: 500,
  weightMin: 1,
  weightMax: 10,
  windowMaxDays: 366,
  billingNoteMax: 1000,
  priceCentsMax: 100_000_000,
} as const;

export const DEFAULT_CTA_LABEL = 'Conhecer';
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------------------------------------------
// Interruptor de emergencia (contrato 2.7)
// ---------------------------------------------------------------------------------------------------------------

/** SPONSORS_ENABLED: padrao LIGADO; so o texto "false" (qualquer caixa/espacos) desliga. Lido a cada chamada. */
export function sponsorsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SPONSORS_ENABLED?.trim().toLowerCase() !== 'false';
}

// ---------------------------------------------------------------------------------------------------------------
// URL de destino (contrato 2.6)
// ---------------------------------------------------------------------------------------------------------------

export type DestinationUrlResult =
  | { ok: true; url: string; host: string }
  | { ok: false; message: string };

/** Sufixos de nomes que nao sao da internet publica (rede local/interna, mDNS, reservados). */
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.intranet', '.localdomain', '.home.arpa', '.arpa', '.test', '.invalid', '.example', '.onion'];
const PRIVATE_NAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback', 'broadcasthost']);
const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD_RE = /^[a-z]{2,63}$/;

const fail = (message: string): DestinationUrlResult => ({ ok: false, message });

/**
 * Valida e NORMALIZA a URL de destino do patrocinador. Regras: so `https:`; sem usuario/senha; host por NOME publico (nada
 * de IP v4/v6 em qualquer notacao, localhost, rede privada, `.local`/`.internal`...); sem porta (nem a 443 explicita fica
 * gravada: a normalizacao a remove; outra porta = recusa); sem espaco/controle/barra invertida; dominio so ASCII (nome com
 * acento/unicode vira punycode `xn--` e e recusado: evita o golpe do dominio "parecido", ex. `аpple.com` cirilico); ate 500
 * caracteres antes e depois de normalizar. Devolve a forma canonica (WHATWG `href`: host minusculo, porta padrao removida,
 * caminho "/" quando vazio) e o host.
 */
export function validateDestinationUrl(raw: unknown): DestinationUrlResult {
  if (typeof raw !== 'string') return fail('destinationUrl: informe o endereço de destino (https://...).');
  const value = raw.trim();
  if (!value) return fail('destinationUrl: informe o endereço de destino (https://...).');
  if (value.length > SPONSOR_LIMITS.urlMax) {
    return fail(`destinationUrl: o endereço pode ter no máximo ${SPONSOR_LIMITS.urlMax} caracteres.`);
  }
  // Espaco, controle, barra invertida e invisiveis/controle de direcao (zero-width, RLO...: disfarcam o endereco).
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001F\u007F-\u009F\\​-‏‪-‮⁠-⁤⁦-⁩﻿]/.test(value)) {
    return fail('destinationUrl: o endereço não pode ter espaços, caracteres invisíveis/de controle nem barra invertida.');
  }
  if (!/^https:\/\//i.test(value)) return fail('destinationUrl: só aceitamos links seguros que começam com https://.');

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('destinationUrl: endereço inválido.');
  }
  if (url.protocol !== 'https:') return fail('destinationUrl: só aceitamos links seguros que começam com https://.');
  if (url.username !== '' || url.password !== '') {
    return fail('destinationUrl: o endereço não pode conter usuário ou senha.');
  }
  if (url.port !== '') return fail('destinationUrl: o endereço não pode indicar porta (use o endereço padrão do site).');

  const host = url.hostname.toLowerCase();
  if (host.startsWith('[') || host.includes(':')) return fail('destinationUrl: use o nome do site; endereço IP não é aceito.');
  if (host.endsWith('.')) return fail('destinationUrl: endereço inválido (domínio terminado em ponto).');
  const labels = host.split('.');
  // IPv4 em qualquer notacao ja chega normalizado pelo WHATWG (127.1, 0x7f.0.0.1, 2130706433 -> 127.0.0.1).
  if (labels.every((l) => /^\d+$/.test(l)) || /^\d+$/.test(labels[labels.length - 1])) {
    return fail('destinationUrl: use o nome do site; endereço IP não é aceito.');
  }
  if (PRIVATE_NAMES.has(host) || labels.length < 2 || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) {
    return fail('destinationUrl: use um site público da internet (localhost, .local, .internal e redes internas não são aceitos).');
  }
  if (labels.some((l) => l.startsWith('xn--'))) {
    return fail('destinationUrl: use o domínio sem acentos ou caracteres especiais (domínios internacionalizados não são aceitos).');
  }
  if (!labels.every((l) => LABEL_RE.test(l)) || !TLD_RE.test(labels[labels.length - 1])) {
    return fail('destinationUrl: endereço inválido (domínio com caracteres não permitidos).');
  }
  const normalized = url.href;
  if (normalized.length > SPONSOR_LIMITS.urlMax) {
    return fail(`destinationUrl: o endereço pode ter no máximo ${SPONSOR_LIMITS.urlMax} caracteres.`);
  }
  return { ok: true, url: normalized, host };
}

/**
 * URL final do redirecionamento do clique: a URL GRAVADA + utm_source=gingapp&utm_medium=parceiro&utm_campaign=c<id>.
 * PRESERVA a query que ja existir (inclusive um utm_* do proprio patrocinador: nao e sobrescrito) e o fragmento (#...).
 */
export function clickRedirectUrl(storedUrl: string, campaignId: number): string {
  const url = new URL(storedUrl);
  const wanted: Array<[string, string]> = [
    ['utm_source', 'gingapp'],
    ['utm_medium', 'parceiro'],
    ['utm_campaign', `c${campaignId}`],
  ];
  const extra = wanted
    .filter(([key]) => !url.searchParams.has(key))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  if (extra) {
    const current = url.search.startsWith('?') ? url.search.slice(1) : url.search;
    url.search = current ? `${current}&${extra}` : extra;
  }
  return url.href;
}

// ---------------------------------------------------------------------------------------------------------------
// UFs
// ---------------------------------------------------------------------------------------------------------------

const UF_SET = new Set(BR_UFS);

/** Sigla de UF valida (qualquer caixa/espacos) -> sigla em maiusculas; qualquer outra coisa -> '' (desconhecida). */
export function toUf(value: unknown): string {
  if (typeof value !== 'string') return '';
  const uf = value.trim().toUpperCase();
  return UF_SET.has(uf) ? uf : '';
}

/**
 * Lista de UFs da campanha: cada item precisa ser uma das 27 siglas (aceita minusculas); sem repetidas; ordenada.
 * Vazia = Brasil todo. Item invalido -> erro com a lista dos invalidos.
 */
export function normalizeStates(values: unknown): { ok: true; states: string[] } | { ok: false; message: string } {
  if (!Array.isArray(values)) return { ok: false, message: 'states deve ser uma lista de siglas de UF (ex.: ["GO","SP"]).' };
  const invalid: string[] = [];
  const out = new Set<string>();
  for (const v of values) {
    const uf = toUf(v);
    if (!uf) invalid.push(typeof v === 'string' ? v.slice(0, 10) : String(v).slice(0, 10));
    else out.add(uf);
  }
  if (invalid.length > 0) {
    return { ok: false, message: `states contém UF inválida: ${invalid.slice(0, 5).join(', ')}. Use as 27 siglas (ex.: GO, SP, DF).` };
  }
  return { ok: true, states: [...out].sort() };
}

// ---------------------------------------------------------------------------------------------------------------
// Janela, status efetivo, elegibilidade, sorteio, CTR
// ---------------------------------------------------------------------------------------------------------------

/** Erro da janela de datas (ou null): endsAt > startsAt e no maximo 366 dias. */
export function windowError(startsAt: Date, endsAt: Date): string | null {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return 'startsAt/endsAt: datas inválidas.';
  if (endsAt.getTime() <= startsAt.getTime()) return 'endsAt: o fim da campanha deve ser depois do início (startsAt).';
  if (endsAt.getTime() - startsAt.getTime() > SPONSOR_LIMITS.windowMaxDays * DAY_MS) {
    return `endsAt: a campanha pode durar no máximo ${SPONSOR_LIMITS.windowMaxDays} dias.`;
  }
  return null;
}

export type EffectiveStatus = 'DRAFT' | 'PAUSED' | 'SCHEDULED' | 'ACTIVE_NOW' | 'ENDED';
export const EFFECTIVE_STATUSES: readonly EffectiveStatus[] = ['DRAFT', 'PAUSED', 'SCHEDULED', 'ACTIVE_NOW', 'ENDED'];

/**
 * Status efetivo (calculado nas leituras). ENDED vence qualquer status gravado (a janela passou: nada mais vai ao ar); depois
 * DRAFT/PAUSED como gravados; ACTIVE vira SCHEDULED antes do inicio e ACTIVE_NOW dentro de [startsAt, endsAt).
 */
export function effectiveStatus(
  c: { status: SponsorCampaignStatus | string; startsAt: Date; endsAt: Date },
  now: Date = new Date(),
): EffectiveStatus {
  const t = now.getTime();
  if (t >= c.endsAt.getTime()) return 'ENDED';
  if (c.status === 'DRAFT') return 'DRAFT';
  if (c.status === 'PAUSED') return 'PAUSED';
  return t < c.startsAt.getTime() ? 'SCHEDULED' : 'ACTIVE_NOW';
}

/** Elegivel AGORA (contrato secao 3): ACTIVE e now em [startsAt, endsAt). */
export function isEligibleNow(c: { status: SponsorCampaignStatus | string; startsAt: Date; endsAt: Date }, now: Date = new Date()): boolean {
  return effectiveStatus(c, now) === 'ACTIVE_NOW';
}

/** A campanha aparece para um espectador da UF `uf`? Lista vazia = Brasil todo; com lista, so se a UF (conhecida) estiver nela. */
export function matchesRegion(states: readonly string[], uf: string): boolean {
  return states.length === 0 || (uf !== '' && states.includes(uf));
}

/**
 * Sorteio ponderado de UM item por `weight` (pesos <= 0 ou invalidos contam como 1). `rng` injetavel (testes): valor em [0, 1).
 * A ordem de entrada importa (o chamador ordena por id para o resultado ser reproduzivel com o mesmo rng).
 */
export function pickWeighted<T extends { weight: number }>(items: readonly T[], rng: () => number = Math.random): T | null {
  if (items.length === 0) return null;
  const weights = items.map((i) => (Number.isFinite(i.weight) && i.weight > 0 ? i.weight : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.min(Math.max(rng(), 0), 0.999_999_999) * total;
  for (let i = 0; i < items.length; i += 1) {
    if (r < weights[i]) return items[i];
    r -= weights[i];
  }
  return items[items.length - 1];
}

/** CTR = cliques / impressoes em %, 2 casas; 0 sem impressoes. */
export function ctrPercent(impressions: number, clicks: number): number {
  if (!impressions || impressions <= 0) return 0;
  return Math.round((clicks / impressions) * 10_000) / 100;
}

// ---------------------------------------------------------------------------------------------------------------
// Anti-robo simples (impressao)
// ---------------------------------------------------------------------------------------------------------------

const BOT_UA = /bot\b|bot\/|crawl|spider|slurp|scrape|curl\/|wget|python|httpclient|http-client|okhttp|java\/|go-http|libwww|headless|phantom|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp|telegram|embedly|axios\/|node-fetch|undici|postman|insomnia|monitor|uptime|pingdom|^mozilla\/[0-4]\.0$/i;

/** User-Agent ausente, curto demais ou de robo/ferramenta conhecida = nao conta impressao. Nunca e gravado nem logado. */
export function looksLikeBot(userAgent: unknown): boolean {
  if (typeof userAgent !== 'string') return true;
  const ua = userAgent.trim();
  if (ua.length < 10) return true;
  return BOT_UA.test(ua);
}

// ---------------------------------------------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------------------------------------------

/** Texto com cara de HTML (tag, comentario, doctype): recusado nos campos de texto puro. */
export function looksLikeHtml(text: string): boolean {
  return /<\s*[a-z!/?]/i.test(text);
}

/** 'YYYY-MM-DD' valido (calendario real)? */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// ---------------------------------------------------------------------------------------------------------------
// Patrocinadores do GRUPO (docs/CONTRATO_PATROCINADORES_GRUPO.md)
// ---------------------------------------------------------------------------------------------------------------

/** Limites anti-abuso por grupo (contrato do grupo secao 3): 10 patrocinadores, 10 campanhas, 3 ACTIVE ao mesmo tempo. */
export const GROUP_SPONSOR_LIMITS = { sponsors: 10, campaigns: 10, activeCampaigns: 3 } as const;

/** Motivo de suspensao/bloqueio pela plataforma: 3..300 caracteres de texto puro. */
export const SPONSOR_REASON_LIMITS = { min: 3, max: 300 } as const;

export type SponsorScope = 'GROUP' | 'PLATFORM';

/** Escopo pela coluna organizationId: nulo = PLATAFORMA; preenchido = GRUPO. */
export function campaignScope(organizationId: number | null | undefined): SponsorScope {
  return organizationId === null || organizationId === undefined ? 'PLATFORM' : 'GROUP';
}

/**
 * Regras de campo EXCLUSIVAS da campanha de grupo: `states` so vazio (sem segmentacao por UF) e `weight` so 1. Ausente =
 * ok (o servico grava [] e 1). Devolve o primeiro erro (campo + mensagem em portugues) ou null.
 */
export function groupCampaignFieldError(input: { states?: unknown; weight?: unknown }): { field: 'states' | 'weight'; message: string } | null {
  if (input.states !== undefined && input.states !== null && !(Array.isArray(input.states) && input.states.length === 0)) {
    return { field: 'states', message: 'states: campanha do grupo não tem segmentação por UF (deixe vazio: aparece para os membros do grupo).' };
  }
  if (input.weight !== undefined && input.weight !== null && input.weight !== 1) {
    return { field: 'weight', message: 'weight: campanha do grupo tem peso fixo 1.' };
  }
  return null;
}

/** O grupo aceitou o termo na versao VIGENTE? (aceite de versao antiga = precisa aceitar de novo). */
export function termsAccepted(acceptedVersion: string | null | undefined, currentVersion: string): boolean {
  return typeof acceptedVersion === 'string' && acceptedVersion === currentVersion;
}

/**
 * Campanha pode ir ao ar AGORA considerando o escopo: elegivel (ACTIVE na janela) e, se for de GRUPO, sem suspensao da
 * plataforma e com o grupo dono nao bloqueado. Campanha de plataforma ignora os dois campos de grupo.
 */
export function isServableNow(
  c: { status: SponsorCampaignStatus | string; startsAt: Date; endsAt: Date; organizationId: number | null; platformSuspendedAt: Date | null },
  groupBlockedAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!isEligibleNow(c, now)) return false;
  if (c.organizationId === null) return true;
  return c.platformSuspendedAt === null && groupBlockedAt === null;
}

/**
 * Impressao conta para o espectador do grupo `viewerOrganizationId`? Plataforma: so a elegibilidade (a regiao e conferida a
 * parte). Grupo: so para espectador DO MESMO grupo e se a campanha puder ir ao ar (sem suspensao/bloqueio).
 */
export function impressionCountsFor(
  c: { status: SponsorCampaignStatus | string; startsAt: Date; endsAt: Date; organizationId: number | null; platformSuspendedAt: Date | null },
  groupBlockedAt: Date | null,
  viewerOrganizationId: number,
  now: Date = new Date(),
): boolean {
  if (c.organizationId !== null && c.organizationId !== viewerOrganizationId) return false;
  return isServableNow(c, groupBlockedAt, now);
}

/** Ordem do banner: o slide do GRUPO primeiro, depois o da PLATAFORMA (estavel dentro do mesmo escopo). */
export function orderSlidesByScope<T extends { scope: SponsorScope }>(items: readonly T[]): T[] {
  return [...items.filter((i) => i.scope === 'GROUP'), ...items.filter((i) => i.scope === 'PLATFORM')];
}

/**
 * Suspender pela plataforma: campanha ACTIVE passa a PAUSED (a aprovacao fica) para que levantar a suspensao NAO a coloque no
 * ar sozinha (o Mestre decide retomar); DRAFT/PAUSED ficam como estao.
 */
export function statusAfterSuspend(status: SponsorCampaignStatus): SponsorCampaignStatus {
  return status === SponsorCampaignStatus.ACTIVE ? SponsorCampaignStatus.PAUSED : status;
}

/** Motivo (suspensao/bloqueio): texto puro com espacos normalizados, 3..300, sem HTML. */
export function normalizeReason(raw: unknown): { ok: true; reason: string } | { ok: false; message: string } {
  if (typeof raw !== 'string') return { ok: false, message: 'reason: informe o motivo (3 a 300 caracteres).' };
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (looksLikeHtml(text)) return { ok: false, message: 'reason: use texto puro, sem HTML.' };
  if (text.length < SPONSOR_REASON_LIMITS.min) return { ok: false, message: `reason: mínimo de ${SPONSOR_REASON_LIMITS.min} caracteres.` };
  if (text.length > SPONSOR_REASON_LIMITS.max) return { ok: false, message: `reason: no máximo ${SPONSOR_REASON_LIMITS.max} caracteres.` };
  return { ok: true, reason: text };
}
