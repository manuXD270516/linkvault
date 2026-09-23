import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type {
  EnrichableLink,
  LinkRepository,
  PreviewWrite,
} from '../../application/ports/link-repository.port';
import {
  JOB_LINK_MODEL_NAME,
  toLinkObjectId,
  type JobLinkDocument,
} from './link.schemas';

// Adaptador Mongo de `LINK_REPOSITORY` (D2 de link-enrichment). Todo lo interesante está en `writePreview`: el filtro
// lleva la versión leída y la actualización la sube en uno, en la misma operación atómica. Si `modifiedCount` es cero,
// alguien escribió entre la lectura y la escritura y este trabajo ya quedó viejo.
//
// No hay transacción y no hace falta: es una sola escritura sobre un solo documento.

@Injectable()
export class MongoLinkRepository implements LinkRepository {
  constructor(
    @InjectModel(JOB_LINK_MODEL_NAME)
    private readonly links: Model<JobLinkDocument>,
  ) {}

  async findById(linkId: string): Promise<EnrichableLink | null> {
    const id = toLinkObjectId(linkId);
    if (id === null) return null;

    const found = await this.links.findById(id).lean().exec();
    if (found === null) return null;

    return {
      id: found._id.toHexString(),
      displayUrl: found.displayUrl,
      // `api` crea todo link con su historial; si faltara, la única URL segura es la que se abre.
      originalUrls:
        found.originalUrls !== undefined && found.originalUrls.length > 0
          ? [...found.originalUrls]
          : [found.displayUrl],
      createdBy: found.createdBy.toHexString(),
      previewStatus: found.previewStatus,
      previewVersion: found.previewVersion,
      preview: found.preview ?? {},
      previewSources: found.previewSources ?? {},
      ...(found.platform === undefined
        ? {}
        : { platform: found.platform as EnrichableLink['platform'] }),
      ...(found.closedAt === undefined ? {} : { closedAt: found.closedAt }),
      ...(found.closedReason === undefined
        ? {}
        : { closedReason: found.closedReason }),
      ...(found.lastFreshnessCheckAt === undefined
        ? {}
        : { lastFreshnessCheckAt: found.lastFreshnessCheckAt }),
      ...(found.previewRequestedAt === undefined
        ? {}
        : { previewRequestedAt: found.previewRequestedAt }),
    };
  }

  async writePreview(
    linkId: string,
    expectedVersion: number,
    write: PreviewWrite,
  ): Promise<boolean> {
    const id = toLinkObjectId(linkId);
    if (id === null) return false;

    const $set: Record<string, unknown> = {
      previewStatus: write.previewStatus,
      preview: write.preview,
      previewSources: write.previewSources,
      updatedAt: write.at,
    };
    // Un enriquecimiento que sale bien **borra** el motivo del intento anterior: dejarlo ahí haría que la tarjeta
    // siguiera contando un fallo que ya no existe.
    if (write.lastEnrichmentError !== null) {
      $set['lastEnrichmentError'] = write.lastEnrichmentError;
    }
    if (write.lastFreshnessCheckAt !== undefined) {
      $set['lastFreshnessCheckAt'] = write.lastFreshnessCheckAt;
    }

    const result = await this.links
      .updateOne(
        // La versión en el filtro es lo que convierte "leer y escribir" en una sola decisión atómica.
        { _id: id, previewVersion: expectedVersion },
        {
          $set,
          $inc: { previewVersion: 1 },
          ...(write.lastEnrichmentError === null
            ? { $unset: { lastEnrichmentError: '' } }
            : {}),
        },
      )
      .exec();

    return result.modifiedCount === 1;
  }

  async closeIfOpen(
    linkId: string,
    write: {
      readonly closedAt: Date;
      readonly closedReason: 'calendar' | 'recheck';
      readonly lastFreshnessCheckAt: Date;
    },
  ): Promise<boolean> {
    const id = toLinkObjectId(linkId);
    if (id === null) return false;

    const closed = await this.links
      .updateOne(
        { _id: id, closedAt: { $exists: false } },
        {
          $set: {
            closedAt: write.closedAt,
            closedReason: write.closedReason,
            lastFreshnessCheckAt: write.lastFreshnessCheckAt,
            updatedAt: write.closedAt,
          },
        },
      )
      .exec();
    if (closed.modifiedCount === 1) return true;

    await this.links
      .updateOne(
        { _id: id, closedAt: { $exists: true } },
        { $set: { lastFreshnessCheckAt: write.lastFreshnessCheckAt } },
      )
      .exec();
    return false;
  }

  async touchFreshnessCheck(linkId: string, at: Date): Promise<void> {
    const id = toLinkObjectId(linkId);
    if (id === null) return;
    await this.links
      .updateOne(
        { _id: id },
        { $set: { lastFreshnessCheckAt: at, updatedAt: at } },
      )
      .exec();
  }

  async saveSnapshotKey(linkId: string, snapshotKey: string): Promise<void> {
    const id = toLinkObjectId(linkId);
    if (id === null) return;

    // Sin condición de versión a propósito: quien llama ya ganó la carrera, y el snapshot que acaba de subir es el de
    // ese preview. Condicionarlo otra vez lo perdería en cuanto alguien editara el link un instante después.
    await this.links.updateOne({ _id: id }, { $set: { snapshotKey } }).exec();
  }
}
