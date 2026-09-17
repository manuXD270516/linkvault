// Límites de intentos (spec auth/credentials, ADR-020 §5): contadores por ventana fija de 15 minutos que se consumen antes
// de verificar la contraseña. Solo constantes; el almacén vive detrás del puerto ATTEMPT_LIMITER.

export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/** Intentos fallidos por email normalizado, exista o no la cuenta (login y contraseña actual del cambio). */
export const LOGIN_ATTEMPTS_PER_EMAIL = 5;

/** Logins fallidos por IP del cliente (IPv6 agrupada por /64). */
export const LOGIN_ATTEMPTS_PER_IP = 50;

/** Registros por IP del cliente, correctos o no. */
export const REGISTRATIONS_PER_IP = 10;
