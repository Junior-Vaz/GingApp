import { Injectable, Logger } from '@nestjs/common';
import { RegistrationSubmissionStatus } from '@prisma/client';
import { promises as fs } from 'node:fs';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { ParticipantPhotoData, TournamentPhotoSource } from '../tournaments/tournament-photo-source';
import { normalizeDate } from './answer-validation';
import { detectPrivateFileType, privateFilePath } from './private-storage';

type Stored = Record<string, unknown>;

/** Resposta guardada de um campo SEM ler o prototipo (chaves como "constructor" nunca viram funcao). */
function storedAnswer(answers: unknown, key: string): unknown {
  return answers && typeof answers === 'object' && !Array.isArray(answers) && Object.hasOwn(answers as Stored, key)
    ? (answers as Stored)[key]
    : undefined;
}

/** Campo preferido: o ATIVO; na falta, um arquivado (as respostas dele continuam na inscricao). */
function pickField<T extends { archived: boolean }>(fields: T[]): T | undefined {
  return fields.find((f) => !f.archived) ?? fields[0];
}

/** "yyyy-MM-dd" valido (1900..2100) -> Date UTC meia-noite; qualquer outra coisa = null (nunca lanca). */
function parseBirthDate(value: unknown): Date | null {
  const iso = normalizeDate(value);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Provedor de foto do chaveamento (docs/CONTRATO_FOTO_UPLOAD_CAMERA.md secao 2 / 1b): le a inscricao CONFIRMADA ligada
 * ao participante do evento e devolve a foto (campo PHOTO, arquivo PRIVADO ja sanitizado como WebP) e a data de nascimento
 * (campo com `mapsTo: birthDate`). SEMPRE restrito a organizacao E ao evento informados: nunca cruza organizacao nem evento.
 * Inscricao anonimizada, pendente/recusada/cancelada ou de outro grupo/evento = null. Nunca devolve caminho/chave de arquivo.
 *
 * Desvio documentado: se a inscricao existe mas NAO tem foto (ou o arquivo sumiu) e tem data de nascimento, devolve
 * `{ photo: null, birthDate }` (o chaveamento ainda deriva a faixa etaria); so devolve null quando nao ha nenhum dos dois.
 */
@Injectable()
export class RegistrationPhotoSource implements TournamentPhotoSource {
  private readonly logger = new Logger(RegistrationPhotoSource.name);

  constructor(private readonly prisma: PrismaService) {}

  async readForParticipant(input: { organizationId: number; eventId: number; eventParticipantId: number }): Promise<ParticipantPhotoData | null> {
    const { organizationId, eventId, eventParticipantId } = input;
    if (![organizationId, eventId, eventParticipantId].every((n) => Number.isInteger(n) && n > 0)) return null;

    // O participante precisa ser DESTE grupo e DESTE evento (a inscricao so vale para ele).
    const participant = await this.prisma.eventParticipant.findFirst({
      where: { id: eventParticipantId, organizationId, eventId },
      select: { id: true },
    });
    if (!participant) return null;

    const submission = await this.prisma.registrationSubmission.findFirst({
      where: {
        eventParticipantId,
        organizationId,
        status: RegistrationSubmissionStatus.CONFIRMED,
        anonymizedAt: null,
        form: { organizationId, eventId },
      },
      orderBy: { id: 'desc' },
      select: {
        id: true,
        answers: true,
        files: { select: { id: true, storageKey: true, organizationId: true, submissionId: true } },
        form: {
          select: { fields: { where: { OR: [{ type: 'PHOTO' }, { mapsTo: 'birthDate' }] }, select: { key: true, type: true, mapsTo: true, archived: true } } },
        },
      },
    });
    if (!submission) return null;

    const birthField = pickField(submission.form.fields.filter((f) => f.mapsTo === 'birthDate'));
    const birthDate = birthField ? parseBirthDate(storedAnswer(submission.answers, birthField.key)) : null;

    const photoFields = submission.form.fields.filter((f) => f.type === 'PHOTO');
    const photo = await this.readPhoto({ ...submission, photoFields }, organizationId);
    if (!photo && !birthDate) return null;
    return { photo, birthDate };
  }

  private async readPhoto(
    submission: {
      id: number;
      answers: unknown;
      files: Array<{ id: number; storageKey: string; organizationId: number; submissionId: number | null }>;
      photoFields: Array<{ key: string; archived: boolean }>;
    },
    organizationId: number,
  ): Promise<Buffer | null> {
    // Com mais de um campo PHOTO (so possivel com um arquivado), vale o que tem resposta na inscricao.
    const candidates = [...submission.photoFields].sort((a, b) => Number(a.archived) - Number(b.archived));
    for (const field of candidates) {
      const stored = storedAnswer(submission.answers, field.key);
      const ids = stored && typeof stored === 'object' ? (stored as { fileIds?: unknown }).fileIds : undefined;
      if (!Array.isArray(ids)) continue;
      const file = submission.files.find((f) => ids.includes(f.id) && f.organizationId === organizationId && f.submissionId === submission.id);
      const full = file ? privateFilePath(file.storageKey) : null;
      if (!file || !full) continue;
      try {
        const buffer = await fs.readFile(full);
        // So imagem (a foto e WebP sanitizado; PDF/qualquer outra coisa nunca vira foto de atleta).
        const type = detectPrivateFileType(buffer);
        if (type && type.mime !== 'application/pdf') return buffer;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.warn(`Não foi possível ler a foto da inscrição ${submission.id}: ${(error as Error).message}`);
        }
      }
    }
    return null;
  }
}
