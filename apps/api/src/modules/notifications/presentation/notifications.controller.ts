import {
  notificationPreferencesSchema,
  patchNotificationPreferencesSchema,
  pushSubscriptionRequestSchema,
  vapidPublicKeyResponseSchema,
  type NotificationPreferences,
  type PatchNotificationPreferencesRequest,
  type PushSubscriptionRequest,
  type VapidPublicKeyResponse,
} from '@linkvault/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedUser } from '../../../presentation/http/auth-context/authenticated-user';
import { CurrentUser } from '../../../presentation/http/auth-context/current-user.decorator';
import { ZodValidationPipe } from '../../../presentation/http/zod-validation.pipe';
import { DeletePushSubscription } from '../application/delete-push-subscription.usecase';
import { GetNotificationPreferences } from '../application/get-notification-preferences.usecase';
import { GetVapidPublicKey } from '../application/get-vapid-public-key.usecase';
import { RegisterPushSubscription } from '../application/register-push-subscription.usecase';
import { UpdateNotificationPreferences } from '../application/update-notification-preferences.usecase';

const deleteEndpointQuerySchema = z.strictObject({
  endpoint: z.string().url(),
});

interface StatusReply {
  code(statusCode: number): unknown;
}

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly getPreferences: GetNotificationPreferences,
    private readonly updatePreferences: UpdateNotificationPreferences,
    private readonly registerPush: RegisterPushSubscription,
    private readonly deletePush: DeletePushSubscription,
    private readonly getVapid: GetVapidPublicKey,
  ) {}

  @Get('preferences')
  async preferences(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationPreferences> {
    const body = await this.getPreferences.execute(user.userId);
    return notificationPreferencesSchema.parse(body);
  }

  @Patch('preferences')
  async patchPreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(patchNotificationPreferencesSchema))
    body: PatchNotificationPreferencesRequest,
  ): Promise<NotificationPreferences> {
    const result = await this.updatePreferences.execute(user.userId, body);
    return notificationPreferencesSchema.parse(result);
  }

  @Post('push-subscriptions')
  async createPushSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(pushSubscriptionRequestSchema))
    body: PushSubscriptionRequest,
    @Res({ passthrough: true }) reply: StatusReply,
  ): Promise<{ endpoint: string }> {
    const result = await this.registerPush.execute(user.userId, body);
    reply.code(result.created ? 201 : 200);
    return { endpoint: body.endpoint };
  }

  @Delete('push-subscriptions')
  @HttpCode(204)
  async removePushSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(deleteEndpointQuerySchema))
    query: { endpoint: string },
  ): Promise<void> {
    await this.deletePush.execute(user.userId, query.endpoint);
  }

  @Get('push-vapid-public-key')
  vapidPublicKey(
    @CurrentUser() user: AuthenticatedUser,
  ): VapidPublicKeyResponse {
    void user;
    return vapidPublicKeyResponseSchema.parse(this.getVapid.execute());
  }
}
