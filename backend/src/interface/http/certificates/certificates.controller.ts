import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CertificatesService } from './certificates.service';
import { CreateCertificateDto } from './dto/create-certificate.dto';
import { UpdateCertificateDto } from './dto/update-certificate.dto';

@Controller('certificates')
export class CertificatesController {
  constructor(private readonly certificatesService: CertificatesService) {}

  @Get()
  @CanAccess('certificates', 'view')
  findAll(@CurrentOrganization() organizationId: number) {
    return this.certificatesService.findAll(organizationId);
  }

  /** Sem @CanAccess: escopado por construção aos alunos do próprio usuário (nunca à
   * organização inteira) — ver CertificatesService.findMine. Precisa vir antes de `:id`. */
  @Get('me')
  findMine(@CurrentOrganization() organizationId: number, @CurrentUser('id') userId: number) {
    return this.certificatesService.findMine(organizationId, userId);
  }

  @Get(':id')
  @CanAccess('certificates', 'view')
  findOne(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.certificatesService.findOne(organizationId, id);
  }

  @Post()
  @CanAccess('certificates', 'create')
  create(@CurrentOrganization() organizationId: number, @Body() dto: CreateCertificateDto) {
    return this.certificatesService.create(organizationId, dto);
  }

  @Patch(':id')
  @CanAccess('certificates', 'edit')
  update(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCertificateDto,
  ) {
    return this.certificatesService.update(organizationId, id, dto);
  }

  @Delete(':id')
  @CanAccess('certificates', 'delete')
  remove(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.certificatesService.remove(organizationId, id);
  }
}
