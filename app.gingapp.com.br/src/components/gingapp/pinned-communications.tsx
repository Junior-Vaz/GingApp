import { useState } from "react";
import { Check, Pin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import {
  communicationImageSrc,
  linkifyText,
  useAckCommunication,
  usePinnedCommunications,
  type AckRequirement,
  type AckResponse,
  type PinnedCommunication,
} from "@/lib/communications";
import { relativeTime } from "@/lib/format";
import { useImage } from "@/lib/use-image";

/** Texto PURO do comunicado: quebras de linha preservadas e links http(s) sanitizados (nunca HTML bruto). */
export function CommunicationBody({ text, className = "" }: { text: string; className?: string }) {
  const lines = text.split(/\r?\n/);
  return (
    <p className={`whitespace-pre-line break-words text-sm leading-relaxed ${className}`.trim()} data-testid="communication-body">
      {lines.map((line, lineIndex) => (
        <span key={lineIndex}>
          {lineIndex > 0 && "\n"}
          {linkifyText(line).map((part, partIndex) =>
            part.type === "link" ? (
              <a
                key={partIndex}
                href={part.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="font-medium text-primary underline underline-offset-2 break-all"
                onClick={(event) => event.stopPropagation()}
              >
                {part.text}
              </a>
            ) : (
              <span key={partIndex}>{part.text}</span>
            ),
          )}
        </span>
      ))}
    </p>
  );
}

interface AckButtonsProps {
  id: number;
  title: string;
  requiresAck: AckRequirement;
  myAck: AckResponse | null;
  /** Chamado quando o servidor aceitou a resposta (útil quando o `myAck` não vem do cache dos fixados). */
  onAnswered?: (response: AckResponse) => void;
}

/**
 * Botões de resposta: READ -> "Li e entendi"; GOING -> "Vou" / "Não vou" (selecionado marcado, trocável).
 * A resposta aparece na hora (otimista) e volta atrás com aviso se o servidor recusar. Alvos >= 44px.
 */
export function AckButtons({ id, title, requiresAck, myAck, onAnswered }: AckButtonsProps) {
  const ack = useAckCommunication();
  if (requiresAck === "NONE") return null;

  function answer(response: AckResponse) {
    if (myAck === response || ack.isPending) return;
    ack.mutate(
      { id, response },
      {
        onSuccess: () => onAnswered?.(response),
        onError: (error) => toast.error(errorMessage(error, "Não foi possível registrar sua resposta.")),
      },
    );
  }

  if (requiresAck === "READ") {
    const read = myAck === "READ";
    return (
      <div className="mt-3" data-testid={`ack-${id}`}>
        <Button
          type="button"
          variant={read ? "soft" : "default"}
          className="min-h-11 w-full sm:w-auto"
          disabled={read || ack.isPending}
          aria-label={read ? `Você confirmou a leitura de ${title}` : `Li e entendi: ${title}`}
          onClick={(event) => {
            event.stopPropagation();
            answer("READ");
          }}
        >
          <Check aria-hidden="true" />
          {read ? "Lido ✓" : "Li e entendi"}
        </Button>
      </div>
    );
  }

  const options: { response: AckResponse; label: string }[] = [
    { response: "GOING", label: "Vou" },
    { response: "NOT_GOING", label: "Não vou" },
  ];
  return (
    <div className="mt-3 flex gap-2" role="group" aria-label={`Sua resposta: ${title}`} data-testid={`ack-${id}`}>
      {options.map((option) => {
        const selected = myAck === option.response;
        return (
          <Button
            key={option.response}
            type="button"
            variant={selected ? "default" : "outline"}
            className="min-h-11 flex-1 sm:flex-none"
            aria-pressed={selected}
            disabled={ack.isPending}
            onClick={(event) => {
              event.stopPropagation();
              answer(option.response);
            }}
          >
            {selected && <Check aria-hidden="true" />}
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}

function CommunicationImage({ src }: { src: string | null }) {
  const image = useImage(src);
  if (!image.src) return null;
  return <img src={image.src} alt="" loading="lazy" onError={image.onError} className="mt-2 max-h-56 w-full rounded-md object-cover" />;
}

function PinnedCard({ item }: { item: PinnedCommunication }) {
  return (
    <article className="min-w-0 rounded-lg border border-border bg-card p-4" data-testid={`pinned-${item.id}`}>
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Pin className="size-3.5" aria-hidden="true" />
        <span>Fixado</span>
        <time className="ml-auto" dateTime={item.createdAt}>
          {relativeTime(item.createdAt)}
        </time>
      </div>
      <h3 className="break-words text-base font-semibold leading-snug">{item.title}</h3>
      <CommunicationBody text={item.body} className="mt-1 text-muted-foreground" />
      <CommunicationImage src={communicationImageSrc(item.imageUrl)} />
      <AckButtons id={item.id} title={item.title} requiresAck={item.requiresAck} myAck={item.myAck} />
    </article>
  );
}

/**
 * Comunicados fixados vigentes (GET /communications/pinned). Sem nada, carregando ou com erro: não renderiza
 * (sem mensagem de erro). Pensada para o topo da Home e do feed.
 */
export function PinnedCommunications({ className = "" }: { className?: string }) {
  const pinned = usePinnedCommunications();
  const items = pinned.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section className={`min-w-0 max-w-full space-y-3 ${className}`.trim()} aria-label="Comunicados fixados" data-testid="pinned-communications">
      {items.map((item) => (
        <PinnedCard key={item.id} item={item} />
      ))}
    </section>
  );
}

/**
 * Resposta ao comunicado DENTRO da notificação (`data.communicationId`). Usa o comunicado fixado quando ele está
 * na lista (requiresAck e myAck reais); se não estiver fixado, oferece "Li e entendi" (ou o que `data.requiresAck`
 * indicar). Comunicado sem confirmação (NONE) não mostra nada.
 */
export function NotificationAckActions({
  communicationId,
  title,
  requiresAck,
  onAnswered,
}: {
  communicationId: number;
  title: string;
  /** `data.requiresAck` da notificação, se o backend mandar; sem ele, assume "Li e entendi". */
  requiresAck?: AckRequirement | undefined;
  onAnswered?: () => void;
}) {
  const pinned = usePinnedCommunications();
  const [localAck, setLocalAck] = useState<AckResponse | null>(null);
  const found = pinned.data?.items.find((c) => c.id === communicationId);
  const required: AckRequirement = found?.requiresAck ?? requiresAck ?? "READ";
  return (
    <AckButtons
      id={communicationId}
      title={title}
      requiresAck={required}
      myAck={found ? found.myAck : localAck}
      onAnswered={(response) => {
        setLocalAck(response);
        onAnswered?.();
      }}
    />
  );
}
