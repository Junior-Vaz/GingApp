import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../shared/decorators/public.decorator';
import { ApproveByLinkDto } from './dto/transfers.dto';
import { TransfersService } from './transfers.service';

// Link publico = alvo de adivinhacao de token e de criacao de login: limites FORTES por IP (leitura 30/min, decisao 5/min).
// Configuraveis por env so para os e2e.
const READ_THROTTLE = { default: { limit: Number(process.env.TRANSFER_APPROVAL_READ_THROTTLE_LIMIT ?? 30), ttl: 60_000 } };
const WRITE_THROTTLE = { default: { limit: Number(process.env.TRANSFER_APPROVAL_WRITE_THROTTLE_LIMIT ?? 5), ttl: 60_000 } };

/**
 * Convite guiado: adulto SEM login aprova/recusa a transferencia por um link de uso unico (docs/FICHA_UNICA.md secao 12).
 * Sem autenticacao, de proposito. Link invalido/usado/expirado = sempre o mesmo 404; menor de idade nao aprova por aqui.
 */
@Controller('public/transfer-approval')
export class PublicTransferApprovalController {
  constructor(private readonly transfers: TransfersService) {}

  @Public()
  @Throttle(READ_THROTTLE)
  @Get(':token')
  summary(@Param('token') token: string) {
    return this.transfers.approvalSummary(token);
  }

  @Public()
  @Throttle(WRITE_THROTTLE)
  @Post(':token/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('token') token: string, @Body() dto: ApproveByLinkDto) {
    return this.transfers.approveByLink(token, dto);
  }

  @Public()
  @Throttle(WRITE_THROTTLE)
  @Post(':token/decline')
  @HttpCode(HttpStatus.OK)
  decline(@Param('token') token: string) {
    return this.transfers.declineByLink(token);
  }
}
