import { apiRequest } from "@/lib/api";

/** One row of the console 🔔 (plan §19, N56). */
export type AppNotification = {
  id: string;
  type: "REPAIRS_SUBMITTED";
  title: string;
  body: string;
  /** In-app path to open, e.g. /maintenance-verification?siteVisitId=…&organizationId=… */
  url: string;
  count: number;
  readAt: string | null;
  lastEventAt: string;
};

export type NotificationList = { unread: number; items: AppNotification[] };

export function fetchNotifications(token: string) {
  return apiRequest<NotificationList>("/notifications?limit=30", { token });
}

export function fetchUnreadCount(token: string) {
  return apiRequest<{ unread: number }>("/notifications/unread-count", { token });
}

export function markNotificationRead(token: string, id: string) {
  return apiRequest<{ unread: number }>(`/notifications/${encodeURIComponent(id)}/read`, {
    token,
    method: "POST",
  });
}

export function markAllNotificationsRead(token: string) {
  return apiRequest<{ unread: number }>("/notifications/read-all", { token, method: "POST" });
}

export function fetchPushConfig(token: string) {
  return apiRequest<{ enabled: boolean; publicKey: string | null }>("/notifications/push/config", {
    token,
  });
}

export function savePushSubscription(
  token: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string },
) {
  return apiRequest<{ subscribed: boolean }>("/notifications/push/subscribe", {
    token,
    method: "POST",
    body: JSON.stringify(subscription),
  });
}

export function deletePushSubscription(token: string, endpoint: string) {
  return apiRequest<{ subscribed: boolean }>("/notifications/push/unsubscribe", {
    token,
    method: "POST",
    body: JSON.stringify({ endpoint }),
  });
}
