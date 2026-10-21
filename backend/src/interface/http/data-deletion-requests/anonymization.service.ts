import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StudentStatus, TransferStatus, UserType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { BCRYPT_ROUNDS } from '../../../shared/security/password-policy';
import { revocationCutoff } from '../../../shared/security/token-revocation';
import { generateGingappCode } from '../people/gingapp-code';
import { deletePrivateFile } from '../registration-forms/private-storage';
import { anonymizeSubmissions } from '../registration-forms/submission-purge';
import { deleteFeedFiles } from '../feed/feed-media-storage';
import { anonymizeFeedForUser, FeedAnonymizationResult } from '../feed/feed-purge';
import { normalizeEmail } from '../../../shared/security/password-policy';
import { OPEN_DELETION_STATUSES } from './deletion-request-status';

export const REMOVED_NAME = 'Pessoa removida';
export const REMOVED_GUARDIAN_NAME = 'Responsável removido';
export const REMOVED_TEXT = '[removido na anonimização]';

export interface AnonymizationResult {
  personId: number | null;
  studentsAnonymized: number;
  userDeactivated: boolean;
  occurrencesRetained: number;
}

/**
 * ANONIMIZACAO LGPD (art. 18) de quem fez o pedido de exclusao - executada pelo SUPER ADMIN (docs/FICHA_UNICA.md secao 12).
 * Uma transacao so:
 *  - Person (e fichas mescladas nela) -> 'Pessoa removida', sem apelido/nascimento/foto/genero/contato/CPF (enc, hash, last4,
 *    tipo), SEM login e com gingappCode NOVO (o antigo deixa de achar a ficha); `anonymizedAt`;
 *  - cada matricula (Student) -> mesmo tratamento + sem login/capa/redes; ex-aluno (FORMER, motivo ANONYMIZED); turmas
 *    inativas; apelido do ranking e perfil publico apagados/despublicados;
 *  - compartilhamentos com outros grupos revogados e pedidos de transferencia abertos cancelados (notas limpas);
 *  - responsavel (StudentGuardian) desse login -> 'Responsavel removido', sem contato nem login;
 *  - User -> nome 'Pessoa removida', e-mail `anonimizado-<id>@anonimizado.invalid`, sem telefone/foto/2FA, senha aleatoria,
 *    status INACTIVE, TODAS as sessoes revogadas, vinculos inativos, avisos/push/tokens apagados, cargos revogados.
 * PRESERVADO (integridade historica e agregados, sem identificar): frequencia, graduacoes, certificados, financeiro,
 * pontos, auditoria. OCORRENCIAS: sao RETIDAS (inclusive expulsoes) so como registro sem identificacao direta - tipo, datas e
 * status ficam; motivo e notas viram texto padrao. Decisao: nao bloqueia a anonimizacao (a matricula ja nao identifica ninguem).
 * Bloqueios (409): usuario da equipe da plataforma e ultimo MESTRE ativo de um grupo (o grupo ficaria sem administrador).
 */
@Injectable()
export class AnonymizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async anonymizeRequest(requestId: number, actorUserId: number, now = new Date()): Promise<AnonymizationResult> {
    const request = await this.prisma.dataDeletionRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Pedido de exclusão não encontrado.');
    if (!OPEN_DELETION_STATUSES.includes(request.status)) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'DELETION_REQUEST_FINAL',
        message: 'Este pedido já foi finalizado e não pode ser anonimizado.',
      });
    }
    const user = await this.prisma.user.findUnique({ where: { id: request.userId } });
    if (!user) throw new NotFoundException('Usuário do pedido não encontrado.');
    if (user.userType === UserType.PLATFORM || user.isSuperAdmin) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'ANONYMIZE_PLATFORM_USER',
        message: 'Este usuário é da equipe da plataforma; a anonimização é tratada manualmente.',
      });
    }
    await this.assertNotLastMestre(user.id);

    const passwordHash = await bcrypt.hash(randomBytes(32).toString('base64url'), BCRYPT_ROUNDS);
    // Inscricoes de formularios publicos do titular (mesmo e-mail ou CPF): anonimizadas na MESMA transacao; os anexos
    // saem do disco depois do commit.
    const registrations = { count: 0, storageKeys: [] as string[] };
    // Feed do grupo: posts/comentarios do titular perdem autor e texto; as fotos saem do disco depois do commit.
    const feed: FeedAnonymizationResult = { posts: 0, comments: 0, reactions: 0, media: 0, storageKeys: [] };
    const result = await this.prisma.$transaction((tx) => this.run(tx, request.id, user.id, passwordHash, now, registrations, feed), {
      timeout: 60_000,
      maxWait: 10_000,
    });
    for (const key of registrations.storageKeys) await deletePrivateFile(key).catch(() => undefined);
    await deleteFeedFiles(feed.storageKeys);

    await this.audit.record({
      organizationId: request.organizationId,
      userId: actorUserId,
      entity: AuditEntity.PERSON,
      entityId: result.personId ?? user.id,
      action: AuditAction.PERSON_ANONYMIZE,
      // Nunca nome, e-mail ou documento: so contagens e ids.
      meta: {
        requestId,
        targetUserId: user.id,
        ...result,
        registrationSubmissionsAnonymized: registrations.count,
        feedPostsAnonymized: feed.posts,
        feedCommentsAnonymized: feed.comments,
        feedMediaDeleted: feed.media,
      },
    });
    return result;
  }

  private async assertNotLastMestre(userId: number): Promise<void> {
    const mine = await this.prisma.organizationUser.findMany({
      where: { userId, role: 'MESTRE', status: 'ACTIVE' },
      select: { organizationId: true, organization: { select: { name: true } } },
    });
    for (const m of mine) {
      const others = await this.prisma.organizationUser.count({
        where: { organizationId: m.organizationId, role: 'MESTRE', status: 'ACTIVE', userId: { not: userId } },
      });
      if (others === 0) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: 'ANONYMIZE_LAST_MESTRE',
          message: `Este usuário é o único mestre ativo de "${m.organization.name}". Nomeie outro mestre antes de anonimizar.`,
        });
      }
    }
  }

  private async run(
    tx: Prisma.TransactionClient,
    requestId: number,
    userId: number,
    passwordHash: string,
    now: Date,
    registrations: { count: number; storageKeys: string[] } = { count: 0, storageKeys: [] },
    feed?: FeedAnonymizationResult,
  ): Promise<AnonymizationResult> {
    // Fichas do login e as mescladas nelas (cadeia).
    const personIds = new Set<number>((await tx.person.findMany({ where: { userId }, select: { id: true } })).map((p) => p.id));
    let frontier = [...personIds];
    while (frontier.length > 0) {
      const merged = await tx.person.findMany({
        where: { mergedIntoId: { in: frontier }, id: { notIn: [...personIds] } },
        select: { id: true },
      });
      frontier = merged.map((m) => m.id);
      for (const id of frontier) personIds.add(id);
    }
    const ids = [...personIds];

    const students = await tx.student.findMany({
      where: { OR: [{ userId }, ...(ids.length ? [{ personId: { in: ids } }] : [])] },
      select: { id: true, status: true, leftAt: true, leftReason: true },
    });
    const studentIds = students.map((s) => s.id);

    // Formularios de inscricao: e-mails (login + fichas) e hash do CPF das fichas ANTES de apagar os dados delas.
    const owner = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
    const personRows = ids.length
      ? await tx.person.findMany({ where: { id: { in: ids } }, select: { email: true, documentHash: true, documentKind: true } })
      : [];
    const emails = [...new Set([owner?.email, ...personRows.map((p) => p.email)].filter((e): e is string => !!e).map(normalizeEmail))];
    const documentHashes = personRows.filter((p) => p.documentKind === 'CPF' && p.documentHash).map((p) => p.documentHash as string);
    const registrationMatch = [
      ...(emails.length ? [{ email: { in: emails } }] : []),
      ...(documentHashes.length ? [{ documentHash: { in: documentHashes } }] : []),
    ];
    if (registrationMatch.length > 0) {
      const purged = await anonymizeSubmissions(tx, { OR: registrationMatch }, now);
      registrations.count = purged.count;
      registrations.storageKeys = purged.storageKeys;
    }
    // Feed (contrato secao 4, LGPD): antes de soltar o vinculo Person.userId (os posts tambem casam pela ficha).
    const feedResult = await anonymizeFeedForUser(tx, userId, ids, now);
    if (feed) Object.assign(feed, feedResult);

    for (const personId of ids) {
      await tx.person.update({
        where: { id: personId },
        data: {
          name: REMOVED_NAME,
          nickname: null,
          birthDate: null,
          photo: null,
          gender: null,
          email: null,
          phone: null,
          documentHash: null,
          documentEnc: null,
          documentLast4: null,
          documentKind: null,
          userId: null,
          gingappCode: await this.freeCode(tx),
          anonymizedAt: now,
        },
      });
    }
    for (const s of students) {
      await tx.student.update({
        where: { id: s.id },
        data: {
          name: REMOVED_NAME,
          birthDate: null,
          document: null,
          phone: null,
          email: null,
          photo: null,
          coverPhoto: null,
          socialLinks: Prisma.JsonNull,
          userId: null,
          anonymizedAt: now,
          ...(s.status === StudentStatus.FORMER
            ? {}
            : { status: StudentStatus.FORMER, leftAt: s.leftAt ?? now, leftReason: s.leftReason ?? 'ANONYMIZED' }),
        },
      });
    }
    let occurrencesRetained = 0;
    if (studentIds.length > 0) {
      await tx.classStudent.updateMany({ where: { studentId: { in: studentIds }, status: 'ACTIVE' }, data: { status: 'INACTIVE' } });
      await tx.rankingProfile.updateMany({ where: { studentId: { in: studentIds } }, data: { nickname: null, optInPublic: false } });
      await tx.publicProfile.updateMany({
        where: { studentId: { in: studentIds } },
        data: { displayName: REMOVED_NAME, bio: null, photo: null, isPublished: false },
      });
      await tx.studentGuardian.updateMany({
        where: { studentId: { in: studentIds } },
        data: { name: REMOVED_GUARDIAN_NAME, phone: null, email: null, userId: null },
      });
      const occ = await tx.occurrence.updateMany({ where: { studentId: { in: studentIds } }, data: { reason: REMOVED_TEXT } });
      occurrencesRetained = occ.count;
      await tx.occurrence.updateMany({
        where: { studentId: { in: studentIds }, contestNote: { not: null } },
        data: { contestNote: REMOVED_TEXT },
      });
      await tx.occurrence.updateMany({
        where: { studentId: { in: studentIds }, retractNote: { not: null } },
        data: { retractNote: REMOVED_TEXT },
      });
    }
    if (ids.length > 0) {
      await tx.enrollmentShare.updateMany({ where: { personId: { in: ids }, revokedAt: null }, data: { revokedAt: now } });
      await tx.transferRequest.updateMany({
        where: { personId: { in: ids }, status: TransferStatus.PENDING_PERSON },
        data: { status: TransferStatus.CANCELLED, decidedAt: now },
      });
      await tx.transferRequest.updateMany({ where: { personId: { in: ids } }, data: { note: null } });
      await tx.transferContest.updateMany({ where: { request: { personId: { in: ids } } }, data: { note: null } });
      await tx.transferApprovalToken.updateMany({ where: { request: { personId: { in: ids } }, usedAt: null }, data: { usedAt: now } });
    }
    // Responsavel que e este login (mesmo sem ficha): remove nome/contato dos dependentes de qualquer grupo.
    await tx.studentGuardian.updateMany({
      where: { userId },
      data: { name: REMOVED_GUARDIAN_NAME, phone: null, email: null, userId: null },
    });

    await tx.personRole.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
    await tx.userUnitAccess.deleteMany({ where: { userId } });
    await tx.organizationUser.updateMany({ where: { userId }, data: { status: 'INACTIVE' } });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.pushSubscription.deleteMany({ where: { userId } });
    await tx.pushPreference.deleteMany({ where: { userId } });
    await tx.passwordResetToken.deleteMany({ where: { userId } });
    await tx.publicProfile.updateMany({
      where: { userId },
      data: { displayName: REMOVED_NAME, bio: null, photo: null, isPublished: false },
    });
    await tx.user.update({
      where: { id: userId },
      data: {
        name: REMOVED_NAME,
        email: `anonimizado-${userId}@anonimizado.invalid`,
        phone: null,
        photo: null,
        passwordHash,
        status: 'INACTIVE',
        tokenValidAfter: revocationCutoff(),
        mustChangePassword: false,
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorRecoveryHashes: [],
        twoFactorLastStep: null,
      },
    });

    const prev = await tx.dataDeletionRequest.findUniqueOrThrow({ where: { id: requestId }, select: { resolutionNote: true } });
    const note = `Anonimizado em ${now.toISOString().slice(0, 10)}.`;
    await tx.dataDeletionRequest.update({
      where: { id: requestId },
      data: { status: 'DONE', resolvedAt: now, resolutionNote: prev.resolutionNote ? `${prev.resolutionNote}\n${note}` : note },
    });
    return { personId: ids[0] ?? null, studentsAnonymized: students.length, userDeactivated: true, occurrencesRetained };
  }

  private async freeCode(tx: Prisma.TransactionClient): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const code = generateGingappCode();
      if (!(await tx.person.findUnique({ where: { gingappCode: code }, select: { id: true } }))) return code;
    }
    throw new ConflictException('Não foi possível gerar um código novo; tente de novo.');
  }
}
