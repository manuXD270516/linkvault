import { SetMetadata } from '@nestjs/common';

// Rutas públicas (D3 de auth-users + ADR-034). Toda ruta exige access token salvo las marcadas con `@Public()`:
// register, login, refresh, logout, forgot-password, reset-password, verify-email y la salud.
// `verify-email/resend` NO es pública.

export const IS_PUBLIC_KEY = 'linkvault:isPublic';

/** Excluye el controlador o el método del guard global de access token. */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
