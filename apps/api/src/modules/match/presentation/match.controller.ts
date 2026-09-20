import {
  requestMatchRequestSchema,
  type MatchAnalysisResponse,
  type MatchLatest,
  type MatchRequestAccepted,
  type RequestMatchRequest,
} from '@linkvault/shared';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpStatus,
  Logger,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../presentation/http/auth-context/authenticated-user';
import { CurrentUser } from '../../../presentation/http/auth-context/current-user.decorator';
import { ZodValidationPipe } from '../../../presentation/http/zod-validation.pipe';
import { GetMatchAnalysis } from '../application/get-match-analysis.usecase';
import {
  toMatchLatest,
  toMatchRequestAccepted,
} from '../application/match.mapper';
import { RequestMatchAnalysis } from '../application/request-match-analysis.usecase';
import type { MatchAnalysis } from '../domain/analysis';

/** Respuesta Fastify: basta `code` para elegir 202 o 200 sin hijackear la respuesta. */
interface StatusReply {
  code(statusCode: number): unknown;
}

/**
 * Análisis de encaje sobre una oferta (spec `cv/match`). Todas las rutas exigen sesión (guard global) y solo operan
 * sobre lo de quien pide: otra persona, una oferta que no ve y un `:linkId` mal formado responden el mismo
 * `404 link_not_found`.
 *
 * El `POST` responde `202` al aceptar (o reutilizar un `running`) y `200` cuando reutiliza un informe ya hecho —completo
 * o básico con su motivo vigente— sin encolar nada.
 */
@Controller('links')
export class MatchController {
  private readonly logger = new Logger(MatchController.name);

  constructor(
    private readonly requestMatch: RequestMatchAnalysis,
    private readonly getMatch: GetMatchAnalysis,
  ) {}

  @Post(':linkId/match')
  async request(
    @CurrentUser() user: AuthenticatedUser,
    @Param('linkId') linkId: string,
    @Body(new ZodValidationPipe(requestMatchRequestSchema))
    body: RequestMatchRequest,
    @Res({ passthrough: true }) reply: StatusReply,
  ): Promise<MatchRequestAccepted | MatchLatest> {
    const result = await this.requestMatch.execute(
      user.userId,
      linkId,
      body.cvId,
    );
    if (result.outcome === 'accepted') {
      reply.code(HttpStatus.ACCEPTED);
      this.logSafe('match.accepted', result.analysis);
      return toMatchRequestAccepted(result.analysis);
    }
    reply.code(HttpStatus.OK);
    const latest = toMatchLatest(
      result.analysis,
      result.currentPreviewVersion,
      result.defaultCvId,
    );
    this.logSafe('match.reused', result.analysis);
    return latest;
  }

  /**
   * `private, no-store`: el informe lleva fragmentos del CV y no debe quedar en ninguna caché intermedia ni en la del
   * navegador.
   */
  @Get(':linkId/match')
  @Header('Cache-Control', 'private, no-store')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('linkId') linkId: string,
  ): Promise<MatchAnalysisResponse> {
    const response = await this.getMatch.execute(user.userId, linkId);
    if (response.latest !== undefined) {
      this.logSafeFields('match.consulted', {
        analysisId: response.latest.analysisId,
        linkId: response.linkId,
        cvId: response.latest.cvId,
        status: response.latest.status,
        ...(response.latest.status === 'done' && response.latest.report
          ? {
              degradedReason: response.latest.report.degradedReason,
              suggestionCount: response.latest.report.suggestions.length,
            }
          : {}),
      });
    } else if (response.running !== undefined) {
      this.logSafeFields('match.consulted', {
        analysisId: response.running.analysisId,
        linkId: response.linkId,
        cvId: response.running.cvId,
        status: response.running.status,
        step: response.running.step,
      });
    }
    return response;
  }

  /**
   * Solo metadatos: nunca texto del CV, del informe, del prompt ni credenciales. Lo que no se escribe no se puede
   * filtrar.
   */
  private logSafe(event: string, analysis: MatchAnalysis): void {
    this.logSafeFields(event, {
      analysisId: analysis.id,
      linkId: analysis.linkId,
      cvId: analysis.cvId,
      status: analysis.status,
      step: analysis.step,
      ...(analysis.provider === undefined
        ? {}
        : { provider: analysis.provider }),
      ...(analysis.degradedReason === undefined
        ? {}
        : { degradedReason: analysis.degradedReason }),
      ...(analysis.durationMs === undefined
        ? {}
        : { durationMs: analysis.durationMs }),
      ...(analysis.report === undefined
        ? {}
        : { suggestionCount: analysis.report.suggestions.length }),
    });
  }

  private logSafeFields(
    event: string,
    fields: Readonly<Record<string, unknown>>,
  ): void {
    this.logger.debug({ msg: event, ...fields });
  }
}
