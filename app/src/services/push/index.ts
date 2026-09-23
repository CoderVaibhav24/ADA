/*
 * Push notifications, device side. The root layout calls `usePushNotifications()`;
 * nothing else needs to import from here except a future Profile toggle.
 */
export { usePushNotifications, enablePushFromSettings } from './use-push-notifications';
export { currentPushPermission, type PushPermission } from './permission';
export { NOTIFY_PATHS, NOTIFY_PROJECT, PUSH_CHANNEL_ID, NOTIFICATION_TYPES, pushEnv, type NotificationType } from './constants';
