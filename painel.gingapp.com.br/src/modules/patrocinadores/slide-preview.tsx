import { useState } from "react";
import { sponsorImageSrc } from "./api";
import { DEFAULT_CTA_LABEL } from "./sponsor-utils";

interface SlidePreviewProps {
  title: string;
  text: string;
  ctaLabel: string;
  /** Imagem de fundo (referência de upload); vazio = degradê. */
  imageRef: string;
  /** Logo do patrocinador (referência de upload). */
  logoRef: string;
  sponsorName: string;
  /** Nome do grupo (faixa "Parceiro do <grupo>"). */
  groupName: string;
}

/**
 * Pré-visualização do slide "Patrocinado" do carrossel da Home do app, na largura de um celular (375 px). Mesmas medidas do
 * banner do app: 251 px de altura, raio 8, respiro de 24/32 px, título 24 px, texto 12 px (máx. 300 px). Selo "Patrocinado"
 * e faixa "Parceiro do <grupo>" sempre visíveis. Os controles são só desenho (não clicáveis). Atualiza ao vivo.
 */
export function SlidePreview({ title, text, ctaLabel, imageRef, logoRef, sponsorName, groupName }: SlidePreviewProps) {
  const image = sponsorImageSrc(imageRef);
  const logo = sponsorImageSrc(logoRef);
  const [failedImage, setFailedImage] = useState("");
  const [failedLogo, setFailedLogo] = useState("");
  const showImage = image !== "" && failedImage !== image;
  const showLogo = logo !== "" && failedLogo !== logo;
  const shownTitle = title.trim() || "Título da campanha";
  const shownText = text.trim() || "Texto curto que explica a oferta ao aluno.";
  const shownCta = ctaLabel.trim() || DEFAULT_CTA_LABEL;
  const shownSponsor = sponsorName.trim() || "Patrocinador";
  const shownGroup = groupName.trim() || "seu grupo";

  return (
    <figure className="m-0" data-testid="slide-preview">
      <figcaption className="mb-2 text-xs font-medium text-foreground">Pré-visualização no app (375 px)</figcaption>
      <div className="overflow-x-auto pb-1">
        <div
          role="group"
          aria-label="Pré-visualização do slide patrocinado"
          data-testid="slide-frame"
          className="relative h-[251px] w-[375px] flex-none overflow-hidden rounded-lg text-white"
          style={{
            background: showImage ? "#0f2a1d" : "linear-gradient(120deg, #0f2a1d, #1e4a33 70%, #2c5d3a)",
          }}
        >
          {showImage && (
            <img
              src={image}
              alt=""
              data-testid="preview-image"
              className="absolute inset-0 size-full object-cover"
              style={{ objectPosition: "center 58%" }}
              onError={() => setFailedImage(image)}
            />
          )}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{ background: "linear-gradient(90deg, rgb(8 28 18 / 0.92), rgb(8 28 18 / 0.7) 60%, rgb(8 28 18 / 0.45))" }}
          />
          <div className="relative z-[1] max-w-[510px] px-8 pt-6 pb-[34px]">
            <div className="flex items-center gap-2">
              <span
                data-testid="preview-sponsor"
                className="inline-flex h-[26px] max-w-[170px] items-center gap-1.5 rounded-full bg-white px-2 text-[11px] font-bold text-[#14301f]"
              >
                {showLogo && (
                  <img
                    src={logo}
                    alt=""
                    data-testid="preview-logo"
                    className="h-[18px] w-auto max-w-12 object-contain"
                    onError={() => setFailedLogo(logo)}
                  />
                )}
                <span className="truncate">{shownSponsor}</span>
              </span>
              <span
                data-testid="preview-badge"
                className="inline-flex h-[22px] items-center rounded-[4px] bg-[#facc15] px-2 text-[10px] font-extrabold uppercase tracking-[1.2px] text-[#1f1500]"
              >
                Patrocinado
              </span>
            </div>
            <h3 data-testid="preview-title" className="mt-2.5 mb-2 text-2xl leading-[1.2] font-bold [overflow-wrap:anywhere]">
              {shownTitle}
            </h3>
            <p data-testid="preview-text" className="mb-3.5 max-w-[300px] text-xs leading-[1.7] opacity-90 [overflow-wrap:anywhere]">
              {shownText}
            </p>
            <div className="flex items-center gap-3.5">
              <span
                data-testid="preview-cta"
                className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#facc15] px-3.5 text-xs font-bold text-[#1f1500]"
              >
                {shownCta} <span aria-hidden>↗</span>
              </span>
              <span className="text-[10px] underline opacity-90">Por que vejo isso?</span>
            </div>
          </div>
          <div
            data-testid="preview-partner"
            className="absolute inset-x-0 bottom-0 z-[2] truncate bg-black/55 px-8 py-[3px] text-[10px] font-semibold tracking-wide text-white"
          >
            Parceiro do {shownGroup}
          </div>
        </div>
      </div>
    </figure>
  );
}
