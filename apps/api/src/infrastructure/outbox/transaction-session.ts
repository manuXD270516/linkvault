// Sesión de la transacción que comparten los puertos de escritura (D3 y D6 de job-links). `application` no sabe lo que
// es: la abre el adaptador del repositorio que manda en la transacción, la reparte entre los demás puertos y solo él
// la entiende. Así el caso de uso escribe el agregado y el evento del outbox en la misma transacción sin importar
// `mongoose` ni nada de infraestructura.
//
// Es un **contrato de plataforma** y vive aquí, junto al puerto del outbox que la usa (D11 de cv-upload-extract,
// ADR-028 §9): la comparten `links` y `cv`, y ningún `domain/` la importa.

/** Opaca a propósito: quien la recibe solo la pasa adelante. */
export type TransactionSession = object;
