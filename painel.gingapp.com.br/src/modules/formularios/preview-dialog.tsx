import type { ReactNode } from "react";
import { GitBranch } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { imageSrc } from "@/lib/uploads";
import { allFields, type BField, type Draft } from "./builder";
import { PixPreview } from "./settings-tab";
import { FIELD_TYPE_INFO } from "./types";

const INPUT =
  "flex min-h-11 w-full items-center rounded-md border border-input bg-muted/30 px-3 text-sm text-muted-foreground";

/** Um campo como o inscrito o vê, só para leitura (nada aqui recebe resposta). */
function PreviewField({ field, draft }: { field: BField; draft: Draft }) {
  const label = field.label.trim() || FIELD_TYPE_INFO[field.type].label;
  const source = field.showIf
    ? allFields(draft).find((f) => f.key === field.showIf?.fieldKey)
    : undefined;

  if (field.type === "INFO") {
    return (
      <div className="rounded-md bg-muted/50 p-3 text-sm">
        <p className="font-semibold">{label}</p>
        {field.helpText && (
          <p className="mt-1 whitespace-pre-line text-muted-foreground">{field.helpText}</p>
        )}
      </div>
    );
  }

  const options = field.options ?? [];
  let control: ReactNode;
  switch (field.type) {
    case "LONG_TEXT":
      control = <div className={`${INPUT} min-h-20 items-start py-2`}>Sua resposta</div>;
      break;
    case "SELECT":
      control = <div className={INPUT}>Escolha uma opção…</div>;
      break;
    case "SINGLE_CHOICE":
    case "MULTI_CHOICE":
      control = (
        <ul className="grid gap-1.5">
          {options.map((option) => (
            <li key={option} className="flex min-h-11 items-center gap-2 text-sm">
              <span
                aria-hidden
                className={`size-4 shrink-0 border border-input ${field.type === "SINGLE_CHOICE" ? "rounded-full" : "rounded-sm"}`}
              />
              {option}
            </li>
          ))}
        </ul>
      );
      break;
    case "CONSENT":
      control = (
        <div className="flex items-start gap-2 text-sm">
          <span aria-hidden className="mt-0.5 size-4 shrink-0 rounded-sm border border-input" />
          <span>{draft.consentText.trim() || "Li e aceito os termos."}</span>
        </div>
      );
      break;
    case "FILE":
      control = <div className={INPUT}>Escolher arquivo (imagem ou PDF)</div>;
      break;
    case "DATE":
      control = <div className={INPUT}>dd/mm/aaaa</div>;
      break;
    default:
      control = <div className={INPUT}>Sua resposta</div>;
  }

  return (
    <div className="grid gap-1.5">
      <p className="text-sm font-medium">
        {label}
        {field.required && (
          <span className="text-destructive" aria-label=" (obrigatório)">
            {" "}
            *
          </span>
        )}
      </p>
      {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
      {control}
      {field.showIf && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <GitBranch className="size-3" aria-hidden /> Aparece só se “{source?.label ?? "?"}” for “
          {field.showIf.equals || "…"}”.
        </p>
      )}
    </div>
  );
}

/** "Ver como o inscrito vê": prévia somente leitura do rascunho atual (inclusive o que ainda não foi salvo). */
export function PreviewDialog({
  open,
  onOpenChange,
  draft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: Draft;
}) {
  const banner = imageSrc(draft.bannerUrl.trim());
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92dvh] overflow-y-auto sm:max-w-xl"
        data-testid="preview-dialog"
      >
        <DialogHeader>
          <DialogTitle>Como o inscrito vê</DialogTitle>
          <DialogDescription>
            Prévia somente leitura, com o que está no editor agora. A página real pode ter pequenas
            diferenças visuais.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 rounded-xl border bg-background p-3 sm:p-4">
          {banner && (
            <img
              src={banner}
              alt="Banner do formulário"
              className="max-h-48 w-full rounded-lg object-cover"
            />
          )}
          <h2 className="text-xl font-bold">{draft.title || "Sem título"}</h2>
          {draft.intro.trim() && (
            <p className="whitespace-pre-line text-sm text-muted-foreground">{draft.intro}</p>
          )}
          {draft.sections.map((section) => (
            <section key={section.cid} className="grid gap-3" aria-label={section.title}>
              <div>
                <h3 className="border-b pb-1 text-base font-semibold">{section.title}</h3>
                {section.description.trim() && (
                  <p className="pt-1 text-xs text-muted-foreground">{section.description}</p>
                )}
              </div>
              {section.fields.length === 0 && (
                <p className="text-xs text-muted-foreground">Sem campos.</p>
              )}
              {section.fields.map((field) => (
                <PreviewField key={field.key} field={field} draft={draft} />
              ))}
            </section>
          ))}
          {draft.paymentMode === "PIX_MANUAL" && <PixPreview draft={draft} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
