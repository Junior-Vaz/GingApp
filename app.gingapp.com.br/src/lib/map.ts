import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { endOfMonth, endOfWeek } from "date-fns";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { withQuery } from "@/lib/queries";

/**
 * Mapa da Comunidade — contrato com o backend (GET /map/config e GET /map/places) e regras puras
 * (filtros, distância, rótulos). Nada aqui importa o Google: o SDK só é carregado, sob demanda, pelo
 * chunk do mapa (ver google-maps.ts). A chave do Google vem de /map/config em runtime — nunca do build.
 */

export type PlaceType = "UNIT" | "EVENT" | "RODA" | "CLASS";

export interface MapConfig {
  enabled: boolean;
  apiKey: string | null;
  mapId: string | null;
}

export interface PlaceOrganization {
  id: number;
  name: string;
  slug: string;
  logoUrl: string | null;
  description: string | null;
}

export interface MapPlace {
  /** "TIPO:id" (ex.: "UNIT:12", "EVENT:7", "RODA:3", "CLASS:9"). */
  id: string;
  type: PlaceType;
  title: string;
  description: string | null;
  latitude: number;
  longitude: number;
  address: string | null;
  city: string | null;
  state: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  /** Treinos: 0 = domingo ... 6 = sábado. */
  weekday?: number | null;
  startTime?: string | null;
  endTime?: string | null;
  /**
   * Treinos: nome livre do local do treino (ex.: "Praça X"). Com local PRÓPRIO, latitude/longitude/address/city/state
   * já são os do treino (o servidor decide; sem local próprio vêm os da unidade) — o app só mostra o que recebe.
   */
  locationLabel?: string | null;
  organization: PlaceOrganization;
  distanceKm?: number | null;
  imageUrl?: string | null;
  /** EVENT: total de vagas (null = ilimitado) e vagas restantes (0 = lotado); ausentes = backend antigo / não é evento. */
  capacity?: number | null;
  spotsLeft?: number | null;
  isMine: boolean;
}

export interface MapPlacesResponse {
  items: MapPlace[];
  total: number;
}

/** Ordem dos chips: Grupos, Treinos, Rodas, Eventos. */
export const PLACE_TYPES: PlaceType[] = ["UNIT", "CLASS", "RODA", "EVENT"];

export interface PlaceTypeMeta {
  label: string;
  /** Singular, para o cartão e o aria-label do marcador. */
  singular: string;
  /** Cor do pin (mesma do chip). */
  color: string;
}

export const PLACE_META: Record<PlaceType, PlaceTypeMeta> = {
  UNIT: { label: "Grupos", singular: "Grupo", color: "#1b5e43" },
  CLASS: { label: "Treinos", singular: "Treino", color: "#2a6f97" },
  RODA: { label: "Rodas", singular: "Roda", color: "#b4472f" },
  EVENT: { label: "Eventos", singular: "Evento", color: "#a65e0a" },
};

export type Period = "all" | "today" | "week" | "month";

export const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Este mês" },
  { value: "all", label: "Tudo" },
];

const DAY = "yyyy-MM-dd";

/** from/to (yyyy-MM-dd, dia civil local) do período. "Tudo" = sem limites (o servidor decide o padrão). */
export function periodRange(
  period: Period,
  now: Date = new Date(),
): { from?: string; to?: string } {
  if (period === "all") return {};
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "today") return { from: fmt(today, DAY), to: fmt(today, DAY) };
  // Semana corrida de segunda a domingo; mês até o último dia.
  const end = period === "week" ? endOfWeek(today, { weekStartsOn: 1 }) : endOfMonth(today);
  return { from: fmt(today, DAY), to: fmt(end, DAY) };
}

export const DEFAULT_RADIUS_KM = 25;
export const RADIUS_OPTIONS = [5, 10, 25, 50, 100];
/** Teto de pins por consulta (o servidor pode aparar); o aviso "mostrando X de Y" cobre o excedente. */
export const MAP_LIMIT = 500;

export interface NearMe {
  lat: number;
  lng: number;
  radiusKm: number;
}

export interface PlacesParams {
  q: string;
  period: Period;
  near: NearMe | null;
}

/** Parâmetros do GET /map/places. Sempre pede os 4 tipos: os contadores dos chips refletem busca/período/raio. */
export function placesQuery(params: PlacesParams, now: Date = new Date()) {
  const { from, to } = periodRange(params.period, now);
  return {
    types: PLACE_TYPES.join(","),
    q: params.q.trim() || undefined,
    from,
    to,
    lat: params.near ? params.near.lat : undefined,
    lng: params.near ? params.near.lng : undefined,
    radiusKm: params.near ? params.near.radiusKm : undefined,
    limit: MAP_LIMIT,
  };
}

/** O toggle "Mapa" só existe com o recurso ligado E uma chave entregue pelo servidor. */
export function isMapAvailable(
  config: MapConfig | undefined | null,
): config is MapConfig & { apiKey: string } {
  return (
    !!config &&
    config.enabled === true &&
    typeof config.apiKey === "string" &&
    config.apiKey.trim() !== ""
  );
}

/** Config do mapa: falha silenciosa (sem chave/erro = toggle oculto, nunca uma mensagem de erro). */
export function useMapConfig(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["map", "config"],
    queryFn: () => api.get<MapConfig>("/map/config", { skipAuthRedirect: true }),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}

export function useMapPlaces(params: PlacesParams, enabled: boolean) {
  const query = placesQuery(params);
  return useQuery({
    queryKey: ["map", "places", query],
    queryFn: () => api.get<MapPlacesResponse>(withQuery("/map/places", query)),
    enabled,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/* ---------- Escolha Lista | Mapa (preferência por navegador) ---------- */

export type CommunityView = "list" | "map";
const VIEW_KEY = "gingapp:community-view";

export function readStoredView(): CommunityView {
  try {
    return localStorage.getItem(VIEW_KEY) === "map" ? "map" : "list";
  } catch {
    return "list";
  }
}

export function storeView(view: CommunityView): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* modo privado / armazenamento bloqueado: a escolha só vale nesta sessão */
  }
}

/* ---------- Geografia e rótulos ---------- */

/** Distância em km entre dois pontos (haversine). */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distância ao usuário: a do servidor, ou calculada aqui quando "Perto de mim" está ligado. */
export function distanceOf(place: MapPlace, near: NearMe | null): number | null {
  if (typeof place.distanceKm === "number") return place.distanceKm;
  if (!near) return null;
  return haversineKm(near, { lat: place.latitude, lng: place.longitude });
}

export function formatDistance(km: number | null | undefined): string {
  if (km === null || km === undefined || !Number.isFinite(km)) return "";
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  return `${km.toLocaleString("pt-BR", { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
}

/** Ordena do mais perto ao mais longe (sem distância, mantém a ordem do servidor); devolve uma cópia. */
export function sortByDistance(places: MapPlace[], near: NearMe | null): MapPlace[] {
  if (!near) return places;
  return [...places].sort(
    (a, b) => (distanceOf(a, near) ?? Infinity) - (distanceOf(b, near) ?? Infinity),
  );
}

/** Rota até o local no Google Maps (app no celular, site no desktop). */
export function directionsUrl(place: Pick<MapPlace, "latitude" | "longitude">): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`;
}

const normalizeName = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

/**
 * Local de abertura do mapa: o treino da turma atual do aluno (`CLASS:<id>`; sem id batendo, o treino de mesmo nome
 * do meu grupo) ou, na falta, a unidade do próprio grupo (`isMine`). Sem nenhum: null (enquadra todos).
 */
export function findHomePlace(
  items: MapPlace[],
  classRef: { id: number; name?: string | null } | null,
): MapPlace | null {
  if (classRef) {
    const byId = items.find((p) => p.type === "CLASS" && p.id === `CLASS:${classRef.id}`);
    if (byId) return byId;
    if (classRef.name) {
      const wanted = normalizeName(classRef.name);
      // Só do meu grupo: o nome de uma turma ("Infantil") se repete entre grupos.
      const found = items.find(
        (p) => p.type === "CLASS" && p.isMine && normalizeName(p.title) === wanted,
      );
      if (found) return found;
    }
  }
  return items.find((p) => p.type === "UNIT" && p.isMine) ?? null;
}

/** Id numérico da entidade ("EVENT:7" -> 7). */
export function placeEntityId(place: Pick<MapPlace, "id">): number {
  return Number(place.id.split(":")[1]);
}

export function countByType(places: MapPlace[]): Record<PlaceType, number> {
  const counts: Record<PlaceType, number> = { UNIT: 0, CLASS: 0, RODA: 0, EVENT: 0 };
  for (const place of places) counts[place.type] += 1;
  return counts;
}

/** Endereço em uma linha: "[Praça X —] Rua X, 10 — Cidade/UF" (o nome do local do treino, quando há, vem na frente). */
export function addressLine(
  place: Pick<MapPlace, "address" | "city" | "state"> & { locationLabel?: string | null },
): string {
  const cityUf = [place.city, place.state].filter(Boolean).join("/");
  return [place.locationLabel, place.address, cityUf].filter(Boolean).join(" — ");
}

const WEEKDAY_FULL = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const hhmm = (time: string | null | undefined) => (time ? time.slice(0, 5) : "");

/** Quando acontece: data+hora para evento/roda; "Quintas, 19:00–20:00" para treino; nada para o grupo. */
export function whenLabel(place: MapPlace, toDateFn: (iso: string) => Date): string {
  if (place.startsAt) {
    const start = toDateFn(place.startsAt);
    const midnightUtc = start.getUTCHours() === 0 && start.getUTCMinutes() === 0;
    const day = fmt(start, "EEE, dd 'de' MMM").replace(".", "");
    const time = midnightUtc ? "" : fmt(start, "HH:mm");
    return `${day.charAt(0).toUpperCase()}${day.slice(1)}${time ? ` • ${time}` : ""}`;
  }
  if (place.weekday !== null && place.weekday !== undefined && WEEKDAY_FULL[place.weekday]) {
    const from = hhmm(place.startTime);
    const to = hhmm(place.endTime);
    const range = from && to ? `${from}–${to}` : from;
    return `${WEEKDAY_FULL[place.weekday]}${range ? ` • ${range}` : ""}`;
  }
  return "";
}

/** Dia e mês curtos do pin de evento/roda ("14", "NOV"); null sem data. */
export function dateBadge(
  place: MapPlace,
  toDateFn: (iso: string) => Date,
): { day: string; month: string } | null {
  if (!place.startsAt) return null;
  const start = toDateFn(place.startsAt);
  return { day: fmt(start, "dd"), month: fmt(start, "MMM").replace(".", "").toUpperCase() };
}
