import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { CV_MAX_FILE_BYTES } from '@linkvault/shared';
import { CV_UPLOAD_ACCEPT, CvUpload } from './cv-upload.component';

function fileOf(name: string, size: number, type = ''): File {
  const file = new File([''], name, { type });
  // `File` no deja fijar el tamaño en el constructor sin crear el contenido entero; 7 MB de relleno en un test no.
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('CvUpload', () => {
  let fixture: ComponentFixture<CvUpload>;
  let chosen: File[];

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(CvUpload);
    chosen = [];
    fixture.componentInstance.chosen.subscribe((file: File) => chosen.push(file));
    await fixture.whenStable();
  });

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return host().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function fileInput(): HTMLInputElement {
    const input = host().querySelector<HTMLInputElement>('[data-testid="cv-file-input"]');
    if (!input) {
      throw new Error('File input not rendered');
    }
    return input;
  }

  /** Elige un archivo como lo haría el selector del sistema, sin tocar el `FileList` real. */
  async function choose(file: File): Promise<void> {
    const input = fileInput();
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  }

  it('El botón manda', async () => {
    const button = host().querySelector<HTMLButtonElement>('[data-testid="cv-upload-button"]');

    expect(button?.textContent?.trim()).toBe('Subir CV');
    // El selector está oculto: lo abre el botón, que es la acción principal y visible.
    expect(fileInput().className).toContain('hidden');
    // La zona para soltar existe, pero es la alternativa: rodea al botón y lo dice en su texto.
    expect(host().querySelector('[data-testid="cv-dropzone"]')).not.toBeNull();
    expect(text()).toContain('O suelta aquí tu CV en PDF o DOCX');

    button?.click();
    await fixture.whenStable();
  });

  it('acepta las extensiones y también los tipos MIME', () => {
    expect(fileInput().getAttribute('accept')).toBe(CV_UPLOAD_ACCEPT);
    expect(CV_UPLOAD_ACCEPT.split(',')).toEqual([
      '.pdf',
      'application/pdf',
      '.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);
  });

  it('Archivo que no admitimos', async () => {
    await choose(fileOf('CV_Ana.odt', 1024, 'application/vnd.oasis.opendocument.text'));

    expect(text()).toContain('Solo aceptamos PDF o DOCX');
    expect(chosen).toHaveLength(0);
  });

  it('Archivo demasiado grande', async () => {
    await choose(fileOf('CV_Ana.pdf', 7 * 1024 * 1024, 'application/pdf'));

    expect(text()).toContain('Ese archivo pesa más de 5 MB');
    expect(chosen).toHaveLength(0);
    // El texto de la pantalla dice el mismo número que comprueban el SPA y la API.
    expect(CV_MAX_FILE_BYTES).toBe(5 * 1024 * 1024);
  });

  it('ofrece el archivo admisible y olvida el aviso anterior', async () => {
    await choose(fileOf('CV_Ana.odt', 1024));
    await choose(fileOf('CV_Ana.pdf', 2 * 1024 * 1024, 'application/pdf'));

    expect(chosen.map((file) => file.name)).toEqual(['CV_Ana.pdf']);
    expect(text()).not.toContain('Solo aceptamos PDF o DOCX');
  });

  it('acepta un DOCX que llega sin tipo MIME útil', async () => {
    await choose(fileOf('CV_Ana.docx', 1024, 'application/octet-stream'));

    expect(chosen).toHaveLength(1);
  });

  it('Doble pulsación', async () => {
    fixture.componentRef.setInput('uploading', true);
    fixture.componentRef.setInput('percent', 40);
    await fixture.whenStable();

    const button = host().querySelector<HTMLButtonElement>('[data-testid="cv-upload-button"]');
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(host().querySelector('[data-testid="cv-upload-progress"]')).not.toBeNull();

    await choose(fileOf('CV_Ana.pdf', 1024, 'application/pdf'));

    expect(chosen).toHaveLength(0);
  });
});
