import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CertificatePurpose, Prisma } from '@prisma/client';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { UnitScopeService, unitScopeFilter } from '../../../shared/access/unit-scope';
import { PermissionsService } from '../../../shared/access/permissions.service';
import { frontendBaseUrl } from '../../../shared/mail/mail.config';
import { renderCertificatePdf } from './certificate-pdf';
import { CertificateLayout, validateCertificateLayout } from './certificate-layout';
import { CertificateTemplatesService } from './certificate-templates.service';
import { ListCertificatesQueryDto } from './dto/list-certificates-query.dto';
import { StudentsService } from '../students/students.service';
import { CreateCertificateDto } from './dto/create-certificate.dto';
import { UpdateCertificateDto } from './dto/update-certificate.dto';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { RankingService } from '../ranking/ranking.service';
import { LEVEL_SELECT, withRope } from '../graduations/rope';

const CERTIFICATE_NOT_FOUND = 'Certificado não encontrado.';

const PDF_INCLUDE = {
  student: { select: { name: true } },
  organization: { select: { name: true } },
  studentGraduation: { select: { graduationLevel: { select: { name: true } } } },
} satisfies Prisma.CertificateInclude;

/** Leitura (lista, detalhe, /me): aluno + a graduação de origem com o nível no contrato de corda. */
const LIST_INCLUDE = {
  student: { select: { id: true, name: true, photo: true } },
  studentGraduation: { select: { id: true, graduatedAt: true, graduationLevel: { select: LEVEL_SELECT } } },
} satisfies Prisma.CertificateInclude;

/** A cópia do desenho (até 64 KB) só serve ao PDF: nunca vai nas respostas de leitura (que trazem `templateId`). */
const OMIT_SNAPSHOT = { layoutSnapshot: true } satisfies Prisma.CertificateOmit;

/** studentGraduation.graduationLevel sempre com {id, name, order, color, style, colors}; sem graduação = null. */
function withGraduationRope<C extends { studentGraduation: { graduationLevel: Parameters<typeof withRope>[0] } | null }>(certificate: C) {
  return {
    ...certificate,
    studentGraduation: certificate.studentGraduation
      ? { ...certificate.studentGraduation, graduationLevel: withRope(certificate.studentGraduation.graduationLevel) }
      : null,
  };
}

/**
 * Certificados (projeto.txt §52, Jornada do Capoeirista — PLANO_PROJETO.md §10.15). Cada
 * certificado carrega um `verificationCode` público e não-sequencial (gerado pelo Prisma via
 * `cuid()` no schema) — é esse código, não o `id`, que vai no QR Code e na URL pública de
 * verificação (`PublicCertificatesController`).
 *
 * Certificate não tem campo status (mesmo caso de Event): "remover" apaga de verdade — não há
 * como emitir um certificado por engano e simplesmente escondê-lo, mas também não faz sentido
 * manter um certificado cancelado "vivo" com um QR Code que ainda valida.
 */
@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly studentsService: StudentsService,
    private readonly unitScope: UnitScopeService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
    private readonly ranking: RankingService,
    private readonly templates: CertificateTemplatesService,
  ) {}

  /** Antes SEM limite; agora paginado (padrão 50, igual aos demais módulos) — `limit`/`offset` e
   * o header X-Total-Count dão acesso ao resto. */
  async findAll(organizationId: number, query: ListCertificatesQueryDto = {}, user?: AuthenticatedUser): Promise<Page<unknown>> {
    const and: Prisma.CertificateWhereInput[] = [];
    // Escopo por unidade (E08): o PROFESSOR com unidades atribuídas só vê certificados de alunos das suas unidades.
    and.push({ student: unitScopeFilter(await this.unitScope.resolve(user, organizationId)) });
    // from/to: data de emissão, datas civis (UTC) inclusivas.
    if (query.from) and.push({ issuedAt: { gte: new Date(`${query.from.slice(0, 10)}T00:00:00.000Z`) } });
    if (query.to) {
      and.push({
        issuedAt: { lt: new Date(new Date(`${query.to.slice(0, 10)}T00:00:00.000Z`).getTime() + 86_400_000) },
      });
    }
    const q = query.q?.trim();
    if (q) {
      and.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { verificationCode: { contains: q, mode: 'insensitive' } },
          { student: { name: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }
    const where: Prisma.CertificateWhereInput = {
      organizationId,
      ...(query.studentId !== undefined ? { studentId: query.studentId } : {}),
      AND: and,
    };

    const [items, total] = await Promise.all([
      this.prisma.certificate.findMany({
        where,
        include: LIST_INCLUDE,
        omit: OMIT_SNAPSHOT,
        orderBy: { id: 'desc' },
        ...pageArgs(query),
      }),
      this.prisma.certificate.count({ where }),
    ]);
    return { items: items.map(withGraduationRope), total };
  }

  async findOne(organizationId: number, id: number, user?: AuthenticatedUser) {
    const scope = await this.unitScope.resolve(user, organizationId);
    const certificate = await this.prisma.certificate.findFirst({
      where: { id, organizationId, student: unitScopeFilter(scope) },
      include: LIST_INCLUDE,
      omit: OMIT_SNAPSHOT,
    });
    if (!certificate) {
      throw new NotFoundException('Certificado não encontrado.');
    }
    return withGraduationRope(certificate);
  }

  /** Certificados do usuário autenticado ou de seus dependentes — mesmo padrão de
   * StudentsService.findMine/FinanceService.findMine. */
  async findMine(organizationId: number, userId: number) {
    const myStudents = await this.studentsService.findMine(organizationId, userId);
    const studentIds = myStudents.map((s) => s.id);
    if (studentIds.length === 0) return [];

    const rows = await this.prisma.certificate.findMany({
      where: { organizationId, studentId: { in: studentIds } },
      include: LIST_INCLUDE,
      omit: OMIT_SNAPSHOT,
      orderBy: { id: 'desc' },
    });
    return rows.map(withGraduationRope);
  }

  /**
   * PDF do certificado (GET /certificates/:id/pdf). Mesmo escopo da leitura: quem tem `certificates:view` na matriz
   * (Mestre/Professor) baixa os do grupo (com o escopo de unidade do professor); ALUNO/RESPONSAVEL só os próprios/
   * dependentes. Qualquer outro caso (inclusive certificado de outro grupo) = 404.
   */
  async buildPdf(organizationId: number, id: number, user: AuthenticatedUser): Promise<{ filename: string; buffer: Buffer }> {
    let certificate;
    if (await this.permissions.can(user, 'certificates', 'view')) {
      const scope = await this.unitScope.resolve(user, organizationId);
      certificate = await this.prisma.certificate.findFirst({
        where: { id, organizationId, student: unitScopeFilter(scope) },
        include: PDF_INCLUDE,
      });
    } else {
      const myStudents = await this.studentsService.findMine(organizationId, user.id);
      certificate = await this.prisma.certificate.findFirst({
        where: { id, organizationId, studentId: { in: myStudents.map((s) => s.id) } },
        include: PDF_INCLUDE,
      });
    }
    if (!certificate) throw new NotFoundException(CERTIFICATE_NOT_FOUND);
    const rendered = await this.render(certificate, true);
    await this.audit.record({
      organizationId,
      action: AuditAction.CERTIFICATE_DOWNLOAD,
      entity: AuditEntity.CERTIFICATE,
      entityId: id,
      meta: { studentId: certificate.studentId },
    });
    return rendered;
  }

  /** PDF público pelo código de verificação (QR). Só o que a verificação pública já expõe (sem graduação). */
  async buildPublicPdf(verificationCode: string): Promise<{ filename: string; buffer: Buffer }> {
    const certificate = await this.prisma.certificate.findUnique({ where: { verificationCode }, include: PDF_INCLUDE });
    if (!certificate) throw new NotFoundException(CERTIFICATE_NOT_FOUND);
    return this.render(certificate, false);
  }

  private async render(
    certificate: Prisma.CertificateGetPayload<{ include: typeof PDF_INCLUDE }>,
    withGraduation: boolean,
  ): Promise<{ filename: string; buffer: Buffer }> {
    const appUrl = frontendBaseUrl('APP');
    const buffer = await renderCertificatePdf(
      {
        organizationName: certificate.organization.name,
        studentName: certificate.student.name,
        title: certificate.title,
        graduationName: withGraduation ? (certificate.studentGraduation?.graduationLevel.name ?? null) : null,
        issuedAt: certificate.issuedAt ?? certificate.createdAt,
        verificationCode: certificate.verificationCode,
        verificationUrl: appUrl ? `${appUrl}/verificar/${certificate.verificationCode}` : null,
      },
      this.snapshotOf(certificate),
    );
    return { filename: `certificado-${certificate.verificationCode}.pdf`, buffer };
  }

  /**
   * Desenho gravado na emissão (contrato secao 7, item 4). Sem snapshot (certificado antigo) = null -> clássico embutido.
   * Revalidado por defesa: snapshot corrompido também cai no clássico (o PDF nunca deixa de sair).
   */
  private snapshotOf(certificate: { id: number; layoutSnapshot: Prisma.JsonValue | null }): CertificateLayout | null {
    if (certificate.layoutSnapshot === null || certificate.layoutSnapshot === undefined) return null;
    try {
      return validateCertificateLayout(certificate.layoutSnapshot);
    } catch (error) {
      this.logger.warn(`Certificado ${certificate.id}: layoutSnapshot inválido (${(error as Error).message}); usando o clássico.`);
      return null;
    }
  }

  /** Verificação pública (sem autenticação) pelo código do QR Code — retorna só o mínimo
   * necessário para confirmar autenticidade, nunca dados sensíveis do aluno (documento,
   * contato) nem o organizationId/studentId internos. */
  async findByVerificationCode(verificationCode: string) {
    const certificate = await this.prisma.certificate.findUnique({
      where: { verificationCode },
      include: { student: { select: { name: true } }, organization: { select: { name: true } } },
    });
    if (!certificate) {
      throw new NotFoundException('Certificado não encontrado — código de verificação inválido.');
    }

    return {
      title: certificate.title,
      studentName: certificate.student.name,
      organizationName: certificate.organization.name,
      issuedAt: certificate.issuedAt,
    };
  }

  async create(organizationId: number, dto: CreateCertificateDto, user?: AuthenticatedUser) {
    const scope = await this.unitScope.resolve(user, organizationId);
    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, organizationId, ...unitScopeFilter(scope) },
    });
    if (!student) {
      throw new BadRequestException('Aluno inválido para esta organização.');
    }

    if (dto.studentGraduationId) {
      const graduation = await this.prisma.studentGraduation.findFirst({
        where: { id: dto.studentGraduationId, organizationId, studentId: dto.studentId },
      });
      if (!graduation) {
        throw new BadRequestException('Graduação inválida para este aluno.');
      }
    }

    // Modelo (contrato secao 7): informado -> padrão do uso (GRADUACAO com graduação vinculada, senão OUTRO) -> clássico.
    // O certificado guarda a CÓPIA do desenho: editar/excluir o modelo depois não muda este certificado.
    const { templateId, layoutSnapshot } = await this.templates.resolveForIssue(
      organizationId,
      dto.templateId,
      dto.studentGraduationId ? CertificatePurpose.GRADUACAO : CertificatePurpose.OUTRO,
    );

    const created = await this.prisma.certificate.create({
      data: {
        organizationId,
        studentId: dto.studentId,
        studentGraduationId: dto.studentGraduationId,
        title: dto.title,
        issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : new Date(),
        fileUrl: dto.fileUrl,
        templateId,
        layoutSnapshot: layoutSnapshot as unknown as Prisma.InputJsonValue,
      },
      include: { student: { select: { id: true, name: true } } },
      omit: OMIT_SNAPSHOT,
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.CERTIFICATE_ISSUE,
      entity: AuditEntity.CERTIFICATE,
      entityId: created.id,
      meta: { studentId: dto.studentId, studentGraduationId: dto.studentGraduationId ?? null, templateId },
    });
    this.ranking.queueSync(dto.studentId); // Ginga Rank (fire-and-forget): +20 por certificado
    return created;
  }

  async update(organizationId: number, id: number, dto: UpdateCertificateDto, user?: AuthenticatedUser) {
    await this.findOne(organizationId, id, user);

    return this.prisma.certificate.update({
      where: { id },
      data: {
        title: dto.title,
        issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : undefined,
        fileUrl: dto.fileUrl,
        // templateId/layoutSnapshot NUNCA mudam aqui (contrato secao 7, item 3).
      },
      include: { student: { select: { id: true, name: true } } },
      omit: OMIT_SNAPSHOT,
    });
  }

  async remove(organizationId: number, id: number, user?: AuthenticatedUser): Promise<void> {
    const certificate = await this.findOne(organizationId, id, user);
    await this.prisma.certificate.delete({ where: { id } });
    this.ranking.queueSync(certificate.studentId); // Ginga Rank (remove os pontos do certificado)
  }
}
