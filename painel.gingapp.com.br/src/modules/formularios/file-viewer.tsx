import { useEffect, useState } from "react";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { FORBIDDEN_MESSAGE, formsErrorMessage, useSubmissionFile } from "./api";
import { formatBytes } from "./submission-utils";
import type { Id, SubmissionFile } from "./types";

/** Tipos que o navegador pode mostrar sem executar nada. Qualquer outro vira download (nunca é aberto na origem do painel). */
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
const PDF_TYPE = "application/pdf";

/** Tipo SEGURO do blob: o que o servidor declarou só vale se estiver na lista; o resto é binário opaco. */
function safeBlobType(mimeType: string): string {
  const type = mimeType.toLowerCase();
  return (IMAGE_TYPES as readonly string[]).includes(type) || type === PDF_TYPE
    ? type
    : "application/octet-stream";
}

/**
 * URL temporária (blob) do arquivo baixado com o token; revogada ao trocar/fechar. O blob é recriado com o tipo da
 * lista segura, para que HTML/SVG disfarçado de comprovante nunca seja interpretado pelo navegador.
 */
function useBlobUrl(blob: Blob | undefined, mimeType: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const created = URL.createObjectURL(new Blob([blob], { type: safeBlobType(mimeType ?? "") }));
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [blob, mimeType]);
  return url;
}

/**
 * Visualizador do comprovante: baixa o arquivo PRIVADO com a sessão do painel (a rota exige Authorization) e mostra a
 * imagem na tela. PDF NÃO é embutido (um quadro com PDF da origem do painel é superfície de ataque e o Chrome nem
 * o exibe dentro de `sandbox`): há os botões "Abrir em outra aba" (só imagem/PDF) e "Baixar". Nunca renderiza HTML.
 */
export function FileViewer({
  formId,
  submissionId,
  file,
  onClose,
}: {
  formId: Id;
  submissionId: Id;
  file: SubmissionFile | null;
  onClose: () => void;
}) {
  const query = useSubmissionFile(formId, submissionId, file?.id ?? null);
  const url = useBlobUrl(query.data, file?.mimeType);
  const safeType = safeBlobType(file?.mimeType ?? "");
  const isImage = (IMAGE_TYPES as readonly string[]).includes(safeType);
  const isPdf = safeType === PDF_TYPE;

  return (
    <Dialog open={file !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[94dvh] overflow-y-auto sm:max-w-2xl"
        data-testid="file-viewer"
      >
        <DialogHeader>
          <DialogTitle className="break-all">{file?.originalName ?? "Arquivo"}</DialogTitle>
          <DialogDescription>
            {file ? `${file.mimeType} · ${formatBytes(file.sizeBytes)}` : ""} · Arquivo privado: só
            quem gerencia o formulário vê.
          </DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <div className="grid justify-items-center gap-2 py-6" aria-busy="true" role="status">
            <Skeleton className="h-64 w-full" />
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando o arquivo…
            </span>
          </div>
        ) : query.error ? (
          <div className="grid gap-3 py-4 text-center">
            <p role="alert" className="text-sm text-destructive">
              {formsErrorMessage(
                query.error,
                "Não foi possível carregar o arquivo.",
                FORBIDDEN_MESSAGE.file,
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              className="justify-self-center"
              onClick={() => void query.refetch()}
            >
              Tentar de novo
            </Button>
          </div>
        ) : url && file ? (
          <div className="grid gap-3">
            {isImage ? (
              <img
                src={url}
                alt={`Comprovante: ${file.originalName}`}
                className="max-h-[60dvh] w-full rounded-md border object-contain"
              />
            ) : (
              <p
                className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground"
                data-testid="file-no-preview"
              >
                {isPdf
                  ? "PDF: use “Abrir em outra aba” ou “Baixar”."
                  : "Não há pré-visualização para este tipo de arquivo. Use “Baixar”."}
              </p>
            )}
            <div className={isImage || isPdf ? "grid gap-2 sm:grid-cols-2" : "grid gap-2"}>
              {(isImage || isPdf) && (
                <Button asChild variant="outline">
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink /> Abrir em outra aba
                  </a>
                </Button>
              )}
              <Button asChild variant="outline">
                <a href={url} download={file.originalName}>
                  <Download /> Baixar
                </a>
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
