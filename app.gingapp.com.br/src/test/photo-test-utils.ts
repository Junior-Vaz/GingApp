import { vi } from "vitest";

/** Utilidades dos testes da biblioteca de foto (jsdom não tem canvas, getUserMedia, createImageBitmap nem Blob URL). */

export interface UrlMocks {
  created: string[];
  revoked: string[];
  restore: () => void;
}

export function installUrlMocks(): UrlMocks {
  const created: string[] = [];
  const revoked: string[] = [];
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  let counter = 0;
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:test/${++counter}`;
    created.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
  return {
    created,
    revoked,
    restore: () => {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
    },
  };
}

export interface CanvasCall {
  type: string;
  quality: number | undefined;
  width: number;
  height: number;
}

export interface DrawCall {
  source: unknown;
  args: number[];
}

export interface CanvasMock {
  encodes: CanvasCall[];
  draws: DrawCall[];
  ctx: Record<string, unknown>;
  restore: () => void;
}

interface CanvasMockOptions {
  /** `false` simula o navegador que não codifica WebP (devolve PNG, como o Safari). */
  webp?: boolean;
  /** Bytes do arquivo para cada tentativa. Padrão: 10 KB. */
  sizeFor?: (call: CanvasCall) => number;
  /** `true` => `toBlob` devolve null. */
  nullBlob?: boolean;
  /** `true` => `getContext` devolve null. */
  noContext?: boolean;
}

/** Troca `getContext`/`toBlob` do canvas do jsdom por simulações que registram o que foi desenhado e codificado. */
export function installCanvasMock(options: CanvasMockOptions = {}): CanvasMock {
  const encodes: CanvasCall[] = [];
  const draws: DrawCall[] = [];
  const ctx: Record<string, unknown> = {
    fillRect: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    setTransform: vi.fn(),
    rotate: vi.fn(),
    drawImage: vi.fn((source: unknown, ...args: number[]) => {
      draws.push({ source, args });
    }),
  };
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  const original = { getContext: proto["getContext"], toBlob: proto["toBlob"] };
  const sizeFor = options.sizeFor ?? (() => 10 * 1024);
  Object.defineProperty(proto, "getContext", {
    configurable: true,
    writable: true,
    value: () => (options.noContext ? null : ctx),
  });
  Object.defineProperty(proto, "toBlob", {
    configurable: true,
    writable: true,
    value(this: HTMLCanvasElement, callback: BlobCallback, type?: string, quality?: unknown) {
      const call: CanvasCall = {
        type: type ?? "image/png",
        quality: typeof quality === "number" ? quality : undefined,
        width: this.width,
        height: this.height,
      };
      encodes.push(call);
      if (options.nullBlob) return callback(null);
      const supported =
        call.type === "image/jpeg" || (call.type === "image/webp" && options.webp !== false);
      const outType = supported ? call.type : "image/png";
      callback(new Blob([new Uint8Array(Math.max(1, sizeFor(call)))], { type: outType }));
    },
  });
  return {
    encodes,
    draws,
    ctx,
    restore: () => {
      Object.defineProperty(proto, "getContext", {
        configurable: true,
        writable: true,
        value: original.getContext,
      });
      Object.defineProperty(proto, "toBlob", {
        configurable: true,
        writable: true,
        value: original.toBlob,
      });
    },
  };
}

export interface BitmapMock {
  close: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
}

/** `createImageBitmap` global simulado. */
export function installBitmapMock(width: number, height: number): BitmapMock {
  const close = vi.fn();
  const create = vi.fn(async () => ({ width, height, close }));
  vi.stubGlobal("createImageBitmap", create);
  return { close, create };
}

export const fakeFile = (name = "foto.jpg", type = "image/jpeg", bytes = 2048): File =>
  new File([new Uint8Array(bytes)], name, { type });

/** File que declara um tamanho sem alocar a memória (para testar o teto de 25 MB). */
export function hugeFile(size: number, type = "image/jpeg"): File {
  const file = fakeFile("enorme.jpg", type, 8);
  Object.defineProperty(file, "size", { value: size });
  return file;
}

export interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  kind: string;
  getSettings: () => { facingMode?: string };
}

export interface FakeStream {
  tracks: FakeTrack[];
  getTracks: () => FakeTrack[];
  getVideoTracks: () => FakeTrack[];
}

export function makeStream(trackCount = 2, facingMode?: string): FakeStream {
  const tracks: FakeTrack[] = Array.from({ length: trackCount }, (_, index) => ({
    stop: vi.fn(),
    kind: index === 0 ? "video" : "audio",
    getSettings: () => (facingMode ? { facingMode } : {}),
  }));
  return {
    tracks,
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
  };
}

export interface MediaDevicesMock {
  getUserMedia: ReturnType<typeof vi.fn>;
  enumerateDevices: ReturnType<typeof vi.fn>;
  restore: () => void;
}

/** Substitui `navigator.mediaDevices`. `undefined` simula o navegador sem câmera/HTTP inseguro. */
export function installMediaDevices(
  impl?: {
    getUserMedia?: (constraints: MediaStreamConstraints) => Promise<unknown>;
    devices?: number;
  } | null,
): MediaDevicesMock {
  const had = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  const getUserMedia = vi.fn(impl?.getUserMedia ?? (async () => makeStream()));
  const enumerateDevices = vi.fn(async () =>
    Array.from({ length: impl?.devices ?? 1 }, (_, i) => ({
      kind: "videoinput",
      deviceId: `d${i}`,
      label: "",
    })),
  );
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: impl === null ? undefined : { getUserMedia, enumerateDevices },
  });
  return {
    getUserMedia,
    enumerateDevices,
    restore: () => {
      if (had) Object.defineProperty(navigator, "mediaDevices", had);
      else delete (navigator as unknown as Record<string, unknown>)["mediaDevices"];
    },
  };
}

export function setSecureContext(secure: boolean): () => void {
  const had = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: secure });
  return () => {
    if (had) Object.defineProperty(window, "isSecureContext", had);
    else delete (window as unknown as Record<string, unknown>)["isSecureContext"];
  };
}

/** DOMException com o nome que o navegador usa (NotAllowedError, NotFoundError...). */
export const domError = (name: string): DOMException =>
  new DOMException(`${name} (simulado)`, name);

/** Faz o jsdom suportar eventos de ponteiro com `pointerId` e coordenadas. */
export function installPointerEvent(): () => void {
  const original = (window as unknown as Record<string, unknown>)["PointerEvent"];
  class FakePointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  (window as unknown as Record<string, unknown>)["PointerEvent"] = FakePointerEvent;
  return () => {
    (window as unknown as Record<string, unknown>)["PointerEvent"] = original;
  };
}
