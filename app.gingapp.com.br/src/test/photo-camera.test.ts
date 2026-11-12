import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAMERA_IDEAL_HEIGHT,
  CAMERA_IDEAL_WIDTH,
  captureFrame,
  isCameraSupported,
  isMirroredFacing,
  listFacingSupport,
  mapCameraError,
  openCamera,
  stopCamera,
  streamIsMirrored,
} from "@/lib/photo/camera";
import { CAMERA_ERROR_MESSAGES } from "@/lib/photo/messages";
import { CameraError, PhotoError } from "@/lib/photo/types";
import {
  domError,
  installCanvasMock,
  installMediaDevices,
  makeStream,
  setSecureContext,
  type CanvasMock,
  type MediaDevicesMock,
} from "./photo-test-utils";

let media: MediaDevicesMock | undefined;
let canvas: CanvasMock | undefined;
let restoreSecure: (() => void) | undefined;

afterEach(() => {
  media?.restore();
  canvas?.restore();
  restoreSecure?.();
  media = canvas = undefined;
  restoreSecure = undefined;
});

async function cameraFailure(promise: Promise<unknown>): Promise<CameraError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CameraError);
    return error as CameraError;
  }
  throw new Error("esperava CameraError, mas a promessa resolveu");
}

describe("openCamera", () => {
  it("pede só vídeo (audio:false), facingMode ideal e resolução IDEAL modesta (nada de 4K)", async () => {
    const stream = makeStream(1);
    media = installMediaDevices({ getUserMedia: async () => stream });
    const result = await openCamera({ facing: "user" });
    expect(result).toBe(stream);
    const constraints = media.getUserMedia.mock.calls[0]?.[0] as MediaStreamConstraints;
    expect(constraints.audio).toBe(false);
    const video = constraints.video as MediaTrackConstraints;
    expect(video.facingMode).toEqual({ ideal: "user" });
    expect(video.width).toEqual({ ideal: CAMERA_IDEAL_WIDTH });
    expect(video.height).toEqual({ ideal: CAMERA_IDEAL_HEIGHT });
    expect(CAMERA_IDEAL_WIDTH).toBeLessThanOrEqual(1280);
    expect(CAMERA_IDEAL_HEIGHT).toBeLessThanOrEqual(720);
  });

  it("traseira usa facingMode environment", async () => {
    media = installMediaDevices();
    await openCamera({ facing: "environment" });
    const video = (media.getUserMedia.mock.calls[0]?.[0] as MediaStreamConstraints)
      .video as MediaTrackConstraints;
    expect(video.facingMode).toEqual({ ideal: "environment" });
  });

  it.each([
    ["NotAllowedError", "DENIED"],
    ["PermissionDeniedError", "DENIED"],
    ["NotFoundError", "NOT_FOUND"],
    ["DevicesNotFoundError", "NOT_FOUND"],
    ["NotReadableError", "IN_USE"],
    ["TrackStartError", "IN_USE"],
    ["AbortError", "IN_USE"],
    ["TypeError", "UNSUPPORTED"],
    ["Error", "UNSUPPORTED"],
  ])("%s do navegador vira CameraError %s com mensagem em português", async (name, code) => {
    media = installMediaDevices({
      getUserMedia: async () => {
        throw domError(name);
      },
    });
    const error = await cameraFailure(openCamera({ facing: "user" }));
    expect(error.code).toBe(code);
    expect(error.message).toBe(CAMERA_ERROR_MESSAGES[code as CameraError["code"]]);
  });

  it("OverconstrainedError tenta de novo sem exigências; se a 2ª também falha, mapeia o erro", async () => {
    const stream = makeStream(1);
    let calls = 0;
    media = installMediaDevices({
      getUserMedia: async () => {
        calls += 1;
        if (calls === 1) throw domError("OverconstrainedError");
        return stream;
      },
    });
    await expect(openCamera({ facing: "user" })).resolves.toBe(stream);
    expect(media.getUserMedia.mock.calls[1]?.[0]).toEqual({ video: true, audio: false });
    media.restore();

    media = installMediaDevices({
      getUserMedia: async () => {
        throw domError("OverconstrainedError");
      },
    });
    expect((await cameraFailure(openCamera({ facing: "user" }))).code).toBe("NOT_FOUND");
  });

  it("contexto inseguro (HTTP) => INSECURE_CONTEXT sem nem pedir a câmera", async () => {
    media = installMediaDevices();
    restoreSecure = setSecureContext(false);
    const error = await cameraFailure(openCamera({ facing: "user" }));
    expect(error.code).toBe("INSECURE_CONTEXT");
    expect(media.getUserMedia).not.toHaveBeenCalled();
  });

  it("NotAllowedError em contexto inseguro também vira INSECURE_CONTEXT", () => {
    restoreSecure = setSecureContext(false);
    expect(mapCameraError(domError("NotAllowedError")).code).toBe("INSECURE_CONTEXT");
  });

  it("sem navigator.mediaDevices (navegador antigo) => UNSUPPORTED", async () => {
    media = installMediaDevices(null);
    expect(isCameraSupported()).toBe(false);
    expect((await cameraFailure(openCamera({ facing: "user" }))).code).toBe("UNSUPPORTED");
  });

  it("mapCameraError aceita qualquer coisa (null, string) e não repassa o texto técnico", () => {
    expect(mapCameraError(null).code).toBe("UNSUPPORTED");
    expect(mapCameraError("falhou").code).toBe("UNSUPPORTED");
    const already = new CameraError("IN_USE", "x");
    expect(mapCameraError(already)).toBe(already);
  });
});

describe("stopCamera", () => {
  it("para TODAS as trilhas e aceita null/undefined", () => {
    const stream = makeStream(3);
    stopCamera(stream as unknown as MediaStream);
    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(() => stopCamera(null)).not.toThrow();
    expect(() => stopCamera(undefined)).not.toThrow();
  });

  it("uma trilha que lança ao parar não impede as outras", () => {
    const stream = makeStream(3);
    stream.tracks[0]?.stop.mockImplementation(() => {
      throw new Error("já parada");
    });
    stopCamera(stream as unknown as MediaStream);
    expect(stream.tracks[1]?.stop).toHaveBeenCalled();
    expect(stream.tracks[2]?.stop).toHaveBeenCalled();
  });
});

describe("espelho e troca de câmera", () => {
  it("só a frontal é espelhada (e só no preview)", () => {
    expect(isMirroredFacing("user")).toBe(true);
    expect(isMirroredFacing("environment")).toBe(false);
  });

  it("usa o facingMode REAL da trilha; sem ele (webcam), usa o pedido", () => {
    expect(streamIsMirrored(makeStream(1, "environment") as unknown as MediaStream, "user")).toBe(
      false,
    );
    expect(streamIsMirrored(makeStream(1, "user") as unknown as MediaStream, "environment")).toBe(
      true,
    );
    expect(streamIsMirrored(makeStream(1) as unknown as MediaStream, "user")).toBe(true);
    expect(streamIsMirrored(makeStream(1) as unknown as MediaStream, "environment")).toBe(false);
  });

  it("listFacingSupport: troca só quando há mais de uma câmera; falha de enumerateDevices não quebra", async () => {
    media = installMediaDevices({ devices: 2 });
    expect(await listFacingSupport()).toEqual({ canSwitch: true, devices: 2 });
    media.restore();
    media = installMediaDevices({ devices: 1 });
    expect(await listFacingSupport()).toEqual({ canSwitch: false, devices: 1 });
    media.restore();
    media = installMediaDevices(null);
    expect((await listFacingSupport()).canSwitch).toBe(false);
  });
});

describe("captureFrame", () => {
  function videoOf(width: number, height: number): HTMLVideoElement {
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", { value: width });
    Object.defineProperty(video, "videoHeight", { value: height });
    return video;
  }

  it("captura o quadro CRU (sem espelhar: nenhum scale/translate/setTransform) em JPEG, no tamanho do vídeo", async () => {
    canvas = installCanvasMock();
    const video = videoOf(1280, 720);
    const blob = await captureFrame(video);
    expect(blob.type).toBe("image/jpeg");
    expect(canvas.encodes[0]).toMatchObject({ type: "image/jpeg", width: 1280, height: 720 });
    expect(canvas.draws[0]).toEqual({ source: video, args: [0, 0, 1280, 720] });
    expect(canvas.ctx["scale"]).not.toHaveBeenCalled();
    expect(canvas.ctx["translate"]).not.toHaveBeenCalled();
    expect(canvas.ctx["setTransform"]).not.toHaveBeenCalled();
  });

  it("vídeo ainda sem imagem (0x0), canvas sem contexto ou sem blob => PhotoError ENCODE_FAILED", async () => {
    canvas = installCanvasMock();
    await expect(captureFrame(videoOf(0, 0))).rejects.toBeInstanceOf(PhotoError);
    canvas.restore();
    canvas = installCanvasMock({ noContext: true });
    await expect(captureFrame(videoOf(640, 480))).rejects.toMatchObject({ code: "ENCODE_FAILED" });
    canvas.restore();
    canvas = installCanvasMock({ nullBlob: true });
    await expect(captureFrame(videoOf(640, 480))).rejects.toMatchObject({ code: "ENCODE_FAILED" });
  });
});

describe("privacidade", () => {
  it("nada vai para localStorage/sessionStorage", async () => {
    media = installMediaDevices();
    await openCamera({ facing: "user" });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(vi.isMockFunction(media.getUserMedia)).toBe(true);
  });
});
