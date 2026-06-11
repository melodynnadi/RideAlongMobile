// RideAlongDriverMobile - Notifications Screen
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { Bell, Car, CreditCard, Trash2, Users } from 'lucide-react-native';
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
  writeBatch,
} from 'firebase/firestore';

import { firebaseAuth, firestore } from '@/constants/services';
import { useAppTheme } from '@/hooks/ThemeContext';
import { iconPalette, SemanticColor, AppColors, BRAND } from '@/constants/theme';

type NotificationType = 'ride' | 'payment' | 'driver' | 'system';
type FilterKey = 'all' | 'unread';
type GradientStops = readonly [string, string, ...string[]];

const asGradientStops = (stops: string[]): GradientStops => {
  return stops as unknown as GradientStops;
};

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  time: string;
  read: boolean;
  icon: any;
  semantic: SemanticColor;
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

export default function NotificationsScreen() {
  const { colors, isDark } = useAppTheme();
  const themed = createStyles(colors, isDark);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('all');

  const unsubsRef = useRef<Array<() => void>>([]);
  const pendingMapRef = useRef<Map<string, RawNotification>>(new Map());
  const flushScheduledRef = useRef(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dotPositions = [
    { top: '28%', left: '22%', color: colors.primary },
    { top: '50%', left: '60%', color: colors.purple },
    { top: '38%', left: '75%', color: colors.blue },
  ];

  const getIconForType = (type: string): { icon: any; semantic: SemanticColor } => {
    switch (type) {
      case 'ride':
        return { icon: Car, semantic: 'orange' };
      case 'driver':
        return { icon: Users, semantic: 'blue' };
      case 'payment':
        return { icon: CreditCard, semantic: 'green' };
      case 'system':
      default:
        return { icon: Bell, semantic: 'purple' };
    }
  };

  const timeAgo = (date?: Date): string => {
    if (!date) return '';
    const diff = Math.max(0, Date.now() - date.getTime());
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;

    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;

    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  };

  const toDate = (value: any): Date | undefined => {
    if (!value) return undefined;
    if (value instanceof Date) return value;
    if (value instanceof Timestamp) return value.toDate();
    if (typeof value === 'number') return new Date(value);
    if (typeof value === 'string') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    }
    return undefined;
  };

  useEffect(() => {
    const user = firebaseAuth.currentUser;

    if (!user) {
      setLoading(false);
      return;
    }

    unsubsRef.current.forEach((unsubscribe) => unsubscribe());
    unsubsRef.current = [];

    const base = collection(firestore, 'notifications');
    const qUserId = query(base, where('userId', '==', user.uid));
    const qRecipientId = query(base, where('recipientId', '==', user.uid));
    const qRecipients = query(base, where('recipients', 'array-contains', user.uid));
    const qEmail = user.email ? query(base, where('userEmail', '==', user.email)) : null;

    const scheduleFlush = () => {
      if (flushScheduledRef.current) return;

      flushScheduledRef.current = true;
      flushTimerRef.current = setTimeout(() => {
        flushScheduledRef.current = false;
        flushTimerRef.current = null;

        setNotifications(() => {
          const final = Array.from(pendingMapRef.current.values()).map((raw) => {
            const meta = getIconForType(raw.type);

            return {
              id: raw.id,
              type: raw.type,
              title: raw.title,
              message: raw.message,
              time: timeAgo(raw.createdAt),
              read: raw.read,
              icon: meta.icon,
              semantic: meta.semantic,
            };
          });

          final.sort((a, b) => {
            const ta = pendingMapRef.current.get(a.id)?.createdAt?.getTime?.() || 0;
            const tb = pendingMapRef.current.get(b.id)?.createdAt?.getTime?.() || 0;
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

        if (change.type === 'removed') {
          pendingMapRef.current.delete(document.id);
          return;
        }

        const data = document.data() || {};
        const rawType = String(data.type || data.category || data.actionType || 'system').toLowerCase();

        let mappedType: NotificationType = 'system';
        if (rawType.includes('ride') || rawType.includes('offer')) mappedType = 'ride';
        else if (rawType.includes('driver')) mappedType = 'driver';
        else if (rawType.includes('pay')) mappedType = 'payment';

        const readBy: string[] = Array.isArray(data.readBy) ? data.readBy : [];
        const read = data.read === true || data.unread === false || readBy.includes(user.uid);

        pendingMapRef.current.set(document.id, {
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

    const u1 = onSnapshot(qUserId, handleSnap, (error) => console.warn('notif userId err', error));
    const u2 = onSnapshot(qRecipientId, handleSnap, (error) => console.warn('notif recipientId err', error));
    const u3 = onSnapshot(qRecipients, handleSnap, (error) => console.warn('notif recipients err', error));

    unsubsRef.current.push(u1, u2, u3);

    if (qEmail) {
      const u4 = onSnapshot(qEmail, handleSnap, (error) => console.warn('notif userEmail err', error));
      unsubsRef.current.push(u4);
    }

    return () => {
      unsubsRef.current.forEach((unsubscribe) => unsubscribe());
      unsubsRef.current = [];
      pendingMapRef.current.clear();

      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);

      flushScheduledRef.current = false;
    };
  }, []);

  const markAsRead = async (id: string) => {
    const user = firebaseAuth.currentUser;

    setNotifications((previous) =>
      previous.map((notification) =>
        notification.id === id ? { ...notification, read: true } : notification
      )
    );

    if (pendingMapRef.current.has(id)) {
      pendingMapRef.current.set(id, {
        ...pendingMapRef.current.get(id)!,
        read: true,
      });
    }

    try {
      if (!user) return;

      const raw = pendingMapRef.current.get(id);
      if (!raw?.path) return;

      await updateDoc(doc(firestore, raw.path), {
        read: true,
        unread: false,
        readBy: arrayUnion(user.uid),
      });
    } catch (error) {
      console.warn('markAsRead failed', error);
    }
  };

  const belongsToCurrentUser = (raw: RawNotification): boolean => {
    const user = firebaseAuth.currentUser;
    if (!user) return false;

    return (
      raw.userId === user.uid ||
      raw.recipientId === user.uid ||
      raw.recipients.includes(user.uid)
    );
  };

  const deleteNotification = async (id: string) => {
    const user = firebaseAuth.currentUser;
    if (!user) return;

    const raw = pendingMapRef.current.get(id);
    if (!raw || !belongsToCurrentUser(raw)) return;

    const previousNotification = notifications.find((notification) => notification.id === id);
    if (!previousNotification) return;

    setNotifications((previous) => previous.filter((notification) => notification.id !== id));
    pendingMapRef.current.delete(id);

    try {
      await deleteDoc(doc(firestore, 'notifications', id));
    } catch (error) {
      console.warn('deleteNotification failed', error);
      pendingMapRef.current.set(id, raw);
      setNotifications((previous) =>
        previous.some((notification) => notification.id === id)
          ? previous
          : [...previous, previousNotification]
      );
    }
  };

  const clearAllNotifications = async () => {
    const user = firebaseAuth.currentUser;
    if (!user) return;

    const toDelete = notifications.filter((notification) => {
      const raw = pendingMapRef.current.get(notification.id);
      return raw ? belongsToCurrentUser(raw) : false;
    });

    if (!toDelete.length) return;

    const backup = new Map<string, RawNotification>();
    toDelete.forEach((notification) => {
      const raw = pendingMapRef.current.get(notification.id);
      if (raw) backup.set(notification.id, raw);
    });

    setNotifications((previous) =>
      previous.filter((notification) => !toDelete.some((item) => item.id === notification.id))
    );
    toDelete.forEach((notification) => pendingMapRef.current.delete(notification.id));

    try {
      const batch = writeBatch(firestore);
      toDelete.forEach((notification) => batch.delete(doc(firestore, 'notifications', notification.id)));
      await batch.commit();
    } catch (error) {
      console.warn('clearAll failed', error);

      backup.forEach((raw, id) => pendingMapRef.current.set(id, raw));
      setNotifications((previous) => {
        const ids = new Set(previous.map((notification) => notification.id));
        return [...previous, ...toDelete.filter((notification) => !ids.has(notification.id))];
      });
    }
  };

  const filteredNotifications = useMemo(
    () => (filter === 'unread' ? notifications.filter((notification) => !notification.read) : notifications),
    [filter, notifications]
  );

  const unreadCount = notifications.filter((notification) => !notification.read).length;

  return (
    <View style={themed.root}>
      <StatusBar barStyle={colors.statusBar} />
      <LinearGradient
        colors={asGradientStops(colors.gradientBg)}
        style={StyleSheet.absoluteFillObject}
      />

      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.hdr}>
          <View style={styles.hdrText}>
            <Text style={themed.hdrTitle}>Notifications</Text>
            <Text style={themed.hdrSub}>Ride updates, payments, and account activity</Text>
          </View>

          <View style={styles.hdrActions}>
            {unreadCount > 0 && (
              <View style={themed.unreadCountBadge}>
                <Text style={themed.unreadCountText}>{unreadCount}</Text>
              </View>
            )}

            {notifications.length > 0 && (
              <TouchableOpacity onPress={clearAllNotifications} style={themed.clearBtn}>
                <Ionicons name="trash-outline" size={15} color={colors.textSecondary} />
                <Text style={themed.clearBtnText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={themed.loadingText}>Loading notifications...</Text>
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >

            <View style={themed.activityStrip}>
              {[
                { icon: 'car-outline', text: 'Ride offers update in real time' },
                { icon: 'wallet-outline', text: 'Payment confirmations arrive instantly' },
                { icon: 'school-outline', text: 'Campus alerts stay organized here' },
              ].map((item) => (
                <View key={item.text} style={styles.activityItem}>
                  <Ionicons name={item.icon as any} size={14} color={colors.primary} />
                  <Text style={themed.activityText}>{item.text}</Text>
                </View>
              ))}
            </View>

            <View style={styles.filterRow}>
              {[
                { key: 'all' as const, label: 'All', count: notifications.length },
                { key: 'unread' as const, label: 'Unread', count: unreadCount },
              ].map((item) => {
                const active = filter === item.key;

                return (
                  <TouchableOpacity
                    key={item.key}
                    onPress={() => setFilter(item.key)}
                    style={[themed.filterChip, active && themed.filterChipActive]}
                  >
                    <Text style={[themed.filterChipText, active && themed.filterChipTextActive]}>
                      {item.label} ({item.count})
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {filteredNotifications.length > 0 && (
              <View style={styles.sectionRow}>
                <Text style={themed.sectionLabel}>
                  {filter === 'unread' ? 'Unread' : 'Recent'} · {filteredNotifications.length}
                </Text>

                {unreadCount > 0 && (
                  <View style={themed.sectionBadge}>
                    <View style={[styles.sectionBadgeDot, { backgroundColor: colors.green }]} />
                    <Text style={[styles.sectionBadgeText, { color: colors.green }]}>Live</Text>
                  </View>
                )}
              </View>
            )}

            {filteredNotifications.length > 0 ? (
              <View style={styles.notifList}>
                {filteredNotifications.map((notification) => {
                  const IconComponent = notification.icon;
                  const palette = iconPalette(colors, notification.semantic);

                  return (
                    <Swipeable
                      key={notification.id}
                      renderRightActions={() => (
                        <TouchableOpacity
                          style={styles.swipeDelete}
                          onPress={() => deleteNotification(notification.id)}
                        >
                          <Trash2 size={18} color="#FFFFFF" />
                          <Text style={styles.swipeDeleteText}>Delete</Text>
                        </TouchableOpacity>
                      )}
                    >
                      <TouchableOpacity
                        onPress={() => markAsRead(notification.id)}
                        activeOpacity={0.82}
                        style={[
                          themed.notifCard,
                          !notification.read && themed.notifCardUnread,
                        ]}
                      >
                        {isDark && (
                          <BlurView
                            intensity={18}
                            tint="dark"
                            style={StyleSheet.absoluteFillObject}
                          />
                        )}

                        {!notification.read && <View style={themed.unreadBar} />}

                        <View style={styles.notifInner}>
                          <View style={[styles.notifIconWrap, { backgroundColor: palette.bg }]}>
                            <IconComponent size={18} color={palette.color} />
                          </View>

                          <View style={styles.notifBody}>
                            <View style={styles.notifTitleRow}>
                              <Text
                                style={[
                                  themed.notifTitle,
                                  !notification.read && themed.notifTitleUnread,
                                ]}
                                numberOfLines={1}
                              >
                                {notification.title}
                              </Text>

                              {!notification.read && <View style={themed.unreadDot} />}
                            </View>

                            <Text style={themed.notifMessage} numberOfLines={2}>
                              {notification.message}
                            </Text>

                            <Text style={themed.notifTime}>{notification.time}</Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    </Swipeable>
                  );
                })}
              </View>
            ) : (
              <View style={styles.emptyWrap}>
                <View style={themed.emptyIconWrap}>
                  <Bell size={28} color={colors.primary} />
                </View>

                <Text style={themed.emptyTitle}>All Clear</Text>

                <Text style={themed.emptySubtitle}>
                  {filter === 'unread'
                    ? "You're caught up."
                    : 'New ride, payment, and account updates will appear here.'}
                </Text>

                <View style={styles.emptyPredictions}>
                  {[
                    { icon: 'car-outline', text: 'Ride offers appear here instantly' },
                    { icon: 'card-outline', text: 'Payment confirmations stay easy to review' },
                    { icon: 'notifications-outline', text: 'Important account alerts remain visible' },
                    { icon: 'school-outline', text: 'Campus activity stays organized by time' },
                  ].map((item) => (
                    <View key={item.text} style={themed.emptyPredItem}>
                      <Ionicons name={item.icon as any} size={17} color={colors.primary} />
                      <Text style={themed.emptyPredText}>{item.text}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const createStyles = (colors: AppColors, isDark: boolean) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    hdrTitle: {
      fontSize: 24,
      fontWeight: '800',
      color: colors.textPrimary,
      letterSpacing: -0.5,
    },
    hdrSub: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
      fontWeight: '500',
    },
    unreadCountBadge: {
      backgroundColor: colors.primaryDim,
      borderRadius: 12,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderWidth: 1,
      borderColor: colors.primaryBorder,
    },
    unreadCountText: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '800',
    },
    clearBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(13,27,72,0.06)',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.borderMid,
    },
    clearBtnText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    loadingText: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: '500',
    },
    
    
    activityStrip: {
      marginHorizontal: 16,
      marginBottom: 12,
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.borderMid,
      paddingVertical: 9,
      paddingHorizontal: 12,
      gap: 6,
    },
    activityText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '500',
    },
    filterChip: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : colors.bgCard,
    },
    filterChipActive: {
      backgroundColor: colors.primaryDim,
      borderColor: colors.primaryBorder,
    },
    filterChipText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    filterChipTextActive: {
      color: colors.primary,
    },
    sectionLabel: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.textSecondary,
    },
    sectionBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.greenDim,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.greenBorder,
    },
    notifCard: {
      marginBottom: 10,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.borderMid,
      overflow: 'hidden',
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
      shadowColor: BRAND.navyText,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: isDark ? 0.12 : 0.05,
      shadowRadius: 12,
      elevation: 2,
    },
    notifCardUnread: {
      borderColor: colors.primaryBorder,
      backgroundColor: isDark ? 'rgba(249,115,22,0.08)' : colors.primaryDim,
    },
    unreadBar: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 3,
      backgroundColor: colors.primary,
      borderTopLeftRadius: 18,
      borderBottomLeftRadius: 18,
    },
    notifTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textSecondary,
      flex: 1,
    },
    notifTitleUnread: {
      color: colors.textPrimary,
      fontWeight: '800',
    },
    notifMessage: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
      marginBottom: 6,
    },
    notifTime: {
      fontSize: 11,
      color: colors.textTertiary,
      fontWeight: '600',
    },
    unreadDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      backgroundColor: colors.primary,
      marginLeft: 6,
    },
    emptyIconWrap: {
      width: 64,
      height: 64,
      borderRadius: 20,
      backgroundColor: colors.primaryDim,
      borderWidth: 1,
      borderColor: colors.primaryBorder,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.textPrimary,
      marginBottom: 6,
    },
    emptySubtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: 20,
      lineHeight: 18,
    },
    emptyPredItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.borderMid,
      padding: 14,
    },
    emptyPredText: {
      flex: 1,
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
      fontWeight: '500',
    },
  });

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 60,
  },
  hdr: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  hdrText: {
    flex: 1,
  },
  hdrActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  sectionBadgeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  sectionBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  notifList: {
    paddingHorizontal: 16,
  },
  notifInner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    gap: 12,
  },
  notifIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  notifBody: {
    flex: 1,
  },
  notifTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  swipeDelete: {
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
    width: 72,
    marginBottom: 10,
    borderRadius: 18,
    marginLeft: 8,
  },
  swipeDeleteText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 4,
  },
  emptyWrap: {
    padding: 24,
    alignItems: 'center',
  },
  emptyPredictions: {
    width: '100%',
    gap: 10,
  },
});