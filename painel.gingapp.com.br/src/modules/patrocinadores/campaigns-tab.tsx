import { useId, useState } from "react";
import { BarChart3, ImageOff, Pause, Pencil, Play, Plus, Rocket, Search, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { NativeSelect } from "@/modules/alunos/native-select";
import { sponsorImageSrc, sponsorsErrorMessage, useCampaignMutations, useCampaigns, useSponsors } from "./api";
import { CampaignForm } from "./campaign-form";
import { ReportSheet } from "./report-sheet";
import { RulesNotice } from "./rules-notice";
import { StatusChip } from "./status-chip";
import { useDebounced } from "./use-debounced";
import {
  EFFECTIVE_STATUS_META,
  EFFECTIVE_STATUS_ORDER,
  SPONSOR_NOTICES,
  activateBlockReason,
  campaignSponsorName,
  categoryLabel,
  formatInstant,
  type EffectiveStatus,
  type GroupCampaign,
  type SponsorTerms,
} from "./sponsor-utils";

type ActionKind = "activate" | "pause" | "resume" | "delete";

function Thumb({ campaign }: { campaign: GroupCampaign }) {
  const [failed, setFailed] = useState(false);
  const src = sponsorImageSrc(campaign.imageRef);
  return (
    <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
      {src && !failed ? (
        <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <ImageOff className="size-5 text-muted-foreground" aria-hidden />
      )}
    </div>
  );
}

function hostOf(campaign: GroupCampaign): string {
  if (campaign.destinationHost) return campaign.destinationHost;
  try {
    return new URL(campaign.destinationUrl).hostname;
  } catch {
    return campaign.destinationUrl;
  }
}

interface CampaignCardProps {
  campaign: GroupCampaign;
  sponsorName: string;
  blockReason: string | null;
  onEdit: () => void;
  onReport: () => void;
  onAction: (kind: ActionKind) => void;
}

function CampaignCard({ campaign: c, sponsorName, blockReason, onEdit, onReport, onAction }: CampaignCardProps) {
  const reasonId = useId();
  const ended = c.effectiveStatus === "ENDED";
  const suspended = c.platformSuspended;
  // Ativar: rascunho; Retomar: pausada; Pausar: ativa (agendada ou no ar). Encerrada e suspensa pela plataforma: nenhuma das três.
  const canActivate = !ended && !suspended && c.status === "DRAFT";
  const canResume = !ended && !suspended && c.status === "PAUSED";
  const canPause = !ended && !suspended && c.status === "ACTIVE";
  const approver = c.approvedBy?.name;

  return (
    <Card className="gap-3 p-4" data-testid="campaign-card" data-campaign-id={c.id}>
      <div className="flex flex-wrap items-start gap-3">
        <Thumb campaign={c} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold leading-tight [overflow-wrap:anywhere]">{c.title}</h3>
            <StatusChip status={c.effectiveStatus} />
          </div>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {sponsorName} · {categoryLabel(c.category)}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatInstant(c.startsAt)} até {formatInstant(c.endsAt)} · {hostOf(c)}
          </p>
          {c.approvedAt && (
            <p className="text-xs text-muted-foreground">
              Ativada{approver ? ` por ${approver}` : ""} em {formatInstant(c.approvedAt)}
            </p>
          )}
        </div>
      </div>

      {suspended && (
        <div role="alert" data-testid="suspended-alert" className="flex items-start gap-2 rounded-md border-2 border-destructive/60 bg-red-50 p-3 text-sm text-red-950">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Suspensa pela plataforma</p>
            <p>
              <strong>Motivo:</strong> {c.platformSuspendReason?.trim() || "não informado"}
            </p>
            <p className="text-xs">Esta campanha não está no ar e você não pode retomá-la. Fale com o suporte do GingApp.</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canActivate && (
          <Button
            type="button"
            size="sm"
            disabled={blockReason !== null}
            aria-describedby={blockReason ? reasonId : undefined}
            aria-label={`Ativar ${c.title}`}
            onClick={() => onAction("activate")}
          >
            <Rocket /> Ativar
          </Button>
        )}
        {canResume && (
          <Button type="button" size="sm" aria-label={`Retomar ${c.title}`} onClick={() => onAction("resume")}>
            <Play /> Retomar
          </Button>
        )}
        {canPause && (
          <Button type="button" size="sm" variant="outline" aria-label={`Pausar ${c.title}`} onClick={() => onAction("pause")}>
            <Pause /> Pausar
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" aria-label={`Editar ${c.title}`} onClick={onEdit}>
          <Pencil /> Editar
        </Button>
        <Button type="button" size="sm" variant="outline" aria-label={`Relatório de ${c.title}`} onClick={onReport}>
          <BarChart3 /> Relatório
        </Button>
        <Button type="button" size="sm" variant="outline" aria-label={`Excluir ${c.title}`} onClick={() => onAction("delete")}>
          <Trash2 /> Excluir
        </Button>
      </div>
      {canActivate && blockReason && (
        <p id={reasonId} className="text-xs text-amber-900" data-testid="activate-reason">
          {blockReason}
        </p>
      )}
    </Card>
  );
}

interface Pending {
  kind: ActionKind;
  campaign: GroupCampaign;
}

/** Aba "Campanhas": lista com chips de situação, filtros e busca; formulário; ações com confirmação; relatório. */
export function CampaignsTab({ terms }: { terms: SponsorTerms | undefined }) {
  const [effective, setEffective] = useState<EffectiveStatus | "">("");
  const [sponsorId, setSponsorId] = useState("");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const params = {
    ...(effective ? { effective } : {}),
    ...(sponsorId ? { sponsorId: Number(sponsorId) } : {}),
    ...(q ? { q } : {}),
  };
  const list = useCampaigns(params);
  const sponsors = useSponsors({});
  const sponsorItems = sponsors.data?.items ?? [];
  const mutations = useCampaignMutations();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<GroupCampaign | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reportFor, setReportFor] = useState<GroupCampaign | null>(null);
  const searchId = useId();
  const sponsorSelectId = useId();

  const items = list.data?.items ?? [];
  const filtered = effective !== "" || sponsorId !== "" || q !== "";
  const blockReason = activateBlockReason(terms);

  function openForm(campaign: GroupCampaign | null) {
    setEditing(campaign);
    setFormOpen(true);
  }

  async function runAction({ kind, campaign }: Pending) {
    try {
      if (kind === "activate") {
        await mutations.activate.mutateAsync(campaign.id);
        toast.success("Campanha ativada. Ela aparece para os alunos adultos dentro do período definido.");
      } else if (kind === "pause") {
        await mutations.pause.mutateAsync(campaign.id);
        toast.success("Campanha pausada: ela saiu do ar.");
      } else if (kind === "resume") {
        await mutations.resume.mutateAsync(campaign.id);
        toast.success("Campanha retomada.");
      } else {
        await mutations.remove.mutateAsync(campaign.id);
        toast.success("Campanha excluída.");
      }
    } catch (error) {
      toast.error(sponsorsErrorMessage(error, "Não foi possível concluir a ação."));
      // 409/403/404/400 são definitivos (fecha o diálogo); falha de rede/5xx permite tentar de novo.
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
    }
  }

  const dialog = pending && dialogText(pending);

  return (
    <div className="grid gap-4" data-testid="campaigns-tab">
      <RulesNotice />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2 lg:max-w-2xl">
          <div className="grid gap-1.5">
            <Label htmlFor={searchId}>Buscar campanha</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input id={searchId} type="search" className="pl-9" placeholder="Título da campanha" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={sponsorSelectId}>Patrocinador</Label>
            <NativeSelect id={sponsorSelectId} className="h-11 md:h-9" value={sponsorId} onChange={(e) => setSponsorId(e.target.value)}>
              <option value="">Todos</option>
              {sponsorItems.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <Button type="button" onClick={() => openForm(null)}>
          <Plus /> Nova campanha
        </Button>
      </div>

      <div role="group" aria-label="Filtrar por situação" className="flex flex-wrap gap-2" data-testid="status-filter">
        {([["", "Todas"], ...EFFECTIVE_STATUS_ORDER.map((s) => [s, EFFECTIVE_STATUS_META[s].label] as const)] as ReadonlyArray<readonly [EffectiveStatus | "", string]>).map(
          ([value, label]) => (
            <button
              key={value || "all"}
              type="button"
              aria-pressed={effective === value}
              onClick={() => setEffective(value)}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-8",
                effective === value ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
              )}
            >
              {label}
            </button>
          ),
        )}
      </div>

      {list.isLoading ? (
        <div className="grid gap-3" data-testid="campaigns-loading" aria-busy="true">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
        </div>
      ) : list.error ? (
        <Card className="items-center gap-3 p-6 text-center" role="alert" data-testid="campaigns-error">
          <p className="text-sm text-destructive">{sponsorsErrorMessage(list.error, "Não foi possível carregar as campanhas.")}</p>
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            Tentar novamente
          </Button>
        </Card>
      ) : items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground" data-testid="campaigns-empty">
          {filtered ? "Nenhuma campanha encontrada com esses filtros." : "Você ainda não tem campanhas. Crie a primeira e ative quando estiver pronta."}
        </p>
      ) : (
        <ul className="grid gap-3" aria-label="Campanhas do grupo">
          {items.map((c) => (
            <li key={c.id}>
              <CampaignCard
                campaign={c}
                sponsorName={campaignSponsorName(c, sponsorItems)}
                blockReason={blockReason}
                onEdit={() => openForm(c)}
                onReport={() => setReportFor(c)}
                onAction={(kind) => setPending({ kind, campaign: c })}
              />
            </li>
          ))}
        </ul>
      )}

      <CampaignForm open={formOpen} onOpenChange={setFormOpen} campaign={editing} sponsors={sponsorItems} />
      <ReportSheet campaign={reportFor} sponsorName={reportFor ? campaignSponsorName(reportFor, sponsorItems) : ""} onClose={() => setReportFor(null)} />

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title={dialog ? dialog.title : ""}
        description={dialog ? dialog.description : undefined}
        confirmLabel={dialog ? dialog.confirmLabel : "Confirmar"}
        variant={pending?.kind === "delete" ? "destructive" : "default"}
        onConfirm={() => (pending ? runAction(pending) : undefined)}
      />
    </div>
  );
}

function dialogText({ kind, campaign: c }: Pending) {
  const period = `${formatInstant(c.startsAt)} até ${formatInstant(c.endsAt)}`;
  switch (kind) {
    case "activate":
      return {
        title: "Ativar esta campanha?",
        confirmLabel: "Ativar e publicar",
        description: (
          <>
            <span className="block">
              &ldquo;{c.title}&rdquo; vai ao ar no app dos alunos adultos do seu grupo no período {period}. Se o início já passou, ela aparece na hora.
            </span>
            <span className="mt-2 block font-medium">
              Você responde pelo conteúdo e pelo link deste anúncio, conforme o termo de responsabilidade. {SPONSOR_NOTICES.minors} {SPONSOR_NOTICES.badge}
            </span>
          </>
        ),
      };
    case "pause":
      return {
        title: "Pausar esta campanha?",
        confirmLabel: "Pausar",
        description: `"${c.title}" sai do ar agora. Você pode retomá-la depois, sem precisar ativar de novo (se o conteúdo não mudar).`,
      };
    case "resume":
      return {
        title: "Retomar esta campanha?",
        confirmLabel: "Retomar",
        description: `"${c.title}" volta ao ar no período ${period}, com o mesmo conteúdo já aprovado por você.`,
      };
    case "delete":
      return {
        title: "Excluir esta campanha?",
        confirmLabel: "Excluir",
        description: `"${c.title}" será apagada junto com os números de impressões e cliques. Não dá para desfazer.`,
      };
  }
}
