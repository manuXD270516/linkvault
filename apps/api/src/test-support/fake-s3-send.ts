import {
  CreateBucketCommand,
  DeleteBucketLifecycleCommand,
  DeleteBucketPolicyCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketPolicyCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutBucketEncryptionCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import type { SendOptions } from '../infrastructure/storage/object-store/s3-send';

// `send` falso para el script `object-store` (tareas 2.3 y 2.4 de `object-store`): responde según el tipo de comando y
// el bucket, y **enumera** lo enviado, que es como los tests comprueban que `provision` no pone reglas de ciclo de
// vida y que `verify` no escribe.

const COMMANDS = [
  ['CreateBucket', CreateBucketCommand],
  ['DeleteBucketLifecycle', DeleteBucketLifecycleCommand],
  ['DeleteBucketPolicy', DeleteBucketPolicyCommand],
  ['DeleteObject', DeleteObjectCommand],
  ['DeleteObjects', DeleteObjectsCommand],
  ['GetBucketEncryption', GetBucketEncryptionCommand],
  ['GetBucketLifecycleConfiguration', GetBucketLifecycleConfigurationCommand],
  ['GetBucketPolicy', GetBucketPolicyCommand],
  ['GetObject', GetObjectCommand],
  ['HeadBucket', HeadBucketCommand],
  ['ListObjectsV2', ListObjectsV2Command],
  ['PutBucketEncryption', PutBucketEncryptionCommand],
  ['PutBucketLifecycleConfiguration', PutBucketLifecycleConfigurationCommand],
  ['PutBucketPolicy', PutBucketPolicyCommand],
  ['PutObject', PutObjectCommand],
] as const;

export type FakeCommandName = (typeof COMMANDS)[number][0];

/** Comandos que escriben en el almacén. `verify` no puede enviar ninguno (salvo el borrado de la sonda). */
export const WRITE_COMMANDS: readonly FakeCommandName[] = [
  'CreateBucket',
  'DeleteBucketLifecycle',
  'DeleteBucketPolicy',
  'DeleteObject',
  'DeleteObjects',
  'PutBucketEncryption',
  'PutBucketLifecycleConfiguration',
  'PutBucketPolicy',
  'PutObject',
];

export interface SentCommand {
  readonly name: FakeCommandName;
  readonly bucket: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/** Respuesta de un comando: el valor que devuelve, o lanza. */
export type FakeResponder = (
  input: Readonly<Record<string, unknown>>,
  options: SendOptions | undefined,
) => unknown;

/** Error con la forma de los del SDK: `name` es el `<Code>` de S3 y `$metadata` lleva el estado HTTP. */
export function s3Error(code: string, httpStatusCode: number): Error {
  return Object.assign(new Error(`${code} (fake)`), {
    name: code,
    $metadata: { httpStatusCode },
  });
}

export function nameOf(command: object): FakeCommandName {
  for (const [name, type] of COMMANDS) {
    if (command instanceof type) {
      return name;
    }
  }
  throw new Error(`fake S3: unexpected command ${command.constructor.name}`);
}

/**
 * Un almacén falso. Por defecto se comporta como uno recién arrancado y bien configurado; `on(name, bucket?, fn)`
 * cambia la respuesta de un comando (para un bucket o para todos).
 */
export class FakeS3 {
  readonly sent: SentCommand[] = [];
  private readonly responders = new Map<string, FakeResponder>();

  constructor(defaults: Partial<Record<FakeCommandName, FakeResponder>> = {}) {
    for (const [name, responder] of Object.entries(defaults)) {
      if (responder !== undefined) {
        this.responders.set(name, responder);
      }
    }
  }

  on(
    name: FakeCommandName,
    bucket: string | undefined,
    responder: FakeResponder,
  ): this {
    this.responders.set(
      bucket === undefined ? name : `${name}:${bucket}`,
      responder,
    );
    return this;
  }

  readonly send = async (
    command: object,
    options?: SendOptions,
  ): Promise<unknown> => {
    const name = nameOf(command);
    const input = (command as { input: Record<string, unknown> }).input;
    const bucket = typeof input['Bucket'] === 'string' ? input['Bucket'] : '';
    this.sent.push({ name, bucket, input });
    const responder =
      this.responders.get(`${name}:${bucket}`) ?? this.responders.get(name);
    return responder === undefined ? {} : responder(input, options);
  };

  names(bucket?: string): FakeCommandName[] {
    return this.sent
      .filter((command) => bucket === undefined || command.bucket === bucket)
      .map((command) => command.name);
  }
}
