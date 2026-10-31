import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BringToFront,
  CopyPlus,
  Eye,
  ImageIcon,
  Loader2,
  Monitor,
  Redo2,
  Save,
  SendToBack,
  Square,
  Trash2,
  Type,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSessionUser } from "@/lib/session";
import { NativeSelect } from "@/modules/rodas/native-select";
import { templatesErrorMessage, usePreviewPdf, useTemplate, useUpdateTemplate } from "./api";
import { CertificateCanvas } from "./certificate-canvas";
import { canRedo, canUndo, createHistory, pushHistory, redo, undo, type History } from "./history";
import {
  addDefaultElement,
  canReorder,
  duplicateElement,
  getElement,
  layoutSignature,
  removeElement,
  reorderElement,
  sampleVariables,
  toWireLayout,
  updateElement,
  validateLayout,
  validateName,
  whyCannotAdd,
  type LayoutIssue,
  type OrderAction,
} from "./layout-utils";
import { PdfPreviewDialog } from "./pdf-preview-dialog";
import { PropertiesPanel, type ElementPatch } from "./properties-panel";
import { LIMITS, PURPOSES, type CertificateLayout, type CertificatePurpose, type CertificateTemplate, type ElementType } from "./types";

interface TemplateEditorPageProps {
  templateId: number | string;
  /** Volta para a lista (a rota cuida de avisar sobre alterações não salvas). */
  onBack: () => void;
  /** Avisa a rota quando há alterações não salvas (ela bloqueia a navegação e o fechamento da aba). */
  onDirtyChange?: (dirty: boolean) => void;
}

/** Editor visual do modelo (/certificados/modelos/:id): carrega o modelo e entrega ao editor com o rascunho local. */
export function TemplateEditorPage({ templateId, onBack, onDirtyChange }: TemplateEditorPageProps) {
  const query = useTemplate(templateId);
  const isMobile = useIsMobile();
  const back = (
    <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={onBack}>
      <ArrowLeft /> Modelos
    </Button>
  );

  if (query.isLoading) {
    return (
      <>
        {back}
        <div className="grid gap-3" aria-busy="true" data-testid="editor-loading">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-72 w-full" />
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
            {templatesErrorMessage(query.error, "Modelo não encontrado.")}
          </p>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            Tentar de novo
          </Button>
        </div>
      </>
    );
  }
  if (isMobile) return <MobileNotice template={query.data} back={back} />;
  return (
    <Editor
      key={String(templateId)}
      template={query.data}
      onBack={onBack}
      {...(onDirtyChange ? { onDirtyChange } : {})}
    />
  );
}

/** Celular (< 768px): o desenho exige mouse/tela grande; aqui só se vê o modelo. */
function MobileNotice({ template, back }: { template: CertificateTemplate; back: ReactNode }) {
  const user = useSessionUser();
  const variables = useMemo(() => sampleVariables(user?.organizationName), [user?.organizationName]);
  return (
    <>
      {back}
      <h1 className="mb-3 text-lg font-extrabold tracking-tight">{template.name}</h1>
      <p role="status" className="mb-4 flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm" data-testid="mobile-notice">
        <Monitor className="mt-0.5 size-4 shrink-0" aria-hidden />
        Para editar o desenho do certificado, abra o painel no computador. Aqui você só visualiza o modelo.
      </p>
      <CertificateCanvas layout={toWireLayout(template.layout)} variables={variables} groupLogo={user?.organizationLogoUrl ?? null} />
    </>
  );
}

const signatureOf = (layout: CertificateLayout, name: string, purpose: CertificatePurpose): string =>
  `${name.trim()}\u0000${purpose}\u0000${layoutSignature(layout)}`;

function ToolButton({
  icon: Icon,
  label,
  text,
  ...props
}: {
  icon: LucideIcon;
  label: string;
  /** Rótulo visível (opcional); sem ele só o ícone, com o rótulo no aria-label/tooltip. */
  text?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size={text ? "sm" : "icon"}
      aria-label={label}
      title={label}
      // Tela de toque em tablet (>= md): área de toque de 44px também.
      className="pointer-coarse:h-11 pointer-coarse:min-w-11"
      {...props}
    >
      <Icon />
      {text}
    </Button>
  );
}

function Editor({
  template,
  onBack,
  onDirtyChange,
}: {
  template: CertificateTemplate;
  onBack: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const user = useSessionUser();
  const groupLogo = user?.organizationLogoUrl ?? null;
  const variables = useMemo(() => sampleVariables(user?.organizationName), [user?.organizationName]);

  const [history, setHistory] = useState<History<CertificateLayout>>(() => createHistory(toWireLayout(template.layout)));
  const [live, setLive] = useState<CertificateLayout | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(template.name);
  const [purpose, setPurpose] = useState<CertificatePurpose>(template.purpose);
  const [baseline, setBaseline] = useState(() => signatureOf(toWireLayout(template.layout), template.name, template.purpose));
  const [serverError, setServerError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const update = useUpdateTemplate(template.id);
  const previewPdf = usePreviewPdf();

  const layout = live ?? history.present;
  const dirty = signatureOf(layout, name, purpose) !== baseline;
  const issues = useMemo(() => validateLayout(layout), [layout]);
  const nameIssue = validateName(name);
  const selected = getElement(layout, selectedId);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // O endereço blob: do PDF é liberado ao trocar/fechar e ao sair do editor.
  const previewUrlRef = useRef<string | null>(null);
  previewUrlRef.current = previewUrl;
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  const commit = useCallback((next: CertificateLayout, options?: { key?: string }) => {
    setLive(null);
    setServerError(null);
    setHistory((h) => pushHistory(h, next, options));
  }, []);

  function add(type: ElementType) {
    const result = addDefaultElement(layout, type);
    if (!result) {
      toast.error(whyCannotAdd(layout, type) ?? "Não foi possível adicionar o elemento.");
      return;
    }
    commit(result.layout);
    setSelectedId(result.id);
  }

  function duplicate() {
    if (!selected) return;
    const result = duplicateElement(layout, selected.id);
    if (!result) {
      toast.error(whyCannotAdd(layout, selected.type) ?? "Este elemento não pode ser duplicado.");
      return;
    }
    commit(result.layout);
    setSelectedId(result.id);
  }

  function remove(id: string) {
    const el = getElement(layout, id);
    if (!el) return;
    if (el.type === "qr") {
      toast.error("O QR Code é obrigatório e não pode ser removido. Você pode movê-lo ou redimensioná-lo.");
      return;
    }
    commit(removeElement(layout, id));
    setSelectedId(null);
  }

  function reorder(action: OrderAction) {
    if (selected) commit(reorderElement(layout, selected.id, action));
  }

  function doUndo() {
    setLive(null);
    setHistory(undo);
  }
  function doRedo() {
    setLive(null);
    setHistory(redo);
  }

  const patchElement = (id: string, patch: ElementPatch, key?: string) =>
    commit(updateElement(layout, id, patch), key ? { key } : undefined);

  /** Confere nome + desenho antes de salvar/pré-visualizar; mostra o primeiro motivo. */
  function blockingIssue(): string | null {
    if (nameIssue) return nameIssue;
    return issues[0]?.message ?? null;
  }

  async function save(): Promise<boolean> {
    const problem = blockingIssue();
    if (problem) {
      toast.error(`Corrija antes de salvar: ${problem}`);
      return false;
    }
    try {
      const trimmed = name.trim();
      await update.mutateAsync({ name: trimmed, purpose, layout });
      setName(trimmed);
      setBaseline(signatureOf(layout, trimmed, purpose));
      setServerError(null);
      toast.success("Modelo salvo.");
      return true;
    } catch (error) {
      const message = templatesErrorMessage(error, "Não foi possível salvar o modelo.");
      setServerError(message);
      toast.error(message);
      return false;
    }
  }

  async function preview() {
    const problem = issues[0]?.message ?? null;
    if (problem) {
      toast.error(`Corrija antes de pré-visualizar: ${problem}`);
      return;
    }
    try {
      const blob = await previewPdf.mutateAsync(layout);
      const pdf = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
      const url = URL.createObjectURL(pdf);
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return url;
      });
      setPreviewOpen(true);
    } catch (error) {
      toast.error(templatesErrorMessage(error, "Não foi possível gerar a pré-visualização."));
    }
  }

  function closePreview(open: boolean) {
    setPreviewOpen(open);
    if (!open) {
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
    }
  }

  function onRootKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey)) return;
    const target = event.target as HTMLElement;
    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      void save();
      return;
    }
    // Dentro de um campo de texto/lista, Ctrl+Z é do próprio campo.
    if (target.closest("input, textarea, select, [contenteditable='true']")) return;
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      doUndo();
    } else if (key === "y" || (key === "z" && event.shiftKey)) {
      event.preventDefault();
      doRedo();
    }
  }

  const portrait = layout.page.orientation === "portrait";
  const pending = update.isPending;

  return (
    // Os atalhos de teclado (Ctrl+Z/Y/S) são tratados no contêiner; as ações também existem como botões.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3" data-testid="template-editor" onKeyDown={onRootKeyDown}>
      <div
        className="sticky top-[calc(3rem+env(safe-area-inset-top))] z-[9] -mx-4 border-b bg-background/95 px-4 py-2 backdrop-blur md:top-14 md:-mx-8 md:px-8"
        data-testid="editor-bar"
      >
        <div className="flex flex-wrap items-end gap-2">
          <Button variant="ghost" size="icon" aria-label="Voltar para a lista de modelos" onClick={onBack}>
            <ArrowLeft />
          </Button>
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor="template-name" className="text-xs">
              Nome do modelo
            </Label>
            <Input
              id="template-name"
              value={name}
              maxLength={LIMITS.nameMax}
              aria-invalid={nameIssue ? true : undefined}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="w-44 space-y-1">
            <Label htmlFor="template-purpose" className="text-xs">
              Usado em
            </Label>
            <NativeSelect
              id="template-purpose"
              className="h-11 md:h-9"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value as CertificatePurpose)}
            >
              {PURPOSES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {dirty && (
              <span
                role="status"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400"
                data-testid="unsaved-indicator"
              >
                <span className="size-2 rounded-full bg-amber-500" aria-hidden /> Alterações não salvas
              </span>
            )}
            <Button type="button" variant="outline" onClick={() => void preview()} disabled={previewPdf.isPending}>
              {previewPdf.isPending ? <Loader2 className="animate-spin" /> : <Eye />} Pré-visualizar PDF
            </Button>
            <Button type="button" onClick={() => void save()} disabled={!dirty || pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Save />} Salvar
            </Button>
          </div>
        </div>
        {nameIssue && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {nameIssue}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Ferramentas do desenho">
        <ToolButton icon={Type} text="Texto" label="Adicionar texto" onClick={() => add("text")} />
        <ToolButton icon={ImageIcon} text="Imagem" label="Adicionar imagem" onClick={() => add("image")} />
        <ToolButton icon={Square} text="Retângulo" label="Adicionar retângulo" onClick={() => add("rect")} />
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
        <ToolButton icon={Undo2} label="Desfazer" onClick={doUndo} disabled={!canUndo(history)} />
        <ToolButton icon={Redo2} label="Refazer" onClick={doRedo} disabled={!canRedo(history)} />
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
        <ToolButton
          icon={CopyPlus}
          label="Duplicar elemento"
          onClick={duplicate}
          disabled={!selected || selected.type === "qr"}
        />
        <ToolButton
          icon={BringToFront}
          label="Trazer para a frente"
          onClick={() => reorder("front")}
          disabled={!selected || !canReorder(layout, selected.id, "front")}
        />
        <ToolButton
          icon={ArrowUp}
          label="Subir uma camada"
          onClick={() => reorder("forward")}
          disabled={!selected || !canReorder(layout, selected.id, "forward")}
        />
        <ToolButton
          icon={ArrowDown}
          label="Descer uma camada"
          onClick={() => reorder("backward")}
          disabled={!selected || !canReorder(layout, selected.id, "backward")}
        />
        <ToolButton
          icon={SendToBack}
          label="Enviar para trás"
          onClick={() => reorder("back")}
          disabled={!selected || !canReorder(layout, selected.id, "back")}
        />
        <ToolButton
          icon={Trash2}
          label="Excluir elemento"
          onClick={() => selected && remove(selected.id)}
          disabled={!selected || selected.type === "qr"}
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-2">
          <div className={portrait ? "mx-auto max-w-[34rem]" : "mx-auto max-w-[62rem]"} data-testid="canvas-area">
            <CertificateCanvas
              mode="edit"
              layout={layout}
              variables={variables}
              groupLogo={groupLogo}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onLiveChange={setLive}
              onCommit={commit}
              onDeleteElement={remove}
            />
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Prévia aproximada com dados de exemplo (o QR é só ilustrativo). O PDF gerado pelo servidor é a
            referência final: use “Pré-visualizar PDF” para conferir.
          </p>
        </div>

        <aside className="space-y-4 rounded-lg border bg-card p-4 lg:sticky lg:top-32 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto" aria-label="Propriedades">
          <PropertiesPanel
            layout={layout}
            selected={selected}
            groupLogo={groupLogo}
            onUpdate={patchElement}
            onLayoutChange={(next, key) => commit(next, key ? { key } : undefined)}
          />
          <IssuesList issues={issues} onPick={setSelectedId} />
          {serverError && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive" data-testid="server-error">
              {serverError}
            </p>
          )}
        </aside>
      </div>

      <PdfPreviewDialog open={previewOpen} onOpenChange={closePreview} url={previewUrl} />
    </div>
  );
}

function IssuesList({ issues, onPick }: { issues: LayoutIssue[]; onPick: (id: string) => void }) {
  if (issues.length === 0) return null;
  return (
    <section className="space-y-2 border-t pt-3" aria-label="Pendências do desenho" data-testid="issues">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
        <AlertTriangle className="size-4" aria-hidden /> Pendências ({issues.length})
      </h3>
      <ul className="space-y-1 text-xs">
        {issues.map((issue, index) => (
          <li key={`${issue.elementId ?? "geral"}-${String(index)}`}>
            {issue.elementId ? (
              <button
                type="button"
                className="min-h-11 text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
                onClick={() => onPick(issue.elementId!)}
              >
                {issue.message}
              </button>
            ) : (
              issue.message
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
