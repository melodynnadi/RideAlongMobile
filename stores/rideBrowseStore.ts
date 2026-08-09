import { create } from 'zustand';

export type RiderRideFilter = 'all' | 'morning' | 'afternoon' | 'evening' | 'rating';
export type DriverRequestFilter = 'all' | 'today' | 'tomorrow' | 'open' | 'assigned' | 'best';

type RideBrowseState = {
  riderSearch: string;
  riderFilter: RiderRideFilter;
  driverSearch: string;
  driverFilter: DriverRequestFilter;
  setRiderSearch: (riderSearch: string) => void;
  setRiderFilter: (riderFilter: RiderRideFilter) => void;
  setDriverSearch: (driverSearch: string) => void;
  setDriverFilter: (driverFilter: DriverRequestFilter) => void;
};

export const useRideBrowseStore = create<RideBrowseState>((set) => ({
  riderSearch: '',
  riderFilter: 'all',
  driverSearch: '',
  driverFilter: 'all',
  setRiderSearch: (riderSearch) => set({ riderSearch }),
  setRiderFilter: (riderFilter) => set({ riderFilter }),
  setDriverSearch: (driverSearch) => set({ driverSearch }),
  setDriverFilter: (driverFilter) => set({ driverFilter }),
}));
