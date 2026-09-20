// Sesión de la transacción que comparten los puertos de escritura (D3 y D6 de job-links). `application` no sabe lo que
// es: la abre el adaptador de `JOB_LINK_REPOSITORY`, la reparte entre los demás puertos y solo él la entiende. Así el
// caso de uso escribe el link, su relación con el destino y el evento del outbox en la misma transacción sin importar
// `mongoose` ni nada de infraestructura.

/** Opaca a propósito: quien la recibe solo la pasa adelante. */
export type TransactionSession = object;
