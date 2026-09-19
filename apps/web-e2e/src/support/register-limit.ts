import { execFileSync } from 'node:child_process';

/**
 * Pone a cero el contador de registros por IP antes de un spec.
 *
 * `auth` limita los registros a 10 cada 15 minutos por IP (ADR-020). Toda la suite corre desde la misma máquina, así
 * que comparte ese contador: con `auth`, `groups`, `links`, `applications` y `comments` se crean 11 cuentas por
 * ejecución y el último registro recibiría un `429` que no tiene nada que ver con lo que el spec prueba.
 *
 * Vacía solo `auth:register:ip:*` en el Redis del compose, **sin tocar el límite**, igual que se hace entre tandas del
 * smoke. Si `docker` no responde (por ejemplo, contra un entorno remoto), no hace nada: el spec seguirá y, si el
 * contador estorba, fallará con su `429`, que es una señal honesta.
 */
export function resetRegisterLimit(): void {
  try {
    execFileSync(
      'docker',
      [
        'exec',
        'linkvault-redis-1',
        'sh',
        '-c',
        'redis-cli --scan --pattern "auth:register:ip:*" | xargs -r redis-cli del',
      ],
      { stdio: 'ignore' },
    );
  } catch {
    // Sin docker local no hay nada que vaciar.
  }
}
