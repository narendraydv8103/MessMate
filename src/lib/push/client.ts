// Client-side Web Push subscription manager

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch (err) {
    console.warn('Error getting push subscription:', err);
    return null;
  }
}

export async function subscribeToPush(): Promise<{ success: boolean; error?: string }> {
  if (!isPushSupported()) {
    return { success: false, error: 'Push notifications are not supported by this browser.' };
  }

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    return { success: false, error: 'VAPID public key is not configured on client.' };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return {
        success: false,
        error: 'Notification permission was denied. Please allow notifications in browser site settings.',
      };
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey as BufferSource,
      });
    }

    // Register with backend
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        userAgent: navigator.userAgent,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.error || 'Failed to save subscription on server.' };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to subscribe to push notifications.',
    };
  }
}

export async function unsubscribeFromPush(): Promise<{ success: boolean; error?: string }> {
  if (!isPushSupported()) {
    return { success: false, error: 'Push not supported.' };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();

      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      });
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to unsubscribe.',
    };
  }
}

/**
 * Silently re-subscribes if permission is already granted but subscription is missing or expired.
 */
export async function silentResubscribeIfMissing(): Promise<void> {
  if (!isPushSupported()) return;
  if (Notification.permission !== 'granted') return;

  try {
    const subscription = await getExistingSubscription();
    if (!subscription) {
      await subscribeToPush();
    }
  } catch (err) {
    console.warn('Silent re-subscribe error:', err);
  }
}
