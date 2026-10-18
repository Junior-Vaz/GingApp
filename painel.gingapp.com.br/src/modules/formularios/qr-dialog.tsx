import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, Download, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { copyText, whatsappMessage, whatsappUrl } from "./share";

interface QrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  slug: string;
  url: string;
}

/** QR Code do link público (para cartaz impresso): baixar PNG, copiar o link e compartilhar no WhatsApp com texto pronto. */
export function QrDialog({ open, onOpenChange, title, slug, url }: QrDialogProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setDataUrl(null);
    setFailed(false);
    QRCode.toDataURL(url, { margin: 2, width: 512, errorCorrectionLevel: "M" })
      .then((value) => alive && setDataUrl(value))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [open, url]);

  const message = whatsappMessage(title, url);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="qr-dialog">
        <DialogHeader>
          <DialogTitle>QR Code da inscrição</DialogTitle>
          <DialogDescription>
            Imprima no cartaz ou compartilhe: quem escanear abre o formulário no celular.
          </DialogDescription>
        </DialogHeader>

        <div className="grid justify-items-center gap-1">
          {dataUrl ? (
            <img
              src={dataUrl}
              alt={`QR Code do formulário ${title}`}
              width={256}
              height={256}
              className="size-64 max-w-full rounded-md border bg-white p-2"
            />
          ) : failed ? (
            <p role="alert" className="py-8 text-sm text-destructive">
              Não foi possível gerar o QR Code. Copie o link abaixo.
            </p>
          ) : (
            <Skeleton className="size-64 max-w-full" />
          )}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="qr-link">Link público</Label>
          <Input
            id="qr-link"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="text-xs"
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <Button type="button" variant="outline" onClick={() => void copyText(url)}>
            <Copy /> Copiar link
          </Button>
          <Button
            asChild
            variant="outline"
            className={dataUrl ? "" : "pointer-events-none opacity-50"}
          >
            <a
              href={dataUrl ?? undefined}
              download={`qr-inscricao-${slug}.png`}
              aria-disabled={!dataUrl}
            >
              <Download /> Baixar PNG
            </a>
          </Button>
          <Button asChild>
            <a
              href={whatsappUrl(message)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Compartilhar no WhatsApp"
            >
              <Send /> WhatsApp
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
