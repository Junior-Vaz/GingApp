import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { sendPage } from '../../../shared/pagination/pagination';
import { CreatePlatformUserDto } from './dto/create-platform-user.dto';
import { ListPlatformTeamQueryDto } from './dto/list-platform-team-query.dto';
import { ResetPlatformUserPasswordDto } from './dto/reset-platform-user-password.dto';
import { UpdatePlatformUserDto } from './dto/update-platform-user.dto';
import { PlatformTeamService } from './platform-team.service';
import { PlatformUserOnlyGuard } from './platform-user-only.guard';

/** Gestão da equipe interna (usuários userType = PLATFORM). Listar: qualquer PLATFORM.
 * Criar/alterar/revogar/resetar: só super admin (regras no service). */
@Controller('platform-team')
@UseGuards(PlatformUserOnlyGuard)
export class PlatformTeamController {
  constructor(private readonly service: PlatformTeamService) {}

  @Get()
  async findAll(@Query() query: ListPlatformTeamQueryDto, @Res({ passthrough: true }) res: Response) {
    return sendPage(res, await this.service.findAll(query));
  }

  @Post()
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreatePlatformUserDto) {
    return this.service.create(actor, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePlatformUserDto,
  ) {
    return this.service.update(actor, id, dto);
  }

  @Post(':id/revoke-sessions')
  @HttpCode(HttpStatus.OK)
  revokeSessions(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.revokeSessions(actor, id);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetPlatformUserPasswordDto,
  ) {
    return this.service.resetPassword(actor, id, dto);
  }
}
