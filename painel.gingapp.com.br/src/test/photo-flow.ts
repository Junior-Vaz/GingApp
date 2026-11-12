import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";
import { installUrlMocks, type UrlMocks } from "./photo-test-utils";

/**
 * Ajudantes de teste (Testing Library) para as telas que usam o `PhotoPicker`. A compressão/recorte (canvas) não existe no
 * jsdom: cada teste mocka `@/lib/photo/prepare-image` com `prepareMock` e usa isto para percorrer o fluxo da tela.
 */

/** Blob que o `prepareImage` falso devolve (o que seria a foto pronta, `foto.webp`). */
export const PREPARED = () => new Blob([new Uint8Array(1500)], { type: "image/webp" });

let urls: UrlMocks | null = null;

/** Blob URL falsa (o jsdom não tem `URL.createObjectURL`): chame no `beforeEach` e `restorePhotoMocks` no `afterEach`. */
export function installPhotoMocks(): UrlMocks {
  urls = installUrlMocks();
  return urls;
}

export function restorePhotoMocks(): void {
  urls?.restore();
  urls = null;
}

/** Escolhe o arquivo no `<input type=file>` do PhotoPicker (dentro de `scope`, ou na tela toda). */
export function chooseInPicker(file: File, scope: HTMLElement | null = null): void {
  const input = (scope ? within(scope) : screen).getByTestId("photo-file-input");
  fireEvent.change(input, { target: { files: [file] } });
}

/** Recorte (foto de pessoa): espera o diálogo, simula a imagem carregada e toca em "Usar esta foto". */
export async function confirmCrop(width = 1200, height = 900): Promise<void> {
  const image = (await screen.findByTestId("crop-image")) as HTMLImageElement;
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(image, "naturalHeight", { configurable: true, value: height });
  fireEvent.load(image);
  const use = await screen.findByRole("button", { name: "Usar esta foto" });
  await waitFor(() => expect(use).not.toBeDisabled());
  await act(async () => {
    fireEvent.click(use);
  });
}

/** Foto de pessoa por envio de arquivo: escolhe o arquivo, recorta e confirma. */
export async function pickSquarePhoto(file: File, scope: HTMLElement | null = null): Promise<void> {
  chooseInPicker(file, scope);
  await confirmCrop();
}
