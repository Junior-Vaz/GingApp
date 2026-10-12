import { useFormContext } from "react-hook-form";
import { CoordinatesFields } from "@/components/painel/coordinates-fields";
import { useCities, useStates } from "./reference";

/** Posição no mapa de evento/roda: o texto a geocodificar é "Local, Cidade, UF" (campos location/stateId/cityId do formulário). */
export function LocationCoordinatesFields() {
  const form = useFormContext<{ location: string; stateId: string; cityId: string }>();
  const stateId = form.watch("stateId");
  const states = useStates();
  const cities = useCities(stateId ? Number(stateId) : undefined);

  return (
    <CoordinatesFields
      buildQuery={() => {
        const { location, stateId: state, cityId } = form.getValues();
        const city = cities.data?.find((c) => String(c.id) === cityId)?.name ?? "";
        const uf = states.data?.find((s) => String(s.id) === state)?.uf ?? "";
        return [location.trim(), city, uf].filter(Boolean).join(", ");
      }}
    />
  );
}
