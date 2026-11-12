import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/photo/prepare-image", () => ({ prepareImage: prepareMock }));

import { PhotoPicker, type PhotoPickerProps } from "@/components/photo/photo-picker";
import { PHOTO_ACCEPT } from "@/lib/photo/types";
import {
  domError,
  fakeFile,
  hugeFile,
  installCanvasMock,
  installMediaDevices,
  installPointerEvent,
  installUrlMocks,
  makeStream,
  setSecureContext,
  type CanvasMock,
  type FakeStream,
  type MediaDevicesMock,
  type UrlMocks,
} from "./photo-test-utils";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "./photo-dom";

const OUT = new Blob([new Uint8Array(1000)], { type: "image/webp" });

let urls: UrlMocks;
let media: MediaDevicesMock | undefined;
let canvas: CanvasMock | undefined;
let restores: Array<() => void> = [];

beforeEach(() => {
  urls = installUrlMocks();
  prepareMock.mockReset();
  prepareMock.mockResolvedValue(OUT);
  // jsdom não implementa play(): o diálogo da câmera o chama ao ligar o stream.
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    writable: true,
    value: vi.fn(async () => undefined),
  });
});

afterEach(() => {
  cleanup();
  media?.restore();
  canvas?.restore();
  restores.forEach((restore) => restore());
  restores = [];
  media = canvas = undefined;
  urls.restore();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

function Harness(props: Partial<PhotoPickerProps> & { onValue?: (blob: Blob | null) => void }) {
  const { onValue, ...rest } = props;
  const [value, setValue] = useState<string | Blob | null>(rest.value ?? null);
  return (
    <PhotoPicker
      label="Foto do atleta"
      {...rest}
      value={value}
      onChange={(blob) => {
        setValue(blob);
        onValue?.(blob);
      }}
    />
  );
}

const fileInput = () => screen.getByTestId("photo-file-input") as HTMLInputElement;

function chooseFile(file: File, input: HTMLInputElement = fileInput()) {
  fireEvent.change(input, { target: { files: [file] } });
}

/** Simula o `<img>` do recorte carregado com estas dimensões naturais. */
function loadCropImage(width = 4000, height = 3000) {
  const img = screen.getByTestId("crop-image") as HTMLImageElement;
  Object.defineProperty(img, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(img, "naturalHeight", { configurable: true, value: height });
  fireEvent.load(img);
  return img;
}

async function useThisPhoto() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Usar esta foto" }));
  });
}

/** Abre a câmera, entrega o stream e marca o vídeo como pronto. */
async function openCameraLive(stream: FakeStream = makeStream(1)) {
  media = installMediaDevices({ getUserMedia: async () => stream });
  canvas = installCanvasMock();
  fireEvent.click(screen.getByRole("button", { name: /Tirar foto/ }));
  const video = (await screen.findByTestId("camera-video")) as HTMLVideoElement;
  Object.defineProperty(video, "videoWidth", { configurable: true, value: 1280 });
  Object.defineProperty(video, "videoHeight", { configurable: true, value: 720 });
  await waitFor(() => expect(media!.getUserMedia).toHaveBeenCalled());
  await waitFor(() => expect(video.srcObject).toBe(stream));
  act(() => {
    fireEvent.loadedMetadata(video);
  });
  await waitFor(() => expect(screen.getByTestId("camera-shutter")).not.toBeDisabled());
  return { stream, video };
}

describe("PhotoPicker: enviar -> recortar -> onChange", () => {
  it("mostra 'Enviar foto' (accept correto) e 'Tirar foto', sem 'Remover' enquanto não há foto", () => {
    render(<Harness description="Foto de rosto." />);
    expect(screen.getByRole("button", { name: "Enviar foto" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tirar foto/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remover/ })).toBeNull();
    expect(fileInput().getAttribute("accept")).toBe(
      "image/jpeg,image/png,image/webp,image/heic,image/heif",
    );
    expect(fileInput().accept).toBe(PHOTO_ACCEPT);
    expect(screen.getByText("Foto do atleta")).toBeInTheDocument();
    expect(screen.getByText("Foto de rosto.")).toBeInTheDocument();
  });

  it("arquivo escolhido abre o recorte; 'Usar esta foto' chama prepareImage com o recorte e entrega o Blob", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} maxBytes={300_000} />);
    const file = fakeFile("eu.jpg");
    chooseFile(file);
    const dialog = await screen.findByRole("dialog", { name: "Ajustar foto" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usar esta foto" })).toBeDisabled(); // ainda carregando a imagem
    loadCropImage(4000, 3000);
    expect(screen.getByRole("button", { name: "Usar esta foto" })).not.toBeDisabled();
    await useThisPhoto();

    expect(prepareMock).toHaveBeenCalledTimes(1);
    const [source, opts] = prepareMock.mock.calls[0] as [
      Blob,
      { shape: string; maxBytes: number; crop: Record<string, number> },
    ];
    expect(source).toBe(file); // a original só entra no recorte; a que sai é a preparada
    expect(opts.shape).toBe("square");
    expect(opts.maxBytes).toBe(300_000);
    // 4000x3000 sem ajuste: quadrado central de 3000
    expect(opts.crop["x"]).toBeCloseTo(0.125, 6);
    expect(opts.crop["y"]).toBeCloseTo(0, 6);
    expect(opts.crop["width"]).toBeCloseTo(0.75, 6);
    expect(opts.crop["height"]).toBeCloseTo(1, 6);
    expect(onValue).toHaveBeenCalledWith(OUT);
    expect(screen.queryByRole("dialog")).toBeNull();
    // pré-visualização do Blob entregue
    expect(
      (screen.getByAltText("Pré-visualização: Foto do atleta") as HTMLImageElement).src,
    ).toMatch(/^blob:test\//);
    expect(screen.getByRole("button", { name: /Remover/ })).toBeInTheDocument();
  });

  it("teclado: '+' amplia (zoom 125%), setas movem e o recorte reflete", async () => {
    render(<Harness />);
    chooseFile(fakeFile());
    await screen.findByRole("dialog");
    loadCropImage(4000, 3000);
    const viewport = screen.getByTestId("crop-viewport");
    expect(document.activeElement).toBe(viewport); // foco vai para a área de recorte
    fireEvent.keyDown(viewport, { key: "+" });
    expect((screen.getByTestId("crop-zoom") as HTMLInputElement).value).toBe("1.25");
    expect(screen.getByTestId("crop-zoom").getAttribute("aria-valuetext")).toBe("125%");
    fireEvent.keyDown(viewport, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(viewport, { key: "-" });
    expect((screen.getByTestId("crop-zoom") as HTMLInputElement).value).toBe("1");
    fireEvent.keyDown(viewport, { key: "+" });
    fireEvent.keyDown(viewport, { key: "+" });
    await useThisPhoto();
    const opts = prepareMock.mock.calls[0]?.[1] as { crop: Record<string, number> };
    // zoom 1,5 => lado = 3000/1,5 = 2000 => 2000/4000 = 0,5 da largura
    expect(opts.crop["width"]).toBeCloseTo(0.5, 5);
    expect(opts.crop["height"]).toBeCloseTo(2000 / 3000, 5);
  });

  it("arrastar com o ponteiro move a imagem e fica preso nas bordas; pinça de dois dedos amplia", async () => {
    restores.push(installPointerEvent());
    render(<Harness />);
    chooseFile(fakeFile());
    await screen.findByRole("dialog");
    loadCropImage(4000, 3000);
    const viewport = screen.getByTestId("crop-viewport");
    fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 400, clientY: 100 }); // muito além do limite
    fireEvent.pointerUp(viewport, { pointerId: 1 });
    await useThisPhoto();
    const first = prepareMock.mock.calls[0]?.[1] as { crop: Record<string, number> };
    expect(first.crop["x"]).toBeCloseTo(0, 6); // arrastou a imagem para a direita: aparece a borda esquerda dela

    // pinça: dois dedos se afastando
    prepareMock.mockClear();
    chooseFile(fakeFile("de-novo.jpg"));
    await screen.findByRole("dialog");
    loadCropImage(4000, 3000);
    const vp = screen.getByTestId("crop-viewport");
    fireEvent.pointerDown(vp, { pointerId: 1, clientX: 100, clientY: 140 });
    fireEvent.pointerDown(vp, { pointerId: 2, clientX: 180, clientY: 140 });
    fireEvent.pointerMove(vp, { pointerId: 2, clientX: 260, clientY: 140 }); // distância 80 -> 160 (2x)
    fireEvent.pointerUp(vp, { pointerId: 1 });
    fireEvent.pointerUp(vp, { pointerId: 2 });
    expect(Number((screen.getByTestId("crop-zoom") as HTMLInputElement).value)).toBeGreaterThan(
      1.5,
    );
  });

  it("controle de zoom (slider e botões +/−) fica entre 100% e 400%", async () => {
    render(<Harness />);
    chooseFile(fakeFile());
    await screen.findByRole("dialog");
    loadCropImage();
    const slider = screen.getByTestId("crop-zoom") as HTMLInputElement;
    expect(slider.min).toBe("1");
    expect(slider.max).toBe("4");
    expect(screen.getByRole("button", { name: "Diminuir o zoom" })).toBeDisabled();
    fireEvent.change(slider, { target: { value: "9" } });
    expect(Number(slider.value)).toBeLessThanOrEqual(4);
    expect(screen.getByRole("button", { name: "Aumentar o zoom" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Diminuir o zoom" }));
    expect(Number(slider.value)).toBeCloseTo(3.75, 6);
  });

  it("'Cancelar' fecha sem chamar onChange nem prepareImage e revoga a Blob URL do recorte", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    chooseFile(fakeFile());
    await screen.findByRole("dialog");
    expect(urls.created).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onValue).not.toHaveBeenCalled();
    expect(prepareMock).not.toHaveBeenCalled();
    expect(urls.revoked).toEqual(urls.created);
  });

  it("Esc também cancela, e o foco volta ao botão que abriu", async () => {
    render(<Harness />);
    const upload = screen.getByRole("button", { name: "Enviar foto" });
    upload.focus();
    fireEvent.click(upload); // registra o botão de origem (abre o seletor, que o jsdom ignora)
    chooseFile(fakeFile());
    await screen.findByRole("dialog");
    fireEvent.keyDown(screen.getByTestId("crop-viewport"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(upload));
  });

  it("'Escolher outra' fecha o recorte e reabre o seletor de arquivos", async () => {
    render(<Harness />);
    chooseFile(fakeFile());
    await screen.findByRole("dialog");
    const click = vi.spyOn(fileInput(), "click").mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole("button", { name: "Escolher outra" }));
    expect(click).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("imagem que o navegador não abre: mostra a mensagem (role=alert) e bloqueia 'Usar esta foto'", async () => {
    render(<Harness />);
    chooseFile(fakeFile("IMG.HEIC", "image/heic"));
    await screen.findByRole("dialog");
    fireEvent.error(screen.getByTestId("crop-image"));
    const alert = await screen.findByTestId("crop-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.textContent).toMatch(/HEIC/);
    expect(alert.textContent).toMatch(/JPG ou PNG/);
    expect(screen.getByRole("button", { name: "Usar esta foto" })).toBeDisabled();
  });

  it("falha do prepareImage aparece no diálogo (aria-live) e o diálogo continua aberto para tentar de novo", async () => {
    const onValue = vi.fn();
    prepareMock.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ENCODE_FAILED" }));
    render(<Harness onValue={onValue} />);
    chooseFile(fakeFile());
    await screen.findByRole("dialog");
    loadCropImage();
    await useThisPhoto();
    const alert = await screen.findByTestId("crop-error");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert.textContent).toMatch(/preparar a foto/);
    expect(onValue).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await useThisPhoto(); // segunda tentativa funciona
    expect(onValue).toHaveBeenCalledWith(OUT);
  });

  it("arquivo acima de 25 MB: erro na hora, sem abrir o recorte", () => {
    render(<Harness />);
    chooseFile(hugeFile(30 * 1024 * 1024));
    expect(screen.getByTestId("photo-error").textContent).toMatch(/25 MB/);
    expect(screen.getByTestId("photo-error")).toHaveAttribute("role", "alert");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("PhotoPicker: câmera -> captura -> recorte", () => {
  it("abre a câmera com moldura redonda, captura SEM espelhar, desliga a câmera e segue para o recorte", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const { stream, video } = await openCameraLive(makeStream(2));
    expect(screen.getByRole("dialog", { name: "Tirar foto" })).toBeInTheDocument();
    expect(video.getAttribute("data-mirrored")).toBe("true"); // frontal: espelhada só no preview
    expect(video.style.transform).toBe("scaleX(-1)");

    await act(async () => {
      fireEvent.click(screen.getByTestId("camera-shutter"));
    });
    // captura crua: nada de scale/translate no canvas
    expect(canvas!.draws[0]?.source).toBe(video);
    expect(canvas!.ctx["scale"]).not.toHaveBeenCalled();
    await screen.findByRole("dialog", { name: "Ajustar foto" });
    // trilhas paradas assim que capturou
    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalled();

    loadCropImage(1280, 720);
    await useThisPhoto();
    const [source] = prepareMock.mock.calls[0] as [Blob];
    expect(source.type).toBe("image/jpeg");
    expect(onValue).toHaveBeenCalledWith(OUT);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("fechar a câmera (Cancelar) para todas as trilhas e não chama onChange", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const { stream } = await openCameraLive(makeStream(3));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(onValue).not.toHaveBeenCalled();
  });

  it("desmontar o picker com a câmera aberta para as trilhas", async () => {
    const view = render(<Harness />);
    const { stream } = await openCameraLive(makeStream(2));
    view.unmount();
    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalled();
  });

  it("aba oculta (visibilitychange) para a câmera; 'Ligar a câmera' retoma", async () => {
    render(<Harness />);
    const { stream } = await openCameraLive(makeStream(2));
    const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent.visibilityChange();
    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalled();
    expect(await screen.findByTestId("camera-paused")).toBeInTheDocument();
    expect(screen.getByTestId("camera-shutter")).toBeDisabled();
    state.mockReturnValue("visible");
    const second = makeStream(1);
    media!.getUserMedia.mockResolvedValueOnce(second);
    fireEvent.click(screen.getByRole("button", { name: /Ligar a câmera/ }));
    await waitFor(() => expect(media!.getUserMedia).toHaveBeenCalledTimes(2));
    state.mockRestore();
  });

  it("permissão chegando DEPOIS de fechar o diálogo: o stream tardio é parado na hora (corrida)", async () => {
    const late = makeStream(2);
    let resolve!: (stream: FakeStream) => void;
    media = installMediaDevices({
      getUserMedia: () => new Promise((r) => (resolve = r as (s: FakeStream) => void)),
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Tirar foto/ }));
    await screen.findByTestId("camera-starting");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await act(async () => resolve(late));
    for (const track of late.tracks) expect(track.stop).toHaveBeenCalled();
  });

  it("trocar frontal/traseira só aparece com mais de uma câmera, para a anterior e pede 'environment'", async () => {
    // 1 câmera: sem botão
    media = installMediaDevices({ devices: 1 });
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Tirar foto/ }));
    await screen.findByTestId("camera-video");
    await waitFor(() => expect(media!.enumerateDevices).toHaveBeenCalled());
    expect(screen.queryByTestId("camera-switch")).toBeNull();
    unmount();
    cleanup();
    media.restore();

    // 2 câmeras
    const front = makeStream(1);
    const back = makeStream(1, "environment");
    media = installMediaDevices({
      devices: 2,
      getUserMedia: async (c) => (JSON.stringify(c).includes("environment") ? back : front),
    });
    canvas = installCanvasMock();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Tirar foto/ }));
    const video = (await screen.findByTestId("camera-video")) as HTMLVideoElement;
    act(() => {
      fireEvent.loadedMetadata(video);
    });
    const toggle = await screen.findByTestId("camera-switch");
    expect(toggle).toHaveAccessibleName("Usar a câmera traseira");
    fireEvent.click(toggle);
    await waitFor(() => expect(media!.getUserMedia).toHaveBeenCalledTimes(2));
    expect(front.tracks[0]?.stop).toHaveBeenCalled();
    expect(JSON.stringify(media.getUserMedia.mock.calls[1]?.[0])).toContain("environment");
    await waitFor(() =>
      expect(screen.getByTestId("camera-video").getAttribute("data-mirrored")).toBe("false"),
    );
  });
});

describe("PhotoPicker: câmera indisponível => mensagem + fallback nativo", () => {
  async function openAndExpect(messagePattern: RegExp, code: string) {
    fireEvent.click(screen.getByRole("button", { name: /Tirar foto/ }));
    const error = await screen.findByTestId("camera-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveAttribute("data-code", code);
    expect(error.textContent).toMatch(messagePattern);
    const fallback = screen.getByTestId("camera-fallback-input") as HTMLInputElement;
    expect(fallback.getAttribute("capture")).toBe("user");
    expect(fallback.getAttribute("accept")).toBe("image/*");
    expect(fallback.type).toBe("file");
    expect(screen.getByRole("button", { name: /Usar a câmera do aparelho/ })).toBeInTheDocument();
    return fallback;
  }

  it("sem suporte a getUserMedia", async () => {
    media = installMediaDevices(null);
    render(<Harness />);
    await openAndExpect(/não permite abrir a câmera/, "UNSUPPORTED");
  });

  it("permissão negada", async () => {
    media = installMediaDevices({
      getUserMedia: async () => {
        throw domError("NotAllowedError");
      },
    });
    render(<Harness />);
    await openAndExpect(/acesso à câmera foi negado/, "DENIED");
  });

  it("sem câmera no aparelho e câmera em uso", async () => {
    media = installMediaDevices({
      getUserMedia: async () => {
        throw domError("NotFoundError");
      },
    });
    render(<Harness />);
    await openAndExpect(/Nenhuma câmera foi encontrada/, "NOT_FOUND");
    cleanup();
    media.restore();
    media = installMediaDevices({
      getUserMedia: async () => {
        throw domError("NotReadableError");
      },
    });
    render(<Harness />);
    await openAndExpect(/outro aplicativo/, "IN_USE");
  });

  it("HTTP inseguro explica que precisa de HTTPS", async () => {
    media = installMediaDevices();
    restores.push(setSecureContext(false));
    render(<Harness />);
    await openAndExpect(/HTTPS/, "INSECURE_CONTEXT");
    expect(media.getUserMedia).not.toHaveBeenCalled();
  });

  it("a foto do seletor nativo segue para o recorte e o diálogo da câmera fecha", async () => {
    media = installMediaDevices(null);
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const fallback = await openAndExpect(/câmera/, "UNSUPPORTED");
    const photo = fakeFile("selfie.jpg");
    fireEvent.change(fallback, { target: { files: [photo] } });
    await screen.findByRole("dialog", { name: "Ajustar foto" });
    expect(screen.queryByTestId("camera-dialog")).toBeNull();
    loadCropImage(3000, 4000);
    await useThisPhoto();
    expect(prepareMock.mock.calls[0]?.[0]).toBe(photo);
    expect(onValue).toHaveBeenCalledWith(OUT);
  });

  it("'Tentar de novo' reabre a câmera quando o problema passou", async () => {
    let attempts = 0;
    const stream = makeStream(1);
    media = installMediaDevices({
      getUserMedia: async () => {
        attempts += 1;
        if (attempts === 1) throw domError("NotReadableError");
        return stream;
      },
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Tirar foto/ }));
    await screen.findByTestId("camera-error");
    fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/ }));
    await waitFor(() => expect(screen.getByTestId("camera-video")).toBeInTheDocument());
    await waitFor(() => expect(attempts).toBe(2));
  });
});

describe("PhotoPicker: shape, estados e props", () => {
  it("wide: sem câmera e sem recorte; só comprime (prepareImage shape wide) e entrega", async () => {
    const onValue = vi.fn();
    render(<Harness shape="wide" label="Capa" onValue={onValue} maxBytes={200_000} />);
    expect(screen.queryByRole("button", { name: /Tirar foto/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Enviar imagem" })).toBeInTheDocument();
    await act(async () => {
      chooseFile(fakeFile("capa.png", "image/png"));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(prepareMock).toHaveBeenCalledWith(expect.any(File), {
      shape: "wide",
      maxBytes: 200_000,
    });
    await waitFor(() => expect(onValue).toHaveBeenCalledWith(OUT));
  });

  it("wide: pré-visualização com object-contain (logo inteira) sobre fundo xadrez; square usa object-cover", () => {
    const { unmount } = render(
      <PhotoPicker
        label="Logo"
        shape="wide"
        value="https://cdn.example/logo.png"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByAltText("Pré-visualização: Logo").className).toMatch(/object-contain/);
    expect(screen.getByTestId("photo-preview")).toHaveAttribute("data-checkerboard", "true");
    unmount();
    render(
      <PhotoPicker label="Rosto" value="https://cdn.example/a.png" onChange={() => undefined} />,
    );
    expect(screen.getByAltText("Pré-visualização: Rosto").className).toMatch(/object-cover/);
    expect(screen.getByTestId("photo-preview")).not.toHaveAttribute("data-checkerboard");
  });

  it("wide: erro de compressão aparece no campo", async () => {
    prepareMock.mockRejectedValueOnce(
      Object.assign(new Error("x"), { code: "UNSUPPORTED_FORMAT" }),
    );
    render(<Harness shape="wide" />);
    await act(async () => {
      chooseFile(fakeFile("a.pdf", "application/pdf"));
    });
    expect((await screen.findByTestId("photo-error")).textContent).toMatch(
      /Formato de imagem não suportado/,
    );
  });

  it("camera={false} esconde 'Tirar foto' mas mantém o recorte", async () => {
    render(<Harness camera={false} />);
    expect(screen.queryByRole("button", { name: /Tirar foto/ })).toBeNull();
    chooseFile(fakeFile());
    expect(await screen.findByRole("dialog", { name: "Ajustar foto" })).toBeInTheDocument();
  });

  it("'Remover' limpa a foto: onChange(null) e a pré-visualização some", async () => {
    const onValue = vi.fn();
    render(<Harness value="https://cdn.example/foto.webp" onValue={onValue} />);
    expect((screen.getByAltText("Pré-visualização: Foto do atleta") as HTMLImageElement).src).toBe(
      "https://cdn.example/foto.webp",
    );
    fireEvent.click(screen.getByRole("button", { name: /Remover/ }));
    expect(onValue).toHaveBeenCalledWith(null);
    expect(screen.queryByAltText("Pré-visualização: Foto do atleta")).toBeNull();
    expect(screen.queryByRole("button", { name: /Remover/ })).toBeNull();
  });

  it("value Blob: gera Blob URL para a pré-visualização e REVOGA ao trocar e ao desmontar", () => {
    const first = new Blob([new Uint8Array(5)], { type: "image/webp" });
    const second = new Blob([new Uint8Array(6)], { type: "image/webp" });
    const { rerender, unmount } = render(
      <PhotoPicker label="Foto" value={first} onChange={() => undefined} />,
    );
    expect(urls.created).toHaveLength(1);
    rerender(<PhotoPicker label="Foto" value={second} onChange={() => undefined} />);
    expect(urls.created).toHaveLength(2);
    expect(urls.revoked).toEqual([urls.created[0]]);
    unmount();
    expect(urls.revoked).toEqual(urls.created);
  });

  it("disabled e busy bloqueiam tudo; busy mostra 'Enviando…'", () => {
    const { rerender } = render(
      <PhotoPicker label="Foto" value="x" onChange={() => undefined} disabled />,
    );
    for (const name of [/Enviar foto/, /Tirar foto/, /Remover/])
      expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(fileInput()).toBeDisabled();
    rerender(<PhotoPicker label="Foto" value="x" onChange={() => undefined} busy />);
    expect(screen.getByRole("button", { name: /Enviando/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Tirar foto/ })).toBeDisabled();
    expect(screen.getByTestId("photo-status").textContent).toMatch(/Enviando/);
  });

  it("invalid marca a pré-visualização e o botão de envio (aria-invalid)", () => {
    render(<PhotoPicker label="Foto" onChange={() => undefined} invalid />);
    expect(screen.getByTestId("photo-preview").getAttribute("data-invalid")).toBe("true");
    expect(screen.getByRole("button", { name: "Enviar foto" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("sem `value` controlado, mostra a última foto gerada (uso não controlado)", async () => {
    render(<PhotoPicker label="Foto" onChange={() => undefined} />);
    chooseFile(fakeFile());
    await screen.findByRole("dialog");
    loadCropImage();
    await useThisPhoto();
    expect(await screen.findByAltText("Pré-visualização: Foto")).toBeInTheDocument();
  });

  it("imagem remota que falha ao carregar mostra aviso em vez de ícone quebrado", () => {
    render(
      <PhotoPicker
        label="Foto"
        value="https://cdn.example/quebrada.webp"
        onChange={() => undefined}
      />,
    );
    fireEvent.error(screen.getByAltText("Pré-visualização: Foto"));
    expect(screen.getByLabelText("Não foi possível carregar a imagem")).toBeInTheDocument();
  });
});

describe("PhotoPicker: acessibilidade e privacidade", () => {
  it("diálogos têm role=dialog com título e descrição; alvos de toque >= 44 px (h-11) nos botões principais", async () => {
    render(<Harness />);
    for (const name of ["Enviar foto", /Tirar foto/]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toMatch(/\bh-11\b/);
    }
    chooseFile(fakeFile());
    const dialog = await screen.findByRole("dialog", { name: "Ajustar foto" });
    expect(dialog).toHaveAccessibleDescription(/Arraste a imagem/);
    for (const name of ["Usar esta foto", "Escolher outra", "Cancelar"]) {
      expect(within(dialog).getByRole("button", { name }).className).toMatch(/\bh-11\b/);
    }
    expect(within(dialog).getByRole("button", { name: "Aumentar o zoom" }).className).toMatch(
      /\bsize-11\b/,
    );
    expect(screen.getByTestId("crop-viewport")).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("crop-viewport").getAttribute("aria-label")).toMatch(/Setas movem/);
  });

  it("o botão de captura tem nome acessível, é alcançável e começa com o foco; sem animação obrigatória", async () => {
    render(<Harness />);
    await openCameraLive();
    const shutter = screen.getByTestId("camera-shutter");
    expect(shutter).toHaveAccessibleName("Tirar foto");
    expect(shutter.className).toMatch(/size-\[72px\]/);
    expect(document.activeElement).toBe(shutter);
    // reduced motion: animações só com `motion-safe:` (nenhuma classe animate-* solta)
    const dialog = screen.getByTestId("camera-dialog");
    const loose = [...dialog.querySelectorAll<HTMLElement>("[class]")].filter((el) =>
      (el.getAttribute("class") ?? "")
        .split(/\s+/)
        .some((c) => /^(animate-spin|transition-transform|active:scale-95)$/.test(c)),
    );
    expect(loose).toHaveLength(0);
    expect(screen.getByTestId("camera-live-status")).toHaveAttribute("aria-live", "polite");
  });

  it("nada é gravado em localStorage/sessionStorage durante o fluxo completo", async () => {
    render(<Harness />);
    chooseFile(fakeFile());
    await screen.findByRole("dialog");
    loadCropImage();
    await useThisPhoto();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("o recorte nunca entrega a original: quem chega ao onChange é o retorno de prepareImage", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const original = fakeFile("original-gigante.jpg");
    chooseFile(original);
    await screen.findByRole("dialog");
    loadCropImage();
    await useThisPhoto();
    expect(onValue).toHaveBeenCalledTimes(1);
    expect(onValue.mock.calls[0]?.[0]).toBe(OUT);
    expect(onValue.mock.calls[0]?.[0]).not.toBe(original);
  });
});
