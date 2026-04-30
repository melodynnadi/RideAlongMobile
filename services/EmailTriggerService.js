/**
 * EmailTriggerService.js - Driver App
 * 
 * Service for triggering email notifications from the Driver app.
 * Calls backend API endpoints to send emails for various driver events.
 * 
 * All email functions match the backend implementation in RideAlongWebApp/server/index.js
 */

import axios from 'axios';
import { getAuth } from 'firebase/auth';

// API base URL - configure in your .env or config file
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4001';

class EmailTriggerService {
  constructor() {
    this.auth = getAuth();
    this.apiClient = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000, // 30 seconds
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Get authorization header with Firebase ID token
   */
  async getAuthHeader() {
    try {
      const user = this.auth.currentUser;
      if (!user) {
        throw new Error('Driver not authenticated');
      }

      const token = await user.getIdToken();
      return {
        'Authorization': `Bearer ${token}`,
      };
    } catch (error) {
      console.error('[EmailTriggerService] Error getting auth header:', error);
      return {};
    }
  }

  /**
   * Generic email sender (non-blocking)
   * Fires and forgets - doesn't wait for response to avoid timeout issues
   */
  async sendEmail(endpoint, data) {
    // Fire and forget - don't await response to prevent timeouts
    this.apiClient.post(endpoint, data, { 
      headers: await this.getAuthHeader(),
      timeout: 5000 // Short timeout since we don't wait for response
    })
    .then(response => {
      console.log('[EmailTriggerService] Email sent:', endpoint, response.data);
    })
    .catch(error => {
      // Silently log errors - email sending shouldn't block app functionality
      console.warn('[EmailTriggerService] Email error (non-critical):', endpoint, error.message);
    });
    
    // Return immediately
    return { success: true, queued: true };
  }

  // ==================== Account/Auth Emails ====================

  /**
   * Send welcome email to new driver (after signup)
   */
  async sendWelcomeEmail(email, name) {
    return this.sendEmail('/api/send-welcome-email', { email, name });
  }

  /**
   * Send password changed notification
   */
  async sendPasswordChangedEmail(email, name) {
    return this.sendEmail('/api/send-password-changed-email', { email, name });
  }

  /**
   * Send account deletion confirmation
   */
  async sendAccountDeletionEmail(email, name) {
    return this.sendEmail('/api/send-account-deletion-email', { email, name });
  }

  // ==================== Driver Application Emails ====================
  
  /**
   * Note: Driver approval/rejection emails are sent automatically by backend
   * when admin updates application status. No client-side trigger needed.
   */

  // ==================== Ride Management Emails ====================

  /**
   * Send ride posted confirmation email
   */
  async sendRidePostedEmail(email, name, rideDetails) {
    return this.sendEmail('/api/send-ride-posted-email', { 
      email, 
      name, 
      rideDetails 
    });
  }

  /**
   * Send notification when rider requests a seat
   */
  async sendRiderRequestedSeatEmail(driverEmail, driverName, riderName, rideDetails) {
    return this.sendEmail('/api/send-rider-requested-seat-email', { 
      email: driverEmail,
      driverName, 
      riderName, 
      rideDetails 
    });
  }

  /**
   * Send notification when rider cancels their request
   */
  async sendRiderCanceledRequestEmail(driverEmail, driverName, riderName, rideDetails) {
    return this.sendEmail('/api/send-rider-canceled-request-email', { 
      email: driverEmail,
      driverName, 
      riderName, 
      rideDetails 
    });
  }

  /**
   * Send notification when both seats are filled
   */
  async sendBothSeatsFilledEmail(email, name, rideDetails) {
    return this.sendEmail('/api/send-both-seats-filled-email', { 
      email, 
      name, 
      rideDetails 
    });
  }

  /**
   * Send notification when all seats are booked
   */
  async sendRideFullyBookedEmail(email, name, rideDetails) {
    return this.sendEmail('/api/send-ride-fully-booked-email', { 
      email, 
      name, 
      rideDetails 
    });
  }

  // ==================== Ride Status Emails ====================

  /**
   * Send ride confirmation email to driver
   */
  async sendRideConfirmationEmail(driverInfo, riderInfo, rideDetails) {
    return this.sendEmail('/api/send-ride-confirmation-emails', { 
      driverInfo, 
      riderInfo, 
      rideDetails 
    });
  }

  /**
   * Send ride edited notification
   */
  async sendRideEditedEmail(email, name, rideDetails) {
    return this.sendEmail('/api/send-ride-edited-driver-email', { 
      email, 
      name, 
      rideDetails 
    });
  }

  /**
   * Send ride canceled notification
   */
  async sendRideCanceledEmail(email, name, rideDetails) {
    return this.sendEmail('/api/send-ride-canceled-driver-email', { 
      email, 
      name, 
      rideDetails 
    });
  }

  /**
   * Send ride starts soon reminder
   */
  async sendRideStartsSoonEmail(email, name, rideDetails) {
    return this.sendEmail('/api/send-ride-starts-soon-email', { 
      email, 
      name, 
      role: 'driver',
      rideDetails 
    });
  }

  /**
   * Send trip in progress notification
   */
  // Trip in progress email DISABLED - causes duplicate notifications
  // Users already get real-time status updates through Firestore listeners
  /*
  async sendTripInProgressEmail(email, name, rideDetails) {
    return this.sendEmail('/api/send-trip-in-progress-email', { 
      email, 
      name, 
      role: 'driver',
      rideDetails 
    });
  }
  */

  /**
   * Send trip completed notification
   */
  async sendTripCompletedEmail(email, name, rideDetails) {
    return this.sendEmail('/api/send-trip-completed-email', { 
      email, 
      name, 
      role: 'driver',
      rideDetails 
    });
  }

  // ==================== Payout Emails ====================

  /**
   * Send payout sent confirmation
   */
  async sendPayoutSentEmail(email, name, amount, method) {
    return this.sendEmail('/api/send-payout-sent-email', { 
      email, 
      name, 
      amount, 
      method 
    });
  }

  /**
   * Send payout pending notification
   */
  async sendPayoutPendingEmail(email, name, amount) {
    return this.sendEmail('/api/send-payout-pending-email', { 
      email, 
      name, 
      amount 
    });
  }

  /**
   * Send payout failed notification
   */
  async sendPayoutFailedEmail(email, name, amount, reason) {
    return this.sendEmail('/api/send-payout-failed-email', { 
      email, 
      name, 
      amount, 
      reason 
    });
  }

  /**
   * Send bank account added confirmation
   */
  async sendBankAccountAddedEmail(email, name, last4) {
    return this.sendEmail('/api/send-bank-account-added-email', { 
      email, 
      name, 
      last4 
    });
  }

  /**
   * Send bank account verification needed notification
   */
  async sendBankAccountVerificationNeededEmail(email, name) {
    return this.sendEmail('/api/send-bank-account-verification-needed-email', { 
      email, 
      name 
    });
  }

  /**
   * Send bank account verification failed notification
   */
  async sendBankAccountVerificationFailedEmail(email, name, reason) {
    return this.sendEmail('/api/send-bank-account-verification-failed-email', { 
      email, 
      name, 
      reason 
    });
  }

  // ==================== Rating Emails ====================

  /**
   * Send rating prompt to driver after ride
   */
  async sendRatingPromptEmail(email, name, riderName) {
    return this.sendEmail('/api/send-rating-prompt-email', { 
      email, 
      name, 
      role: 'driver',
      otherPersonName: riderName 
    });
  }

  /**
   * Send review posted confirmation
   */
  async sendReviewPostedEmail(email, name, rating, review) {
    return this.sendEmail('/api/send-review-posted-email', { 
      email, 
      name, 
      role: 'driver',
      rating, 
      review 
    });
  }

  /**
   * Send weekly rating summary (sent on Mondays)
   */
  async sendWeeklyRatingSummaryEmail(email, name, stats) {
    return this.sendEmail('/api/send-weekly-rating-summary-email', { 
      email, 
      name, 
      stats 
    });
  }

  /**
   * Send rating threshold warning (when rating drops below threshold)
   */
  async sendRatingThresholdWarningEmail(email, name, currentRating, threshold) {
    return this.sendEmail('/api/send-rating-threshold-warning-email', { 
      email, 
      name, 
      currentRating, 
      threshold 
    });
  }

  // ==================== Helper Methods ====================

  /**
   * Trigger email after posting a ride
   * Automatically gets driver data and sends appropriate email
   */
  async triggerRidePostedEmail(rideDetails) {
    try {
      const user = this.auth.currentUser;
      if (!user) return { success: false, error: 'Not authenticated' };

      const { email, displayName } = user;
      return await this.sendRidePostedEmail(email, displayName, rideDetails);
    } catch (error) {
      console.error('[EmailTriggerService] Error triggering ride posted email:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Trigger email after ride confirmation
   * Automatically gets driver data and sends appropriate email
   */
  async triggerRideConfirmationEmail(rideData) {
    try {
      const user = this.auth.currentUser;
      if (!user) return { success: false, error: 'Not authenticated' };

      const driverInfo = {
        email: user.email,
        name: user.displayName,
        driverId: user.uid,
      };

      const riderInfo = {
        email: rideData.riderEmail,
        name: rideData.riderName,
        riderId: rideData.riderId,
      };

      const rideDetails = {
        pickup: rideData.pickup,
        dropoff: rideData.dropoff,
        date: rideData.date,
        time: rideData.time,
        price: rideData.price,
      };

      return await this.sendRideConfirmationEmail(driverInfo, riderInfo, rideDetails);
    } catch (error) {
      console.error('[EmailTriggerService] Error triggering ride confirmation email:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Trigger email after successful payout
   * Automatically gets driver data and sends appropriate email
   */
  async triggerPayoutSuccessEmail(amount, method) {
    try {
      const user = this.auth.currentUser;
      if (!user) return { success: false, error: 'Not authenticated' };

      return await this.sendPayoutSentEmail(
        user.email,
        user.displayName,
        amount,
        method
      );
    } catch (error) {
      console.error('[EmailTriggerService] Error triggering payout success email:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Trigger email when rider requests seat
   * Automatically gets driver data
   */
  async triggerRiderRequestedEmail(riderName, rideDetails) {
    try {
      const user = this.auth.currentUser;
      if (!user) return { success: false, error: 'Not authenticated' };

      return await this.sendRiderRequestedSeatEmail(
        user.email,
        user.displayName,
        riderName,
        rideDetails
      );
    } catch (error) {
      console.error('[EmailTriggerService] Error triggering rider request email:', error);
      return { success: false, error: error.message };
    }
  }
}

// Export singleton instance
export default new EmailTriggerService();
