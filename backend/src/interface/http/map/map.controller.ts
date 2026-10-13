import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, NotFoundException, Post, Query, Res, UseGuards } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { GeocodingService } from '../../../shared/geo/geocoding.service';
import { UserThrottlerGuard } from '../../../shared/guards/user-throttler.guard';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { TOTAL_COUNT_HEADER } from '../../../shared/pagination/pagination';
import { GeocodeDto } from './dto/geocode.dto';
import { MapPlacesQueryDto } from './dto/map-places-query.dto';
import { MapService } from './map.service';

// Geocodificar custa cota do Google: 30/min por usuario (e por IP, no ThrottlerGuard global).
const GEOCODE_THROTTLE = { default: { limit: Number(process.env.GEOCODE_THROTTLE_LIMIT ?? 30), ttl: 60_000 } };

/**
 * Mapa da comunidade (Google Maps no app, app.gingapp.com.br/comunidade). Todas as rotas exigem token
 * (qualquer usuario autenticado; sem @CanAccess). Ver MapService para as regras de visibilidade.
 */
@Controller('map')
export class MapController {
  constructor(
    private readonly mapService: MapService,
    private readonly geocoding: GeocodingService,
  ) {}

  /**
   * Configuracao do mapa para o navegador. `apiKey` = GOOGLE_MAPS_API_KEY (chave de BROWSER, restrita por
   * referrer no Google Cloud — publica por natureza; a chave de servidor NUNCA sai daqui). Sem ela,
   * `enabled: false` e o app mostra uma lista no lugar do mapa. `geocodingEnabled`: ha chave de servidor para o
   * botao "Localizar pelo endereco" do painel (POST /map/geocode).
   */
  @Get('config')
  config(@Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'private, max-age=300');
    const apiKey = (process.env.GOOGLE_MAPS_API_KEY ?? '').trim() || null;
    const mapId = (process.env.GOOGLE_MAPS_MAP_ID ?? '').trim() || null;
    return { enabled: apiKey !== null, apiKey, mapId, geocodingEnabled: this.geocoding.isEnabled() };
  }

  /** Pontos do mapa: { items, total } (o corpo e' um objeto, nao um array — `total` conta antes do `limit`). */
  @Get('places')
  async places(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MapPlacesQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set('Cache-Control', 'private, max-age=30');
    const result = await this.mapService.places(query, user);
    res.setHeader(TOTAL_COUNT_HEADER, String(result.total));
    return result;
  }

  /**
   * Endereco -> coordenadas, para o botao "Localizar pelo endereco" dos formularios do painel. So' MESTRE/PROFESSOR
   * (alunos nao tem formulario de local; protege a cota paga do Google) e equipe PLATFORM. 404 se nao achou ou se
   * nao ha chave de servidor configurada.
   */
  @Post('geocode')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserThrottlerGuard)
  @Throttle(GEOCODE_THROTTLE)
  async geocode(@CurrentUser() user: AuthenticatedUser, @Body() dto: GeocodeDto) {
    const allowed = user.role === OrgRole.MESTRE || user.role === OrgRole.PROFESSOR || user.role === OrgRole.INSTRUTOR || user.userType === 'PLATFORM';
    if (!allowed) throw new ForbiddenException('Sem permissão para geocodificar endereços.');
    if (!this.geocoding.isEnabled()) {
      throw new NotFoundException('Geocodificação indisponível: a chave do Google não está configurada no servidor.');
    }
    const found = await this.geocoding.geocode(dto.query);
    if (!found) throw new NotFoundException('Endereço não encontrado.');
    return found;
  }
}
