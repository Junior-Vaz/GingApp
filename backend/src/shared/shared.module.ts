import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

/**
 * Módulo global (padrão GestorPrint): disponibiliza o PrismaService para todos os módulos
 * de domínio sem precisar reimportar em cada um. Guards/decorators desse diretório não
 * precisam ser providers aqui — são registrados onde são usados (AppModule para o guard
 * global, cada controller para os decorators de parâmetro).
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class SharedModule {}
