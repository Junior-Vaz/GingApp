/**
 * Foto PRÓPRIA do atleta de fora do chaveamento (docs/CONTRATO_FOTO_UPLOAD_CAMERA.md §1): o snapshot público manda o
 * caminho RELATIVO `/api/public/tournaments/<token>/photos/<uuid>.webp` (token = 24..64 caracteres base64url; arquivo =
 * UUID + `.webp`). Sem imports: é usado pelo parser puro e pela resolução de URL.
 */
export const TOURNAMENT_PHOTO_PATH =
  /^\/api\/public\/tournaments\/[A-Za-z0-9_-]{24,64}\/photos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

export const isTournamentPhotoPath = (value: string): boolean => TOURNAMENT_PHOTO_PATH.test(value);
