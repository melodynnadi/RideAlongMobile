/**
 * Phone Verification Service for Mobile
 * Handles OTP verification flow for phone number changes
 */

import { firebaseAuth, getApiBaseUrl } from '@/constants/services';

export interface OTPResponse {
  success: boolean;
  message: string;
  expiresAt?: number;
  devCode?: string;
  error?: string;
}

/**
 * Send OTP to phone number
 */
export async function sendPhoneOTP(phoneNumber: string): Promise<OTPResponse> {
  try {
    const user = firebaseAuth.currentUser;
    if (!user) {
      console.log('[PhoneVerification] No user authenticated');
      return {
        success: false,
        message: 'User not authenticated',
      };
    }

    const idToken = await user.getIdToken();
    const apiUrl = getApiBaseUrl();
    
    console.log('[PhoneVerification] Sending OTP to:', phoneNumber);
    console.log('[PhoneVerification] API URL:', `${apiUrl}/api/phone/send-otp`);

    const response = await fetch(`${apiUrl}/api/phone/send-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ phoneNumber }),
    });

    const data = await response.json();
    
    console.log('[PhoneVerification] Response status:', response.status);
    console.log('[PhoneVerification] Response data:', data);

    if (!response.ok) {
      return {
        success: false,
        message: data.error || 'Failed to send verification code',
      };
    }

    return data;
  } catch (error) {
    console.error('[PhoneVerification] Error sending OTP:', error);
    return {
      success: false,
      message: 'Network error. Please check your connection.',
    };
  }
}

/**
 * Verify OTP code
 */
export async function verifyPhoneOTP(
  otp: string,
  phoneNumber: string
): Promise<OTPResponse> {
  try {
    const user = firebaseAuth.currentUser;
    if (!user) {
      return {
        success: false,
        message: 'User not authenticated',
      };
    }

    const idToken = await user.getIdToken();
    const apiUrl = getApiBaseUrl();

    const response = await fetch(`${apiUrl}/api/phone/verify-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ otp, phoneNumber }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        message: data.error || 'Failed to verify code',
      };
    }

    return data;
  } catch (error) {
    console.error('Error verifying OTP:', error);
    return {
      success: false,
      message: 'Network error. Please check your connection.',
    };
  }
}

/**
 * Cancel phone verification
 */
export async function cancelPhoneVerification(): Promise<void> {
  try {
    const user = firebaseAuth.currentUser;
    if (!user) return;

    const idToken = await user.getIdToken();
    const apiUrl = getApiBaseUrl();

    await fetch(`${apiUrl}/api/phone/cancel-verification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
    });
  } catch (error) {
    console.error('Error cancelling verification:', error);
  }
}

/**
 * Format phone number for display
 */
export function formatPhoneNumber(phoneNumber: string): string {
  const cleaned = phoneNumber.replace(/\D/g, '');

  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  } else if (cleaned.length === 11 && cleaned[0] === '1') {
    return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }

  return phoneNumber;
}
