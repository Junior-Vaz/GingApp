import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "@/lib/api";

/** GET /map/config - `geocodingEnabled`: o servidor tem chave do Google para "Localizar pelo endereço". */
export interface MapConfig {
  enabled: boolean;
  apiKey: string | null;
  mapId: string | null;
  geocodingEnabled: boolean;
}

export function useMapConfig() {
  return useQuery({
    queryKey: ["map", "config"],
    queryFn: () => api.get<MapConfig>("/map/config"),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
}

/** POST /map/geocode: 404 (ApiError) quando não achou o endereço ou o servidor está sem chave do Google. */
export const geocodeAddress = (query: string) => api.post<GeocodeResult>("/map/geocode", { query });

/** Aceita vírgula decimal ("-16,6869"); vazio ou inválido => null. */
export function parseCoordinate(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (normalized === "") return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Campo de latitude/longitude do formulário (texto; "" = não informado), com limites e mensagem em pt-BR. */
export const coordinateField = (label: "Latitude" | "Longitude", limit: 90 | 180) =>
  z.string().refine((text) => {
    if (text.trim() === "") return true;
    const value = parseCoordinate(text);
    return value !== null && Math.abs(value) <= limit;
  }, `${label}: informe um número entre -${String(limit)} e ${String(limit)} (ex.: -16.6869).`);

export const latitudeField = coordinateField("Latitude", 90);
export const longitudeField = coordinateField("Longitude", 180);

/** Latitude e longitude andam juntas: uma sem a outra não marca ponto nenhum no mapa. */
export const hasHalfCoordinates = (values: { latitude: string; longitude: string }): boolean =>
  (values.latitude.trim() === "") !== (values.longitude.trim() === "");

/** Valores iniciais do formulário a partir do registro (null => ""). */
export const coordinatesToForm = (record: { latitude?: number | null; longitude?: number | null }) => ({
  latitude: record.latitude === null || record.latitude === undefined ? "" : String(record.latitude),
  longitude: record.longitude === null || record.longitude === undefined ? "" : String(record.longitude),
});

export interface CoordinatesPayload {
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
}

/** CRIAR (POST): só envia o par quando os dois foram informados (senão o servidor tenta geocodificar o endereço). */
export function coordinatesCreatePayload(values: { latitude: string; longitude: string }): CoordinatesPayload {
  const latitude = parseCoordinate(values.latitude);
  const longitude = parseCoordinate(values.longitude);
  return latitude !== null && longitude !== null ? { latitude, longitude } : {};
}

/**
 * EDITAR (PATCH): só envia quando o usuário MUDOU as coordenadas (par novo, ou `null`/`null` ao esvaziar os dois).
 * Sem mudança nada é enviado: assim, ao trocar só o endereço, o servidor re-geocodifica em vez de manter o ponto antigo.
 */
export function coordinatesUpdatePayload(
  values: { latitude: string; longitude: string },
  original: { latitude?: number | null; longitude?: number | null },
): CoordinatesPayload {
  const before = coordinatesToForm(original);
  if (values.latitude.trim() === before.latitude && values.longitude.trim() === before.longitude) return {};
  const latitude = parseCoordinate(values.latitude);
  const longitude = parseCoordinate(values.longitude);
  if (latitude !== null && longitude !== null) return { latitude, longitude };
  if (values.latitude.trim() === "" && values.longitude.trim() === "") return { latitude: null, longitude: null };
  return {};
}

/** Link para conferir o ponto no Google Maps (nova aba). */
export const googleMapsLink = (latitude: number, longitude: number): string =>
  `https://www.google.com/maps/search/?api=1&query=${String(latitude)},${String(longitude)}`;
