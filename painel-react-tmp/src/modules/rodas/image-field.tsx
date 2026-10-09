import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { useFormContext } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { isHttpUrl } from "./form-utils";

/** Pré-visualização da capa; mostra aviso se a URL não carregar. */
export function ImagePreview({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);

  if (!url || !isHttpUrl(url)) return null;
  if (failed) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="image-failed">
        <ImageOff className="size-4" /> Não foi possível carregar a imagem desta URL.
      </p>
    );
  }
  return (
    <img
      src={url}
      alt="Pré-visualização da capa"
      className="h-36 w-full rounded-md border object-cover"
      onError={() => setFailed(true)}
    />
  );
}

/** Campo `imageUrl` (URL externa, sem upload - o backend só guarda a URL) + preview. */
export function ImageUrlField() {
  const form = useFormContext<{ imageUrl: string }>();
  const value = form.watch("imageUrl");
  return (
    <FormField
      control={form.control}
      name="imageUrl"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Imagem de capa (URL)</FormLabel>
          <FormControl>
            <Input placeholder="https://..." inputMode="url" {...field} />
          </FormControl>
          <FormDescription>Opcional. Cole o link de uma imagem já hospedada.</FormDescription>
          <FormMessage />
          <ImagePreview url={value.trim()} />
        </FormItem>
      )}
    />
  );
}