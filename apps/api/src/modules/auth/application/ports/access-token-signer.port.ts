// Puerto de emisión y verificación del access token (D3 de auth-users). Solo tipos y el token.

export const ACCESS_TOKEN_SIGNER = Symbol('ACCESS_TOKEN_SIGNER');

export interface AccessTokenSubject {
  readonly userId: string;
  /** Sesión que abrió el login o registro; el cambio de contraseña conserva la de la petición. */
  readonly sessionId: string;
}

export interface SignedAccessToken {
  readonly accessToken: string;
  /** Segundos hasta la caducidad (`AUTH_ACCESS_TOKEN_TTL_SECONDS`). */
  readonly expiresIn: number;
}

export interface VerifiedAccessToken extends AccessTokenSubject {
  /** `iat` en segundos Unix; el guard lo compara con `floor(passwordChangedAt / 1000)`. */
  readonly issuedAtSeconds: number;
}

export interface AccessTokenSigner {
  sign(subject: AccessTokenSubject): Promise<SignedAccessToken>;
  /** Rechaza con `InvalidAccessToken` si el token está mal formado, mal firmado, caducado o no es de acceso. */
  verify(accessToken: string): Promise<VerifiedAccessToken>;
}
