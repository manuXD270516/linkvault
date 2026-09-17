// Reloj del dominio de `auth`. Solo tipos: el puerto CLOCK de application y los tests inyectan la implementación.

export interface Clock {
  now(): Date;
}
