import type { JobLink, NewJobLink } from '../../domain/job-link';
import type { TransactionSession } from './transaction-session';

// Puerto de persistencia de la vacante canónica (D1 y D3 de job-links). Se inyecta con
// `{ provide: JOB_LINK_REPOSITORY, useClass: MongoJobLinkRepository }`. Solo tipos y el token.
//
// Ningún método lanza por un identificador mal formado: devuelven `null`, y el caso de uso lo convierte en su 404.

export const JOB_LINK_REPOSITORY = Symbol('JOB_LINK_REPOSITORY');

/** Vacante resuelta por su `dedupeKey`, y si acaba de nacer o ya existía. */
export interface ResolvedJobLink {
  readonly link: JobLink;
  /** `true` solo si la vacante no existía en LinkVault; compartir una conocida NO cuenta. */
  readonly created: boolean;
}

export interface JobLinkRepository {
  /**
   * Abre una transacción, resuelve el `JobLink` por su `dedupeKey` —lo crea o reutiliza el existente añadiendo la URL
   * original a su historial— y ejecuta `work` **dentro de la misma sesión**, para que la relación con el destino y el
   * evento del outbox se escriban con él o no quede nada (ADR-009).
   *
   * Un alta simultánea de la misma URL choca con el índice único: ese error aborta la transacción y no se puede
   * continuar sobre la misma sesión, así que el adaptador reintenta la **transacción entera** y en el segundo intento el
   * documento ya existe (D3). Por eso `work` tiene que poder ejecutarse más de una vez sin efectos fuera de la sesión.
   */
  withResolvedLink<T>(
    draft: NewJobLink,
    work: (resolved: ResolvedJobLink, session: TransactionSession) => Promise<T>,
  ): Promise<T>;

  /** Link por id; `null` si no existe o el id no tiene formato de identificador. */
  findById(linkId: string): Promise<JobLink | null>;
}
