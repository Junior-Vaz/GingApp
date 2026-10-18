import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Eye,
  Link2,
  Loader2,
  Lock,
  QrCode,
  Save,
  Send,
  Square,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { imageSrc, isImageRef } from "@/lib/uploads";
import {
  formsErrorMessage,
  isValidationError,
  notifyFormsError,
  useFormAction,
  useFormDefinition,
  useSaveForm,
} from "./api";
import {
  draftSignature,
  fieldKeyForPath,
  fromDefinition,
  parseValidationIssues,
  toPayload,
  validateDraft,
  type Draft,
  type Issue,
  type ServerIssue,
} from "./builder";
import { FieldsTab } from "./fields-tab";
import { PreviewDialog } from "./preview-dialog";
import { QrDialog } from "./qr-dialog";
import { SettingsTab } from "./settings-tab";
import { copyText, publicLink } from "./share";
import { SubmissionsTab } from "./submissions-tab";
import {
  FORM_STATUS_LABEL,
  FORM_STATUS_VARIANT,
  isLinkProvisional,
  type FormDefinition,
  type Id,
} from "./types";

type TabName = "campos" | "configuracoes" | "inscricoes";

const NO_LINK_HINT = "Publique o formulário para gerar o link";

interface FormEditorPageProps {
  formId: Id;
  /** Volta para a lista (a rota cuida de avisar sobre alterações não salvas). */
  onBack: () => void;
  /** Avisa a rota quando há alterações não salvas (ela bloqueia a navegação e o fechamento da aba). */
  onDirtyChange?: (dirty: boolean) => void;
}

/** Editor do formulário (/formularios/:formId): carrega a definição e entrega ao editor com o rascunho local. */
export function FormEditorPage({ formId, onBack, onDirtyChange }: FormEditorPageProps) {
  const query = useFormDefinition(formId);
  const back = (
    <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={onBack}>
      <ArrowLeft /> Formulários
    </Button>
  );

  if (query.isLoading) {
    return (
      <>
        {back}
        <div className="grid gap-3" aria-busy="true" data-testid="editor-loading">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }
  if (query.error || !query.data) {
    return (
      <>
        {back}
        <div className="space-y-2 py-8 text-center" data-testid="editor-error">
          <p role="alert" className="text-sm text-destructive">
            {formsErrorMessage(query.error, "Formulário não encontrado.")}
          </p>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            Tentar de novo
          </Button>
        </div>
      </>
    );
  }
  return (
    <Editor
      key={String(formId)}
      formId={formId}
      definition={query.data}
      onBack={onBack}
      {...(onDirtyChange ? { onDirtyChange } : {})}
    />
  );
}

function BarButton({
  icon: Icon,
  label,
  compact,
  hint,
  ...props
}: {
  icon: LucideIcon;
  label: string;
  compact: boolean;
  /** Texto do tooltip quando diferente do rótulo (ex.: por que o botão está desabilitado). */
  hint?: string | undefined;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size={compact ? "icon" : "default"}
      aria-label={label}
      title={hint ?? label}
      {...props}
    >
      <Icon />
      {!compact && label}
    </Button>
  );
}

function Editor({
  formId,
  definition,
  onBack,
  onDirtyChange,
}: {
  formId: Id;
  definition: FormDefinition;
  onBack: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const [draft, setDraft] = useState<Draft>(() => fromDefinition(definition));
  const [baseline, setBaseline] = useState(() => draftSignature(fromDefinition(definition)));
  const [tab, setTab] = useState<TabName>("campos");
  const [showIssues, setShowIssues] = useState(false);
  const [serverIssues, setServerIssues] = useState<ServerIssue[]>([]);
  const [confirm, setConfirm] = useState<"publish" | "close" | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const saveMutation = useSaveForm(formId);
  const action = useFormAction();
  const live = useFormDefinition(formId);

  const status = definition.status;
  const readOnly = status === "ARCHIVED";
  const dirty = draftSignature(draft) !== baseline;
  const link = publicLink(definition);
  // `publicUrl` é null até a 1ª publicação (o `slug` é PROVISÓRIO), então o link ainda não pode ser divulgado.
  const provisional = isLinkProvisional(definition);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const clientIssues = useMemo(() => validateDraft(draft), [draft]);

  // Mensagens por campo + gerais por aba (cliente e servidor juntos).
  const { errorsByField, generalFields, generalSettings } = useMemo(() => {
    const byField: Record<string, string[]> = {};
    const fieldsGeneral: string[] = [];
    const settingsGeneral: string[] = [];
    const push = (key: string | undefined, tabName: "fields" | "settings", message: string) => {
      if (key) (byField[key] ??= []).push(message);
      else (tabName === "fields" ? fieldsGeneral : settingsGeneral).push(message);
    };
    const shownIssues: Issue[] = showIssues ? clientIssues : [];
    for (const issue of shownIssues) push(issue.fieldKey, issue.tab, issue.message);
    for (const issue of serverIssues) {
      const key = fieldKeyForPath(draft, issue.path);
      push(key, /^(fields|sections)/.test(issue.path) ? "fields" : "settings", issue.message);
    }
    return {
      errorsByField: byField,
      generalFields: fieldsGeneral,
      generalSettings: settingsGeneral,
    };
  }, [showIssues, clientIssues, serverIssues, draft]);

  const fieldsErrorCount = Object.keys(errorsByField).length + generalFields.length;
  const settingsErrorCount = generalSettings.length;

  function change(next: Draft) {
    setDraft(next);
    if (serverIssues.length > 0) setServerIssues([]);
  }

  /** Salva (PUT atômico). Devolve `true` quando salvou — "Publicar" depende disso. */
  async function save(): Promise<boolean> {
    setShowIssues(true);
    setServerIssues([]);
    const issues = validateDraft(draft);
    if (issues.length > 0) {
      setTab(issues.some((i) => i.tab === "fields") ? "campos" : "configuracoes");
      toast.error(
        `Corrija ${issues.length === 1 ? "1 ponto" : `${String(issues.length)} pontos`} antes de salvar.`,
      );
      return false;
    }
    try {
      const saved = await saveMutation.mutateAsync(toPayload(draft));
      const fresh =
        saved && Array.isArray(saved.sections) && Array.isArray(saved.fields)
          ? saved
          : (await live.refetch()).data;
      if (fresh) {
        const next = fromDefinition(fresh);
        setDraft(next);
        setBaseline(draftSignature(next));
      } else {
        setBaseline(draftSignature(draft));
      }
      setShowIssues(false);
      toast.success("Formulário salvo.");
      return true;
    } catch (error) {
      if (isValidationError(error)) {
        showServerIssues(error);
        toast.error(formsErrorMessage(error));
      } else {
        notifyFormsError(error, "Não foi possível salvar o formulário.");
      }
      return false;
    }
  }

  /** 400 VALIDATION (`fields` = `{ <chave do campo | configuração>: mensagem }`): marca cada ponto e abre a aba certa. */
  function showServerIssues(error: { body: Record<string, unknown> | undefined }) {
    const found = parseValidationIssues(error.body);
    setServerIssues(found);
    setTab(
      found.some((i) => /^(fields|sections)/.test(i.path) || fieldKeyForPath(draft, i.path))
        ? "campos"
        : "configuracoes",
    );
  }

  async function publish() {
    if (dirty && !(await save())) throw new Error("save-failed");
    try {
      await action.mutateAsync({ id: formId, action: "open" });
    } catch (error) {
      // O servidor confere os requisitos de publicação (preço, chave Pix, ao menos um campo…): mostra onde corrigir.
      if (isValidationError(error)) showServerIssues(error);
      throw error;
    }
  }

  const statusBadge = (
    <Badge variant={FORM_STATUS_VARIANT[status]}>{FORM_STATUS_LABEL[status]}</Badge>
  );
  const bannerSrc =
    draft.bannerUrl.trim() && isImageRef(draft.bannerUrl.trim())
      ? imageSrc(draft.bannerUrl.trim())
      : "";
  const publishLabel = status === "CLOSED" ? "Reabrir" : "Publicar";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div
        className="sticky top-[calc(3rem+env(safe-area-inset-top))] z-[9] -mx-4 border-b bg-background/95 px-4 py-2 backdrop-blur md:top-14 md:-mx-8 md:px-8"
        data-testid="editor-bar"
      >
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Voltar para a lista de formulários"
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-extrabold tracking-tight md:text-xl">
              {draft.title.trim() || "Sem título"}
            </h1>
            {definition.eventTitle && (
              <p className="truncate text-xs text-muted-foreground">
                Evento: {definition.eventTitle}
              </p>
            )}
          </div>
          {statusBadge}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {dirty && (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400"
              data-testid="unsaved-indicator"
            >
              <span className="size-2 rounded-full bg-amber-500" aria-hidden /> Alterações não
              salvas
            </span>
          )}
          {showIssues && clientIssues.length > 0 && (
            <span role="status" className="text-xs font-medium text-destructive">
              {clientIssues.length} {clientIssues.length === 1 ? "pendência" : "pendências"}
            </span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {!readOnly && (
              <>
                <Button
                  type="button"
                  onClick={() => void save()}
                  disabled={!dirty || saveMutation.isPending}
                >
                  {saveMutation.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar
                </Button>
                {status === "OPEN" ? (
                  <BarButton
                    icon={Square}
                    label="Fechar inscrições"
                    compact={isMobile}
                    disabled={action.isPending}
                    onClick={() => setConfirm("close")}
                  />
                ) : (
                  <BarButton
                    icon={Send}
                    label={publishLabel}
                    compact={isMobile}
                    disabled={action.isPending || saveMutation.isPending}
                    onClick={() => setConfirm("publish")}
                  />
                )}
              </>
            )}
            {!readOnly && (
              <>
                <BarButton
                  icon={Link2}
                  label="Copiar link"
                  compact={isMobile}
                  disabled={link === null}
                  hint={link === null ? NO_LINK_HINT : undefined}
                  onClick={() => {
                    if (link)
                      void copyText(
                        link,
                        status === "OPEN"
                          ? "Link copiado."
                          : "Link copiado. Ele só aceita inscrições enquanto o formulário estiver aberto.",
                      );
                  }}
                />
                <BarButton
                  icon={QrCode}
                  label="QR Code"
                  compact={isMobile}
                  disabled={link === null}
                  hint={link === null ? NO_LINK_HINT : undefined}
                  onClick={() => setQrOpen(true)}
                />
              </>
            )}
            <BarButton
              icon={Eye}
              label="Ver como o inscrito vê"
              compact={isMobile}
              onClick={() => setPreviewOpen(true)}
            />
          </div>
        </div>
      </div>

      {readOnly && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md border bg-muted/50 p-3 text-sm"
          data-testid="readonly-notice"
        >
          <Lock className="size-4 shrink-0" aria-hidden /> Este formulário está arquivado: fica
          somente leitura e não recebe mais inscrições. As inscrições antigas continuam disponíveis.
        </p>
      )}

      {bannerSrc && (
        <img
          src={bannerSrc}
          alt="Banner do formulário"
          className="max-h-44 w-full rounded-xl border object-cover"
          data-testid="editor-banner"
        />
      )}

      {!readOnly &&
        (link === null ? (
          <p className="text-xs text-muted-foreground" data-testid="link-provisional">
            O link público e o QR Code são criados quando você publica o formulário.
          </p>
        ) : (
          <p className="break-all text-xs text-muted-foreground">
            Link público: <span className="font-mono">{link}</span>
          </p>
        ))}

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabName)}>
        <TabsList className="w-full sm:w-auto" aria-label="Seções do editor">
          <TabsTrigger value="campos" className="flex-1 gap-1.5 sm:flex-none">
            Campos{" "}
            {fieldsErrorCount > 0 && (
              <Badge variant="destructive" aria-label={`${String(fieldsErrorCount)} pendência(s)`}>
                {fieldsErrorCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="configuracoes" className="flex-1 gap-1.5 sm:flex-none">
            Configurações{" "}
            {settingsErrorCount > 0 && (
              <Badge
                variant="destructive"
                aria-label={`${String(settingsErrorCount)} pendência(s)`}
              >
                {settingsErrorCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="inscricoes" className="flex-1 sm:flex-none">
            Inscrições
          </TabsTrigger>
        </TabsList>

        <TabsContent value="campos" className="mt-4">
          <FieldsTab
            draft={draft}
            readOnly={readOnly}
            onChange={change}
            errorsByField={errorsByField}
            generalErrors={generalFields}
          />
        </TabsContent>
        <TabsContent value="configuracoes" className="mt-4">
          <SettingsTab
            draft={draft}
            readOnly={readOnly}
            onChange={(patch) => change({ ...draft, ...patch })}
            errors={generalSettings}
            eventTitle={definition.eventTitle}
          />
        </TabsContent>
        <TabsContent value="inscricoes" className="mt-4">
          <SubmissionsTab
            formId={formId}
            link={link}
            readOnly={readOnly}
            published={status === "OPEN"}
          />
        </TabsContent>
      </Tabs>

      <QrDialog
        open={qrOpen && link !== null}
        onOpenChange={setQrOpen}
        title={draft.title.trim() || definition.title}
        slug={definition.slug}
        url={link ?? ""}
      />
      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} draft={draft} />

      <ConfirmDialog
        open={confirm === "publish"}
        onOpenChange={(open) => !open && setConfirm(null)}
        variant="default"
        title={status === "CLOSED" ? "Reabrir inscrições?" : "Publicar o formulário?"}
        description={`${provisional ? "O link definitivo é criado agora e passa" : "O link passa"} a aceitar inscrições${dirty ? " (as alterações não salvas são salvas antes)" : ""}.${link ? ` ${link}` : ""}`}
        confirmLabel={publishLabel}
        onConfirm={publish}
      />
      <ConfirmDialog
        open={confirm === "close"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Fechar as inscrições?"
        description="O link deixa de aceitar novas inscrições. As já recebidas continuam aqui e você pode reabrir quando quiser."
        confirmLabel="Fechar inscrições"
        onConfirm={() => action.mutateAsync({ id: formId, action: "close" })}
      />
    </div>
  );
}
