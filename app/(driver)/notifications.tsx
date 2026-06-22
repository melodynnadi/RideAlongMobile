import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Swipeable } from 'react-native-gesture-handler';
import {
  Timestamp,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { firebaseAuth, firestore } from '@/constants/services';

import { useReturnNavigation } from '@/src/hooks/useReturnNavigation';

const NAVY   = '#15233A';
const ORANGE = '#DE5D20';
const BG     = '#FBFAF7';
const BORDER = '#E5E0D8';
const MUTED  = '#8B94A6';

type NotificationType = 'ride' | 'payment' | 'driver' | 'system';

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  time: string;
  createdAt?: Date;
  read: boolean;
  iconName: string;
}

interface RawNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt?: Date;
  read: boolean;
  path: string;
  userId: string | null;
  recipientId: string | null;
  recipients: string[];
}

function getIconForType(type: string): { iconName: string } {
  switch (type) {
    case 'ride':    return { iconName: 'car-outline' };
    case 'payment': return { iconName: 'card-outline' };
    case 'driver':  return { iconName: 'star-outline' };
    default:        return { iconName: 'notifications-outline' };
  }
}

function formatNotifTime(date?: Date): string {
  if (!date) return '';
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isToday) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 7 * 24 * 3600 * 1000) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function toDate(value: any): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}

export default function NotificationsScreen() {
  const { goBack } = useReturnNavigation('/(driver)');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const unsubsRef = useRef<(() => void)[]>([]);
  const pendingMapRef = useRef<Map<string, RawNotification>>(new Map());
  const flushScheduledRef = useRef(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const user = firebaseAuth.currentUser;
    if (!user) { setLoading(false); return; }
    const pendingMap = pendingMapRef.current;

    unsubsRef.current.forEach((u) => u());
    unsubsRef.current = [];

    const base = collection(firestore, 'notifications');
    const qUserId    = query(base, where('userId',    '==',             user.uid));
    const qRecipient = query(base, where('recipientId', '==',           user.uid));
    const qArr       = query(base, where('recipients', 'array-contains', user.uid));
    const qEmail     = user.email ? query(base, where('userEmail', '==', user.email)) : null;

    const scheduleFlush = () => {
      if (flushScheduledRef.current) return;
      flushScheduledRef.current = true;
      flushTimerRef.current = setTimeout(() => {
        flushScheduledRef.current = false;
        flushTimerRef.current = null;
        setNotifications(() => {
          const final = Array.from(pendingMap.values()).map((raw) => {
            const meta = getIconForType(raw.type);
            return {
              id: raw.id,
              type: raw.type,
              title: raw.title,
              message: raw.message,
              time: formatNotifTime(raw.createdAt),
              createdAt: raw.createdAt,
              read: raw.read,
              iconName: meta.iconName,
            };
          });
          final.sort((a, b) => {
            const ta = a.createdAt?.getTime() ?? 0;
            const tb = b.createdAt?.getTime() ?? 0;
            return tb - ta;
          });
          return final;
        });
        setLoading(false);
      }, 0);
    };

    const handleSnap = (snapshot: any) => {
      snapshot.docChanges().forEach((change: any) => {
        const document = change.doc;
        if (change.type === 'removed') { pendingMap.delete(document.id); return; }
        const data = document.data() || {};
        const rawType = String(data.type || data.category || data.actionType || 'system').toLowerCase();
        let mappedType: NotificationType = 'system';
        if (rawType.includes('ride') || rawType.includes('offer')) mappedType = 'ride';
        else if (rawType.includes('driver')) mappedType = 'driver';
        else if (rawType.includes('pay')) mappedType = 'payment';
        const readBy: string[] = Array.isArray(data.readBy) ? data.readBy : [];
        const read = data.read === true || data.unread === false || readBy.includes(user.uid);
        pendingMap.set(document.id, {
          id: document.id,
          type: mappedType,
          title: data.title || data.heading || 'Notification',
          message: data.message || data.body || data.text || '',
          createdAt: toDate(data.timestamp || data.createdAt || data.time),
          read,
          path: `notifications/${document.id}`,
          userId: data.userId ?? null,
          recipientId: data.recipientId ?? null,
          recipients: Array.isArray(data.recipients) ? data.recipients : [],
        });
      });
      scheduleFlush();
    };

    const u1 = onSnapshot(qUserId,    handleSnap, (e) => console.warn('notif err', e));
    const u2 = onSnapshot(qRecipient, handleSnap, (e) => console.warn('notif err', e));
    const u3 = onSnapshot(qArr,       handleSnap, (e) => console.warn('notif err', e));
    unsubsRef.current.push(u1, u2, u3);
    if (qEmail) unsubsRef.current.push(onSnapshot(qEmail, handleSnap, (e) => console.warn('notif err', e)));

    return () => {
      unsubsRef.current.forEach((u) => u());
      unsubsRef.current = [];
      pendingMap.clear();
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushScheduledRef.current = false;
    };
  }, []);

  const markAsRead = async (id: string) => {
    const user = firebaseAuth.currentUser;
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    if (pendingMapRef.current.has(id)) pendingMapRef.current.set(id, { ...pendingMapRef.current.get(id)!, read: true });
    try {
      if (!user) return;
      const raw = pendingMapRef.current.get(id);
      if (!raw?.path) return;
      await updateDoc(doc(firestore, raw.path), { read: true, unread: false, readBy: arrayUnion(user.uid) });
    } catch (e) { console.warn('markAsRead failed', e); }
  };

  const belongsToCurrentUser = (raw: RawNotification): boolean => {
    const user = firebaseAuth.currentUser;
    if (!user) return false;
    return raw.userId === user.uid || raw.recipientId === user.uid || raw.recipients.includes(user.uid);
  };

  const deleteNotification = async (id: string) => {
    const user = firebaseAuth.currentUser;
    if (!user) return;
    const raw = pendingMapRef.current.get(id);
    if (!raw || !belongsToCurrentUser(raw)) return;
    const backup = notifications.find((n) => n.id === id);
    if (!backup) return;
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    pendingMapRef.current.delete(id);
    try {
      await deleteDoc(doc(firestore, 'notifications', id));
    } catch (e) {
      console.warn('deleteNotification failed', e);
      pendingMapRef.current.set(id, raw);
      setNotifications((prev) => prev.some((n) => n.id === id) ? prev : [...prev, backup]);
    }
  };

  const renderRow = (n: Notification, index: number) => (
    <Swipeable
      key={n.id}
      overshootRight={false}
      renderRightActions={() => (
        <TouchableOpacity style={s.swipeDelete} onPress={() => deleteNotification(n.id)}>
          <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
          <Text style={s.swipeDeleteText}>Delete</Text>
        </TouchableOpacity>
      )}
    >
      <TouchableOpacity
        onPress={() => markAsRead(n.id)}
        activeOpacity={0.86}
        disabled={n.read}
        style={[s.row, index === 0 && s.firstRow]}
        accessibilityRole="button"
        accessibilityLabel={n.read ? 'Read notification' : 'Mark notification as read'}
      >
        <View style={[s.iconWrap, !n.read && s.iconWrapUnread]}>
          <Ionicons name={n.iconName as any} size={16} color={!n.read ? ORANGE : NAVY} />
        </View>
        <Text style={s.rowBody} numberOfLines={2}>{n.message || n.title}</Text>
        <Text style={s.rowTime}>{n.time}</Text>
      </TouchableOpacity>
    </Swipeable>
  );

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={s.pageHeader}>
            <TouchableOpacity
              style={s.backBtn}
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="chevron-back" size={20} color={NAVY} />
            </TouchableOpacity>
            <Text style={s.pageTitle}>Notifications</Text>
          </View>

          {loading ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator size="large" color={ORANGE} />
              <Text style={s.loadingText}>Loading notifications...</Text>
            </View>
          ) : notifications.length === 0 ? (
            <View style={s.emptyCard}>
              <View style={s.emptyIcon}>
                <Ionicons name="bell-outline" size={26} color={ORANGE} />
              </View>
              <Text style={s.emptyTitle}>You are all caught up</Text>
              <Text style={s.emptyText}>Ride, payment, and message updates will appear here.</Text>
            </View>
          ) : (
            <View>{notifications.map(renderRow)}</View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: BG },
  safe:          { flex: 1 },
  scroll:        { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 60 },
  pageHeader:    { minHeight: 64, position: 'relative', flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 0 },
  backBtn:       { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: BORDER },
  pageTitle:     { color: NAVY, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25, flex: 1, marginLeft: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: BG,
  },
  firstRow: { paddingTop: 6 },
  iconWrap:  { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F3EFE8', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  iconWrapUnread: { backgroundColor: '#F9E8DB' },
  rowBody:   { flex: 1, minWidth: 0, color: NAVY, fontSize: 14, lineHeight: 21 },
  rowTime:   { color: MUTED, fontSize: 11, fontWeight: '600', flexShrink: 0 },
  swipeDelete: {
    backgroundColor: '#C94747',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    alignSelf: 'stretch',
    gap: 5,
  },
  swipeDeleteText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  loadingWrap: { alignItems: 'center', paddingTop: 24, gap: 14 },
  loadingText: { color: MUTED, fontSize: 14, fontWeight: '500' },
  emptyCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: BORDER,
    backgroundColor: '#FFFFFF',
    padding: 32,
    alignItems: 'center',
    marginTop: 8,
  },
  emptyIcon: {
    width: 54, height: 54, borderRadius: 27, backgroundColor: '#FEF0E8',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  emptyTitle: { color: NAVY, fontSize: 19, fontWeight: '700', marginBottom: 6 },
  emptyText:  { color: MUTED, fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 260 },
});
