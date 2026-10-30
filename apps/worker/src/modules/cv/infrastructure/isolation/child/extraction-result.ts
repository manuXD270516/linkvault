import type { ChildFailureCause } from '../child-protocol';

/** Lo que devuelven las rutas de lectura del hijo (PDF y DOCX), antes de convertirse en un mensaje del canal. */
export type ChildExtraction =
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly pagesCapped: boolean;
      readonly rawCapped: boolean;
    }
  | { readonly kind: 'failed'; readonly cause: ChildFailureCause };
