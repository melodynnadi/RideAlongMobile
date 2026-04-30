// RideAlongRiderMobile - Chat Detail Screen
import React, { useEffect, useState, useRef } from 'react';
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
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { firestore, firebaseAuth } from '@/constants/services';
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
import { isTerminalStatus, canSendMessages, MESSAGING_DISABLED_MESSAGE } from '@/constants/rideStatusConstants';
import { deleteMessageThread, getDeleteMessageThreadErrorMessage, DeleteMessageThreadError } from '@/services/messageThreads';
import { showErrorToast, showSuccessToast } from '@/src/utils/showToast';

interface Message {
  id: string;
  senderId: string;
  text: string;
  timestamp: any;
  read: boolean;
}

export default function ChatDetailScreen() {
  const { chatId } = useLocalSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(true);
  const [recipientName, setRecipientName] = useState('Loading...');
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [rideInfo, setRideInfo] = useState('');
  const [rideStatus, setRideStatus] = useState<string | null>(null); // Track ride status for messaging restrictions
  const [messagesDenied, setMessagesDenied] = useState(false);
  const [sending, setSending] = useState(false);
  const [deletingThread, setDeletingThread] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const currentUser = firebaseAuth.currentUser;

  useEffect(() => {
    if (!currentUser || !chatId) {
      router.back();
      return;
    }

    loadChatDetails();
    loadMessages();
  }, [currentUser, chatId]);

  // Reset unread count whenever the screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      if (!currentUser || !chatId) return;
      
      const resetUnreadCount = async () => {
        try {
          const unreadField = `unreadCount_${currentUser.uid}`;
          await updateDoc(doc(firestore, 'chats', chatId as string), {
            [unreadField]: 0
          });
        } catch (error) {
          console.error('Error resetting unread count:', error);
        }
      };
      
      resetUnreadCount();
    }, [currentUser, chatId])
  );

  const loadChatDetails = async () => {
    try {
      const chatDoc = await getDoc(doc(firestore, 'chats', chatId as string));
      if (!chatDoc.exists()) {
        console.error('Chat not found');
        return;
      }

      const chatData = chatDoc.data();
      const { riderId, driverId, rideId, participants } = chatData;

      // For group chats, get all other participants
      const otherParticipants = participants.filter((id: string) => id !== currentUser!.uid);
      const isGroupChat = otherParticipants.length > 1;

      // For backwards compatibility, still set recipientId (first other participant)
      const recId = otherParticipants[0];
      setRecipientId(recId);

      // Fetch recipient name(s)
      let displayName = 'Unknown User';
      if (isGroupChat) {
        // Group chat: fetch all participant names
        const names: string[] = [];
        for (const participantId of otherParticipants) {
          try {
            const isDriver = participantId === driverId;
            const userDoc = await getDoc(
              doc(firestore, isDriver ? 'drivers' : 'users', participantId)
            );
            if (userDoc.exists()) {
              const userData = userDoc.data();
              const name = userData.fullName || userData.name || userData.email?.split('@')[0] || 'User';
              names.push(name);
            }
          } catch (error) {
            console.error('Error fetching participant:', error);
          }
        }
        displayName = names.length > 0 ? names.join(', ') : 'Group Chat';
      } else {
        // 1-on-1 chat
        const isRecipientDriver = recId === driverId;
        const recipientDoc = await getDoc(
          doc(firestore, isRecipientDriver ? 'drivers' : 'users', recId)
        );

        if (recipientDoc.exists()) {
          const recipientData = recipientDoc.data();
          displayName = recipientData.fullName || recipientData.name || recipientData.email || 'Unknown User';
        }
      }

      setRecipientName(displayName);

      // Fetch ride info and set up real-time status listener
      let rideDoc = await getDoc(doc(firestore, 'confirmedRides', rideId));
      if (!rideDoc.exists()) {
        try { rideDoc = await getDoc(doc(firestore, 'rides', rideId)); } catch {}
      }
      if (rideDoc.exists()) {
        const rideData = rideDoc.data();
        const pickup = truncateLocation(rideData.pickup || rideData.pickupAddress);
        const dropoff = truncateLocation(rideData.dropoff || rideData.dropoffAddress);
        const date = rideData.date || 'Date TBD';
        setRideInfo(`${pickup} → ${dropoff} • ${date}`);
        
        // Set initial ride status
        setRideStatus(rideData.status || null);
        
        // Set up real-time listener for ride status changes
        const rideUnsubscribe = onSnapshot(
          doc(firestore, 'confirmedRides', rideId),
          (rideSnapshot) => {
            if (rideSnapshot.exists()) {
              const updatedRideData = rideSnapshot.data();
              setRideStatus(updatedRideData.status || null);
            }
          },
          (error) => {
            console.error('Error listening to ride status:', error);
          }
        );
        
        // Return cleanup function
        return rideUnsubscribe;
      }

      // Mark messages as read for current user
      const unreadField = `unreadCount_${currentUser!.uid}`;
      await updateDoc(doc(firestore, 'chats', chatId as string), {
        [unreadField]: 0
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

        // Scroll to bottom
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 100);
      },
      (error) => {
        console.error('Error loading messages:', error);
        if (error?.code === 'permission-denied') {
          setMessagesDenied(true);
        }
        setLoading(false);
      }
    );

    return unsubscribe;
  };

  const sendMessage = async () => {
    const text = messageText.trim();

    if (!text || !currentUser || sending || !recipientId) {
      return;
    }
    
    // Check if messaging is allowed for current ride status
    if (isTerminalStatus(rideStatus)) {
      console.warn('Cannot send message: ride is in terminal status');
      return;
    }

    setSending(true);

    try {
      // Add message to subcollection
      await addDoc(collection(firestore, 'chats', chatId as string, 'messages'), {
        senderId: currentUser.uid,
        text: text,
        timestamp: serverTimestamp(),
        read: false,
      });

      // Get current chat document to update unread counts for all other participants
      const chatDoc = await getDoc(doc(firestore, 'chats', chatId as string));
      const chatData = chatDoc.data();
      const participants = chatData?.participants || [];
      
      // Build update object with unread counts for all other participants
      const updateData: any = {
        lastMessage: text,
        lastMessageTimestamp: serverTimestamp(),
        lastMessageSenderId: currentUser.uid,
      };
      
      // Increment unread count for each participant except sender
      for (const participantId of participants) {
        if (participantId !== currentUser.uid) {
          const unreadField = `unreadCount_${participantId}`;
          const currentUnread = chatData?.[unreadField] || 0;
          updateData[unreadField] = currentUnread + 1;
        }
      }

      // Update chat document
      await updateDoc(doc(firestore, 'chats', chatId as string), updateData);

      setMessageText('');
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setSending(false);
    }
  };

  const handleDeleteConversation = async () => {
    if (!chatId || deletingThread) return;

    setDeletingThread(true);
    try {
      await deleteMessageThread(String(chatId));
      showSuccessToast('Conversation deleted', 'This conversation has been removed.');
      router.replace('/(tabs)/messages');
    } catch (error) {
      if (error instanceof DeleteMessageThreadError && error.statusCode === 404) {
        showSuccessToast('Conversation removed', 'This conversation is no longer available.');
        router.replace('/(tabs)/messages');
        return;
      }

      const errorMessage = getDeleteMessageThreadErrorMessage(error);
      showErrorToast('Delete failed', errorMessage);
    } finally {
      setDeletingThread(false);
    }
  };

  const confirmDeleteConversation = () => {
    Alert.alert(
      'Delete this conversation?',
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: handleDeleteConversation,
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

  const truncateLocation = (location: string) => {
    if (!location) return 'Unknown';
    const maxLen = 30;
    if (location.length <= maxLen) return location;
    return location.substring(0, maxLen) + '...';
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isSent = item.senderId === currentUser?.uid;

    return (
      <View style={[styles.messageBubble, isSent ? styles.sentBubble : styles.receivedBubble]}>
        <View style={[styles.messageContent, isSent ? styles.sentContent : styles.receivedContent]}>
          <Text style={[styles.messageText, isSent ? styles.sentText : styles.receivedText]}>
            {item.text}
          </Text>
        </View>
        <Text style={styles.messageTimestamp}>{formatMessageTime(item.timestamp)}</Text>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Stack.Screen
          options={{
            headerShown: false,
          }}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#E05E1A" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Custom Header with Back Button and Name */}
        <View style={styles.customHeader}>
          <TouchableOpacity 
            style={styles.backButton} 
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color="#1f2937" />
          </TouchableOpacity>
          
          <View style={styles.headerCenter}>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerName} numberOfLines={1}>
                {recipientName}
              </Text>
              {rideInfo && (
                <Text style={styles.headerRideInfo} numberOfLines={1}>
                  {rideInfo}
                </Text>
              )}
            </View>
          </View>

          <TouchableOpacity
            style={[styles.headerDeleteButton, deletingThread && styles.headerDeleteButtonDisabled]}
            onPress={confirmDeleteConversation}
            disabled={deletingThread}
            accessibilityLabel="Delete conversation"
          >
            {deletingThread ? (
              <ActivityIndicator size="small" color="#EF4444" />
            ) : (
              <Ionicons name="trash-outline" size={20} color="#EF4444" />
            )}
          </TouchableOpacity>
        </View>

        {/* Messages List */}
        {messagesDenied ? (
          <View style={styles.deniedContainer}>
            <Ionicons name="lock-closed" size={48} color="#9ca3af" />
            <Text style={styles.deniedTitle}>Messages unavailable</Text>
            <Text style={styles.deniedText}>You don’t have permission to view this conversation. If this chat is linked to an old or invalid ride, it may no longer be accessible.</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messagesContainer}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          />
        )}

        {/* Message Input */}
        <View style={styles.inputContainer}>
          {messagesDenied ? (
            <View style={styles.disabledMessageContainer}>
              <Text style={styles.disabledMessageText}>Messaging is disabled for this conversation.</Text>
            </View>
          ) : isTerminalStatus(rideStatus) ? (
            // Show disabled messaging notice when ride is in terminal status
            <View style={styles.disabledMessageContainer}>
              <Text style={styles.disabledMessageText}>{MESSAGING_DISABLED_MESSAGE}</Text>
            </View>
          ) : (
            // Show active input when messaging is allowed
            <>
              <TextInput
                style={styles.input}
                placeholder="Type your message..."
                placeholderTextColor="#9ca3af"
                value={messageText}
                onChangeText={setMessageText}
                multiline
                maxLength={1000}
              />
              <TouchableOpacity
                style={[styles.sendButton, (!messageText.trim() || sending) && styles.sendButtonDisabled]}
                onPress={sendMessage}
                disabled={!messageText.trim() || sending}
              >
                <Ionicons name="send" size={20} color="white" />
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
  },
  deniedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  deniedTitle: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
  },
  deniedText: {
    marginTop: 8,
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  customHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 12,
  },
  headerAvatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerTextContainer: {
    flex: 1,
  },
  headerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
  },
  headerRideInfo: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  headerRight: {
    width: 40,
  },
  headerDeleteButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
  },
  headerDeleteButtonDisabled: {
    opacity: 0.6,
  },
  rideInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#e5e7eb',
    gap: 6,
  },
  rideInfoText: {
    fontSize: 12,
    color: '#6b7280',
  },
  messagesContainer: {
    padding: 16,
    flexGrow: 1,
  },
  messageBubble: {
    marginBottom: 12,
  },
  sentBubble: {
    alignItems: 'flex-end',
  },
  receivedBubble: {
    alignItems: 'flex-start',
  },
  messageContent: {
    maxWidth: '70%',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
  },
  sentContent: {
    backgroundColor: '#E05E1A',
    borderBottomRightRadius: 4,
  },
  receivedContent: {
    backgroundColor: 'white',
    borderBottomLeftRadius: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  messageText: {
    fontSize: 15,
  },
  sentText: {
    color: 'white',
  },
  receivedText: {
    color: '#1f2937',
  },
  messageTimestamp: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 4,
    marginHorizontal: 4,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    paddingBottom: 24,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    gap: 8,
  },
  disabledMessageContainer: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f3f4f6',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledMessageText: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 100,
    backgroundColor: '#f9fafb',
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E05E1A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
});
