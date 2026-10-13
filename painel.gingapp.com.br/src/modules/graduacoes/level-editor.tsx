import type { UseFormReturn } from "react-hook-form";
import { RopeSwatch } from "@/components/painel/rope-swatch";
import { ROPE_PALETTE, HEX_COLOR, NO_COLOR, ropeLabel, type RopeStyle } from "@/lib/rope";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { LevelFormValues } from "./graduacoes-forms";
import { fitColors } from "./level-utils";
import { DEFAULT_TIP_END, DEFAULT_TIP_START } from "./graduacoes-forms";

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

/**
 * Seletor de uma cor: paleta + seletor nativo + hex. `name` é o nome em minúsculas ("cor 1", "ponta de cima"),
 * usado nos rótulos acessíveis. Com `onClear`, mostra o botão "Sem ponta" (cor vazia = sem aquela ponta).
 */
function ColorSlot({
  name,
  value,
  onChange,
  onClear,
}: {
  name: string;
  value: string;
  onChange: (hex: string) => void;
  onClear?: () => void;
}) {
  const title = name.charAt(0).toUpperCase() + name.slice(1);
  const valid = HEX_COLOR.test(value);
  return (
    <fieldset className="grid gap-2 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">{title}</legend>
      <div className="flex flex-wrap gap-1.5">
        {ROPE_PALETTE.map((color) => {
          const selected = value.toLowerCase() === color.hex;
          return (
            <button
              key={color.hex}
              type="button"
              aria-label={`${title}: ${color.name}`}
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
          aria-label={`Seletor da ${name}`}
          className="h-9 w-14 shrink-0 cursor-pointer p-1"
          value={valid ? value.toLowerCase() : NO_COLOR}
          onChange={(event) => onChange(event.target.value)}
        />
        <Input
          aria-label={`Hex da ${name}`}
          inputMode="text"
          maxLength={7}
          spellCheck={false}
          className="font-mono"
          aria-invalid={onClear ? value !== "" && !valid : !valid}
          value={value}
          onChange={(event) => {
            const typed = event.target.value.trim();
            onChange(/^[0-9a-fA-F]{6}$/.test(typed) ? `#${typed}` : typed);
          }}
        />
        {onClear && (
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onClear} disabled={value === ""}>
            Sem ponta
          </Button>
        )}
      </div>
    </fieldset>
  );
}

/** Campos do editor de nível: nome, ordem, estilo (cartões), cores (paleta + hex + seletor) e prévia grande ao vivo. */
export function LevelFields({ form }: { form: UseFormReturn<LevelFormValues> }) {
  const style = form.watch("style");
  const colors = form.watch("colors");
  const preview = colors.length > 0 ? colors : [NO_COLOR];
  const tipsEnabled = form.watch("tipsEnabled");
  const tipStart = form.watch("tipStart");
  const tipEnd = form.watch("tipEnd");
  const previewTips = {
    tipStart: tipsEnabled && HEX_COLOR.test(tipStart) ? tipStart : null,
    tipEnd: tipsEnabled && HEX_COLOR.test(tipEnd) ? tipEnd : null,
  };
  const setTip = (field: "tipStart" | "tipEnd", hex: string) =>
    form.setValue(field, hex, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });

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
        <RopeSwatch style={style} colors={preview} {...previewTips} size="lg" orientation="vertical" decorative />
        <div className="flex min-w-0 flex-col items-center gap-3">
          <RopeSwatch style={style} colors={preview} {...previewTips} size="lg" orientation="horizontal" decorative />
          <p className="break-words text-center text-xs text-muted-foreground" data-testid="level-preview-label">
            {ropeLabel({ style, colors: preview, ...previewTips })}
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
                name={`cor ${index + 1}`}
                value={value}
                onChange={(hex) => setColors(colors.map((c, i) => (i === index ? hex : c)))}
              />
            ))}
          </div>
          <FormMessage />
        </FormItem>
      )} />

      <section aria-labelledby="rope-tips-title" className="grid gap-3 rounded-lg border p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="rope-tips-title" className="text-sm font-medium">Pontas da corda</h3>
            <p className="text-xs text-muted-foreground">
              Pinte as duas pontas da corda, cada uma na sua cor. O corpo continua sendo o estilo e as cores acima.
            </p>
          </div>
          <Switch
            aria-label="Corda com pontas"
            checked={tipsEnabled}
            onCheckedChange={(checked) => {
              form.setValue("tipsEnabled", checked, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
              if (checked && !tipStart && !tipEnd) {
                setTip("tipStart", DEFAULT_TIP_START);
                setTip("tipEnd", DEFAULT_TIP_END);
              }
            }}
          />
        </div>
        {tipsEnabled && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <ColorSlot name="ponta de cima" value={tipStart} onChange={(hex) => setTip("tipStart", hex)} onClear={() => setTip("tipStart", "")} />
              <ColorSlot name="ponta de baixo" value={tipEnd} onChange={(hex) => setTip("tipEnd", hex)} onClear={() => setTip("tipEnd", "")} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const same = HEX_COLOR.test(tipStart) ? tipStart : tipEnd;
                  setTip("tipStart", same);
                  setTip("tipEnd", same);
                }}
              >
                Usar a mesma cor nas duas pontas
              </Button>
              {(form.formState.errors.tipStart?.message || form.formState.errors.tipEnd?.message) && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {form.formState.errors.tipStart?.message ?? form.formState.errors.tipEnd?.message}
                </p>
              )}
            </div>
          </>
        )}
      </section>
    </>
  );
}
