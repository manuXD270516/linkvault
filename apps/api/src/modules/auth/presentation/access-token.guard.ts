import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AUTHENTICATED_USER_PROPERTY,
  type AuthenticatableRequest,
} from '../../../presentation/http/auth-context/authenticated-user';
import { IS_PUBLIC_KEY } from '../../../presentation/http/auth-context/public.decorator';
import {
  ACCESS_TOKEN_SIGNER,
  type AccessTokenSigner,
} from '../application/ports/access-token-signer.port';
import {
  USER_ACCOUNTS,
  type UserAccounts,
} from '../application/ports/user-accounts.port';
import { InvalidAccessToken } from '../domain/errors';

/**
 * Guard global de access token (D3 de auth-users, ADR-020 §2), registrado como `APP_GUARD`: toda ruta lo exige salvo las
 * marcadas con `@Public()`. Verifica firma y caducidad y carga el usuario por id en cada petición: si ya no existe o el
 * token se emitió antes de `floor(passwordChangedAt / 1000)` (hubo un cambio de contraseña después), lo rechaza. Todo
 * rechazo es `InvalidAccessToken` (401 `unauthorized`), sin distinguir el motivo.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ACCESS_TOKEN_SIGNER) private readonly signer: AccessTokenSigner,
    @Inject(USER_ACCOUNTS) private readonly accounts: UserAccounts,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatableRequest>();
    const token = bearerToken(request.headers['authorization']);
    if (token === undefined) {
      throw new InvalidAccessToken();
    }
    const verified = await this.signer.verify(token);
    const state = await this.accounts.getAuthState(verified.userId);
    if (
      state === null ||
      verified.issuedAtSeconds <
        Math.floor(state.passwordChangedAt.getTime() / 1000)
    ) {
      throw new InvalidAccessToken();
    }

    request[AUTHENTICATED_USER_PROPERTY] = {
      userId: verified.userId,
      sessionId: verified.sessionId,
    };
    return true;
  }
}

/** Token de `Authorization: Bearer <token>` (esquema sin distinguir mayúsculas); `undefined` con cualquier otra forma. */
export function bearerToken(
  header: string | string[] | undefined,
): string | undefined {
  if (typeof header !== 'string') {
    return undefined;
  }
  const match = /^Bearer +(\S+) *$/i.exec(header);
  return match?.[1];
}
