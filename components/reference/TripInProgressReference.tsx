import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from '@/components/platform/NativeMaps';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { firebaseAuth, firestore, GOOGLE_MAPS_API_KEY } from '@/constants/services';
import { completeRide, riderCompleteRide } from '@/src/services/rideActions';
import { hasUserRatedRide } from '@/src/services/ratings';

const NAVY   = '#15233A';
const ORANGE = '#DE5D20';
const BG     = '#FBFAF7';
const BORDER = '#E5E0D8';
const MUTED  = '#8B94A6';

const MAP_STYLE = [
  { elementType: 'geometry',                                          stylers: [{ color: '#F5EDE3' }] },
  { elementType: 'labels.text.fill',                                  stylers: [{ color: '#15233A' }] },
  { elementType: 'labels.text.stroke',                                stylers: [{ color: '#FBFAF7' }] },
  { featureType: 'road',          elementType: 'geometry',            stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road',          elementType: 'geometry.stroke',     stylers: [{ color: '#E5E0D8' }] },
  { featureType: 'road.highway',  elementType: 'geometry',            stylers: [{ color: '#F0E8DF' }] },
  { featureType: 'road.highway',  elementType: 'geometry.stroke',     stylers: [{ color: '#D6CCBF' }] },
  { featureType: 'water',         elementType: 'geometry',            stylers: [{ color: '#C5D4E0' }] },
  { featureType: 'water',         elementType: 'labels.text.fill',    stylers: [{ color: '#8B94A6' }] },
  { featureType: 'landscape',     elementType: 'geometry',            stylers: [{ color: '#F5EDE3' }] },
  { featureType: 'poi',           elementType: 'geometry',            stylers: [{ color: '#EDE5D8' }] },
  { featureType: 'poi',           elementType: 'labels',              stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park',      elementType: 'geometry',            stylers: [{ color: '#D8EAD0' }] },
  { featureType: 'transit',                                           stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke',    stylers: [{ color: '#D6CCBF' }] },
];

// Decode Google encoded polyline into lat/lng array
function decodePolyline(encoded: string): { latitude: number; longitude: number }[] {
  const points: { latitude: number; longitude: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

function haversineMiles(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 3958.8;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

async function geocodeAddress(address: string): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.status === 'OK' && json.results?.[0]?.geometry?.location) {
      const { lat, lng } = json.results[0].geometry.location;
      return { latitude: lat, longitude: lng };
    }
  } catch {}
  return null;
}

async function resolveCoords(raw: any): Promise<{ latitude: number; longitude: number } | null> {
  if (!raw) return null;
  if (typeof raw?.latitude === 'number' && typeof raw?.longitude === 'number') return raw;
  if (typeof raw?.lat === 'number' && typeof raw?.lng === 'number') return { latitude: raw.lat, longitude: raw.lng };
  if (raw?.location?.lat) return { latitude: raw.location.lat, longitude: raw.location.lng };
  if (raw?.coords?.latitude) return { latitude: raw.coords.latitude, longitude: raw.coords.longitude };
  if (typeof raw === 'string' && raw.length > 3) return geocodeAddress(raw);
  if (typeof raw?.address === 'string') return geocodeAddress(raw.address);
  if (typeof raw?.description === 'string') return geocodeAddress(raw.description);
  if (typeof raw?.name === 'string') return geocodeAddress(raw.name);
  return null;
}

async function fetchDirections(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
): Promise<{ polyline: { latitude: number; longitude: number }[]; distanceMi: number; durationMin: number } | null> {
  try {
    const url =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${origin.latitude},${origin.longitude}` +
      `&destination=${destination.latitude},${destination.longitude}` +
      `&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.status === 'OK' && json.routes?.[0]) {
      const route = json.routes[0];
      const leg   = route.legs?.[0];
      return {
        polyline:    decodePolyline(route.overview_polyline.points),
        distanceMi:  (leg?.distance?.value ?? 0) / 1609.34,
        durationMin: Math.round((leg?.duration?.value ?? 0) / 60),
      };
    }
  } catch {}
  return null;
}

type TripData = {
  pickup:    any;
  dropoff:   any;
  driverId:  string | null;
  riderId:   string | null;
  riderName: string | null;
  driverLocation: { latitude: number; longitude: number } | null;
};

type DriverInfo = {
  name:        string;
  photoURL:    string | null;
  vehicleText: string;
  phone:       string | null;
};

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

// ─── Map Controls Overlay ─────────────────────────────────────────────────────

function MapControls({
  onZoomIn,
  onZoomOut,
  onFitRoute,
  followMode,
  onFollowToggle,
  heading,
  onResetBearing,
  bottomOffset,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitRoute: () => void;
  followMode: boolean;
  onFollowToggle: () => void;
  heading: number;
  onResetBearing: () => void;
  bottomOffset: number;
}) {
  return (
    <View style={[s.mapControls, { bottom: bottomOffset }]} pointerEvents="box-none">
      {/* Zoom in / out */}
      <View style={s.mapCtrlCluster}>
        <TouchableOpacity style={s.mapCtrlBtn} onPress={onZoomIn} activeOpacity={0.75}>
          <Ionicons name="add" size={22} color={NAVY} />
        </TouchableOpacity>
        <View style={s.mapCtrlSep} />
        <TouchableOpacity style={s.mapCtrlBtn} onPress={onZoomOut} activeOpacity={0.75}>
          <Ionicons name="remove" size={22} color={NAVY} />
        </TouchableOpacity>
      </View>

      <View style={{ height: 10 }} />

      {/* Fit full route */}
      <View style={s.mapCtrlCluster}>
        <TouchableOpacity style={s.mapCtrlBtn} onPress={onFitRoute} activeOpacity={0.75}>
          <Ionicons name="expand-outline" size={20} color={NAVY} />
        </TouchableOpacity>
      </View>

      <View style={{ height: 10 }} />

      {/* Follow / recenter */}
      <View style={s.mapCtrlCluster}>
        <TouchableOpacity
          style={[s.mapCtrlBtn, followMode && s.mapCtrlBtnActive]}
          onPress={onFollowToggle}
          activeOpacity={0.75}
        >
          <Ionicons name="locate" size={20} color={followMode ? '#FFF' : NAVY} />
        </TouchableOpacity>
      </View>

      <View style={{ height: 10 }} />

      {/* Compass — rotates with device heading; tap to reset north-up */}
      <View style={s.mapCtrlCluster}>
        <TouchableOpacity style={s.mapCtrlBtn} onPress={onResetBearing} activeOpacity={0.75}>
          <View style={{ transform: [{ rotate: `${heading}deg` }] }}>
            <Ionicons name="compass-outline" size={22} color={NAVY} />
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Rider Trip View ──────────────────────────────────────────────────────────

export function RiderTripInProgressReference() {
  const { confirmedRideId } = useLocalSearchParams<{ confirmedRideId: string }>();
  const insets = useSafeAreaInsets();
  const [trip, setTrip]       = useState<TripData | null>(null);
  const [rideStatus, setRideStatus] = useState<string>('');
  const [confirming, setConfirming] = useState(false);
  const [driver, setDriver]   = useState<DriverInfo | null>(null);
  const ratingNavRef = useRef(false);
  const [pickupCoords, setPickupCoords]   = useState<{ latitude: number; longitude: number } | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [routePoints, setRoutePoints] = useState<{ latitude: number; longitude: number }[]>([]);
  const [distanceMi,  setDistanceMi]  = useState<number | null>(null);
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentRegion, setCurrentRegion] = useState<Region | null>(null);
  const [followMode, setFollowMode] = useState(true);
  const [heading, setHeading] = useState(0);
  const mapRef = useRef<any>(null);
  const etaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headingSubRef = useRef<Location.LocationSubscription | null>(null);

  // Subscribe to confirmedRides for live driverLocation + status
  useEffect(() => {
    if (!confirmedRideId) return;
    const unsub = onSnapshot(doc(firestore, 'confirmedRides', confirmedRideId), async (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      const dl = d.driverLocation
        ? { latitude: d.driverLocation.latitude, longitude: d.driverLocation.longitude }
        : null;
      const status = String(d.status || '').toUpperCase();
      setRideStatus(status);
      setTrip({
        pickup:   d.pickup  ?? d.pickupLocation  ?? null,
        dropoff:  d.dropoff ?? d.dropoffLocation ?? null,
        driverId: d.driverId ?? null,
        riderId:  d.riderId  ?? null,
        riderName: d.riderName ?? null,
        driverLocation: dl,
      });
      if (status === 'COMPLETED' && !ratingNavRef.current) {
        ratingNavRef.current = true;
        const riderId = firebaseAuth.currentUser?.uid;
        const alreadyRated = !!d.riderRated || !!(riderId && await hasUserRatedRide(confirmedRideId, riderId));
        if (!alreadyRated) {
          setTimeout(() => {
            router.replace({ pathname: '/(rider)/rate-trip', params: { confirmedRideId } } as any);
          }, 1500);
        }
      }
    });
    return unsub;
  }, [confirmedRideId]);

  // Resolve coordinates and fetch initial route
  useEffect(() => {
    if (!trip) return;
    let cancelled = false;
    (async () => {
      const [pc, dc] = await Promise.all([
        resolveCoords(trip.pickup),
        resolveCoords(trip.dropoff),
      ]);
      if (cancelled) return;
      if (pc) setPickupCoords(pc);
      if (dc) setDropoffCoords(dc);
      if (pc && dc) {
        const dir = await fetchDirections(pc, dc);
        if (!cancelled && dir) {
          setRoutePoints(dir.polyline);
          setDistanceMi(dir.distanceMi);
          setDurationMin(dir.durationMin);
        }
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [trip?.pickup, trip?.dropoff]);

  // Update ETA from driver's current location to dropoff
  const updateEta = useCallback(async (driverLoc: { latitude: number; longitude: number }, dest: { latitude: number; longitude: number }) => {
    if (etaTimerRef.current) clearTimeout(etaTimerRef.current);
    const dir = await fetchDirections(driverLoc, dest);
    if (dir) {
      setDistanceMi(dir.distanceMi);
      setDurationMin(dir.durationMin);
    }
    // Refresh every 60 seconds
    etaTimerRef.current = setTimeout(() => updateEta(driverLoc, dest), 60000);
  }, []);

  useEffect(() => {
    if (trip?.driverLocation && dropoffCoords) {
      updateEta(trip.driverLocation, dropoffCoords);
    }
    return () => { if (etaTimerRef.current) clearTimeout(etaTimerRef.current); };
  }, [trip?.driverLocation?.latitude, trip?.driverLocation?.longitude, dropoffCoords]);

  // Fetch driver profile
  useEffect(() => {
    if (!trip?.driverId) return;
    let cancelled = false;
    getDoc(doc(firestore, 'drivers', trip.driverId)).then((snap) => {
      if (cancelled || !snap.exists()) return;
      const d = snap.data();
      const name = [d.firstName, d.lastName].filter(Boolean).join(' ').trim() || d.displayName || d.name || 'Driver';
      const vi   = d.vehicleInfo || {};
      const plate = vi.licensePlate || d.licensePlate || '';
      const vehicle = [vi.year, vi.color, vi.make, vi.model].filter(Boolean).join(' ');
      const vehicleText = [vehicle, plate].filter(Boolean).join(' · ');
      setDriver({
        name,
        photoURL:    d.photoURL || d.avatarUrl || null,
        vehicleText: vehicleText || 'Vehicle pending',
        phone:       d.phone || d.phoneNumber || null,
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [trip?.driverId]);

  // Fit map to route (or straight line between endpoints if directions failed)
  useEffect(() => {
    const coords = routePoints.length > 1 ? routePoints
      : (pickupCoords && dropoffCoords ? [pickupCoords, dropoffCoords] : []);
    if (coords.length > 1 && mapRef.current) {
      setTimeout(() => {
        mapRef.current?.fitToCoordinates(coords, {
          edgePadding: { top: 80, right: 40, bottom: 300, left: 40 },
          animated: true,
        });
      }, 500);
    }
  }, [routePoints.length, pickupCoords, dropoffCoords]);

  // Device compass heading
  useEffect(() => {
    let active = true;
    Location.watchHeadingAsync((h) => {
      if (active) setHeading(h.trueHeading ?? h.magHeading ?? 0);
    }).then((sub) => {
      if (!active) sub.remove();
      else headingSubRef.current = sub;
    }).catch(() => {});
    return () => {
      active = false;
      headingSubRef.current?.remove();
    };
  }, []);

  // Follow mode: animate map camera to driver position whenever it moves
  useEffect(() => {
    if (!followMode || !driverLoc || !mapRef.current) return;
    mapRef.current.animateCamera({ center: driverLoc }, { duration: 700 });
  }, [followMode, trip?.driverLocation?.latitude, trip?.driverLocation?.longitude]);

  const zoomIn = () => {
    if (!currentRegion || !mapRef.current) return;
    mapRef.current.animateToRegion(
      { ...currentRegion, latitudeDelta: currentRegion.latitudeDelta / 2, longitudeDelta: currentRegion.longitudeDelta / 2 },
      300,
    );
  };

  const zoomOut = () => {
    if (!currentRegion || !mapRef.current) return;
    mapRef.current.animateToRegion(
      { ...currentRegion, latitudeDelta: Math.min(currentRegion.latitudeDelta * 2, 180), longitudeDelta: Math.min(currentRegion.longitudeDelta * 2, 360) },
      300,
    );
  };

  const fitRoute = () => {
    const coords = routePoints.length > 1 ? routePoints
      : (pickupCoords && dropoffCoords ? [pickupCoords, dropoffCoords] : []);
    if (coords.length > 1 && mapRef.current) {
      setFollowMode(false);
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: 80, right: 40, bottom: 300, left: 40 },
        animated: true,
      });
    }
  };

  const resetBearing = () => {
    mapRef.current?.animateCamera({ heading: 0 }, { duration: 300 });
  };

  const openChat = async () => {
    if (!confirmedRideId) return;
    try {
      const chatSnap = await getDocs(query(collection(firestore, 'chats'), where('rideId', '==', confirmedRideId)));
      if (!chatSnap.empty) {
        router.push(`/(rider)/messages/${chatSnap.docs[0].id}` as any);
      } else {
        Alert.alert('Chat unavailable', 'The chat thread could not be found.');
      }
    } catch {
      Alert.alert('Error', 'Could not open chat.');
    }
  };

  const callDriver = () => {
    if (driver?.phone) {
      Linking.openURL(`tel:${driver.phone}`).catch(() => Alert.alert('Error', 'Could not place call.'));
    } else {
      Alert.alert('No phone number', 'Driver phone number is not available.');
    }
  };

  const confirmRideComplete = async () => {
    if (!confirmedRideId || confirming) return;
    setConfirming(true);
    await riderCompleteRide(confirmedRideId);
    setConfirming(false);
  };

  const shareTrip = () => {
    Alert.alert('Share trip', 'Trip sharing link copied to clipboard.');
  };

  const driverLoc = trip?.driverLocation;

  return (
    <View style={s.root}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        customMapStyle={MAP_STYLE}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        showsTraffic={false}
        rotateEnabled={false}
        initialRegion={
          pickupCoords
            ? { ...pickupCoords, latitudeDelta: 0.05, longitudeDelta: 0.05 }
            : { latitude: 30.2672, longitude: -97.7431, latitudeDelta: 0.5, longitudeDelta: 0.5 }
        }
        onRegionChangeComplete={(r) => setCurrentRegion(r)}
        onPanDrag={() => setFollowMode(false)}
      >
        {pickupCoords && dropoffCoords && (
          <Polyline
            coordinates={routePoints.length > 1 ? routePoints : [pickupCoords, dropoffCoords]}
            strokeColor={ORANGE}
            strokeWidth={3.5}
            lineCap="round"
            lineJoin="round"
          />
        )}
        {pickupCoords && (
          <Marker coordinate={pickupCoords} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={s.dotPickup} />
          </Marker>
        )}
        {dropoffCoords && (
          <Marker coordinate={dropoffCoords} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={s.dotDropoff} />
          </Marker>
        )}
        {driverLoc && (
          <Marker coordinate={driverLoc} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={s.carMarker}>
              <Ionicons name="car" size={18} color={ORANGE} />
            </View>
          </Marker>
        )}
      </MapView>

      {/* Header */}
      <SafeAreaView edges={['top']} style={s.headerSafe}>
        <View style={s.header}>
          <TouchableOpacity style={s.headerBtn} onPress={() => router.back()} activeOpacity={0.75}>
            <Ionicons name="arrow-back" size={20} color={NAVY} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Trip in progress</Text>
          <View style={s.headerBtn} />
        </View>
      </SafeAreaView>

      {/* Map controls */}
      <MapControls
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFitRoute={fitRoute}
        followMode={followMode}
        onFollowToggle={() => {
          if (!followMode) {
            setFollowMode(true);
            if (driverLoc) mapRef.current?.animateCamera({ center: driverLoc }, { duration: 600 });
          } else {
            setFollowMode(false);
          }
        }}
        heading={heading}
        onResetBearing={resetBearing}
        bottomOffset={300}
      />

      {/* Loading */}
      {loading && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator color={ORANGE} size="large" />
        </View>
      )}

      {/* Bottom sheet */}
      <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={s.dragHandle} />

        {/* Driver row */}
        <View style={s.driverRow}>
          <View style={s.driverAvatar}>
            {driver?.photoURL
              ? <Image source={{ uri: driver.photoURL }} style={s.driverAvatarImg} />
              : <Text style={s.driverInitials}>{(driver?.name || 'D').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()}</Text>}
          </View>
          <View style={s.driverInfo}>
            <Text style={s.driverName}>{driver?.name ?? 'Loading…'}</Text>
            <Text style={s.driverVehicle}>{driver?.vehicleText ?? ''}</Text>
          </View>
          <TouchableOpacity style={s.iconBtn} onPress={openChat} activeOpacity={0.75}>
            <Ionicons name="chatbubble-ellipses" size={20} color={NAVY} />
          </TouchableOpacity>
          <TouchableOpacity style={s.iconBtn} onPress={callDriver} activeOpacity={0.75}>
            <Ionicons name="call" size={20} color={NAVY} />
          </TouchableOpacity>
        </View>

        {/* ETA row — hide once driver has completed */}
        {rideStatus !== 'DRIVER_COMPLETED' && rideStatus !== 'COMPLETED' && (
          <View style={s.etaRow}>
            <View style={s.etaBlock}>
              <Text style={s.etaLabel}>ETA</Text>
              <Text style={s.etaValue}>
                {durationMin !== null ? formatDuration(durationMin) : '—'}
              </Text>
            </View>
            <View style={s.etaDivider} />
            <View style={s.etaBlock}>
              <Text style={s.etaLabel}>MILES TO GO</Text>
              <Text style={s.etaValueSm}>
                {distanceMi !== null ? `${distanceMi.toFixed(1)} mi` : '—'}
              </Text>
            </View>
          </View>
        )}

        {/* Rider confirmation banner */}
        {(rideStatus === 'DRIVER_COMPLETED' || rideStatus === 'RIDER_COMPLETED') && rideStatus !== 'COMPLETED' && (
          <View style={s.confirmBanner}>
            <Ionicons name="checkmark-circle" size={22} color="#16A34A" style={{ marginBottom: 6 }} />
            <Text style={s.confirmBannerTitle}>Driver marked the ride complete</Text>
            <Text style={s.confirmBannerBody}>{"Please confirm you've arrived at your destination."}</Text>
            <TouchableOpacity
              style={[s.confirmBtn, confirming && { opacity: 0.6 }]}
              onPress={confirmRideComplete}
              disabled={confirming}
              activeOpacity={0.85}
            >
              {confirming
                ? <ActivityIndicator size="small" color="#FFF" />
                : <Text style={s.confirmBtnText}>Confirm Arrival</Text>}
            </TouchableOpacity>
          </View>
        )}

        {rideStatus === 'COMPLETED' && (
          <View style={[s.confirmBanner, { backgroundColor: '#EDFAF3' }]}>
            <Ionicons name="checkmark-circle" size={22} color="#16A34A" style={{ marginBottom: 6 }} />
            <Text style={[s.confirmBannerTitle, { color: '#15803D' }]}>Ride complete!</Text>
            <Text style={s.confirmBannerBody}>Thanks for riding with RideAlong.</Text>
          </View>
        )}

        {/* Share */}
        {rideStatus !== 'COMPLETED' && (
          <TouchableOpacity style={s.shareBtn} onPress={shareTrip} activeOpacity={0.8}>
            <Ionicons name="share-social-outline" size={16} color={NAVY} />
            <Text style={s.shareBtnText}>Share trip with a friend</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Driver Trip View ─────────────────────────────────────────────────────────

export function DriverTripInProgressReference() {
  const { confirmedRideId } = useLocalSearchParams<{ confirmedRideId: string }>();
  const uid = firebaseAuth.currentUser?.uid;
  const insets = useSafeAreaInsets();

  const [trip, setTrip]       = useState<TripData | null>(null);
  const [riderName, setRiderName]     = useState<string>('Rider');
  const [riderPhotoURL, setRiderPhotoURL] = useState<string | null>(null);
  const [pickupCoords,  setPickupCoords]  = useState<{ latitude: number; longitude: number } | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [driverLoc, setDriverLoc]         = useState<{ latitude: number; longitude: number } | null>(null);
  const [routePoints,  setRoutePoints]  = useState<{ latitude: number; longitude: number }[]>([]);
  const [distanceMi,   setDistanceMi]   = useState<number | null>(null);
  const [durationMin,  setDurationMin]  = useState<number | null>(null);
  const [rideStatus,   setRideStatus]   = useState<string>('');
  const [completing,   setCompleting]   = useState(false);
  const [loading, setLoading] = useState(true);
  const ratingNavRef = useRef(false);
  const [currentRegion, setCurrentRegion] = useState<Region | null>(null);
  const [followMode, setFollowMode] = useState(true);
  const [heading, setHeading] = useState(0);
  const mapRef = useRef<any>(null);
  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const etaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headingSubRef = useRef<Location.LocationSubscription | null>(null);

  // Subscribe to confirmedRides for status + rider info
  useEffect(() => {
    if (!confirmedRideId) return;
    const unsub = onSnapshot(doc(firestore, 'confirmedRides', confirmedRideId), (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      const status = String(d.status || '').toUpperCase();
      setRideStatus(status);
      setTrip({
        pickup:   d.pickup  ?? d.pickupLocation  ?? null,
        dropoff:  d.dropoff ?? d.dropoffLocation ?? null,
        driverId: d.driverId ?? null,
        riderId:  d.riderId  ?? null,
        riderName: d.riderName ?? null,
        driverLocation: null,
      });
      if (status === 'COMPLETED' && !ratingNavRef.current) {
        ratingNavRef.current = true;
        setTimeout(() => {
          router.replace({ pathname: '/(driver)/rate-trip', params: { confirmedRideId } } as any);
        }, 1500);
      }
    });
    return unsub;
  }, [confirmedRideId]);

  // Fetch rider profile
  useEffect(() => {
    if (!trip?.riderId) return;
    let cancelled = false;
    getDoc(doc(firestore, 'riders', trip.riderId)).then((snap) => {
      if (cancelled || !snap.exists()) return;
      const d = snap.data();
      const name = [d.firstName, d.lastName].filter(Boolean).join(' ').trim() || d.displayName || d.name || trip.riderName || 'Rider';
      setRiderName(name);
      setRiderPhotoURL(d.photoURL || d.avatarUrl || null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [trip?.riderId]);

  // Resolve coords + route
  useEffect(() => {
    if (!trip) return;
    let cancelled = false;
    (async () => {
      const [pc, dc] = await Promise.all([
        resolveCoords(trip.pickup),
        resolveCoords(trip.dropoff),
      ]);
      if (cancelled) return;
      if (pc) setPickupCoords(pc);
      if (dc) setDropoffCoords(dc);
      if (pc && dc) {
        const dir = await fetchDirections(pc, dc);
        if (!cancelled && dir) {
          setRoutePoints(dir.polyline);
          setDistanceMi(dir.distanceMi);
          setDurationMin(dir.durationMin);
        }
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [trip?.pickup, trip?.dropoff]);

  // Watch driver location and publish to Firestore
  useEffect(() => {
    if (!confirmedRideId || !uid) return;
    let active = true;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || !active) return;
      locationSub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 20, timeInterval: 10000 },
        (loc) => {
          if (!active) return;
          const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          setDriverLoc(coords);
          // Publish to Firestore so riders can see
          updateDoc(doc(firestore, 'confirmedRides', confirmedRideId), {
            driverLocation: coords,
          }).catch(() => {});
        },
      );
    })();
    return () => {
      active = false;
      locationSub.current?.remove();
    };
  }, [confirmedRideId, uid]);

  // Update ETA from driver location to dropoff
  const updateEta = useCallback(async (driverLocation: { latitude: number; longitude: number }, dest: { latitude: number; longitude: number }) => {
    if (etaTimerRef.current) clearTimeout(etaTimerRef.current);
    const dir = await fetchDirections(driverLocation, dest);
    if (dir) {
      setDistanceMi(dir.distanceMi);
      setDurationMin(dir.durationMin);
    }
    etaTimerRef.current = setTimeout(() => updateEta(driverLocation, dest), 60000);
  }, []);

  useEffect(() => {
    if (driverLoc && dropoffCoords) {
      updateEta(driverLoc, dropoffCoords);
    }
    return () => { if (etaTimerRef.current) clearTimeout(etaTimerRef.current); };
  }, [driverLoc?.latitude, driverLoc?.longitude, dropoffCoords]);

  // Fit map (fall back to endpoint pair if directions unavailable)
  useEffect(() => {
    const coords = routePoints.length > 1 ? routePoints
      : (pickupCoords && dropoffCoords ? [pickupCoords, dropoffCoords] : []);
    if (coords.length > 1 && mapRef.current) {
      setTimeout(() => {
        mapRef.current?.fitToCoordinates(coords, {
          edgePadding: { top: 80, right: 40, bottom: 300, left: 40 },
          animated: true,
        });
      }, 500);
    }
  }, [routePoints.length, pickupCoords, dropoffCoords]);

  // Device compass heading
  useEffect(() => {
    let active = true;
    Location.watchHeadingAsync((h) => {
      if (active) setHeading(h.trueHeading ?? h.magHeading ?? 0);
    }).then((sub) => {
      if (!active) sub.remove();
      else headingSubRef.current = sub;
    }).catch(() => {});
    return () => {
      active = false;
      headingSubRef.current?.remove();
    };
  }, []);

  // Follow mode: keep camera on driver's own GPS position
  useEffect(() => {
    if (!followMode || !driverLoc || !mapRef.current) return;
    mapRef.current.animateCamera({ center: driverLoc }, { duration: 700 });
  }, [followMode, driverLoc?.latitude, driverLoc?.longitude]);

  const driverZoomIn = () => {
    if (!currentRegion || !mapRef.current) return;
    mapRef.current.animateToRegion(
      { ...currentRegion, latitudeDelta: currentRegion.latitudeDelta / 2, longitudeDelta: currentRegion.longitudeDelta / 2 },
      300,
    );
  };

  const driverZoomOut = () => {
    if (!currentRegion || !mapRef.current) return;
    mapRef.current.animateToRegion(
      { ...currentRegion, latitudeDelta: Math.min(currentRegion.latitudeDelta * 2, 180), longitudeDelta: Math.min(currentRegion.longitudeDelta * 2, 360) },
      300,
    );
  };

  const driverFitRoute = () => {
    const coords = routePoints.length > 1 ? routePoints
      : (pickupCoords && dropoffCoords ? [pickupCoords, dropoffCoords] : []);
    if (coords.length > 1 && mapRef.current) {
      setFollowMode(false);
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: 80, right: 40, bottom: 300, left: 40 },
        animated: true,
      });
    }
  };

  const driverResetBearing = () => {
    mapRef.current?.animateCamera({ heading: 0 }, { duration: 300 });
  };

  const openChat = async () => {
    if (!confirmedRideId) return;
    try {
      const chatSnap = await getDocs(query(collection(firestore, 'chats'), where('rideId', '==', confirmedRideId)));
      if (!chatSnap.empty) {
        router.push(`/(driver)/messages/${chatSnap.docs[0].id}` as any);
      } else {
        Alert.alert('Chat unavailable', 'The chat thread could not be found.');
      }
    } catch {
      Alert.alert('Error', 'Could not open chat.');
    }
  };

  const shareTrip = () => {
    Alert.alert('Share trip', 'Trip sharing link copied to clipboard.');
  };

  const navigateToDropoff = () => {
    if (!dropoffCoords) { Alert.alert('Destination not available yet'); return; }
    const { latitude, longitude } = dropoffCoords;
    const url = Platform.OS === 'ios'
      ? `comgooglemaps://?daddr=${latitude},${longitude}&directionsmode=driving`
      : `google.navigation:q=${latitude},${longitude}`;
    Linking.canOpenURL(url).then((supported) => {
      if (supported) return Linking.openURL(url);
      return Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`);
    }).catch(() => {
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`);
    });
  };

  const handleComplete = async () => {
    if (!confirmedRideId || completing) return;
    const doComplete = async () => {
      setCompleting(true);
      await completeRide({ confirmedId: confirmedRideId });
      setCompleting(false);
    };
    // Check distance from dropoff
    if (driverLoc && dropoffCoords) {
      const dist = haversineMiles(driverLoc, dropoffCoords);
      if (dist > 0.5) {
        Alert.alert(
          'Not at dropoff yet',
          `You appear to be ${dist.toFixed(1)} mi from the dropoff. Complete the ride anyway?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Complete anyway', style: 'destructive', onPress: doComplete },
          ],
        );
        return;
      }
    }
    doComplete();
  };

  return (
    <View style={s.root}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        customMapStyle={MAP_STYLE}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        showsTraffic={false}
        rotateEnabled={false}
        initialRegion={
          pickupCoords
            ? { ...pickupCoords, latitudeDelta: 0.05, longitudeDelta: 0.05 }
            : { latitude: 30.2672, longitude: -97.7431, latitudeDelta: 0.5, longitudeDelta: 0.5 }
        }
        onRegionChangeComplete={(r) => setCurrentRegion(r)}
        onPanDrag={() => setFollowMode(false)}
      >
        {pickupCoords && dropoffCoords && (
          <Polyline
            coordinates={routePoints.length > 1 ? routePoints : [pickupCoords, dropoffCoords]}
            strokeColor={ORANGE}
            strokeWidth={3.5}
            lineCap="round"
            lineJoin="round"
          />
        )}
        {pickupCoords && (
          <Marker coordinate={pickupCoords} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={s.dotPickup} />
          </Marker>
        )}
        {dropoffCoords && (
          <Marker coordinate={dropoffCoords} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={s.dotDropoff} />
          </Marker>
        )}
        {/* Driver's own position — pulsing car marker */}
        {driverLoc && (
          <Marker coordinate={driverLoc} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={s.driverCarMarker}>
              <Ionicons name="car" size={20} color="#FFF" />
            </View>
          </Marker>
        )}
      </MapView>

      {/* Header */}
      <SafeAreaView edges={['top']} style={s.headerSafe}>
        <View style={s.header}>
          <TouchableOpacity style={s.headerBtn} onPress={() => router.back()} activeOpacity={0.75}>
            <Ionicons name="arrow-back" size={20} color={NAVY} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Trip in progress</Text>
          <View style={s.headerBtn} />
        </View>
      </SafeAreaView>

      {/* Map controls */}
      <MapControls
        onZoomIn={driverZoomIn}
        onZoomOut={driverZoomOut}
        onFitRoute={driverFitRoute}
        followMode={followMode}
        onFollowToggle={() => {
          if (!followMode) {
            setFollowMode(true);
            if (driverLoc) mapRef.current?.animateCamera({ center: driverLoc }, { duration: 600 });
          } else {
            setFollowMode(false);
          }
        }}
        heading={heading}
        onResetBearing={driverResetBearing}
        bottomOffset={300}
      />

      {loading && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator color={ORANGE} size="large" />
        </View>
      )}

      {/* Bottom sheet */}
      <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={s.dragHandle} />

        {/* Rider row */}
        <View style={s.driverRow}>
          <View style={s.driverAvatar}>
            {riderPhotoURL
              ? <Image source={{ uri: riderPhotoURL }} style={s.driverAvatarImg} />
              : <Text style={s.driverInitials}>{riderName.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()}</Text>}
          </View>
          <View style={s.driverInfo}>
            <Text style={s.driverName}>{riderName}</Text>
            <Text style={s.driverVehicle}>Passenger</Text>
          </View>
          <TouchableOpacity style={s.iconBtn} onPress={openChat} activeOpacity={0.75}>
            <Ionicons name="chatbubble-ellipses" size={20} color={NAVY} />
          </TouchableOpacity>
        </View>

        {/* ETA row */}
        <View style={s.etaRow}>
          <View style={s.etaBlock}>
            <Text style={s.etaLabel}>ETA</Text>
            <Text style={s.etaValue}>
              {durationMin !== null ? formatDuration(durationMin) : '—'}
            </Text>
          </View>
          <View style={s.etaDivider} />
          <View style={s.etaBlock}>
            <Text style={s.etaLabel}>MILES TO GO</Text>
            <Text style={s.etaValueSm}>
              {distanceMi !== null ? `${distanceMi.toFixed(1)} mi` : '—'}
            </Text>
          </View>
        </View>

        {/* Complete + Share row */}
        {rideStatus !== 'DRIVER_COMPLETED' && rideStatus !== 'COMPLETED' ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              style={[s.completeBtn, completing && { opacity: 0.6 }]}
              onPress={handleComplete}
              disabled={completing}
              activeOpacity={0.85}
            >
              {completing
                ? <ActivityIndicator size="small" color="#FFF" />
                : <Text style={s.completeBtnText}>Complete Ride</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={s.shareBtn} onPress={shareTrip} activeOpacity={0.8}>
              <Ionicons name="share-social-outline" size={16} color={NAVY} />
              <Text style={s.shareBtnText}>Share</Text>
            </TouchableOpacity>
          </View>
        ) : rideStatus === 'DRIVER_COMPLETED' ? (
          <View style={s.waitingBanner}>
            <ActivityIndicator size="small" color={ORANGE} style={{ marginRight: 10 }} />
            <Text style={s.waitingText}>Waiting for rider to confirm arrival…</Text>
          </View>
        ) : (
          <View style={[s.waitingBanner, { backgroundColor: '#EDFAF3' }]}>
            <Ionicons name="checkmark-circle" size={20} color="#16A34A" style={{ marginRight: 10 }} />
            <Text style={[s.waitingText, { color: '#15803D' }]}>Ride complete!</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#E8E3DB' },

  headerSafe: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  header:     {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 16, marginTop: 8,
  },
  headerBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#FFFFFFCC', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { color: NAVY, fontSize: 20, fontWeight: '800' },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },

  dotPickup:  { width: 14, height: 14, borderRadius: 7, backgroundColor: NAVY, borderWidth: 2, borderColor: '#FFF' },
  dotDropoff: { width: 14, height: 14, borderRadius: 7, backgroundColor: ORANGE, borderWidth: 2, borderColor: '#FFF' },

  sheet:     {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
    backgroundColor: BG, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.08, shadowRadius: 12,
    elevation: 8,
  },
  dragHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginBottom: 16 },

  driverRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  driverAvatar: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: ORANGE,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  driverAvatarImg: { width: 46, height: 46, borderRadius: 23 },
  driverInitials:  { color: '#FFF', fontSize: 16, fontWeight: '800' },
  driverInfo:  { flex: 1 },
  driverName:  { color: NAVY, fontSize: 15, fontWeight: '700', marginBottom: 2 },
  driverVehicle: { color: MUTED, fontSize: 12, fontWeight: '500' },
  iconBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#F1F3F6', alignItems: 'center', justifyContent: 'center',
  },

  etaRow:    {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F5F3EF', borderRadius: 16, padding: 16, marginBottom: 16,
  },
  etaBlock:  { flex: 1, alignItems: 'center' },
  etaDivider: { width: 1, height: 36, backgroundColor: BORDER },
  etaLabel:  { color: MUTED, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 },
  etaValue:  { color: ORANGE, fontSize: 26, fontWeight: '800' },
  etaValueSm: { color: NAVY, fontSize: 18, fontWeight: '700' },

  shareBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: BORDER, borderRadius: 24,
    paddingVertical: 13, backgroundColor: '#FFF',
  },
  shareBtnText: { color: NAVY, fontSize: 14, fontWeight: '600' },

  navBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: ORANGE, borderRadius: 24, paddingVertical: 13, backgroundColor: '#FFF8F5',
  },
  navBtnText: { color: ORANGE, fontSize: 14, fontWeight: '700' },

  completeBtn: {
    flex: 2, alignItems: 'center', justifyContent: 'center',
    backgroundColor: NAVY, borderRadius: 24, paddingVertical: 13,
  },
  completeBtnText: { color: '#FFF', fontSize: 14, fontWeight: '700' },

  // Map overlay controls
  mapControls: {
    position: 'absolute',
    right: 12,
    zIndex: 5,
  },
  mapCtrlCluster: {
    backgroundColor: 'rgba(251,250,247,0.96)',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.13,
    shadowRadius: 6,
    elevation: 5,
    borderWidth: 1,
    borderColor: BORDER,
  },
  mapCtrlBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapCtrlBtnActive: {
    backgroundColor: ORANGE,
  },
  mapCtrlSep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: BORDER,
    marginHorizontal: 8,
  },

  // Car markers
  carMarker: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#FFFFFFEE',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18, shadowRadius: 4, elevation: 4,
    borderWidth: 1.5, borderColor: BORDER,
  },
  driverCarMarker: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: ORANGE,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35, shadowRadius: 6, elevation: 6,
    borderWidth: 2.5, borderColor: '#FFF',
  },

  waitingBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFF8F0', borderRadius: 14, padding: 14, marginBottom: 12,
  },
  waitingText: { flex: 1, color: ORANGE, fontSize: 13, fontWeight: '600' },

  confirmBanner: {
    backgroundColor: '#F0FFF4', borderRadius: 14, padding: 16, marginBottom: 12, alignItems: 'center',
  },
  confirmBannerTitle: { color: '#15803D', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  confirmBannerBody:  { color: MUTED, fontSize: 13, fontWeight: '500', textAlign: 'center', marginBottom: 14 },
  confirmBtn: {
    backgroundColor: '#16A34A', borderRadius: 24, paddingVertical: 12, paddingHorizontal: 32, alignItems: 'center',
  },
  confirmBtnText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
});
