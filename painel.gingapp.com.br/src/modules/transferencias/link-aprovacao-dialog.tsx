import { toast } from "sonner";
import { Copy, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmt, toDate } from "@/lib/format";
import { approvalWhatsAppUrl } from "./approval-link";
import type { ApprovalLink } from "./transfer-api";

/**
 * Link de aprovação de transferência para ADULTO sem login (o token só existe nesta resposta: não fica guardado em
 * claro, então é aqui que o Mestre copia ou envia). Gerar outro link invalida este.
 */
export function ApprovalLinkDialog({
  link,
  personName,
  groupName,
  onClose,
}: {
  link: ApprovalLink | null;
  personName: string;
  groupName?: string | undefined;
  onClose: () => void;
}) {
  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não foi possível copiar o link. Selecione o texto e copie manualmente.");
    }
  }

  return (
    <Dialog open={link !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="approval-link-dialog">
        <DialogHeader>
          <DialogTitle>Link de aprovação</DialogTitle>
          <DialogDescription>
            {personName} é adulto e ainda não tem login. Envie este link para que ele(a) aprove ou recuse a
            transferência, sem precisar de conta.
          </DialogDescription>
        </DialogHeader>
        {link && (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="approval-link-url">Link</Label>
              <Input id="approval-link-url" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void copy()}>
                <Copy /> Copiar
              </Button>
              <Button type="button" asChild>
                <a href={approvalWhatsAppUrl(link, personName, groupName)} target="_blank" rel="noopener noreferrer">
                  <MessageCircle /> Enviar por WhatsApp
                </a>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground" data-testid="approval-link-expiry">
              O link vale até {fmt(toDate(link.expiresAt), "dd/MM/yyyy 'às' HH:mm")} e serve só para adulto (menores são
              aprovados pelo responsável, no app). Gerar um novo link invalida este.
            </p>
            {link.emailed && (
              <p className="text-sm font-medium text-primary" data-testid="approval-link-emailed">
                O link também foi enviado por e-mail.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
