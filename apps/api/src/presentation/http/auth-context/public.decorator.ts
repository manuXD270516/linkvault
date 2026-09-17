import { SetMetadata } from '@nestjs/common';

// Rutas públicas (D3 de auth-users). Toda ruta exige access token salvo las marcadas con `@Public()`: register, login,
// refresh, logout y la salud. Se puede poner en el controlador o en un método.

export const IS_PUBLIC_KEY = 'linkvault:isPublic';

/** Excluye el controlador o el método del guard global de access token. */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
