import { Injectable, Logger } from '@nestjs/common';
import { Coordinates, CoordinatesInput, resolveCoordinatesInput } from './coordinates';

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
/** Timeout curto: a geocodificacao e' um extra opcional, nunca pode travar o salvamento. */
const GEOCODE_TIMEOUT_MS = 4000;
/** Teto do texto enviado ao Google (endereco + cidade + UF cabem folgados). */
const MAX_QUERY_LENGTH = 300;

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

/**
 * Geocodificacao OPCIONAL (endereco -> latitude/longitude) pela Google Geocoding API, para o mapa da
 * comunidade (GET /map/places). SSOT unico: unidade, evento, roda e o botao "Localizar pelo endereco" do painel
 * (POST /map/geocode) passam todos por aqui.
 *
 * - Chave: GOOGLE_MAPS_SERVER_KEY (preferida, restrita por IP/API no Google Cloud) ou GOOGLE_MAPS_API_KEY.
 *   Lida a cada chamada (nenhum estado). Sem chave => `geocode` devolve null (nunca erro) e `isEnabled()` e' false.
 * - NUNCA lanca: timeout, rede, HTTP != 200, status != OK, JSON invalido => null. A chave jamais e' logada
 *   (a URL com a chave nunca vai para o log; so' o status devolvido pelo Google).
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  /** Trocavel nos testes (nenhuma chamada real ao Google). */
  fetchImpl: FetchLike = (url, init) => fetch(url, init);

  private apiKey(): string | null {
    const key = (process.env.GOOGLE_MAPS_SERVER_KEY || process.env.GOOGLE_MAPS_API_KEY || '').trim();
    return key || null;
  }

  isEnabled(): boolean {
    return this.apiKey() !== null;
  }

  /** Geocodifica um texto livre (ex.: "Rua X, 10, Goiania, GO"). null = sem chave, sem resultado ou falha. */
  async geocode(query: string | null | undefined): Promise<Coordinates | null> {
    const key = this.apiKey();
    const text = (query ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
    if (!key || !text) return null;
    try {
      const url = `${GEOCODE_URL}?${new URLSearchParams({ address: text, region: 'br', language: 'pt-BR', key })}`;
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS) });
      if (!response.ok) {
        this.logger.warn(`Geocodificacao: HTTP nao-OK do Google.`);
        return null;
      }
      const body = (await response.json()) as {
        status?: string;
        results?: Array<{ geometry?: { location?: { lat?: unknown; lng?: unknown } } }>;
      };
      if (body.status !== 'OK') {
        if (body.status !== 'ZERO_RESULTS') this.logger.warn(`Geocodificacao: status ${String(body.status)}.`);
        return null;
      }
      const location = body.results?.[0]?.geometry?.location;
      const latitude = location?.lat;
      const longitude = location?.lng;
      if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
      return { latitude, longitude };
    } catch {
      // Timeout/rede: silencioso por design (so' a mensagem generica, jamais a URL — ela carrega a chave).
      this.logger.warn('Geocodificacao: falha de rede ou timeout.');
      return null;
    }
  }

  /** Junta as partes nao vazias (endereco, cidade, UF) e geocodifica; "Brasil" ancora a busca. */
  async geocodeParts(parts: Array<string | null | undefined>): Promise<Coordinates | null> {
    const text = parts
      .map((part) => (part ?? '').trim())
      .filter((part) => part.length > 0)
      .join(', ');
    if (!text) return null;
    return this.geocode(`${text}, Brasil`);
  }

  /**
   * Coordenadas a GRAVAR na criacao: as do corpo (latitude/longitude) se vieram; senao, geocodifica `parts`
   * (se houver chave). Sempre devolve o par (null/null quando nao ha como saber).
   */
  async forCreate(
    input: CoordinatesInput,
    parts: Array<string | null | undefined>,
  ): Promise<{ latitude: number | null; longitude: number | null }> {
    const given = resolveCoordinatesInput(input);
    if (given) return given;
    const found = await this.geocodeParts(parts);
    return found ?? { latitude: null, longitude: null };
  }

  /**
   * Coordenadas a gravar na edicao, ou `undefined` = nao mexer. Corpo com latitude/longitude vence (null/null
   * limpa); senao, SOMENTE se o texto do local mudou (`textChanged`), geocodifica `parts` — se nao achar
   * (sem chave, sem resultado) mantem as coordenadas atuais em vez de apagar o que a pessoa ja informou.
   */
  async forUpdate(
    input: CoordinatesInput,
    textChanged: boolean,
    parts: Array<string | null | undefined>,
  ): Promise<{ latitude: number | null; longitude: number | null } | undefined> {
    const given = resolveCoordinatesInput(input);
    if (given) return given;
    if (!textChanged) return undefined;
    return (await this.geocodeParts(parts)) ?? undefined;
  }
}
