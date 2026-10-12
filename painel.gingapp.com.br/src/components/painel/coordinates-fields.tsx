import { useState } from "react";
import { ExternalLink, Loader2, MapPin } from "lucide-react";
import { useFormContext } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { notifyError } from "@/lib/crud";
import { geocodeAddress, googleMapsLink, parseCoordinate, useMapConfig } from "@/lib/map";

interface CoordinatesFieldsProps {
  /** Texto do endereço a geocodificar (ex.: "Rua A, 10, Goiânia, GO"), montado a partir dos outros campos do formulário. */
  buildQuery: () => string;
}

/**
 * Latitude/Longitude opcionais (texto) + "Localizar pelo endereço" (POST /map/geocode, só quando o servidor tem
 * chave do Google) + "Ver no Google Maps". Vai dentro de um <FormDialog> cujo schema tem `latitude` e `longitude`
 * (strings; "" = não informado). Os pontos alimentam o mapa da comunidade no app.
 */
export function CoordinatesFields({ buildQuery }: CoordinatesFieldsProps) {
  const form = useFormContext<{ latitude: string; longitude: string }>();
  const config = useMapConfig();
  const [locating, setLocating] = useState(false);
  const latitude = parseCoordinate(form.watch("latitude"));
  const longitude = parseCoordinate(form.watch("longitude"));
  const canOpen = latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  const geocodingEnabled = config.data?.geocodingEnabled === true;

  async function locate() {
    const query = buildQuery().trim();
    if (query.length < 3) {
      toast.error("Preencha o endereço (ou o local e a cidade) para localizar no mapa.");
      return;
    }
    setLocating(true);
    try {
      const found = await geocodeAddress(query);
      form.setValue("latitude", String(found.latitude), { shouldDirty: true, shouldValidate: true });
      form.setValue("longitude", String(found.longitude), { shouldDirty: true, shouldValidate: true });
      toast.success("Localização encontrada. Confira o ponto em \"Ver no Google Maps\".");
    } catch (error) {
      notifyError(error, "Não foi possível localizar o endereço. Informe a latitude e a longitude manualmente.");
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-md border p-3" data-testid="coordinates-fields">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <MapPin className="size-4" aria-hidden /> Posição no mapa
        </span>
        {geocodingEnabled && (
          <Button type="button" variant="outline" size="sm" onClick={() => void locate()} disabled={locating}>
            {locating ? <Loader2 className="animate-spin" /> : <MapPin />}
            {locating ? "Localizando…" : "Localizar pelo endereço"}
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="latitude"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Latitude</FormLabel>
              <FormControl>
                <Input inputMode="decimal" placeholder="-16.6869" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="longitude"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Longitude</FormLabel>
              <FormControl>
                <Input inputMode="decimal" placeholder="-49.2648" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <p className="text-[0.8rem] text-muted-foreground">
        {config.isSuccess && !geocodingEnabled
          ? "A localização automática pelo endereço não está disponível (falta configurar a chave do Google Maps no servidor). Informe a latitude e a longitude manualmente, se quiser aparecer no mapa."
          : "Opcional. Informe a latitude e a longitude, ou use \"Localizar pelo endereço\". Sem posição, este item não aparece no mapa da comunidade."}
      </p>
      {canOpen && (
        <a
          href={googleMapsLink(latitude, longitude)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1 text-sm text-primary underline-offset-2 hover:underline"
        >
          <ExternalLink className="size-3.5" aria-hidden /> Ver no Google Maps
        </a>
      )}
    </div>
  );
}
