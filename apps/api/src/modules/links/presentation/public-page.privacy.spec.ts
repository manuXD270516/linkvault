import {
  type GroupDetail,
  type PublicShare,
  type SaveLinkResponse,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createLinksTestApp,
  type LinksTestApp,
  type TestMember,
} from '../../../test-support/links-test-app';
import { JOB_LINKS_COLLECTION } from '../infrastructure/link.schemas';

// Qué no sale nunca (tarea 6.14 de public-preview-share, D6 y ADR-027 §3). Una oferta con TODO lo que no se publica
// —resumen, habilidades, idiomas, procedencia por campo, nota y comentarios—, en un grupo con nombre reconocible y con
// un `displayUrl` con credenciales y rastro.

const RECRUITER_NOTE =
  'Escríbele a la reclutadora Valeria Quispe al 700-12345, dice que va de mi parte';
const DIRTY_URL =
  'https://ana:secreto@bolsa.example/ofertas?jk=42&utm_source=mail&mc_eid=ana%40example.com#detalle';

describe('la página pública no filtra nada', () => {
  let http: LinksTestApp;
  let ana: TestMember;
  let beto: TestMember;
  let group: GroupDetail;
  let share: PublicShare;
  let linkId: string;

  beforeAll(async () => {
    http = await createLinksTestApp('links-public-privacy', getMongoTestUri());
    ana = await http.authenticated('Ana');
    beto = await http.authenticated('Beto');
    group = await http.createGroup(ana, 'Backend Bolivia');
    await http.join(beto, group);

    const saved = await http.request('POST', '/api/links', {
      authorization: ana.authorization,
      body: {
        url: DIRTY_URL,
        groupId: group.id,
        note: 'Esta es la que te dije, pregunta por Valeria',
      },
    });
    expect(saved.statusCode).toBe(201);
    const body = saved.json<SaveLinkResponse>();
    linkId = body.link.id;
    const published = body.link.publicShare;
    if (published === undefined) {
      throw new Error('El grupo comparte en público: el link nace publicado');
    }
    share = published;

    await http.request(
      'POST',
      `/api/groups/${group.id}/links/${linkId}/comments`,
      {
        authorization: beto.authorization,
        body: { text: 'Piden inglés C1 y conocer a Valeria' },
      },
    );

    // Preview completo, con todo lo que NO se publica, escrito directamente para no depender de la extracción.
    await http.connection.collection(JOB_LINKS_COLLECTION).updateOne(
      {},
      {
        $set: {
          previewStatus: 'enriched',
          preview: {
            title: 'Backend Senior',
            company: 'Acme',
            location: 'La Paz',
            modality: 'remote',
            seniority: 'senior',
            salary: {
              min: 8000,
              max: 12_000,
              currency: 'BOB',
              period: 'month',
            },
            skills: [{ name: 'Node', required: true }],
            languages: [{ name: 'Inglés', level: 'C1' }],
            summary: RECRUITER_NOTE,
            postedAt: '2026-09-01',
            expiresAt: '2026-10-01',
          },
          previewSources: {
            title: {
              value: 'Backend Senior',
              source: 'manual',
              by: ana.userId,
              at: '2026-09-18T11:00:00.000Z',
            },
          },
        },
      },
    );
  });

  afterAll(async () => {
    await http.close();
  });

  /** Los dos cuerpos públicos: el HTML de la página y el JSON del endpoint del SPA. */
  async function publicBodies(): Promise<string[]> {
    const page = await http.request('GET', `/p/${share.slug}`);
    const preview = await http.request(
      'GET',
      `/api/public/previews/${share.slug}`,
    );

    expect(page.statusCode).toBe(200);
    expect(preview.statusCode).toBe(200);
    return [page.body, preview.body];
  }

  it('Oferta con resumen y habilidades: no sale ninguno de los dos', async () => {
    for (const body of await publicBodies()) {
      expect(body).not.toContain(RECRUITER_NOTE);
      expect(body).not.toContain('Valeria');
      // `summary_large_image` es el tipo de tarjeta de Twitter, no el resumen: se busca el nombre del campo.
      expect(body).not.toMatch(/\bsummary["':]/);
      expect(body).not.toContain('skills');
      expect(body).not.toContain('languages');
      expect(body).not.toContain('Inglés');
      expect(body).not.toContain('previewSources');
      expect(body).not.toContain('previewStatus');
    }
  });

  it('La página no dice de qué grupo viene ni quién la compartió', async () => {
    for (const body of await publicBodies()) {
      expect(body).not.toContain('Backend Bolivia');
      expect(body).not.toContain('Ana');
      expect(body).not.toContain('Beto');
      expect(body).not.toContain(ana.userId);
      expect(body).not.toContain(group.id);
      expect(body).not.toContain(linkId);
      expect(body).not.toContain('Esta es la que te dije');
      expect(body).not.toContain('Piden inglés C1');
    }
  });

  it('URL original con credenciales y rastro: sale saneada y con el fragmento', async () => {
    for (const body of await publicBodies()) {
      expect(body).toContain('https://bolsa.example/ofertas?jk=42#detalle');
      expect(body).not.toContain('secreto');
      expect(body).not.toContain('utm_source');
      expect(body).not.toContain('mc_eid');
      expect(body).not.toContain('example.com');
    }
  });

  /**
   * El slug es **opaco** (decisión humana 1, ADR-027 §2): nada del contenido entra en él. Se comprueba aquí porque es
   * donde el título, la empresa y el nombre del grupo son reconocibles.
   */
  it('Enlace público opaco', async () => {
    expect(share.slug).toHaveLength(12);
    expect(share.slug).toMatch(/^[23456789abcdefghjkmnpqrstvwxyz]{12}$/);
    for (const secret of [
      'backend',
      'senior',
      'acme',
      'bolivia',
      'lapaz',
      linkId,
      group.id,
      ana.userId,
    ]) {
      expect(share.slug).not.toContain(secret.toLowerCase());
    }
  });

  it('Preview escrito a mano', async () => {
    // `title` lo escribió Ana (`previewSources.title.source === 'manual'`): el valor se publica igual, sin decir
    // quién lo puso.
    for (const body of await publicBodies()) {
      expect(body).toContain('Backend Senior');
      expect(body).not.toContain('manual');
      expect(body).not.toContain('Ana');
      expect(body).not.toContain(ana.userId);
    }
  });

  it('sí sale la vacante', async () => {
    const [page, preview] = await publicBodies();

    for (const body of [page, preview]) {
      expect(body).toContain('Backend Senior');
      expect(body).toContain('Acme');
      expect(body).toContain('La Paz');
    }
    expect(page).toContain('Remoto');
    expect(page).toContain('Senior');
    expect(page).toContain('8.000 – 12.000 BOB al mes');
  });

  it('el listado del grupo sí lleva lo suyo, que es otra cosa', async () => {
    const list = await http.request('GET', `/api/groups/${group.id}/links`, {
      authorization: beto.authorization,
    });

    expect(list.statusCode).toBe(200);
    // Lo que la página esconde, el grupo lo ve: es la diferencia entre publicar y compartir.
    expect(list.body).toContain('Ana');
    expect(list.body).toContain('Esta es la que te dije');
    expect(list.body).toContain(share.slug);
  });

  it('la lista privada no trae enlace público', async () => {
    await http.request('POST', '/api/links', {
      authorization: beto.authorization,
      body: { url: 'https://empresa.example/careers/privado' },
    });

    const mine = await http.request('GET', '/api/links/mine', {
      authorization: beto.authorization,
    });

    expect(mine.statusCode).toBe(200);
    expect(mine.body).not.toContain('publicShare');
  });
});
