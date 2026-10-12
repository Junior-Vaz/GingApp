/**
 * Deteccao do tipo REAL de uma imagem pelos "magic bytes" (assinatura no inicio do arquivo).
 * O mimetype e a extensao vem do cliente e nao provam nada: so a assinatura conta. Aceita apenas
 * JPEG, PNG e WebP (nada de SVG/GIF/HTML disfarçado de imagem).
 */
export type DetectedImage = { mime: 'image/jpeg' | 'image/png' | 'image/webp'; ext: 'jpg' | 'png' | 'webp' };

export function detectImageType(buf: Buffer): DetectedImage | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: 'png' };
  }
  // WebP: "RIFF" <4 bytes de tamanho> "WEBP"
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}
