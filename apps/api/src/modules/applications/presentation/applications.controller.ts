import {
  applicationListQuerySchema,
  changeApplicationStatusRequestSchema,
  trackLinkRequestSchema,
  updateApplicationRequestSchema,
  weeklyPlanDecisionRequestSchema,
  type Application,
  type ApplicationAnalyticsResponse,
  type ApplicationListQuery,
  type ApplicationListResponse,
  type ApplicationTimelineResponse,
  type ChangeApplicationStatusRequest,
  type TrackLinkRequest,
  type TrackLinkResponse,
  type UpdateApplicationRequest,
  type WeeklyPlanDecisionRequest,
  type WeeklyPlanResponse,
} from '@linkvault/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../presentation/http/auth-context/authenticated-user';
import { CurrentUser } from '../../../presentation/http/auth-context/current-user.decorator';
import { ZodValidationPipe } from '../../../presentation/http/zod-validation.pipe';
import { ChangeApplicationStatus } from '../application/change-application-status.usecase';
import { DecideWeeklyPlanAction } from '../application/decide-weekly-plan-action.usecase';
import { GetApplicationAnalytics } from '../application/get-application-analytics.usecase';
import { GetApplicationTimeline } from '../application/get-application-timeline.usecase';
import { GetWeeklyPlan } from '../application/get-weekly-plan.usecase';
import { ListMyApplications } from '../application/list-my-applications.usecase';
import { TrackLink } from '../application/track-link.usecase';
import { UntrackApplication } from '../application/untrack-application.usecase';
import { UpdateApplication } from '../application/update-application.usecase';

/**
 * Postulaciones propias (spec applications/tracking). Todas las rutas exigen sesión (guard global) y solo operan sobre
 * las postulaciones de quien pide: la de otra persona, la que no existe y un `:id` mal formado responden el mismo
 * `404 application_not_found`, y por eso los identificadores de la URL no pasan por el pipe.
 */
@Controller('applications')
export class ApplicationsController {
  constructor(
    private readonly trackLink: TrackLink,
    private readonly listMine: ListMyApplications,
    private readonly analytics: GetApplicationAnalytics,
    private readonly changeStatus: ChangeApplicationStatus,
    private readonly updateApplication: UpdateApplication,
    private readonly timeline: GetApplicationTimeline,
    private readonly untrack: UntrackApplication,
    private readonly weeklyPlan: GetWeeklyPlan,
    private readonly decideAction: DecideWeeklyPlanAction,
  ) {}

  /** `201` también cuando ya la seguía (`created: false`): el SPA pinta el estado real sin una segunda petición (D4). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  track(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(trackLinkRequestSchema)) body: TrackLinkRequest,
  ): Promise<TrackLinkResponse> {
    return this.trackLink.execute(user.userId, body);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(applicationListQuerySchema))
    query: ApplicationListQuery,
  ): Promise<ApplicationListResponse> {
    return this.listMine.execute(user.userId, query.linkIds);
  }

  /** Embudo personal on-read (ADR-039): siempre `200` para el dueño, ceros + `stale: []` si vacío. */
  @Get('analytics')
  funnel(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApplicationAnalyticsResponse> {
    return this.analytics.execute(user.userId);
  }

  /**
   * «Tu semana» (D1 de weekly-plan): como mucho 3 acciones calculadas al leer, sin escribir. Ruta estática declarada
   * antes de las de `:id`.
   */
  @Get('weekly-plan')
  weeklyPlanOf(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WeeklyPlanResponse> {
    return this.weeklyPlan.execute(user.userId);
  }

  /** Decide sobre una acción del plan (D5) y responde el plan recalculado: `200`, no `201`. */
  @Post('weekly-plan/decisions')
  @HttpCode(HttpStatus.OK)
  decideWeeklyPlanAction(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(weeklyPlanDecisionRequestSchema))
    body: WeeklyPlanDecisionRequest,
  ): Promise<WeeklyPlanResponse> {
    return this.decideAction.execute(user.userId, body);
  }

  @Patch(':id/status')
  changeStatusOf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') applicationId: string,
    @Body(new ZodValidationPipe(changeApplicationStatusRequestSchema))
    body: ChangeApplicationStatusRequest,
  ): Promise<Application> {
    return this.changeStatus.execute(user.userId, applicationId, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') applicationId: string,
    @Body(new ZodValidationPipe(updateApplicationRequestSchema))
    body: UpdateApplicationRequest,
  ): Promise<Application> {
    return this.updateApplication.execute(user.userId, applicationId, body);
  }

  @Get(':id/events')
  events(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') applicationId: string,
  ): Promise<ApplicationTimelineResponse> {
    return this.timeline.execute(user.userId, applicationId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') applicationId: string,
  ): Promise<void> {
    return this.untrack.execute(user.userId, applicationId);
  }
}
