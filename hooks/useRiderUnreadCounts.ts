import { useEffect, useState } from 'react';

import { firebaseAuth, firestore } from '@/constants/services';
import { subscribeRiderConversations, subscribeRiderNotifications } from '@/src/services/riderData';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { chatBelongsToRole, isReadForRole, notificationBelongsToRole, roleKey, roleUnreadField, legacyUnreadField } from '@/src/utils/roleIdentity';

type UnreadCounts = { messageCount: number; notificationCount: number };

// Shared singleton so multiple mounted components share one Firestore subscription
let subscribers: Set<(counts: UnreadCounts) => void> = new Set();
let cachedCounts: UnreadCounts = { messageCount: 0, notificationCount: 0 };
let cleanupConversations: (() => void) | null = null;
let cleanupNotifications: (() => void) | null = null;

function broadcast(update: Partial<UnreadCounts>) {
  cachedCounts = { ...cachedCounts, ...update };
  subscribers.forEach((cb) => cb(cachedCounts));
}

function ensureSubscribed(uid: string) {
  if (cleanupConversations) return;
  cleanupConversations = subscribeRiderConversations(uid, (conversations) => {
    broadcast({ messageCount: conversations.reduce((t, c) => t + Math.max(0, c.unread || 0), 0) });
  });
  cleanupNotifications = subscribeRiderNotifications(uid, (notifications) => {
    broadcast({ notificationCount: notifications.filter((n) => !n.read).length });
  });
}

function teardown() {
  cleanupConversations?.();
  cleanupNotifications?.();
  cleanupConversations = null;
  cleanupNotifications = null;
  cachedCounts = { messageCount: 0, notificationCount: 0 };
}

export function useRiderUnreadCounts(): UnreadCounts {
  const uid = firebaseAuth.currentUser?.uid;
  const [counts, setCounts] = useState<UnreadCounts>(cachedCounts);

  useEffect(() => {
    if (!uid) {
      if (subscribers.size === 0) teardown();
      setCounts({ messageCount: 0, notificationCount: 0 });
      return;
    }

    ensureSubscribed(uid);
    subscribers.add(setCounts);
    setCounts(cachedCounts);

    return () => {
      subscribers.delete(setCounts);
      if (subscribers.size === 0) teardown();
    };
  }, [uid]);

  return counts;
}

export function useDriverUnreadCounts(): UnreadCounts {
  const uid = firebaseAuth.currentUser?.uid;
  const [counts, setCounts] = useState<UnreadCounts>({ messageCount: 0, notificationCount: 0 });

  useEffect(() => {
    if (!uid) {
      setCounts({ messageCount: 0, notificationCount: 0 });
      return;
    }

    const chatUnsub = onSnapshot(query(collection(firestore, 'chats'), where('driverId', '==', uid)), (snapshot) => {
      const messageCount = snapshot.docs.reduce((total, item) => {
        const data = item.data();
        if (!chatBelongsToRole(data, uid, 'driver')) return total;
        const unreadCounts = data.unreadCounts || {};
        return total + Number(
          data[roleUnreadField('driver', uid)]
          ?? unreadCounts[roleKey('driver', uid)]
          ?? data[legacyUnreadField(uid)]
          ?? 0,
        );
      }, 0);
      setCounts((current) => ({ ...current, messageCount }));
    });

    const base = collection(firestore, 'notifications');
    const notificationBuckets = new Map<number, string[]>();
    const flushNotifications = () => {
      const unique = new Set<string>();
      notificationBuckets.forEach((ids) => ids.forEach((id) => unique.add(id)));
      setCounts((current) => ({ ...current, notificationCount: unique.size }));
    };
    const notificationQueries = [
      query(base, where('userId', '==', uid)),
      query(base, where('recipientId', '==', uid)),
      query(base, where('recipients', 'array-contains', uid)),
    ];
    const notificationUnsubs = notificationQueries.map((qy, index) => onSnapshot(qy, (snapshot) => {
      notificationBuckets.set(index, snapshot.docs.flatMap((item) => {
        const data = item.data();
        if (!notificationBelongsToRole(data, uid, 'driver') || isReadForRole(data, uid, 'driver')) return [];
        return [item.id];
      }));
      flushNotifications();
    }));

    return () => {
      chatUnsub();
      notificationUnsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [uid]);

  return counts;
}

export function badgeLabel(count: number) {
  return count > 9 ? '9+' : String(count);
}
