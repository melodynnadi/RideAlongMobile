/**
 * Payment-related types for RideAlong Rider App
 * Matches the RideAlong Web API payment system (Stripe manual capture model)
 */

export interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  isDefault: boolean;
}

export interface SetupIntentResponse {
  clientSecret: string;
}

export interface PaymentIntentResponse {
  clientSecret: string;
  id: string;
}

export interface CreateRidePaymentRequest {
  userId: string;
  rideId: string;
  amount: number; // in cents
  rideType: 'ride_request';
  paymentMethodId: string;
  riderId?: string;
  driverId?: string;
  baseFare?: number;
  platformFee?: number;
}

export interface CaptureRidePaymentRequest {
  paymentIntentId: string;
  rideId: string;
  finalAmount?: number; // in cents (optional - to adjust amount before capture)
}

export interface CancelRidePaymentRequest {
  paymentIntentId: string;
  rideId: string;
}

export interface AddPaymentMethodRequest {
  userId: string;
  email?: string;
  name?: string;
}

export interface SavePaymentMethodRequest {
  userId: string;
  paymentMethodId: string;
  email?: string;
  name?: string;
}

export interface PaymentMethodsResponse {
  paymentMethods: PaymentMethod[];
}

export interface SetDefaultPaymentMethodRequest {
  userId: string;
  paymentMethodId: string;
}

export interface DeletePaymentMethodRequest {
  userId: string;
  paymentMethodId: string;
}

export interface PaymentConfig {
  publishableKey: string;
  stripeEnabled: boolean;
}

export interface RidePaymentState {
  paymentIntentId?: string;
  clientSecret?: string;
  status?: 'pending' | 'authorized' | 'captured' | 'canceled' | 'failed';
  amount?: number;
  error?: string;
}
