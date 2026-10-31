import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Mostra o PDF gerado pelo servidor (referência final do certificado) num quadro; também abre em outra aba. */
export function PdfPreviewDialog({
  open,
  onOpenChange,
  url,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** URL de objeto (blob:) do PDF. */
  url: string | null;
}) {
  return (
    <Dialog open={open && url !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] max-w-5xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Pré-visualização do PDF</DialogTitle>
          <DialogDescription>
            Gerada pelo servidor com dados de exemplo. Este PDF é a referência final do certificado; a folha do editor é uma
            aproximação.
          </DialogDescription>
        </DialogHeader>
        {url && (
          <iframe
            title="PDF do certificado (pré-visualização)"
            src={url}
            data-testid="pdf-frame"
            className="h-[68dvh] w-full rounded-md border bg-muted"
          />
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {url && (
            <Button variant="outline" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink /> Abrir em nova aba
              </a>
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
