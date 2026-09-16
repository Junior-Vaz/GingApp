import { Controller, Get } from '@nestjs/common';
import { Public } from '../../../shared/decorators/public.decorator';
import { RodasService } from './rodas.service';

@Controller('rodas')
export class RodasController {
  constructor(private readonly rodasService: RodasService) {}

  @Public()
  @Get()
  findAll() {
    return this.rodasService.findAll();
  }
}
