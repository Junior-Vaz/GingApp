import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Organization, OrganizationType, OrgRole, Prisma, RecordStatus, UserType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { Page, PageQueryDto, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { UpdateOwnOrganizationDto } from './dto/update-own-organization.dto';
import { ResetMestrePasswordDto } from './dto/reset-mestre-password.dto';
import { BCRYPT_ROUNDS, isForbiddenPassword, normalizeEmail } from '../../../shared/security/password-policy';
import { findUserIdsByEmail } from '../../../shared/security/email-lookup';
import { revocationCutoff } from '../../../shared/security/token-revocation';
import { buildSlugCandidate, slugify } from './organizations.rules';

/** Tentativas de gerar um slug livre quando duas criações concorrentes disputam o mesmo (P2002). */
const MAX_SLUG_ATTEMPTS = 5;

/**
 * socialLinks (coluna Json? nullable): undefined = não mexe; null OU objeto sem nenhuma rede ({} ou só chaves
 * null) = Prisma.DbNull (NULL de verdade — NÃO Prisma.JsonNull, que gravaria o literal JSON `null`); objeto
 * com redes = substitui por inteiro, descartando chaves null/undefined. (Mesma regra de Student.socialLinks.)
 */
function toSocialLinksInput(
  socialLinks: UpdateOwnOrganizationDto['socialLinks'],
): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (socialLinks === undefined) return undefined;
  if (socialLinks === null) return Prisma.DbNull;
  const filled = Object.fromEntries(
    Object.entries(socialLinks).filter(([, url]) => url !== null && url !== undefined),
  );
  return Object.keys(filled).length > 0 ? (filled as Prisma.InputJsonValue) : Prisma.DbNull;
}

/** Nome da unidade criada junto com o grupo (o Mestre pode renomear em PATCH /units/:id). */
export const MAIN_UNIT_NAME = 'Matriz';

const EMAIL_TAKEN ='Já existe um usuário com este e-mail. Use outro e-mail para o MESTRE.';

/** Resposta do POST /organizations: a organização (mesmas colunas do GET /organizations) + o MESTRE
 * sem NENHUM segredo (nunca passwordHash). */
export type CreatedGroup = Prisma.OrganizationGetPayload<object> & {
  mestre: { id: number; name: string; email: string };
};

/** Resposta do GET /organizations/:id: a organização (mesmas colunas de uma linha de GET /organizations)
 * + os seus MESTREs sem NENHUM segredo. `id` = id do USUÁRIO (o mesmo de .../members/:userId/reset-password);
 * `status` = status do vínculo (OrganizationUser) — ACTIVE é o que o reset exige. */
export type OrganizationDetail = Prisma.OrganizationGetPayload<object> & {
  mestres: Array<{ id: number; name: string; email: string; status: string }>;
};

/** 404 único do reset: alvo inexistente, de outra organização, de outro papel ou inativo são indistinguíveis. */
const MESTRE_NOT_FOUND = 'Mestre não encontrado neste grupo.';
const ORGANIZATION_NOT_FOUND = 'Organização não encontrada.';
/** Maior Int do Postgres (colunas id): acima disso o Prisma lançaria erro (500) em vez de não achar nada. */
const MAX_DB_ID = 2_147_483_647;

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Equipe PLATFORM (ou super admin) enxerga todas as organizações — uso do admin.gingapp.com.br. */
  async findAllForPlatform(query: PageQueryDto = {}): Promise<Page<Organization>> {
    const q = query.q?.trim();
    const where: Prisma.OrganizationWhereInput = q ? { name: { contains: q, mode: 'insensitive' } } : {};
    const [items, total] = await Promise.all([
      this.prisma.organization.findMany({ where, orderBy: { id: 'desc' }, ...pageArgs(query) }),
      this.prisma.organization.count({ where }),
    ]);
    return { items, total };
  }

  /** Mestre/professor/aluno vê apenas a própria organização (contexto do JWT). */
  findOwn(organizationId: number) {
    return this.prisma.organization.findUnique({ where: { id: organizationId } });
  }

  /** Detalhe de UM grupo para a equipe PLATFORM: a organização + os MESTREs (qualquer status do vínculo). */
  async findOneForPlatform(id: number): Promise<OrganizationDetail> {
    if (id > MAX_DB_ID) throw new NotFoundException(ORGANIZATION_NOT_FOUND);
    const organization = await this.prisma.organization.findUnique({ where: { id } });
    if (!organization) throw new NotFoundException(ORGANIZATION_NOT_FOUND);

    const memberships = await this.prisma.organizationUser.findMany({
      where: { organizationId: id, role: OrgRole.MESTRE },
      orderBy: { id: 'asc' },
      select: { status: true, user: { select: { id: true, name: true, email: true } } },
    });
    return {
      ...organization,
      mestres: memberships.map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email, status: m.status })),
    };
  }

  /**
   * Edita name/document/email/phone do grupo (slug imutável, não existe no DTO). `null` limpa
   * document/email/phone. Corpo sem nenhum campo => 400. Grupo inexistente => 404.
   */
  async update(id: number, dto: UpdateOrganizationDto): Promise<Organization> {
    if (id > MAX_DB_ID) throw new NotFoundException(ORGANIZATION_NOT_FOUND);
    const data: Prisma.OrganizationUpdateInput = {
      name: dto.name?.trim(),
      document: dto.document,
      email: dto.email == null ? dto.email : dto.email.trim().toLowerCase(),
      phone: dto.phone,
    };
    if (Object.values(data).every((value) => value === undefined)) {
      throw new BadRequestException('Informe ao menos um campo para atualizar (name, document, email ou phone).');
    }
    return this.updateOrFail(id, data);
  }

  /**
   * O MESTRE edita o PRÓPRIO grupo (organizationId vem do token, nunca do corpo): dados cadastrais
   * (name/document/email/phone) + perfil institucional (description, history, foundedYear, city, state,
   * website, logo, socialLinks). `slug`, `status` e `type` não existem no DTO (imutáveis para o Mestre).
   * `null` limpa os campos opcionais; `socialLinks` SUBSTITUI o objeto inteiro. Corpo sem campo => 400.
   * Devolve a organização inteira (as mesmas colunas do GET /organizations).
   */
  async updateOwn(organizationId: number, dto: UpdateOwnOrganizationDto): Promise<Organization> {
    const data: Prisma.OrganizationUpdateInput = {
      name: dto.name?.trim(),
      document: dto.document,
      email: dto.email == null ? dto.email : dto.email.trim().toLowerCase(),
      phone: dto.phone,
      description: dto.description,
      history: dto.history,
      foundedYear: dto.foundedYear,
      city: dto.city,
      state: dto.state,
      website: dto.website,
      logo: dto.logo,
      paymentInstructions: dto.paymentInstructions,
      socialLinks: toSocialLinksInput(dto.socialLinks),
    };
    if (Object.values(data).every((value) => value === undefined)) {
      throw new BadRequestException(
        'Informe ao menos um campo para atualizar (name, document, email, phone, description, history, foundedYear, city, state, website, logo, paymentInstructions ou socialLinks).',
      );
    }
    return this.updateOrFail(organizationId, data);
  }

  /**
   * Desativa (INACTIVE) ou reativa (ACTIVE) o grupo. Nunca apaga dados. Idempotente. Enquanto INACTIVE,
   * os usuários do grupo não logam e os tokens já emitidos caem na próxima requisição (JwtStrategy).
   */
  async setStatus(id: number, status: RecordStatus): Promise<Organization> {
    if (id > MAX_DB_ID) throw new NotFoundException(ORGANIZATION_NOT_FOUND);
    return this.updateOrFail(id, { status });
  }

  private async updateOrFail(id: number, data: Prisma.OrganizationUpdateInput): Promise<Organization> {
    try {
      return await this.prisma.organization.update({ where: { id }, data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException(ORGANIZATION_NOT_FOUND);
      }
      throw error;
    }
  }

  /**
   * Reset da senha de um MESTRE pelo super admin: o alvo precisa ser um OrganizationUser ACTIVE, de papel
   * MESTRE, da organização :orgId (e um usuário MEMBER); qualquer outro caso é o MESMO 404 de um id
   * inexistente. Grava o novo hash e REVOGA todas as sessões do usuário (tokenValidAfter). A senha só
   * existe em memória para gerar o hash; nada sensível é devolvido (o controller responde 204).
   * Atenção: a senha é do USUÁRIO — se ele for MESTRE/membro de outros grupos, vale para todos eles.
   */
  async resetMestrePassword(organizationId: number, userId: number, dto: ResetMestrePasswordDto): Promise<void> {
    if (organizationId > MAX_DB_ID || userId > MAX_DB_ID) throw new NotFoundException(MESTRE_NOT_FOUND);
    const target = await this.findActiveMestre(organizationId, userId);
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    // Revalida o alvo junto da escrita: se o vínculo foi desativado/trocado enquanto o bcrypt rodava, 404.
    const { count } = await this.prisma.user.updateMany({
      where: {
        id: target.userId,
        userType: UserType.MEMBER,
        memberships: { some: { organizationId, role: OrgRole.MESTRE, status: 'ACTIVE' } },
      },
      data: { passwordHash, tokenValidAfter: revocationCutoff() },
    });
    if (count !== 1) throw new NotFoundException(MESTRE_NOT_FOUND);
  }

  private async findActiveMestre(organizationId: number, userId: number): Promise<{ userId: number }> {
    const membership = await this.prisma.organizationUser.findFirst({
      where: {
        organizationId,
        userId,
        role: OrgRole.MESTRE,
        status: 'ACTIVE',
        user: { userType: UserType.MEMBER },
      },
      select: { userId: true },
    });
    if (!membership) throw new NotFoundException(MESTRE_NOT_FOUND);
    return membership;
  }

  /**
   * Cria um GRUPO (Organization type GROUP, status ACTIVE) com o seu MESTRE e a unidade MATRIZ, numa
   * ÚNICA transação: Organization + User (MEMBER, e-mail em minúsculas) + OrganizationUser (role MESTRE,
   * ACTIVE) + Unit "Matriz" (isMain, ACTIVE). Qualquer falha desfaz tudo — nunca sobra organização
   * órfã, usuário sem vínculo nem grupo sem matriz.
   *
   * Nada além disso é criado: assinatura/plano NÃO é pré-requisito (StudentsService e UnitsService tratam
   * "sem assinatura em aberto" como "sem limite") — a
   * equipe atribui o plano depois, na tela do grupo (POST /subscriptions). O que o MESTRE precisa
   * para operar é a matriz RolePermission (seed/bootstrap): se ela não existe, falha ANTES de
   * criar qualquer coisa (503), em vez de entregar um grupo cujo MESTRE leva 403 em tudo.
   *
   * A senha só existe em memória para gerar o hash; não é logada nem devolvida.
   */
  async createGroup(dto: CreateOrganizationDto): Promise<CreatedGroup> {
    const email = normalizeEmail(dto.mestre.email);

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
          // Todo grupo nasce com a unidade MATRIZ (o Mestre edita nome/endereço depois em /unidades).
          await tx.unit.create({
            data: { organizationId: organization.id, name: MAIN_UNIT_NAME, isMain: true, status: RecordStatus.ACTIVE },
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
    const [existing] = await findUserIdsByEmail(this.prisma, email, 1);
    if (existing !== undefined) throw new ConflictException(EMAIL_TAKEN);
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
