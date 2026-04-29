export type UserRole = 'rider' | 'driver' | 'both';
export type ActiveRole = 'rider' | 'driver';

export interface RiderProfile {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  avatar?: string;
  university?: string;
  isVerified?: boolean;
  emailVerified?: boolean;
  status?: 'active' | 'suspended';
  stripeCustomerId?: string;
  createdAt?: any;
}

export interface DriverProfile {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  avatar?: string;
  university?: string;
  isVerified?: boolean;
  emailVerified?: boolean;
  status?: 'active' | 'suspended';
  isOnline?: boolean;
  rating?: number;
  totalRides?: number;
  stripeAccountId?: string;
  vehicle?: {
    make?: string;
    model?: string;
    year?: string;
    color?: string;
    licensePlate?: string;
  };
  createdAt?: any;
}
