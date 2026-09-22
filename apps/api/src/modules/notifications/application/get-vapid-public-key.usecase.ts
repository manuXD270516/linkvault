import { Inject, Injectable } from '@nestjs/common';
import { VapidUnavailable } from '../domain/errors';
import { VAPID_CONFIG, type VapidConfig } from './ports/vapid-config.port';

@Injectable()
export class GetVapidPublicKey {
  constructor(@Inject(VAPID_CONFIG) private readonly vapid: VapidConfig) {}

  execute(): { publicKey: string } {
    const key = this.vapid.publicKey?.trim();
    if (key === undefined || key === '') {
      throw new VapidUnavailable();
    }
    return { publicKey: key };
  }
}
