import { LocateFixed, TriangleAlert } from "lucide-react";
import { useFormContext } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { GEO_RADIUS_MAX, GEO_RADIUS_MIN, type ClassFormValues, type GeoCheckinLocation } from "./schema";

const LOCATION_TEXT: Record<GeoCheckinLocation, string> = {
  CLASS: "Usando o local da turma.",
  UNIT: "Usando o local da unidade.",
};

interface GeoCheckinFieldsProps {
  /** Origem do local salvo no servidor (`geoCheckinLocation`); `undefined` = turma nova (ainda sem leitura do servidor). */
  location: GeoCheckinLocation | null | undefined;
  /** Mensagem do 400 `GEO_CHECKIN_NO_LOCATION`, mostrada junto do interruptor. */
  serverError: string | null;
  /** Chamado ao mexer no interruptor (limpa o erro do servidor). */
  onToggle: () => void;
}

/**
 * Seção "Check-in por localização" do formulário da turma: interruptor (padrão desligado), raio permitido em metros
 * (só com o interruptor ligado), dica, de onde vem o local e o aviso quando não há local nenhum.
 */
export function GeoCheckinFields({ location, serverError, onToggle }: GeoCheckinFieldsProps) {
  const form = useFormContext<ClassFormValues>();
  const enabled = form.watch("geoCheckinEnabled") === true;
  const label = "Permitir que o aluno registre a própria presença por localização (GPS)";

  return (
    <fieldset className="grid gap-3 rounded-md border p-3" data-testid="class-geo-section">
      <legend className="flex items-center gap-1.5 px-1 text-sm font-medium">
        <LocateFixed className="size-4" aria-hidden /> Check-in por localização
      </legend>
      <FormField
        control={form.control}
        name="geoCheckinEnabled"
        render={({ field }) => (
          <FormItem>
            <div className="flex items-center justify-between gap-3">
              <FormLabel>{label}</FormLabel>
              <FormControl>
                <Switch
                  checked={field.value === true}
                  onCheckedChange={(on) => {
                    field.onChange(on);
                    onToggle();
                  }}
                  aria-label={label}
                  aria-invalid={serverError ? true : undefined}
                />
              </FormControl>
            </div>
            <FormDescription>Usa o local da turma; se ela não tiver, usa o da unidade. Defina o local antes.</FormDescription>
            {serverError && (
              <p role="alert" data-testid="geo-checkin-error" className="text-sm font-medium text-destructive">
                {serverError}
              </p>
            )}
          </FormItem>
        )}
      />
      {enabled && (
        <>
          <FormField
            control={form.control}
            name="geoCheckinRadiusMeters"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Raio permitido (metros)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={GEO_RADIUS_MIN}
                    max={GEO_RADIUS_MAX}
                    step={1}
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormDescription>
                  De {GEO_RADIUS_MIN} a {GEO_RADIUS_MAX} metros (padrão 150). O aluno precisa estar a até essa distância do local.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          {location === undefined ? null : location === null ? (
            <p data-testid="geo-checkin-no-location" className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Esta turma ainda não tem local (nem o da turma, nem o da unidade). Defina o local e salve antes de ligar o
                check-in por localização.
              </span>
            </p>
          ) : (
            <p data-testid="geo-checkin-location" className="text-xs text-muted-foreground">
              {LOCATION_TEXT[location]}
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}
