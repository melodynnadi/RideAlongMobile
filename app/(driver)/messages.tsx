// RideAlongDriverMobile - Messages Screen (Chat List)
import React, { useEffect, useRef, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { firestore, firebaseAuth } from '@/constants/services';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
} from 'firebase/firestore';
import {
  addHiddenDeletedThreadIdForCurrentUser,
  deleteMessageThread,
  DeleteMessageThreadError,
  getDeleteMessageThreadErrorMessage,
  getHiddenDeletedThreadIdsForCurrentUser,
} from '@/services/messageThreadsService';
import { showErrorToast, showSuccessToast } from '@/src/utils/showToast';

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

// Simple in-memory caches (persist for app session)
const userCache = new Map<string, any>();
const rideCache = new Map<string, any>();
// Track which IDs have already produced a warning to avoid noisy duplicates
const warnedUserIds = new Set<string>();
const warnedRideIds = new Set<string>();

export default function MessagesScreen() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hydratedHiddenIds, setHydratedHiddenIds] = useState(false);
  const [hiddenThreadIds, setHiddenThreadIds] = useState<string[]>([]);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
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
    if (!currentUser?.uid || !hydratedHiddenIds) {
      return;
    }

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

    // Primary ordered query (needs composite index participants+lastMessageTimestamp)
    const orderedQuery = query(
      collection(firestore, 'chats'),
      where('participants', 'array-contains', currentUser.uid),
      orderBy('lastMessageTimestamp', 'desc')
    );
    // Fallback query (no orderBy) used if index missing or permission denied
    const plainQuery = query(
      collection(firestore, 'chats'),
      where('participants', 'array-contains', currentUser.uid)
    );

    // Secondary fallback: filter by driverId (sidestep malformed chat docs)
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

    const attachListener = (q: any, isFallback: boolean = false, useDriverQuery: boolean = false) => {
      activeUnsub = onSnapshot(
        q,
        async (snapshot) => {
        try {
          // Collect all unique user IDs and ride IDs we need to fetch
          const userIdsToFetch = new Set<string>();
          const rideIdsToFetch = new Set<string>();
          const chatDocs = snapshot.docs
            .map(doc => ({ id: doc.id, data: doc.data() }))
            .filter(({ id }) => !hiddenThreadIdsRef.current.has(id));

          chatDocs.forEach(({ data }) => {
            const otherParticipants = data.participants.filter((id: string) => id !== currentUser.uid);
            otherParticipants.forEach((id: string) => userIdsToFetch.add(id));
            if (data.rideId) rideIdsToFetch.add(data.rideId);
          });

          // Filter out IDs already cached
          const userIdsToFetchArr = Array.from(userIdsToFetch).filter(id => !userCache.has(id));
          const rideIdsToFetchArr = Array.from(rideIdsToFetch).filter(id => !rideCache.has(id));

          // Batch fetch only uncached entities
          if (userIdsToFetchArr.length || rideIdsToFetchArr.length) {
            const [fetchedUsers, fetchedRides] = await Promise.all([
              Promise.all(
                userIdsToFetchArr.map(async (userId) => {
                  try {
                    let userDoc = await getDoc(doc(firestore, 'users', userId));
                    if (!userDoc.exists()) {
                      try {
                        userDoc = await getDoc(doc(firestore, 'drivers', userId));
                      } catch (_) {
                        // ignore
                      }
                    }
                    const data = userDoc.exists() ? userDoc.data() : null;
                    userCache.set(userId, data);
                  } catch (e) {
                    if (!warnedUserIds.has(userId)) {
                      console.warn(`Failed to fetch user ${userId}:`, e);
                      warnedUserIds.add(userId);
                    }
                    userCache.set(userId, null);
                  }
                })
              ),
              Promise.all(
                rideIdsToFetchArr.map(async (rideId) => {
                  try {
                    const rideDoc = await getDoc(doc(firestore, 'confirmedRides', rideId));
                    const data = rideDoc.exists() ? rideDoc.data() : null;
                    rideCache.set(rideId, data);
                  } catch (e) {
                    if (!warnedRideIds.has(rideId)) {
                      console.warn(`Failed to fetch ride ${rideId}:`, e);
                      warnedRideIds.add(rideId);
                    }
                    rideCache.set(rideId, null);
                  }
                })
              )
            ]);
            // fetchedUsers / fetchedRides are arrays but we rely on side-effects only
          }

        // Build chats list using cached data (no additional Firestore reads here)
        const usersMap = userCache; // reuse cache directly
        const ridesMap = rideCache; // reuse cache directly

        // Build chats list using cached data
        const chatsList: Chat[] = chatDocs.map(({ id: docId, data: chatData }) => {
          const { riderId, driverId, rideId, lastMessage, lastMessageTimestamp, participants } = chatData;

          const otherParticipants = participants.filter((id: string) => id !== currentUser.uid);
          const isGroupChat = otherParticipants.length > 1;

          let recipientName = 'Unknown User';
          let recipientAvatar: string | undefined = undefined;

          if (isGroupChat) {
            const names = otherParticipants
              .map((participantId: string) => {
                const userData = usersMap.get(participantId);
                return userData?.fullName || userData?.name || userData?.email?.split('@')[0] || 'User';
              })
              .filter(Boolean);
            recipientName = names.length > 0 ? names.join(', ') : 'Group Chat';
          } else {
            const recipientId = otherParticipants[0];
            const recipientData = usersMap.get(recipientId);
            if (recipientData) {
              recipientName = recipientData.fullName || recipientData.name || recipientData.email || 'Unknown User';
              recipientAvatar = recipientData.avatarUrl || recipientData.profilePicture || recipientData.photoURL || recipientData.photoUrl;
            }
          }

          let rideInfo = 'Ride details unavailable';
          const rideData = ridesMap.get(rideId);
          if (rideData) {
            const pickup = truncateLocation(rideData.pickup || rideData.pickupAddress);
            const dropoff = truncateLocation(rideData.dropoff || rideData.dropoffAddress);
            rideInfo = `${pickup} → ${dropoff}`;
          }

          let unreadCount = 0;
          const unreadField = `unreadCount_${currentUser.uid}`;
          if (chatData[unreadField] && typeof chatData[unreadField] === 'number') {
            unreadCount = chatData[unreadField];
          }

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
          // Handle common causes: missing index vs permission issues
          if (!isFallback && (error?.code === 'failed-precondition' || error?.message?.includes('index'))){
            console.warn('[Chats] Missing composite index for participants + lastMessageTimestamp. Falling back without orderBy.');
            if (activeUnsub) activeUnsub();
            attachListener(plainQuery, true, false);
            return;
          }
          if (!isFallback && error?.code === 'permission-denied') {
            console.warn('[Chats] Permission denied on participants query. Trying driverId query instead.');
            if (activeUnsub) activeUnsub();
            attachListener(driverOrderedQuery, false, true);
            return;
          }
          if (isFallback && !useDriverQuery && error?.code === 'permission-denied') {
            console.warn('[Chats] Permission denied on plain participants query. Trying driverId query.');
            if (activeUnsub) activeUnsub();
            attachListener(driverOrderedQuery, false, true);
            return;
          }
          if (useDriverQuery && !isFallback && (error?.code === 'failed-precondition' || error?.message?.includes('index'))) {
            console.warn('[Chats] Missing index for driverId query. Falling back to plain driverId query.');
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
      if (activeUnsub) {
        activeUnsub();
      }
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
    setChats((prev) => prev.filter((chat) => chat.id !== threadId));

    const updatedHiddenIds = await addHiddenDeletedThreadIdForCurrentUser(threadId);
    setHiddenThreadIds(updatedHiddenIds);
    hiddenThreadIdsRef.current = new Set(updatedHiddenIds);
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

    Alert.alert(
      'Delete conversation',
      'Delete this conversation? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            executeDeleteThread(threadId);
          },
        },
      ]
    );
  };

  const formatTimestamp = (timestamp: any) => {
    if (!timestamp || !timestamp.toDate) return '';

    const date = timestamp.toDate();
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const truncateLocation = (location: string) => {
    if (!location) return 'Unknown';
    const maxLen = 25;
    if (location.length <= maxLen) return location;
    return location.substring(0, maxLen) + '...';
  };

  const renderChatItem = ({ item }: { item: Chat }) => {
    const isDeleting = deletingThreadId === item.id;

    return (
      <Swipeable
        renderRightActions={() => (
          <TouchableOpacity
            style={styles.swipeDeleteAction}
            onPress={() => confirmDeleteThread(item.id)}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Ionicons name="trash-outline" size={20} color="white" />
            )}
            <Text style={styles.swipeDeleteActionText}>Delete</Text>
          </TouchableOpacity>
        )}
      >
        <TouchableOpacity
          style={styles.chatItem}
          onPress={() => router.push(`/messages/${item.id}`)}
          disabled={isDeleting}
          activeOpacity={0.7}
        >
          {item.recipientAvatar ? (
            <Image source={{ uri: item.recipientAvatar }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person" size={24} color="#9ca3af" />
            </View>
          )}
          <View style={styles.chatItemContent}>
            <View style={styles.chatItemHeader}>
              <Text style={styles.chatItemName}>{item.recipientName}</Text>
              <View style={styles.chatItemHeaderRight}>
                {(item.unreadCount ?? 0) > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>{item.unreadCount}</Text>
                  </View>
                )}
                <Text style={styles.chatItemTime}>{formatTimestamp(item.lastMessageTimestamp)}</Text>
              </View>
            </View>
            <Text style={styles.chatItemLastMessage} numberOfLines={1}>
              {item.lastMessage}
            </Text>
            <View style={styles.chatItemRideInfo}>
              <Ionicons name="car-outline" size={12} color="#9ca3af" />
              <Text style={styles.chatItemRideInfoText}>{item.rideInfo}</Text>
            </View>
          </View>
        </TouchableOpacity>
      </Swipeable>
    );
  };

  if (loading || !hydratedHiddenIds) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.container}>
          <View style={styles.headerContainer}>
            <Text style={styles.headerTitle}>Messages</Text>
          </View>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#E05E1A" />
            <Text style={styles.loadingText}>Loading conversations...</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        <View style={styles.headerContainer}>
          <Text style={styles.headerTitle}>Messages</Text>
        </View>
        {chats.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="chatbubbles-outline" size={80} color="#d1d5db" />
            <Text style={styles.emptyTitle}>No conversations yet</Text>
            <Text style={styles.emptyText}>
              Chats will appear here when you have confirmed rides
            </Text>
          </View>
        ) : (
          <FlatList
            data={chats}
            renderItem={renderChatItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContainer}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#E05E1A']} />
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'white',
  },
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  headerContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: '#f9fafb',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1f2937',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: '#9ca3af',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  listContainer: {
    paddingVertical: 8,
  },
  chatItem: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e5e7eb',
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatItemContent: {
    flex: 1,
    marginRight: 12,
  },
  chatItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  chatItemHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatItemName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    flex: 1,
  },
  chatItemTime: {
    fontSize: 12,
    color: '#9ca3af',
  },
  unreadBadge: {
    backgroundColor: '#EF4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadBadgeText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '700',
  },
  chatItemLastMessage: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 4,
  },
  chatItemRideInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chatItemRideInfoText: {
    fontSize: 12,
    color: '#9ca3af',
  },
  swipeDeleteAction: {
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  swipeDeleteActionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
});
