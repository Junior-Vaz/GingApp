import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sendPage } from '../../../shared/pagination/pagination';
import { ListCertificatesQueryDto } from './dto/list-certificates-query.dto';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { CertificatesService } from './certificates.service';
import { CreateCertificateDto } from './dto/create-certificate.dto';
import { UpdateCertificateDto } from './dto/update-certificate.dto';

@Controller('certificates')
export class CertificatesController {
  constructor(private readonly certificatesService: CertificatesService) {}

  @Get()
  @CanAccess('certificates', 'view')
  async findAll(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCertificatesQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.certificatesService.findAll(organizationId, query, user));
  }

  /** Sem @CanAccess: escopado por construção aos alunos do próprio usuário (nunca à
   * organização inteira) — ver CertificatesService.findMine. Precisa vir antes de `:id`. */
  @Get('me')
  findMine(@CurrentOrganization() organizationId: number, @CurrentUser('id') userId: number) {
    return this.certificatesService.findMine(organizationId, userId);
  }

  @Get(':id')
  @CanAccess('certificates', 'view')
  findOne(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.certificatesService.findOne(organizationId, id, user);
  }

  @Post()
  @CanAccess('certificates', 'create')
  create(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCertificateDto,
  ) {
    return this.certificatesService.create(organizationId, dto, user);
  }

  @Patch(':id')
  @CanAccess('certificates', 'edit')
  update(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCertificateDto,
  ) {
    return this.certificatesService.update(organizationId, id, dto, user);
  }

  @Delete(':id')
  @CanAccess('certificates', 'delete')
  remove(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.certificatesService.remove(organizationId, id, user);
  }
}
