// Lista canónica de los tipos que el redactor sustituye para proveedores externos (ADR-030 §10,
// specs/ai/data-protection). `libs/ai` deriva de aquí su `PiiKind` y las tres pantallas derivan su enumeración: escribir
// la lista a mano en cada sitio acabaría con tres redacciones distintas en la cabeza de quien lee.
//
// `libs/shared` NO importa nada de `libs/ai`: la dependencia va al revés.

/** Identificadores de tipo, en minúsculas, tal y como los nombran las pantallas. */
export const REDACTED_DATA_TYPE_IDS = [
  'email',
  'phone',
  'url',
  'address',
  'id',
  'name',
] as const;

export type RedactedDataTypeId = (typeof REDACTED_DATA_TYPE_IDS)[number];

/** Tipo que se sustituye siempre, sin interruptor. */
export interface AlwaysRedactedDataType {
  readonly type: Exclude<RedactedDataTypeId, 'name'>;
  readonly switchDependent: false;
}

/**
 * Tipo cuya sustitución depende de un interruptor. `switchFactoryDefault` es el estado de fábrica de ese interruptor
 * (`redactName` nace activado: el nombre no aporta señal de encaje y es el dato que más identifica).
 */
export interface SwitchDependentRedactedDataType {
  readonly type: 'name';
  readonly switchDependent: true;
  readonly switchFactoryDefault: true;
}

export type RedactedDataType =
  | AlwaysRedactedDataType
  | SwitchDependentRedactedDataType;

/**
 * Lista canónica: cada entrada dice si depende de un interruptor y, si sí, en qué estado nace. Añadir un detector
 * sin actualizar esta lista debe romper los tests de `libs/ai` que derivan `PiiKind` de aquí.
 */
export const REDACTED_DATA_TYPES = [
  { type: 'email', switchDependent: false },
  { type: 'phone', switchDependent: false },
  { type: 'url', switchDependent: false },
  { type: 'address', switchDependent: false },
  { type: 'id', switchDependent: false },
  { type: 'name', switchDependent: true, switchFactoryDefault: true },
] as const satisfies readonly RedactedDataType[];
