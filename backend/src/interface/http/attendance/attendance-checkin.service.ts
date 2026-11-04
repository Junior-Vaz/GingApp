import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceSource, Prisma } from '@prisma/client';
import * as QRCode from 'qrcode';
import {
  distanceMeters,
  isAccuracyAcceptable,
  isWithinRadius,
  resolveGeoCheckinLocation,
} from '../../../shared/geo/geo-checkin';
import { GeoCheckinDto } from './dto/geo-checkin.dto';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { buildCheckinToken, peekCheckinToken, verifyCheckinToken } from '../../../shared/checkin/checkin-token';
import { isInsideWindow, lessonCheckinWindow } from '../../../shared/checkin/checkin-window';
import { formatInstantBR } from '../../../shared/dates/format-br';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { frontendBaseUrl } from '../../../shared/mail/mail.config';
import { lessonScopeFilter, ownLessonFilter, UnitScopeService } from '../../../shared/access/unit-scope';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { AttendanceNoticeService } from './attendance-notice.service';
import { RankingService } from '../ranking/ranking.service';
import { StudentsService } from '../students/students.service';
import { EventCheckinSelfDto } from '../events/dto/event-checkin-self.dto';

/**
 * Check-in por QR em aulas: a equipe gera o token da aula (painel, tela cheia), o aluno escaneia/digita no app e
 * a presenca (Attendance.present = true) e gravada para ELE (ou dependente). Regras: token valido para o grupo, aula
 * ativa, dentro da janela (2h antes do inicio ate 2h depois do fim) e aluno matriculado (ClassStudent ACTIVE) na turma
 * da aula. Idempotente. Se o professor ja tinha marcado falta, o check-in a transforma em presenca (o aluno esta na aula).
 * Tambem o check-in por LOCALIZACAO (geoCheckin/geoAvailable), com o mesmo pos-processamento (recordSelfPresence).
 */
@Injectable()
export class AttendanceCheckinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentsService: StudentsService,
    private readonly unitScope: UnitScopeService,
    private readonly notice: AttendanceNoticeService,
    private readonly audit: AuditService,
    private readonly ranking: RankingService,
  ) {}

  async issueToken(organizationId: number, lessonId: number, requester: AuthenticatedUser) {
    const scope = await this.unitScope.resolve(requester, organizationId);
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, organizationId, AND: [lessonScopeFilter(scope), ownLessonFilter(requester)] },
      include: { class: { select: { name: true } } },
    });
    if (!lesson) throw new NotFoundException('Aula não encontrada.');
    const token = buildCheckinToken('L', lesson.id, organizationId);
    const appUrl = frontendBaseUrl('APP');
    const qrDataUrl = await QRCode.toDataURL(appUrl ? `${appUrl}/checkin?token=${token}` : token, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 640,
    });
    const window = lessonCheckinWindow(lesson.date, lesson.startTime, lesson.endTime);
    return {
      kind: 'LESSON' as const,
      id: lesson.id,
      title: lesson.class.name,
      date: lesson.date,
      startTime: lesson.startTime,
      endTime: lesson.endTime,
      token,
      qrDataUrl,
      opensAt: window.opensAt,
      closesAt: window.closesAt,
    };
  }

  async selfCheckin(organizationId: number, requester: AuthenticatedUser, dto: EventCheckinSelfDto, now: Date = new Date()) {
    const peek = peekCheckinToken(dto.token);
    if (!peek || peek.kind !== 'L') throw new BadRequestException('Código de check-in inválido para uma aula.');

    // Aula de outro grupo (ou inexistente) = 404, igual a qualquer outra rota; so depois a assinatura.
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: peek.id, organizationId },
      include: { class: { select: { name: true, status: true } } },
    });
    if (!lesson) throw new NotFoundException('Aula não encontrada.');
    if (!verifyCheckinToken(dto.token, organizationId)) {
      throw new BadRequestException('Código de check-in inválido para esta aula.');
    }
    if (lesson.status !== 'ACTIVE') throw new ConflictException('Esta aula foi cancelada.');

    const outside = outsideWindowMessage(lesson, now);
    if (outside) throw new ConflictException(outside);

    const studentId = await this.resolveCheckinStudent(organizationId, requester, lesson.classId, dto.studentId);
    const { alreadyCheckedIn } = await this.recordSelfPresence(organizationId, lesson, studentId, 'QR', (hadAbsence) => ({
      action: AuditAction.LESSON_CHECKIN_SELF,
      meta: { studentId, classId: lesson.classId, via: 'qr', hadAbsence },
    }));
    return { lessonId: lesson.id, studentId, present: true, alreadyCheckedIn };
  }

  /**
   * Check-in por LOCALIZACAO (docs/CONTRATO_CHECKIN_GEOLOCALIZACAO.md secao 3): mesmas regras do QR (aula ativa, janela,
   * matricula ATIVA do proprio aluno ou dependente ATIVO) + turma com a opcao ligada, local definido (turma, senao
   * unidade), precisao aceitavel e distancia (haversine, arredondada ao metro) <= raio. A ordem dos testes nunca revela
   * distancia a quem nao esta matriculado. PRIVACIDADE: latitude/longitude/accuracyMeters do corpo so existem nesta
   * funcao (em memoria): nada aqui os grava, audita, loga ou repete em erro — so a distancia arredondada sai.
   */
  async geoCheckin(organizationId: number, requester: AuthenticatedUser, dto: GeoCheckinDto, now: Date = new Date()) {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: dto.lessonId, organizationId },
      include: { class: { select: GEO_CLASS_SELECT } },
    });
    if (!lesson) throw new NotFoundException('Aula não encontrada.');
    if (lesson.status !== 'ACTIVE') throw geoError(409, 'LESSON_CANCELLED', 'Esta aula foi cancelada.');
    if (!lesson.class.geoCheckinEnabled) {
      throw geoError(403, 'GEO_CHECKIN_DISABLED', 'O check-in por localização não está ligado nesta turma.');
    }
    const outside = outsideWindowMessage(lesson, now);
    if (outside) throw geoError(409, 'OUTSIDE_WINDOW', outside);

    const studentId = await this.resolveCheckinStudent(organizationId, requester, lesson.classId, dto.studentId);

    const location = resolveGeoCheckinLocation(lesson.class);
    if (!location) {
      throw geoError(409, 'GEO_NO_LOCATION', 'Esta turma ainda não tem o local definido. Avise o professor.');
    }
    const radiusMeters = lesson.class.geoCheckinRadiusMeters;
    if (!isAccuracyAcceptable(dto.accuracyMeters, radiusMeters)) {
      throw geoError(400, 'GEO_ACCURACY_LOW', 'Sinal de GPS fraco. Vá para um lugar aberto e tente de novo.');
    }
    const distance = distanceMeters({ latitude: dto.latitude, longitude: dto.longitude }, location.point);
    if (!isWithinRadius(distance, radiusMeters)) {
      throw geoError(
        403,
        'GEO_TOO_FAR',
        `Você está a ${distance} m do local da aula; chegue a até ${radiusMeters} m.`,
        { distanceMeters: distance, radiusMeters },
      );
    }

    const { alreadyCheckedIn } = await this.recordSelfPresence(organizationId, lesson, studentId, 'GEO', (hadAbsence) => ({
      action: AuditAction.ATTENDANCE_GEO_CHECKIN,
      // SO distancia/raio/ids: nunca coordenadas nem precisao (contrato secao 3, LGPD).
      meta: { studentId, classId: lesson.classId, distanceMeters: distance, radiusMeters, hadAbsence },
    }));
    return { lessonId: lesson.id, studentId, present: true as const, alreadyCheckedIn, distanceMeters: distance };
  }

  /**
   * Opcoes de check-in por localizacao AGORA para o usuario e seus dependentes ATIVOS: aulas ATIVAS de turmas com a opcao
   * ligada e local definido, em que o aluno tem matricula ATIVA, dentro da janela. Nunca devolve coordenadas.
   */
  async geoAvailable(organizationId: number, requester: AuthenticatedUser, now: Date = new Date()): Promise<GeoCheckinOption[]> {
    const myStudents = (await this.studentsService.findMine(organizationId, requester.id)).filter((s) => s.status === 'ACTIVE');
    if (myStudents.length === 0) return [];
    const enrollments = await this.prisma.classStudent.findMany({
      where: { organizationId, status: 'ACTIVE', studentId: { in: myStudents.map((s) => s.id) }, class: { geoCheckinEnabled: true } },
      select: { classId: true, studentId: true },
    });
    if (enrollments.length === 0) return [];

    // A janela de uma aula cabe em ~30 h a partir da meia-noite do dia civil: +-2 dias pega todas as candidatas.
    const lessons = await this.prisma.lesson.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        classId: { in: [...new Set(enrollments.map((e) => e.classId))] },
        date: { gte: new Date(now.getTime() - 2 * DAY_MS), lte: new Date(now.getTime() + 2 * DAY_MS) },
      },
      include: { class: { select: GEO_CLASS_SELECT } },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });
    const open = lessons
      .map((lesson) => ({ lesson, window: lessonCheckinWindow(lesson.date, lesson.startTime, lesson.endTime) }))
      .filter(({ lesson, window }) => isInsideWindow(window, now) && resolveGeoCheckinLocation(lesson.class) !== null);
    if (open.length === 0) return [];

    const present = await this.prisma.attendance.findMany({
      where: {
        organizationId,
        present: true,
        lessonId: { in: open.map((o) => o.lesson.id) },
        studentId: { in: myStudents.map((s) => s.id) },
      },
      select: { lessonId: true, studentId: true },
    });
    const presentKeys = new Set(present.map((p) => `${p.lessonId}:${p.studentId}`));
    const nameOf = new Map(myStudents.map((s) => [s.id, s.name]));

    return open
      .flatMap(({ lesson, window }) =>
        enrollments
          .filter((e) => e.classId === lesson.classId)
          .map(
            (e): GeoCheckinOption => ({
              lessonId: lesson.id,
              studentId: e.studentId,
              studentName: nameOf.get(e.studentId) ?? '',
              className: lesson.class.name,
              date: lesson.date.toISOString(),
              startTime: lesson.startTime,
              endTime: lesson.endTime,
              opensAt: window.opensAt.toISOString(),
              closesAt: window.closesAt.toISOString(),
              radiusMeters: lesson.class.geoCheckinRadiusMeters,
              alreadyCheckedIn: presentKeys.has(`${lesson.id}:${e.studentId}`),
            }),
          ),
      )
      .sort((a, b) => a.opensAt.localeCompare(b.opensAt) || a.lessonId - b.lessonId || a.studentName.localeCompare(b.studentName));
  }

  /**
   * Qual aluno faz o check-in (SSOT do QR e do GEO): o proprio ou um dependente ATIVO do usuario, com matricula ATIVA na
   * turma da aula. 403 se o studentId nao e dele ou ninguem dele esta matriculado; 400 se mais de um e sem studentId.
   */
  private async resolveCheckinStudent(
    organizationId: number,
    requester: AuthenticatedUser,
    classId: number,
    requestedStudentId: number | undefined,
  ): Promise<number> {
    const myStudents = (await this.studentsService.findMine(organizationId, requester.id)).filter(
      (s) => s.status === 'ACTIVE',
    );
    if (requestedStudentId !== undefined && !myStudents.some((s) => s.id === requestedStudentId)) {
      throw new ForbiddenException('Você só pode fazer check-in de si mesmo ou dos seus dependentes.');
    }
    const enrollments = await this.prisma.classStudent.findMany({
      where: {
        organizationId,
        classId,
        status: 'ACTIVE',
        studentId: {
          in: (requestedStudentId !== undefined ? myStudents.filter((s) => s.id === requestedStudentId) : myStudents).map(
            (s) => s.id,
          ),
        },
      },
      orderBy: { studentId: 'asc' },
    });
    if (enrollments.length === 0) {
      throw new ForbiddenException('Você não está matriculado na turma desta aula.');
    }
    if (enrollments.length > 1 && requestedStudentId === undefined) {
      throw new BadRequestException('Mais de um aluno seu está nesta turma: informe studentId.');
    }
    return enrollments[0].studentId;
  }

  /**
   * Pos-processamento COMUM do check-in do proprio aluno (QR e GEO; contrato secao 3): idempotente (ja presente = nada
   * muda, nem a origem); senao grava a presenca com a origem (`checkinSource`), converte uma falta em presenca (limpa a
   * justificativa), agenda o Ginga Rank, audita (acao/meta do chamador) e dispara o aviso "Presença registrada".
   */
  private async recordSelfPresence(
    organizationId: number,
    lesson: { id: number; classId: number },
    studentId: number,
    source: AttendanceSource,
    auditFor: (hadAbsence: boolean) => { action: string; meta: Record<string, unknown> },
  ): Promise<{ alreadyCheckedIn: boolean }> {
    const existing = await this.prisma.attendance.findUnique({
      where: { lessonId_studentId: { lessonId: lesson.id, studentId } },
    });
    if (existing?.present) return { alreadyCheckedIn: true };
    await this.prisma.attendance.upsert({
      where: { lessonId_studentId: { lessonId: lesson.id, studentId } },
      create: { organizationId, lessonId: lesson.id, studentId, present: true, checkinSource: source },
      update: { present: true, justification: null, checkinSource: source },
    });
    this.ranking.queueSync(studentId); // Ginga Rank (fire-and-forget)
    const { action, meta } = auditFor(existing ? true : false);
    await this.audit.record({ organizationId, action, entity: AuditEntity.LESSON, entityId: lesson.id, meta });
    // Mesmo aviso da chamada ("Presença registrada", idempotente por aula/aluno, desligável pelo grupo); nunca lança.
    await this.notice.notifyPresent(organizationId, lesson.id, [studentId]);
    return { alreadyCheckedIn: false };
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Turma da aula como o check-in por localizacao precisa: opcao, raio e local (proprio + o da unidade). So no servidor. */
const GEO_CLASS_SELECT = {
  name: true,
  latitude: true,
  longitude: true,
  geoCheckinEnabled: true,
  geoCheckinRadiusMeters: true,
  unit: { select: { latitude: true, longitude: true } },
} satisfies Prisma.ClassSelect;

/** GET /attendance/geo-checkin/available (contrato secao 3). Sem coordenadas. */
export interface GeoCheckinOption {
  lessonId: number;
  studentId: number;
  studentName: string;
  className: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  opensAt: string;
  closesAt: string;
  radiusMeters: number;
  alreadyCheckedIn: boolean;
}

/** Mensagem do 409 de fora da janela (a MESMA do QR), ou null dentro da janela. */
function outsideWindowMessage(
  lesson: { date: Date; startTime: string | null; endTime: string | null },
  now: Date,
): string | null {
  const window = lessonCheckinWindow(lesson.date, lesson.startTime, lesson.endTime);
  if (isInsideWindow(window, now)) return null;
  return now < window.opensAt
    ? `O check-in desta aula abre em ${formatInstantBR(window.opensAt)}.`
    : `O check-in desta aula encerrou em ${formatInstantBR(window.closesAt)}.`;
}

const GEO_ERRORS = {
  400: [BadRequestException, 'Bad Request'],
  403: [ForbiddenException, 'Forbidden'],
  409: [ConflictException, 'Conflict'],
} as const;

/** Erro do check-in por localizacao com `code` estavel (formato padrao do Nest + code + campos extras). */
function geoError(status: keyof typeof GEO_ERRORS, code: string, message: string, extra: Record<string, unknown> = {}): HttpException {
  const [Exception, error] = GEO_ERRORS[status];
  return new Exception({ statusCode: status, error, code, message, ...extra });
}
