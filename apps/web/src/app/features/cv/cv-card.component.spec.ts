import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { CvDocument, CvExtraction } from '@linkvault/shared';
import { CvCard, fileSizeLabel } from './cv-card.component';

function cv(overrides: Partial<CvDocument> = {}): CvDocument {
  return {
    id: 'cv1',
    fileName: 'CV_backend.pdf',
    fileType: 'pdf',
    sizeBytes: 319_488,
    version: 7,
    isDefault: false,
    uploadedAt: '2026-09-12T10:00:00.000Z',
    extraction: { status: 'extracted', textChars: 8_412, extractedAt: '2026-09-12T10:00:05.000Z' },
    matchAnalysesCount: 0,
    ...overrides,
  };
}

function failed(reason: CvExtraction['failureReason']): CvExtraction {
  return { status: 'failed', failureReason: reason, textChars: 0 };
}

describe('CvCard', () => {
  let fixture: ComponentFixture<CvCard>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(CvCard);
  });

  async function show(document: CvDocument, hasOtherExtracted = false): Promise<HTMLElement> {
    fixture.componentRef.setInput('cv', document);
    fixture.componentRef.setInput('hasOtherExtracted', hasOtherExtracted);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  function text(host: HTMLElement): string {
    return host.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function actions(host: HTMLElement): (string | undefined)[] {
    return Array.from(host.querySelectorAll('button')).map((button) => button.textContent?.trim());
  }

  it('identifica el CV por su nombre, su tamaño y su fecha', async () => {
    const host = await show(cv());

    expect(host.querySelector('[data-testid="cv-name"]')?.textContent?.trim()).toBe(
      'CV_backend.pdf · 312 KB · 12/09/2026',
    );
    // Ni el número de versión ni los caracteres leídos: ninguno de los dos le dice nada a quien mira.
    expect(text(host)).not.toContain('7');
    expect(text(host)).not.toContain('8.412');
    expect(text(host)).not.toContain('8412');
  });

  it('Estamos leyendo tu CV', async () => {
    const host = await show(cv({ extraction: { status: 'pending', textChars: 0 } }));

    expect(text(host)).toContain('Estamos leyendo tu CV…');
    // Sin texto guardado no hay nada que enseñar.
    expect(actions(host)).not.toContain('Ver lo que leímos');
  });

  it('el CV leído dice que se leyó bien y ofrece verlo', async () => {
    const host = await show(cv());

    expect(text(host)).toContain('Listo · tu CV se leyó bien');
    expect(actions(host)).toContain('Ver lo que leímos');
  });

  it('Un CV que no se pudo leer', async () => {
    const host = await show(cv({ fileType: 'pdf', extraction: failed('no_text') }));

    expect(text(host)).toContain('Este archivo no tiene texto: parece un escaneo o una imagen.');
    expect(text(host)).toContain(
      'Sube el PDF original (no una foto ni un escaneo) o vuelve a exportarlo desde tu editor',
    );
    expect(actions(host)).toContain('Eliminar');
    expect(actions(host)).not.toContain('Ver lo que leímos');
  });

  it('Un DOCX sin texto', async () => {
    const host = await show(
      cv({ fileName: 'CV_backend.docx', fileType: 'docx', extraction: failed('no_text') }),
    );

    expect(text(host)).toContain('Vuelve a exportarlo desde tu editor y súbelo otra vez');
    expect(text(host)).not.toContain('PDF original');
  });

  it('Un CV protegido con contraseña', async () => {
    const host = await show(cv({ extraction: failed('unreadable_file') }));

    expect(text(host)).toContain(
      'No pudimos abrir este archivo. Si tiene contraseña, quítasela y vuelve a subirlo.',
    );
  });

  it('el fallo nuestro dice cuándo volver', async () => {
    const host = await show(cv({ extraction: failed('internal_error') }));

    expect(text(host)).toContain('No pudimos leerlo ahora. Vuelve a subirlo en un rato.');
  });

  it('El marcado no se pudo leer', async () => {
    const host = await show(cv({ isDefault: true, extraction: failed('no_text') }), true);

    expect(host.querySelector('[data-testid="cv-default-useless"]')?.textContent?.trim()).toBe(
      'No servirá para analizar vacantes',
    );
    expect(actions(host)).toContain('Usar el que sí se leyó');
  });

  it('El aviso no repite el diagnóstico', async () => {
    const host = await show(cv({ isDefault: true, extraction: failed('unreadable_file') }), true);

    const notice = host.querySelector('[data-testid="cv-default-useless"]')?.textContent ?? '';
    // La consecuencia y la salida; el diagnóstico ya lo dio el estado, y repetirlo gasta la línea.
    expect(notice).not.toContain('No pudimos');
    expect(notice).not.toContain('leer');
  });

  it('No hay otro que se leyera', async () => {
    const host = await show(cv({ isDefault: true, extraction: failed('no_text') }), false);

    expect(host.querySelector('[data-testid="cv-default-useless"]')).not.toBeNull();
    expect(actions(host)).not.toContain('Usar el que sí se leyó');
  });

  it('el CV marcado que sí se leyó no avisa de nada', async () => {
    const host = await show(cv({ isDefault: true }), true);

    expect(host.querySelector('[data-testid="cv-default-useless"]')).toBeNull();
  });

  it('Sin descarga', async () => {
    const host = await show(cv({ isDefault: true }));

    expect(actions(host)).toEqual(['Ver lo que leímos', 'Eliminar']);
    for (const forbidden of ['Descargar', 'Abrir', 'Compartir', 'Copiar']) {
      expect.soft(text(host)).not.toContain(forbidden);
    }
    expect(host.querySelectorAll('a')).toHaveLength(0);
  });

  it('escribe el tamaño en KB hasta el mega y en MB a partir de ahí', () => {
    expect(fileSizeLabel(319_488)).toBe('312 KB');
    expect(fileSizeLabel(1_048_576)).toBe('1.0 MB');
    expect(fileSizeLabel(4 * 1024 * 1024 + 512 * 1024)).toBe('4.5 MB');
    // Un archivo diminuto nunca se anuncia como "0 KB".
    expect(fileSizeLabel(10)).toBe('1 KB');
  });
});
