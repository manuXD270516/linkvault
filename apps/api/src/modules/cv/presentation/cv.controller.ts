import {
  resolveCvFileType,
  safeCvFileName,
  type CvDocument,
  type CvFileType,
  type CvListResponse,
  type CvTextPreviewResponse,
} from '@linkvault/shared';
import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../presentation/http/auth-context/authenticated-user';
import { CurrentUser } from '../../../presentation/http/auth-context/current-user.decorator';
import { DeleteCv } from '../application/delete-cv.usecase';
import { GetCvTextPreview } from '../application/get-cv-text-preview.usecase';
import { ListMyCvs } from '../application/list-my-cvs.usecase';
import { SetDefaultCv } from '../application/set-default-cv.usecase';
import {
  UploadCv,
  type AcceptedCvFile,
} from '../application/upload-cv.usecase';
import {
  CvFileTooLarge,
  InvalidCvUpload,
  UnsupportedCvFile,
} from '../domain/errors';
import {
  isNotMultipart,
  translatingMultipartErrors,
} from './multipart-errors';

/** Parte de archivo de `@fastify/multipart`, reducida a lo que esta ruta necesita. */
interface MultipartFilePart {
  readonly filename?: string;
  readonly mimetype?: string;
  /**
   * El stream de la parte. `truncated` lo marca busboy al cortar por `fileSize`, y **no viene con ningún error**: leer
   * el stream a mano termina normalmente con los bytes recortados. Sin mirarlo, un archivo de 6 MiB se guardaría
   * entero a medias.
   */
  readonly file: AsyncIterable<Uint8Array> & { readonly truncated?: boolean };
}

/**
 * Lo que este controlador necesita de la petición: solo `file()`, que añade `@fastify/multipart`. Se declara
 * estructuralmente y no se importa `FastifyRequest` porque `fastify` no es dependencia directa de `api`, y porque
 * pedir menos de lo que hay es lo que permite probar la lectura con un objeto de dos campos.
 *
 * `file` es opcional a propósito: si el plugin no estuviera registrado, la ruta responde `415` en vez de reventar.
 */
export interface MultipartRequest {
  file?: () => Promise<MultipartFilePart | undefined>;
}

/**
 * Los CV de quien pide (spec `cv/documents`). Todas las rutas exigen sesión (guard global) y solo operan sobre los CV
 * de quien pide: el de otra persona, el que no existe y un `:id` mal formado responden el mismo `404 cv_not_found`, y
 * por eso los identificadores de la URL no pasan por ningún pipe.
 *
 * **No hay ninguna ruta que devuelva los bytes del archivo**, ni entera ni por partes, ni una URL firmada. Del texto
 * sale solo la vista previa. Un inventario de rutas lo comprueba.
 */
@Controller('cv')
export class CvController {
  constructor(
    private readonly uploadCv: UploadCv,
    private readonly listMine: ListMyCvs,
    private readonly setDefault: SetDefaultCv,
    private readonly deleteCv: DeleteCv,
    private readonly textPreview: GetCvTextPreview,
  ) {}

  /**
   * `POST /api/cv`, un archivo por petición. El caso de uso manda en el orden (D7) y recibe la lectura como función:
   * aquí solo vive cómo se leen los bytes.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: MultipartRequest,
  ): Promise<CvDocument> {
    return this.uploadCv.execute(user.userId, () => readCvPart(request));
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<CvListResponse> {
    return this.listMine.execute(user.userId);
  }

  @Put(':id/default')
  markDefault(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') cvId: string,
  ): Promise<CvListResponse> {
    return this.setDefault.execute(cvId, user.userId);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') cvId: string,
  ): Promise<CvListResponse> {
    return this.deleteCv.execute(cvId, user.userId);
  }

  /** `private, no-store`: el texto de un CV no se guarda en ninguna caché intermedia ni en la del navegador. */
  @Get(':id/text-preview')
  @Header('Cache-Control', 'private, no-store')
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') cvId: string,
  ): Promise<CvTextPreviewResponse> {
    return this.textPreview.execute(cvId, user.userId);
  }
}

/**
 * Lee la parte `file` decidiendo el tipo **con el primer trozo** (D2).
 *
 * En cuanto se sabe que no es PDF ni DOCX se deja de acumular y el resto del cuerpo se **drena y se tira**, un trozo
 * cada vez. Drenar y no destruir el stream es una elección: lo que se persigue es memoria plana —un trozo en vez de
 * 5 MiB—, no ahorrar tráfico, y cortar la conexión mientras el cliente escribe puede hacer que **el `415` no le
 * llegue** y la persona vea "algo falló" en vez de "solo aceptamos PDF o DOCX". El ancho de banda lo acota, por arriba,
 * el `fileSize` del plugin.
 *
 * La traducción de los errores del parser envuelve **la obtención de la parte y el bucle**: el error de tamaño sale del
 * bucle, no de `request.file()`.
 */
export async function readCvPart(
  request: MultipartRequest,
): Promise<AcceptedCvFile> {
  return await translatingMultipartErrors(async () => {
    const part = await partOf(request);
    if (part === undefined) {
      // No hay error que traducir: `request.file()` devuelve `undefined`. Es el caso más común de un formulario mal
      // montado, y también acaba en `400` nombrando `file`.
      throw new InvalidCvUpload();
    }
    const fileName = part.filename ?? '';
    let fileType: CvFileType | undefined;
    let rejected = false;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of part.file) {
      if (rejected) {
        // Drenar y tirar: se sigue leyendo el cuerpo para que el cliente termine y reciba el `415`, pero no se guarda
        // nada. Es el mismo bucle a propósito: dos iteradores sobre el mismo stream se pisarían.
        continue;
      }
      if (fileType === undefined) {
        fileType = resolveCvFileType({
          contentType: part.mimetype,
          fileName,
          bytes: chunk,
        });
        if (fileType === undefined) {
          rejected = true;
          continue;
        }
      }
      chunks.push(chunk);
      size += chunk.byteLength;
    }
    if (rejected || fileType === undefined) {
      // `fileType` sin resolver y sin rechazo es una parte vacía: no hay primer trozo del que fiarse.
      throw new UnsupportedCvFile();
    }
    if (part.file.truncated === true) {
      // El tope se comprueba **después del bucle** porque es ahí donde se sabe: busboy corta el stream y lo termina
      // sin error, así que lo único que queda es la marca. Nada se sube: no hay archivos a medias en el almacén.
      throw new CvFileTooLarge();
    }
    return {
      fileName: safeCvFileName(fileName, fileType),
      fileType,
      bytes: join(chunks, size),
    };
  });
}

/** La parte de archivo, traduciendo "esto no es multipart" a `415 unsupported_media_type`. */
async function partOf(
  request: MultipartRequest,
): Promise<MultipartFilePart | undefined> {
  if (typeof request.file !== 'function') {
    throw new UnsupportedMediaTypeException();
  }
  try {
    return await request.file();
  } catch (error) {
    if (isNotMultipart(error)) {
      // "El cuerpo de la petición no es multipart" no es "el archivo no vale": el SPA las explica distinto.
      throw new UnsupportedMediaTypeException();
    }
    throw error;
  }
}

function join(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
