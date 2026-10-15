import { useEffect, useRef, useState } from "react";
import type { MarkerClusterer } from "@googlemaps/markerclusterer";
import { Button } from "@/components/ui/button";
import type { GoogleMapsApi } from "@/lib/google-maps";
import { PLACE_META, PLACE_TYPES, type MapPlace, type NearMe } from "@/lib/map";
import {
  balloonIcon,
  cachedLogo,
  classicClusterIcon,
  createClusterElement,
  createPinElement,
  loadLogo,
  markerLabel,
} from "@/lib/map-markers";

/**
 * Tela do mapa: a ÚNICA peça que fala com o Google. Chunk lazy — o SDK (`@googlemaps/js-api-loader`) e o
 * agrupador (`@googlemaps/markerclusterer`) são importados dinamicamente aqui dentro, só depois que a aba
 * Mapa é aberta. Com Map ID usa AdvancedMarkerElement (pins em HTML com o nome); sem ele, marcadores clássicos
 * com ícone SVG em forma de balão (logo + nome + selo do tipo). Estilo: sem Map ID aplica só a paleta verde
 * suave (ícones/POIs/transporte do Google ficam visíveis); com Map ID o estilo é o da nuvem (o Google ignora
 * `styles` quando há mapId).
 */

const BRAZIL = { lat: -14.235, lng: -51.925 };

/** Só a paleta suave verde — nenhuma regra esconde pontos de interesse, transporte ou ícones. */
const BRAND_STYLE: google.maps.MapTypeStyle[] = [
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#e6efe3" }] },
  { featureType: "landscape.man_made", elementType: "geometry", stylers: [{ color: "#eff4ed" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#bfdcd3" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
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
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;

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
  /** Balão clássico: o logo embutido já está no ícone (senão, iniciais até o logo chegar). */
  logoApplied: boolean;
  selected: boolean;
  /** Deslocamento (px) do balão quando vários locais dividem as mesmas coordenadas (empilha para cima). */
  stack: number;
}

/** Pedido de enquadramento vindo do HUD ("Minha turma" / "Ver tudo"); `n` muda a cada pedido. */
export type ViewRequest =
  | { kind: "all"; n: number }
  | { kind: "point"; lat: number; lng: number; zoom: number; n: number };

export interface MapCanvasProps {
  apiKey: string;
  mapId: string | null;
  places: MapPlace[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Clique no mapa vazio (fora de pins/clusters): fecha o cartão do local. */
  onMapClick?: () => void;
  /** Devolve o foco ao pin ao fechar o cartão pelo teclado (`n` muda a cada pedido, mesmo para o mesmo pin). */
  focusRequest?: { id: string; n: number } | null;
  /** Círculo de "Perto de mim". */
  near: NearMe | null;
  /** Muda quando o CONJUNTO de resultados muda: reenquadra o mapa nos pins (se `autoFit`). */
  fitToken: string;
  /** Falso: não reenquadra sozinho (abrindo na turma do aluno, ou depois que o usuário mexeu no mapa). */
  autoFit?: boolean;
  /** Enquadra tudo / centraliza num ponto, sob demanda. */
  viewRequest?: ViewRequest | null;
  /** O usuário arrastou/deu zoom/tocou no mapa. */
  onUserMove?: () => void;
  /** "Minha localização": centraliza (sem filtrar) e marca o ponto. */
  locateRequest?: { lat: number; lng: number; n: number } | null;
  /** Falso enquanto o mapa está escondido (visão Lista): ao voltar, reenquadra. */
  active: boolean;
  onStatus?: (status: "loading" | "ready" | "error") => void;
}

const Z_SELECTED = 2000;
const zFor = (place: MapPlace, selected: boolean) => (selected ? Z_SELECTED : place.isMine ? 10 : 1);
const LOGO_BATCH = 40;

function toGoogleIcon(icon: ReturnType<typeof balloonIcon>, stack = 0) {
  return {
    url: icon.url,
    scaledSize: new google.maps.Size(icon.width, icon.height),
    // Empilhado: o anchor desce `stack` px, então o balão aparece acima do que fica na ponta do local.
    anchor: new google.maps.Point(icon.anchorX, icon.anchorY + stack),
  };
}

const balloonFor = (place: MapPlace, selected: boolean, stack: number) =>
  toGoogleIcon(
    balloonIcon(place, { selected, logo: cachedLogo(place.organization.logoUrl) ?? null }),
    stack,
  );

const STACK_STEP = 44;
const STACK_MAX = 3;
/**
 * Locais no MESMO ponto (grupo + turmas + eventos usam o mesmo endereço) empilham os balões para cima em vez de se
 * esconderem: o de baixo (grupo > treino > roda > evento) fica na ponta do local. Devolve o deslocamento por id.
 */
function stackOffsets(list: MapPlace[]): Map<string, number> {
  const groups = new Map<string, MapPlace[]>();
  for (const place of list) {
    const key = `${place.latitude.toFixed(5)},${place.longitude.toFixed(5)}`;
    const group = groups.get(key);
    if (group) group.push(place);
    else groups.set(key, [place]);
  }
  const offsets = new Map<string, number>();
  for (const group of groups.values()) {
    group.sort((a, b) => PLACE_TYPES.indexOf(a.type) - PLACE_TYPES.indexOf(b.type));
    group.forEach((place, i) => offsets.set(place.id, Math.min(i, STACK_MAX) * STACK_STEP));
  }
  return offsets;
}

export default function MapCanvas({
  apiKey,
  mapId,
  places,
  selectedId,
  onSelect,
  onMapClick,
  focusRequest,
  near,
  fitToken,
  autoFit = true,
  viewRequest,
  onUserMove,
  locateRequest,
  active,
  onStatus,
}: MapCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const apiRef = useRef<GoogleMapsApi | null>(null);
  const clusterRef = useRef<MarkerClusterer | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const meRef = useRef<google.maps.Circle | null>(null);
  const entries = useRef<Map<string, Entry>>(new Map());
  const onSelectRef = useRef(onSelect);
  const onMapClickRef = useRef(onMapClick);
  const onUserMoveRef = useRef(onUserMove);
  const placesRef = useRef(places);
  const nearRef = useRef(near);
  const selectedRef = useRef(selectedId);
  const appliedView = useRef(-1);
  const appliedLocate = useRef(-1);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [authError, setAuthError] = useState(false);
  const advanced = status === "ready" && !!mapId && !!apiRef.current?.AdvancedMarkerElement;

  useEffect(() => {
    onSelectRef.current = onSelect;
    onMapClickRef.current = onMapClick;
    onUserMoveRef.current = onUserMove;
    placesRef.current = places;
    nearRef.current = near;
    selectedRef.current = selectedId;
  });

  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);

  /* 1) Carrega o SDK e cria o mapa (uma vez por tentativa). */
  useEffect(() => {
    let cancelled = false;
    const pins = entries.current;
    const hostEl = host.current;
    const moved = () => onUserMoveRef.current?.();
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
    appliedView.current = -1;
    appliedLocate.current = -1;
    (async () => {
      try {
        const [{ loadGoogleMaps }, clusterer] = await Promise.all([
          import("@/lib/google-maps"),
          import("@googlemaps/markerclusterer"),
        ]);
        const api = await loadGoogleMaps(apiKey);
        if (cancelled || !host.current) return;
        apiRef.current = api;
        const cp = google.maps.ControlPosition;
        const compact = isCompact();
        // Controles do Google fora das áreas do HUD flutuante (filtros/chips no topo e cartão na base):
        // zoom no meio da borda direita; tipo de mapa no canto superior direito (desktop; o HUD reserva
        // espaço ali) ou empilhado com o zoom (celular); tela cheia logo abaixo e pegman no canto
        // inferior direito, só no desktop. Escala só no desktop.
        const mapTypeStyle = google.maps.MapTypeControlStyle?.DROPDOWN_MENU;
        const map = new api.Map(host.current, {
          center: BRAZIL,
          zoom: 4,
          minZoom: 3,
          disableDefaultUI: true,
          zoomControl: true,
          mapTypeControl: true,
          streetViewControl: !compact,
          fullscreenControl: !compact,
          scaleControl: !compact,
          ...(cp
            ? {
                zoomControlOptions: { position: cp.RIGHT_CENTER },
                mapTypeControlOptions: {
                  position: compact ? cp.RIGHT_CENTER : cp.TOP_RIGHT,
                  ...(mapTypeStyle !== undefined ? { style: mapTypeStyle } : {}),
                  mapTypeIds: ["roadmap", "satellite"],
                },
                streetViewControlOptions: { position: cp.RIGHT_BOTTOM },
                fullscreenControlOptions: { position: cp.RIGHT_TOP },
              }
            : {}),
          // Os ícones do Google continuam visíveis; o toque neles não abre o balão do Google (o cartão do local é nosso).
          clickableIcons: false,
          gestureHandling: "greedy",
          ...(mapId ? { mapId } : { styles: BRAND_STYLE }),
        });
        mapRef.current = map;
        map.addListener("click", () => onMapClickRef.current?.());
        map.addListener("dragstart", moved);
        hostEl?.addEventListener("wheel", moved, { passive: true });
        hostEl?.addEventListener("pointerdown", moved, { passive: true });
        const useAdvanced = !!mapId && !!api.AdvancedMarkerElement;
        clusterRef.current = new clusterer.MarkerClusterer({
          map,
          markers: [],
          // Balões são largos: raio maior agrupa antes que se sobreponham; a partir do zoom 16 aparecem os balões.
          algorithm: new clusterer.SuperClusterAlgorithm({ radius: 90, maxZoom: 15 }),
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
                icon: toGoogleIcon(icon),
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
      hostEl?.removeEventListener("wheel", moved);
      hostEl?.removeEventListener("pointerdown", moved);
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
      meRef.current?.setMap(null);
      meRef.current = null;
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
    // do mapa (com "Tentar novamente") em vez de derrubar a tela.
    try {
      const stacks = advanced ? new Map<string, number>() : stackOffsets(places);
      const markers = places.map((place, index) => {
        const stack = stacks.get(place.id) ?? 0;
        const position = { lat: place.latitude, lng: place.longitude };
        const click = () => onSelectRef.current(place.id);
        const selected = place.id === selectedRef.current;
        let marker: Entry["marker"];
        let element: HTMLElement | null = null;
        if (advanced && api.AdvancedMarkerElement) {
          element = createPinElement(place);
          if (selected) element.classList.add("is-selected");
          // Entrada leve e escalonada; a classe sai logo depois para a animação não repetir a cada recluster.
          element.style.setProperty("--delay", `${Math.min(index, 20) * 25}ms`);
          element.classList.add("is-new");
          timers.push(window.setTimeout(() => element?.classList.remove("is-new"), 900));
          marker = new api.AdvancedMarkerElement({
            position,
            content: element,
            title: markerLabel(place),
            gmpClickable: true,
            zIndex: zFor(place, selected),
          });
          marker.addEventListener("gmp-click", click);
        } else {
          marker = new api.Marker({
            position,
            title: markerLabel(place),
            icon: balloonFor(place, selected, stack),
            zIndex: zFor(place, selected),
          });
          marker.addListener("click", click);
        }
        entries.current.set(place.id, {
          place,
          marker,
          element,
          logoApplied: typeof cachedLogo(place.organization.logoUrl) === "string",
          selected,
          stack,
        });
        return marker;
      });
      clusterer.addMarkers(markers);
    } catch (error) {
      console.error("[mapa] falha ao criar os pins", error);
      setStatus("error");
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [places, status, advanced]);

  /* 2b) Logos dos grupos nos balões: baixa cada URL uma vez e troca os ícones em lotes (pins na tela primeiro). */
  useEffect(() => {
    if (status !== "ready" || advanced) return;
    let cancelled = false;
    let frame = 0;
    const flush = () => {
      frame = 0;
      if (cancelled) return;
      const map = mapRef.current;
      const bounds = map?.getBounds?.();
      const inView = (entry: Entry) =>
        bounds?.contains({ lat: entry.place.latitude, lng: entry.place.longitude }) ? 1 : 0;
      const ready = [...entries.current.values()].filter(
        (entry) =>
          !entry.logoApplied && typeof cachedLogo(entry.place.organization.logoUrl) === "string",
      );
      if (ready.length === 0) return;
      ready.sort((a, b) => inView(b) - inView(a));
      for (const entry of ready.slice(0, LOGO_BATCH)) {
        entry.logoApplied = true;
        if ("setIcon" in entry.marker) entry.marker.setIcon(balloonFor(entry.place, entry.selected, entry.stack));
      }
      if (ready.length > LOGO_BATCH) frame = window.requestAnimationFrame(flush);
    };
    const schedule = () => {
      if (!frame && !cancelled) frame = window.requestAnimationFrame(flush);
    };
    const urls = new Set<string>();
    for (const entry of entries.current.values()) {
      const url = entry.place.organization.logoUrl;
      if (url && cachedLogo(url) === undefined) urls.add(url);
    }
    for (const url of urls) void loadLogo(url).then(schedule);
    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [places, status, advanced]);

  /* 3) Enquadra todos os pins quando o conjunto muda (ou o mapa volta a ser visível) — se `autoFit`. */
  const fitAll = () => {
    const api = apiRef.current;
    const map = mapRef.current;
    if (!api || !map) return;
    const list = placesRef.current;
    const area = nearRef.current;
    if (list.length === 0) {
      if (area) {
        const bounds = new api.LatLngBounds();
        extendWithCircle(bounds, area);
        map.fitBounds(bounds, 24);
      }
      return;
    }
    if (list.length === 1 && list[0]) {
      map.setCenter({ lat: list[0].latitude, lng: list[0].longitude });
      map.setZoom(14);
      return;
    }
    const bounds = new api.LatLngBounds();
    list.forEach((p) => bounds.extend({ lat: p.latitude, lng: p.longitude }));
    if (area) extendWithCircle(bounds, area);
    // Folga para os cartões flutuantes: topo (alternador + chips) e, no desktop, o cartão de filtros à esquerda.
    map.fitBounds(
      bounds,
      isCompact()
        ? { top: 140, bottom: 100, left: 90, right: 90 }
        : { top: 120, bottom: 80, left: 340, right: 120 },
    );
  };
  useEffect(() => {
    if (status !== "ready" || !mapRef.current || !active || !autoFit) return;
    const frame = window.requestAnimationFrame(fitAll);
    return () => window.cancelAnimationFrame(frame);
    // O conjunto é identificado pelo token (a lista inteira mudar de identidade a cada render não deve reenquadrar).
  }, [status, fitToken, active, autoFit]);

  /* 3b) Pedidos do HUD: "Ver tudo" (enquadra todos) e "Minha turma" (centraliza e dá zoom no ponto). */
  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map || !active || !viewRequest) return;
    if (appliedView.current === viewRequest.n) return;
    const frame = window.requestAnimationFrame(() => {
      appliedView.current = viewRequest.n;
      if (viewRequest.kind === "point") {
        map.setCenter({ lat: viewRequest.lat, lng: viewRequest.lng });
        map.setZoom(viewRequest.zoom);
      } else {
        fitAll();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [viewRequest, status, active]);

  /* 3c) "Minha localização": centraliza e marca o ponto (sem filtrar). */
  useEffect(() => {
    const api = apiRef.current;
    const map = mapRef.current;
    if (status !== "ready" || !api || !map || !locateRequest) return;
    if (appliedLocate.current === locateRequest.n) return;
    appliedLocate.current = locateRequest.n;
    const center = { lat: locateRequest.lat, lng: locateRequest.lng };
    map.setCenter(center);
    map.setZoom(15);
    const options = {
      center,
      radius: 45,
      strokeColor: "#2a6f97",
      strokeOpacity: 0.9,
      strokeWeight: 3,
      fillColor: "#2a6f97",
      fillOpacity: 0.3,
      clickable: false,
    };
    if (meRef.current) meRef.current.setOptions(options);
    else meRef.current = new api.Circle({ ...options, map });
  }, [locateRequest, status]);

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

  /* 5) Item selecionado: destaca o pin (por cima dos demais), dá zoom e centraliza (o cartão fica na base). */
  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map) return;
    for (const [id, entry] of entries.current) {
      const isSelected = id === selectedId;
      if (entry.selected === isSelected) continue;
      entry.selected = isSelected;
      if (entry.element) entry.element.classList.toggle("is-selected", isSelected);
      if ("setIcon" in entry.marker) {
        entry.marker.setIcon(balloonFor(entry.place, isSelected, entry.stack));
        entry.marker.setZIndex(zFor(entry.place, isSelected));
      } else {
        entry.marker.zIndex = zFor(entry.place, isSelected);
      }
    }
    const selected = selectedId ? entries.current.get(selectedId) : undefined;
    if (selected) {
      map.panTo({ lat: selected.place.latitude, lng: selected.place.longitude });
      if ((map.getZoom() ?? 0) < 16) map.setZoom(16);
    }
  }, [selectedId, status, places]);

  /* 6) Foco de volta ao pin (Esc no cartão). */
  useEffect(() => {
    if (!focusRequest) return;
    entries.current.get(focusRequest.id)?.element?.focus({ preventScroll: true });
  }, [focusRequest]);

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
              ? "Avise o administrador do GingApp (chave inválida ou sem permissão para este domínio)."
              : "Verifique a conexão e tente de novo."}
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


