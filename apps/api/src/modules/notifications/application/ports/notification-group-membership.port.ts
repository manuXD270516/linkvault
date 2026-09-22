export const NOTIFICATION_GROUP_MEMBERSHIP = Symbol(
  'NOTIFICATION_GROUP_MEMBERSHIP',
);

/** Membresía vista desde notificaciones (vía GroupsFacade). */
export interface NotificationGroupMembership {
  isMember(groupId: string, userId: string): Promise<boolean>;
}
