import { create } from 'zustand';
import {
  listDriverPreferredRoutes,
  createDriverPreferredRoute,
  updateDriverPreferredRoute,
  deleteDriverPreferredRoute,
  DriverPreferredRoute,
  listRiderPreferredRoutes,
  createRiderPreferredRoute,
  updateRiderPreferredRoute,
  deleteRiderPreferredRoute,
  RiderPreferredRoute,
} from '@/services/preferredRoutesService';

export type PreferredRoute = RiderPreferredRoute;

interface PreferredRoutesState {
  routes: PreferredRoute[];
  loading: boolean;
  error: string | null;
  isSaving: boolean;
  duplicateRouteId: string | null;
  loadRoutes: () => Promise<void>;
  addRoute: (origin: string, destination: string) => Promise<PreferredRoute | null>;
  updateRoute: (id: string, origin: string, destination: string) => Promise<void>;
  deleteRoute: (id: string) => Promise<void>;
  clearError: () => void;
}

export const usePreferredRoutesStore = create<PreferredRoutesState>((set, get) => ({
  routes: [],
  loading: false,
  error: null,
  isSaving: false,
  duplicateRouteId: null,

  clearError: () => set({ error: null }),

  loadRoutes: async () => {
    try {
      set({ loading: true, error: null });
      const routes = await listRiderPreferredRoutes();
      set({ routes });
    } catch (e: any) {
      console.error('Failed to load preferred routes', e);
      set({ error: e.message || 'Failed to load routes' });
    } finally {
      set({ loading: false });
    }
  },

  addRoute: async (origin, destination) => {
    if (!origin.trim() || !destination.trim()) {
      set({ error: 'Origin and destination required' });
      return null;
    }
    try {
      set({ isSaving: true, error: null, duplicateRouteId: null });
      const route = await createRiderPreferredRoute(origin.trim(), destination.trim());
      // Server returns duplicate flag if already exists
      if ((route as any).duplicate) {
        set({ duplicateRouteId: route.id });
        return route;
      }
      // If not already in local state, add it
      const existing = get().routes.find(r => r.id === route.id);
      if (!existing) {
        set({ routes: [...get().routes, route] });
      }
      return route;
    } catch (e: any) {
      console.error('Failed to add preferred route', e);
      set({ error: e.message || 'Failed to add route' });
      return null;
    } finally {
      set({ isSaving: false });
    }
  },

  updateRoute: async (id, origin, destination) => {
    if (!origin.trim() || !destination.trim()) {
      set({ error: 'Origin and destination required' });
      return;
    }
    try {
      set({ isSaving: true, error: null, duplicateRouteId: null });
      const updated = await updateRiderPreferredRoute(id, origin.trim(), destination.trim());
      set({ routes: get().routes.map(r => r.id === id ? { ...r, ...updated } : r) });
    } catch (e: any) {
      console.error('Failed to update preferred route', e);
      set({ error: e.message || 'Failed to update route' });
    } finally {
      set({ isSaving: false });
    }
  },

  deleteRoute: async (id) => {
    try {
      set({ isSaving: true, error: null });
      await deleteRiderPreferredRoute(id);
      set({ routes: get().routes.filter(r => r.id !== id) });
    } catch (e: any) {
      console.error('Failed to delete preferred route', e);
      set({ error: e.message || 'Failed to delete route' });
    } finally {
      set({ isSaving: false });
    }
  },
}));

// Convenience selector hooks
export const usePreferredRoutes = () => usePreferredRoutesStore(s => s.routes);
export const usePreferredRoutesLoading = () => usePreferredRoutesStore(s => s.loading || s.isSaving);
export const usePreferredRoutesError = () => usePreferredRoutesStore(s => s.error);

interface DriverPreferredRoutesState {
  routes: DriverPreferredRoute[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  load: () => Promise<void>;
  add: (origin: string, destination: string) => Promise<DriverPreferredRoute | null>;
  update: (id: string, origin: string, destination: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useDriverPreferredRoutesStore = create<DriverPreferredRoutesState>((set, get) => ({
  routes: [],
  loading: false,
  saving: false,
  error: null,

  clearError: () => set({ error: null }),

  load: async () => {
    try {
      set({ loading: true, error: null });
      set({ routes: await listDriverPreferredRoutes() });
    } catch (error: any) {
      set({ error: error?.message || 'Failed to load routes' });
    } finally {
      set({ loading: false });
    }
  },

  add: async (origin, destination) => {
    try {
      set({ saving: true, error: null });
      const route = await createDriverPreferredRoute(origin.trim(), destination.trim());
      if (!route.duplicate && !get().routes.some((item) => item.id === route.id)) {
        set({ routes: [...get().routes, route] });
      }
      return route;
    } catch (error: any) {
      set({ error: error?.message || 'Failed to add route' });
      return null;
    } finally {
      set({ saving: false });
    }
  },

  update: async (id, origin, destination) => {
    try {
      set({ saving: true, error: null });
      const route = await updateDriverPreferredRoute(id, origin.trim(), destination.trim());
      set({ routes: get().routes.map((item) => item.id === id ? { ...item, ...route } : item) });
    } catch (error: any) {
      set({ error: error?.message || 'Failed to update route' });
    } finally {
      set({ saving: false });
    }
  },

  remove: async (id) => {
    try {
      set({ saving: true, error: null });
      await deleteDriverPreferredRoute(id);
      set({ routes: get().routes.filter((item) => item.id !== id) });
    } catch (error: any) {
      set({ error: error?.message || 'Failed to delete route' });
    } finally {
      set({ saving: false });
    }
  },
}));
