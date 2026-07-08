import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Image } from 'expo-image';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { DriverBottomNav } from '@/components/DriverBottomNav';
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
import { chatBelongsToRole, legacyUnreadField, roleKey, roleUnreadField } from '@/src/utils/roleIdentity';
import { useAppTheme } from '@/hooks/ThemeContext';
import { resolveChatAvailability } from '@/src/services/chatAvailability';

interface Chat {
  id: string;
  rideId: string;
  riderId: string;
  driverId: string;
  participants: string[];
  lastMessage: string;
  lastMessageTimestamp: any;
  recipientName: string;
  recipientPhotoURL?: string | null;
  unreadCount?: number;
  chatAvailable?: boolean;
  unavailableMessage?: string;
}

const userCache = new Map<string, any>();
const rideCache = new Map<string, any>();
const warnedUserIds = new Set<string>();
const warnedRideIds = new Set<string>();

export default function MessagesScreen() {
  const { colors } = useAppTheme();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hydratedHiddenIds, setHydratedHiddenIds] = useState(false);
  const [hiddenThreadIds, setHiddenThreadIds] = useState<string[]>([]);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);

  const chatsUnsubscribeRef = useRef<(() => void) | null>(null);
  const hiddenThreadIdsRef = useRef<Set<string>>(new Set());
  const currentUser = firebaseAuth.currentUser;

  const s = useMemo(() => StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    safe: {
      flex: 1,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: 24,
      paddingBottom: 102,
      flexGrow: 1,
    },
    pageHeader: {
      marginBottom: 4,
    },
    pageTitle: {
      color: colors.textPrimary,
      fontSize: 24,
      lineHeight: 30,
      fontWeight: '700',
      letterSpacing: -0.25,
    },
    loadingWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
      minHeight: 320,
    },
    loadingText: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 18,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.bg,
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.primaryDim,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    avatarText: {
      color: colors.primary,
      fontSize: 18,
      fontWeight: '600',
    },
    rowContent: {
      flex: 1,
      minWidth: 0,
    },
    rowTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 3,
    },
    name: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '600',
    },
    newBadge: {
      color: colors.primary,
      backgroundColor: colors.primaryDim,
      overflow: 'hidden',
      borderRadius: 10,
      paddingHorizontal: 7,
      paddingVertical: 3,
      fontSize: 9,
      fontWeight: '700',
    },
    closedBadge: {
      color: colors.textSecondary,
      backgroundColor: colors.bgSecondary,
      overflow: 'hidden',
      borderRadius: 10,
      paddingHorizontal: 7,
      paddingVertical: 3,
      fontSize: 9,
      fontWeight: '700',
    },
    preview: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
    },
    rowMeta: {
      alignItems: 'flex-end',
      gap: 4,
      flexShrink: 0,
    },
    time: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '600',
    },
    swipeDelete: {
      width: 80,
      alignSelf: 'stretch',
      backgroundColor: colors.red,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
    },
    swipeDeleteText: {
      color: colors.textInverse,
      fontSize: 12,
      fontWeight: '700',
    },
    emptyCard: {
      marginTop: 40,
      borderRadius: 20,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.border,
      backgroundColor: colors.bgCard,
      padding: 24,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 180,
    },
    emptyIcon: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: colors.primaryDim,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    emptyTitle: {
      color: colors.textPrimary,
      fontSize: 19,
      lineHeight: 25,
      fontWeight: '700',
      textAlign: 'center',
      letterSpacing: -0.2,
    },
    emptyText: {
      maxWidth: 280,
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      textAlign: 'center',
      marginTop: 6,
    },
  }), [colors]);

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

  const loadChats = () => {
    if (!currentUser) return;

    if (chatsUnsubscribeRef.current) {
      chatsUnsubscribeRef.current();
      chatsUnsubscribeRef.current = null;
    }

    setLoading(true);

    const driverOrderedQuery = query(
      collection(firestore, 'chats'),
      where('driverId', '==', currentUser.uid),
      orderBy('lastMessageTimestamp', 'desc')
    );
    const driverPlainQuery = query(
      collection(firestore, 'chats'),
      where('driverId', '==', currentUser.uid)
    );
    const orderedQuery = driverOrderedQuery;
    const plainQuery = driverPlainQuery;

    let activeUnsub: (() => void) | null = null;

    const attachListener = (q: any, isFallback = false, useDriverQuery = false) => {
      activeUnsub = onSnapshot(
        q,
        async (snapshot: QuerySnapshot<DocumentData>) => {
          try {
            const userIdsToFetch = new Set<string>();

            const chatDocs = snapshot.docs
              .map((d: QueryDocumentSnapshot<DocumentData>) => ({
                id: d.id,
                data: d.data() as Record<string, any>,
              }))
              .filter(({ id, data }) => !hiddenThreadIdsRef.current.has(id) && chatBelongsToRole(data, currentUser.uid, 'driver'));

            chatDocs.forEach(({ data }) => {
              const riderId = data.riderId || data.riderUID || data.riderUid || data.userId;
              if (riderId) userIdsToFetch.add(String(riderId));
            });

            const userIdsArr = Array.from(userIdsToFetch).filter((id) => !userCache.has(id));

            if (userIdsArr.length) {
              await Promise.all(
                userIdsArr.map(async (userId) => {
                  try {
                    let userDoc = await getDoc(doc(firestore, 'riders', userId));
                    if (!userDoc.exists()) userDoc = await getDoc(doc(firestore, 'drivers', userId));
                    if (!userDoc.exists()) userDoc = await getDoc(doc(firestore, 'users', userId));
                    userCache.set(userId, userDoc.exists() ? userDoc.data() : null);
                  } catch (error) {
                    if (!warnedUserIds.has(userId)) {
                      console.warn(`Failed to fetch user ${userId}:`, error);
                      warnedUserIds.add(userId);
                    }
                    userCache.set(userId, null);
                  }
                })
              );
            }

            const chatsList: Chat[] = await Promise.all(chatDocs.map(async ({ id: docId, data: chatData }) => {
              const availability = await resolveChatAvailability(chatData).catch(() => ({ available: true }));
              const { riderId, driverId, rideId, lastMessage, lastMessageTimestamp } = chatData;

              const participants = Array.isArray(chatData.participants) ? chatData.participants : [];
              const otherParticipants = [riderId || chatData.riderUID || chatData.riderUid || chatData.userId || participants.find((id: string) => id !== currentUser.uid)].filter(Boolean);
              const isGroupChat = otherParticipants.length > 1;

              let recipientName = 'Unknown User';
              let recipientPhotoURL: string | null = null;

              if (isGroupChat) {
                const names = otherParticipants
                  .map((pid: string) => {
                    const userData = userCache.get(pid);
                    return userData?.fullName
                      || userData?.name
                      || userData?.displayName
                      || ((userData?.firstName || userData?.lastName)
                          ? [userData?.firstName, userData?.lastName].filter(Boolean).join(' ').trim()
                          : null)
                      || userData?.email?.split('@')[0]
                      || 'User';
                  })
                  .filter(Boolean);
                recipientName = names.length > 0 ? names.join(', ') : 'Group Chat';
              } else {
                const riderData = userCache.get(otherParticipants[0]);
                if (riderData) {
                  recipientName = riderData.fullName
                    || riderData.name
                    || riderData.displayName
                    || ((riderData.firstName || riderData.lastName)
                        ? [riderData.firstName, riderData.lastName].filter(Boolean).join(' ').trim()
                        : null)
                    || riderData.personalInfo?.fullName
                    || riderData.email?.split('@')[0]
                    || 'Unknown User';
                  recipientPhotoURL = riderData.photoURL || riderData.avatarUrl || riderData.photoUrl || null;
                }
              }

              const unreadField = roleUnreadField('driver', currentUser.uid);
              const legacyField = legacyUnreadField(currentUser.uid);
              const unreadCounts = chatData.unreadCounts || {};
              const unreadCount =
                chatData[unreadField] && typeof chatData[unreadField] === 'number'
                  ? chatData[unreadField]
                  : typeof unreadCounts[roleKey('driver', currentUser.uid)] === 'number'
                    ? unreadCounts[roleKey('driver', currentUser.uid)]
                  : typeof chatData[legacyField] === 'number'
                    ? chatData[legacyField]
                  : 0;

              return {
                id: docId,
                rideId,
                riderId,
                driverId,
                participants,
                lastMessage: availability.available === false ? (availability.unavailableMessage || 'Chat no longer available') : lastMessage || 'No messages yet',
                lastMessageTimestamp,
                recipientName,
                recipientPhotoURL,
                unreadCount,
                chatAvailable: availability.available,
                unavailableMessage: availability.unavailableMessage,
              };
            }));

            // Always re-sort client-side by most-recent-first: the fallback
            // query (used when the composite index is missing) has no orderBy.
            chatsList.sort((a, b) => {
              const at = a.lastMessageTimestamp?.toDate?.()?.getTime?.() ?? 0;
              const bt = b.lastMessageTimestamp?.toDate?.()?.getTime?.() ?? 0;
              return bt - at;
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
          if (useDriverQuery && !isFallback && (error?.code === 'failed-precondition' || error?.message?.includes('index'))) {
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
    const sameDay = date.toDateString() === new Date().toDateString();
    return sameDay
      ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const renderChatItem = ({ item }: { item: Chat }) => {
    const isDeleting = deletingThreadId === item.id;
    const hasUnread = (item.unreadCount ?? 0) > 0;
    const initial = item.recipientName?.[0]?.toUpperCase() || '?';

    return (
      <Swipeable
        overshootRight={false}
        renderRightActions={() => (
          <TouchableOpacity
            style={s.swipeDelete}
            onPress={() => confirmDeleteThread(item.id)}
            disabled={isDeleting}
            accessibilityRole="button"
            accessibilityLabel={`Delete conversation with ${item.recipientName}`}
          >
            {isDeleting ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Ionicons name="trash-outline" size={20} color={colors.textInverse} />
            )}
            <Text style={s.swipeDeleteText}>Delete</Text>
          </TouchableOpacity>
        )}
      >
        <TouchableOpacity
          style={s.row}
          onPress={() => router.push({ pathname: '/(driver)/messages/[chatId]', params: { chatId: item.id, returnTo: '/(driver)/messages' } } as any)}
          disabled={isDeleting}
          accessibilityRole="button"
        >
          <View style={s.avatar}>
            {item.recipientPhotoURL
              ? <Image source={{ uri: item.recipientPhotoURL }} style={{ width: 48, height: 48, borderRadius: 24 }} contentFit="cover" />
              : <Text style={s.avatarText}>{initial}</Text>}
          </View>

          <View style={s.rowContent}>
            <View style={s.rowTop}>
              <Text style={s.name} numberOfLines={1}>{item.recipientName}</Text>
            </View>
            <Text style={s.preview} numberOfLines={1}>{item.lastMessage}</Text>
          </View>

          <View style={s.rowMeta}>
            <Text style={s.time}>{formatTimestamp(item.lastMessageTimestamp)}</Text>
            {item.chatAvailable === false ? <Text style={s.closedBadge}>CLOSED</Text> : null}
            {hasUnread ? <Text style={s.newBadge}>{item.unreadCount} NEW</Text> : null}
          </View>
        </TouchableOpacity>
      </Swipeable>
    );
  };

  const Header = (
    <View style={s.pageHeader}>
      <Text style={s.pageTitle}>Messages</Text>
    </View>
  );

  if (loading || !hydratedHiddenIds) {
    return (
      <View style={s.root}>
        <StatusBar barStyle={colors.statusBar} />
        <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={s.pageHeader}>
              <Text style={s.pageTitle}>Messages</Text>
            </View>
            <View style={s.loadingWrap}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={s.loadingText}>Loading conversations...</Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle={colors.statusBar} />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <FlatList
          data={chats}
          renderItem={renderChatItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListHeaderComponent={Header}
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 }}>
              <View style={s.emptyIcon}>
                <Ionicons name="chatbubbles-outline" size={25} color={colors.primary} />
              </View>
              <Text style={s.emptyTitle}>No conversations yet</Text>
              <Text style={s.emptyText}>
                Messages from riders will appear here once you accept a booking.
              </Text>
            </View>
          }
        />
      </SafeAreaView>

      <DriverBottomNav activeTab="inbox" />
    </View>
  );
}
