// jsdom no publica tipos y el script solo necesita su `DOMParser`: se declara lo mínimo en lugar de añadir @types/jsdom.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string);
    readonly window: { readonly DOMParser: typeof DOMParser };
  }
}
