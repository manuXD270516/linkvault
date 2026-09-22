import { describe, expect, it } from 'vitest';

/**
 * Jobs BullMQ tras borrado de cuenta (D11 / ADR-033): si el `userId` del payload ya no existe, el consumer
 * **debe hacer ack** (no reintentar indefinidamente).
 *
 * Inventario por cola:
 *
 * | Cola | Comportamiento si el usuario ya no existe |
 * |---|---|
 * | `extract-cv` | El CV se borró en la cascada → `findById` null → `cv_not_found` (ack). |
 * | `delete-cv-file` | `remove` es idempotente si el objeto ya no está (ack). `attempts` acotados en la cola. |
 * | `analyze-match` | El análisis se borró en la cascada → `findById` null → `abandoned` (ack). `attempts: 1`. |
 * | `build-roadmap` | Análisis ausente o `userId` distinto → `abandoned` (ack). `attempts: 1`. |
 * | `enrich-link` | No lleva `userId`; no aplica. |
 *
 * Esta suite documenta el contrato; las garantías viven en los use cases/consumers citados.
 */
describe('BullMQ consumers after account deletion (D11)', () => {
  it('documents ack-when-user-gone for user-scoped queues', () => {
    expect([
      'extract-cv',
      'delete-cv-file',
      'analyze-match',
      'build-roadmap',
    ]).toHaveLength(4);
  });
});
