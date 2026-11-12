import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareImage } from "@/lib/photo/prepare-image";
import { PhotoError } from "@/lib/photo/types";
import {
  fakeFile,
  hugeFile,
  installBitmapMock,
  installCanvasMock,
  installUrlMocks,
  type CanvasMock,
  type UrlMocks,
} from "./photo-test-utils";

let canvas: CanvasMock;
let urls: UrlMocks;

beforeEach(() => {
  urls = installUrlMocks();
});
afterEach(() => {
  canvas?.restore();
  urls.restore();
  vi.unstubAllGlobals();
});

async function failure(promise: Promise<unknown>): Promise<PhotoError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PhotoError);
    return error as PhotoError;
  }
  throw new Error("esperava PhotoError, mas a promessa resolveu");
}

describe("prepareImage: caminho feliz", () => {
  it("devolve WebP 800x800 recortado (cover) e decodifica com a orientação do EXIF", async () => {
    canvas = installCanvasMock();
    const bitmap = installBitmapMock(4000, 3000);
    const out = await prepareImage(fakeFile(), {});
    expect(bitmap.create).toHaveBeenCalledWith(expect.any(Blob), {
      imageOrientation: "from-image",
    });
    expect(out.type).toBe("image/webp");
    expect(out.size).toBeLessThanOrEqual(400 * 1024);
    expect(canvas.encodes).toEqual([{ type: "image/webp", quality: 0.9, width: 800, height: 800 }]);
    // recorte central: quadrado de 3000 px começando em x=500
    expect(canvas.draws[0]?.args).toEqual([500, 0, 3000, 3000, 0, 0, 800, 800]);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("respeita o recorte escolhido (normalizado) mesmo que a decodificação tenha outra escala", async () => {
    canvas = installCanvasMock();
    installBitmapMock(2000, 2000);
    await prepareImage(fakeFile(), { crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } });
    expect(canvas.draws[0]?.args).toEqual([500, 500, 1000, 1000, 0, 0, 800, 800]);
  });

  it("fundo branco antes de desenhar (PNG transparente não vira preto no JPEG de reserva)", async () => {
    canvas = installCanvasMock();
    installBitmapMock(1000, 1000);
    await prepareImage(fakeFile("a.png", "image/png"));
    expect(canvas.ctx["fillRect"]).toHaveBeenCalledWith(0, 0, 800, 800);
    expect(canvas.ctx["fillStyle"]).toBe("#ffffff");
  });

  it("aceita arquivo sem tipo (foto da câmera do aparelho) e HEIC quando o navegador decodifica", async () => {
    canvas = installCanvasMock();
    installBitmapMock(1200, 1200);
    await expect(
      prepareImage(new Blob([new Uint8Array(10)], { type: "" })),
    ).resolves.toBeInstanceOf(Blob);
    await expect(prepareImage(fakeFile("x.heic", "image/heic"))).resolves.toBeInstanceOf(Blob);
  });

  it("não amplia origem pequena: 600x600 sai 600x600", async () => {
    canvas = installCanvasMock();
    installBitmapMock(600, 600);
    await prepareImage(fakeFile());
    expect(canvas.encodes[0]).toMatchObject({ width: 600, height: 600 });
  });
});

describe("prepareImage: shape wide (só compressão)", () => {
  it("reduz o lado maior a 1600 mantendo a proporção, sem recorte", async () => {
    canvas = installCanvasMock();
    installBitmapMock(4000, 2000);
    await prepareImage(fakeFile(), { shape: "wide" });
    expect(canvas.encodes[0]).toMatchObject({ type: "image/webp", width: 1600, height: 800 });
    expect(canvas.draws[0]?.args).toEqual([0, 0, 4000, 2000, 0, 0, 1600, 800]);
  });

  it("não amplia imagem pequena e ignora o `crop`", async () => {
    canvas = installCanvasMock({ sizeFor: () => 1000 });
    installBitmapMock(500, 300);
    await prepareImage(fakeFile("a.jpg", "image/jpeg", 5000), {
      shape: "wide",
      maxBytes: 4000, // a original não cabe: cai na escada
      crop: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    });
    expect(canvas.encodes[0]).toMatchObject({ width: 500, height: 300 });
    expect(canvas.draws[0]?.args).toEqual([0, 0, 500, 300, 0, 0, 500, 300]);
  });
});

describe("prepareImage: escada de qualidade e dimensão até caber em maxBytes", () => {
  it("desce a qualidade (0,9 -> 0,5) antes de reduzir a dimensão", async () => {
    // só cabe a partir de q <= 0,7 em 800
    canvas = installCanvasMock({
      sizeFor: (c) => (c.quality && c.quality > 0.75 ? 900 * 1024 : 300 * 1024),
    });
    installBitmapMock(4000, 4000);
    const out = await prepareImage(fakeFile(), { maxBytes: 400 * 1024 });
    expect(out.size).toBe(300 * 1024);
    expect(canvas.encodes.map((e) => [e.width, e.quality])).toEqual([
      [800, 0.9],
      [800, 0.8],
      [800, 0.7],
    ]);
  });

  it("esgotada a qualidade, a dimensão cai 800 -> 600 -> 480", async () => {
    canvas = installCanvasMock({ sizeFor: (c) => (c.width === 480 ? 100 * 1024 : 900 * 1024) });
    installBitmapMock(4000, 4000);
    const out = await prepareImage(fakeFile());
    expect(out.size).toBe(100 * 1024);
    const dims = canvas.encodes.map((e) => e.width);
    expect(dims.slice(0, 5)).toEqual([800, 800, 800, 800, 800]);
    expect(dims.slice(5, 10)).toEqual([600, 600, 600, 600, 600]);
    expect(dims.slice(10)).toEqual([480]);
    expect(canvas.encodes.at(-1)).toMatchObject({ width: 480, height: 480, quality: 0.9 });
  });

  it("respeita um maxBytes customizado", async () => {
    canvas = installCanvasMock({ sizeFor: () => 150 * 1024 });
    installBitmapMock(2000, 2000);
    await expect(prepareImage(fakeFile(), { maxBytes: 100 * 1024 })).rejects.toMatchObject({
      code: "ENCODE_FAILED",
    });
    expect(canvas.encodes).toHaveLength(15); // 3 dimensões x 5 qualidades
    const ok = await prepareImage(fakeFile(), { maxBytes: 200 * 1024 });
    expect(ok.size).toBe(150 * 1024);
  });

  it("se nada cabe nem em 480 com q 0,5 => ENCODE_FAILED (nunca devolve o que o servidor vai recusar)", async () => {
    canvas = installCanvasMock({ sizeFor: () => 5 * 1024 * 1024 });
    const bitmap = installBitmapMock(3000, 3000);
    const error = await failure(prepareImage(fakeFile()));
    expect(error.code).toBe("ENCODE_FAILED");
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });
});

describe("prepareImage: wide preserva transparência e devolve a original quando já cabe", () => {
  it("original JPEG/PNG/WebP com lado maior <= 1600 e <= maxBytes volta SEM recomprimir (mesmo objeto)", async () => {
    canvas = installCanvasMock();
    const bitmap = installBitmapMock(1200, 600);
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      const logo = fakeFile("logo", type, 3000);
      const out = await prepareImage(logo, { shape: "wide" });
      expect(out).toBe(logo);
    }
    expect(canvas.encodes).toHaveLength(0);
    expect(bitmap.close).toHaveBeenCalledTimes(3);
    // exatamente 1600 e exatamente maxBytes ainda cabem
    bitmap.create.mockResolvedValueOnce({ width: 1600, height: 900, close: bitmap.close });
    const edge = fakeFile("e.png", "image/png", 4096);
    expect(await prepareImage(edge, { shape: "wide", maxBytes: 4096 })).toBe(edge);
  });

  it("não cabe (lado > 1600 ou bytes > maxBytes) => escada normal", async () => {
    canvas = installCanvasMock();
    installBitmapMock(2000, 1000);
    const big = fakeFile("a.png", "image/png", 3000);
    const out = await prepareImage(big, { shape: "wide" });
    expect(out).not.toBe(big);
    expect(canvas.encodes[0]).toMatchObject({ type: "image/webp", width: 1600, height: 800 });
    canvas.restore();
    canvas = installCanvasMock({ sizeFor: () => 1000 });
    installBitmapMock(800, 400);
    const heavy = fakeFile("b.png", "image/png", 6000);
    expect(await prepareImage(heavy, { shape: "wide", maxBytes: 5000 })).not.toBe(heavy);
    expect(canvas.encodes).toHaveLength(1);
  });

  it("wide com PNG/WebP NÃO pinta fundo branco (alfa preservado) e codifica em WebP", async () => {
    canvas = installCanvasMock();
    installBitmapMock(3000, 1000);
    const out = await prepareImage(fakeFile("logo.png", "image/png", 3000), { shape: "wide" });
    expect(out.type).toBe("image/webp");
    expect(canvas.ctx["fillRect"]).not.toHaveBeenCalled();
  });

  it("sem WebP no navegador, wide com alfa usa PNG (não JPEG) e sem fundo branco", async () => {
    canvas = installCanvasMock({ webp: false });
    installBitmapMock(3000, 1000);
    const out = await prepareImage(fakeFile("logo.png", "image/png", 3000), { shape: "wide" });
    expect(out.type).toBe("image/png");
    expect(canvas.encodes.map((e) => e.type)).toEqual(["image/webp", "image/png"]);
    expect(canvas.ctx["fillRect"]).not.toHaveBeenCalled();
  });

  it("PNG que não cabe em nenhuma dimensão: último recurso JPEG com fundo branco", async () => {
    canvas = installCanvasMock({
      webp: false,
      sizeFor: (c) => (c.type === "image/png" ? 900 * 1024 : 100 * 1024),
    });
    installBitmapMock(3000, 1000);
    const out = await prepareImage(fakeFile("logo.png", "image/png", 3000), { shape: "wide" });
    expect(out.type).toBe("image/jpeg");
    // PNG ignora a qualidade: uma tentativa por dimensão (1600, 1200, 900, 640)
    expect(canvas.encodes.filter((e) => e.type === "image/png").map((e) => e.width)).toEqual([
      1600, 1200, 900, 640,
    ]);
    expect(canvas.ctx["fillRect"]).toHaveBeenCalled();
  });

  it("wide a partir de JPEG (sem alfa possível) segue com fundo branco como antes", async () => {
    canvas = installCanvasMock();
    installBitmapMock(3000, 1000);
    await prepareImage(fakeFile("foto.jpg", "image/jpeg", 3000), { shape: "wide" });
    expect(canvas.ctx["fillRect"]).toHaveBeenCalled();
  });

  it("square continua igual: nunca devolve a original, WebP recortado, fundo branco, JPEG na reserva", async () => {
    canvas = installCanvasMock();
    installBitmapMock(500, 500);
    const small = fakeFile("a.png", "image/png", 1000);
    const out = await prepareImage(small);
    expect(out).not.toBe(small);
    expect(out.type).toBe("image/webp");
    expect(canvas.ctx["fillRect"]).toHaveBeenCalled();
    canvas.restore();
    canvas = installCanvasMock({ webp: false });
    installBitmapMock(2000, 2000);
    const fallback = await prepareImage(fakeFile("a.png", "image/png"));
    expect(fallback.type).toBe("image/jpeg");
    expect(canvas.encodes.map((e) => e.type)).toEqual(["image/webp", "image/jpeg"]);
  });
});

describe("prepareImage: WebP com reserva em JPEG", () => {
  it("navegador que devolve PNG para 'image/webp' => usa JPEG, detectado pelo blob.type", async () => {
    canvas = installCanvasMock({ webp: false });
    installBitmapMock(2000, 2000);
    const out = await prepareImage(fakeFile());
    expect(out.type).toBe("image/jpeg");
    expect(canvas.encodes.map((e) => e.type)).toEqual(["image/webp", "image/jpeg"]);
  });

  it("depois de detectar que não há WebP, as próximas tentativas da escada vão direto em JPEG", async () => {
    canvas = installCanvasMock({
      webp: false,
      sizeFor: (c) => (c.quality && c.quality > 0.65 ? 900 * 1024 : 100 * 1024),
    });
    installBitmapMock(2000, 2000);
    const out = await prepareImage(fakeFile());
    expect(out.type).toBe("image/jpeg");
    const types = canvas.encodes.map((e) => e.type);
    expect(types.filter((t) => t === "image/webp")).toHaveLength(1);
    expect(types.slice(1).every((t) => t === "image/jpeg")).toBe(true);
  });

  it("toBlob devolvendo null em WebP também cai em JPEG; null nos dois => ENCODE_FAILED", async () => {
    canvas = installCanvasMock({ nullBlob: true });
    installBitmapMock(1000, 1000);
    const error = await failure(prepareImage(fakeFile()));
    expect(error.code).toBe("ENCODE_FAILED");
  });
});

describe("prepareImage: erros tipados", () => {
  it("entrada acima de 25 MB => TOO_LARGE_INPUT, sem nem decodificar", async () => {
    canvas = installCanvasMock();
    const bitmap = installBitmapMock(1000, 1000);
    const error = await failure(prepareImage(hugeFile(26 * 1024 * 1024)));
    expect(error.code).toBe("TOO_LARGE_INPUT");
    expect(error.message).toMatch(/25 MB/);
    expect(bitmap.create).not.toHaveBeenCalled();
    // exatamente 25 MB ainda é aceito
    await expect(prepareImage(hugeFile(25 * 1024 * 1024))).resolves.toBeInstanceOf(Blob);
  });

  it("tipos que não são imagem (PDF) e SVG => UNSUPPORTED_FORMAT", async () => {
    canvas = installCanvasMock();
    const bitmap = installBitmapMock(1000, 1000);
    expect((await failure(prepareImage(fakeFile("a.pdf", "application/pdf")))).code).toBe(
      "UNSUPPORTED_FORMAT",
    );
    expect((await failure(prepareImage(fakeFile("a.svg", "image/svg+xml")))).code).toBe(
      "UNSUPPORTED_FORMAT",
    );
    expect(bitmap.create).not.toHaveBeenCalled();
  });

  it("arquivo que nenhum decodificador abre => DECODE_FAILED (com <img> de reserva também falhando)", async () => {
    canvas = installCanvasMock();
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("boom")));
    class BrokenImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("Image", BrokenImage);
    const error = await failure(prepareImage(fakeFile("quebrado.jpg", "image/jpeg")));
    expect(error.code).toBe("DECODE_FAILED");
    expect(urls.revoked).toHaveLength(urls.created.length); // sem vazar Blob URL
  });

  it("HEIC que o navegador não abre => UNSUPPORTED_FORMAT com orientação para tirar a foto na hora ou enviar JPG/PNG", async () => {
    canvas = installCanvasMock();
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("heic")));
    class BrokenImage {
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("Image", BrokenImage);
    const error = await failure(prepareImage(fakeFile("IMG_1.HEIC", "image/heic")));
    expect(error.code).toBe("UNSUPPORTED_FORMAT");
    expect(error.heic).toBe(true);
    expect(error.message).toMatch(/HEIC/);
    expect(error.message).toMatch(/JPG ou PNG/);
  });

  it("imagem decodificada com 0x0 => DECODE_FAILED e o bitmap é fechado", async () => {
    canvas = installCanvasMock();
    const bitmap = installBitmapMock(0, 0);
    const error = await failure(prepareImage(fakeFile()));
    expect(error.code).toBe("DECODE_FAILED");
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("canvas sem contexto 2D => ENCODE_FAILED e o bitmap é fechado", async () => {
    canvas = installCanvasMock({ noContext: true });
    const bitmap = installBitmapMock(1000, 1000);
    const error = await failure(prepareImage(fakeFile()));
    expect(error.code).toBe("ENCODE_FAILED");
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("toda PhotoError tem mensagem em português e o código no objeto", async () => {
    canvas = installCanvasMock();
    const error = await failure(prepareImage(hugeFile(30 * 1024 * 1024)));
    expect(error.name).toBe("PhotoError");
    expect(error.message).toMatch(/[ãáéíóúç]/);
  });
});

describe("prepareImage: reserva com <img> (sem createImageBitmap)", () => {
  it("decodifica pelo <img>, usa as dimensões naturais e revoga a Blob URL", async () => {
    canvas = installCanvasMock();
    vi.stubGlobal("createImageBitmap", undefined);
    class OkImage {
      naturalWidth = 3000;
      naturalHeight = 2000;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", OkImage);
    const out = await prepareImage(fakeFile());
    expect(out.type).toBe("image/webp");
    expect(canvas.draws[0]?.args).toEqual([500, 0, 2000, 2000, 0, 0, 800, 800]);
    expect(urls.created).toHaveLength(1);
    expect(urls.revoked).toEqual(urls.created);
  });

  it("createImageBitmap que falha cai no <img> em vez de desistir", async () => {
    canvas = installCanvasMock();
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("sem suporte à opção")));
    class OkImage {
      naturalWidth = 1000;
      naturalHeight = 1000;
      onload: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", OkImage);
    await expect(prepareImage(fakeFile())).resolves.toBeInstanceOf(Blob);
  });
});

describe("prepareImage: privacidade", () => {
  it("a saída é um Blob novo (re-codificado), nunca a original; nada é gravado em localStorage/sessionStorage", async () => {
    canvas = installCanvasMock();
    installBitmapMock(1000, 1000);
    const original = fakeFile();
    const out = await prepareImage(original);
    expect(out).not.toBe(original);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
