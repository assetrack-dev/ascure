import { API_BASE_URL } from "@/lib/api";
import { deletePushSubscription, fetchPushConfig, savePushSubscription } from "@/lib/notifications";

/**
 * Phone notifications for the console (plan §19, N56) — Web Push, no app.
 *
 * The service worker (/sw.js) only SHOWS a push and opens its link; it cannot
 * read the session token (localStorage), so subscribing / unsubscribing always
 * happens here, on the page.
 *
 * Works in Android Chrome straight from the browser; an iPhone (iOS 16.4+) only
 * after "Add to Home Screen" and opening ASCURE from that icon.
 */
export type PushState =
  | "unsupported" // no service worker / PushManager / Notification
  | "needs-install" // iPhone in Safari: must be opened from the Home Screen first
  | "server-off" // the API has no VAPID keys yet
  | "blocked" // the user denied notifications for this site
  | "off" // supported, not subscribed on this device
  | "on"; // this device is subscribed

const SW_PATH = "/sw.js";

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function hasPushApis() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration(SW_PATH)) ??
    navigator.serviceWorker.register(SW_PATH, { scope: "/" });
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export async function readPushState(token: string): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  if (isIos() && !isStandalone()) return "needs-install";
  if (!hasPushApis()) return "unsupported";
  try {
    const config = await fetchPushConfig(token);
    if (!config.enabled || !config.publicKey) return "server-off";
  } catch {
    return "server-off";
  }
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

/** Ask permission (must run from a tap) and subscribe this device. */
export async function enablePush(token: string): Promise<PushState> {
  if (!hasPushApis()) return "unsupported";
  const config = await fetchPushConfig(token);
  if (!config.enabled || !config.publicKey) return "server-off";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";

  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    }));
  const json = sub.toJSON();
  await savePushSubscription(token, {
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
    userAgent: navigator.userAgent,
  });
  return "on";
}

export async function disablePush(token: string): Promise<PushState> {
  if (!hasPushApis()) return "unsupported";
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await deletePushSubscription(token, sub.endpoint).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
  return "off";
}

/**
 * On sign-out: stop pushing the signed-out user's alerts to this device. Fire-
 * and-forget (keepalive) — sign-out must never wait on it.
 */
export function releasePushOnLogout(token: string | null) {
  if (typeof window === "undefined" || !token || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker
    .getRegistration(SW_PATH)
    .then((reg) => reg?.pushManager.getSubscription())
    .then((sub) => {
      if (!sub) return;
      void fetch(`${API_BASE_URL}/notifications/push/unsubscribe`, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => undefined);
      return sub.unsubscribe();
    })
    .catch(() => undefined);
}
