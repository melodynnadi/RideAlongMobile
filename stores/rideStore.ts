import { create } from 'zustand';

interface Location {
  latitude: number;
  longitude: number;
  address?: string;
}

interface RideRequest {
  id: string;
  pickupLocation: Location;
  dropoffLocation: Location;
  requestedTime: Date;
  seats: number;
  notes?: string;
  status: 'pending' | 'matched' | 'in-progress' | 'completed' | 'cancelled';
}

interface RideState {
  currentLocation: Location | null;
  rideRequest: RideRequest | null;
  isRequestingRide: boolean;
  
  // Actions
  setCurrentLocation: (location: Location | null) => void;
  setRideRequest: (request: RideRequest | null) => void;
  setRequestingRide: (requesting: boolean) => void;
  clearRideRequest: () => void;
}

export const useRideStore = create<RideState>((set) => ({
  currentLocation: null,
  rideRequest: null,
  isRequestingRide: false,
  
  setCurrentLocation: (currentLocation) => set({ currentLocation }),
  setRideRequest: (rideRequest) => set({ rideRequest }),
  setRequestingRide: (isRequestingRide) => set({ isRequestingRide }),
  clearRideRequest: () => set({ rideRequest: null, isRequestingRide: false }),
}));
