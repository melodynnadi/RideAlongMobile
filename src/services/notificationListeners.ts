import { collection, onSnapshot, query, where, Unsubscribe, DocumentChange } from 'firebase/firestore';
import { firestore } from '@/constants/services';
import { showLocalNotification } from '@/services/messagingService';
import { AppState } from 'react-native';
import { chatBelongsToRole, roleUnreadField } from '@/src/utils/roleIdentity';

/**
 * Watches this user's chats for new incoming messages and fires a local
 * notification while the app is backgrounded. This is a client-side stand-in
 * for a real server-sent push — it only works while the app process is still
 * alive in the background, not once the app has been fully killed. Call once
 * per signed-in session (root layout), for whichever role is currently active.
 */
export function setupChatNotificationListeners(uid: string, role: 'rider' | 'driver'): () => void {
  const roleField = role === 'driver' ? 'driverId' : 'riderId';
  const processedDocs = new Set<string>();
  let isFirstSnapshot = true;

  const chatsQuery = query(
    collection(firestore, 'chats'),
    where(roleField, '==', uid),
  );

  const unsubscribe = onSnapshot(chatsQuery, async (snapshot) => {
    // Skip the initial snapshot so we don't notify for chats that already existed.
    if (isFirstSnapshot) {
      isFirstSnapshot = false;
      snapshot.docs.forEach((d) => processedDocs.add(d.id));
      return;
    }

    for (const change of snapshot.docChanges() as DocumentChange[]) {
      const docId = change.doc.id;
      const data = change.doc.data() as any;
      if (!chatBelongsToRole(data, uid, role)) continue;

      if (change.type === 'modified' && processedDocs.has(docId)) {
        const lastMessage = data?.lastMessage;
        const unreadField = roleUnreadField(role, uid);
        const unreadCount = data?.[unreadField] || 0;

        // Only notify if there's something unread and the app isn't actively open.
        if (unreadCount > 0 && lastMessage && AppState.currentState !== 'active') {
          const participants = data?.participants || [];
          const senderId = participants.find((id: string) => id !== uid);

          let senderName = 'Someone';
          try {
            const { doc: firestoreDoc, getDoc } = await import('firebase/firestore');
            const senderIsDriver = senderId === data?.driverId;
            const senderDoc = await getDoc(
              firestoreDoc(firestore, senderIsDriver ? 'drivers' : 'riders', senderId),
            );
            if (senderDoc.exists()) {
              const senderData = senderDoc.data() as any;
              senderName = senderData.fullName || senderData.name || senderData.email || 'Someone';
            }
          } catch (error) {
            console.error('[notificationListeners] Error fetching sender name:', error);
          }

          await showLocalNotification(
            `New message from ${senderName}`,
            lastMessage,
            { type: 'new_message', chatId: docId, senderId, senderName },
          );
        }
      }

      if (!processedDocs.has(docId)) processedDocs.add(docId);
    }
  }, (error) => {
    console.warn(`[notificationListeners] chats listener error (${role}):`, error);
  });

  return () => {
    unsubscribe();
    processedDocs.clear();
  };
}
