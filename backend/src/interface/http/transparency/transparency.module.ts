import { Module } from '@nestjs/common';
import { PlatformFinanceController } from './platform-finance.controller';
import { TransparencyController } from './transparency.controller';
import { TransparencyService } from './transparency.service';

/**
 * Transparencia da plataforma (docs/CONTRATO_TRANSPARENCIA.md, Frente B Fase 1): /platform-finance/* (livro-caixa da
 * equipe PLATFORM; escrita so super admin) e GET /transparency (publico, so meses publicados).
 */
@Module({
  controllers: [PlatformFinanceController, TransparencyController],
  providers: [TransparencyService],
})
export class TransparencyModule {}
