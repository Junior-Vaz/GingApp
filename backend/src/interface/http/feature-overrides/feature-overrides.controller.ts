import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { PlatformOnlyGuard } from '../../../shared/guards/platform-only.guard';
import { FeatureOverridesService } from './feature-overrides.service';
import { CreateFeatureOverrideDto } from './dto/create-feature-override.dto';
import { UpdateFeatureOverrideDto } from './dto/update-feature-override.dto';

/** Aninhado em /organizations/:organizationId/feature-overrides — diferente do resto do
 * projeto (recursos member-scoped tiram organizationId do JWT via @CurrentOrganization), este
 * é PLATFORM-only e precisa operar sobre a organização de QUALQUER grupo, escolhida pelo admin
 * na tela, daí vir da URL em vez do token. */
@Controller('organizations/:organizationId/feature-overrides')
@UseGuards(PlatformOnlyGuard)
export class FeatureOverridesController {
  constructor(
    private readonly featureOverridesService: FeatureOverridesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async findAll(@Param('organizationId', ParseIntPipe) organizationId: number) {
    await this.assertOrganizationExists(organizationId);
    return this.featureOverridesService.findAll(organizationId);
  }

  @Post()
  async create(
    @Param('organizationId', ParseIntPipe) organizationId: number,
    @Body() dto: CreateFeatureOverrideDto,
  ) {
    await this.assertOrganizationExists(organizationId);
    return this.featureOverridesService.create(organizationId, dto);
  }

  @Patch(':id')
  update(
    @Param('organizationId', ParseIntPipe) organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFeatureOverrideDto,
  ) {
    return this.featureOverridesService.update(organizationId, id, dto);
  }

  @Delete(':id')
  remove(@Param('organizationId', ParseIntPipe) organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.featureOverridesService.remove(organizationId, id);
  }

  private async assertOrganizationExists(organizationId: number): Promise<void> {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) {
      throw new NotFoundException('Organização não encontrada.');
    }
  }
}
