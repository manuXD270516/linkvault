import {
  Header,
  Controller,
  Get,
  HttpStatus,
  Logger,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { RoadmapAccepted, RoadmapResponse } from '@linkvault/shared';
import type { AuthenticatedUser } from '../../../presentation/http/auth-context/authenticated-user';
import { CurrentUser } from '../../../presentation/http/auth-context/current-user.decorator';
import { GetRoadmapMarkdown } from '../application/get-roadmap-markdown.usecase';
import { GetRoadmap } from '../application/get-roadmap.usecase';
import { RequestRoadmap } from '../application/request-roadmap.usecase';

/** Respuesta Fastify: basta `code` para elegir 202 o 200. */
interface StatusReply {
  code(statusCode: number): unknown;
}

interface MarkdownReply extends StatusReply {
  type(contentType: string): unknown;
  send(payload: string): unknown;
}

/**
 * Roadmap de estudio sobre un análisis propio (study-roadmap).
 * Ownership: análisis ajeno → `analysis_not_found`. Degradado / sin skills → `roadmap_not_eligible`.
 */
@Controller('analyses')
export class RoadmapController {
  private readonly logger = new Logger(RoadmapController.name);

  constructor(
    private readonly requestRoadmap: RequestRoadmap,
    private readonly getRoadmap: GetRoadmap,
    private readonly getMarkdown: GetRoadmapMarkdown,
  ) {}

  @Post(':analysisId/roadmap')
  async request(
    @CurrentUser() user: AuthenticatedUser,
    @Param('analysisId') analysisId: string,
    @Res({ passthrough: true }) reply: StatusReply,
  ): Promise<RoadmapAccepted | RoadmapResponse> {
    const result = await this.requestRoadmap.execute(user.userId, analysisId);
    if (result.outcome === 'accepted') {
      reply.code(HttpStatus.ACCEPTED);
      this.logger.debug({
        msg: 'roadmap.accepted',
        roadmapId: result.body.roadmapId,
        analysisId,
      });
      return result.body;
    }
    reply.code(HttpStatus.OK);
    this.logger.debug({
      msg: 'roadmap.reused',
      roadmapId: result.body.roadmapId,
      analysisId,
      status: result.body.status,
    });
    return result.body;
  }

  @Get(':analysisId/roadmap')
  @Header('Cache-Control', 'private, no-store')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('analysisId') analysisId: string,
  ): Promise<RoadmapResponse> {
    const body = await this.getRoadmap.execute(user.userId, analysisId);
    this.logger.debug({
      msg: 'roadmap.consulted',
      roadmapId: body.roadmapId,
      analysisId,
      status: body.status,
    });
    return body;
  }

  @Get(':analysisId/roadmap.md')
  @Header('Cache-Control', 'private, no-store')
  async markdown(
    @CurrentUser() user: AuthenticatedUser,
    @Param('analysisId') analysisId: string,
    @Res({ passthrough: true }) reply: MarkdownReply,
  ): Promise<string> {
    const md = await this.getMarkdown.execute(user.userId, analysisId);
    reply.type('text/markdown; charset=utf-8');
    this.logger.debug({ msg: 'roadmap.exported', analysisId });
    return md;
  }
}
