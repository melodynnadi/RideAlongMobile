// RideAlongDriverMobile - Chat Detail Screen
import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  Image,
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
import { legacyUnreadField, roleKey, roleUnreadField } from '@/src/utils/roleIdentity';
import { useAppTheme } from '@/hooks/ThemeContext';
import { resolveChatAvailability } from '@/src/services/chatAvailability';


interface Message {
  id: string;
  senderId: string;
  senderRole?: 'rider' | 'driver';
  text: string;
  timestamp: any;
  read: boolean;
}

export default function ChatDetailScreen() {
  const { colors } = useAppTheme();
  const { chatId } = useLocalSearchParams();
  const goToMessages = useCallback(() => router.replace('/(driver)/messages' as any), []);

  const [messages, setMessages]           = useState<Message[]>([]);
  const [messageText, setMessageText]     = useState('');
  const [loading, setLoading]             = useState(true);
  const [recipientName, setRecipientName]       = useState('Loading...');
  const [recipientId, setRecipientId]           = useState<string | null>(null);
  const [recipientPhotoURL, setRecipientPhotoURL] = useState<string | null>(null);
  const [rideInfo, setRideInfo]           = useState('');
  const [rideStatus, setRideStatus]       = useState<string | null>(null);
  const [sending, setSending]             = useState(false);
  const [deleting, setDeleting]           = useState(false);

  const flatListRef      = useRef<FlatList>(null);
  const messagesUnsubRef = useRef<(() => void) | null>(null);
  const rideUnsubRef     = useRef<(() => void) | null>(null);
  const currentUser      = firebaseAuth.currentUser;

  const s = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    safe: { flex: 1 },
    keyboard: { flex: 1 },

    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
    loadingText: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },

    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg, gap: 10 },
    backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
    headerMid: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
    headerAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    headerAvatarInitial: { fontSize: 16, fontWeight: '800', color: colors.textInverse },
    headerTextWrap: { flex: 1 },
    headerName: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
    headerRoute: { fontSize: 11, color: colors.textSecondary, marginTop: 1, fontWeight: '500' },
    deleteBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.redDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.redBorder },

    msgList: { padding: 16, paddingBottom: 8, flexGrow: 1 },
    msgWrap: { marginBottom: 14 },
    msgWrapSent: { alignItems: 'flex-end' },
    msgWrapReceived: { alignItems: 'flex-start' },
    msgBubbleSent: { maxWidth: '72%', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 20, borderBottomRightRadius: 4, backgroundColor: colors.primary },
    msgTextSent: { fontSize: 15, color: colors.textInverse, lineHeight: 21 },
    msgBubbleReceived: { maxWidth: '72%', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 20, borderBottomLeftRadius: 4, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard },
    msgTextReceived: { fontSize: 15, color: colors.textPrimary, lineHeight: 21 },
    msgTime: { fontSize: 11, color: colors.textSecondary, marginTop: 4, marginHorizontal: 4, fontWeight: '500' },
    alignRight: { textAlign: 'right' },
    alignLeft: { textAlign: 'left' },

    quickReplyWrap: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 9, backgroundColor: colors.bg },
    quickReplyList: { paddingHorizontal: 14, gap: 8 },
    quickReplyChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, marginRight: 8, backgroundColor: colors.primaryDim, borderColor: colors.primaryBorder },
    quickReplyText: { fontSize: 12, fontWeight: '800', color: colors.primary },

    inputBar: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 14, paddingVertical: 12, paddingBottom: 28, borderTopWidth: 1, borderTopColor: colors.border, gap: 10, backgroundColor: colors.bgCard },
    input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 100, backgroundColor: colors.bgSecondary, color: colors.textPrimary },
    sendBtn: { width: 42, height: 42, borderRadius: 21, overflow: 'hidden' },
    sendBtnInner: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    disabledNotice: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.bgSecondary, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
    disabledNoticeText: { flex: 1, fontSize: 13, color: colors.textSecondary, textAlign: 'center', fontWeight: '500' },
    disabledOpacity: { opacity: 0.45 },
  }), [colors]);

  useEffect(() => {
    if (!currentUser || !chatId) { goToMessages(); return; }
    loadChatDetails();
    messagesUnsubRef.current = loadMessages();
    return () => {
      if (messagesUnsubRef.current) messagesUnsubRef.current();
      if (rideUnsubRef.current) rideUnsubRef.current();
    };
  }, [currentUser?.uid, chatId, goToMessages]);

  useFocusEffect(
    useCallback(() => {
      if (!currentUser || !chatId) return;
      const resetUnreadCount = async () => {
        try {
          await updateDoc(doc(firestore, 'chats', chatId as string), {
            [roleUnreadField('driver', currentUser.uid)]: 0,
            [`unreadCounts.${roleKey('driver', currentUser.uid)}`]: 0,
          });
        } catch {}
      };
      resetUnreadCount();
    }, [currentUser?.uid, chatId])
  );

  const truncateLocation = (location: string) => {
    if (!location) return 'Unknown';
    return location.length <= 30 ? location : `${location.substring(0, 30)}...`;
  };

  const loadChatDetails = async () => {
    try {
      const chatDoc = await getDoc(doc(firestore, 'chats', chatId as string));
      if (!chatDoc.exists()) { setLoading(false); return; }
      const chatData = chatDoc.data();
      const availability = await resolveChatAvailability(chatData).catch(() => ({ available: true, status: null, rideInfo: '' }));
      setRideStatus(availability.status || null);
      if (availability.rideInfo) setRideInfo(availability.rideInfo);
      const { driverId, rideId, participants } = chatData;
      const safeParticipants   = Array.isArray(participants) ? participants : [];
      const riderId            = chatData.riderId || chatData.riderUID || chatData.riderUid || chatData.userId;
      const otherParticipants  = [riderId || safeParticipants.find((id: string) => id !== currentUser!.uid)].filter(Boolean);
      const isGroupChat        = otherParticipants.length > 1;
      const recId              = otherParticipants[0];
      setRecipientId(recId);

      let displayName = 'Unknown User';
      if (isGroupChat) {
        const names: string[] = [];
        for (const pId of otherParticipants) {
          try {
            const ud = await getDoc(doc(firestore, pId === driverId ? 'drivers' : 'riders', pId));
            if (ud.exists()) { const d = ud.data(); names.push(d.fullName || d.name || d.email?.split('@')[0] || 'User'); }
          } catch {}
        }
        displayName = names.length > 0 ? names.join(', ') : 'Group Chat';
      } else if (recId) {
        const rd = await getDoc(doc(firestore, recId === driverId ? 'drivers' : 'riders', recId));
        if (rd.exists()) {
          const d = rd.data();
          displayName = d.fullName || d.name || d.email || 'Unknown User';
          setRecipientPhotoURL(d.photoURL || d.avatarUrl || null);
        }
      }
      setRecipientName(displayName);

      if (rideId) {
        const rideRef = doc(firestore, 'confirmedRides', rideId);
        const rideDoc = await getDoc(rideRef);
        if (rideDoc.exists()) {
          const rd = rideDoc.data();
          setRideInfo(`${truncateLocation(rd.pickup || rd.pickupAddress)} → ${truncateLocation(rd.dropoff || rd.dropoffAddress)} · ${rd.date || 'Date TBD'}`);
          setRideStatus(rd.status || null);
        }
        if (rideUnsubRef.current) rideUnsubRef.current();
        rideUnsubRef.current = onSnapshot(
          rideRef,
          (snap) => { if (snap.exists()) setRideStatus(snap.data().status || null); },
          (error) => {
            setRideStatus(null);
            console.warn('[DriverConversation] ride status listener error:', error);
          },
        );
      }
      await updateDoc(doc(firestore, 'chats', chatId as string), {
        [roleUnreadField('driver', currentUser!.uid)]: 0,
        [`unreadCounts.${roleKey('driver', currentUser!.uid)}`]: 0,
      });
    } catch (e) { console.error('Error loading chat details:', e); }
  };

  const loadMessages = () => {
    const q = query(collection(firestore, 'chats', chatId as string, 'messages'), orderBy('timestamp', 'asc'));
    return onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          senderId: data.senderId,
          senderRole: data.senderRole === 'driver' ? 'driver' : data.senderRole === 'rider' ? 'rider' : undefined,
          text: data.text,
          timestamp: data.timestamp,
          read: data.read || false,
        };
      }));
      setLoading(false);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }, (e) => { console.error('Error loading messages:', e); setLoading(false); });
  };

  const messagingAllowed = !isTerminalStatus(rideStatus) && (rideStatus ? canSendMessages(rideStatus) : true);

  const sendMessage = async () => {
    const text = messageText.trim();
    if (!text || !currentUser || sending || !recipientId) return;
    if (!messagingAllowed) {
      Alert.alert('Chat unavailable', MESSAGING_DISABLED_MESSAGE);
      return;
    }
    setSending(true);
    try {
      await addDoc(collection(firestore, 'chats', chatId as string, 'messages'), { senderId: currentUser.uid, senderRole: 'driver', text, timestamp: serverTimestamp(), read: false });
      const chatDoc = await getDoc(doc(firestore, 'chats', chatId as string));
      const chatData = chatDoc.data();
      const ps = chatData?.participants || [];
      const updateData: any = { lastMessage: text, lastMessageTimestamp: serverTimestamp(), lastMessageSenderId: currentUser.uid, lastMessageSenderRole: 'driver' };
      const riderId = chatData?.riderId || chatData?.riderUID || chatData?.riderUid || chatData?.userId;
      if (riderId) {
        const field = roleUnreadField('rider', String(riderId));
        updateData[field] = (chatData?.[field] || 0) + 1;
        updateData[`unreadCounts.${roleKey('rider', String(riderId))}`] = (chatData?.unreadCounts?.[roleKey('rider', String(riderId))] || 0) + 1;
      } else {
        for (const pId of ps) {
          if (pId !== currentUser.uid) updateData[legacyUnreadField(pId)] = (chatData?.[legacyUnreadField(pId)] || 0) + 1;
        }
      }
      await updateDoc(doc(firestore, 'chats', chatId as string), updateData);
      setMessageText('');

      // Push notification to the rider
      const notifyRiderId = riderId || (ps.find((p: string) => p !== currentUser.uid) ?? null);
      if (notifyRiderId) {
        try {
          const riderSnap = await getDoc(doc(firestore, 'riders', String(notifyRiderId)));
          const pushToken = riderSnap.exists() ? ((riderSnap.data() as any)?.pushToken || (riderSnap.data() as any)?.expoPushToken) : null;
          if (pushToken && String(pushToken).startsWith('ExponentPushToken')) {
            const senderName = currentUser.displayName || 'Your driver';
            const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({
                to: pushToken,
                title: `Message from ${senderName}`,
                body: text.length > 100 ? `${text.slice(0, 97)}...` : text,
                data: { type: 'chat_message', chatId: String(chatId) },
                sound: 'default',
              }),
            });
            if (!pushRes.ok) throw new Error(`Push failed: ${pushRes.status}`);
          }
        } catch {}
      }
    } catch (e: any) {
      console.error('Error sending message:', e);
      Alert.alert('Message not sent', e?.message || 'Please check your connection and try again.');
    }
    finally { setSending(false); }
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
    } finally { setDeleting(false); }
  };

  const confirmDeleteConversation = () => {
    if (!chatId || deleting) return;
    Alert.alert('Delete conversation', 'Delete this conversation? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: executeDeleteConversation },
    ]);
  };

  const formatMessageTime = (timestamp: any) => {
    if (!timestamp?.toDate) return '';
    return timestamp.toDate().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isSent = item.senderId === currentUser?.uid && (!item.senderRole || item.senderRole === 'driver');
    return (
      <View style={[s.msgWrap, isSent ? s.msgWrapSent : s.msgWrapReceived]}>
        {isSent ? (
          <View style={s.msgBubbleSent}>
            <Text style={s.msgTextSent}>{item.text}</Text>
          </View>
        ) : (
          <View style={s.msgBubbleReceived}>
            <Text style={s.msgTextReceived}>{item.text}</Text>
          </View>
        )}
        <Text style={[s.msgTime, isSent ? s.alignRight : s.alignLeft]}>
          {formatMessageTime(item.timestamp)}
        </Text>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={s.root}>
        <StatusBar barStyle={colors.statusBar} />
        <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
          <Stack.Screen options={{ headerShown: false }} />
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={s.loadingText}>Loading conversation...</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle={colors.statusBar} />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <Stack.Screen options={{ headerShown: false }} />
        <KeyboardAvoidingView style={s.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>

          <FlatList
            ListHeaderComponent={
              <>
                {/* Header */}
          <View style={s.header}>
            <TouchableOpacity style={s.backBtn} onPress={goToMessages}>
              <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>

            <View style={s.headerMid}>
              <View style={s.headerAvatar}>
                {recipientPhotoURL
                  ? <Image source={{ uri: recipientPhotoURL }} style={{ width: 38, height: 38, borderRadius: 19 }} />
                  : <Text style={s.headerAvatarInitial}>{recipientName?.[0]?.toUpperCase() || '?'}</Text>}
              </View>
              <View style={s.headerTextWrap}>
                <Text style={s.headerName} numberOfLines={1}>{recipientName}</Text>
                {rideInfo ? <Text style={s.headerRoute} numberOfLines={1}>{rideInfo}</Text> : null}
              </View>
            </View>

            <TouchableOpacity style={[s.deleteBtn, deleting && s.disabledOpacity]} onPress={confirmDeleteConversation} disabled={deleting}>
              {deleting ? <ActivityIndicator size="small" color={colors.red} /> : <Ionicons name="trash-outline" size={19} color={colors.red} />}
            </TouchableOpacity>
          </View>


              </>
            }
            ListHeaderComponentStyle={{ marginHorizontal: -16, marginTop: -16, marginBottom: 12 }}
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[s.msgList, !messages.length && { flex: 1 }]}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              !loading ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
                  <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                    <Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.primary} />
                  </View>
                  <Text style={{ color: colors.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: 8, textAlign: 'center' }}>Coordinate your ride</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
                    Use this chat to discuss pickup location, timing, any last-minute changes, or if you're running late.
                  </Text>
                </View>
              ) : null
            }
          />


          <View style={s.inputBar}>
            {!messagingAllowed ? (
              <View style={s.disabledNotice}>
                <Ionicons name="lock-closed-outline" size={14} color={colors.textSecondary} />
                <Text style={s.disabledNoticeText}>{MESSAGING_DISABLED_MESSAGE}</Text>
              </View>
            ) : (
              <>
                <TextInput
                  style={s.input}
                  placeholder="Pickup spot, timing, updates…"
                  placeholderTextColor={colors.textSecondary}
                  value={messageText}
                  onChangeText={setMessageText}
                  multiline
                  maxLength={1000}
                />
                <TouchableOpacity
                  style={[s.sendBtn, (!messageText.trim() || sending) && s.disabledOpacity]}
                  onPress={sendMessage}
                  disabled={!messageText.trim() || sending}
                >
                  <View style={s.sendBtnInner}>
                    {sending ? <ActivityIndicator size="small" color={colors.textInverse} /> : <Ionicons name="send" size={18} color={colors.textInverse} />}
                  </View>
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
