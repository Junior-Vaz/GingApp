import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { CreateRodaDto } from './dto/create-roda.dto';
import { UpdateRodaDto } from './dto/update-roda.dto';

/**
 * Rodas pertencem ao domínio "Comunidade" (PLANO_PROJETO.md §2.3): dados públicos, listados
 * sem autenticação e sem isolamento multi-tenant no findAll/findOne — nenhum dado privado do
 * grupo é exposto nesta entidade.
 *
 * `organizationId` (adicionado em §10.7 do plano, gap do schema original) identifica quem
 * organiza a roda, só para restringir create/update/delete a quem criou — nunca usado para
 * filtrar a listagem pública.
 */
@Injectable()
export class RodasService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.roda.findMany({
      orderBy: { date: 'asc' },
      take: 50,
    });
  }

  /** Dados públicos de referência (não há endpoint dedicado de State/City ainda) — usados
   * para popular os selects de estado/cidade no formulário de criar/editar roda. */
  listStates() {
    return this.prisma.state.findMany({ orderBy: { name: 'asc' } });
  }

  listCities(stateId?: number) {
    return this.prisma.city.findMany({
      where: stateId ? { stateId } : undefined,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    const roda = await this.prisma.roda.findUnique({ where: { id } });
    if (!roda) {
      throw new NotFoundException('Roda não encontrada.');
    }
    return roda;
  }

  /** Só para uso interno (update/remove): garante que a roda pertence à organização do token. */
  private async findOwned(organizationId: number, id: number) {
    const roda = await this.prisma.roda.findFirst({ where: { id, organizationId } });
    if (!roda) {
      throw new NotFoundException('Roda não encontrada ou não organizada por esta organização.');
    }
    return roda;
  }

  async create(organizationId: number, dto: CreateRodaDto) {
    await this.assertReferencesExist(dto);

    return this.prisma.roda.create({
      data: {
        organizationId,
        title: dto.title,
        description: dto.description,
        date: new Date(dto.date),
        location: dto.location,
        stateId: dto.stateId,
        cityId: dto.cityId,
        communityId: dto.communityId,
      },
    });
  }

  async update(organizationId: number, id: number, dto: UpdateRodaDto) {
    await this.findOwned(organizationId, id);
    await this.assertReferencesExist(dto);

    return this.prisma.roda.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        date: dto.date ? new Date(dto.date) : undefined,
        location: dto.location,
        stateId: dto.stateId,
        cityId: dto.cityId,
        communityId: dto.communityId,
      },
    });
  }

  /** Apaga de verdade (não há conceito de "roda inativa" no domínio) — remove os participantes
   * primeiro numa transação para não violar a FK. */
  async remove(organizationId: number, id: number) {
    await this.findOwned(organizationId, id);

    await this.prisma.$transaction([
      this.prisma.rodaParticipant.deleteMany({ where: { rodaId: id } }),
      this.prisma.roda.delete({ where: { id } }),
    ]);

    return { success: true };
  }

  /** State/City/Community são dados públicos (não pertencem a nenhuma organização) — aqui só
   * confirmamos que o id informado existe de verdade, não uma checagem de tenant. */
  private async assertReferencesExist(dto: Pick<CreateRodaDto, 'stateId' | 'cityId' | 'communityId'>): Promise<void> {
    if (dto.stateId !== undefined) {
      const state = await this.prisma.state.findUnique({ where: { id: dto.stateId } });
      if (!state) throw new BadRequestException('Estado inválido.');
    }
    if (dto.cityId !== undefined) {
      const city = await this.prisma.city.findUnique({ where: { id: dto.cityId } });
      if (!city) throw new BadRequestException('Cidade inválida.');
    }
    if (dto.communityId !== undefined) {
      const community = await this.prisma.community.findUnique({ where: { id: dto.communityId } });
      if (!community) throw new BadRequestException('Comunidade inválida.');
    }
  }
}
