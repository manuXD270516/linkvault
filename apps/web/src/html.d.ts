/** Documentos HTML importados como texto (`with { loader: 'text' }`); hoy, el `index.html` en su spec. */
declare module '*.html' {
  const content: string;
  export default content;
}
