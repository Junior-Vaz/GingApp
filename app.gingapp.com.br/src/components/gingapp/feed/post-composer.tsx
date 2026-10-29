import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Clock, ImagePlus, Loader2, Plus, RotateCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import {
  FEED_BODY_MAX,
  FEED_MAX_PHOTOS,
  feedErrorMessage,
  feedKeys,
  feedMediaSrc,
  useCreatePost,
  useUploadFeedMedia,
  validateFeedPhoto,
  type CreatePostInput,
  type FeedMediaUpload,
  type FeedSettings,
} from "@/lib/feed";
import { useVisibilityOptions } from "@/lib/feed-visibility";
import { useMyIdentity } from "@/lib/queries";
import { UPLOAD_ACCEPT } from "@/lib/uploads";
import { Avatar } from "../avatar";
import { FeedSheet } from "./feed-sheet";

interface Attachment {
  key: string;
  file: File;
  /** Miniatura local (object URL); sem ela usa a miniatura devolvida pelo servidor. */
  preview: string | null;
  status: "uploading" | "done" | "error";
  media?: FeedMediaUpload;
  error?: string;
}

const makePreview = (file: File): string | null =>
  typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
const revoke = (preview: string | null) => {
  if (preview && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(preview);
};

let attachmentSeq = 0;

/** Explicação discreta quando o usuário não pode publicar. */
export function CannotPostNote({ settings }: { settings: FeedSettings }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground" data-testid="cannot-post">
      {settings.postingMode === "STAFF_ONLY"
        ? "Neste grupo, só a equipe publica no feed. Você pode reagir e comentar."
        : "Você não pode publicar neste momento. Você ainda pode reagir e comentar."}
    </p>
  );
}

/**
 * Barra "No que você está pensando?" + folha de criação: texto (2000), até 6 fotos enviadas assim que escolhidas,
 * visibilidade e Publicar. O rascunho vive só em memória (nunca em localStorage) e sobrevive a erros de rede.
 */
export function PostComposer({ settings, variant = "bar" }: { settings: FeedSettings; variant?: "bar" | "fab" }) {
  const queryClient = useQueryClient();
  const me = useMyIdentity();
  const options = useVisibilityOptions();
  const create = useCreatePost();
  const upload = useUploadFeedMedia();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [visibilityValue, setVisibilityValue] = useState("GROUP");
  const [notices, setNotices] = useState<string[]>([]);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [pendingNotice, setPendingNotice] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef<Attachment[]>([]);
  attachmentsRef.current = attachments;

  useEffect(() => () => attachmentsRef.current.forEach((item) => revoke(item.preview)), []);

  const selected = options.find((item) => item.value === visibilityValue) ?? options[0]!;
  const uploading = attachments.some((item) => item.status === "uploading");
  const failed = attachments.some((item) => item.status === "error");
  const ready = attachments.filter((item) => item.status === "done" && item.media);
  const trimmed = body.trim();
  const canPublish = (trimmed.length > 0 || ready.length > 0) && !uploading && !failed && !create.isPending && body.length <= FEED_BODY_MAX;

  function patchAttachment(key: string, update: Partial<Attachment>) {
    setAttachments((list) => list.map((item) => (item.key === key ? { ...item, ...update } : item)));
  }

  function startUpload(item: Attachment) {
    // mutateAsync: vários envios em paralelo (os callbacks de `mutate` só valem para a ÚLTIMA chamada).
    upload.mutateAsync(item.file).then(
      (media) => patchAttachment(item.key, { status: "done", media }),
      (error: unknown) =>
        patchAttachment(item.key, { status: "error", error: feedErrorMessage(error, "Não foi possível enviar esta foto.") }),
    );
  }

  function pickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const problems: string[] = [];
    const room = FEED_MAX_PHOTOS - attachments.length;
    const accepted: Attachment[] = [];
    for (const file of Array.from(files)) {
      const invalid = validateFeedPhoto(file);
      if (invalid) {
        problems.push(`${file.name}: ${invalid}`);
        continue;
      }
      if (accepted.length >= room) {
        if (!problems.includes(`Máximo de ${FEED_MAX_PHOTOS} fotos por publicação.`)) problems.push(`Máximo de ${FEED_MAX_PHOTOS} fotos por publicação.`);
        continue;
      }
      attachmentSeq += 1;
      accepted.push({ key: `photo-${attachmentSeq}`, file, preview: makePreview(file), status: "uploading" });
    }
    setNotices(problems);
    if (accepted.length === 0) return;
    setAttachments((list) => [...list, ...accepted]);
    accepted.forEach(startUpload);
  }

  function removeAttachment(key: string) {
    setAttachments((list) => {
      const target = list.find((item) => item.key === key);
      if (target) revoke(target.preview);
      return list.filter((item) => item.key !== key);
    });
  }

  function retry(item: Attachment) {
    patchAttachment(item.key, { status: "uploading" });
    startUpload(item);
  }

  function reset() {
    attachments.forEach((item) => revoke(item.preview));
    setBody("");
    setAttachments([]);
    setNotices([]);
    setPublishError(null);
  }

  function publish() {
    if (!canPublish) return;
    const input: CreatePostInput = {
      visibility: selected.visibility,
      ...(trimmed ? { body: trimmed } : {}),
      ...(ready.length > 0 ? { mediaIds: ready.map((item) => item.media!.mediaId) } : {}),
      ...(selected.unitId !== undefined ? { unitId: selected.unitId } : {}),
      ...(selected.classId !== undefined ? { classId: selected.classId } : {}),
    };
    setPublishError(null);
    create.mutate(input, {
      onSuccess: (post) => {
        const needsApproval = post.status === "PENDING_APPROVAL";
        reset();
        setOpen(false);
        setPendingNotice(needsApproval);
        if (needsApproval) toast.success("Enviado para aprovação. Um professor vai revisar antes de publicar.");
        else toast.success("Publicado no grupo!");
      },
      onError: (error) => {
        // Rascunho (texto e fotos já enviadas) fica como está; só explica o que houve.
        setPublishError(feedErrorMessage(error, "Não foi possível publicar. Seu texto e suas fotos foram mantidos; tente de novo."));
        if (error instanceof ApiError && (error.code === "FEED_DISABLED" || error.code === "POSTING_NOT_ALLOWED")) {
          void queryClient.invalidateQueries({ queryKey: feedKeys.settings });
        }
      },
    });
  }

  return (
    <section aria-label="Criar publicação" data-testid="composer">
      {variant === "fab" ? (
        <button type="button" data-testid="post-fab" className="post-fab" aria-label="Nova publicação" onClick={() => setOpen(true)}>
          <Plus aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          data-testid="composer-open"
          className="flex min-h-14 w-full items-center gap-3 rounded-lg border border-border bg-card px-3 text-left shadow-[var(--shadow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setOpen(true)}
        >
          <Avatar decorative name={me.name} src={me.photo} size={36} />
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {body.trim() || attachments.length > 0 ? "Continuar rascunho…" : "No que você está pensando?"}
          </span>
          <ImagePlus size={20} className="flex-none text-primary" aria-hidden="true" />
        </button>
      )}
      {variant === "bar" && pendingNotice && (
        <p className="mt-2 flex items-start gap-2 rounded-md bg-secondary px-3 py-2 text-xs" role="status" data-testid="composer-pending-notice">
          <Clock size={14} className="mt-0.5 flex-none" aria-hidden="true" />
          Seu post foi enviado para aprovação. Ele aparece para você aqui no topo e será publicado para o grupo depois que um professor aprovar.
        </p>
      )}

      <FeedSheet
        open={open}
        onOpenChange={setOpen}
        title="Nova publicação"
        description="Compartilhe um texto ou fotos com o seu grupo."
        focusRef={field}
        testId="composer-sheet"
      >
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <label htmlFor="composer-body" className="sr-only">
            Texto da publicação
          </label>
          <Textarea
            id="composer-body"
            ref={field}
            rows={5}
            value={body}
            maxLength={FEED_BODY_MAX}
            placeholder="No que você está pensando?"
            disabled={create.isPending}
            onChange={(event) => setBody(event.target.value.slice(0, FEED_BODY_MAX))}
          />
          <p className="mt-1 text-right text-xs text-muted-foreground" aria-live="polite" data-testid="composer-counter">
            {body.length}/{FEED_BODY_MAX}
          </p>

          {attachments.length > 0 && (
            <ul className="mt-2 grid grid-cols-3 gap-2" data-testid="composer-photos">
              {attachments.map((item, index) => {
                const src = item.preview ?? (item.media ? feedMediaSrc(item.media.thumbUrl) : null);
                return (
                  <li key={item.key} className="relative aspect-square overflow-hidden rounded-md bg-muted" data-status={item.status}>
                    {src ? <img src={src} alt={`Foto ${index + 1}`} className="h-full w-full object-cover" decoding="async" /> : null}
                    {item.status === "uploading" && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white" role="status" aria-label="Enviando foto">
                        <Loader2 className="animate-spin" size={22} />
                      </span>
                    )}
                    {item.status === "error" && (
                      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 p-1 text-center text-[10px] text-white" role="alert" data-testid="photo-error">
                        <span className="line-clamp-3">{item.error}</span>
                        <button type="button" aria-label="Tentar enviar a foto de novo" className="flex size-11 items-center justify-center rounded-full bg-white/20" onClick={() => retry(item)}>
                          <RotateCw size={16} />
                        </button>
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={`Remover foto ${index + 1}`}
                      data-testid="photo-remove"
                      className="absolute right-0 top-0 flex size-11 items-start justify-end p-1.5"
                      onClick={() => removeAttachment(item.key)}
                    >
                      <span className="flex size-6 items-center justify-center rounded-full bg-black/70 text-white">
                        <X size={14} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {notices.length > 0 && (
            <ul className="mt-2 grid gap-1 text-xs text-destructive" role="alert" data-testid="composer-file-error">
              {notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <input
              ref={gallery}
              type="file"
              accept={UPLOAD_ACCEPT}
              multiple
              hidden
              data-testid="composer-file-input"
              onChange={(event) => {
                pickFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <input
              ref={camera}
              type="file"
              accept={UPLOAD_ACCEPT}
              capture="environment"
              hidden
              data-testid="composer-camera-input"
              onChange={(event) => {
                pickFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <Button type="button" variant="outline" className="h-11 flex-1" disabled={attachments.length >= FEED_MAX_PHOTOS || create.isPending} onClick={() => gallery.current?.click()}>
              <ImagePlus /> Galeria
            </Button>
            <Button type="button" variant="outline" className="h-11 flex-1" disabled={attachments.length >= FEED_MAX_PHOTOS || create.isPending} onClick={() => camera.current?.click()}>
              <Camera /> Câmera
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {attachments.length}/{FEED_MAX_PHOTOS} fotos · JPEG, PNG ou WebP até 5 MB
          </p>

          <div className="mt-3">
            {options.length > 1 ? (
              <>
                <label className="field-label mt-0!" htmlFor="composer-visibility">
                  Quem pode ver
                </label>
                <select
                  id="composer-visibility"
                  className="select-field h-11 w-full"
                  value={selected.value}
                  disabled={create.isPending}
                  onChange={(event) => setVisibilityValue(event.target.value)}
                >
                  {options.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <p className="text-xs text-muted-foreground" data-testid="composer-visibility-fixed">
                Quem pode ver: <strong className="text-foreground">{selected.label}</strong>
              </p>
            )}
          </div>

          {settings.requiresApproval && (
            <p className="mt-3 flex items-start gap-2 rounded-md bg-secondary px-3 py-2 text-xs" data-testid="composer-approval-hint">
              <Clock size={14} className="mt-0.5 flex-none" aria-hidden="true" />
              Seu post será publicado depois que um professor aprovar.
            </p>
          )}
          {failed && <p className="mt-2 text-xs text-destructive">Há fotos com erro: tente enviar de novo ou remova-as para publicar.</p>}
          {publishError && (
            <p className="mt-2 text-sm text-destructive" role="alert" data-testid="composer-error">
              {publishError}
            </p>
          )}
          <Button type="button" className="mt-3 h-11 w-full" disabled={!canPublish} onClick={publish} data-testid="composer-publish">
            {create.isPending ? "Publicando…" : uploading ? "Enviando fotos…" : "Publicar"}
          </Button>
        </div>
      </FeedSheet>
    </section>
  );
}
