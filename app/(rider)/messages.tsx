// RideAlongRiderMobile - Messages Screen (Chat List)
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Swipeable } from 'react-native-gesture-handler';
import { MessageCircle, User, Car, Trash2 } from 'lucide-react-native';
import { firestore, firebaseAuth } from '@/constants/services';
import { showErrorToast, showSuccessToast } from '@/src/utils/showToast';
import {
  deleteMessageThread,
  getDeleteMessageThreadErrorMessage,
  DeleteMessageThreadError,
} from '@/services/messageThreads';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
} from 'firebase/firestore';

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

// Session-scoped caches to reduce duplicate reads and warnings
const userCache = new Map<string, any>();
const rideCache = new Map<string, any>();
const warnedUserIds = new Set<string>();
const warnedRideIds = new Set<string>();

export default function MessagesScreen() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [hiddenThreadIds, setHiddenThreadIds] = useState<string[]>([]);
  const hiddenThreadIdsRef = useRef<string[]>([]);
  const currentUser = firebaseAuth.currentUser;

  const hiddenThreadsStorageKey = currentUser
    ? `hiddenMessageThreads:${currentUser.uid}`
    : 'hiddenMessageThreads:anonymous';

  const persistHiddenThreadIds = async (ids: string[]) => {
    if (!currentUser) return;
    try {
      await AsyncStorage.setItem(hiddenThreadsStorageKey, JSON.stringify(ids));
    } catch (error) {
      console.warn('[Messages] Failed to persist hidden threads:', error);
    }
  };

  useEffect(() => {
    hiddenThreadIdsRef.current = hiddenThreadIds;
    setChats((prev) => prev.filter((chat) => !hiddenThreadIds.includes(chat.id)));
  }, [hiddenThreadIds]);

  useEffect(() => {
    try {
      // Temporary diagnostics to verify Firebase project
      // eslint-disable-next-line no-console
      console.log('[RiderChats] projectId =', (firestore as any)?.app?.options?.projectId);
    } catch {}
  }, []);

  useEffect(() => {
    if (!currentUser) {
      router.replace('/(auth)/sign-in');
      return;
    }

    const initializeChats = async () => {
      try {
        const saved = await AsyncStorage.getItem(hiddenThreadsStorageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            const sanitized = parsed.filter((id) => typeof id === 'string');
            hiddenThreadIdsRef.current = sanitized;
            setHiddenThreadIds(sanitized);
          }
        }
      } catch (error) {
        console.warn('[Messages] Failed to load hidden threads:', error);
      }

      loadChats();
    };

    initializeChats();
  }, [currentUser]);

  const loadChats = () => {
    if (!currentUser) return;

    // Ordered query (requires composite index participants + lastMessageTimestamp)
    const orderedQuery = query(
      collection(firestore, 'chats'),
      where('participants', 'array-contains', currentUser.uid),
      orderBy('lastMessageTimestamp', 'desc')
    );
    // Fallback query without orderBy for missing index or permission issues
    const plainQuery = query(
      collection(firestore, 'chats'),
      where('participants', 'array-contains', currentUser.uid)
    );

    // Secondary fallback: filter by riderId (sidestep malformed chat docs)
    const riderOrderedQuery = query(
      collection(firestore, 'chats'),
      where('riderId', '==', currentUser.uid),
      orderBy('lastMessageTimestamp', 'desc')
    );
    const riderPlainQuery = query(
      collection(firestore, 'chats'),
      where('riderId', '==', currentUser.uid)
    );

    let activeUnsub: (() => void) | null = null;
    let isAttaching = false;

    const cleanupListener = () => {
      if (activeUnsub) {
        try {
          activeUnsub();
          console.log('[RiderChats] Cleaned up previous listener');
        } catch (e) {
          console.warn('[RiderChats] Error unsubscribing previous listener:', e);
        }
        activeUnsub = null;
      }
    };

    const attachListener = (q: any, isFallback: boolean = false) => {
      // Prevent concurrent attachment attempts
      if (isAttaching) {
        console.warn('[RiderChats] Already attaching a listener, skipping');
        return;
      }
      
      isAttaching = true;
      
      // Clean up any existing listener before attaching new one
      cleanupListener();

      activeUnsub = onSnapshot(
        q,
        async (snapshot: any) => {
          isAttaching = false;
        try {
          // Collect all unique user IDs and ride IDs we need to fetch
          const userIdsToFetch = new Set<string>();
          const rideIdsToFetch = new Set<string>();
          const chatDocs: { id: string; data: any }[] = snapshot.docs.map((doc: any) => ({ id: doc.id, data: doc.data() }));

          chatDocs.forEach(({ data }: { data: any }) => {
            const otherParticipants = data.participants.filter((id: string) => id !== currentUser.uid);
            otherParticipants.forEach((id: string) => userIdsToFetch.add(id));
            if (data.rideId) rideIdsToFetch.add(data.rideId);
          });

          // Filter out already cached entities
          const userIdsToFetchArr = Array.from(userIdsToFetch).filter(id => !userCache.has(id));
          const rideIdsToFetchArr = Array.from(rideIdsToFetch).filter(id => !rideCache.has(id));

          if (userIdsToFetchArr.length || rideIdsToFetchArr.length) {
            await Promise.all([
              Promise.all(
                userIdsToFetchArr.map(async (userId) => {
                  try {
                    let userDoc = await getDoc(doc(firestore, 'users', userId));
                    if (!userDoc.exists()) {
                      try { userDoc = await getDoc(doc(firestore, 'drivers', userId)); } catch (_) {}
                    }
                    userCache.set(userId, userDoc.exists() ? userDoc.data() : null);
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
                    let rideDoc = await getDoc(doc(firestore, 'confirmedRides', rideId));
                    if (!rideDoc.exists()) {
                      try {
                        // Fallback to legacy 'rides' collection
                        rideDoc = await getDoc(doc(firestore, 'rides', rideId));
                      } catch (_) {}
                    }
                    rideCache.set(rideId, rideDoc.exists() ? rideDoc.data() : null);
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
          }

        // Use caches directly
        const usersMap = userCache;
        const ridesMap = rideCache;

        // Build chats list using cached data
        const chatsList: Chat[] = chatDocs.map(({ id: docId, data: chatData }: { id: string; data: any }) => {
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

          // Filter out chats with unavailable ride details
          const filteredChats = chatsList
            .filter((chat) => chat.rideInfo !== 'Ride details unavailable')
            .filter((chat) => !hiddenThreadIdsRef.current.includes(chat.id));
          setChats(filteredChats);
          setLoading(false);
          setRefreshing(false);
        } catch (error) {
          console.error('Error processing chats:', error);
          setLoading(false);
          setRefreshing(false);
        }
      },
      (error: any) => {
        isAttaching = false;
        
        // Handle index and permission issues with fallback
        if (!isFallback && (error?.code === 'failed-precondition' || error?.message?.includes('index'))) {
          console.warn('[RiderChats] Missing composite index, falling back without orderBy');
          cleanupListener();
          setTimeout(() => attachListener(plainQuery, true), 100);
          return;
        }
        if (!isFallback && error?.code === 'permission-denied') {
          console.warn('[RiderChats] Permission denied, falling back without orderBy');
          cleanupListener();
          setTimeout(() => attachListener(plainQuery, true), 100);
          return;
        }
        // If plain participants query still fails, try filtering by riderId
        if (isFallback && error?.code === 'permission-denied') {
          console.warn('[RiderChats] Permission denied on participants query; trying riderId filter');
          cleanupListener();
          setTimeout(() => attachListener(riderPlainQuery, true), 100);
          return;
        }
        console.error('Error loading chats:', error);
        setLoading(false);
        setRefreshing(false);
      }
      );
    };

    attachListener(orderedQuery);
    return () => { if (activeUnsub) activeUnsub(); };
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadChats();
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

  const hideThreadLocally = (threadId: string) => {
    setHiddenThreadIds((prev) => {
      if (prev.includes(threadId)) return prev;
      const next = [...prev, threadId];
      void persistHiddenThreadIds(next);
      return next;
    });
    setChats((prev) => prev.filter((chat) => chat.id !== threadId));
  };

  const handleDeleteThread = async (threadId: string) => {
    if (deletingThreadId) return;

    setDeletingThreadId(threadId);
    try {
      await deleteMessageThread(threadId);
      hideThreadLocally(threadId);
      showSuccessToast('Conversation deleted', 'This conversation has been removed.');
    } catch (error) {
      if (error instanceof DeleteMessageThreadError && error.statusCode === 404) {
        hideThreadLocally(threadId);
        showSuccessToast('Conversation removed', 'This conversation is no longer available.');
        return;
      }
      showErrorToast('Delete failed', getDeleteMessageThreadErrorMessage(error));
    } finally {
      setDeletingThreadId(null);
    }
  };

  const confirmDeleteThread = (threadId: string) => {
    Alert.alert(
      'Delete this conversation?',
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => handleDeleteThread(threadId),
        },
      ]
    );
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
              <Trash2 size={20} color="white" />
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
              <User size={24} color="#9ca3af" />
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
              <Car size={12} color="#9ca3af" />
              <Text style={styles.chatItemRideInfoText}>{item.rideInfo}</Text>
            </View>
          </View>
        </TouchableOpacity>
      </Swipeable>
    );
  };

  if (loading) {
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
            <MessageCircle size={80} color="#d1d5db" />
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
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    flexDirection: 'row',
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
