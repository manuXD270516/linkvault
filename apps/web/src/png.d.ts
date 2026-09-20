/** Imágenes importadas como bytes (`with { loader: 'binary' }`); hoy, la imagen Open Graph en su spec. */
declare module '*.png' {
  const content: Uint8Array;
  export default content;
}
