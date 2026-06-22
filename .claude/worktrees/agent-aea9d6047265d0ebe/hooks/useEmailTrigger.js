/**
 * useEmailTrigger.js - Driver App
 * 
 * React hook for triggering emails from driver components
 * Wraps EmailTriggerService with React state management
 */

import { useState, useCallback } from 'react';
import EmailTriggerService from '../services/EmailTriggerService';

export const useEmailTrigger = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Generic email sender
  const sendEmail = useCallback(async (emailFunction, ...args) => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const result = await emailFunction(...args);
      
      if (result.success) {
        setSuccess(true);
        setLoading(false);
        return result;
      } else {
        setError(result.error || 'Failed to send email');
        setLoading(false);
        return result;
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
      return { success: false, error: err.message };
    }
  }, []);

  // Helper methods that wrap EmailTriggerService methods
  const triggerRidePostedEmail = useCallback(async (rideDetails) => {
    return sendEmail(
      EmailTriggerService.triggerRidePostedEmail.bind(EmailTriggerService),
      rideDetails
    );
  }, [sendEmail]);

  const triggerRideConfirmationEmail = useCallback(async (rideData) => {
    return sendEmail(
      EmailTriggerService.triggerRideConfirmationEmail.bind(EmailTriggerService),
      rideData
    );
  }, [sendEmail]);

  const triggerPayoutSuccessEmail = useCallback(async (amount, method) => {
    return sendEmail(
      EmailTriggerService.triggerPayoutSuccessEmail.bind(EmailTriggerService),
      amount,
      method
    );
  }, [sendEmail]);

  const triggerRiderRequestedEmail = useCallback(async (riderName, rideDetails) => {
    return sendEmail(
      EmailTriggerService.triggerRiderRequestedEmail.bind(EmailTriggerService),
      riderName,
      rideDetails
    );
  }, [sendEmail]);

  const sendRideEditedEmail = useCallback(async (email, name, rideDetails) => {
    return sendEmail(
      EmailTriggerService.sendRideEditedEmail.bind(EmailTriggerService),
      email,
      name,
      rideDetails
    );
  }, [sendEmail]);

  const sendRideCanceledEmail = useCallback(async (email, name, rideDetails) => {
    return sendEmail(
      EmailTriggerService.sendRideCanceledEmail.bind(EmailTriggerService),
      email,
      name,
      rideDetails
    );
  }, [sendEmail]);

  const sendTripCompletedEmail = useCallback(async (email, name, rideDetails) => {
    return sendEmail(
      EmailTriggerService.sendTripCompletedEmail.bind(EmailTriggerService),
      email,
      name,
      rideDetails
    );
  }, [sendEmail]);

  const sendPayoutPendingEmail = useCallback(async (email, name, amount) => {
    return sendEmail(
      EmailTriggerService.sendPayoutPendingEmail.bind(EmailTriggerService),
      email,
      name,
      amount
    );
  }, [sendEmail]);

  const sendBothSeatsFilledEmail = useCallback(async (email, name, rideDetails) => {
    return sendEmail(
      EmailTriggerService.sendBothSeatsFilledEmail.bind(EmailTriggerService),
      email,
      name,
      rideDetails
    );
  }, [sendEmail]);

  const sendRideFullyBookedEmail = useCallback(async (email, name, rideDetails) => {
    return sendEmail(
      EmailTriggerService.sendRideFullyBookedEmail.bind(EmailTriggerService),
      email,
      name,
      rideDetails
    );
  }, [sendEmail]);

  const sendRatingPromptEmail = useCallback(async (email, name, riderName) => {
    return sendEmail(
      EmailTriggerService.sendRatingPromptEmail.bind(EmailTriggerService),
      email,
      name,
      riderName
    );
  }, [sendEmail]);

  // Reset state
  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setSuccess(false);
  }, []);

  return {
    // State
    loading,
    error,
    success,
    
    // Helper methods (commonly used)
    triggerRidePostedEmail,
    triggerRideConfirmationEmail,
    triggerPayoutSuccessEmail,
    triggerRiderRequestedEmail,
    sendRideEditedEmail,
    sendRideCanceledEmail,
    sendTripCompletedEmail,
    sendPayoutPendingEmail,
    sendBothSeatsFilledEmail,
    sendRideFullyBookedEmail,
    sendRatingPromptEmail,
    
    // Generic sender for any email
    sendEmail,
    
    // Reset state
    reset,
    
    // Direct access to service for advanced usage
    emailService: EmailTriggerService,
  };
};

export default useEmailTrigger;
