import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  CalendarDays,
  CircleDot,
  Clock,
  LocateFixed,
  MapPin,
  Navigation,
  Search,
  Users,
  X,
  Check,
  Star,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { initials, toDate } from "@/lib/format";
import {
  DEFAULT_RADIUS_KM,
  MAP_LIMIT,
  PERIODS,
  PLACE_META,
  PLACE_TYPES,
  RADIUS_OPTIONS,
  addressLine,
  countByType,
  directionsUrl,
  distanceOf,
  formatDistance,
  placeEntityId,
  sortByDistance,
  useMapPlaces,
  whenLabel,
  type MapConfig,
  type MapPlace,
  type NearMe,
  type Period,
  type PlaceType,
} from "@/lib/map";
import { useEncounterParticipation } from "@/lib/queries";
import { imageSrc } from "@/lib/uploads";
import MapCanvas from "./map-canvas";

const TYPE_ICON: Record<PlaceType, LucideIcon> = {
  UNIT: Users,
  CLASS: Clock,
  RODA: CircleDot,
  EVENT: CalendarDays,
};

const pinStyle = (type: PlaceType) => ({ "--pin": PLACE_META[type].color }) as CSSProperties;

/** Seletor do item da lista de um local (ids são "TIPO:número"; aspas escapadas por segurança). */
const placeSelector = (id: string) => `[data-place-id="${id.replace(/"/g, '\\"')}"]`;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Logo do grupo em círculo; sem logo (ou imagem quebrada) mostra as iniciais. */
function OrgLogo({ place, className }: { place: MapPlace; className: string }) {
  const [failed, setFailed] = useState(false);
  const logo = place.organization.logoUrl;
  return (
    <span className={className} aria-hidden="true">
      {logo && !failed ? (
        <img src={imageSrc(logo)} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        initials(place.organization.name)
      )}
    </span>
  );
}

/** Inscrição em evento/roda: o mesmo estado/ação do card da lista (useEncounterParticipation, SSOT em queries.ts). */
function ParticipateAction({ place }: { place: MapPlace }) {
  const { count, canJoin, joined, join, pending } = useEncounterParticipation(
    { source: place.type === "RODA" ? "RODA" : "EVENTO", id: placeEntityId(place) },
    true,
  );
  return (
    <>
      {count !== undefined && count > 0 && (
        <li>
          <Users />
          {count} na roda
        </li>
      )}
      {canJoin && (
        <li className="map-card-join">
          <Button
            variant={joined ? "soft" : "hero"}
            size="sm"
            onClick={() => void join()}
            disabled={pending}
          >
            {joined ? <Check /> : <Users />}
            {joined ? "Cancelar participação" : "Quero participar"}
          </Button>
        </li>
      )}
    </>
  );
}

/**
 * Cartão do local selecionado: popover sobre o mapa no desktop e bottom sheet no celular (só CSS muda).
 * "Ver detalhes" não aparece: o app ainda não tem tela de detalhe de evento/roda/grupo (só as listas) —
 * o cartão já traz tudo; quando existir uma rota, o link entra aqui.
 */
function PlaceCard({
  place,
  near,
  onClose,
}: {
  place: MapPlace;
  near: NearMe | null;
  onClose: () => void;
}) {
  const meta = PLACE_META[place.type];
  const ref = useRef<HTMLDivElement>(null);
  const distance = formatDistance(distanceOf(place, near));
  const when = whenLabel(place, toDate);
  const address = addressLine(place);
  const description = place.description || place.organization.description;
  const joinable = place.type === "EVENT" || place.type === "RODA";

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [place.id]);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="map-card"
      role="dialog"
      aria-label={`${meta.singular}: ${place.title}`}
      style={pinStyle(place.type)}
      data-testid="map-card"
    >
      <span className="map-card-handle" aria-hidden="true" />
      <button type="button" className="map-card-close" aria-label="Fechar cartão" onClick={onClose}>
        <X />
      </button>
      <header className="map-card-head">
        <OrgLogo place={place} className="map-logo is-large" />
        <div>
          <div className="map-card-tags">
            <span className="map-type-pill">{meta.singular}</span>
            {place.isMine && (
              <span className="map-mine">
                <Star /> Meu grupo
              </span>
            )}
          </div>
          <h3>{place.title}</h3>
        </div>
      </header>
      {description && <p className="map-card-desc">{description}</p>}
      <ul className="map-card-lines">
        {place.type !== "UNIT" && (
          <li>
            <Users />
            {place.organization.name}
          </li>
        )}
        {address && (
          <li>
            <MapPin />
            {address}
          </li>
        )}
        {when && (
          <li>
            {place.type === "CLASS" ? <Clock /> : <CalendarDays />}
            {when}
          </li>
        )}
        {distance && (
          <li>
            <Navigation />
            {distance} de você
          </li>
        )}
        {joinable && <ParticipateAction key={place.id} place={place} />}
      </ul>
      <div className="map-card-actions">
        <Button asChild size="sm">
          <a href={directionsUrl(place)} target="_blank" rel="noopener noreferrer">
            <Navigation />
            Como chegar
          </a>
        </Button>
      </div>
    </div>
  );
}

type GeoState = "idle" | "locating" | "denied" | "unavailable" | "error";

const GEO_MESSAGE: Record<Exclude<GeoState, "idle" | "locating">, string> = {
  denied:
    "Sem permissão de localização. Libere o acesso nas configurações do navegador e tente de novo — por enquanto mostramos tudo.",
  unavailable: "Este aparelho não oferece localização. Mostramos tudo.",
  error: "Não conseguimos descobrir onde você está agora. Tente novamente.",
};

export default function MapExplorer({
  config,
  active,
}: {
  config: MapConfig & { apiKey: string };
  active: boolean;
}) {
  const [types, setTypes] = useState<PlaceType[]>(PLACE_TYPES);
  const [period, setPeriod] = useState<Period>("all");
  const [search, setSearch] = useState("");
  // Apagar o campo volta à busca completa na hora; digitar espera 350 ms para não bater na API a cada tecla.
  const debouncedSearch = useDebounced(search, 350);
  const q = search === "" ? "" : debouncedSearch;
  const [mineOnly, setMineOnly] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState(DEFAULT_RADIUS_KM);
  const [geo, setGeo] = useState<GeoState>("idle");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const near = useMemo<NearMe | null>(
    () => (coords ? { ...coords, radiusKm: radius } : null),
    [coords, radius],
  );
  const places = useMapPlaces({ q, period, near }, true);
  const items = useMemo(() => places.data?.items ?? [], [places.data]);
  const total = places.data?.total ?? items.length;

  const base = useMemo(() => (mineOnly ? items.filter((p) => p.isMine) : items), [items, mineOnly]);
  const counts = useMemo(() => countByType(base), [base]);
  const hasMine = useMemo(() => items.some((p) => p.isMine), [items]);
  const visible = useMemo(
    () =>
      sortByDistance(
        base.filter((p) => types.includes(p.type)),
        near,
      ),
    [base, types, near],
  );
  const selected = useMemo(
    () => visible.find((p) => p.id === selectedId) ?? null,
    [visible, selectedId],
  );
  // O mapa só reenquadra quando o CONJUNTO muda (não a cada render).
  const fitToken = useMemo(
    () =>
      `${visible.map((p) => p.id).join("|")}#${near ? `${near.lat},${near.lng},${near.radiusKm}` : ""}`,
    [visible, near],
  );

  const toggleType = (type: PlaceType) =>
    setTypes((current) =>
      current.includes(type) ? current.filter((t) => t !== type) : [...current, type],
    );

  const clearFilters = () => {
    setTypes(PLACE_TYPES);
    setPeriod("all");
    setSearch("");
    setMineOnly(false);
    setCoords(null);
    setGeo("idle");
  };

  function toggleNear() {
    if (coords) {
      setCoords(null);
      setGeo("idle");
      return;
    }
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setGeo("unavailable");
      return;
    }
    setGeo("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
        setGeo("idle");
      },
      (failure) => setGeo(failure.code === 1 ? "denied" : "error"),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  }

  const select = useCallback((id: string) => setSelectedId(id), []);

  // No celular a lista fica ABAIXO do mapa: ao escolher um item, leva o mapa (e o cartão) para a tela.
  function selectFromList(id: string) {
    setSelectedId(id);
    if (window.matchMedia("(max-width: 767px)").matches) {
      stageRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    }
  }

  function close(returnFocus = true) {
    const id = selectedId;
    setSelectedId(null);
    if (returnFocus && id) {
      window.requestAnimationFrame(() =>
        listRef.current
          ?.querySelector<HTMLElement>(placeSelector(id))
          ?.focus({ preventScroll: true }),
      );
    }
  }

  // Item selecionado pelo pin: rola a lista até ele (lista e mapa sempre sincronizados).
  useEffect(() => {
    if (!selectedId) return;
    listRef.current
      ?.querySelector<HTMLElement>(placeSelector(selectedId))
      ?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  const filtersActive =
    types.length !== PLACE_TYPES.length ||
    period !== "all" ||
    search.trim() !== "" ||
    mineOnly ||
    coords !== null;

  return (
    <section
      className="map-explorer"
      aria-label="Mapa da comunidade"
      onKeyDown={(event) => {
        if (event.key === "Escape" && selected) close();
      }}
    >
      <div className="map-toolbar">
        <div className="map-chip-row" role="group" aria-label="Tipos de local">
          {PLACE_TYPES.map((type) => {
            const Icon = TYPE_ICON[type];
            const on = types.includes(type);
            return (
              <button
                key={type}
                type="button"
                className="map-chip"
                style={{ "--chip": PLACE_META[type].color } as CSSProperties}
                aria-pressed={on}
                aria-label={`${PLACE_META[type].label}: ${counts[type]}`}
                onClick={() => toggleType(type)}
              >
                <Icon aria-hidden="true" />
                {PLACE_META[type].label}
                <span className="map-chip-count" aria-hidden="true">
                  {counts[type]}
                </span>
              </button>
            );
          })}
          {hasMine && (
            <button
              type="button"
              className="map-chip"
              style={{ "--chip": "#8a6d0b" } as CSSProperties}
              aria-pressed={mineOnly}
              onClick={() => setMineOnly((value) => !value)}
            >
              <Star aria-hidden="true" />
              Meu grupo
            </button>
          )}
        </div>
        <div className="map-chip-row">
          <div className="map-chip-row" role="group" aria-label="Período">
            {PERIODS.map((item) => (
              <button
                key={item.value}
                type="button"
                className="map-chip is-small"
                aria-pressed={period === item.value}
                onClick={() => setPeriod(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="search-field map-search">
            <Search aria-hidden="true" />
            <input
              aria-label="Buscar no mapa"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Grupo, evento, cidade…"
            />
          </label>
          <button
            type="button"
            className="map-chip"
            aria-pressed={coords !== null}
            onClick={toggleNear}
            disabled={geo === "locating"}
          >
            <LocateFixed aria-hidden="true" />
            {geo === "locating" ? "Localizando…" : "Perto de mim"}
          </button>
          {coords && (
            <select
              aria-label="Raio da busca"
              className="select-field"
              value={radius}
              onChange={(event) => setRadius(Number(event.target.value))}
            >
              {RADIUS_OPTIONS.map((km) => (
                <option key={km} value={km}>
                  até {km} km
                </option>
              ))}
            </select>
          )}
        </div>
        {geo !== "idle" && geo !== "locating" && (
          <p className="map-note" role="status">
            {GEO_MESSAGE[geo]}
          </p>
        )}
      </div>

      <div className="map-layout">
        <div className="map-stage" ref={stageRef}>
          <MapCanvas
            apiKey={config.apiKey}
            mapId={config.mapId}
            places={visible}
            selectedId={selected?.id ?? null}
            onSelect={select}
            near={near}
            fitToken={fitToken}
            active={active}
          />
          {places.isFetching && <span className="map-progress" aria-hidden="true" />}
          {selected && <PlaceCard place={selected} near={near} onClose={() => close()} />}
        </div>

        <aside className="map-panel" aria-label="Resultados do mapa">
          <div className="map-panel-head" aria-live="polite">
            <span>
              {visible.length} {visible.length === 1 ? "local" : "locais"}
            </span>
            {near && <span className="map-panel-sub">perto de você</span>}
          </div>
          {places.isLoading ? (
            <div className="map-panel-state" role="status">
              Procurando a roda…
            </div>
          ) : places.isError ? (
            <div className="map-panel-state text-destructive" role="alert">
              {errorMessage(places.error, "Não foi possível carregar os locais.")}
              <Button size="sm" variant="outline" onClick={() => void places.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : visible.length === 0 ? (
            <div className="map-panel-state" role="status" data-testid="map-empty">
              <CircleDot className="map-empty-icon" aria-hidden="true" />
              <strong>A roda ainda não chegou por aqui</strong>
              <span>
                Nenhum local para esses filtros. Tente outro período, amplie o raio ou escolha mais
                tipos.
              </span>
              {filtersActive && (
                <Button size="sm" variant="outline" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              )}
            </div>
          ) : (
            <ol className="map-results" ref={listRef}>
              {visible.map((place) => {
                const distance = formatDistance(distanceOf(place, near));
                const when = whenLabel(place, toDate);
                return (
                  <li key={place.id}>
                    <button
                      type="button"
                      className="map-result"
                      style={pinStyle(place.type)}
                      data-place-id={place.id}
                      aria-current={place.id === selected?.id ? "true" : undefined}
                      onClick={() => selectFromList(place.id)}
                    >
                      <OrgLogo place={place} className="map-logo" />
                      <span className="map-result-body">
                        <span className="map-result-title">{place.title}</span>
                        <span className="map-result-meta">
                          <span className="map-type-pill">{PLACE_META[place.type].singular}</span>
                          {place.type !== "UNIT" && <span>{place.organization.name}</span>}
                          {place.isMine && <span className="map-mine">Meu grupo</span>}
                        </span>
                        {(when || distance) && (
                          <span className="map-result-when">
                            {[when, distance].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {!places.isLoading && total > items.length && (
            <p className="map-panel-foot" role="status">
              Mostrando {items.length} de {total} locais (limite de {MAP_LIMIT}). Refine a busca ou
              o período.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
