import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Put, Query, UseFilters, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { MestreOnlyGuard } from '../../../shared/guards/mestre-only.guard';
import { UserThrottlerGuard } from '../../../shared/guards/user-throttler.guard';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import {
  CreateFeedCommentDto,
  CreateFeedPostDto,
  CreateFeedStoryDto,
  FeedCommentsQueryDto,
  FeedListQueryDto,
  ReportDto,
  SetReactionDto,
  UpdateFeedPostDto,
  UpdateFeedSettingsDto,
} from './dto/feed.dto';
import { FeedAccessService } from './feed-access';
import { FEED_STORY_VIEW_THROTTLE, FEED_WRITE_THROTTLE, FeedExceptionFilter } from './feed-http';
import { FeedInteractionsService } from './feed-interactions.service';
import { FeedStoriesService } from './feed-stories.service';
import { FeedService } from './feed.service';

/**
 * Feed do grupo (docs/CONTRATO_FEED_ANIVERSARIOS_COMUNICACAO.md secao 4), para qualquer MEMBRO do grupo do token.
 * Escritas com throttle por usuario E por IP (FEED_WRITE_THROTTLE) alem das cotas diarias no banco.
 */
@Controller('feed')
@UseFilters(FeedExceptionFilter)
export class FeedController {
  constructor(
    private readonly access: FeedAccessService,
    private readonly feed: FeedService,
    private readonly interactions: FeedInteractionsService,
    private readonly storiesService: FeedStoriesService,
  ) {}

  @Get('settings')
  async settings(@CurrentUser() user: AuthenticatedUser) {
    return this.feed.getSettings(await this.access.viewer(user));
  }

  @UseGuards(MestreOnlyGuard)
  @Get('settings/admin')
  async adminSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.feed.getAdminSettings(await this.access.viewer(user));
  }

  /** Contrato: PUT /feed/settings; PUT /feed/settings/admin e alias (mesmo corpo, mesma resposta). */
  @UseGuards(MestreOnlyGuard, UserThrottlerGuard)
  @Throttle(FEED_WRITE_THROTTLE)
  @Put(['settings', 'settings/admin'])
  async updateSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateFeedSettingsDto) {
    return this.feed.updateSettings(await this.access.viewer(user), dto);
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: FeedListQueryDto) {
    return this.feed.list(await this.access.viewer(user), query);
  }

  @UseGuards(UserThrottlerGuard)
  @Throttle(FEED_WRITE_THROTTLE)
  @Post('posts')
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFeedPostDto) {
    return this.feed.create(await this.access.viewer(user), dto);
  }

  /** Stories vigentes e visiveis a mim, agrupados por autor (contrato secao 9). */
  @Get('stories')
  async stories(@CurrentUser() user: AuthenticatedUser) {
    return this.storiesService.list(await this.access.viewer(user));
  }

  @UseGuards(UserThrottlerGuard)
  @Throttle(FEED_WRITE_THROTTLE)
  @Post('stories')
  @HttpCode(HttpStatus.CREATED)
  async createStory(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFeedStoryDto) {
    return this.storiesService.create(await this.access.viewer(user), dto);
  }

  @UseGuards(UserThrottlerGuard)
  @Throttle(FEED_STORY_VIEW_THROTTLE)
  @Post('stories/:id/view')
  @HttpCode(HttpStatus.NO_CONTENT)
  async viewStory(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.storiesService.markViewed(await this.access.viewer(user), id);
  }

  @UseGuards(UserThrottlerGuard)
  @Throttle(FEED_WRITE_THROTTLE)
  @Patch('posts/:id')
  async update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFeedPostDto) {
    return this.feed.update(await this.access.viewer(user), id, dto);
  }

  @UseGuards(UserThrottlerGuard)
  @Throttle(FEED_WRITE_THROTTLE)
  @Delete('posts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.feed.remove(await this.access.viewer(user), id);
  }

  @UseGuards(UserThrottlerGuard)
  @Throttle(FEED_WRITE_THROTTLE)
  @Put('posts/:id/reaction')
  async react(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SetReactionDto) {
    return this.feed.react(await this.access.viewer(user), id, dto.type);
  }

  @Get('posts/:id/comments')
  async comments(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number, @Query() query: FeedCommentsQueryDto) {
    return this.interactions.listComments(await this.access.viewer(user), id, query);
  }

  @UseGuards(UserThrottlerGuard)
  @Throttle(FEED_WRITE_THROTTLE)
  @Post('posts/:id/comments')
  @HttpCode(HttpStatus.CREATED)
  async comment(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number, @Body() dto: CreateFeedCommentDto) {
    return this.interactions.createComment(await this.access.viewer(user), id, dto);
  }

  @UseGuards(UserThrottlerGuard)
  @Throttle(FEED_WRITE_THROTTLE)
  @Delete('comments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteComment(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.interactions.deleteComment(await this.access.viewer(user), id);
  }

  @UseGuards(UserThrottlerGuard)
  @Throttle(FEED_WRITE_THROTTLE)
  @Post('posts/:id/report')
  @HttpCode(HttpStatus.OK)
  async reportPost(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ReportDto) {
    return this.interactions.reportPost(await this.access.viewer(user), id, dto);
  }

  @UseGuards(UserThrottlerGuard)
  @Throttle(FEED_WRITE_THROTTLE)
  @Post('comments/:id/report')
  @HttpCode(HttpStatus.OK)
  async reportComment(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ReportDto) {
    return this.interactions.reportComment(await this.access.viewer(user), id, dto);
  }
}
