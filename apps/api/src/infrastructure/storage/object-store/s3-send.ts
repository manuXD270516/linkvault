import type { S3Client } from '@aws-sdk/client-s3';

// Cómo habla el script `object-store` con el almacén: un `send` de comandos del SDK. El real es el `send` del cliente
// de la fábrica (design D3); los tests pasan uno falso que responde según el tipo de comando y enumera los enviados.

export interface SendOptions {
  readonly abortSignal?: AbortSignal;
}

export type S3Send = (
  command: object,
  options?: SendOptions,
) => Promise<unknown>;

/** `send` del cliente real. */
export function sendOf(client: S3Client): S3Send {
  return (command, options) =>
    client.send(command as Parameters<S3Client['send']>[0], options);
}

/** Los dos buckets que usa la aplicación: el de CV (`S3_BUCKET`) y el de snapshots (`S3_SNAPSHOTS_BUCKET`). */
export interface ObjectStoreBuckets {
  readonly cv: string;
  readonly snapshots: string;
}

/** Venció el plazo global mientras se hacía `step`. */
export class DeadlineExceeded extends Error {
  constructor(
    readonly step: string,
    readonly deadlineMs: number,
  ) {
    super(`deadline of ${deadlineMs / 1000} s exceeded during "${step}"`);
    this.name = 'DeadlineExceeded';
  }
}

export interface StepRunner {
  /** Ejecuta un paso con nombre; si el plazo ya venció, no lo empieza. */
  step<T>(name: string, run: (signal: AbortSignal) => Promise<T>): Promise<T>;
}

/**
 * Ejecuta `work` con un plazo global (design D4: 90 s para `provision`). Si vence, aborta la petición en curso y
 * rechaza con `DeadlineExceeded` nombrando el paso que se estaba haciendo. Los plazos por petición de la fábrica
 * siguen aplicando dentro.
 */
export async function withDeadline(
  deadlineMs: number,
  work: (runner: StepRunner) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  let current = 'starting';
  const runner: StepRunner = {
    step: async <T>(
      name: string,
      run: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> => {
      if (controller.signal.aborted) {
        throw new DeadlineExceeded(current, deadlineMs);
      }
      current = name;
      return run(controller.signal);
    },
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DeadlineExceeded(current, deadlineMs));
    }, deadlineMs);
  });
  const running = work(runner);
  // Si vence el plazo, `running` sigue hasta que la petición abortada vuelve: su rechazo ya no interesa a nadie.
  running.catch(() => undefined);
  try {
    await Promise.race([running, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
