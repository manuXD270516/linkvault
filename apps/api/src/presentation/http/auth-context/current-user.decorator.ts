import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import {
  AUTHENTICATED_USER_PROPERTY,
  type AuthenticatableRequest,
  type AuthenticatedUser,
} from './authenticated-user';

/**
 * Usuario y sesión del access token de la petición, fijados por el guard global. Usarlo en una ruta `@Public()` es un error
 * de programación: responde 500, nunca una identidad vacía.
 */
export function currentUserOf(context: ExecutionContext): AuthenticatedUser {
  const request = context.switchToHttp().getRequest<AuthenticatableRequest>();
  const user = request[AUTHENTICATED_USER_PROPERTY];
  if (user === undefined) {
    throw new Error('@CurrentUser() requires a route protected by the access token guard');
  }
  return user;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    currentUserOf(context),
);
