import { Construction } from "lucide-react";
import { PageHeader } from "@/components/painel/page-header";
import { Card } from "@/components/ui/card";

/** Página padrão dos módulos ainda não migrados (fase 2b substitui por tela real). */
export function EmConstrucao({ title }: { title: string }) {
  return (
    <div>
      <PageHeader title={title} />
      <Card className="items-center gap-3 px-6 py-14 text-center" data-testid="em-construcao">
        <span className="grid size-12 place-items-center rounded-full bg-secondary text-primary">
          <Construction className="size-6" />
        </span>
        <h2 className="text-lg font-bold">Em construção</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          O módulo {title} está sendo migrado para o novo painel e estará disponível em breve.
        </p>
      </Card>
    </div>
  );
}
