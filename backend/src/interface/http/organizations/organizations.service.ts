import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OrganizationType, OrgRole, Prisma, RecordStatus, UserType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { buildSlugCandidate, isForbiddenPassword, slugify } from './organizations.rules';

/** Mesmo custo do restante do código (TeachersService, PlatformTeamService, seed). */
const BCRYPT_ROUNDS = 10;
/** Tentativas de gerar um slug livre quando duas criações concorrentes disputam o mesmo (P2002). */
const MAX_SLUG_ATTEMPTS = 5;

const EMAIL_TAKEN = 'Já existe um usuário com este e-mail. Use outro e-mail para o MESTRE.';

/** Resposta do POST /organizations: a organização (mesmas colunas do GET /organizations) + o MESTRE
 * sem NENHUM segredo (nunca passwordHash). */
export type CreatedGroup = Prisma.OrganizationGetPayload<object> & {
  mestre: { id: number; name: string; email: string };
};

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Equipe PLATFORM (ou super admin) enxerga todas as organizações — uso do admin.gingapp.com.br. */
  findAllForPlatform() {
    return this.prisma.organization.findMany({
      orderBy: { id: 'desc' },
      take: 50,
    });
  }

  /** Mestre/professor/aluno vê apenas a própria organização (contexto do JWT). */
  findOwn(organizationId: number) {
    return this.prisma.organization.findUnique({ where: { id: organizationId } });
  }

  /**
   * Cria um GRUPO (Organization type GROUP, status ACTIVE) com o seu MESTRE, numa ÚNICA transação:
   * Organization + User (MEMBER, e-mail em minúsculas) + OrganizationUser (role MESTRE, ACTIVE).
   * Qualquer falha desfaz tudo — nunca sobra organização órfã nem usuário sem vínculo.
   *
   * Nada além disso é criado: assinatura/plano e unidade NÃO são pré-requisito (alunos e turmas
   * aceitam unitId vazio; StudentsService trata "sem assinatura em aberto" como "sem limite") — a
   * equipe atribui o plano depois, na tela do grupo (POST /subscriptions). O que o MESTRE precisa
   * para operar é a matriz RolePermission (seed/bootstrap): se ela não existe, falha ANTES de
   * criar qualquer coisa (503), em vez de entregar um grupo cujo MESTRE leva 403 em tudo.
   *
   * A senha só existe em memória para gerar o hash; não é logada nem devolvida.
   */
  async createGroup(dto: CreateOrganizationDto): Promise<CreatedGroup> {
    const email = dto.mestre.email.trim().toLowerCase();

    if (isForbiddenPassword(dto.mestre.password)) {
      throw new BadRequestException('mestre.password não pode ser a senha padrão de desenvolvimento.');
    }

    // 409 amigável antes de gastar bcrypt. Case-insensitive: contas antigas podem ter sido
    // gravadas com maiúsculas (o login compara o e-mail exatamente como digitado).
    await this.assertEmailFree(email);

    const mestrePermissions = await this.prisma.rolePermission.count({ where: { role: OrgRole.MESTRE } });
    if (mestrePermissions === 0) {
      throw new ServiceUnavailableException(
        'A matriz de permissões (RolePermission) não está carregada; rode o bootstrap/seed antes de criar grupos.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.mestre.password, BCRYPT_ROUNDS);
    const explicitSlug = dto.slug?.trim() || undefined;

    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = explicitSlug ?? (await this.pickFreeSlug(dto.name));
      try {
        return await this.prisma.$transaction(async (tx) => {
          const organization = await tx.organization.create({
            data: {
              name: dto.name.trim(),
              slug,
              type: OrganizationType.GROUP,
              status: RecordStatus.ACTIVE,
              document: dto.document || undefined,
              email: dto.email ? dto.email.trim().toLowerCase() : undefined,
              phone: dto.phone || undefined,
            },
          });
          const user = await tx.user.create({
            data: {
              email,
              passwordHash,
              name: dto.mestre.name.trim(),
              userType: UserType.MEMBER,
              status: 'ACTIVE',
            },
            select: { id: true, name: true, email: true },
          });
          await tx.organizationUser.create({
            data: { organizationId: organization.id, userId: user.id, role: OrgRole.MESTRE, status: 'ACTIVE' },
          });
          return { ...organization, mestre: user };
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;

        const target = String(error.meta?.target ?? '');
        if (target.includes('email')) throw new ConflictException(EMAIL_TAKEN);
        if (explicitSlug) {
          throw new ConflictException(`O slug "${explicitSlug}" já está em uso por outro grupo.`);
        }
        // Slug gerado perdeu a corrida para outra criação: escolhe de novo e tenta outra vez.
      }
    }
    throw new ConflictException('Não foi possível gerar um slug livre para este grupo. Informe um slug explícito.');
  }

  private async assertEmailFree(email: string): Promise<void> {
    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) throw new ConflictException(EMAIL_TAKEN);
  }

  /** Primeiro slug livre entre `base`, `base-2`, `base-3`... (base = nome em kebab-case sem acento). */
  private async pickFreeSlug(name: string): Promise<string> {
    const base = slugify(name);
    const taken = new Set(
      (
        await this.prisma.organization.findMany({
          where: { slug: { startsWith: base } },
          select: { slug: true },
        })
      ).map((o) => o.slug),
    );
    for (let n = 1; ; n++) {
      const candidate = buildSlugCandidate(base, n);
      if (!taken.has(candidate)) return candidate;
    }
  }
}
