/**
 * Payment API Service
 * Handles all payment-related API calls to the RideAlong Web API
 */

import { getApiBaseUrl, firestore } from '@/constants/services';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import {
  PaymentMethod,
  SetupIntentResponse,
  PaymentIntentResponse,
  CreateRidePaymentRequest,
  CancelRidePaymentRequest,
  AddPaymentMethodRequest,
  SavePaymentMethodRequest,
  PaymentMethodsResponse,
  SetDefaultPaymentMethodRequest,
  DeletePaymentMethodRequest,
  PaymentConfig,
} from '@/types/payment';

const API_BASE_URL = getApiBaseUrl();

// Network timeout in milliseconds (30 seconds)
const NETWORK_TIMEOUT = 30000;

/**
 * Fetch with timeout wrapper
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = NETWORK_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Network request timed out. Please check your internet connection and try again.');
    }
    throw error;
  }
}

/**
 * Get Stripe configuration from server
 */
export async function getPaymentConfig(): Promise<PaymentConfig> {
  console.log('[getPaymentConfig] Fetching from:', `${API_BASE_URL}/api/payments/config`);
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/payments/config`);
  if (!response.ok) {
    throw new Error('Failed to fetch payment config');
  }
  return response.json();
}

/**
 * Create a SetupIntent for adding a new payment method
 */
export async function createSetupIntent(
  request: AddPaymentMethodRequest
): Promise<SetupIntentResponse> {
  const response = await fetch(`${API_BASE_URL}/api/create-setup-intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to create setup intent' }));
    const userMessage = error.message || error.error || 'Failed to create setup intent';
    throw new Error(userMessage);
  }

  return response.json();
}

/**
 * Save a payment method after successful SetupIntent confirmation
 */
export async function savePaymentMethod(
  request: SavePaymentMethodRequest
): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE_URL}/api/save-payment-method`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to save payment method' }));
    const userMessage = error.message || error.error || 'Failed to save payment method';
    throw new Error(userMessage);
  }

  return response.json();
}

/**
 * List all payment methods for a user
 */
export async function listPaymentMethods(userId: string): Promise<PaymentMethod[]> {
  console.log('[listPaymentMethods] Fetching from:', `${API_BASE_URL}/api/payment-methods?userId=${userId}`);
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/payment-methods?userId=${encodeURIComponent(userId)}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to fetch payment methods' }));
    const userMessage = error.message || error.error || 'Failed to fetch payment methods';
    throw new Error(userMessage);
  }

  const data: PaymentMethodsResponse = await response.json();
  return data.paymentMethods || [];
}

/**
 * Set a payment method as default
 */
export async function setDefaultPaymentMethod(
  paymentMethodId: string,
  request: SetDefaultPaymentMethodRequest
): Promise<PaymentMethod[]> {
  const response = await fetch(`${API_BASE_URL}/api/payment-methods/${encodeURIComponent(paymentMethodId)}/default`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to set default payment method' }));
    const userMessage = error.message || error.error || 'Failed to set default payment method';
    throw new Error(userMessage);
  }

  const data: PaymentMethodsResponse = await response.json();
  return data.paymentMethods || [];
}

/**
 * Delete a payment method
 */
export async function deletePaymentMethod(
  paymentMethodId: string,
  request: DeletePaymentMethodRequest
): Promise<{ success: boolean; defaultPaymentMethodId?: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/payment-methods/${encodeURIComponent(paymentMethodId)}?userId=${encodeURIComponent(request.userId)}`,
    {
      method: 'DELETE',
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to delete payment method' }));
    const userMessage = error.message || error.error || 'Failed to delete payment method';
    throw new Error(userMessage);
  }

  return response.json();
}

/**
 * Create a PaymentIntent for ride request (manual capture - holds funds)
 */
export async function createRidePayment(
  request: CreateRidePaymentRequest
): Promise<PaymentIntentResponse> {
  console.log('🚀 [createRidePayment] Starting payment creation...');
  console.log('🚀 [createRidePayment] Request:', { rideId: request.rideId, amount: request.amount });
  
  const response = await fetch(`${API_BASE_URL}/api/payments/create-intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      totalInCents: request.amount,
      currency: 'usd',
      rideId: request.rideId,
      riderId: request.riderId || request.userId,
      driverId: request.driverId,
      baseFare: request.baseFare,
      platformFee: request.platformFee,
      paymentMethodId: request.paymentMethodId,
    }),
  });

  console.log('🚀 [createRidePayment] Response status:', response.status);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to create ride payment' }));
    console.error('❌ [createRidePayment] API error:', error);
    // Extract user-friendly message from backend response
    // Backend returns: { error: "Failed to create payment intent", message: "Your card has insufficient funds." }
    const userMessage = error.message || error.error || 'Failed to create ride payment';
    throw new Error(userMessage);
  }

  const result: PaymentIntentResponse = await response.json();
  console.log('🚀 [createRidePayment] Got payment intent:', result.id, 'status:', result.status);
  console.log('🚀 [createRidePayment] firestore available?', !!firestore);

  // CRITICAL: Save payment to Firestore directly from client as backup
  // This ensures payment documents exist even if server Firestore write fails
  if (result.id && firestore) {
    try {
      console.log(`💾 [Client] Saving payment ${result.id} to Firestore as backup`);
      await setDoc(doc(firestore, 'payments', result.id), {
        paymentIntentId: result.id,
        userId: request.riderId || request.userId,
        rideId: request.rideId,
        amount: request.amount / 100, // Convert cents to dollars
        status: 'authorized',
        rideType: 'ride_request',
        createdAt: serverTimestamp(),
        stripeStatus: result.status,
        clientSaved: true, // Flag to indicate this was saved from mobile client
        driverId: request.driverId || null,
        baseFare: request.baseFare ? request.baseFare / 100 : null,
        platformFee: request.platformFee ? request.platformFee / 100 : null,
      }, { merge: true }); // Use merge to not overwrite if server already saved it
      
      console.log(`✅ [Client] Payment ${result.id} saved to Firestore successfully`);
    } catch (firestoreError) {
      console.error(`❌ [Client] Failed to save payment to Firestore:`, firestoreError);
      // Don't throw - payment was created in Stripe successfully
      // The sync function will catch this
    }
  }

  return result;
}

/**
 * Cancel a PaymentIntent (if ride is rejected or cancelled before driver confirms)
 */
export async function cancelRidePayment(
  request: CancelRidePaymentRequest
): Promise<{ id: string; status: string }> {
  const response = await fetch(`${API_BASE_URL}/api/payments/cancel-intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentIntentId: request.paymentIntentId }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to cancel ride payment' }));
    const userMessage = error.message || error.error || 'Failed to cancel ride payment';
    throw new Error(userMessage);
  }

  return response.json();
}

/**
 * Refresh/ensure Stripe customer exists for a user
 */
export async function refreshCustomer(
  userId: string,
  email?: string,
  name?: string
): Promise<{ customerId: string; email: string | null; name: string | null }> {
  const response = await fetch(`${API_BASE_URL}/api/payments/refresh-customer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, email, name }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to refresh customer' }));
    const userMessage = error.message || error.error || 'Failed to refresh customer';
    throw new Error(userMessage);
  }

  return response.json();
}

/**
 * Capture ride payment and split between driver and platform
 * Called when ride is completed
 */
export async function captureRidePayment(
  paymentIntentId: string,
  rideId: string,
  driverId: string
): Promise<{
  success: boolean;
  paymentIntentId: string;
  amount: number;
  status: string;
  paymentSplit: {
    totalChargedToRider: number;
    rideCost: number;
    platformFee: number;
    transferId: string | null;
    transferCompleted: boolean;
    transferError: string | null;
  };
}> {
  const response = await fetch(`${API_BASE_URL}/api/payments/capture-ride-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentIntentId, rideId, driverId }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to capture payment' }));
    const userMessage = error.message || error.error || 'Failed to capture payment';
    throw new Error(userMessage);
  }

  return response.json();
}

/**
 * Get driver earnings breakdown
 */
export async function getDriverEarnings(userId: string): Promise<{
  success: boolean;
  totalEarnings: number;
  ridesCompleted: number;
  earnings: Array<{
    rideId: string;
    date: Date;
    totalChargedToRider: number;
    rideCost: number;
    platformFee: number;
    transferId: string | null;
    transferred: boolean;
  }>;
  summary: {
    totalEarned: number;
    totalPlatformFees: number;
    transfersCompleted: number;
    pendingTransfers: number;
  };
}> {
  const response = await fetch(
    `${API_BASE_URL}/api/connect/driver-earnings?userId=${encodeURIComponent(userId)}`
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to get driver earnings' }));
    const userMessage = error.message || error.error || 'Failed to get driver earnings';
    throw new Error(userMessage);
  }

  return response.json();
}
