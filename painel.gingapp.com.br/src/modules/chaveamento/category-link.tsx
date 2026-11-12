import { useId, useState } from "react";
import { Link2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/modules/rodas/native-select";
import { categoryLiveUrl } from "./helpers";
import { copyLink, shareOrCopy } from "./share-link";

const COPIED = "Link desta categoria copiado.";

/**
 * "Copiar link desta categoria" e "Compartilhar": o endereço é o do telão público com `?categoria=<id>` (o app abre direto
 * na categoria). "Compartilhar" usa a folha do sistema (`navigator.share`); sem ela, copia o link.
 */
export function CategoryLinkActions({ token, categoryId, categoryName, className }: { token: string; categoryId: number; categoryName: string; className?: string }) {
  const url = categoryLiveUrl(token, categoryId);
  return (
    <div className={className ?? "grid grid-cols-1 gap-2 sm:flex sm:flex-wrap"} data-testid="category-link-actions">
      <Button type="button" variant="outline" size="sm" className="h-auto min-h-11 whitespace-normal py-1.5 text-left" onClick={() => void copyLink(url, COPIED)}>
        <Link2 /> Copiar link desta categoria
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-auto min-h-11 whitespace-normal py-1.5"
        onClick={() => void shareOrCopy({ title: `${categoryName} · ao vivo`, text: `Acompanhe ao vivo: ${categoryName}`, url }, COPIED)}
      >
        <Share2 /> Compartilhar
      </Button>
    </div>
  );
}

/** No cartão do telão: escolhe a categoria e copia/compartilha o link direto dela. */
export function CategoryLinkPicker({ token, categories }: { token: string; categories: ReadonlyArray<{ id: number; name: string }> }) {
  const selectId = useId();
  const [selected, setSelected] = useState<number | null>(null);
  if (categories.length === 0) return null;
  const current = categories.find((c) => c.id === selected) ?? categories[0]!;
  return (
    <div className="grid grid-cols-1 gap-1.5" data-testid="category-link-picker">
      <Label htmlFor={selectId}>Link direto de uma categoria</Label>
      <NativeSelect id={selectId} value={current.id} onChange={(e) => setSelected(Number(e.target.value))} className="h-11 md:h-11">
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </NativeSelect>
      <CategoryLinkActions token={token} categoryId={current.id} categoryName={current.name} className="mt-1 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap" />
    </div>
  );
}
