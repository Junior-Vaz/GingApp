import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { auditContextMiddleware } from './shared/audit/audit-context';
import { requestLogMiddleware } from './shared/observability/request-log.middleware';
import { AuditModule } from './interface/http/audit/audit.module';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { PrismaRangeFilter } from './shared/filters/prisma-range.filter';
import { ThrottlerGuard, ThrottlerModule, seconds } from '@nestjs/throttler';
import { SharedModule } from './shared/shared.module';
import { JwtAuthGuard } from './shared/guards/jwt-auth.guard';
import { CanAccessGuard } from './shared/guards/can-access.guard';
import { FeatureGuard } from './shared/guards/feature.guard';

import { AuthModule } from './interface/http/auth/auth.module';
import { HealthModule } from './interface/http/health/health.module';
import { OrganizationsModule } from './interface/http/organizations/organizations.module';
import { DashboardModule } from './interface/http/dashboard/dashboard.module';
import { ReportsModule } from './interface/http/reports/reports.module';
import { UnitsModule } from './interface/http/units/units.module';
import { StudentsModule } from './interface/http/students/students.module';
import { TeachersModule } from './interface/http/teachers/teachers.module';
import { ClassesModule } from './interface/http/classes/classes.module';
import { LessonsModule } from './interface/http/lessons/lessons.module';
import { AttendanceModule } from './interface/http/attendance/attendance.module';
import { GraduationsModule } from './interface/http/graduations/graduations.module';
import { FinanceModule } from './interface/http/finance/finance.module';
import { EventsModule } from './interface/http/events/events.module';
import { RodasModule } from './interface/http/rodas/rodas.module';
import { AnnouncementsModule } from './interface/http/announcements/announcements.module';
import { NotificationsModule } from './interface/http/notifications/notifications.module';
import { PlansModule } from './interface/http/plans/plans.module';
import { SubscriptionsModule } from './interface/http/subscriptions/subscriptions.module';
import { FeatureOverridesModule } from './interface/http/feature-overrides/feature-overrides.module';
import { PlatformAnnouncementsModule } from './interface/http/platform-announcements/platform-announcements.module';
import { CertificatesModule } from './interface/http/certificates/certificates.module';
import { PassportModule } from './interface/http/passport/passport.module';
import { CalendarModule } from './interface/http/calendar/calendar.module';
import { PlatformDashboardModule } from './interface/http/platform-dashboard/platform-dashboard.module';
import { PlatformSettingsModule } from './interface/http/platform-settings/platform-settings.module';
import { PlatformTeamModule } from './interface/http/platform-team/platform-team.module';
import { LegalModule } from './interface/http/legal/legal.module';
import { UploadsModule } from './interface/http/uploads/uploads.module';
import { MapModule } from './interface/http/map/map.module';
import { PushModule } from './interface/http/push/push.module';
import { ScheduleModule } from '@nestjs/schedule';
import { JobsModule } from './jobs/jobs.module';
import { isOverdueCronEnabled } from './jobs/overdue-cron.service';
import { isAuditRetentionEnabled } from './jobs/audit-retention-cron.service';
import { uploadsGcMode } from './jobs/uploads-gc-cron.service';

const GLOBAL_THROTTLE_LIMIT = Number(process.env.GLOBAL_THROTTLE_LIMIT ?? 600);

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Rate limiting global (PLANO_PROJETO.md §3.1) — limites mais estritos em login/platform-login
    // via @Throttle() nos próprios controllers. O padrão global era 60/min por IP: baixo demais para um
    // SPA (cada tela dispara várias consultas) e para uma turma inteira atrás do mesmo Wi-Fi/NAT —
    // gerava 429 em endpoints aleatórios em produção. Padrão agora 600/min por IP, ajustável por
    // GLOBAL_THROTTLE_LIMIT (os testes/auditorias podem subir ou desligar).
    ThrottlerModule.forRoot([{ name: 'default', ttl: seconds(60), limit: GLOBAL_THROTTLE_LIMIT }]),
    SharedModule,

    AuthModule,
    HealthModule,
    OrganizationsModule,
    DashboardModule,
    ReportsModule,
    UnitsModule,
    StudentsModule,
    TeachersModule,
    ClassesModule,
    LessonsModule,
    AttendanceModule,
    GraduationsModule,
    FinanceModule,
    EventsModule,
    RodasModule,
    AnnouncementsModule,
    NotificationsModule,
    PlansModule,
    SubscriptionsModule,
    FeatureOverridesModule,
    PlatformAnnouncementsModule,
    CertificatesModule,
    PassportModule,
    CalendarModule,
    PlatformDashboardModule,
    PlatformSettingsModule,
    PlatformTeamModule,
    LegalModule,
    UploadsModule,
    MapModule,
    PushModule,
    AuditModule,

    // Job diario de mensalidade vencida (03:00 America/Sao_Paulo). OVERDUE_CRON=false nao registra o agendador
    // (nenhum timer): e o caso dos testes e2e (test/env-setup.ts). ConfigModule.forRoot() acima ja carregou o .env.
    ...(isOverdueCronEnabled() || isAuditRetentionEnabled() || uploadsGcMode() !== 'off'
      ? [ScheduleModule.forRoot(), JobsModule]
      : []),
  ],
  providers: [
    { provide: APP_FILTER, useClass: PrismaRangeFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // JwtAuthGuard global: toda rota exige Bearer token, exceto as marcadas com @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // CanAccessGuard global: roda depois do JwtAuthGuard. So' entra em acao em rotas
    // marcadas com @CanAccess(resource, action) — as demais passam direto.
    { provide: APP_GUARD, useClass: CanAccessGuard },
    // FeatureGuard global: so age em rotas marcadas com @RequireFeature(key) (recurso desligado no plano/grupo => 403).
    { provide: APP_GUARD, useClass: FeatureGuard },
  ],
})
export class AppModule implements NestModule {
  /** X-Request-Id + log estruturado opcional (REQUEST_LOG=true) e contexto (IP + usuario) para a trilha de auditoria. */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestLogMiddleware(), auditContextMiddleware).forRoutes('*path');
  }
}
