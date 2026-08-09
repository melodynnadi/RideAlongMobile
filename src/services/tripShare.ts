import { useEffect, useRef, useState } from 'react';
import { Share } from 'react-native';
import * as Location from 'expo-location';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { firebaseAuth, firestore } from '@/constants/services';

function getTrackingUrl(token: string): string {
  // Always use the public website so Maps key is valid and the page is reachable.
  // ?dev=1 tells the page to read from the dev Firebase project when testing locally.
  const devParam = __DEV__ ? '&dev=1' : '';
  return `https://ridealongapp.com/pages/track.html?token=${token}${devParam}`;
}

function generateToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

type TripShareRideInfo = {
  pickup?: string;
  dropoff?: string;
  driverId?: string | null;
  riderId?: string | null;
  sharedByRole?: 'rider' | 'driver';
};

export function useTripShare(confirmedRideId: string | null, isActive: boolean, rideInfo?: TripShareRideInfo) {
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tokenRef = useRef<string | null>(null);

  // Write location to Firestore every 15 seconds while sharing
  const startLocationUpdates = (token: string) => {
    if (locationIntervalRef.current) return;
    locationIntervalRef.current = setInterval(async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        await updateDoc(doc(firestore, 'tripTracking', token), {
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          heading: loc.coords.heading ?? null,
          updatedAt: serverTimestamp(),
        });
      } catch {}
    }, 15000);
  };

  const stopLocationUpdates = () => {
    if (locationIntervalRef.current) {
      clearInterval(locationIntervalRef.current);
      locationIntervalRef.current = null;
    }
  };

  const shareTrip = async () => {
    if (sharing || !confirmedRideId) return;
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    setSharing(true);
    try {
      // Request location permission
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        const { Alert } = await import('react-native');
        Alert.alert('Location permission needed', 'Please allow location access to share your trip.');
        setSharing(false);
        return;
      }

      // Get current location for initial write
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });

      // Reuse existing token or generate new one
      const token = tokenRef.current || generateToken();
      tokenRef.current = token;

      // Create share doc
      const sharedByRole = rideInfo?.sharedByRole || 'rider';
      await setDoc(doc(firestore, 'tripShares', token), {
        confirmedRideId,
        sharedBy: uid,
        sharedByRole,
        riderId: rideInfo?.riderId || (sharedByRole === 'rider' ? uid : null),
        driverId: rideInfo?.driverId || (sharedByRole === 'driver' ? uid : null),
        pickup: rideInfo?.pickup || null,
        dropoff: rideInfo?.dropoff || null,
        status: 'active',
        createdAt: serverTimestamp(),
      });

      // Write initial location
      await setDoc(doc(firestore, 'tripTracking', token), {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        heading: loc.coords.heading ?? null,
        updatedAt: serverTimestamp(),
      });

      setShareToken(token);
      startLocationUpdates(token);

      // Open native share sheet
      const url = getTrackingUrl(token);
      await Share.share({
        message: `I'm sharing my live trip with you via RideAlong. Track me here: ${url}`,
        url,
      });
    } catch (e: any) {
      if (e?.message !== 'User did not share') {
        const { Alert } = await import('react-native');
        Alert.alert('Error', 'Could not start trip sharing. Please try again.');
      }
    } finally {
      setSharing(false);
    }
  };

  // Stop sharing and clean up when ride ends
  useEffect(() => {
    if (!isActive && tokenRef.current) {
      stopLocationUpdates();
      // Mark share as ended
      updateDoc(doc(firestore, 'tripShares', tokenRef.current), { status: 'ended' }).catch(() => {});
      tokenRef.current = null;
      setShareToken(null);
    }
  }, [isActive]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopLocationUpdates();
      if (tokenRef.current) {
        updateDoc(doc(firestore, 'tripShares', tokenRef.current), { status: 'ended' }).catch(() => {});
      }
    };
  }, []);

  return { shareTrip, sharing, shareToken };
}
