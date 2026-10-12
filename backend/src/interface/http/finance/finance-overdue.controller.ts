import { Controller, Post } from '@nestjs/common';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { RequireFeature } from '../../../shared/decorators/require-feature.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { FinanceOverdueService } from './finance-overdue.service';

@RequireFeature('finance')
@Controller('finance')
export class FinanceOverdueController {
  constructor(private readonly overdue: FinanceOverdueService) {}

  /** Grava OVERDUE nos lançamentos PENDING vencidos da organização e avisa aluno/responsáveis (idempotente). */
  @Post('mark-overdue')
  @CanAccess('finance', 'edit')
  markOverdue(@CurrentOrganization() organizationId: number) {
    return this.overdue.markOverdueAndNotify(organizationId);
  }
}
