import { Injectable, type OnApplicationShutdown } from '@nestjs/common';

// Conexiones abiertas del canal de eventos, por proceso (D9 de link-enrichment). Es plataforma, como el outbox: quien
// reparte —hoy `links`— no sabe de HTTP, y el canal no sabe qué es un link.
//
// Cada instancia de `api` reparte a **sus propias** conexiones; por eso escala con varias instancias, siempre que el
// aviso llegue a todas por el canal de Redis. Si nadie escucha, el aviso se descarta sin error: el estado verdadero
// sigue en la base de datos y el listado lo trae al recargar.

/** Una conexión abierta. El registro no sabe cómo se escribe: eso es del transporte. */
export interface EventStreamSink {
  /** Envía un evento con nombre. `false` si la conexión ya no acepta escrituras. */
  send(event: string, data: string): boolean;
  /** Envía un latido, que NO es un mensaje: un comentario, que ningún parser confunde con uno. */
  heartbeat(): boolean;
  /** Cierra la conexión y suelta lo que tuviera pendiente (temporizadores incluidos). */
  close(): void;
}

@Injectable()
export class EventStreamRegistry implements OnApplicationShutdown {
  private readonly streams = new Map<string, Set<EventStreamSink>>();

  /** Apunta una conexión de esa persona y devuelve cómo darla de baja. Una persona puede tener varias pestañas. */
  register(userId: string, sink: EventStreamSink): () => void {
    const sinks = this.streams.get(userId) ?? new Set<EventStreamSink>();
    sinks.add(sink);
    this.streams.set(userId, sinks);
    return () => {
      const current = this.streams.get(userId);
      if (current === undefined) {
        return;
      }
      current.delete(sink);
      // Sin conexiones no queda la entrada vacía: una sesión larga abriendo y cerrando pestañas no hace crecer el mapa.
      if (current.size === 0) {
        this.streams.delete(userId);
      }
    };
  }

  /** Envía el evento a las conexiones abiertas de esa persona y dice cuántas lo recibieron. */
  publish(userId: string, event: string, data: string): number {
    const sinks = this.streams.get(userId);
    if (sinks === undefined) {
      return 0;
    }
    let delivered = 0;
    for (const sink of sinks) {
      if (sink.send(event, data)) {
        delivered += 1;
      }
    }
    return delivered;
  }

  /** `true` si hay alguna conexión abierta en este proceso. */
  get hasListeners(): boolean {
    return this.streams.size > 0;
  }

  /** Cuántas conexiones hay abiertas de esa persona. */
  connectionsOf(userId: string): number {
    return this.streams.get(userId)?.size ?? 0;
  }

  /** Cierra todas las conexiones al apagar el proceso, para que ningún cliente quede esperando un flujo muerto. */
  onApplicationShutdown(): void {
    for (const sinks of this.streams.values()) {
      for (const sink of sinks) {
        sink.close();
      }
    }
    this.streams.clear();
  }
}
