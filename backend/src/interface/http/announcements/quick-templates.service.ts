import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { CreateQuickTemplateDto, QUICK_TEMPLATE_LIMIT, UpdateQuickTemplateDto } from './dto/quick-template.dto';

export const QUICK_TEMPLATE_LIMIT_CODE = 'QUICK_TEMPLATE_LIMIT';
export const BUILTIN_TEMPLATE_CODE = 'BUILTIN_TEMPLATE';
export const BUILTIN_ID_PREFIX = 'builtin:';

/** Item da listagem: `id` é número (modelo do grupo) ou "builtin:<chave>" (padrão do sistema, somente leitura). */
export interface QuickTemplateView {
  id: number | string;
  title: string;
  body: string;
  emoji: string | null;
  sortOrder: number;
  builtin: boolean;
}

/**
 * Modelos PADRÃO do sistema: não ficam no banco (valem para todo grupo, sem migration por texto novo). Sem variáveis
 * ({turma}/{grupo}): o envio (QuickSendService) não faz substituição — o texto sai exatamente como está.
 * Cabem nos limites do envio (título <= 80, mensagem <= 280). Não editáveis/apagáveis; o MESTRE "duplica" criando o dele.
 */
export const BUILTIN_QUICK_TEMPLATES: ReadonlyArray<Omit<QuickTemplateView, 'builtin' | 'sortOrder'> & { id: string }> = [
  { id: 'builtin:training-confirmed', emoji: '🥋', title: 'Treino de hoje confirmado', body: 'O treino de hoje está confirmado no horário de sempre. Traga sua água e seu uniforme. Oss!' },
  { id: 'builtin:rain-cancelled', emoji: '🌧️', title: 'Treino cancelado por chuva', body: 'Por causa da chuva, o treino de hoje está cancelado. Avisaremos quando for reposto. Cuidem-se!' },
  { id: 'builtin:starts-in-30', emoji: '⏰', title: 'Treino começa em 30 min', body: 'Lembrete: o treino começa em 30 minutos. Vá se preparando para chegar no horário!' },
  { id: 'builtin:meeting-after', emoji: '📢', title: 'Reunião hoje depois do treino', body: 'Teremos uma reunião rápida hoje, logo depois do treino. Fique um pouquinho, é importante!' },
  { id: 'builtin:open-roda', emoji: '🎉', title: 'Roda aberta neste fim de semana', body: 'Neste fim de semana teremos roda aberta! Venha jogar, cantar e trazer a família e os amigos.' },
  { id: 'builtin:fee-reminder', emoji: '💳', title: 'Lembrete de mensalidade', body: 'Lembrete: a mensalidade vence em breve. Se já pagou, desconsidere este aviso. Obrigado!' },
];

/**
 * Modelos de aviso rápido (FAB do painel): GET lista os do grupo + os padrão; POST/PATCH/DELETE só MESTRE (o controller
 * exige `announcements:delete`). Sempre escopado por organizationId — modelo de outro grupo é 404.
 * Auditoria: id e tamanhos, nunca o texto do modelo.
 */
@Injectable()
export class QuickTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Modelos do grupo (por ordem) primeiro, depois os padrão. */
  async list(organizationId: number): Promise<QuickTemplateView[]> {
    const own = await this.prisma.quickNoticeTemplate.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const mine: QuickTemplateView[] = own.map((t) => ({
      id: t.id,
      title: t.title,
      body: t.body,
      emoji: t.emoji,
      sortOrder: t.sortOrder,
      builtin: false,
    }));
    const builtins: QuickTemplateView[] = BUILTIN_QUICK_TEMPLATES.map((t, index) => ({ ...t, sortOrder: index, builtin: true }));
    return [...mine, ...builtins];
  }

  async create(organizationId: number, userId: number, dto: CreateQuickTemplateDto): Promise<QuickTemplateView> {
    const count = await this.prisma.quickNoticeTemplate.count({ where: { organizationId } });
    if (count >= QUICK_TEMPLATE_LIMIT) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: QUICK_TEMPLATE_LIMIT_CODE,
        message: `Limite de ${QUICK_TEMPLATE_LIMIT} modelos por grupo. Apague algum para criar outro.`,
      });
    }
    let sortOrder = dto.sortOrder;
    if (sortOrder === undefined) {
      const last = await this.prisma.quickNoticeTemplate.aggregate({ where: { organizationId }, _max: { sortOrder: true } });
      sortOrder = Math.min((last._max.sortOrder ?? -1) + 1, 9999);
    }
    const created = await this.prisma.quickNoticeTemplate.create({
      data: { organizationId, title: dto.title, body: dto.body, emoji: dto.emoji ?? null, sortOrder, createdById: userId },
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.QUICK_NOTICE_TEMPLATE_CREATE,
      entity: AuditEntity.QUICK_NOTICE_TEMPLATE,
      entityId: created.id,
      meta: { titleLength: created.title.length, bodyLength: created.body.length, sortOrder },
    });
    return this.toView(created);
  }

  async update(organizationId: number, rawId: string, dto: UpdateQuickTemplateDto): Promise<QuickTemplateView> {
    const id = this.ownId(rawId);
    await this.getOwned(organizationId, id);
    const updated = await this.prisma.quickNoticeTemplate.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.emoji !== undefined ? { emoji: dto.emoji } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.QUICK_NOTICE_TEMPLATE_UPDATE,
      entity: AuditEntity.QUICK_NOTICE_TEMPLATE,
      entityId: id,
      meta: { fields: Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined) },
    });
    return this.toView(updated);
  }

  async remove(organizationId: number, rawId: string): Promise<{ id: number }> {
    const id = this.ownId(rawId);
    await this.getOwned(organizationId, id);
    await this.prisma.quickNoticeTemplate.delete({ where: { id } });
    await this.audit.record({
      organizationId,
      action: AuditAction.QUICK_NOTICE_TEMPLATE_DELETE,
      entity: AuditEntity.QUICK_NOTICE_TEMPLATE,
      entityId: id,
    });
    return { id };
  }

  /** "builtin:*" => 400 (somente leitura); id não numérico => 404; senão o inteiro. */
  private ownId(rawId: string): number {
    if (rawId.startsWith(BUILTIN_ID_PREFIX)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: BUILTIN_TEMPLATE_CODE,
        message: 'Os modelos padrão do sistema não podem ser alterados nem apagados. Crie uma cópia como modelo do grupo.',
      });
    }
    if (!/^\d{1,9}$/.test(rawId)) throw new NotFoundException('Modelo não encontrado.');
    return Number(rawId);
  }

  private async getOwned(organizationId: number, id: number) {
    const found = await this.prisma.quickNoticeTemplate.findFirst({ where: { id, organizationId } });
    if (!found) throw new NotFoundException('Modelo não encontrado.');
    return found;
  }

  private toView(t: { id: number; title: string; body: string; emoji: string | null; sortOrder: number }): QuickTemplateView {
    return { id: t.id, title: t.title, body: t.body, emoji: t.emoji, sortOrder: t.sortOrder, builtin: false };
  }
}
