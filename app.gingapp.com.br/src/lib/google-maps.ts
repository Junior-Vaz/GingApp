/**
 * Carregador do Google Maps — SÓ é importado pelo chunk do mapa (lazy), nunca pelo bundle inicial.
 * A chave é entregue pelo servidor em runtime (GET /map/config); não existe VITE_* de chave.
 * O loader oficial é funcional e global: `setOptions` vale uma vez por página, então o resultado é
 * memorizado (trocar de aba Lista/Mapa várias vezes não recarrega o SDK).
 */
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

export interface GoogleMapsApi {
  Map: typeof google.maps.Map;
  Circle: typeof google.maps.Circle;
  Marker: typeof google.maps.Marker;
  LatLngBounds: typeof google.maps.LatLngBounds;
  /** Pins em HTML; só são usados com Map ID (sem ele, vale o marcador clássico). */
  AdvancedMarkerElement: typeof google.maps.marker.AdvancedMarkerElement | null;
}

let optionsSetFor: string | null = null;
let cached: { apiKey: string; promise: Promise<GoogleMapsApi> } | null = null;

export function loadGoogleMaps(apiKey: string): Promise<GoogleMapsApi> {
  if (cached && cached.apiKey === apiKey) return cached.promise;
  // setOptions é global e só pode ser chamado uma vez (o loader avisa nas repetições).
  if (optionsSetFor !== apiKey) {
    setOptions({ key: apiKey, v: "weekly", language: "pt-BR", region: "BR" });
    optionsSetFor = apiKey;
  }
  const promise = (async (): Promise<GoogleMapsApi> => {
    const [maps, core, marker] = await Promise.all([
      importLibrary("maps"),
      importLibrary("core"),
      importLibrary("marker"),
    ]);
    return {
      Map: maps.Map,
      Circle: maps.Circle,
      Marker: marker.Marker,
      LatLngBounds: core.LatLngBounds,
      AdvancedMarkerElement: marker.AdvancedMarkerElement ?? null,
    };
  })();
  cached = { apiKey, promise };
  // Falha (rede/chave inválida/extensão bloqueando): permite tentar de novo no próximo "Tentar novamente".
  promise.catch(() => {
    if (cached?.promise === promise) cached = null;
  });
  return promise;
}
