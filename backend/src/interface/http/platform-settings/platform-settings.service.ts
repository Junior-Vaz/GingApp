import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PlatformSetting } from '@prisma/client';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { ListPlatformSettingsQueryDto } from './dto/list-platform-settings-query.dto';
import { UpsertPlatformSettingDto } from './dto/upsert-platform-setting.dto';

export const SETTING_KEY_PATTERN = /^[a-z0-9_.-]{1,100}$/;
export const MAX_SETTING_VALUE_BYTES = 10 * 1024;

export interface PlatformSettingView {
  id: number;
  key: string;
  /** null quando isSecret = true (o valor secreto NUNCA sai da API, nem para a equipe PLATFORM). */
  value: Prisma.JsonValue | null;
  isSecret: boolean;
  /** Sempre true hoje (value é obrigatório): sinaliza que há valor mesmo quando mascarado. */
  hasValue: boolean;
  updatedByUserId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Configurações globais da plataforma (model PlatformSetting: key única, value Json, isSecret).
 *
 * ATENÇÃO — NADA NO SISTEMA LÊ ESTAS CONFIGURAÇÕES AINDA (auditado: nenhum código de negócio consulta
 * PlatformSetting; o e-mail transacional lê SMTP_* do ambiente): este módulo é só o cadastro/edição
 * (CRUD) para a tela do admin. Nenhum outro módulo (billing, auth, notificações...) consome
 * PlatformSetting; quem for usar uma chave deve lê-la direto do banco/service no momento em que
 * for implementado. Não foi inventado nenhum consumidor nem nenhuma lista de chaves "oficiais".
 *
 * Segredos: com isSecret = true o value é gravado, mas as respostas (lista, GET /:key, PUT)
 * devolvem value = null + hasValue = true — não existe endpoint para ler um segredo de volta.
 * O value nunca é escrito em log por este módulo.
 */
@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: ListPlatformSettingsQueryDto = {}): Promise<Page<PlatformSettingView>> {
    const where: Prisma.PlatformSettingWhereInput = {};
    const q = query.q?.trim();
    if (q) where.key = { contains: q, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      this.prisma.platformSetting.findMany({ where, orderBy: { key: 'asc' }, ...pageArgs(query) }),
      this.prisma.platformSetting.count({ where }),
    ]);
    return { items: items.map(toView), total };
  }

  async findOne(key: string): Promise<PlatformSettingView> {
    assertValidKey(key);
    const setting = await this.prisma.platformSetting.findUnique({ where: { key } });
    if (!setting) throw new NotFoundException('Configuração não encontrada.');
    return toView(setting);
  }

  async upsert(key: string, dto: UpsertPlatformSettingDto, updatedByUserId: number): Promise<PlatformSettingView> {
    assertValidKey(key);
    assertValidValue(dto.value);
    const value = dto.value as Prisma.InputJsonValue;

    const setting = await this.prisma.platformSetting.upsert({
      where: { key },
      create: { key, value, isSecret: dto.isSecret ?? false, updatedByUserId },
      update: { value, isSecret: dto.isSecret, updatedByUserId },
    });
    // So a CHAVE e se e segredo: o valor (que pode ser segredo) nunca vai para a trilha.
    await this.audit.record({
      organizationId: null,
      action: AuditAction.PLATFORM_SETTING_SET,
      entity: AuditEntity.PLATFORM_SETTING,
      entityId: key,
      meta: { isSecret: setting.isSecret },
    });
    return toView(setting);
  }

  async remove(key: string): Promise<{ key: string; deleted: true }> {
    assertValidKey(key);
    const { count } = await this.prisma.platformSetting.deleteMany({ where: { key } });
    if (count === 0) throw new NotFoundException('Configuração não encontrada.');
    await this.audit.record({
      organizationId: null,
      action: AuditAction.PLATFORM_SETTING_DELETE,
      entity: AuditEntity.PLATFORM_SETTING,
      entityId: key,
    });
    return { key, deleted: true };
  }
}

function assertValidKey(key: string): void {
  if (!SETTING_KEY_PATTERN.test(key)) {
    throw new BadRequestException('Chave inválida: use de 1 a 100 caracteres entre a-z, 0-9, "_", "." e "-".');
  }
}

function assertValidValue(value: unknown): void {
  if (value === undefined || value === null) {
    throw new BadRequestException('value é obrigatório (qualquer JSON, exceto null).');
  }
  const size = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (size > MAX_SETTING_VALUE_BYTES) {
    throw new BadRequestException(`value excede o limite de ${MAX_SETTING_VALUE_BYTES} bytes (JSON serializado).`);
  }
}

function toView(setting: PlatformSetting): PlatformSettingView {
  return {
    id: setting.id,
    key: setting.key,
    value: setting.isSecret ? null : setting.value,
    isSecret: setting.isSecret,
    hasValue: true,
    updatedByUserId: setting.updatedByUserId,
    createdAt: setting.createdAt,
    updatedAt: setting.updatedAt,
  };
}
