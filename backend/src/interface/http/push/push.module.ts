import { Module } from '@nestjs/common';
import { PushController } from './push.controller';

/** PushService vem do SharedModule (global): é injetado também pelo NotificationsService. */
@Module({
  controllers: [PushController],
})
export class PushModule {}
