import type { UseFormReturn } from "react-hook-form";
import { RopeSwatch } from "@/components/painel/rope-swatch";
import { ROPE_PALETTE, HEX_COLOR, NO_COLOR, ropeLabel, type RopeStyle } from "@/lib/rope";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { LevelFormValues } from "./graduacoes-forms";
import { fitColors } from "./level-utils";

interface StyleOption {
  label: string;
  style: RopeStyle;
  count: 1 | 2 | 3;
}

const STYLE_OPTIONS: StyleOption[] = [
  { label: "Sólida", style: "SOLID", count: 1 },
  { label: "Dividida 2 cores", style: "SPLIT", count: 2 },
  { label: "Dividida 3 cores", style: "SPLIT", count: 3 },
  { label: "Trançada 2 cores", style: "BRAIDED", count: 2 },
  { label: "Trançada 3 cores", style: "BRAIDED", count: 3 },
];

const sample = (colors: string[], count: number) => fitColors(colors.filter((c) => HEX_COLOR.test(c)), count);

function StylePicker({
  style,
  colors,
  onPick,
}: {
  style: RopeStyle;
  colors: string[];
  onPick: (option: StyleOption) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Estilo da corda" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {STYLE_OPTIONS.map((option) => {
        const selected = option.style === style && option.count === colors.length;
        return (
          <button
            key={`${option.style}-${option.count}`}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onPick(option)}
            className={cn(
              "flex flex-col items-center gap-2 rounded-lg border bg-card p-3 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected && "border-primary bg-primary/5 ring-1 ring-primary",
            )}
          >
            <RopeSwatch
              style={option.style}
              colors={sample(colors, option.count)}
              orientation="horizontal"
              size="md"
              decorative
            />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ColorSlot({
  index,
  value,
  onChange,
}: {
  index: number;
  value: string;
  onChange: (hex: string) => void;
}) {
  const n = index + 1;
  const valid = HEX_COLOR.test(value);
  return (
    <fieldset className="grid gap-2 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Cor {n}</legend>
      <div className="flex flex-wrap gap-1.5">
        {ROPE_PALETTE.map((color) => {
          const selected = value.toLowerCase() === color.hex;
          return (
            <button
              key={color.hex}
              type="button"
              aria-label={`Cor ${n}: ${color.name}`}
              aria-pressed={selected}
              title={color.name}
              onClick={() => onChange(color.hex)}
              className={cn(
                "size-7 rounded-full border shadow-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
              )}
              style={{ backgroundColor: color.hex }}
            />
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="color"
          aria-label={`Seletor da cor ${n}`}
          className="h-9 w-14 shrink-0 cursor-pointer p-1"
          value={valid ? value.toLowerCase() : NO_COLOR}
          onChange={(event) => onChange(event.target.value)}
        />
        <Input
          aria-label={`Hex da cor ${n}`}
          inputMode="text"
          maxLength={7}
          spellCheck={false}
          className="font-mono"
          aria-invalid={!valid}
          value={value}
          onChange={(event) => {
            const typed = event.target.value.trim();
            onChange(/^[0-9a-fA-F]{6}$/.test(typed) ? `#${typed}` : typed);
          }}
        />
      </div>
    </fieldset>
  );
}

/** Campos do editor de nível: nome, ordem, estilo (cartões), cores (paleta + hex + seletor) e prévia grande ao vivo. */
export function LevelFields({ form }: { form: UseFormReturn<LevelFormValues> }) {
  const style = form.watch("style");
  const colors = form.watch("colors");
  const preview = colors.length > 0 ? colors : [NO_COLOR];

  const setColors = (next: string[]) => form.setValue("colors", next, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem><FormLabel>Nome do nível</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="order" render={({ field }) => (
          <FormItem><FormLabel>Ordem</FormLabel><FormControl><Input type="number" min={0} {...field} /></FormControl><FormMessage /></FormItem>
        )} />
      </div>

      <div
        data-testid="level-preview"
        className="flex items-center justify-center gap-10 rounded-lg border bg-muted/40 px-4 py-5"
      >
        <RopeSwatch style={style} colors={preview} size="lg" orientation="vertical" decorative />
        <div className="flex min-w-0 flex-col items-center gap-3">
          <RopeSwatch style={style} colors={preview} size="lg" orientation="horizontal" decorative />
          <p className="text-center text-xs text-muted-foreground" data-testid="level-preview-label">
            {ropeLabel({ style, colors: preview })}
          </p>
        </div>
      </div>

      <div className="grid gap-2">
        <span className="text-sm font-medium">Estilo da corda</span>
        <StylePicker
          style={style}
          colors={colors}
          onPick={(option) => {
            form.setValue("style", option.style, { shouldDirty: true });
            setColors(fitColors(colors, option.count));
          }}
        />
      </div>

      <FormField control={form.control} name="colors" render={() => (
        <FormItem>
          <FormLabel>{colors.length > 1 ? "Cores da corda" : "Cor da corda"}</FormLabel>
          <div className={cn("grid gap-3", colors.length > 1 && "sm:grid-cols-2")}>
            {colors.map((value, index) => (
              <ColorSlot
                key={index}
                index={index}
                value={value}
                onChange={(hex) => setColors(colors.map((c, i) => (i === index ? hex : c)))}
              />
            ))}
          </div>
          <FormMessage />
        </FormItem>
      )} />
    </>
  );
}
