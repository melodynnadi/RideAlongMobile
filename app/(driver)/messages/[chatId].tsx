// RideAlongDriverMobile - Chat Detail Screen
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';

import { firestore, firebaseAuth } from '@/constants/services';
import {
  isTerminalStatus,
  canSendMessages,
  MESSAGING_DISABLED_MESSAGE,
} from '@/constants/rideStatusConstants';
import {
  addHiddenDeletedThreadIdForCurrentUser,
  deleteMessageThread,
  DeleteMessageThreadError,
  getDeleteMessageThreadErrorMessage,
} from '@/services/messageThreadsService';
import { showErrorToast, showSuccessToast } from '@/src/utils/showToast';
import { useAppTheme } from '@/hooks/ThemeContext';
import { AppColors, BRAND } from '@/constants/theme';

interface Message {
  id: string;
  senderId: string;
  text: string;
  timestamp: any;
  read: boolean;
}

type GradientStops = readonly [string, string, ...string[]];

const asGradientStops = (stops: string[]): GradientStops => {
  return stops as unknown as GradientStops;
};

const brandGradient: GradientStops = [BRAND.orange, BRAND.orangeDeep];

const QUICK_REPLIES = [
  "I'm on my way.",
  'I just arrived.',
  'Meet me at the pickup spot.',
  'Thanks, see you soon.',
];

export default function ChatDetailScreen() {
  const { chatId } = useLocalSearchParams();
  const { colors, isDark } = useAppTheme();
  const themed = createStyles(colors, isDark);

  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(true);
  const [recipientName, setRecipientName] = useState('Loading...');
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [rideInfo, setRideInfo] = useState('');
  const [rideStatus, setRideStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const messagesUnsubRef = useRef<(() => void) | null>(null);
  const rideUnsubRef = useRef<(() => void) | null>(null);
  const currentUser = firebaseAuth.currentUser;

  useEffect(() => {
    if (!currentUser || !chatId) {
      router.back();
      return;
    }

    loadChatDetails();
    messagesUnsubRef.current = loadMessages();

    return () => {
      if (messagesUnsubRef.current) messagesUnsubRef.current();
      if (rideUnsubRef.current) rideUnsubRef.current();
    };
  }, [currentUser?.uid, chatId]);

  useFocusEffect(
    useCallback(() => {
      if (!currentUser || !chatId) return;

      const resetUnreadCount = async () => {
        try {
          const unreadField = `unreadCount_${currentUser.uid}`;

          await updateDoc(doc(firestore, 'chats', chatId as string), {
            [unreadField]: 0,
          });
        } catch (error) {
          console.error('Error resetting unread count:', error);
        }
      };

      resetUnreadCount();
    }, [currentUser?.uid, chatId])
  );

  const truncateLocation = (location: string) => {
    if (!location) return 'Unknown';
    const maxLen = 30;
    return location.length <= maxLen ? location : `${location.substring(0, maxLen)}...`;
  };

  const loadChatDetails = async () => {
    try {
      const chatDoc = await getDoc(doc(firestore, 'chats', chatId as string));

      if (!chatDoc.exists()) {
        console.error('Chat not found');
        setLoading(false);
        return;
      }

      const chatData = chatDoc.data();
      const { driverId, rideId, participants } = chatData;
      const safeParticipants = Array.isArray(participants) ? participants : [];
      const otherParticipants = safeParticipants.filter((id: string) => id !== currentUser!.uid);
      const isGroupChat = otherParticipants.length > 1;
      const recId = otherParticipants[0];

      setRecipientId(recId);

      let displayName = 'Unknown User';

      if (isGroupChat) {
        const names: string[] = [];

        for (const participantId of otherParticipants) {
          try {
            const isDriver = participantId === driverId;
            const userDoc = await getDoc(
              doc(firestore, isDriver ? 'drivers' : 'riders', participantId)
            );

            if (userDoc.exists()) {
              const userData = userDoc.data();
              const name =
                userData.fullName ||
                userData.name ||
                userData.email?.split('@')[0] ||
                'User';

              names.push(name);
            }
          } catch (error) {
            console.error('Error fetching participant:', error);
          }
        }

        displayName = names.length > 0 ? names.join(', ') : 'Group Chat';
      } else if (recId) {
        const isRecipientDriver = recId === driverId;
        const recipientDoc = await getDoc(
          doc(firestore, isRecipientDriver ? 'drivers' : 'riders', recId)
        );

        if (recipientDoc.exists()) {
          const recipientData = recipientDoc.data();
          displayName =
            recipientData.fullName ||
            recipientData.name ||
            recipientData.email ||
            'Unknown User';
        }
      }

      setRecipientName(displayName);

      if (rideId) {
        const rideRef = doc(firestore, 'confirmedRides', rideId);
        const rideDoc = await getDoc(rideRef);

        if (rideDoc.exists()) {
          const rideData = rideDoc.data();
          const pickup = truncateLocation(rideData.pickup || rideData.pickupAddress);
          const dropoff = truncateLocation(rideData.dropoff || rideData.dropoffAddress);
          const date = rideData.date || 'Date TBD';

          setRideInfo(`${pickup} -> ${dropoff} • ${date}`);
          setRideStatus(rideData.status || null);
        }

        if (rideUnsubRef.current) rideUnsubRef.current();

        rideUnsubRef.current = onSnapshot(
          rideRef,
          (rideSnapshot) => {
            if (!rideSnapshot.exists()) return;

            const updatedRideData = rideSnapshot.data();
            setRideStatus(updatedRideData.status || null);
          },
          (error) => {
            console.error('Error listening to ride status:', error);
          }
        );
      }

      const unreadField = `unreadCount_${currentUser!.uid}`;

      await updateDoc(doc(firestore, 'chats', chatId as string), {
        [unreadField]: 0,
      });
    } catch (error) {
      console.error('Error loading chat details:', error);
    }
  };

  const loadMessages = () => {
    const messagesQuery = query(
      collection(firestore, 'chats', chatId as string, 'messages'),
      orderBy('timestamp', 'asc')
    );

    const unsubscribe = onSnapshot(
      messagesQuery,
      (snapshot) => {
        const messagesList: Message[] = [];

        snapshot.forEach((docSnap) => {
          const messageData = docSnap.data();

          messagesList.push({
            id: docSnap.id,
            senderId: messageData.senderId,
            text: messageData.text,
            timestamp: messageData.timestamp,
            read: messageData.read || false,
          });
        });

        setMessages(messagesList);
        setLoading(false);

        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 100);
      },
      (error) => {
        console.error('Error loading messages:', error);
        setLoading(false);
      }
    );

    return unsubscribe;
  };

  const sendMessage = async () => {
    const text = messageText.trim();

    if (!text || !currentUser || sending || !recipientId) return;

    if (!canSendMessages(rideStatus) || isTerminalStatus(rideStatus)) {
      console.warn('Cannot send message: ride is in terminal status');
      return;
    }

    setSending(true);

    try {
      await addDoc(collection(firestore, 'chats', chatId as string, 'messages'), {
        senderId: currentUser.uid,
        text,
        timestamp: serverTimestamp(),
        read: false,
      });

      const chatDoc = await getDoc(doc(firestore, 'chats', chatId as string));
      const chatData = chatDoc.data();
      const participants = chatData?.participants || [];

      const updateData: any = {
        lastMessage: text,
        lastMessageTimestamp: serverTimestamp(),
        lastMessageSenderId: currentUser.uid,
      };

      for (const participantId of participants) {
        if (participantId !== currentUser.uid) {
          const unreadField = `unreadCount_${participantId}`;
          const currentUnread = chatData?.[unreadField] || 0;
          updateData[unreadField] = currentUnread + 1;
        }
      }

      await updateDoc(doc(firestore, 'chats', chatId as string), updateData);
      setMessageText('');
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setSending(false);
    }
  };

  const executeDeleteConversation = async () => {
    if (!chatId || deleting) return;

    const threadId = String(chatId);
    setDeleting(true);

    try {
      await deleteMessageThread(threadId);
      await addHiddenDeletedThreadIdForCurrentUser(threadId);
      showSuccessToast('Conversation deleted', 'This conversation was removed.');
      router.replace('/(driver)/messages' as any);
    } catch (error) {
      const statusCode = (error as DeleteMessageThreadError | undefined)?.statusCode;

      if (statusCode === 404) {
        await addHiddenDeletedThreadIdForCurrentUser(threadId);
        showSuccessToast('Conversation deleted', 'Conversation no longer exists.');
        router.replace('/(driver)/messages' as any);
        return;
      }

      showErrorToast('Unable to delete conversation', getDeleteMessageThreadErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const confirmDeleteConversation = () => {
    if (!chatId || deleting) return;

    Alert.alert(
      'Delete conversation',
      'Delete this conversation? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: executeDeleteConversation,
        },
      ]
    );
  };

  const formatMessageTime = (timestamp: any) => {
    if (!timestamp || !timestamp.toDate) return '';

    const date = timestamp.toDate();

    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isSent = item.senderId === currentUser?.uid;

    return (
      <View style={[styles.msgWrap, isSent ? styles.msgWrapSent : styles.msgWrapReceived]}>
        {isSent ? (
          <LinearGradient
            colors={brandGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.msgBubbleSent}
          >
            <Text style={styles.msgTextSent}>{item.text}</Text>
          </LinearGradient>
        ) : (
          <View style={themed.msgBubbleReceived}>
            {isDark && (
              <BlurView intensity={18} tint="dark" style={StyleSheet.absoluteFillObject} />
            )}
            <Text style={themed.msgTextReceived}>{item.text}</Text>
          </View>
        )}

        <Text style={[themed.msgTime, isSent ? styles.alignRight : styles.alignLeft]}>
          {formatMessageTime(item.timestamp)}
        </Text>
      </View>
    );
  };

  const messagingAllowed = canSendMessages(rideStatus) && !isTerminalStatus(rideStatus);
  const statusLabel = rideStatus ? rideStatus.replace(/_/g, ' ') : 'Ride active';

  if (loading) {
    return (
      <View style={themed.root}>
        <StatusBar barStyle={colors.statusBar} />
        <LinearGradient
          colors={asGradientStops(colors.gradientBg)}
          style={StyleSheet.absoluteFillObject}
        />

        <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
          <Stack.Screen options={{ headerShown: false }} />

          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={themed.loadingText}>Loading conversation...</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={themed.root}>
      <StatusBar barStyle={colors.statusBar} />
      <LinearGradient
        colors={asGradientStops(colors.gradientBg)}
        style={StyleSheet.absoluteFillObject}
      />

      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <Stack.Screen options={{ headerShown: false }} />

        <KeyboardAvoidingView
          style={styles.keyboard}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <View style={themed.header}>
            {isDark && (
              <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFillObject} />
            )}

            <TouchableOpacity style={themed.backBtn} onPress={() => router.back()}>
              <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>

            <View style={styles.headerMid}>
              <LinearGradient colors={brandGradient} style={styles.headerAvatar}>
                <Text style={styles.headerAvatarInitial}>
                  {recipientName?.[0]?.toUpperCase() || '?'}
                </Text>
              </LinearGradient>

              <View style={styles.headerTextWrap}>
                <Text style={themed.headerName} numberOfLines={1}>
                  {recipientName}
                </Text>

                {rideInfo ? (
                  <Text style={themed.headerRoute} numberOfLines={1}>
                    {rideInfo}
                  </Text>
                ) : null}
              </View>
            </View>

            <TouchableOpacity
              style={[themed.deleteBtn, deleting && styles.disabledOpacity]}
              onPress={confirmDeleteConversation}
              disabled={deleting}
            >
              {deleting ? (
                <ActivityIndicator size="small" color={colors.redDeep} />
              ) : (
                <Ionicons name="trash-outline" size={19} color={colors.redDeep} />
              )}
            </TouchableOpacity>
          </View>

          {rideInfo ? (
            <View style={themed.rideStrip}>
              <Ionicons name="navigate-outline" size={13} color={colors.primary} />
              <Text style={themed.rideStripText} numberOfLines={1}>
                {rideInfo}
              </Text>
            </View>
          ) : null}

          <View style={themed.safetyStrip}>
            <View style={styles.safetyIconWrap}>
              <Ionicons
                name={messagingAllowed ? 'shield-checkmark-outline' : 'lock-closed-outline'}
                size={15}
                color={messagingAllowed ? colors.green : colors.textTertiary}
              />
            </View>

            <View style={styles.safetyTextWrap}>
              <Text style={themed.safetyTitle}>
                {messagingAllowed ? 'Ride Safety Context' : 'Messaging Closed'}
              </Text>
              <Text style={themed.safetyText} numberOfLines={1}>
                {messagingAllowed
                  ? `Status: ${statusLabel}. Keep pickup details clear and visible.`
                  : MESSAGING_DISABLED_MESSAGE}
              </Text>
            </View>
          </View>

          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.msgList}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            showsVerticalScrollIndicator={false}
          />

          {messagingAllowed && messageText.trim().length === 0 ? (
            <View style={themed.quickReplyWrap}>
              <ScrollQuickReplies
                colors={colors}
                replies={QUICK_REPLIES}
                onSelect={setMessageText}
              />
            </View>
          ) : null}

          <View style={themed.inputBar}>
            {isDark && (
              <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFillObject} />
            )}

            {!messagingAllowed ? (
              <View style={themed.disabledNotice}>
                <Ionicons name="lock-closed-outline" size={14} color={colors.textTertiary} />
                <Text style={themed.disabledNoticeText}>{MESSAGING_DISABLED_MESSAGE}</Text>
              </View>
            ) : (
              <>
                <TextInput
                  style={themed.input}
                  placeholder="Message..."
                  placeholderTextColor={colors.textTertiary}
                  value={messageText}
                  onChangeText={setMessageText}
                  multiline
                  maxLength={1000}
                />

                <TouchableOpacity
                  style={[styles.sendBtn, (!messageText.trim() || sending) && styles.disabledOpacity]}
                  onPress={sendMessage}
                  disabled={!messageText.trim() || sending}
                >
                  <LinearGradient colors={brandGradient} style={styles.sendBtnGrad}>
                    {sending ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Ionicons name="send" size={18} color="#FFFFFF" />
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function ScrollQuickReplies({
  replies,
  onSelect,
  colors,
}: {
  replies: string[];
  onSelect: (text: string) => void;
  colors: AppColors;
}) {
  return (
    <FlatList
      horizontal
      data={replies}
      keyExtractor={(item) => item}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.quickReplyList}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={[
            styles.quickReplyChip,
            {
              backgroundColor: colors.primaryDim,
              borderColor: colors.primaryBorder,
            },
          ]}
          onPress={() => onSelect(item)}
        >
          <Text style={[styles.quickReplyText, { color: colors.primary }]}>{item}</Text>
        </TouchableOpacity>
      )}
    />
  );
}

const createStyles = (colors: AppColors, isDark: boolean) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    loadingText: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: '500',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      overflow: 'hidden',
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
    },
    backBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(13,27,72,0.06)',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 10,
      borderWidth: 1,
      borderColor: colors.borderMid,
    },
    headerName: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    headerRoute: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 1,
      fontWeight: '500',
    },
    deleteBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.redDim,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 6,
      borderWidth: 1,
      borderColor: colors.redBorder,
    },
    rideStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: colors.primaryDim,
      borderBottomWidth: 1,
      borderBottomColor: colors.primaryBorder,
    },
    rideStripText: {
      flex: 1,
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    safetyStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginHorizontal: 14,
      marginTop: 10,
      padding: 12,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
    },
    safetyTitle: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.textPrimary,
      marginBottom: 1,
    },
    safetyText: {
      fontSize: 11,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    msgBubbleReceived: {
      maxWidth: '72%',
      paddingHorizontal: 16,
      paddingVertical: 11,
      borderRadius: 20,
      borderBottomLeftRadius: 4,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
    },
    msgTextReceived: {
      fontSize: 15,
      color: colors.textPrimary,
      lineHeight: 21,
    },
    msgTime: {
      fontSize: 11,
      color: colors.textTertiary,
      marginTop: 4,
      marginHorizontal: 4,
      fontWeight: '500',
    },
    quickReplyWrap: {
      borderTopWidth: 1,
      borderTopColor: colors.divider,
      paddingVertical: 9,
      backgroundColor: isDark ? 'rgba(5,12,30,0.55)' : 'rgba(247,249,255,0.75)',
    },
    inputBar: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: 14,
      paddingVertical: 12,
      paddingBottom: 28,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
      gap: 10,
      overflow: 'hidden',
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
    },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.borderMid,
      borderRadius: 22,
      paddingHorizontal: 16,
      paddingVertical: 10,
      fontSize: 15,
      maxHeight: 100,
      backgroundColor: colors.bgInput,
      color: colors.textPrimary,
    },
    disabledNotice: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: colors.bgInput,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.borderMid,
    },
    disabledNoticeText: {
      flex: 1,
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
      fontWeight: '500',
    },
  });

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  keyboard: {
    flex: 1,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  headerMid: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarInitial: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  headerTextWrap: {
    flex: 1,
  },
  safetyIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  safetyTextWrap: {
    flex: 1,
  },
  msgList: {
    padding: 16,
    paddingBottom: 8,
    flexGrow: 1,
  },
  msgWrap: {
    marginBottom: 14,
  },
  msgWrapSent: {
    alignItems: 'flex-end',
  },
  msgWrapReceived: {
    alignItems: 'flex-start',
  },
  msgBubbleSent: {
    maxWidth: '72%',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 20,
    borderBottomRightRadius: 4,
  },
  msgTextSent: {
    fontSize: 15,
    color: '#FFFFFF',
    lineHeight: 21,
  },
  alignRight: {
    textAlign: 'right',
  },
  alignLeft: {
    textAlign: 'left',
  },
  quickReplyList: {
    paddingHorizontal: 14,
    gap: 8,
  },
  quickReplyChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 8,
  },
  quickReplyText: {
    fontSize: 12,
    fontWeight: '800',
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: 'hidden',
  },
  sendBtnGrad: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledOpacity: {
    opacity: 0.45,
  },
});