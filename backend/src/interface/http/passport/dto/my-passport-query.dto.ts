import { OptionalStudentId } from '../../../../shared/access/linked-student';

/** GET /passport/me?studentId= — escolhe qual dos alunos ligados ao usuário (próprio/dependentes). */
export class MyPassportQueryDto {
  @OptionalStudentId()
  studentId?: number;
}
