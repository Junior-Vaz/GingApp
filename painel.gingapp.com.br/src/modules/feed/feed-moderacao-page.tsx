import { useState } from "react";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSessionUser } from "@/lib/session";
import { flattenQueue, useQueue } from "./api";
import { QueueList } from "./moderation-queue";
import { FeedSettingsCard } from "./settings-card";
import { QUEUE_KINDS, QUEUE_LABEL, type QueueKind } from "./types";

/**
 * O contrato não oferece uma contagem barata: a fila devolve só `items` + `nextCursor`. O selo da aba "Pendentes" mostra
 * quantos já foram carregados ("15+" quando há mais páginas).
 */
function PendingBadge() {
  const query = useQueue("PENDING");
  const count = flattenQueue(query.data).length;
  if (query.isPending || query.isError || count === 0) return null;
  const label = `${String(count)}${query.hasNextPage ? "+" : ""}`;
  return (
    <Badge variant="destructive" className="ml-1.5 px-1.5 py-0" aria-label={`${label} pendentes`}>
      {label}
    </Badge>
  );
}

/** Feed do grupo (/feed-moderacao): configurações (só Mestre) e fila de moderação por abas. */
export function FeedModeracaoPage() {
  const isMestre = useSessionUser()?.role === "MESTRE";
  const [tab, setTab] = useState<QueueKind>("PENDING");

  return (
    <>
      <PageHeader
        title="Feed do grupo"
        description="Aprove, oculte ou remova as publicações do feed e trate as denúncias."
      />
      {isMestre && <FeedSettingsCard />}

      <Tabs value={tab} onValueChange={(next) => setTab(next as QueueKind)}>
        <TabsList aria-label="Fila de moderação">
          {QUEUE_KINDS.map((kind) => (
            <TabsTrigger key={kind} value={kind}>
              {QUEUE_LABEL[kind]}
              {kind === "PENDING" && <PendingBadge />}
            </TabsTrigger>
          ))}
        </TabsList>
        {QUEUE_KINDS.map((kind) => (
          <TabsContent key={kind} value={kind} className="mt-3">
            <QueueList kind={kind} />
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
