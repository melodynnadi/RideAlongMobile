import { collection, onSnapshot, query, where, Unsubscribe, DocumentChange } from 'firebase/firestore';
import { firestore } from '@/constants/services';
import { showLocalNotification } from '@/services/messagingService';
import { AppState } from 'react-native';
import { chatBelongsToRole, roleUnreadField } from '@/src/utils/roleIdentity';

/**
 * Sets up real-time listeners for ride-related events that should trigger notifications
 * Call this once when the driver logs in
 */
export function setupDriverNotificationListeners(driverId: string, driverEmail?: string): () => void {
  const unsubscribers: Unsubscribe[] = [];
  const processedDocs = new Set<string>(); // Track already-processed docs to avoid duplicate notifications
  const isFirstSnapshot = { requests: true, confirmed: true, offers: true }; // Track first snapshot for each listener
  const lastKnownStatus = new Map<string, string>(); // Track previous status per confirmedRide doc

  // Listen for new ride posting requests (riders requesting driver's posted rides)
  try {
    const requestsQuery = query(
      collection(firestore, 'ridePostingRequests'),
      where('driverId', '==', driverId)
    );
    
    const unsubRequests = onSnapshot(requestsQuery, (snapshot) => {
      // Skip the initial snapshot to avoid showing toasts for existing documents
      if (isFirstSnapshot.requests) {
        isFirstSnapshot.requests = false;
        // Mark all existing docs as processed
        snapshot.docs.forEach(doc => processedDocs.add(doc.id));
        return;
      }
      
      snapshot.docChanges().forEach((change: DocumentChange) => {
        const docId = change.doc.id;
        const data = change.doc.data();
        
        if (change.type === 'added' && !processedDocs.has(docId)) {
          processedDocs.add(docId);
          // New ride request received - Don't show toast here, push notification handles it
          console.log('📍 New ride request detected (push notification already sent)');
        } else if (change.type === 'modified' && processedDocs.has(docId)) {
          // Status changes handled silently — push notifications cover these
        }
      });
    }, (error) => {
      console.warn('Driver notification listener error (ridePostingRequests):', error);
    });
    
    unsubscribers.push(unsubRequests);
  } catch (error) {
    console.warn('Failed to setup ride posting requests listener:', error);
  }

  // Listen for confirmed rides (when a ride gets confirmed)
  try {
    const confirmedQuery = query(
      collection(firestore, 'confirmedRides'),
      where('driverId', '==', driverId)
    );
    
    const unsubConfirmed = onSnapshot(confirmedQuery, (snapshot) => {
      // Skip the initial snapshot to avoid showing toasts for existing documents
      if (isFirstSnapshot.confirmed) {
        isFirstSnapshot.confirmed = false;
        snapshot.docs.forEach(doc => {
          processedDocs.add(`confirmed_${doc.id}`);
          lastKnownStatus.set(doc.id, String(doc.data()?.status || '').toUpperCase());
        });
        return;
      }
      
      snapshot.docChanges().forEach((change: DocumentChange) => {
        const docId = change.doc.id;
        const data = change.doc.data();
        
        if (change.type === 'added' && !processedDocs.has(`confirmed_${docId}`)) {
          processedDocs.add(`confirmed_${docId}`);
          const status = String(data?.status || '').toUpperCase();
          lastKnownStatus.set(docId, status);
        } else if (change.type === 'modified' && processedDocs.has(`confirmed_${docId}`)) {
          const status = String(data?.status || '').toUpperCase();
          lastKnownStatus.set(docId, status);
          // All ride status toasts removed — push notifications handle user communication
        }
      });
    }, (error) => {
      console.warn('Driver notification listener error (confirmedRides):', error);
    });
    
    unsubscribers.push(unsubConfirmed);
  } catch (error) {
    console.warn('Failed to setup confirmed rides listener:', error);
  }

  // Listen for ride offers (when riders make offers on driver's postings)
  try {
    const offersQuery = query(
      collection(firestore, 'rideOffers'),
      where('driverId', '==', driverId)
    );
    
    const unsubOffers = onSnapshot(offersQuery, (snapshot) => {
      // Skip the initial snapshot to avoid showing toasts for existing documents
      if (isFirstSnapshot.offers) {
        isFirstSnapshot.offers = false;
        // Mark all existing docs as processed
        snapshot.docs.forEach(doc => processedDocs.add(`offer_${doc.id}`));
        return;
      }
      
      snapshot.docChanges().forEach((change: DocumentChange) => {
        const docId = change.doc.id;
        const data = change.doc.data();
        
        // Only show notification if this is a rider making an offer on driver's posting
        // (has ridePostingId). Don't show when driver makes offer on ride request (has rideRequestId only)
        if (change.type === 'added' && !processedDocs.has(`offer_${docId}`) && data?.ridePostingId) {
          processedDocs.add(`offer_${docId}`);
          // Toast removed — push notification handles new offer alerts
        }
      });
    }, (error) => {
      console.warn('Driver notification listener error (rideOffers):', error);
    });
    
    unsubscribers.push(unsubOffers);
  } catch (error) {
    console.warn('Failed to setup ride offers listener:', error);
  }

  // Listen for new chat messages
  try {
    const chatsQuery = query(
      collection(firestore, 'chats'),
      where('driverId', '==', driverId)
    );
    
    const unsubChats = onSnapshot(chatsQuery, async (snapshot) => {
      // Skip the initial snapshot
      if (isFirstSnapshot.chats === undefined) {
        (isFirstSnapshot as any).chats = false;
        // Mark all existing docs as processed
        snapshot.docs.forEach(doc => processedDocs.add(`chat_${doc.id}`));
        return;
      }
      
      snapshot.docChanges().forEach(async (change: DocumentChange) => {
        const docId = change.doc.id;
        const data = change.doc.data();
        if (!chatBelongsToRole(data, driverId, 'driver')) return;
        
        // Only process modified chats (when lastMessage changes)
        if (change.type === 'modified' && processedDocs.has(`chat_${docId}`)) {
          const lastMessage = data?.lastMessage;
          const lastMessageTimestamp = data?.lastMessageTimestamp;
          const unreadField = roleUnreadField('driver', driverId);
          const unreadCount = data?.[unreadField] || 0;
          
          // Only show notification if user has unread messages and app is in background
          if (unreadCount > 0 && lastMessage && AppState.currentState !== 'active') {
            const participants = data?.participants || [];
            const senderId = participants.find((id: string) => id !== driverId);
            
            // Fetch sender name
            let senderName = 'Someone';
            try {
              const { doc: firestoreDoc, getDoc } = await import('firebase/firestore');
              const isDriver = senderId === data?.driverId;
              const senderDoc = await getDoc(
                firestoreDoc(firestore, isDriver ? 'drivers' : 'users', senderId)
              );
              
              if (senderDoc.exists()) {
                const senderData = senderDoc.data();
                senderName = senderData.fullName || senderData.name || senderData.email || 'Someone';
              }
            } catch (error) {
              console.error('Error fetching sender name:', error);
            }
            
            // Show local notification
            await showLocalNotification(
              `New message from ${senderName}`,
              lastMessage,
              {
                type: 'chat',
                chatId: docId,
                senderId,
                senderName,
              }
            );
          }
        }
        
        // Mark as processed after first encounter
        if (!processedDocs.has(`chat_${docId}`)) {
          processedDocs.add(`chat_${docId}`);
        }
      });
    }, (error) => {
      console.warn('Driver notification listener error (chats):', error);
    });
    
    unsubscribers.push(unsubChats);
  } catch (error) {
    console.warn('Failed to setup chat messages listener:', error);
  }

  // Return cleanup function that unsubscribes all listeners
  return () => {
    unsubscribers.forEach(unsub => unsub());
    processedDocs.clear();
  };
}
