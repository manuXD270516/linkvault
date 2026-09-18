// Páginas reales recortadas y anonimizadas, para probar el parser y los extractores sin tocar la red (ADR-003, Risks
// de design.md). Son las dos bolsas que el Context de design.md midió como legibles.
//
// Van como texto en un `.ts` y no como ficheros `.html` sueltos para que las lea igual el compilador de la app
// (CommonJS) que Vitest (ESM), sin `import.meta` ni rutas relativas al directorio de trabajo.
//
// Ninguna lleva datos de una persona real: la empresa, el correo y el teléfono son de ejemplo, y están sembrados a
// propósito para que el test de higiene del texto tenga qué demostrar.

/**
 * Trabajopolis: `JobPosting` completo en JSON-LD, que es de donde sale su preview. Trae además scripts y estilos que
 * no deben acabar en el texto limpio, y su `<main>` acota el cuerpo del aviso.
 */
export const TRABAJOPOLIS_PAGE = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Arquitecto(a) de Soluciones | Trabajopolis</title>
<script type="application/ld+json">
{
  "@context": "http://schema.org/",
  "@type": "JobPosting",
  "datePosted": "2026-09-14T14:37:42-04:00",
  "validThrough": "2026-10-14T14:37:42-04:00",
  "employmentType": "FULL_TIME",
  "title": "Arquitecto(a) de Soluciones",
  "description": "<p>Arquitecto(a) de Soluciones</p><p>Empresa Ejemplo busca incorporar a su equipo un arquitecto de soluciones con experiencia en integraciones, microservicios y nube.</p><ul><li>5 años de experiencia</li><li>Java, Spring Boot</li><li>Inglés intermedio</li></ul><p>Postula a empleos@empresa.example o al 70000000.</p>",
  "hiringOrganization": {
    "@type": "Organization",
    "name": "Empresa Ejemplo"
  },
  "identifier": {
    "@type": "PropertyValue",
    "name": "Empresa Ejemplo",
    "value": "1238122"
  },
  "jobLocation": {
    "@type": "Place",
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "La Paz",
      "addressCountry": "BO"
    }
  },
  "directApply": true
}
</script>
</head>
<body>
<main>
<h1>Arquitecto(a) de Soluciones</h1>
<p>Empresa Ejemplo &middot; La Paz</p>
<p>Escribe a empleos@empresa.example o llama al 70000000.</p>
</main>
<script>console.log('esto no debe aparecer en el texto limpio');</script>
<style>.oculto { display: none; }</style>
</body>
</html>
`;

/**
 * Get on Board: sin JSON-LD, con Open Graph rico y los atributos **en orden invertido** (`content` antes que
 * `property`), que es el orden real de ese sitio. Es válido en HTML y rompe cualquier regex ingenua: por eso el parseo
 * usa un parser de verdad. Tampoco tiene `<main>`, así que el texto sale del `<body>`.
 */
export const GETONBRD_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Full-Stack Developer Senior at Empresa Ejemplo - Remote (work from home) | Get on Board</title>
<meta content="https://www.getonbrd.com/jobs/programming/full-stack-developer-senior-ejemplo-remote-afcb" property="og:url">
<meta content="website" property="og:type">
<meta content="Full-Stack Developer Senior at Empresa Ejemplo - Remote (work from home)" property="og:title">
<meta content="Get on Board" property="og:site_name">
<meta content="Trabajo remoto Full time: Experiencia senior con TypeScript: minimo 6 anos en desarrollo de software y al menos 3 con React y Node." property="og:description">
<meta content="Trabajo remoto Full time: Experiencia senior con TypeScript." name="description">
</head>
<body>
<h1>Full-Stack Developer Senior</h1>
<p>Empresa Ejemplo &middot; Remote</p>
<p>Escribe a jobs@empresa.example.</p>
</body>
</html>
`;
