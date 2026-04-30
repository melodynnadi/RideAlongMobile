import { collection, onSnapshot, query, where, getDocs, Unsubscribe, DocumentChange } from 'firebase/firestore';
import { firestore } from '@/constants/services';
import { showToast, rideToasts } from '@/src/utils/showToast';
import { shouldShowToastEvent, buildToastKey } from '@/src/utils/toastDeduper';
import { showLocalNotification } from '@/services/messagingService';
import { AppState } from 'react-native';

/**
 * Sets up real-time listeners for ride-related events that should trigger notifications
 * Call this once when the driver logs in
 */
export function setupDriverNotificationListeners(driverId: string, driverEmail?: string): () => void {
  const unsubscribers: Unsubscribe[] = [];
  const processedDocs = new Set<string>(); // Track already-processed docs to avoid duplicate notifications
  const isFirstSnapshot = { requests: true, confirmed: true, offers: true }; // Track first snapshot for each listener

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
          const status = String(data?.status || '').toLowerCase();
          if (status === 'accepted' || status === 'confirmed') {
            const key = buildToastKey('ride_accepted', String(data?.rideRequestId || data?.id || docId), []);
            if (shouldShowToastEvent(key)) {
              rideToasts.rideAccepted();
            }
          } else if (status === 'rejected' || status === 'declined') {
            showToast('info', 'Ride request declined');
          }
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
        // Mark all existing docs as processed
        snapshot.docs.forEach(doc => processedDocs.add(`confirmed_${doc.id}`));
        return;
      }
      
      snapshot.docChanges().forEach((change: DocumentChange) => {
        const docId = change.doc.id;
        const data = change.doc.data();
        
        if (change.type === 'added' && !processedDocs.has(`confirmed_${docId}`)) {
          processedDocs.add(`confirmed_${docId}`);
          // Only show toast if ride is fully CONFIRMED (all seats filled)
          // For group rides with PENDING status, wait until all seats are filled
          const status = String(data?.status || '').toUpperCase();
          if (status === 'CONFIRMED') {
            const key = buildToastKey('ride_accepted', String(data?.rideRequestId || data?.id || docId), []);
            if (shouldShowToastEvent(key)) {
              rideToasts.rideConfirmed({
                from: data?.pickup?.address || 'Pickup location',
                to: data?.dropoff?.address || 'Dropoff location'
              });
            }
          }
        } else if (change.type === 'modified' && processedDocs.has(`confirmed_${docId}`)) {
          const status = String(data?.status || '').toUpperCase();
          // Check if status changed from PENDING to CONFIRMED (group ride filled)
          // Only show toast if driverPickupConfirmed is not set yet (prevents toast on pickup button press)
          if (status === 'CONFIRMED' && !data?.driverPickupConfirmed) {
            const key = buildToastKey('ride_confirmed_status_change', String(data?.rideRequestId || data?.id || docId), []);
            if (shouldShowToastEvent(key)) {
              rideToasts.rideConfirmed({
                from: data?.pickup?.address || 'Pickup location',
                to: data?.dropoff?.address || 'Dropoff location'
              });
            }
          } else if (status === 'COMPLETED') {
            // For group rides, only show "Ride completed" toast when ALL seats are completed
            const postingId = data?.ridePostingId;
            if (postingId) {
              // This is a group ride - check if all seats are completed
              const allSeatsQuery = query(
                collection(firestore, 'confirmedRides'),
                where('ridePostingId', '==', postingId)
              );
              getDocs(allSeatsQuery).then(seatsSnapshot => {
                const allCompleted = seatsSnapshot.docs.every(doc => 
                  String(doc.data()?.status || '').toUpperCase() === 'COMPLETED'
                );
                
                if (allCompleted) {
                  const key = buildToastKey('ride_completed', String(postingId), []);
                  if (shouldShowToastEvent(key)) {
                    rideToasts.rideCompleted();
                  }
                }
              }).catch(err => {
                console.warn('Error checking group ride completion:', err);
              });
            } else {
              // Single ride - show toast immediately
              const key = buildToastKey('ride_completed', String(data?.rideRequestId || data?.id || docId), []);
              if (shouldShowToastEvent(key)) {
                rideToasts.rideCompleted();
              }
            }
          } else if (status === 'IN_PROGRESS') {
            // Don't show "Ride in progress" toast if driver has already completed
            // (status is IN_PROGRESS while waiting for rider to also confirm completion)
            if (!data?.driverCompleteConfirmed) {
              const key = buildToastKey('ride_started', String(data?.rideRequestId || data?.id || docId), []);
              if (shouldShowToastEvent(key)) {
                showToast('info', 'Ride in progress', 'Drive safely!');
              }
            }
          }
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
          showToast('info', 'New Ride Offer', `${data?.riderName || 'A rider'} made an offer`);
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
      where('participants', 'array-contains', driverId)
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
        
        // Only process modified chats (when lastMessage changes)
        if (change.type === 'modified' && processedDocs.has(`chat_${docId}`)) {
          const lastMessage = data?.lastMessage;
          const lastMessageTimestamp = data?.lastMessageTimestamp;
          const unreadField = `unreadCount_${driverId}`;
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
