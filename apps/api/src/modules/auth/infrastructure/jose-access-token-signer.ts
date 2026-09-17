import { errors, jwtVerify, SignJWT } from 'jose';
import type {
  AccessTokenSigner,
  AccessTokenSubject,
  SignedAccessToken,
  VerifiedAccessToken,
} from '../application/ports/access-token-signer.port';
import type { Clock } from '../domain/clock';
import { InvalidAccessToken } from '../domain/errors';

// Adaptador ACCESS_TOKEN_SIGNER con jose (D3 de auth-users): JWT HS256 firmado con `AUTH_JWT_SECRET`, claims `sub`
// (userId), `sid` (sesión), `iat`, `exp` y `typ: "access"`. La verificación fija el algoritmo (ni `none` ni otro HMAC con
// el mismo secreto) y tolera 5 s de desfase de reloj. jose 6 solo publica ESM: la app compilada en CommonJS lo carga con
// `require(esm)` de Node 22.

const ALGORITHM = 'HS256';
const TOKEN_TYPE = 'access';
const CLOCK_TOLERANCE_SECONDS = 5;
const MIN_SECRET_LENGTH = 32;

export interface JoseAccessTokenSignerOptions {
  /** `AUTH_JWT_SECRET`. */
  readonly secret: string;
  /** `AUTH_ACCESS_TOKEN_TTL_SECONDS`. */
  readonly ttlSeconds: number;
}

export class JoseAccessTokenSigner implements AccessTokenSigner {
  private readonly key: Uint8Array;
  private readonly ttlSeconds: number;

  constructor(
    options: JoseAccessTokenSignerOptions,
    private readonly clock: Clock,
  ) {
    // Defensa en profundidad: la configuración ya exige 32 caracteres. El mensaje nunca incluye el secreto.
    if (options.secret.length < MIN_SECRET_LENGTH) {
      throw new RangeError(
        `Access token secret must have at least ${MIN_SECRET_LENGTH} characters`,
      );
    }
    this.key = new TextEncoder().encode(options.secret);
    this.ttlSeconds = options.ttlSeconds;
  }

  async sign(subject: AccessTokenSubject): Promise<SignedAccessToken> {
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    const accessToken = await new SignJWT({
      sid: subject.sessionId,
      typ: TOKEN_TYPE,
    })
      .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
      .setSubject(subject.userId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + this.ttlSeconds)
      .sign(this.key);
    return { accessToken, expiresIn: this.ttlSeconds };
  }

  async verify(accessToken: string): Promise<VerifiedAccessToken> {
    let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];
    try {
      ({ payload } = await jwtVerify(accessToken, this.key, {
        algorithms: [ALGORITHM],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        currentDate: this.clock.now(),
        requiredClaims: ['sub', 'iat', 'exp'],
      }));
    } catch (error) {
      // Solo los rechazos de jose (firma, formato, caducidad, algoritmo) son un token inválido; el resto es un fallo real.
      if (error instanceof errors.JOSEError) {
        throw new InvalidAccessToken();
      }
      throw error;
    }

    const { sub, sid, typ, iat } = payload;
    if (
      typ !== TOKEN_TYPE ||
      typeof sub !== 'string' ||
      sub === '' ||
      typeof sid !== 'string' ||
      sid === '' ||
      typeof iat !== 'number'
    ) {
      throw new InvalidAccessToken();
    }
    return { userId: sub, sessionId: sid, issuedAtSeconds: iat };
  }
}
