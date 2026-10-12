import { lazy, Suspense, useMemo, useState } from "react";
import { List, Map as MapIcon, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { toDate } from "@/lib/format";
import { isMapAvailable, readStoredView, storeView, useMapConfig, type CommunityView } from "@/lib/map";
import {
  fromCalendar,
  fromEvent,
  useCalendar,
  useCities,
  useEvents,
  useStates,
  type Encounter,
} from "@/lib/queries";
import { EventCard, LoadMore, PageHeading, SectionHeading, StateMessage } from "./shared";

// Mapa: chunk separado (Google Maps + agrupador + UI do mapa), baixado só ao abrir a aba "Mapa".
// Se o chunk não carregar (sem rede / deploy novo), mostra um aviso no lugar em vez de derrubar a página.
const MapExplorer = lazy(() =>
  import("./map-explorer").catch(() => ({
    default: () => <StateMessage tone="error">Não foi possível abrir o mapa agora. Use a Lista ou recarregue a página.</StateMessage>,
  })),
);

type Mode = "community" | "events" | "rodas";

const VIEWS: { value: CommunityView; label: string; icon: typeof List }[] = [
  { value: "list", label: "Lista", icon: List },
  { value: "map", label: "Mapa", icon: MapIcon },
];

/** Alternador animado "Lista | Mapa" (radiogroup com setas do teclado; a pílula desliza entre as opções). */
function ViewToggle({ view, onChange }: { view: CommunityView; onChange: (view: CommunityView) => void }) {
  return (
    <div
      className="view-toggle"
      role="radiogroup"
      aria-label="Modo de visualização da comunidade"
      data-view={view}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const next = view === "list" ? "map" : "list";
        onChange(next);
        event.currentTarget.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus();
      }}
    >
      <span className="view-toggle-pill" aria-hidden="true" />
      {VIEWS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          data-value={value}
          aria-checked={view === value}
          tabIndex={view === value ? 0 : -1}
          onClick={() => onChange(value)}
        >
          <Icon aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

const FILTERS = [
  { value: "", label: "Todos" },
  { value: "RODA", label: "Rodas" },
  { value: "BATIZADO", label: "Batizados" },
  { value: "WORKSHOP", label: "Workshops" },
];

/**
 * Fonte de cada aba, sempre paginada no servidor (50 por vez + total real em X-Total-Count):
 * comunidade = /calendar (filtros de estado/cidade/tipo); eventos = /events do grupo;
 * rodas = /calendar?type=RODA (só a partir de hoje — o /rodas traz também as passadas, que
 * encheriam a primeira página). Só a aba ativa busca.
 */
function useEncounters(mode: Mode, filters: { type: string; stateId: string; cityId: string }) {
  const calendar = useCalendar(mode === "community" ? filters : { type: "RODA" }, { enabled: mode !== "events" });
  const events = useEvents(mode === "events");

  return useMemo(() => {
    if (mode === "events") {
      return {
        items: [...events.items]
          .sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime())
          .map(fromEvent),
        total: events.total,
        hasMore: events.hasNextPage,
        loadingMore: events.isFetchingNextPage,
        loadMore: () => void events.fetchNextPage(),
        isLoading: events.isLoading,
        error: events.error,
      };
    }
    return {
      items: calendar.items.map(fromCalendar),
      total: calendar.total,
      hasMore: calendar.hasNextPage,
      loadingMore: calendar.isFetchingNextPage,
      loadMore: () => void calendar.fetchNextPage(),
      isLoading: calendar.isLoading,
      error: calendar.error,
    };
  }, [mode, calendar, events]);
}

export function DiscoveryPage({ mode = "community" }: { mode?: Mode }) {
  const [filter, setFilter] = useState("");
  const [stateId, setStateId] = useState("");
  const [cityId, setCityId] = useState("");
  const [search, setSearch] = useState("");
  // Lista | Mapa: o toggle só existe na Comunidade e com o mapa habilitado (/map/config com chave); a
  // escolha fica no navegador. O mapa, uma vez aberto, continua montado (escondido) ao voltar para a lista.
  const mapConfig = useMapConfig(mode === "community");
  const mapEnabled = mode === "community" && isMapAvailable(mapConfig.data) ? mapConfig.data : null;
  const [view, setView] = useState<CommunityView>(readStoredView);
  const [mapOpened, setMapOpened] = useState(view === "map");
  const showMap = mapEnabled !== null && view === "map";
  const mountMap = mapEnabled !== null && (view === "map" || mapOpened);
  const changeView = (next: CommunityView) => {
    setView(next);
    storeView(next);
    if (next === "map") setMapOpened(true);
  };
  const states = useStates();
  const cities = useCities(stateId);

  const title =
    mode === "community" ? "Na roda, juntos." : mode === "events" ? "Eventos da capoeira" : "Rodas de capoeira";
  const filters = useMemo(() => ({ type: filter, stateId, cityId }), [filter, stateId, cityId]);
  const { items, total, hasMore, loadingMore, loadMore, isLoading, error } = useEncounters(mode, filters);

  const needle = search.trim().toLocaleLowerCase();
  const filtered: Encounter[] = items.filter((event) => {
    if (mode === "events" && filter && event.type !== filter) return false;
    if (!needle) return true;
    return `${event.title} ${event.place ?? ""} ${event.city ?? ""}`.toLocaleLowerCase().includes(needle);
  });

  return (
    <>
      <PageHeading title={title} subtitle="Encontros reais. Novas histórias. A mesma paixão pela capoeira." />
      {mapEnabled && (
        <div className="view-bar">
          <ViewToggle view={view} onChange={changeView} />
        </div>
      )}
      {mountMap && mapEnabled && (
        <Suspense fallback={<StateMessage>Carregando o mapa…</StateMessage>}>
          <div hidden={!showMap}>
            <MapExplorer config={mapEnabled} active={showMap} />
          </div>
        </Suspense>
      )}
      {!showMap && (
        <>
        <div className="filter-bar">
          {mode !== "rodas" &&
            FILTERS.map((item) => (
              <Button key={item.value} size="sm" variant={filter === item.value ? "default" : "outline"} onClick={() => setFilter(item.value)}>
                {item.label}
              </Button>
            ))}
          <label className="search-field">
            <Search />
            <input aria-label="Buscar eventos" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar encontros..." />
          </label>
          {mode === "community" && (
            <>
              <select
                aria-label="Estado"
                className="select-field"
                value={stateId}
                onChange={(event) => {
                  setStateId(event.target.value);
                  setCityId("");
                }}
              >
                <option value="">Brasil</option>
                {(states.data ?? []).map((state) => (
                  <option key={state.id} value={state.id}>
                    {state.name}
                  </option>
                ))}
              </select>
              {stateId && (
                <select aria-label="Cidade" className="select-field" value={cityId} onChange={(event) => setCityId(event.target.value)}>
                  <option value="">Todas as cidades</option>
                  {(cities.data ?? []).map((city) => (
                    <option key={city.id} value={city.id}>
                      {city.name}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
        </div>
        <SectionHeading title={mode === "rodas" ? "A roda está aberta" : "Próximos encontros"} />
        {isLoading ? (
          <StateMessage>Carregando…</StateMessage>
        ) : error ? (
          <StateMessage tone="error">{errorMessage(error, "Não foi possível carregar os encontros.")}</StateMessage>
        ) : filtered.length > 0 ? (
          <div className="discovery-grid">
            {filtered.map((event) => (
              <EventCard key={event.key} event={event} />
            ))}
          </div>
        ) : (
          <StateMessage>
            Nenhum encontro encontrado. Experimente outra busca ou localização.
            {hasMore && " Há mais encontros ainda não carregados — use “Carregar mais” para ampliar a busca."}
          </StateMessage>
        )}
        <LoadMore
          shown={items.length}
          total={total}
          hasMore={hasMore}
          loading={loadingMore}
          onMore={loadMore}
          noun={mode === "rodas" ? "rodas" : "encontros"}
        />
        </>
      )}
    </>
  );
}
