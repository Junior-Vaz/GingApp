import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, UseFilters, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { UserThrottlerGuard } from '../../../shared/guards/user-throttler.guard';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { ModerationQueueQueryDto, ResolveReportsDto } from './dto/feed.dto';
import { FeedAccessService } from './feed-access';
import { FEED_WRITE_THROTTLE, FeedExceptionFilter, FeedModeratorGuard } from './feed-http';
import { FeedModerationService } from './feed-moderation.service';

/**
 * Moderacao do feed (painel). FeedModeratorGuard barra quem nao e MESTRE/PROFESSOR/INSTRUTOR antes do corpo; o escopo
 * fino (PROFESSOR/INSTRUTOR so UNIT/CLASS do proprio escopo de unidade) e por post, no service.
 */
@Controller('feed')
@UseFilters(FeedExceptionFilter)
@UseGuards(FeedModeratorGuard)
export class FeedModerationController {
  constructor(
    private readonly access: FeedAccessService,
    private readonly moderation: FeedModerationService,
  ) {}

  @Get('moderation/queue')
  async queue(@CurrentUser() user: AuthenticatedUser, @Query() query: ModerationQueueQueryDto) {
    return this.moderation.queue(await this.access.viewer(user), query);
  }

  @UseGuards(UserThrottlerGuard)
  @Throttle(FEED_WRITE_THROTTLE)
  @Post('posts/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.moderation.approve(await this.access.viewer(user), id);
  }

  @UseGuards(UserThrottlerGuard)
  @Throttle(FEED_WRITE_THROTTLE)
  @Post('posts/:id/hide')
  @HttpCode(HttpStatus.OK)
  async hide(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.moderation.hide(await this.access.viewer(user), id);
  }

  @UseGuards(UserThrottlerGuard)
  @Throttle(FEED_WRITE_THROTTLE)
  @Post('posts/:id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.moderation.restore(await this.access.viewer(user), id);
  }

  @UseGuards(UserThrottlerGuard)
  @Throttle(FEED_WRITE_THROTTLE)
  @Post('posts/:id/pin')
  @HttpCode(HttpStatus.OK)
  async pin(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.moderation.setPinned(await this.access.viewer(user), id, true);
  }

  @UseGuards(UserThrottlerGuard)
  @Throttle(FEED_WRITE_THROTTLE)
  @Post('posts/:id/unpin')
  @HttpCode(HttpStatus.OK)
  async unpin(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.moderation.setPinned(await this.access.viewer(user), id, false);
  }

  @UseGuards(UserThrottlerGuard)
  @Throttle(FEED_WRITE_THROTTLE)
  @Post('moderation/reports/:postId/resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(@CurrentUser() user: AuthenticatedUser, @Param('postId', ParseIntPipe) postId: number, @Body() dto: ResolveReportsDto) {
    return this.moderation.resolve(await this.access.viewer(user), postId, dto);
  }
}
