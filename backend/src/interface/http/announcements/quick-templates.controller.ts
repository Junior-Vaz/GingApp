import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { CreateQuickTemplateDto, UpdateQuickTemplateDto } from './dto/quick-template.dto';
import { QuickTemplatesService } from './quick-templates.service';

/**
 * Modelos de aviso rápido (botão flutuante do painel), na rota /notifications/quick-templates.
 * Listar = quem envia aviso rápido (`announcements:create`: MESTRE/PROFESSOR/INSTRUTOR; MONITOR/ALUNO/RESPONSAVEL = 403).
 * Escrever = só MESTRE: a matriz RolePermission só dá `announcements:delete` ao MESTRE, e esse é o "gerenciar avisos".
 */
@Controller('notifications/quick-templates')
export class QuickTemplatesController {
  constructor(private readonly templates: QuickTemplatesService) {}

  @Get()
  @CanAccess('announcements', 'create')
  list(@CurrentOrganization() organizationId: number) {
    return this.templates.list(organizationId);
  }

  @Post()
  @CanAccess('announcements', 'delete')
  create(@CurrentOrganization() organizationId: number, @CurrentUser('id') userId: number, @Body() dto: CreateQuickTemplateDto) {
    return this.templates.create(organizationId, userId, dto);
  }

  @Patch(':id')
  @CanAccess('announcements', 'delete')
  update(@CurrentOrganization() organizationId: number, @Param('id') id: string, @Body() dto: UpdateQuickTemplateDto) {
    return this.templates.update(organizationId, id, dto);
  }

  @Delete(':id')
  @CanAccess('announcements', 'delete')
  remove(@CurrentOrganization() organizationId: number, @Param('id') id: string) {
    return this.templates.remove(organizationId, id);
  }
}
