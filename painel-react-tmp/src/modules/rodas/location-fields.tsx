import { useFormContext } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { NativeSelect } from "./native-select";
import { useCities, useStates } from "./reference";

/** Selects encadeados Estado -> Cidade (valores como string; "" = não informado). */
export function LocationFields() {
  const form = useFormContext<{ stateId: string; cityId: string }>();
  const stateId = form.watch("stateId");
  const states = useStates();
  const cities = useCities(stateId ? Number(stateId) : undefined);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField
        control={form.control}
        name="stateId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Estado</FormLabel>
            <FormControl>
              <NativeSelect
                {...field}
                onChange={(event) => {
                  field.onChange(event);
                  form.setValue("cityId", "");
                }}
              >
                <option value="">—</option>
                {states.data?.map((state) => (
                  <option key={state.id} value={String(state.id)}>
                    {state.name} ({state.uf})
                  </option>
                ))}
              </NativeSelect>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="cityId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Cidade</FormLabel>
            <FormControl>
              <NativeSelect {...field} disabled={!stateId}>
                <option value="">—</option>
                {cities.data?.map((city) => (
                  <option key={city.id} value={String(city.id)}>
                    {city.name}
                  </option>
                ))}
              </NativeSelect>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}