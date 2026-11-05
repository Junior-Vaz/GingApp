import { useState } from "react";
import { Building2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { sponsorImageSrc, sponsorsErrorMessage, useSponsorMutations, useSponsors } from "./api";
import { useDebounced } from "./use-debounced";
import { SponsorForm } from "./sponsor-form";
import { SPONSOR_LIMITS, type GroupSponsor } from "./sponsor-utils";

function SponsorLogo({ sponsor }: { sponsor: GroupSponsor }) {
  const [failed, setFailed] = useState(false);
  const src = sponsorImageSrc(sponsor.logo);
  return (
    <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
      {src && !failed ? (
        <img src={src} alt={`Logo de ${sponsor.name}`} className="size-full object-contain" onError={() => setFailed(true)} />
      ) : (
        <Building2 className="size-5 text-muted-foreground" aria-hidden />
      )}
    </div>
  );
}

/** Aba "Patrocinadores": lista do grupo + criar/editar/excluir. Sem o termo aceito continua tudo editável (só ATIVAR campanhas é travado). */
export function SponsorsTab() {
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const list = useSponsors(q ? { q } : {});
  const { remove } = useSponsorMutations();
  const [editing, setEditing] = useState<GroupSponsor | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<GroupSponsor | null>(null);

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? items.length;

  function openForm(sponsor: GroupSponsor | null) {
    setEditing(sponsor);
    setFormOpen(true);
  }

  return (
    <div className="grid gap-4" data-testid="sponsors-tab">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-sm">
          <Label htmlFor="sponsor-search">Buscar patrocinador</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="sponsor-search" type="search" className="pl-9" placeholder="Nome do patrocinador" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <Button type="button" onClick={() => openForm(null)}>
          <Plus /> Novo patrocinador
        </Button>
      </div>

      {!q && !list.isLoading && !list.error && (
        <p className="text-xs text-muted-foreground" data-testid="sponsors-count">
          {total} de {SPONSOR_LIMITS.maxSponsors} patrocinadores (limite do grupo).
        </p>
      )}

      {list.isLoading ? (
        <div className="grid gap-3" data-testid="sponsors-loading" aria-busy="true">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
      ) : list.error ? (
        <Card className="items-center gap-3 p-6 text-center" role="alert" data-testid="sponsors-error">
          <p className="text-sm text-destructive">{sponsorsErrorMessage(list.error, "Não foi possível carregar os patrocinadores.")}</p>
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            Tentar novamente
          </Button>
        </Card>
      ) : items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground" data-testid="sponsors-empty">
          {q ? "Nenhum patrocinador encontrado para essa busca." : "Você ainda não tem patrocinadores. Cadastre o primeiro para criar campanhas."}
        </p>
      ) : (
        <ul className="grid gap-3" aria-label="Patrocinadores do grupo">
          {items.map((s) => (
            <li key={s.id}>
              <Card className="gap-3 p-4" data-testid="sponsor-card">
                <div className="flex flex-wrap items-start gap-3">
                  <SponsorLogo sponsor={s} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-tight [overflow-wrap:anywhere]">{s.name}</p>
                    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      {[s.contactName, s.contactEmail, s.contactPhone].filter(Boolean).join(" · ") || "Sem contato cadastrado"}
                    </p>
                    {typeof s.campaignsCount === "number" && (
                      <p className="text-xs text-muted-foreground">
                        {s.campaignsCount} {s.campaignsCount === 1 ? "campanha" : "campanhas"}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" aria-label={`Editar ${s.name}`} onClick={() => openForm(s)}>
                      <Pencil /> Editar
                    </Button>
                    <Button type="button" variant="outline" size="sm" aria-label={`Excluir ${s.name}`} onClick={() => setDeleting(s)}>
                      <Trash2 /> Excluir
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <SponsorForm open={formOpen} onOpenChange={setFormOpen} sponsor={editing} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Excluir patrocinador?"
        description={deleting ? `${deleting.name} será removido do seu grupo. Só é possível excluir patrocinadores que não têm campanhas.` : undefined}
        confirmLabel="Excluir"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            toast.success("Patrocinador excluído.");
          } catch (error) {
            toast.error(sponsorsErrorMessage(error, "Não foi possível excluir o patrocinador."));
            // 409/404/403 são definitivos (fecha o diálogo); falhas de rede permitem tentar de novo.
            if (!(error instanceof ApiError) || error.status >= 500) throw error;
          }
        }}
      />
    </div>
  );
}
