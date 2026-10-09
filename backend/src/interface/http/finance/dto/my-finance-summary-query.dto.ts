import { OptionalStudentId } from '../../../../shared/access/linked-student';

/** GET /finance/me/summary: `studentId` opcional — MESMO escopo da lista (GET /finance/me). */
export class MyFinanceSummaryQueryDto {
  @OptionalStudentId()
  studentId?: number;
}
