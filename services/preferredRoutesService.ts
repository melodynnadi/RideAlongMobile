import { firebaseAuth, getApiBaseUrl } from '@/constants/services';

export interface DriverPreferredRoute {
  id: string;
  origin: string;
  destination: string;
  userType: 'driver';
  createdAt?: any;
  updatedAt?: any;
  duplicate?: boolean;
}

export interface RiderPreferredRoute {
  id: string;
  origin: string;
  destination: string;
  userType: 'rider';
  createdAt?: any;
  updatedAt?: any;
  duplicate?: boolean;
}

async function getToken(): Promise<string> {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Not authenticated');
  return user.getIdToken();
}

export async function listDriverPreferredRoutes(): Promise<DriverPreferredRoute[]> {
  const token = await getToken();
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/preferred-routes?userType=driver`, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!res.ok) throw new Error('Failed to fetch preferred routes');
  const json = await res.json();
  return json.routes || [];
}

export async function createDriverPreferredRoute(origin: string, destination: string): Promise<DriverPreferredRoute> {
  const token = await getToken();
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/preferred-routes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ origin, destination, userType: 'driver' })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to create route');
  return { ...json.route, duplicate: Boolean(json.duplicate) };
}

export async function updateDriverPreferredRoute(id: string, origin: string, destination: string): Promise<DriverPreferredRoute> {
  const token = await getToken();
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/preferred-routes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ origin, destination })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to update route');
  return json.route;
}

export async function deleteDriverPreferredRoute(id: string): Promise<void> {
  const token = await getToken();
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/preferred-routes/${id}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!res.ok) throw new Error('Failed to delete route');
}

// Rider versions
export async function listRiderPreferredRoutes(): Promise<RiderPreferredRoute[]> {
  const token = await getToken();
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/preferred-routes?userType=rider`, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!res.ok) throw new Error('Failed to fetch preferred routes');
  const json = await res.json();
  return json.routes || [];
}

export async function createRiderPreferredRoute(origin: string, destination: string): Promise<RiderPreferredRoute> {
  const token = await getToken();
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/preferred-routes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ origin, destination, userType: 'rider' })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to create route');
  return { ...json.route, duplicate: Boolean(json.duplicate) };
}

export async function updateRiderPreferredRoute(id: string, origin: string, destination: string): Promise<RiderPreferredRoute> {
  const token = await getToken();
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/preferred-routes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ origin, destination })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to update route');
  return json.route;
}

export async function deleteRiderPreferredRoute(id: string): Promise<void> {
  const token = await getToken();
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/preferred-routes/${id}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!res.ok) throw new Error('Failed to delete route');
}

