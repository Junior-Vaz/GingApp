import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import { Public } from '../../../shared/decorators/public.decorator';
import { getLegalDocument, LEGAL_UPDATED_AT, LEGAL_VERSION } from '../../../shared/legal/legal-documents';
import { LegalDocument } from '../../../shared/legal/legal-types';

/**
 * Textos legais publicos (E10): sem login, para as paginas /termos e /privacidade e para a tela de
 * aceite dos 3 frontends. O conteudo e versionado no repositorio (shared/legal).
 */
@Public()
@Controller('legal')
export class LegalController {
  /** Versao vigente + indice dos documentos. */
  @Get()
  index(): { version: string; updatedAt: string; documents: { type: string; path: string }[] } {
    return {
      version: LEGAL_VERSION,
      updatedAt: LEGAL_UPDATED_AT,
      documents: [
        { type: 'terms', path: '/legal/terms' },
        { type: 'privacy', path: '/legal/privacy' },
      ],
    };
  }

  @Header('Cache-Control', 'public, max-age=300')
  @Get('terms')
  terms(): LegalDocument {
    return getLegalDocument('terms');
  }

  @Header('Cache-Control', 'public, max-age=300')
  @Get('privacy')
  privacy(): LegalDocument {
    return getLegalDocument('privacy');
  }

  /** Qualquer outro nome (ex.: /legal/cookies) e 404 explicito, nunca um documento vazio. */
  @Get(':type')
  other(@Param('type') _type: string): never {
    throw new NotFoundException('Documento não encontrado.');
  }
}
