import { HttpClient, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  CvDocument,
  CvListResponse,
  CvTextPreviewResponse,
} from '@linkvault/shared';
import { type Observable, filter, firstValueFrom, map } from 'rxjs';

const CV_URL = '/api/cv';

/**
 * Lo que la subida va contando mientras ocurre (D13):
 * - `progress`: porcentaje subido, o `null` cuando el navegador no sabe el total;
 * - `uploaded`: la respuesta `201` con el CV ya guardado, que es lo último que emite.
 */
export type CvUploadEvent =
  | { kind: 'progress'; percent: number | null }
  | { kind: 'uploaded'; document: CvDocument };

/**
 * Llamadas a `/api/cv`. El `Authorization: Bearer` lo pone `authInterceptor`, como en el resto de `core/`. Solo importa
 * tipos de `@linkvault/shared`.
 *
 * **No hay ninguna llamada de descarga**, y no es un olvido: la API no expone ninguna ruta que devuelva los bytes del
 * archivo (decisión humana 1 del change, ADR-028 §5). Del texto solo sale la vista previa.
 */
@Injectable({ providedIn: 'root' })
export class CvApi {
  private readonly http = inject(HttpClient);

  /** Los CV guardados, del más reciente al más antiguo. Sin paginación: el máximo son 5. */
  async list(): Promise<CvDocument[]> {
    const response = await firstValueFrom(this.http.get<CvListResponse>(CV_URL));
    return response.items;
  }

  /**
   * Sube el archivo como `multipart/form-data` con **una sola parte**, llamada `file`: la API acepta un archivo y cero
   * campos (`fields: 0`), así que cualquier campo de texto extra acabaría en un `400`.
   *
   * Devuelve el progreso mientras sube y, al final, el CV creado. No se le pone `Content-Type`: lo compone el navegador
   * con el `boundary`, que es justo lo que el parser necesita.
   */
  upload(file: File): Observable<CvUploadEvent> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.http
      .post<CvDocument>(CV_URL, body, { reportProgress: true, observe: 'events' })
      .pipe(
        map((event): CvUploadEvent | null => {
          if (event.type === HttpEventType.UploadProgress) {
            return {
              kind: 'progress',
              percent:
                event.total === undefined || event.total === 0
                  ? null
                  : Math.min(100, Math.round((event.loaded / event.total) * 100)),
            };
          }
          if (event.type === HttpEventType.Response && event.body !== null) {
            return { kind: 'uploaded', document: event.body };
          }
          return null;
        }),
        // Los demás eventos de `HttpClient` (`Sent`, cabeceras de respuesta) no le dicen nada a la pantalla.
        filter((event): event is CvUploadEvent => event !== null),
      );
  }

  /** Marca ese CV como el que se comparará con las vacantes; responde con la lista ya actualizada. */
  async setDefault(cvId: string): Promise<CvDocument[]> {
    const response = await firstValueFrom(
      this.http.put<CvListResponse>(`${cvUrl(cvId)}/default`, null),
    );
    return response.items;
  }

  /** Borra el CV y su archivo; responde con la lista ya actualizada, con el nuevo marcado si hacía falta. */
  async remove(cvId: string): Promise<CvDocument[]> {
    const response = await firstValueFrom(this.http.delete<CvListResponse>(cvUrl(cvId)));
    return response.items;
  }

  /** El principio del texto que se leyó del CV, para comprobar que sirve. Ni el texto entero ni el archivo salen. */
  textPreview(cvId: string): Promise<CvTextPreviewResponse> {
    return firstValueFrom(
      this.http.get<CvTextPreviewResponse>(`${cvUrl(cvId)}/text-preview`),
    );
  }
}

function cvUrl(cvId: string): string {
  return `${CV_URL}/${encodeURIComponent(cvId)}`;
}
