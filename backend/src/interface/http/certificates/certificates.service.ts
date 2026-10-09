import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { ListCertificatesQueryDto } from './dto/list-certificates-query.dto';
import { StudentsService } from '../students/students.service';
import { CreateCertificateDto } from './dto/create-certificate.dto';
import { UpdateCertificateDto } from './dto/update-certificate.dto';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentsService: StudentsService,
  ) {}

  /** Antes SEM limite; agora paginado (padrão 50, igual aos demais módulos) — `limit`/`offset` e
   * o header X-Total-Count dão acesso ao resto. */
  async findAll(organizationId: number, query: ListCertificatesQueryDto = {}): Promise<Page<unknown>> {
    const and: Prisma.CertificateWhereInput[] = [];
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
        include: { student: { select: { id: true, name: true } } },
        orderBy: { id: 'desc' },
        ...pageArgs(query),
      }),
      this.prisma.certificate.count({ where }),
    ]);
    return { items, total };
  }

  async findOne(organizationId: number, id: number) {
    const certificate = await this.prisma.certificate.findFirst({
      where: { id, organizationId },
      include: { student: { select: { id: true, name: true } } },
    });
    if (!certificate) {
      throw new NotFoundException('Certificado não encontrado.');
    }
    return certificate;
  }

  /** Certificados do usuário autenticado ou de seus dependentes — mesmo padrão de
   * StudentsService.findMine/FinanceService.findMine. */
  async findMine(organizationId: number, userId: number) {
    const myStudents = await this.studentsService.findMine(organizationId, userId);
    const studentIds = myStudents.map((s) => s.id);
    if (studentIds.length === 0) return [];

    return this.prisma.certificate.findMany({
      where: { organizationId, studentId: { in: studentIds } },
      include: { student: { select: { id: true, name: true } } },
      orderBy: { id: 'desc' },
    });
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

  async create(organizationId: number, dto: CreateCertificateDto) {
    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, organizationId },
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

    return this.prisma.certificate.create({
      data: {
        organizationId,
        studentId: dto.studentId,
        studentGraduationId: dto.studentGraduationId,
        title: dto.title,
        issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : new Date(),
        fileUrl: dto.fileUrl,
      },
      include: { student: { select: { id: true, name: true } } },
    });
  }

  async update(organizationId: number, id: number, dto: UpdateCertificateDto) {
    await this.findOne(organizationId, id);

    return this.prisma.certificate.update({
      where: { id },
      data: {
        title: dto.title,
        issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : undefined,
        fileUrl: dto.fileUrl,
      },
      include: { student: { select: { id: true, name: true } } },
    });
  }

  async remove(organizationId: number, id: number): Promise<void> {
    await this.findOne(organizationId, id);
    await this.prisma.certificate.delete({ where: { id } });
  }
}
