/**
 * RideStatusListener.js - Driver App
 * 
 * Real-time Firestore listeners for driver ride status changes.
 * Monitors ride postings, requests, and payout status.
 * Triggers notifications and emails based on status updates.
 */

import { getFirestore, doc, onSnapshot, collection, query, where, updateDoc } from 'firebase/firestore';
import NotificationManager from '../services/NotificationManager';
import EmailTriggerService from '../services/EmailTriggerService';

const db = getFirestore();

/**
 * Listen to a specific ride posting for status changes
 */
export const setupRidePostingListener = (ridePostingId, driverId, driverEmail, driverName) => {
  const rideRef = doc(db, 'ridePostings', ridePostingId);
  
  const unsubscribe = onSnapshot(rideRef, async (snapshot) => {
    if (!snapshot.exists()) return;
    
    const ride = snapshot.data();
    const prevData = snapshot.metadata.hasPendingWrites ? null : ride.previousData;
    
    // Check for seat fill status changes
    if (prevData) {
      const prevSeats = prevData.seatsTaken || 0;
      const currentSeats = ride.seatsTaken || 0;
      
      // Seat was just filled
      if (currentSeats > prevSeats) {
        // Only notify when ride becomes fully booked (all seats filled)
        // Remove "both seats filled" notification as it's redundant
        if (currentSeats >= ride.seatsAvailable) {
          // All seats filled - send one notification instead of multiple
          await EmailTriggerService.sendRideFullyBookedEmail(driverEmail, driverName, ride);
          await NotificationManager.sendLocalNotification(
            'Ride Fully Booked!',
            'All seats for your ride have been filled',
            { actionType: 'view_ride_details', actionData: { rideId: ridePostingId } },
            'ride-status'
          );
        }
      }
    }
    
    // Status changes
    if (prevData && prevData.status !== ride.status) {
      switch (ride.status) {
        case 'CONFIRMED':
          await NotificationManager.sendLocalNotification(
            'Ride Confirmed!',
            'Your ride has been confirmed with all passengers',
            { actionType: 'view_ride_details', actionData: { rideId: ridePostingId } },
            'ride-status'
          );
          break;
          
        case 'IN_PROGRESS':
          // Note: Trip in progress email removed - driver already knows they started the trip
          // Only send local notification as a reminder
          await NotificationManager.sendLocalNotification(
            'Trip Started',
            'Your ride is now in progress. Drive safely!',
            { actionType: 'track_ride', actionData: { rideId: ridePostingId } },
            'ride-status'
          );
          break;
          
        case 'COMPLETED':
          // Note: Email is sent by server-side listener (notifyRideCompleted)
          // to prevent duplicate emails. Only send local notification here.
          // Check flag to prevent duplicate notifications
          if (!ride.completionNotificationSent) {
            await NotificationManager.sendLocalNotification(
              'Trip Completed',
              'Your ride has been completed. Great job!',
              { actionType: 'rate_riders', actionData: { rideId: ridePostingId } },
              'ride-status'
            );
            // Mark as sent to prevent duplicates
            await updateDoc(rideRef, { completionNotificationSent: true });
          }
          break;
          
        case 'CANCELED':
          await NotificationManager.sendLocalNotification(
            'Ride Canceled',
            'Your ride has been canceled',
            { actionType: 'view_my_rides' },
            'ride-status'
          );
          break;
      }
    }
  });
  
  return unsubscribe;
};

/**
 * Listen to all ride requests for driver's postings
 */
export const setupRideRequestsListener = (driverId, driverEmail, driverName) => {
  // First get all driver's ride postings
  const postingsRef = collection(db, 'ridePostings');
  const postingsQuery = query(postingsRef, where('driverId', '==', driverId));
  
  const unsubscribe = onSnapshot(postingsQuery, (postingsSnapshot) => {
    postingsSnapshot.forEach((postingDoc) => {
      const ridePostingId = postingDoc.id;
      
      // Listen to requests for this posting
      const requestsRef = collection(db, 'ridePostingRequests');
      const requestsQuery = query(
        requestsRef,
        where('ridePostingId', '==', ridePostingId),
        where('status', '==', 'pending')
      );
      
      onSnapshot(requestsQuery, (requestsSnapshot) => {
        requestsSnapshot.docChanges().forEach(async (change) => {
          if (change.type === 'added') {
            // New request received - HIGH PRIORITY
            const request = change.doc.data();
            const rideDetails = postingDoc.data();
            
            // Note: Email is sent by server-side Firestore listener
            // Server watches ridePostingRequests and automatically sends email
            // Only send local notification here to prevent duplicate emails
            
            // Use ride-requests channel for high priority notification with custom sound
            await NotificationManager.sendLocalNotification(
              'New Ride Request',
              `${request.riderName} requested a seat on your ride`,
              { 
                actionType: 'view_requests', 
                actionData: { rideId: ridePostingId, requestId: change.doc.id } 
              },
              'ride-requests' // High priority channel with custom sound
            );
          } else if (change.type === 'modified') {
            const request = change.doc.data();
            
            // Request canceled by rider
            if (request.status === 'canceled') {
              const rideDetails = postingDoc.data();
              
              await EmailTriggerService.sendRiderCanceledRequestEmail(
                driverEmail,
                driverName,
                request.riderName,
                rideDetails
              );
              
              await NotificationManager.sendLocalNotification(
                'Request Canceled',
                `${request.riderName} canceled their ride request`,
                { actionType: 'view_requests', actionData: { rideId: ridePostingId } },
                'ride-status'
              );
            }
          }
        });
      });
    });
  });
  
  return unsubscribe;
};

/**
 * Listen to driver's payout status
 */
export const setupPayoutListener = (driverId, driverEmail, driverName) => {
  const driverRef = doc(db, 'drivers', driverId);
  
  const unsubscribe = onSnapshot(driverRef, async (snapshot) => {
    if (!snapshot.exists()) return;
    
    const driver = snapshot.data();
    const prevData = snapshot.metadata.hasPendingWrites ? null : driver.previousData;
    
    // Check for payout status changes
    if (prevData && driver.lastPayoutStatus !== prevData.lastPayoutStatus) {
      switch (driver.lastPayoutStatus) {
        case 'succeeded':
          await EmailTriggerService.sendPayoutSentEmail(
            driverEmail,
            driverName,
            driver.lastPayoutAmount,
            driver.payoutMethod || 'bank account'
          );
          await NotificationManager.sendLocalNotification(
            'Payout Sent!',
            `Your payout of $${driver.lastPayoutAmount} is on its way`,
            { actionType: 'view_earnings' },
            'earnings'
          );
          break;
          
        case 'pending':
          await EmailTriggerService.sendPayoutPendingEmail(
            driverEmail,
            driverName,
            driver.lastPayoutAmount
          );
          await NotificationManager.sendLocalNotification(
            'Payout Processing',
            `Your payout of $${driver.lastPayoutAmount} is being processed`,
            { actionType: 'view_earnings' },
            'earnings'
          );
          break;
          
        case 'failed':
          await EmailTriggerService.sendPayoutFailedEmail(
            driverEmail,
            driverName,
            driver.lastPayoutAmount,
            driver.payoutFailureReason || 'Unknown error'
          );
          await NotificationManager.sendLocalNotification(
            'Payout Failed',
            'We couldn\'t process your payout. Please update your bank account.',
            { actionType: 'update_bank' },
            'earnings'
          );
          break;
      }
    }
    
    // Bank account status changes
    if (prevData && driver.bankAccountStatus !== prevData.bankAccountStatus) {
      if (driver.bankAccountStatus === 'verified') {
        await NotificationManager.sendLocalNotification(
          'Bank Account Verified',
          'Your bank account has been verified. You can now receive payouts!',
          { actionType: 'view_payouts' },
          'earnings'
        );
      } else if (driver.bankAccountStatus === 'verification_failed') {
        await EmailTriggerService.sendBankAccountVerificationFailedEmail(
          driverEmail,
          driverName,
          driver.bankVerificationFailureReason || 'Verification failed'
        );
        await NotificationManager.sendLocalNotification(
          'Bank Verification Failed',
          'We couldn\'t verify your bank account. Please check your details.',
          { actionType: 'update_bank' },
          'earnings'
        );
      }
    }
  });
  
  return unsubscribe;
};

/**
 * Set up all driver listeners at once
 * Call this when driver logs in
 */
export const setupAllDriverListeners = (driverId, driverEmail, driverName) => {
  console.log('[RideStatusListener] Setting up all driver listeners');
  
  const unsubscribes = [];
  
  // Listen to ride requests
  const requestsUnsubscribe = setupRideRequestsListener(driverId, driverEmail, driverName);
  unsubscribes.push(requestsUnsubscribe);
  
  // Listen to payouts
  const payoutUnsubscribe = setupPayoutListener(driverId, driverEmail, driverName);
  unsubscribes.push(payoutUnsubscribe);
  
  // Return cleanup function
  return () => {
    console.log('[RideStatusListener] Cleaning up all driver listeners');
    unsubscribes.forEach(unsub => unsub());
  };
};

export default {
  setupRidePostingListener,
  setupRideRequestsListener,
  setupPayoutListener,
  setupAllDriverListeners,
};
