import { LimitOffsetQueryDto } from '../../../../shared/pagination/pagination';
import { OptionalStudentId } from '../../../../shared/access/linked-student';

/** GET /finance/me: limit/offset + `studentId` opcional (um dos alunos ligados ao usuário). */
export class ListMyFinanceQueryDto extends LimitOffsetQueryDto {
  @OptionalStudentId()
  studentId?: number;
}
