import { useRef } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/modules/rodas/native-select";
import { insertAtCursor, isDarkEnoughForQr, setBackground, setOrientation, elementBox } from "./layout-utils";
import { ChoiceGroup, ColorField, ImagePicker, NumberField, Section } from "./panel-controls";
import {
  ELEMENT_TYPE_LABEL,
  FONTS,
  LIMITS,
  ORIENTATION_LABEL,
  VARIABLES,
  fontDef,
  type Align,
  type CertificateElement,
  type CertificateLayout,
  type ImageEl,
  type Orientation,
  type QrEl,
  type RectEl,
  type TextEl,
  type VAlign,
} from "./types";

export type ElementPatch = Partial<TextEl> | Partial<ImageEl> | Partial<RectEl> | Partial<QrEl>;

interface PropertiesPanelProps {
  layout: CertificateLayout;
  selected: CertificateElement | undefined;
  /** Logo do grupo (só para avisar quando não existe). */
  groupLogo: string | null;
  /** `key` junta edições seguidas do mesmo campo num único passo do "desfazer". */
  onUpdate: (id: string, patch: ElementPatch, key?: string) => void;
  onLayoutChange: (next: CertificateLayout, key?: string) => void;
}

const ALIGN_OPTIONS: readonly { value: Align; label: string }[] = [
  { value: "left", label: "Esquerda" },
  { value: "center", label: "Centro" },
  { value: "right", label: "Direita" },
];
const VALIGN_OPTIONS: readonly { value: VAlign; label: string }[] = [
  { value: "top", label: "Topo" },
  { value: "middle", label: "Meio" },
  { value: "bottom", label: "Base" },
];
const ORIENTATION_OPTIONS = (Object.keys(ORIENTATION_LABEL) as Orientation[]).map((value) => ({
  value,
  label: ORIENTATION_LABEL[value],
}));

/** Painel lateral: propriedades do elemento selecionado (por tipo) ou da página, se nada estiver selecionado. */
export function PropertiesPanel({ layout, selected, groupLogo, onUpdate, onLayoutChange }: PropertiesPanelProps) {
  if (!selected) return <PagePanel layout={layout} onLayoutChange={onLayoutChange} />;
  return (
    <div className="space-y-4" data-testid="properties-panel">
      <h2 className="text-base font-semibold">
        {ELEMENT_TYPE_LABEL[selected.type]} {String(layout.elements.findIndex((e) => e.id === selected.id) + 1)}
      </h2>
      {selected.type === "text" && <TextProps el={selected} onUpdate={onUpdate} />}
      {selected.type === "image" && <ImageProps el={selected} groupLogo={groupLogo} onUpdate={onUpdate} />}
      {selected.type === "rect" && <RectProps el={selected} onUpdate={onUpdate} />}
      {selected.type === "qr" && <QrProps el={selected} onUpdate={onUpdate} />}
      <GeometryProps el={selected} orientation={layout.page.orientation} onUpdate={onUpdate} />
    </div>
  );
}

// ------------------------------------------------------------------ página

function PagePanel({
  layout,
  onLayoutChange,
}: {
  layout: CertificateLayout;
  onLayoutChange: (next: CertificateLayout, key?: string) => void;
}) {
  const { orientation, background } = layout.page;
  return (
    <div className="space-y-4" data-testid="page-panel">
      <h2 className="text-base font-semibold">Página</h2>
      <p className="text-xs text-muted-foreground">Clique num elemento da folha para editar as propriedades dele.</p>
      <Section title="Folha">
        <ChoiceGroup
          label="Orientação"
          value={orientation}
          options={ORIENTATION_OPTIONS}
          onChange={(value) => onLayoutChange(setOrientation(layout, value))}
        />
        <p className="text-xs text-muted-foreground">
          Ao trocar a orientação as posições (em %) se mantêm; confira o desenho depois.
        </p>
      </Section>
      <Section title="Fundo">
        <ColorField
          label="Cor de fundo"
          value={background.color}
          onChange={(color) => color && onLayoutChange(setBackground(layout, { color }), "bg-color")}
        />
        <ImagePicker
          label="Imagem de fundo"
          value={background.imageRef}
          onChange={(imageRef) => onLayoutChange(setBackground(layout, { imageRef }))}
        />
        {background.imageRef && (
          <ChoiceGroup
            label="Ajuste da imagem de fundo"
            value={background.imageFit ?? "cover"}
            options={[
              { value: "cover", label: "Cobrir" },
              { value: "contain", label: "Conter" },
            ]}
            onChange={(imageFit) => onLayoutChange(setBackground(layout, { imageFit }))}
          />
        )}
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ texto

function TextProps({ el, onUpdate }: { el: TextEl; onUpdate: PropertiesPanelProps["onUpdate"] }) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const font = fontDef(el.fontKey);
  const set = (patch: Partial<TextEl>, field: string) => onUpdate(el.id, patch, `${el.id}:${field}`);

  function insertVariable(token: string) {
    const area = areaRef.current;
    const start = area?.selectionStart ?? el.text.length;
    const end = area?.selectionEnd ?? el.text.length;
    const result = insertAtCursor(el.text, token, start, end);
    if (result.text.length > LIMITS.maxText) return;
    onUpdate(el.id, { text: result.text }, `${el.id}:text`);
    window.setTimeout(() => {
      area?.focus();
      area?.setSelectionRange(result.cursor, result.cursor);
    }, 0);
  }

  return (
    <>
      <Section title="Conteúdo">
        <div className="space-y-1">
          <Label htmlFor={`text-${el.id}`} className="text-xs">
            Texto
          </Label>
          <Textarea
            id={`text-${el.id}`}
            ref={areaRef}
            rows={4}
            maxLength={LIMITS.maxText}
            aria-label="Conteúdo do texto"
            value={el.text}
            onChange={(event) => set({ text: event.target.value }, "text")}
          />
          <p className="text-right text-xs text-muted-foreground">
            {el.text.length}/{LIMITS.maxText}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium leading-none">Inserir variável</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Variáveis">
            {VARIABLES.map((variable) => (
              <Button
                key={variable.key}
                type="button"
                size="sm"
                variant="soft"
                className="font-mono pointer-coarse:h-11"
                title={variable.label}
                aria-label={`Inserir ${variable.token} (${variable.label})`}
                onClick={() => insertVariable(variable.token)}
              >
                {variable.token}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Pelo menos um texto precisa ter {"{codigo}"} ou {"{link}"}.
          </p>
        </div>
      </Section>

      <Section title="Letra">
        <div className="space-y-1">
          <Label htmlFor={`font-${el.id}`} className="text-xs">
            Fonte
          </Label>
          <NativeSelect
            id={`font-${el.id}`}
            className="h-11 md:h-9"
            value={el.fontKey}
            onChange={(event) => set({ fontKey: event.target.value as TextEl["fontKey"] }, "fontKey")}
          >
            {FONTS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Tamanho"
            unit="pt"
            min={LIMITS.fontSize.min}
            max={LIMITS.fontSize.max}
            value={el.size}
            onChange={(size) => set({ size }, "size")}
          />
          <NumberField
            label="Entrelinha"
            min={LIMITS.lineHeight.min}
            max={LIMITS.lineHeight.max}
            step={0.1}
            value={el.lineHeight}
            onChange={(lineHeight) => set({ lineHeight }, "lineHeight")}
          />
          <NumberField
            label="Espaço entre letras"
            unit="pt"
            min={LIMITS.letterSpacing.min}
            max={LIMITS.letterSpacing.max}
            step={0.5}
            value={el.letterSpacing}
            onChange={(letterSpacing) => set({ letterSpacing }, "letterSpacing")}
          />
        </div>
        <ColorField label="Cor do texto" value={el.color} onChange={(color) => color && set({ color }, "color")} />
        <div className="space-y-1">
          <p className="text-xs font-medium leading-none">Estilo</p>
          <div role="group" aria-label="Estilo da letra" className="flex flex-wrap gap-1">
            <Button
              type="button"
              size="sm"
              variant={el.bold ? "default" : "outline"}
              aria-pressed={el.bold}
              disabled={!font.bold}
              title={font.bold ? undefined : "Esta fonte não tem negrito"}
              className="font-bold"
              onClick={() => set({ bold: !el.bold }, "bold")}
            >
              Negrito
            </Button>
            <Button
              type="button"
              size="sm"
              variant={el.italic ? "default" : "outline"}
              aria-pressed={el.italic}
              disabled={!font.italic}
              title={font.italic ? undefined : "Esta fonte não tem itálico"}
              className="italic"
              onClick={() => set({ italic: !el.italic }, "italic")}
            >
              Itálico
            </Button>
            <Button
              type="button"
              size="sm"
              variant={el.uppercase ? "default" : "outline"}
              aria-pressed={el.uppercase}
              onClick={() => set({ uppercase: !el.uppercase }, "uppercase")}
            >
              CAIXA ALTA
            </Button>
          </div>
          {(!font.bold || !font.italic) && (
            <p className="text-xs text-muted-foreground">
              {!font.bold && !font.italic
                ? "Esta fonte não tem negrito nem itálico."
                : !font.bold
                  ? "Esta fonte não tem negrito."
                  : "Esta fonte não tem itálico."}
            </p>
          )}
        </div>
        <ChoiceGroup label="Alinhamento horizontal" value={el.align} options={ALIGN_OPTIONS} onChange={(align) => set({ align }, "align")} />
        <ChoiceGroup label="Alinhamento vertical" value={el.vAlign} options={VALIGN_OPTIONS} onChange={(vAlign) => set({ vAlign }, "vAlign")} />
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ imagem

function ImageProps({
  el,
  groupLogo,
  onUpdate,
}: {
  el: ImageEl;
  groupLogo: string | null;
  onUpdate: PropertiesPanelProps["onUpdate"];
}) {
  const set = (patch: Partial<ImageEl>, field: string) => onUpdate(el.id, patch, `${el.id}:${field}`);
  return (
    <Section title="Imagem">
      <div className="flex min-h-11 items-center justify-between gap-3 md:min-h-0">
        <Label htmlFor={`logo-${el.id}`} className="text-sm">
          Usar o logo do grupo
        </Label>
        <Switch id={`logo-${el.id}`} checked={el.useGroupLogo} onCheckedChange={(useGroupLogo) => set({ useGroupLogo }, "logo")} />
      </div>
      {el.useGroupLogo ? (
        <p className="text-xs text-muted-foreground">
          {groupLogo
            ? "O PDF usa o logo atual do grupo no momento de emitir."
            : "O grupo ainda não tem logo (Configurações). Sem logo, a imagem some do certificado."}
        </p>
      ) : (
        <ImagePicker label="Imagem" value={el.ref} onChange={(ref) => set({ ref }, "ref")} />
      )}
      <ChoiceGroup
        label="Ajuste da imagem"
        value={el.fit}
        options={[
          { value: "contain", label: "Conter" },
          { value: "cover", label: "Cobrir" },
        ]}
        onChange={(fit) => set({ fit }, "fit")}
      />
      <NumberField
        label="Opacidade"
        unit="%"
        min={0}
        max={100}
        value={el.opacity * 100}
        onChange={(value) => set({ opacity: value / 100 }, "opacity")}
      />
    </Section>
  );
}

// ------------------------------------------------------------------ retângulo

function RectProps({ el, onUpdate }: { el: RectEl; onUpdate: PropertiesPanelProps["onUpdate"] }) {
  const set = (patch: Partial<RectEl>, field: string) => onUpdate(el.id, patch, `${el.id}:${field}`);
  return (
    <Section title="Retângulo">
      <ColorField label="Preenchimento" value={el.fill} nullable nullLabel="Sem preenchimento" onChange={(fill) => set({ fill }, "fill")} />
      <NumberField
        label="Opacidade do preenchimento"
        unit="%"
        min={0}
        max={100}
        value={el.fillOpacity * 100}
        onChange={(value) => set({ fillOpacity: value / 100 }, "fillOpacity")}
      />
      <ColorField label="Cor da borda" value={el.stroke} nullable nullLabel="Sem borda" onChange={(stroke) => set({ stroke }, "stroke")} />
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Espessura da borda"
          unit="pt"
          min={LIMITS.strokeWidth.min}
          max={LIMITS.strokeWidth.max}
          step={0.5}
          value={el.strokeWidth}
          onChange={(strokeWidth) => set({ strokeWidth }, "strokeWidth")}
        />
        <NumberField
          label="Raio dos cantos"
          unit="pt"
          min={LIMITS.radius.min}
          max={LIMITS.radius.max}
          value={el.radius}
          onChange={(radius) => set({ radius }, "radius")}
        />
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ QR

function QrProps({ el, onUpdate }: { el: QrEl; onUpdate: PropertiesPanelProps["onUpdate"] }) {
  const set = (patch: Partial<QrEl>, field: string) => onUpdate(el.id, patch, `${el.id}:${field}`);
  return (
    <Section title="QR Code de verificação">
      <p className="flex items-start gap-2 rounded-md border bg-muted/50 p-2 text-xs" data-testid="qr-locked">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Obrigatório: leva ao verificador do certificado. Você pode mover, redimensionar e mudar a cor, mas não removê-lo.
        Na prévia ele é só um exemplo; o PDF usa o código real.
      </p>
      <NumberField
        label="Tamanho"
        unit="pt"
        min={LIMITS.qrSize.min}
        max={LIMITS.qrSize.max}
        value={el.size}
        onChange={(size) => set({ size }, "size")}
      />
      <ColorField
        label="Cor escura do QR"
        value={el.fg}
        validate={(hex) => (isDarkEnoughForQr(hex) ? null : "Cor clara demais: o QR precisa ser escuro para ser lido.")}
        onChange={(fg) => fg && set({ fg }, "fg")}
      />
    </Section>
  );
}

// ------------------------------------------------------------------ posição e tamanho

function GeometryProps({
  el,
  orientation,
  onUpdate,
}: {
  el: CertificateElement;
  orientation: Orientation;
  onUpdate: PropertiesPanelProps["onUpdate"];
}) {
  const box = elementBox(el, orientation);
  const set = (patch: ElementPatch, field: string) => onUpdate(el.id, patch, `${el.id}:${field}`);
  return (
    <Section title="Posição e tamanho">
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Posição X" unit="%" min={0} max={100} step={0.5} value={box.x} onChange={(x) => set({ x }, "x")} />
        <NumberField label="Posição Y" unit="%" min={0} max={100} step={0.5} value={box.y} onChange={(y) => set({ y }, "y")} />
        {el.type !== "qr" && (
          <>
            <NumberField label="Largura" unit="%" min={LIMITS.minBox} max={100} step={0.5} value={el.w} onChange={(w) => set({ w }, "w")} />
            <NumberField label="Altura" unit="%" min={LIMITS.minBox} max={100} step={0.5} value={el.h} onChange={(h) => set({ h }, "h")} />
          </>
        )}
      </div>
    </Section>
  );
}
