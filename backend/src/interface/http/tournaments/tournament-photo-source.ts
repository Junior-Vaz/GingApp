/**
 * Fronteira entre o chaveamento e o módulo de formulários (docs/CONTRATO_FOTO_UPLOAD_CAMERA.md §1b/§2).
 * O chaveamento só conhece esta interface; quem a implementa (formulários) a exporta com o token abaixo.
 */

export const TOURNAMENT_PHOTO_SOURCE = Symbol('TOURNAMENT_PHOTO_SOURCE');

export interface ParticipantPhotoData {
  /** Foto já sanitizada pelo formulário (ou null se a inscrição não tem foto). */
  photo: Buffer | null;
  /** Data de nascimento da inscrição (campo com mapsTo = birthDate), se houver. */
  birthDate: Date | null;
}

export interface TournamentPhotoSource {
  /**
   * Foto e nascimento da inscrição CONFIRMADA ligada ao participante do evento.
   * SEMPRE restrito à organização e ao evento informados (nunca cruzar organização).
   * Devolve null se não houver inscrição, se ela estiver anonimizada ou sem arquivo.
   */
  readForParticipant(input: {
    organizationId: number;
    eventId: number;
    eventParticipantId: number;
  }): Promise<ParticipantPhotoData | null>;
}
