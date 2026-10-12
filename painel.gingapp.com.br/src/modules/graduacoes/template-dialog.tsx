import type { UseFormReturn } from "react-hook-form";
import { RopeSwatch } from "@/components/painel/rope-swatch";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTemplates } from "./graduacoes-api";
import type { TemplateFormValues } from "./graduacoes-forms";

/** Campos do diálogo "Criar a partir de um modelo": modelos com prévia das cordas + nome do novo sistema. */
export function TemplateFields({ form }: { form: UseFormReturn<TemplateFormValues> }) {
  const templates = useTemplates();
  const code = form.watch("code");

  function body() {
    if (templates.isLoading) return <Skeleton className="h-32 w-full" />;
    if (templates.error) {
      return <p className="text-sm text-destructive">{errorMessage(templates.error, "Não foi possível carregar os modelos.")}</p>;
    }
    if (!templates.data || templates.data.length === 0) {
      return <p className="text-sm text-muted-foreground">Nenhum modelo disponível no momento.</p>;
    }
    return (
      <div role="radiogroup" aria-label="Modelo" className="grid max-h-80 gap-2 overflow-y-auto pr-1">
        {templates.data.map((template) => {
          const selected = template.code === code;
          return (
            <button
              key={template.code}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                const previous = templates.data?.find((t) => t.code === code);
                form.setValue("code", template.code, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
                const current = form.getValues("name");
                if (!current.trim() || current === previous?.name) form.setValue("name", template.name);
              }}
              className={cn(
                "grid gap-2 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected && "border-primary bg-primary/5 ring-1 ring-primary",
              )}
            >
              <span className="text-sm font-semibold">{template.name}</span>
              {template.description && <span className="text-xs text-muted-foreground">{template.description}</span>}
              <span className="flex flex-wrap gap-2 pt-1" data-testid={`template-preview-${template.code}`}>
                {template.levels.map((level, index) => (
                  <span key={index} className="flex w-12 flex-col items-center gap-1" title={level.name}>
                    <RopeSwatch style={level.style} colors={level.colors} size="md" orientation="vertical" />
                    <span className="w-full truncate text-center text-[10px] text-muted-foreground">{level.name}</span>
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <FormField control={form.control} name="code" render={() => (
        <FormItem>
          <FormLabel>Modelo</FormLabel>
          {body()}
          <FormMessage />
        </FormItem>
      )} />
      <FormField control={form.control} name="name" render={({ field }) => (
        <FormItem>
          <FormLabel>Nome do sistema</FormLabel>
          <FormControl><Input {...field} /></FormControl>
          <FormMessage />
        </FormItem>
      )} />
    </>
  );
}
