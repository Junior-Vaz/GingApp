import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Clock, ImagePlus, Loader2, RotateCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import {
  feedErrorMessage,
  feedKeys,
  feedMediaSrc,
  useUploadFeedMedia,
  validateFeedPhoto,
  type FeedMediaUpload,
  type FeedSettings,
} from "@/lib/feed";
import { useVisibilityOptions } from "@/lib/feed-visibility";
import { STORY_CAPTION_MAX, useCreateStory, type CreateStoryInput } from "@/lib/stories";
import { UPLOAD_ACCEPT } from "@/lib/uploads";
import { FeedSheet } from "../feed/feed-sheet";

interface Picked {
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
  if (preview && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(preview);
};

/**
 * Criador de story (folha inferior): uma foto (câmera ou galeria, JPEG/PNG/WebP até 5 MB, enviada assim que escolhida),
 * legenda opcional de até 140, quem pode ver e Publicar. O rascunho (foto já enviada e legenda) vive só em memória e
 * sobrevive a erros de rede; nada vai para localStorage. Depois de publicar: "Enviado para aprovação" se o story ficou
 * pendente; senão ele aparece em "Seu story".
 */
export function StoryComposer({
  open,
  onOpenChange,
  settings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: FeedSettings;
}) {
  const queryClient = useQueryClient();
  const options = useVisibilityOptions();
  const upload = useUploadFeedMedia();
  const create = useCreateStory();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [caption, setCaption] = useState("");
  const [visibilityValue, setVisibilityValue] = useState("GROUP");
  const [fileError, setFileError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const pickedRef = useRef<Picked | null>(null);
  pickedRef.current = picked;
  // Cada envio tem um número: se o usuário trocar a foto no meio do upload, a resposta velha é descartada.
  const uploadSeq = useRef(0);

  useEffect(() => () => revoke(pickedRef.current?.preview ?? null), []);

  const selected = options.find((item) => item.value === visibilityValue) ?? options[0]!;
  const uploading = picked?.status === "uploading";
  const ready = picked?.status === "done" && picked.media ? picked.media : null;
  const canPublish = ready !== null && !uploading && !create.isPending;

  function startUpload(file: File, preview: string | null) {
    uploadSeq.current += 1;
    const seq = uploadSeq.current;
    setPicked({ file, preview, status: "uploading" });
    upload.mutateAsync(file).then(
      (media) => {
        if (seq === uploadSeq.current) setPicked((current) => (current ? { ...current, status: "done", media } : current));
      },
      (error: unknown) => {
        if (seq !== uploadSeq.current) return;
        setPicked((current) =>
          current ? { ...current, status: "error", error: feedErrorMessage(error, "Não foi possível enviar esta foto.") } : current,
        );
      },
    );
  }

  function pick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const invalid = validateFeedPhoto(file);
    if (invalid) {
      setFileError(invalid);
      return;
    }
    setFileError(null);
    setPublishError(null);
    revoke(picked?.preview ?? null);
    startUpload(file, makePreview(file));
  }

  function removePhoto() {
    uploadSeq.current += 1;
    revoke(picked?.preview ?? null);
    setPicked(null);
    setPublishError(null);
  }

  function reset() {
    uploadSeq.current += 1;
    revoke(picked?.preview ?? null);
    setPicked(null);
    setCaption("");
    setFileError(null);
    setPublishError(null);
  }

  function publish() {
    if (!ready || !canPublish) return;
    const text = caption.trim();
    const input: CreateStoryInput = {
      mediaId: ready.mediaId,
      visibility: selected.visibility,
      ...(text ? { caption: text } : {}),
      ...(selected.unitId !== undefined ? { unitId: selected.unitId } : {}),
      ...(selected.classId !== undefined ? { classId: selected.classId } : {}),
    };
    setPublishError(null);
    create.mutate(input, {
      onSuccess: (story) => {
        const needsApproval = story?.status === "PENDING_APPROVAL";
        reset();
        onOpenChange(false);
        if (needsApproval) toast.success("Enviado para aprovação. Um professor vai revisar antes de publicar.");
        else toast.success("Story publicado!");
      },
      onError: (error) => {
        // Foto e legenda ficam como estão; só explica o que houve.
        setPublishError(feedErrorMessage(error, "Não foi possível publicar o story. Sua foto e sua legenda foram mantidas; tente de novo."));
        if (error instanceof ApiError) {
          if (error.code === "FEED_DISABLED" || error.code === "POSTING_NOT_ALLOWED") {
            void queryClient.invalidateQueries({ queryKey: feedKeys.settings });
          }
          if (error.code === "MEDIA_INVALID") {
            // A foto expirou/foi usada: manda escolher de novo (o arquivo continua aqui para "tentar de novo").
            setPicked((current) =>
              current ? { file: current.file, preview: current.preview, status: "error", error: "Esta foto expirou. Envie de novo." } : current,
            );
          }
        }
      },
    });
  }

  const thumb = picked?.preview ?? (picked?.media ? feedMediaSrc(picked.media.thumbUrl) : null);

  return (
    <FeedSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Novo story"
      description="Compartilhe uma foto com o seu grupo. O story some em 24 horas."
      testId="story-composer"
    >
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <input
          ref={gallery}
          type="file"
          accept={UPLOAD_ACCEPT}
          hidden
          data-testid="story-file-input"
          onChange={(event) => {
            pick(event.target.files);
            event.target.value = "";
          }}
        />
        <input
          ref={camera}
          type="file"
          accept={UPLOAD_ACCEPT}
          capture="environment"
          hidden
          data-testid="story-camera-input"
          onChange={(event) => {
            pick(event.target.files);
            event.target.value = "";
          }}
        />

        {picked ? (
          <div className="relative mx-auto aspect-[9/16] max-h-[42dvh] overflow-hidden rounded-xl bg-muted" data-testid="story-preview" data-status={picked.status}>
            {thumb ? <img src={thumb} alt="Foto escolhida para o story" className="h-full w-full object-cover" decoding="async" /> : null}
            {picked.status === "uploading" && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white" role="status" aria-label="Enviando foto">
                <Loader2 className="animate-spin" size={26} />
              </span>
            )}
            {picked.status === "error" && (
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/65 p-3 text-center text-xs text-white" role="alert" data-testid="story-photo-error">
                <span>{picked.error}</span>
                <button
                  type="button"
                  aria-label="Tentar enviar a foto de novo"
                  className="flex size-11 items-center justify-center rounded-full bg-white/20"
                  onClick={() => startUpload(picked.file, picked.preview)}
                >
                  <RotateCw size={18} />
                </button>
              </span>
            )}
            <button
              type="button"
              aria-label="Remover foto"
              data-testid="story-photo-remove"
              className="absolute right-0 top-0 flex size-11 items-start justify-end p-1.5"
              onClick={removePhoto}
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-black/70 text-white">
                <X size={14} />
              </span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="h-14" disabled={create.isPending} onClick={() => gallery.current?.click()} data-testid="story-pick-gallery">
              <ImagePlus /> Galeria
            </Button>
            <Button type="button" variant="outline" className="h-14" disabled={create.isPending} onClick={() => camera.current?.click()} data-testid="story-pick-camera">
              <Camera /> Câmera
            </Button>
          </div>
        )}
        <p className="mt-1 text-xs text-muted-foreground">JPEG, PNG ou WebP até 5 MB</p>
        {fileError && (
          <p className="mt-2 text-xs text-destructive" role="alert" data-testid="story-file-error">
            {fileError}
          </p>
        )}

        <label htmlFor="story-caption" className="field-label">
          Legenda (opcional)
        </label>
        <Textarea
          id="story-caption"
          rows={2}
          value={caption}
          maxLength={STORY_CAPTION_MAX}
          placeholder="Escreva uma legenda curta"
          disabled={create.isPending}
          onChange={(event) => setCaption(event.target.value.slice(0, STORY_CAPTION_MAX))}
        />
        <p className="mt-1 text-right text-xs text-muted-foreground" aria-live="polite" data-testid="story-counter">
          {caption.length}/{STORY_CAPTION_MAX}
        </p>

        <div className="mt-3">
          {options.length > 1 ? (
            <>
              <label className="field-label mt-0!" htmlFor="story-visibility">
                Quem pode ver
              </label>
              <select
                id="story-visibility"
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
            <p className="text-xs text-muted-foreground" data-testid="story-visibility-fixed">
              Quem pode ver: <strong className="text-foreground">{selected.label}</strong>
            </p>
          )}
        </div>

        {settings.requiresApproval && (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-secondary px-3 py-2 text-xs" data-testid="story-approval-hint">
            <Clock size={14} className="mt-0.5 flex-none" aria-hidden="true" />
            Seu story será publicado depois que um professor aprovar.
          </p>
        )}
        {publishError && (
          <p className="mt-2 text-sm text-destructive" role="alert" data-testid="story-error">
            {publishError}
          </p>
        )}
        <Button type="button" className="mt-3 h-11 w-full" disabled={!canPublish} onClick={publish} data-testid="story-publish">
          {create.isPending ? "Publicando…" : uploading ? "Enviando foto…" : "Publicar"}
        </Button>
      </div>
    </FeedSheet>
  );
}
