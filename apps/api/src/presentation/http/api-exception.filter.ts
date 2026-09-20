import type { ApiErrorCode, ApiErrorResponse } from '@linkvault/shared';
import {
  type ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import {
  ApplicationsError,
  InvalidApplicationField,
} from '../../modules/applications/domain/errors';
import {
  AuthError,
  PasswordPolicyViolation,
  TooManyAttempts,
} from '../../modules/auth/domain/errors';
import {
  GroupsError,
  InvalidGroupName,
  TooManyJoinAttempts,
} from '../../modules/groups/domain/errors';
import {
  InvalidCursor,
  InvalidLinkField,
  LinksError,
  PreviewFieldUnknown,
  TooManyLinkAttempts,
  ExtractionUnavailable,
  AiQuotaExceeded,
} from '../../modules/links/domain/errors';
import {
  CvError,
  InvalidCvUpload,
  TooManyCvAttempts,
} from '../../modules/cv/domain/errors';
import {
  EmailAlreadyRegistered,
  InvalidProfileChanges,
  UserNotFound,
} from '../../modules/users/domain/errors';
import { API_ERROR_STATUS, apiErrorBody } from './api-error';
import { RequestValidationError } from './zod-validation.pipe';

/** Error traducido al contrato de la API. */
interface ApiErrorReply {
  readonly status: number;
  readonly body: ApiErrorResponse;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Filtro global de errores (D8 de auth-users). Traduce a `{ code, message, fields? }`:
 * - `RequestValidationError` del pipe zod → 400 `validation_error` nombrando los campos, o el código propio que pida su
 *   schema (`text_too_long` del texto pegado).
 * - Errores de dominio de `auth` por su `code`, con `Retry-After` en `TooManyAttempts`.
 * - Errores de dominio de `users`: `EmailAlreadyRegistered` → 409 `email_taken`; `InvalidProfileChanges` → 400
 *   `validation_error` con su campo; `UserNotFound` → 401 `unauthorized`, porque el único usuario que una petición puede
 *   buscar es el de su access token (no hay rutas sobre otros usuarios): si no existe, el token no identifica a nadie, como
 *   exige "Rutas protegidas por defecto", y un 404 invitaría al SPA a tratarlo como un recurso ausente y no como sesión.
 * - Errores de dominio de `groups`: cada uno lleva su `code` (`group_not_found` → 404, `member_not_found` → 404,
 *   `forbidden` → 403, `invalid_invite_code` → 404, `group_full` → 409, `too_many_groups` → 409, `owner_cannot_leave` →
 *   409, `already_owner` → 409), así que basta un `instanceof GroupsError`; `InvalidGroupName` va antes porque además
 *   nombra el campo `name`, y `TooManyJoinAttempts` (429) justo antes porque lleva su `Retry-After` (ADR-025 §8).
 * - Errores de dominio de `links`, también por su `code` (`invalid_url` → 400, `text_too_long` → 400, `link_not_found`
 *   → 404, `forbidden` → 403, `enrichment_not_retryable` → 409, `not_a_job_posting` → 422); `InvalidCursor` va antes porque es un
 *   `validation_error` que nombra el campo `cursor`, `PreviewFieldUnknown` porque nombra el campo que no existe y
 *   `TooManyLinkAttempts`, `ExtractionUnavailable` (503) y `AiQuotaExceeded` (429) porque llevan su `Retry-After`. `invalid_url` y `text_too_long` NO nombran campo: el código ya
 *   dice cuál es, y el SPA traduce el código. `InvalidLinkField` (group-comments) va antes que la genérica porque es un
 *   `validation_error` que nombra su campo: `InvalidCommentText` (`text`) e `InvalidShareNote` (`note`). Por la genérica
 *   salen `CommentNotFound` → 404 `comment_not_found`, `CommentDeletionForbidden` y `NoteRemovalForbidden` → 403
 *   `forbidden`, `CommentsGroupNotFound` → 404 `group_not_found`, con el mismo cuerpo que da `groups`, y los del
 *   enlace público: `PublicShareForbidden` → 403 `forbidden` y `PublicShareNotFound` → 404 `link_not_found`, con el
 *   mismo cuerpo que `LinkNotFound`. `GET /p/:slug` **no pasa por este filtro**: su controlador devuelve la respuesta
 *   con su código en vez de lanzar, porque esa ruta nunca responde JSON (D4 de public-preview-share).
 * - Errores de dominio de `applications`, por su `code` (`application_not_found` → 404, `application_conflict` → 409,
 *   `link_not_found` → 404, `group_not_found` → 404); `InvalidApplicationField` va antes porque es un
 *   `validation_error` que nombra su campo: `InvalidAppliedAt` (`appliedAt`, la fecha futura que solo el dominio puede
 *   juzgar con su reloj) y las defensas de la etapa (`stageLabel`) y de las notas (`notes`).
 * - Errores de dominio de `cv`, por su `code` (`cv_not_found` → 404, `unsupported_file_type` → 415, `file_too_large` →
 *   413, `too_many_cvs` → 409); `InvalidCvUpload` va antes porque es un `validation_error` que nombra el campo `file`
 *   —y es adonde va a parar **todo** error del parser de multipart sin fila propia, para que ninguno salga como 500—, y
 *   `TooManyCvAttempts` (429) porque lleva su `Retry-After`.
 * - `HttpException` 400 (JSON mal formado, que Nest convierte desde Fastify) → `validation_error` sin campos, y 415 →
 *   `unsupported_media_type`, cuyo mensaje es genérico desde que lo comparten dos rutas con formatos distintos. El
 *   resto de `HttpException` (404 de ruta desconocida, 503 de la salud) conserva la respuesta de Nest.
 * - Cualquier otro error → 500 `internal_error`, sin detalles en la respuesta. El log lleva el nombre del error y los marcos
 *   de la pila, sin el mensaje: el mensaje de un error ajeno puede incluir datos del usuario (p. ej. la clave duplicada de Mongo
 *   lleva el email).
 *
 * Los mensajes de la respuesta son fijos por código; nunca se copia el `message` del error.
 */
@Catch()
export class ApiExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  override catch(exception: unknown, host: ArgumentsHost): void {
    const translated = this.translate(exception);
    if (translated === undefined) {
      super.catch(exception, host);
      return;
    }
    const adapter = this.applicationRef ?? this.httpAdapterHost?.httpAdapter;
    if (adapter === undefined) {
      throw new Error('ApiExceptionFilter requires the HTTP adapter');
    }
    const response: unknown = host.switchToHttp().getResponse();
    if (adapter.isHeadersSent(response)) {
      adapter.end(response);
      return;
    }
    for (const [name, value] of Object.entries(translated.headers)) {
      adapter.setHeader(response, name, value);
    }
    adapter.reply(response, translated.body, translated.status);
  }

  /** `undefined` si la respuesta de Nest para esa `HttpException` se conserva. */
  private translate(exception: unknown): ApiErrorReply | undefined {
    if (exception instanceof RequestValidationError) {
      return reply(exception.code, exception.fields);
    }
    if (exception instanceof TooManyAttempts) {
      return reply('too_many_attempts', [], {
        'Retry-After': String(exception.retryAfterSeconds),
      });
    }
    if (exception instanceof PasswordPolicyViolation) {
      return reply('validation_error', [exception.field]);
    }
    if (exception instanceof AuthError) {
      return reply(exception.code);
    }
    if (exception instanceof EmailAlreadyRegistered) {
      return reply('email_taken');
    }
    if (exception instanceof InvalidProfileChanges) {
      return reply(
        'validation_error',
        exception.field === undefined ? [] : [exception.field],
      );
    }
    if (exception instanceof UserNotFound) {
      return reply('unauthorized');
    }
    if (exception instanceof InvalidGroupName) {
      return reply('validation_error', [exception.field]);
    }
    if (exception instanceof TooManyJoinAttempts) {
      return reply(exception.code, [], {
        'Retry-After': String(exception.retryAfterSeconds),
      });
    }
    if (exception instanceof GroupsError) {
      return reply(exception.code);
    }
    if (exception instanceof InvalidLinkField) {
      return reply('validation_error', [exception.field]);
    }
    if (exception instanceof InvalidCursor) {
      return reply('validation_error', [exception.field]);
    }
    if (exception instanceof PreviewFieldUnknown) {
      return reply('preview_field_unknown', [exception.field]);
    }
    if (
      exception instanceof TooManyLinkAttempts ||
      exception instanceof ExtractionUnavailable ||
      exception instanceof AiQuotaExceeded
    ) {
      return reply(exception.code, [], {
        'Retry-After': String(exception.retryAfterSeconds),
      });
    }
    if (exception instanceof LinksError) {
      return reply(exception.code);
    }
    if (exception instanceof InvalidApplicationField) {
      return reply('validation_error', [exception.field]);
    }
    if (exception instanceof ApplicationsError) {
      return reply(exception.code);
    }
    if (exception instanceof InvalidCvUpload) {
      return reply('validation_error', [exception.field]);
    }
    if (exception instanceof TooManyCvAttempts) {
      return reply(exception.code, [], {
        'Retry-After': String(exception.retryAfterSeconds),
      });
    }
    if (exception instanceof CvError) {
      return reply(exception.code);
    }
    if (exception instanceof HttpException) {
      switch (exception.getStatus()) {
        case HttpStatus.BAD_REQUEST:
          return reply('validation_error');
        case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
          return reply('unsupported_media_type');
        default:
          return undefined;
      }
    }
    this.logUnknown(exception);
    return reply('internal_error');
  }

  private logUnknown(exception: unknown): void {
    if (exception instanceof Error) {
      // Solo las líneas de marco: la cabecera de la pila repite el mensaje, que puede ocupar varias líneas.
      const frames = (exception.stack ?? '')
        .split('\n')
        .filter((line) => /^\s+at /.test(line))
        .join('\n');
      this.logger.error(`Unhandled ${exception.name}`, frames);
      return;
    }
    this.logger.error(`Unhandled non-Error value (${typeof exception})`);
  }
}

function reply(
  code: ApiErrorCode,
  fields: readonly string[] = [],
  headers: Readonly<Record<string, string>> = {},
): ApiErrorReply {
  return {
    status: API_ERROR_STATUS[code],
    body: apiErrorBody(code, fields),
    headers,
  };
}
