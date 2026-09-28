/**
 * Un PDF mínimo escrito a mano: catálogo, páginas, una página con Helvetica y un flujo de contenido con el texto en
 * operadores `Tj`. Se escribe aquí y no se commitea ningún binario, y así el archivo tampoco puede llevar metadatos de
 * nadie. Es ASCII puro a propósito: las cadenas de PDF sin diccionario de codificación no llevan acentos.
 *
 * Movido de `cv.spec.ts` sin cambios (change `e2e-suite`, tarea 5.4) para que lo use también el camino crítico.
 * Ojo con el tamaño: un PDF de menos de 4 kB entra en el *pool* de `Buffer` de Node y `pdf-parse` lo lee desplazado
 * ("bad XRef entry"); las líneas tienen que dar un archivo más grande (ver `CV_LINES` de `cv.spec.ts`).
 */
export function minimalPdf(lines: readonly string[]): Buffer {
  const content = [
    'BT',
    '/F1 12 Tf',
    '72 720 Td',
    ...lines.flatMap((line) => [`(${escapePdfText(line)}) Tj`, '0 -16 Td']),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  // Cada entrada de la tabla ocupa **exactamente** 20 bytes y termina en `espacio CR LF`, que es la forma que manda el
  // formato. No es una manía: con `\n` a secas, y aun midiendo 20 bytes, el parser de PDF rechaza la tabla entera con
  // un "bad XRef entry" —se comprobó con el mismo `pdf-parse` que usa el worker—, y el CV acabaría en `failed`.
  const startxref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \r\n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \r\n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** Dentro de una cadena de PDF, `\`, `(` y `)` van escapados; el texto de prueba no los usa, pero el molde sí lo hace. */
function escapePdfText(line: string): string {
  return line.replace(/([\\()])/g, '\\$1');
}
