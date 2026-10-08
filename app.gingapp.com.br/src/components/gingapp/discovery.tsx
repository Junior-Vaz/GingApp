import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { startOfToday, toDate } from "@/lib/format";
import {
  fromCalendar,
  fromEvent,
  fromRoda,
  useCalendar,
  useCities,
  useEvents,
  useRodas,
  useStates,
  type Encounter,
} from "@/lib/queries";
import { EventCard, PageHeading, SectionHeading, StateMessage } from "./shared";

type Mode = "community" | "events" | "rodas";

const FILTERS = [
  { value: "", label: "Todos" },
  { value: "RODA", label: "Rodas" },
  { value: "BATIZADO", label: "Batizados" },
  { value: "WORKSHOP", label: "Workshops" },
];

function useEncounters(mode: Mode, filters: { type: string; stateId: string; cityId: string }) {
  const calendar = useCalendar(mode === "community" ? filters : {});
  const events = useEvents();
  const rodas = useRodas();

  return useMemo(() => {
    const today = startOfToday().getTime();
    if (mode === "community") {
      return {
        items: (calendar.data ?? []).map(fromCalendar),
        isLoading: calendar.isLoading,
        error: calendar.error,
      };
    }
    if (mode === "events") {
      return {
        items: [...(events.data ?? [])]
          .sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime())
          .map(fromEvent),
        isLoading: events.isLoading,
        error: events.error,
      };
    }
    return {
      items: (rodas.data ?? [])
        .filter((r) => toDate(r.date).getTime() >= today)
        .sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime())
        .map(fromRoda),
      isLoading: rodas.isLoading,
      error: rodas.error,
    };
  }, [mode, calendar.data, calendar.isLoading, calendar.error, events.data, events.isLoading, events.error, rodas.data, rodas.isLoading, rodas.error]);
}

export function DiscoveryPage({ mode = "community" }: { mode?: Mode }) {
  const [filter, setFilter] = useState("");
  const [stateId, setStateId] = useState("");
  const [cityId, setCityId] = useState("");
  const [search, setSearch] = useState("");
  const states = useStates();
  const cities = useCities(stateId);

  const title =
    mode === "community" ? "Na roda, juntos." : mode === "events" ? "Eventos da capoeira" : "Rodas de capoeira";
  const filters = useMemo(() => ({ type: filter, stateId, cityId }), [filter, stateId, cityId]);
  const { items, isLoading, error } = useEncounters(mode, filters);

  const needle = search.trim().toLocaleLowerCase();
  const filtered: Encounter[] = items.filter((event) => {
    if (mode === "events" && filter && event.type !== filter) return false;
    if (!needle) return true;
    return `${event.title} ${event.place ?? ""} ${event.city ?? ""}`.toLocaleLowerCase().includes(needle);
  });

  return (
    <>
      <PageHeading title={title} subtitle="Encontros reais. Novas histórias. A mesma paixão pela capoeira." />
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
        <StateMessage>Nenhum encontro encontrado. Experimente outra busca ou localização.</StateMessage>
      )}
    </>
  );
}
