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
  AuthError,
  PasswordPolicyViolation,
  TooManyAttempts,
} from '../../modules/auth/domain/errors';
import {
  GroupsError,
  InvalidGroupName,
} from '../../modules/groups/domain/errors';
import { InvalidCursor, LinksError } from '../../modules/links/domain/errors';
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
 * - `RequestValidationError` del pipe zod → 400 `validation_error` nombrando los campos.
 * - Errores de dominio de `auth` por su `code`, con `Retry-After` en `TooManyAttempts`.
 * - Errores de dominio de `users`: `EmailAlreadyRegistered` → 409 `email_taken`; `InvalidProfileChanges` → 400
 *   `validation_error` con su campo; `UserNotFound` → 401 `unauthorized`, porque el único usuario que una petición puede
 *   buscar es el de su access token (no hay rutas sobre otros usuarios): si no existe, el token no identifica a nadie, como
 *   exige "Rutas protegidas por defecto", y un 404 invitaría al SPA a tratarlo como un recurso ausente y no como sesión.
 * - Errores de dominio de `groups`: cada uno lleva su `code` (`group_not_found` → 404, `member_not_found` → 404,
 *   `forbidden` → 403, `invalid_invite_code` → 404, `group_full` → 409, `too_many_groups` → 409, `owner_cannot_leave` →
 *   409), así que basta un `instanceof GroupsError`; `InvalidGroupName` va antes porque además nombra el campo `name`.
 * - Errores de dominio de `links`, también por su `code` (`invalid_url` → 400, `text_too_long` → 400, `link_not_found`
 *   → 404, `forbidden` → 403); `InvalidCursor` va antes porque es un `validation_error` que nombra el campo `cursor`.
 *   `invalid_url` y `text_too_long` NO nombran campo: el código ya dice cuál es, y el SPA traduce el código.
 * - `HttpException` 400 (JSON mal formado, que Nest convierte desde Fastify) → `validation_error` sin campos, y 415 →
 *   `unsupported_media_type`. El resto de `HttpException` (404 de ruta desconocida, 503 de la salud) conserva la
 *   respuesta de Nest.
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
      return reply('validation_error', exception.fields);
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
    if (exception instanceof GroupsError) {
      return reply(exception.code);
    }
    if (exception instanceof InvalidCursor) {
      return reply('validation_error', [exception.field]);
    }
    if (exception instanceof LinksError) {
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
