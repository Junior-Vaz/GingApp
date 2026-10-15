import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock,
  GraduationCap,
  Locate,
  LocateFixed,
  Maximize2,
  MapPin,
  Navigation,
  Search,
  SlidersHorizontal,
  Users,
  X,
  Check,
  Star,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { pickEventInfo, spotsLabel } from "@/lib/event-info";
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
  findHomePlace,
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
import { useClasses, useEncounterParticipation, useNextLessons } from "@/lib/queries";
import { imageSrc } from "@/lib/uploads";
import MapCanvas, { type ViewRequest } from "./map-canvas";

const TYPE_ICON: Record<PlaceType, LucideIcon> = {
  UNIT: Users,
  CLASS: Clock,
  RODA: CircleDot,
  EVENT: CalendarDays,
};

/** Zoom ao abrir na turma do aluno (e em "Minha turma"): a partir do 16 os clusters viram balões. */
const HOME_ZOOM = 16;

const pinStyle = (type: PlaceType) => ({ "--pin": PLACE_META[type].color }) as CSSProperties;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Logo do grupo; sem logo (ou imagem quebrada) mostra as iniciais. */
function OrgLogo({ place, className }: { place: MapPlace; className: string }) {
  const [failed, setFailed] = useState(false);
  const logo = place.organization.logoUrl;
  useEffect(() => setFailed(false), [logo]);
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

/** Vagas de um EVENT com limite ("12 vagas restantes" / "Lotado", texto do SSOT de event-info); sem limite, nada. */
function placeSpotsLabel(place: MapPlace): string | null {
  if (place.type !== "EVENT" || place.capacity === null || place.capacity === undefined) return null;
  return spotsLabel(pickEventInfo({ capacity: place.capacity, spotsLeft: place.spotsLeft ?? null }));
}

/**
 * Inscrição em evento/roda: o mesmo estado/ação do card da lista (useEncounterParticipation, SSOT em queries.ts).
 * Evento lotado: mostra "Lotado" e troca o botão por "Entrar na lista de espera" (quem já está na fila vê
 * "Sair da lista de espera"). O resumo de vagas vem do mapa (`spotsLeft`); se o servidor responder 409 EVENT_FULL
 * o hook também passa a oferecer a fila. Entrega as linhas informativas (`lines`, itens de lista) e o botão
 * (`action`) separados, porque o cartão horizontal os põe em lugares diferentes.
 */
function Participation({
  place,
  children,
}: {
  place: MapPlace;
  children: (parts: { lines: ReactNode; action: ReactNode }) => ReactNode;
}) {
  const isEvent = place.type === "EVENT";
  const { count, canJoin, joined, waitlisted, full, join, joinWaitlist, pending } = useEncounterParticipation(
    {
      source: isEvent ? "EVENTO" : "RODA",
      id: placeEntityId(place),
      ...(isEvent && place.spotsLeft !== undefined ? { spotsLeft: place.spotsLeft } : {}),
    },
    true,
  );
  const spots = placeSpotsLabel(place);
  const showFull = full || (!joined && spots === "Lotado");
  const lines = (
    <>
      {count !== undefined && count > 0 && (
        <li>
          <Users />
          {count} na roda
        </li>
      )}
      {spots && !waitlisted && (
        <li data-testid="map-card-spots">
          <Users />
          {spots}
        </li>
      )}
      {waitlisted && (
        <li role="status">
          <Users />
          Você está na lista de espera
        </li>
      )}
    </>
  );
  const action = canJoin ? (
    <Button
      variant={joined ? "soft" : showFull ? "outline" : "hero"}
      size="sm"
      onClick={() => void (!joined && showFull ? joinWaitlist() : join())}
      disabled={pending}
    >
      {joined ? <Check /> : <Users />}
      {waitlisted
        ? "Sair da lista de espera"
        : joined
          ? "Cancelar participação"
          : showFull
            ? "Entrar na lista de espera"
            : "Quero participar"}
    </Button>
  ) : null;
  return <>{children({ lines, action })}</>;
}

/**
 * Imagem quadrada à esquerda do cartão: a capa do evento/roda (`imageUrl`); sem capa (ou se falhar ao carregar),
 * o logo do grupo ou as iniciais.
 */
function PlaceMedia({ place }: { place: MapPlace }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [place.id]);
  if (place.imageUrl && !failed) {
    return (
      <div className="map-card-media">
        <img
          data-testid="map-card-cover"
          src={imageSrc(place.imageUrl)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }
  return (
    <div className="map-card-media is-logo">
      <OrgLogo place={place} className="map-card-logo" />
    </div>
  );
}

/** Linhas de detalhe (grupo, endereço, quando, distância, vagas) + botões de ação do cartão. */
function PlaceDetails({ place, near }: { place: MapPlace; near: NearMe | null }) {
  const distance = formatDistance(distanceOf(place, near));
  const when = whenLabel(place, toDate);
  const address = addressLine(place);
  const joinable = place.type === "EVENT" || place.type === "RODA";

  const render = (lines: ReactNode, action: ReactNode) => (
    <>
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
        {lines}
      </ul>
      <div className="map-card-actions">
        <Button asChild size="sm">
          <a href={directionsUrl(place)} target="_blank" rel="noopener noreferrer">
            <Navigation />
            Como chegar
          </a>
        </Button>
        {action}
      </div>
    </>
  );

  // "key": trocar de local (Anterior/Próximo) reinicia o estado de inscrição.
  return joinable ? (
    <Participation key={place.id} place={place}>
      {({ lines, action }) => render(lines, action)}
    </Participation>
  ) : (
    render(null, null)
  );
}

/**
 * Cartão do local selecionado: HORIZONTAL, fixado na base do mapa e centralizado (imagem quadrada à esquerda;
 * selo, título, descrição, detalhes e botões à direita). Anterior/Próximo percorrem os locais filtrados — é
 * o acesso por teclado/leitor de tela sem lista. "Ver detalhes" não aparece: o app ainda não tem tela de detalhe
 * de evento/roda/grupo; o cartão já traz tudo.
 */
function PlaceCard({
  place,
  near,
  position,
  onPrev,
  onNext,
  onClose,
}: {
  place: MapPlace;
  near: NearMe | null;
  /** "3/17" — só aparece com mais de um local. */
  position: { index: number; total: number } | null;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const meta = PLACE_META[place.type];
  const ref = useRef<HTMLElement>(null);
  const description = place.description || place.organization.description;

  // Foco no cartão só ao abrir: ao navegar com Anterior/Próximo o foco fica no botão usado.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      ref={ref}
      tabIndex={-1}
      className="map-card"
      aria-label={`${meta.singular}: ${place.title}`}
      style={pinStyle(place.type)}
      data-testid="map-card"
    >
      <PlaceMedia place={place} />
      <div className="map-card-body">
        <div className="map-card-top">
          <div className="map-card-tags">
            <span className="map-type-pill">{meta.singular}</span>
            {place.isMine && (
              <span className="map-mine">
                <Star /> Meu grupo
              </span>
            )}
          </div>
          <div className="map-card-nav">
            {position && (
              <>
                <button type="button" aria-label="Local anterior" onClick={onPrev}>
                  <ChevronLeft />
                </button>
                <span className="map-card-pos" aria-hidden="true">
                  {position.index + 1}/{position.total}
                </span>
                <button type="button" aria-label="Próximo local" onClick={onNext}>
                  <ChevronRight />
                </button>
              </>
            )}
            <button type="button" className="map-card-close" aria-label="Fechar cartão" onClick={onClose}>
              <X />
            </button>
          </div>
        </div>
        <h3>{place.title}</h3>
        {description && <p className="map-card-desc">{description}</p>}
        <PlaceDetails place={place} near={near} />
      </div>
    </section>
  );
}

type GeoState = "idle" | "locating" | "denied" | "unavailable" | "error";

const GEO_MESSAGE: Record<Exclude<GeoState, "idle" | "locating">, string> = {
  denied:
    "Sem permissão de localização. Libere o acesso nas configurações do navegador e tente de novo — por enquanto mostramos tudo.",
  unavailable: "Este aparelho não oferece localização. Mostramos tudo.",
  error: "Não conseguimos descobrir onde você está agora. Tente novamente.",
};

/**
 * Mapa da comunidade em TELA CHEIA: o Google ocupa toda a área e tudo o mais flutua sobre ele (alternador
 * Lista | Mapa, chips de tipo, busca/período/"perto de mim", contagem e o cartão do local). Não há lista.
 */
export default function MapExplorer({
  config,
  active,
  viewToggle,
}: {
  config: MapConfig & { apiKey: string };
  active: boolean;
  /** Alternador Lista | Mapa (vive em discovery.tsx; aqui só flutua sobre o mapa). */
  viewToggle?: ReactNode;
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ id: string; n: number } | null>(null);
  const focusCount = useRef(0);
  // Abertura na turma do aluno: o mapa só enquadra "tudo" sozinho quando não há turma/local e o usuário não mexeu.
  const [interacted, setInteracted] = useState(false);
  const [giveUp, setGiveUp] = useState(false);
  const [viewRequest, setViewRequest] = useState<ViewRequest | null>(null);
  const [locateRequest, setLocateRequest] = useState<{ lat: number; lng: number; n: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const viewCount = useRef(0);
  const homeApplied = useRef(false);
  const nextLessons = useNextLessons();
  const myClasses = useClasses();

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
  const selectedIndex = useMemo(
    () => visible.findIndex((p) => p.id === selectedId),
    [visible, selectedId],
  );
  const selected = selectedIndex >= 0 ? (visible[selectedIndex] ?? null) : null;
  // O mapa só reenquadra quando o CONJUNTO muda (não a cada render).
  const fitToken = useMemo(
    () =>
      `${visible.map((p) => p.id).join("|")}#${near ? `${near.lat},${near.lng},${near.radiusKm}` : ""}`,
    [visible, near],
  );

  // Turma atual: a da próxima aula; sem aula, a primeira de /classes/me. Espera as duas respostas (ou desiste em 4 s).
  useEffect(() => {
    const timer = window.setTimeout(() => setGiveUp(true), 4000);
    return () => window.clearTimeout(timer);
  }, []);
  const homeSettled = giveUp || (!nextLessons.isLoading && !myClasses.isLoading);
  const home = useMemo(() => {
    const lesson = nextLessons.data?.[0];
    const fallback = myClasses.data?.[0];
    const classId = lesson?.classId ?? fallback?.id;
    const className =
      lesson?.class?.name ?? myClasses.data?.find((c) => c.id === classId)?.name ?? fallback?.name;
    return findHomePlace(items, classId !== undefined ? { id: classId, name: className ?? null } : null);
  }, [items, nextLessons.data, myClasses.data]);
  const placesLoaded = places.data !== undefined;
  const showAll = () => {
    viewCount.current += 1;
    setViewRequest({ kind: "all", n: viewCount.current });
  };
  const showHome = useCallback(
    (target: MapPlace) => {
      viewCount.current += 1;
      setViewRequest({
        kind: "point",
        lat: target.latitude,
        lng: target.longitude,
        zoom: HOME_ZOOM,
        n: viewCount.current,
      });
      setSelectedId(target.id);
    },
    [],
  );
  // Ao abrir (uma vez): centraliza na turma atual e abre o cartão. Se o usuário já mexeu no mapa, respeita.
  useEffect(() => {
    if (!active || homeApplied.current || !homeSettled || !placesLoaded) return;
    homeApplied.current = true;
    if (home && !interacted) showHome(home);
  }, [active, homeSettled, placesLoaded, home, interacted, showHome]);
  const autoFit = near !== null || (homeSettled && placesLoaded && !home && !interacted);

  function locateMe() {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setLocateError(GEO_MESSAGE.unavailable);
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        viewCount.current += 1;
        setLocateRequest({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          n: viewCount.current,
        });
      },
      (failure) => {
        setLocating(false);
        setLocateError(failure.code === 1 ? GEO_MESSAGE.denied : GEO_MESSAGE.error);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  }

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

  const select = useCallback((id: string) => {
    setInteracted(true);
    setSelectedId(id);
  }, []);
  const userMoved = useCallback(() => setInteracted(true), []);

  /** Anterior/Próximo: percorre os locais filtrados em círculo (o mapa centraliza e dá zoom no escolhido). */
  function step(delta: number) {
    if (visible.length < 2 || selectedIndex < 0) return;
    const next = visible[(selectedIndex + delta + visible.length) % visible.length];
    if (next) setSelectedId(next.id);
  }

  function close(returnFocus = true) {
    const id = selectedId;
    setSelectedId(null);
    if (returnFocus && id) {
      focusCount.current += 1;
      setFocusRequest({ id, n: focusCount.current });
    }
  }
  // Clique no mapa vazio: fecha sem roubar o foco.
  const closeFromMap = useCallback(() => setSelectedId(null), []);

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
      data-has-card={selected ? "true" : "false"}
      onKeyDown={(event) => {
        if (event.key === "Escape" && selected) close();
      }}
    >
      <MapCanvas
        apiKey={config.apiKey}
        mapId={config.mapId}
        places={visible}
        selectedId={selected?.id ?? null}
        onSelect={select}
        onMapClick={closeFromMap}
        focusRequest={focusRequest}
        near={near}
        fitToken={fitToken}
        autoFit={autoFit}
        viewRequest={viewRequest}
        onUserMove={userMoved}
        locateRequest={locateRequest}
        active={active}
      />
      {places.isFetching && <span className="map-progress" aria-hidden="true" />}

      <div className="map-hud">
        <div className="map-hud-center">
          <div className="map-hud-row">
            {active && viewToggle && <div className="map-float map-switch">{viewToggle}</div>}
            <button
              type="button"
              className="map-float map-filter-btn"
              aria-expanded={filtersOpen}
              aria-controls="map-filters"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <SlidersHorizontal aria-hidden="true" />
              <span className="map-filter-label">Filtros</span>
              {filtersActive && <span className="map-dot" aria-label="filtros ativos" />}
            </button>
          </div>
          <div className="map-types" role="group" aria-label="Tipos de local">
            {PLACE_TYPES.map((type) => {
              const Icon = TYPE_ICON[type];
              const on = types.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  className="map-chip map-float"
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
                className="map-chip map-float"
                style={{ "--chip": "#8a6d0b" } as CSSProperties}
                aria-pressed={mineOnly}
                onClick={() => setMineOnly((value) => !value)}
              >
                <Star aria-hidden="true" />
                Meu grupo
              </button>
            )}
          </div>
        </div>

        <div id="map-filters" className="map-float map-filters" data-open={filtersOpen}>
          <label className="search-field map-search">
            <Search aria-hidden="true" />
            <input
              aria-label="Buscar no mapa"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Grupo, evento, cidade…"
            />
          </label>
          <div className="map-filters-row">
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
          <div className="map-periods" role="group" aria-label="Período">
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
          {geo !== "idle" && geo !== "locating" && (
            <p className="map-note" role="status">
              {GEO_MESSAGE[geo]}
            </p>
          )}
        </div>

        <div className="map-actions">
          {home && (
            <button type="button" className="map-float map-action" onClick={() => showHome(home)}>
              <GraduationCap aria-hidden="true" />
              Minha turma
            </button>
          )}
          {visible.length > 1 && (
            <button
              type="button"
              className="map-float map-action"
              onClick={showAll}
            >
              <Maximize2 aria-hidden="true" />
              Ver tudo
            </button>
          )}
          <button
            type="button"
            className="map-float map-action is-icon"
            aria-label="Minha localização"
            title="Minha localização"
            onClick={locateMe}
            disabled={locating}
          >
            <Locate aria-hidden="true" />
          </button>
          {locateError && (
            <p className="map-note map-float-note" role="status">
              {locateError}
            </p>
          )}
        </div>

        <div className="map-float map-count" role="status" aria-live="polite">
          {places.isLoading ? (
            "Procurando a roda…"
          ) : (
            <>
              <strong>{visible.length}</strong> {visible.length === 1 ? "local" : "locais"}
              {near && <span className="map-count-sub"> · perto de você</span>}
              {total > items.length && (
                <span className="map-count-sub">
                  {" "}
                  · {items.length} de {total} (limite de {MAP_LIMIT})
                </span>
              )}
            </>
          )}
        </div>

        {places.isError ? (
          <div className="map-float map-state text-destructive" role="alert">
            {errorMessage(places.error, "Não foi possível carregar os locais.")}
            <Button size="sm" variant="outline" onClick={() => void places.refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : (
          !places.isLoading &&
          visible.length === 0 && (
            <div className="map-float map-state" role="status" data-testid="map-empty">
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
          )
        )}

        {selected && (
          <PlaceCard
            place={selected}
            near={near}
            position={visible.length > 1 ? { index: selectedIndex, total: visible.length } : null}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
            onClose={() => close()}
          />
        )}
      </div>
    </section>
  );
}




