import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { DeliverLinkEnriched } from '../application/deliver-link-enriched.usecase';
import {
  ENRICHMENT_NOTICES,
  type EnrichmentNotices,
} from '../application/ports/enrichment-notices.port';

/**
 * La **única** suscripción al canal de avisos de este proceso (D9 de link-enrichment). Es un provider del módulo, así
 * que Nest la crea una sola vez: cada instancia de `api` escucha una vez y reparte a sus propias conexiones abiertas.
 * Suscribirse por petición sería una conexión a Redis por pestaña.
 *
 * Suscribirse no puede tumbar el arranque: sin Redis, `api` sigue sirviendo peticiones y lo único que se pierde es que
 * la pantalla se entere sola; el listado trae el estado verdadero al recargar. Se avisa una vez y no se reintenta aquí:
 * el cliente de Redis ya reintenta la conexión por su cuenta.
 */
@Injectable()
export class LinkEnrichedSubscription
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(LinkEnrichedSubscription.name);
  private unsubscribe: (() => Promise<void>) | undefined;

  constructor(
    @Inject(ENRICHMENT_NOTICES) private readonly notices: EnrichmentNotices,
    private readonly deliver: DeliverLinkEnriched,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.unsubscribe = await this.notices.subscribe((payload) =>
        this.deliver.execute(payload).then(() => undefined),
      );
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(
        `Could not subscribe to enrichment notices (${name}); open screens will not update on their own`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = undefined;
    if (unsubscribe !== undefined) {
      // No await: con Redis en hang, `UNSUBSCRIBE` no contesta y tumbaría el cierre (health-contract).
      void unsubscribe().catch(() => undefined);
    }
  }
}
