import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, seconds } from '@nestjs/throttler';
import { SharedModule } from './shared/shared.module';
import { JwtAuthGuard } from './shared/guards/jwt-auth.guard';
import { CanAccessGuard } from './shared/guards/can-access.guard';

import { AuthModule } from './interface/http/auth/auth.module';
import { HealthModule } from './interface/http/health/health.module';
import { OrganizationsModule } from './interface/http/organizations/organizations.module';
import { DashboardModule } from './interface/http/dashboard/dashboard.module';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Rate limiting global (PLANO_PROJETO.md §3.1) — limites mais estritos em login/platform-login
    // via @Throttle() nos próprios controllers.
    ThrottlerModule.forRoot([{ name: 'default', ttl: seconds(60), limit: 60 }]),
    SharedModule,

    AuthModule,
    HealthModule,
    OrganizationsModule,
    DashboardModule,
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
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // JwtAuthGuard global: toda rota exige Bearer token, exceto as marcadas com @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // CanAccessGuard global: roda depois do JwtAuthGuard. So' entra em acao em rotas
    // marcadas com @CanAccess(resource, action) — as demais passam direto.
    { provide: APP_GUARD, useClass: CanAccessGuard },
  ],
})
export class AppModule {}
