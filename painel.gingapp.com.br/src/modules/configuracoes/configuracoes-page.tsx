import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { FormDialog } from "@/components/painel/form-dialog";
import { ImageUploadField } from "@/components/painel/image-upload-field";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { BR_UFS } from "@/lib/br-ufs";
import { notifyError } from "@/lib/crud";
import { useDashboard } from "@/lib/dashboard";
import { formatCurrency, fmt, toDate } from "@/lib/format";
import { useSessionUser } from "@/lib/session";
import { imageSrc } from "@/lib/uploads";
import { NativeSelect } from "@/modules/alunos/native-select";
import { ORG_KEY, useOwnOrganization } from "./org-api";
import {
  SOCIAL_NETWORKS,
  organizationSchema,
  organizationToForm,
  organizationToPayload,
  type OrganizationFormValues,
  type OrganizationUpdateInput,
} from "./org-schema";
import {
  SUBSCRIPTION_LABEL,
  usagePercent,
  type Organization,
  type Subscription,
} from "./plan";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold">{value || "-"}</dd>
    </div>
  );
}

function LinkField({ label, href }: { label: string; href: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="break-all text-sm font-semibold">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
            {href}
          </a>
        ) : (
          "-"
        )}
      </dd>
    </div>
  );
}

function ErrorCard({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Card className="items-center gap-3 p-6 text-center" role="alert">
      <p className="text-sm text-destructive">{errorMessage(error, "Não foi possível carregar.")}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Tentar novamente
      </Button>
    </Card>
  );
}

/**
 * Preferências de aviso do grupo. Hoje: avisar responsáveis e alunos quando a presença é registrada
 * (PATCH /organizations/me { attendanceNotifications }). Só o Mestre altera; os demais veem o estado.
 */
function NotificationsCard() {
  const queryClient = useQueryClient();
  const canEdit = useSessionUser()?.role === "MESTRE";
  const org = useOwnOrganization();
  const save = useMutation({
    mutationFn: (attendanceNotifications: boolean) => api.patch<Organization>("/organizations/me", { attendanceNotifications }),
    onSuccess: (_data, attendanceNotifications) => {
      void queryClient.invalidateQueries({ queryKey: ORG_KEY });
      toast.success(attendanceNotifications ? "Avisos de presença ligados." : "Avisos de presença desligados.");
    },
    onError: (error) => notifyError(error),
  });
  if (org.error) return null; // o cartão "Dados do grupo" (mesma consulta) já mostra o erro e o "Tentar novamente"
  const checked = save.isPending ? save.variables : (org.data?.attendanceNotifications ?? false);
  return (
    <Card className="gap-4 p-5" data-testid="notifications-card">
      <h2 className="text-lg font-bold">Avisos automáticos</h2>
      {org.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="min-w-0">
            <p id="attendance-notifications-label" className="text-sm font-semibold">
              Avisar responsáveis e alunos quando a presença for registrada
            </p>
            <p id="attendance-notifications-help" className="mt-1 text-xs text-muted-foreground">
              Quando ligado, os alunos marcados como presentes e seus responsáveis recebem uma notificação no app assim que a
              chamada é salva.
              {!canEdit && " Somente o Mestre do grupo pode alterar."}
            </p>
          </div>
          <Switch
            aria-labelledby="attendance-notifications-label"
            aria-describedby="attendance-notifications-help"
            checked={checked}
            disabled={!canEdit || !org.data || save.isPending}
            onCheckedChange={(value) => save.mutate(value)}
          />
        </div>
      )}
    </Card>
  );
}

function OrganizationCard() {
  const queryClient = useQueryClient();
  // PATCH /organizations/me é exclusivo do MESTRE do grupo (backend: MestreOnlyGuard); os demais só leem.
  const canEdit = useSessionUser()?.role === "MESTRE";
  const [editing, setEditing] = useState(false);
  const org = useOwnOrganization();
  const save = useMutation({
    mutationFn: (data: OrganizationUpdateInput) => api.patch<Organization>("/organizations/me", data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ORG_KEY });
      toast.success("Dados do grupo atualizados.");
    },
    onError: (error) => notifyError(error),
  });

  if (org.error) return <ErrorCard error={org.error} onRetry={() => void org.refetch()} />;
  const data = org.data;
  const location = data ? [data.city, data.state].filter(Boolean).join(" / ") : "";

  return (
    <Card className="gap-4 p-5" data-testid="org-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Dados do grupo</h2>
        {canEdit && data && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil /> Editar dados do grupo
          </Button>
        )}
      </div>
      {org.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : data ? (
        <>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" value={data.name} />
            <Field label="Identificador (slug)" value={data.slug} />
            <Field label="Documento (CNPJ/CPF)" value={data.document} />
            <Field label="E-mail" value={data.email} />
            <Field label="Telefone" value={data.phone} />
            <Field label="Situação" value={data.status === "ACTIVE" ? "Ativo" : data.status} />
            <Field label="Ano de fundação" value={data.foundedYear ? String(data.foundedYear) : null} />
            <Field label="Cidade / UF" value={location} />
            <Field label="Aparece no mapa da comunidade" value={data.mapVisible === false ? "Não" : "Sim"} />
            <LinkField label="Site" href={data.website} />
            <LinkField label="Logomarca" href={imageSrc(data.logo)} />
            {SOCIAL_NETWORKS.map(({ key, label }) => (
              <LinkField key={key} label={label} href={data.socialLinks?.[key]} />
            ))}
          </dl>
          <dl className="grid gap-4">
            <Field label="Apresentação" value={data.description} />
            <div>
              <dt className="text-xs font-medium text-muted-foreground">História</dt>
              <dd className="whitespace-pre-line text-sm">{data.history || "-"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Como pagar (mostrado aos alunos no app)</dt>
              <dd className="whitespace-pre-line text-sm" data-testid="payment-instructions">
                {data.paymentInstructions || "-"}
              </dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Organização não encontrada.</p>
      )}
      <p className="text-xs text-muted-foreground">
        {canEdit
          ? "O identificador (slug) e a situação do grupo só podem ser alterados pela equipe GingApp."
          : "Somente o Mestre do grupo pode editar estes dados."}
      </p>

      {data && canEdit && (
        <FormDialog<OrganizationFormValues>
          as="sheet"
          open={editing}
          onOpenChange={setEditing}
          title="Editar dados do grupo"
          description="Estes dados aparecem no perfil do grupo. Campos vazios são removidos."
          schema={organizationSchema}
          defaultValues={organizationToForm(data)}
          onSubmit={(values) => save.mutateAsync(organizationToPayload(values))}
        >
          {(form) => (
            <>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome do grupo</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="document"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Documento (CNPJ/CPF)</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>E-mail</FormLabel>
                      <FormControl>
                        <Input type="email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Telefone</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Apresentação</FormLabel>
                    <FormControl>
                      <Textarea rows={3} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="history"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>História do grupo</FormLabel>
                    <FormControl>
                      <Textarea rows={5} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-3 gap-3">
                <FormField
                  control={form.control}
                  name="foundedYear"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ano de fundação</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" placeholder="1998" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cidade</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>UF</FormLabel>
                      <FormControl>
                        <NativeSelect {...field}>
                          <option value="">—</option>
                          {BR_UFS.map((uf) => (
                            <option key={uf} value={uf}>
                              {uf}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="website"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Site</FormLabel>
                    <FormControl>
                      <Input placeholder="https://" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <ImageUploadField<OrganizationFormValues>
                name="logo"
                label="Logomarca"
                shape="square"
                previewAlt="Logomarca do grupo"
                description="Envie a logomarca (JPEG, PNG ou WebP até 5 MB) ou cole o link de uma imagem já publicada."
              />
              <FormField
                control={form.control}
                name="paymentInstructions"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Como pagar</FormLabel>
                    <FormControl>
                      <Textarea rows={4} placeholder="Chave PIX, dados bancários, orientações…" {...field} />
                    </FormControl>
                    <FormDescription>Aparece para alunos e responsáveis na tela Financeiro do app.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="mapVisible"
                render={({ field }) => (
                  <FormItem className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <FormLabel>Aparecer no mapa da comunidade</FormLabel>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </div>
                    <FormDescription>
                      Quando ligado, as unidades, os treinos, os eventos públicos e as rodas do grupo (que tenham posição no
                      mapa) aparecem para todos no mapa da comunidade do app. Desligue para esconder o grupo.
                    </FormDescription>
                  </FormItem>
                )}
              />
              {SOCIAL_NETWORKS.map(({ key, label }) => (
                <FormField
                  key={key}
                  control={form.control}
                  name={key}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{label}</FormLabel>
                      <FormControl>
                        <Input placeholder="https://" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </>
          )}
        </FormDialog>
      )}
    </Card>
  );
}

function PlanCard() {
  const subscription = useQuery({
    queryKey: ["subscriptions", "me"],
    queryFn: () => api.get<Subscription | null>("/subscriptions/me"),
  });
  // Alunos ativos vem do agregado do dashboard (GET /students e limitado a 50 itens).
  const dashboard = useDashboard();

  if (subscription.error) {
    return <ErrorCard error={subscription.error} onRetry={() => void subscription.refetch()} />;
  }
  const sub = subscription.data;
  const active = dashboard.data?.students.active ?? 0;
  const percent = sub ? usagePercent(active, sub.plan.maxStudents) : null;

  return (
    <Card className="gap-4 p-5" data-testid="plan-card">
      <h2 className="text-lg font-bold">Meu plano</h2>
      {subscription.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : sub ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{sub.plan.name}</span>
            {sub.status === "ACTIVE" ? (
              <Badge>{SUBSCRIPTION_LABEL[sub.status]}</Badge>
            ) : (
              <Badge variant="outline">{SUBSCRIPTION_LABEL[sub.status]}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {formatCurrency(sub.plan.priceCents)}/mês
            {sub.currentPeriodEnd
              ? ` - renova em ${fmt(new Date(toDate(sub.currentPeriodEnd).getTime()), "dd/MM/yyyy")}`
              : ""}
          </p>
          <div>
            <div className="flex justify-between text-sm">
              <span>Alunos ativos</span>
              <span data-testid="plan-usage">
                {dashboard.isLoading ? "..." : active} / {sub.plan.maxStudents ?? "ilimitado"}
              </span>
            </div>
            {percent !== null && <Progress value={percent} className="mt-1.5 h-2" />}
            {percent !== null && percent >= 100 && (
              <p className="mt-1.5 text-sm text-destructive" role="alert">
                Limite de alunos do plano atingido. Fale com a equipe GingApp para fazer upgrade.
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhuma assinatura ativa no momento. Fale com a equipe GingApp para contratar um plano.
        </p>
      )}
    </Card>
  );
}

export function ConfiguracoesPage() {
  return (
    <div>
      <PageHeader title="Configurações" description="Dados do grupo, plano e uso." />
      <div className="grid gap-4 lg:grid-cols-2">
        <OrganizationCard />
        <div className="grid content-start gap-4">
          <PlanCard />
          <NotificationsCard />
        </div>
      </div>
    </div>
  );
}
