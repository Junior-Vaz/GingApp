import { Controller, Get } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { ClassesService } from './classes.service';

@Controller('classes')
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @Get()
  @CanAccess('classes', 'view')
  findAll(@CurrentOrganization() organizationId: number) {
    return this.classesService.findAll(organizationId);
  }
}
