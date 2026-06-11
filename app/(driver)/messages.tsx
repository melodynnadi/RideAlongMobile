// RideAlongDriverMobile - Messages Screen (Chat List)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Image,
  Alert,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
  QuerySnapshot,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';

import { firestore, firebaseAuth } from '@/constants/services';
import {
  addHiddenDeletedThreadIdForCurrentUser,
  deleteMessageThread,
  DeleteMessageThreadError,
  getDeleteMessageThreadErrorMessage,
  getHiddenDeletedThreadIdsForCurrentUser,
} from '@/services/messageThreadsService';
import { showErrorToast, showSuccessToast } from '@/src/utils/showToast';
import { useAppTheme } from '@/hooks/ThemeContext';
import { AppColors, BRAND } from '@/constants/theme';

type FilterKey = 'all' | 'unread' | 'active';
type GradientStops = readonly [string, string, ...string[]];

const asGradientStops = (stops: string[]): GradientStops => {
  return stops as unknown as GradientStops;
};

interface Chat {
  id: string;
  rideId: string;
  riderId: string;
  driverId: string;
  participants: string[];
  lastMessage: string;
  lastMessageTimestamp: any;
  recipientName: string;
  recipientAvatar?: string;
  rideInfo: string;
  unreadCount?: number;
}

const userCache = new Map<string, any>();
const rideCache = new Map<string, any>();
const warnedUserIds = new Set<string>();
const warnedRideIds = new Set<string>();

export default function MessagesScreen() {
  const { colors, isDark } = useAppTheme();
  const themed = createStyles(colors, isDark);

  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hydratedHiddenIds, setHydratedHiddenIds] = useState(false);
  const [hiddenThreadIds, setHiddenThreadIds] = useState<string[]>([]);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');

  const chatsUnsubscribeRef = useRef<(() => void) | null>(null);
  const hiddenThreadIdsRef = useRef<Set<string>>(new Set());
  const currentUser = firebaseAuth.currentUser;


  useEffect(() => {
    if (!currentUser?.uid) {
      router.replace('/(auth)/sign-in');
      return;
    }

    let mounted = true;

    const init = async () => {
      try {
        const ids = await getHiddenDeletedThreadIdsForCurrentUser();

        if (!mounted) return;

        setHiddenThreadIds(ids);
        hiddenThreadIdsRef.current = new Set(ids);
      } finally {
        if (mounted) setHydratedHiddenIds(true);
      }
    };

    init();

    return () => {
      mounted = false;
      setHydratedHiddenIds(false);
      setHiddenThreadIds([]);
      hiddenThreadIdsRef.current = new Set();

      if (chatsUnsubscribeRef.current) {
        chatsUnsubscribeRef.current();
        chatsUnsubscribeRef.current = null;
      }
    };
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid || !hydratedHiddenIds) return;

    const unsubscribe = loadChats();
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [currentUser?.uid, hydratedHiddenIds]);

  useEffect(() => {
    hiddenThreadIdsRef.current = new Set(hiddenThreadIds);
  }, [hiddenThreadIds]);

  const truncateLocation = (location: string) => {
    if (!location) return 'Unknown';
    return location.length <= 25 ? location : `${location.substring(0, 25)}...`;
  };

  const loadChats = () => {
    if (!currentUser) return;

    if (chatsUnsubscribeRef.current) {
      chatsUnsubscribeRef.current();
      chatsUnsubscribeRef.current = null;
    }

    setLoading(true);

    const orderedQuery = query(
      collection(firestore, 'chats'),
      where('participants', 'array-contains', currentUser.uid),
      orderBy('lastMessageTimestamp', 'desc')
    );

    const plainQuery = query(
      collection(firestore, 'chats'),
      where('participants', 'array-contains', currentUser.uid)
    );

    const driverOrderedQuery = query(
      collection(firestore, 'chats'),
      where('driverId', '==', currentUser.uid),
      orderBy('lastMessageTimestamp', 'desc')
    );

    const driverPlainQuery = query(
      collection(firestore, 'chats'),
      where('driverId', '==', currentUser.uid)
    );

    let activeUnsub: (() => void) | null = null;

    const attachListener = (q: any, isFallback = false, useDriverQuery = false) => {
      activeUnsub = onSnapshot(
        q,
        async (snapshot: QuerySnapshot<DocumentData>) => {
          try {
            const userIdsToFetch = new Set<string>();
            const rideIdsToFetch = new Set<string>();

            const chatDocs = snapshot.docs
              .map((d: QueryDocumentSnapshot<DocumentData>) => ({
                id: d.id,
                data: d.data() as Record<string, any>,
              }))
              .filter(({ id }) => !hiddenThreadIdsRef.current.has(id));

            chatDocs.forEach(({ data }) => {
              const participants = Array.isArray(data.participants) ? data.participants : [];
              participants
                .filter((id: string) => id !== currentUser.uid)
                .forEach((id: string) => userIdsToFetch.add(id));

              if (data.rideId) rideIdsToFetch.add(data.rideId);
            });

            const userIdsArr = Array.from(userIdsToFetch).filter((id) => !userCache.has(id));
            const rideIdsArr = Array.from(rideIdsToFetch).filter((id) => !rideCache.has(id));

            if (userIdsArr.length || rideIdsArr.length) {
              await Promise.all([
                Promise.all(
                  userIdsArr.map(async (userId) => {
                    try {
                      let userDoc = await getDoc(doc(firestore, 'riders', userId));

                      if (!userDoc.exists()) {
                        try {
                          userDoc = await getDoc(doc(firestore, 'drivers', userId));
                        } catch {}
                      }

                      userCache.set(userId, userDoc.exists() ? userDoc.data() : null);
                    } catch (error) {
                      if (!warnedUserIds.has(userId)) {
                        console.warn(`Failed to fetch user ${userId}:`, error);
                        warnedUserIds.add(userId);
                      }

                      userCache.set(userId, null);
                    }
                  })
                ),
                Promise.all(
                  rideIdsArr.map(async (rideId) => {
                    try {
                      const rideDoc = await getDoc(doc(firestore, 'confirmedRides', rideId));
                      rideCache.set(rideId, rideDoc.exists() ? rideDoc.data() : null);
                    } catch (error) {
                      if (!warnedRideIds.has(rideId)) {
                        console.warn(`Failed to fetch ride ${rideId}:`, error);
                        warnedRideIds.add(rideId);
                      }

                      rideCache.set(rideId, null);
                    }
                  })
                ),
              ]);
            }

            const chatsList: Chat[] = chatDocs.map(({ id: docId, data: chatData }) => {
              const {
                riderId,
                driverId,
                rideId,
                lastMessage,
                lastMessageTimestamp,
              } = chatData;

              const participants = Array.isArray(chatData.participants) ? chatData.participants : [];
              const otherParticipants = participants.filter((id: string) => id !== currentUser.uid);
              const isGroupChat = otherParticipants.length > 1;

              let recipientName = 'Unknown User';
              let recipientAvatar: string | undefined;

              if (isGroupChat) {
                const names = otherParticipants
                  .map((pid: string) => {
                    const userData = userCache.get(pid);
                    return userData?.fullName || userData?.name || userData?.email?.split('@')[0] || 'User';
                  })
                  .filter(Boolean);

                recipientName = names.length > 0 ? names.join(', ') : 'Group Chat';
              } else {
                const riderData = userCache.get(otherParticipants[0]);

                if (riderData) {
                  recipientName = riderData.fullName || riderData.name || riderData.email || 'Unknown User';
                  recipientAvatar =
                    riderData.avatarUrl ||
                    riderData.profilePicture ||
                    riderData.photoURL ||
                    riderData.photoUrl;
                }
              }

              const rideData = rideCache.get(rideId);
              const rideInfo = rideData
                ? `${truncateLocation(rideData.pickup || rideData.pickupAddress)} -> ${truncateLocation(
                    rideData.dropoff || rideData.dropoffAddress
                  )}`
                : 'Ride details unavailable';

              const unreadField = `unreadCount_${currentUser.uid}`;
              const unreadCount =
                chatData[unreadField] && typeof chatData[unreadField] === 'number'
                  ? chatData[unreadField]
                  : 0;

              return {
                id: docId,
                rideId,
                riderId,
                driverId,
                participants,
                lastMessage: lastMessage || 'No messages yet',
                lastMessageTimestamp,
                recipientName,
                recipientAvatar,
                rideInfo,
                unreadCount,
              };
            });

            setChats(chatsList);
            setLoading(false);
            setRefreshing(false);
          } catch (error: any) {
            console.error('[Chats] Error processing snapshot:', error?.code, error?.message);
            setLoading(false);
            setRefreshing(false);
          }
        },
        (error: any) => {
          console.error('[Chats] Snapshot error:', error?.code, error?.message || error);

          if (!isFallback && (error?.code === 'failed-precondition' || error?.message?.includes('index'))) {
            if (activeUnsub) activeUnsub();
            attachListener(plainQuery, true, false);
            return;
          }

          if (!isFallback && error?.code === 'permission-denied') {
            if (activeUnsub) activeUnsub();
            attachListener(driverOrderedQuery, false, true);
            return;
          }

          if (isFallback && !useDriverQuery && error?.code === 'permission-denied') {
            if (activeUnsub) activeUnsub();
            attachListener(driverOrderedQuery, false, true);
            return;
          }

          if (
            useDriverQuery &&
            !isFallback &&
            (error?.code === 'failed-precondition' || error?.message?.includes('index'))
          ) {
            if (activeUnsub) activeUnsub();
            attachListener(driverPlainQuery, true, true);
            return;
          }

          setLoading(false);
          setRefreshing(false);
        }
      );
    };

    attachListener(orderedQuery);

    chatsUnsubscribeRef.current = () => {
      if (activeUnsub) activeUnsub();
    };

    return chatsUnsubscribeRef.current;
  };

  const onRefresh = async () => {
    setRefreshing(true);

    await getHiddenDeletedThreadIdsForCurrentUser()
      .then((ids) => {
        setHiddenThreadIds(ids);
        hiddenThreadIdsRef.current = new Set(ids);
      })
      .finally(() => {
        loadChats();
      });
  };

  const hideThreadLocally = async (threadId: string) => {
    setChats((previous) => previous.filter((chat) => chat.id !== threadId));

    const updatedIds = await addHiddenDeletedThreadIdForCurrentUser(threadId);
    setHiddenThreadIds(updatedIds);
    hiddenThreadIdsRef.current = new Set(updatedIds);
  };

  const executeDeleteThread = async (threadId: string) => {
    if (!threadId || deletingThreadId) return;

    setDeletingThreadId(threadId);

    try {
      await deleteMessageThread(threadId);
      await hideThreadLocally(threadId);
      showSuccessToast('Conversation deleted', 'This conversation was removed.');
    } catch (error) {
      const statusCode = (error as DeleteMessageThreadError | undefined)?.statusCode;

      if (statusCode === 404) {
        await hideThreadLocally(threadId);
        showSuccessToast('Conversation deleted', 'Conversation no longer exists.');
        return;
      }

      showErrorToast('Unable to delete conversation', getDeleteMessageThreadErrorMessage(error));
    } finally {
      setDeletingThreadId(null);
    }
  };

  const confirmDeleteThread = (threadId: string) => {
    if (!threadId || deletingThreadId) return;

    Alert.alert('Delete conversation', 'Delete this conversation? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => executeDeleteThread(threadId) },
    ]);
  };

  const formatTimestamp = (timestamp: any) => {
    if (!timestamp || !timestamp.toDate) return '';

    const date = timestamp.toDate();
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const unreadTotal = useMemo(
    () => chats.reduce((sum, chat) => sum + (chat.unreadCount ?? 0), 0),
    [chats]
  );

  const filteredChats = useMemo(() => {
    if (filter === 'unread') return chats.filter((chat) => (chat.unreadCount ?? 0) > 0);
    if (filter === 'active') return chats.filter((chat) => chat.rideInfo !== 'Ride details unavailable');
    return chats;
  }, [chats, filter]);

  const responseEdgeText = useMemo(() => {
    if (unreadTotal > 0) return `${unreadTotal} message${unreadTotal === 1 ? '' : 's'} need a reply`;
    if (chats.length > 0) return 'Inbox is clear. Keep response time tight.';
    return 'New ride conversations will appear here instantly.';
  }, [chats.length, unreadTotal]);

  const renderChatItem = ({ item }: { item: Chat }) => {
    const isDeleting = deletingThreadId === item.id;
    const hasUnread = (item.unreadCount ?? 0) > 0;
    const initial = item.recipientName?.[0]?.toUpperCase() || '?';

    return (
      <Swipeable
        renderRightActions={() => (
          <TouchableOpacity
            style={styles.swipeDelete}
            onPress={() => confirmDeleteThread(item.id)}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
            )}
            <Text style={styles.swipeDeleteText}>Delete</Text>
          </TouchableOpacity>
        )}
      >
        <TouchableOpacity
          style={[themed.chatCard, hasUnread && themed.chatCardUnread]}
          onPress={() => router.push(`/messages/${item.id}` as any)}
          disabled={isDeleting}
          activeOpacity={0.82}
        >
          {isDark && (
            <BlurView intensity={18} tint="dark" style={StyleSheet.absoluteFillObject} />
          )}

          {hasUnread && <View style={themed.unreadBar} />}

          <View style={styles.chatAvatarWrap}>
            {item.recipientAvatar ? (
              <Image source={{ uri: item.recipientAvatar }} style={styles.chatAvatar} />
            ) : (
              <LinearGradient
                colors={[BRAND.orange, BRAND.orangeDeep]}
                style={[styles.chatAvatar, styles.chatAvatarFallback]}
              >
                <Text style={styles.chatAvatarInitial}>{initial}</Text>
              </LinearGradient>
            )}

            <View style={[styles.chatOnlineDot, { backgroundColor: colors.green, borderColor: colors.bgCard }]} />
          </View>

          <View style={styles.chatBody}>
            <View style={styles.chatRowTop}>
              <Text style={[themed.chatName, hasUnread && themed.chatNameUnread]} numberOfLines={1}>
                {item.recipientName}
              </Text>

              <View style={styles.chatMeta}>
                {hasUnread && (
                  <View style={themed.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>{item.unreadCount}</Text>
                  </View>
                )}
                <Text style={themed.chatTime}>{formatTimestamp(item.lastMessageTimestamp)}</Text>
              </View>
            </View>

            <Text style={[themed.chatLastMsg, hasUnread && themed.chatLastMsgUnread]} numberOfLines={1}>
              {item.lastMessage}
            </Text>

            <View style={styles.chatRouteRow}>
              <Ionicons name="navigate-outline" size={11} color={colors.primary} />
              <Text style={themed.chatRouteText} numberOfLines={1}>
                {item.rideInfo}
              </Text>
            </View>
          </View>

          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} style={styles.chevron} />
        </TouchableOpacity>
      </Swipeable>
    );
  };

  const HeaderContent = (
    <View>
      <View style={themed.responseEdge}>
        <View style={styles.responseIconWrap}>
          <Ionicons name="flash-outline" size={16} color={colors.primary} />
        </View>
        <View style={styles.responseTextWrap}>
          <Text style={themed.responseTitle}>Response Edge</Text>
          <Text style={themed.responseText}>{responseEdgeText}</Text>
        </View>
      </View>

      <View style={styles.filterRow}>
        {[
          { key: 'all' as const, label: 'All', count: chats.length },
          { key: 'unread' as const, label: 'Needs Reply', count: unreadTotal },
          { key: 'active' as const, label: 'Active Rides', count: chats.filter((chat) => chat.rideInfo !== 'Ride details unavailable').length },
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

      {filteredChats.length > 0 && (
        <View style={styles.sectionRow}>
          <Text style={themed.sectionLabel}>
            {filter === 'unread' ? 'Needs Reply' : filter === 'active' ? 'Active Rides' : 'Conversations'} · {filteredChats.length}
          </Text>

          <View style={themed.sectionBadge}>
            <View style={[styles.sectionBadgeDot, { backgroundColor: colors.green }]} />
            <Text style={[styles.sectionBadgeText, { color: colors.green }]}>Live</Text>
          </View>
        </View>
      )}
    </View>
  );

  if (loading || !hydratedHiddenIds) {
    return (
      <View style={themed.root}>
        <StatusBar barStyle={colors.statusBar} />
        <LinearGradient colors={asGradientStops(colors.gradientBg)} style={StyleSheet.absoluteFillObject} />

        <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
          <View style={styles.hdr}>
            <View>
              <Text style={themed.hdrTitle}>Messages</Text>
              <Text style={themed.hdrSub}>Campus coordination hub</Text>
            </View>
          </View>

          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={themed.loadingText}>Loading conversations...</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={themed.root}>
      <StatusBar barStyle={colors.statusBar} />
      <LinearGradient colors={asGradientStops(colors.gradientBg)} style={StyleSheet.absoluteFillObject} />

      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.hdr}>
          <View style={styles.hdrText}>
            <Text style={themed.hdrTitle}>Messages</Text>
            <Text style={themed.hdrSub}>Campus coordination hub</Text>
          </View>
        </View>

        <FlatList
          data={filteredChats}
          renderItem={renderChatItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListHeaderComponent={HeaderContent}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <View style={themed.emptyIconWrap}>
                <Ionicons name="chatbubbles" size={28} color={colors.primary} />
              </View>

              <Text style={themed.emptyTitle}>
                {filter === 'unread' ? 'No Replies Needed' : 'All Clear'}
              </Text>

              <Text style={themed.emptySubtitle}>
                {filter === 'unread'
                  ? 'You are caught up. New unread rider messages will appear here.'
                  : 'New ride conversations will appear here as students start coordinating.'}
              </Text>

              <View style={styles.emptyPredictions}>
                {[
                  { icon: 'timer-outline', text: 'Fast replies help students feel confident booking.' },
                  { icon: 'navigate-outline', text: 'Pickup and dropoff context is kept inside each thread.' },
                  { icon: 'shield-checkmark-outline', text: 'Clear communication makes campus rides feel safer.' },
                  { icon: 'school-outline', text: 'Campus ride coordination stays organized in one place.' },
                ].map((item) => (
                  <View key={item.text} style={themed.emptyPredItem}>
                    <Ionicons name={item.icon as any} size={17} color={colors.primary} />
                    <Text style={themed.emptyPredText}>{item.text}</Text>
                  </View>
                ))}
              </View>
            </View>
          }
        />
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
    loadingText: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: '500',
    },
    responseEdge: {
      marginHorizontal: 16,
      marginBottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.borderMid,
      padding: 14,
    },
    responseTitle: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '800',
      marginBottom: 2,
    },
    responseText: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
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
    chatCard: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 16,
      marginBottom: 10,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.borderMid,
      overflow: 'hidden',
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
      paddingHorizontal: 14,
      paddingVertical: 14,
      shadowColor: BRAND.navyText,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: isDark ? 0.12 : 0.05,
      shadowRadius: 12,
      elevation: 2,
    },
    chatCardUnread: {
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
    },
    chatName: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textSecondary,
      flex: 1,
    },
    chatNameUnread: {
      color: colors.textPrimary,
      fontWeight: '800',
    },
    chatTime: {
      fontSize: 11,
      color: colors.textTertiary,
      marginLeft: 4,
      fontWeight: '600',
    },
    chatLastMsg: {
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 5,
    },
    chatLastMsgUnread: {
      color: colors.textPrimary,
      fontWeight: '600',
    },
    chatRouteText: {
      fontSize: 11,
      color: colors.textSecondary,
      flex: 1,
      fontWeight: '500',
    },
    unreadBadge: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      minWidth: 18,
      height: 18,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 5,
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
    loadingWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
    },
    listContent: {
      paddingBottom: 60,
    },
    responseIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    responseTextWrap: {
      flex: 1,
    },
    filterRow: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 16,
      marginBottom: 12,
      flexWrap: 'wrap',
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
    chatAvatarWrap: {
      width: 48,
      height: 48,
      position: 'relative',
    },
    chatAvatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
    },
    chatAvatarFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    chatAvatarInitial: {
      fontSize: 20,
      fontWeight: '800',
      color: '#FFFFFF',
    },
    chatOnlineDot: {
      position: 'absolute',
      bottom: 1,
      right: 1,
      width: 11,
      height: 11,
      borderRadius: 5.5,
      borderWidth: 2,
    },
    chatBody: {
      flex: 1,
      marginLeft: 12,
    },
    chatRowTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 4,
    },
    chatMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    chatRouteRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    unreadBadgeText: {
      color: '#FFFFFF',
      fontSize: 10,
      fontWeight: '800',
    },
    chevron: {
      marginLeft: 6,
    },
    swipeDelete: {
      backgroundColor: '#DC2626',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 20,
      marginBottom: 10,
      borderRadius: 20,
      marginRight: 16,
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