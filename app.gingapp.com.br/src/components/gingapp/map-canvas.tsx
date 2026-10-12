import { useEffect, useRef, useState } from "react";
import type { MarkerClusterer } from "@googlemaps/markerclusterer";
import { Button } from "@/components/ui/button";
import type { GoogleMapsApi } from "@/lib/google-maps";
import { PLACE_META, type MapPlace, type NearMe } from "@/lib/map";
import {
  classicClusterIcon,
  classicPinIcon,
  createClusterElement,
  createPinElement,
  markerLabel,
} from "@/lib/map-markers";

/**
 * Tela do mapa: a ÚNICA peça que fala com o Google. Chunk lazy — o SDK (`@googlemaps/js-api-loader`) e o
 * agrupador (`@googlemaps/markerclusterer`) são importados dinamicamente aqui dentro, só depois que a aba
 * Mapa é aberta. Com Map ID usa AdvancedMarkerElement (pins em HTML); sem ele, marcadores clássicos com
 * ícone SVG. Cores/estilo: sem Map ID aplica o estilo verde da marca (sem POIs); com Map ID o estilo é o
 * da nuvem do Google (o Google ignora `styles` quando há mapId).
 */

const BRAZIL = { lat: -14.235, lng: -51.925 };

/** Paleta suave verde, sem pontos de interesse/transporte poluindo o mapa. */
const BRAND_STYLE: google.maps.MapTypeStyle[] = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#e6efe3" }] },
  { featureType: "landscape.man_made", elementType: "geometry", stylers: [{ color: "#eff4ed" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#bfdcd3" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#d9e8d3" }] },
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#b3c9b0" }],
  },
  { elementType: "labels.text.fill", stylers: [{ color: "#4a5f52" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f4f8f2" }] },
];

const isCompact = () =>
  typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;

/** Estende os limites até o raio de "Perto de mim" (aproximação plana, suficiente para enquadrar). */
function extendWithCircle(bounds: google.maps.LatLngBounds, near: NearMe) {
  const dLat = near.radiusKm / 111.32;
  const dLng = near.radiusKm / (111.32 * Math.max(0.1, Math.cos((near.lat * Math.PI) / 180)));
  bounds.extend({ lat: near.lat + dLat, lng: near.lng + dLng });
  bounds.extend({ lat: near.lat - dLat, lng: near.lng - dLng });
}

interface Entry {
  place: MapPlace;
  marker: google.maps.Marker | google.maps.marker.AdvancedMarkerElement;
  element: HTMLElement | null;
}

export interface MapCanvasProps {
  apiKey: string;
  mapId: string | null;
  places: MapPlace[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Círculo de "Perto de mim". */
  near: NearMe | null;
  /** Muda quando o CONJUNTO de resultados muda: reenquadra o mapa nos pins. */
  fitToken: string;
  /** Falso enquanto o mapa está escondido (aba Lista): ao voltar, reenquadra. */
  active: boolean;
  onStatus?: (status: "loading" | "ready" | "error") => void;
}

export default function MapCanvas({
  apiKey,
  mapId,
  places,
  selectedId,
  onSelect,
  near,
  fitToken,
  active,
  onStatus,
}: MapCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const apiRef = useRef<GoogleMapsApi | null>(null);
  const clusterRef = useRef<MarkerClusterer | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const entries = useRef<Map<string, Entry>>(new Map());
  const onSelectRef = useRef(onSelect);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [authError, setAuthError] = useState(false);
  const advanced = status === "ready" && !!mapId && !!apiRef.current?.AdvancedMarkerElement;

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);

  /* 1) Carrega o SDK e cria o mapa (uma vez por tentativa). */
  useEffect(() => {
    let cancelled = false;
    const pins = entries.current;
    // O Google avisa por esta função global quando a chave é inválida/sem permissão para este domínio.
    const win = window as Window & { gm_authFailure?: () => void };
    const previousAuthHandler = win.gm_authFailure;
    win.gm_authFailure = () => {
      if (cancelled) return;
      setAuthError(true);
      setStatus("error");
    };
    setAuthError(false);
    setStatus("loading");
    (async () => {
      try {
        const [{ loadGoogleMaps }, clusterer] = await Promise.all([
          import("@/lib/google-maps"),
          import("@googlemaps/markerclusterer"),
        ]);
        const api = await loadGoogleMaps(apiKey);
        if (cancelled || !host.current) return;
        apiRef.current = api;
        const map = new api.Map(host.current, {
          center: BRAZIL,
          zoom: 4,
          minZoom: 3,
          disableDefaultUI: true,
          zoomControl: true,
          fullscreenControl: false,
          streetViewControl: false,
          mapTypeControl: false,
          clickableIcons: false,
          gestureHandling: "greedy",
          ...(mapId ? { mapId } : { styles: BRAND_STYLE }),
        });
        mapRef.current = map;
        const useAdvanced = !!mapId && !!api.AdvancedMarkerElement;
        clusterRef.current = new clusterer.MarkerClusterer({
          map,
          markers: [],
          algorithm: new clusterer.SuperClusterAlgorithm({ radius: 70, maxZoom: 15 }),
          renderer: {
            render: ({ count, position }, stats) => {
              const large = count > Math.max(10, stats.clusters.markers.mean);
              if (useAdvanced && api.AdvancedMarkerElement) {
                return new api.AdvancedMarkerElement({
                  position,
                  content: createClusterElement(count, large),
                  title: `${count} locais`,
                  zIndex: 1000 + count,
                });
              }
              const icon = classicClusterIcon(count);
              return new api.Marker({
                position,
                icon: {
                  url: icon.url,
                  scaledSize: new google.maps.Size(icon.width, icon.height),
                  anchor: new google.maps.Point(icon.anchorX, icon.anchorY),
                },
                title: `${count} locais`,
                zIndex: 1000 + count,
              });
            },
          },
        });
        setStatus("ready");
      } catch (error) {
        console.error("[mapa] falha ao carregar o Google Maps", error);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      if (previousAuthHandler) win.gm_authFailure = previousAuthHandler;
      else delete win.gm_authFailure;
      clusterRef.current?.clearMarkers();
      for (const entry of pins.values()) {
        if ("setMap" in entry.marker) entry.marker.setMap(null);
        else entry.marker.map = null;
      }
      pins.clear();
      circleRef.current?.setMap(null);
      circleRef.current = null;
      clusterRef.current = null;
      mapRef.current = null;
    };
  }, [apiKey, mapId, attempt]);

  /* 2) Pins: recriados quando o conjunto de resultados muda. */
  useEffect(() => {
    const api = apiRef.current;
    const clusterer = clusterRef.current;
    if (status !== "ready" || !api || !clusterer) return;
    clusterer.clearMarkers();
    for (const entry of entries.current.values()) {
      if ("setMap" in entry.marker) entry.marker.setMap(null);
      else entry.marker.map = null;
    }
    entries.current.clear();

    const timers: number[] = [];
    // Falha ao criar os pins (SDK em estado inválido: chave recusada, Map ID inexistente...): vira o aviso de erro
    // do mapa em vez de derrubar a tela; a lista ao lado segue funcionando.
    try {
      const markers = places.map((place, index) => {
        const position = { lat: place.latitude, lng: place.longitude };
        const click = () => onSelectRef.current(place.id);
        let marker: Entry["marker"];
        let element: HTMLElement | null = null;
        if (advanced && api.AdvancedMarkerElement) {
          element = createPinElement(place);
          // Entrada leve e escalonada; a classe sai logo depois para a animação não repetir a cada recluster.
          element.style.setProperty("--delay", `${Math.min(index, 20) * 25}ms`);
          element.classList.add("is-new");
          timers.push(window.setTimeout(() => element?.classList.remove("is-new"), 900));
          marker = new api.AdvancedMarkerElement({
            position,
            content: element,
            title: markerLabel(place),
            gmpClickable: true,
            zIndex: place.isMine ? 10 : 1,
          });
          marker.addEventListener("gmp-click", click);
        } else {
          const icon = classicPinIcon(place);
          marker = new api.Marker({
            position,
            title: markerLabel(place),
            icon: {
              url: icon.url,
              scaledSize: new google.maps.Size(icon.width, icon.height),
              anchor: new google.maps.Point(icon.anchorX, icon.anchorY),
            },
            zIndex: place.isMine ? 10 : 1,
          });
          marker.addListener("click", click);
        }
        entries.current.set(place.id, { place, marker, element });
        return marker;
      });
      clusterer.addMarkers(markers);
    } catch (error) {
      console.error("[mapa] falha ao criar os pins", error);
      setStatus("error");
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [places, status, advanced]);

  /* 3) Reenquadra quando o conjunto muda (ou o mapa volta a ser visível). */
  useEffect(() => {
    const api = apiRef.current;
    const map = mapRef.current;
    if (status !== "ready" || !api || !map || !active) return;
    const frame = window.requestAnimationFrame(() => {
      if (places.length === 0) {
        if (near) {
          const area = new api.LatLngBounds();
          extendWithCircle(area, near);
          map.fitBounds(area, 24);
        }
        return;
      }
      if (places.length === 1 && places[0]) {
        map.setCenter({ lat: places[0].latitude, lng: places[0].longitude });
        map.setZoom(14);
        return;
      }
      const bounds = new api.LatLngBounds();
      places.forEach((p) => bounds.extend({ lat: p.latitude, lng: p.longitude }));
      if (near) extendWithCircle(bounds, near);
      map.fitBounds(bounds, isCompact() ? { top: 70, bottom: 70, left: 36, right: 36 } : 56);
    });
    return () => window.cancelAnimationFrame(frame);
    // O conjunto é identificado pelo token (a lista inteira mudar de identidade a cada render não deve reenquadrar).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, fitToken, active]);

  /* 4) Círculo do raio de "Perto de mim". */
  useEffect(() => {
    const api = apiRef.current;
    const map = mapRef.current;
    if (status !== "ready" || !api || !map) return;
    if (!near) {
      circleRef.current?.setMap(null);
      circleRef.current = null;
      return;
    }
    const options = {
      center: { lat: near.lat, lng: near.lng },
      radius: near.radiusKm * 1000,
      strokeColor: PLACE_META.UNIT.color,
      strokeOpacity: 0.7,
      strokeWeight: 2,
      fillColor: PLACE_META.UNIT.color,
      fillOpacity: 0.08,
      clickable: false,
    };
    if (circleRef.current) circleRef.current.setOptions(options);
    else circleRef.current = new api.Circle({ ...options, map });
  }, [status, near]);

  /* 5) Item selecionado: destaca o pin, dá zoom e centraliza (acima do cartão no celular). */
  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map) return;
    let timer: number | undefined;
    for (const [id, entry] of entries.current) {
      const isSelected = id === selectedId;
      if (entry.element) entry.element.classList.toggle("is-selected", isSelected);
      else if ("setIcon" in entry.marker) {
        const icon = classicPinIcon(entry.place, isSelected);
        entry.marker.setIcon({
          url: icon.url,
          scaledSize: new google.maps.Size(icon.width, icon.height),
          anchor: new google.maps.Point(icon.anchorX, icon.anchorY),
        });
        entry.marker.setZIndex(isSelected ? 2000 : entry.place.isMine ? 10 : 1);
      } else {
        entry.marker.zIndex = isSelected ? 2000 : entry.place.isMine ? 10 : 1;
      }
    }
    const selected = selectedId ? entries.current.get(selectedId) : undefined;
    if (selected) {
      map.panTo({ lat: selected.place.latitude, lng: selected.place.longitude });
      if ((map.getZoom() ?? 0) < 16) map.setZoom(16);
      // O cartão ocupa a parte de baixo no celular: sobe o pin para o centro da área livre.
      if (isCompact()) timer = window.setTimeout(() => map.panBy(0, 120), 320);
    }
    return () => window.clearTimeout(timer);
  }, [selectedId, status, places]);

  return (
    <div className="map-canvas">
      <div
        ref={host}
        className="map-canvas-host"
        aria-label="Mapa interativo com os locais da comunidade"
      />
      {status === "loading" && (
        <div className="map-overlay" role="status">
          <span className="map-spinner" aria-hidden="true" />
          Preparando o mapa…
        </div>
      )}
      {status === "error" && (
        <div className="map-overlay" role="alert">
          <p>
            {authError
              ? "O Google Maps recusou a chave deste site."
              : "Não foi possível carregar o Google Maps agora."}
          </p>
          <p className="map-overlay-sub">
            {authError
              ? "Avise o administrador do GingApp (chave inválida ou sem permissão para este domínio). A lista ao lado continua funcionando."
              : "A lista ao lado continua funcionando. Verifique a conexão e tente de novo."}
          </p>
          {!authError && (
            <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Tentar novamente
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
