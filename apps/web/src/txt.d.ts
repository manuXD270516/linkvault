/** Ficheros de texto plano importados con `with { loader: 'text' }` (hoy, `public/robots.txt` en su spec). */
declare module '*.txt' {
  const content: string;
  export default content;
}
