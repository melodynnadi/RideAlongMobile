import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, StatusBar, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from '@/components/platform/NativeMaps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { firestore, GOOGLE_MAPS_API_KEY } from '@/constants/services';
import { useAppTheme } from '@/hooks/ThemeContext';

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

const MAP_STYLE_DARK = [
  { elementType: 'geometry',                                          stylers: [{ color: '#0A1628' }] },
  { elementType: 'labels.text.fill',                                  stylers: [{ color: '#A0AEC0' }] },
  { elementType: 'labels.text.stroke',                                stylers: [{ color: '#050C1E' }] },
  { featureType: 'road',          elementType: 'geometry',            stylers: [{ color: '#1A2540' }] },
  { featureType: 'road',          elementType: 'geometry.stroke',     stylers: [{ color: '#0F1A30' }] },
  { featureType: 'road.highway',  elementType: 'geometry',            stylers: [{ color: '#1E2E50' }] },
  { featureType: 'road.highway',  elementType: 'geometry.stroke',     stylers: [{ color: '#0A1628' }] },
  { featureType: 'water',         elementType: 'geometry',            stylers: [{ color: '#0A1628' }] },
  { featureType: 'water',         elementType: 'labels.text.fill',    stylers: [{ color: '#4A5568' }] },
  { featureType: 'landscape',     elementType: 'geometry',            stylers: [{ color: '#0D1F3C' }] },
  { featureType: 'poi',           elementType: 'geometry',            stylers: [{ color: '#0D1F3C' }] },
  { featureType: 'poi',           elementType: 'labels',              stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park',      elementType: 'geometry',            stylers: [{ color: '#0D2215' }] },
  { featureType: 'transit',                                           stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke',    stylers: [{ color: '#1A2540' }] },
];

function decodePolyline(encoded: string): { latitude: number; longitude: number }[] {
  const coords: { latitude: number; longitude: number }[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return coords;
}

type DriverLocation = {
  lat: number;
  lng: number;
  heading: number | null;
  isActive: boolean;
};

export default function DriverMapScreen() {
  const { colors, isDark } = useAppTheme();
  const { trackingKey } = useLocalSearchParams<{ trackingKey: string }>();
  const mapRef = useRef<MapView>(null);

  const [driverLoc, setDriverLoc] = useState<DriverLocation | null>(null);
  const [riderCoords, setRiderCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [distanceMi, setDistanceMi] = useState<number | null>(null);
  const [arrived, setArrived] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // Subscribe to driver's live location
  useEffect(() => {
    if (!trackingKey) { setNotFound(true); return; }

    const notFoundTimer = setTimeout(() => setNotFound(true), 10000);

    const unsub = onSnapshot(doc(firestore, 'driverTracking', trackingKey), (snap) => {
      if (!snap.exists()) return;
      clearTimeout(notFoundTimer);
      const data = snap.data() as DriverLocation;
      setDriverLoc(data);
      setNotFound(false);
      if (data.isActive === false) setArrived(true);
    }, () => {
      clearTimeout(notFoundTimer);
      setNotFound(true);
    });

    return () => { clearTimeout(notFoundTimer); unsub(); };
  }, [trackingKey]);

  // Get rider's own location once
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setRiderCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      } catch {}
    })();
  }, []);

  // Fetch driving route when both locations are known
  useEffect(() => {
    if (!driverLoc || !riderCoords || !GOOGLE_MAPS_API_KEY) return;
    let cancelled = false;
    (async () => {
      try {
        const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${driverLoc.lat},${driverLoc.lng}&destination=${riderCoords.latitude},${riderCoords.longitude}&mode=driving&key=${GOOGLE_MAPS_API_KEY}`;
        const res = await fetch(url);
        const json = await res.json();
        if (cancelled || !json.routes?.length) return;
        setRouteCoords(decodePolyline(json.routes[0].overview_polyline.points));
        const leg = json.routes[0].legs?.[0];
        if (leg) {
          setDurationMin(Math.round((leg.duration?.value ?? 0) / 60));
          setDistanceMi((leg.distance?.value ?? 0) / 1609.34);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [driverLoc?.lat, driverLoc?.lng, riderCoords?.latitude, riderCoords?.longitude]);

  // Pan map to show driver (and rider if available)
  useEffect(() => {
    if (!driverLoc || !mapRef.current) return;
    if (riderCoords) {
      mapRef.current.fitToCoordinates(
        [
          { latitude: driverLoc.lat, longitude: driverLoc.lng },
          riderCoords,
        ],
        { edgePadding: { top: 120, right: 80, bottom: 120, left: 80 }, animated: true },
      );
    } else {
      (mapRef.current as any).animateToRegion({
        latitude: driverLoc.lat,
        longitude: driverLoc.lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 400);
    }
  }, [driverLoc?.lat, driverLoc?.lng, !!riderCoords]);

  return (
    <View style={s.root}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />

      {/* Full-screen map */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={GOOGLE_MAPS_API_KEY ? PROVIDER_GOOGLE : undefined}
        customMapStyle={isDark ? MAP_STYLE_DARK : MAP_STYLE}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        showsTraffic={false}
      >
        {routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor={colors.primary}
            strokeWidth={3.5}
            lineCap="round"
            lineJoin="round"
          />
        )}
        {driverLoc && (
          <Marker
            coordinate={{ latitude: driverLoc.lat, longitude: driverLoc.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
          >
            <View style={s.driverMarker}>
              <Ionicons name="car" size={20} color="#fff" />
            </View>
          </Marker>
        )}
        {riderCoords && (
          <Marker coordinate={riderCoords} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={s.riderDot} />
          </Marker>
        )}
      </MapView>

      {/* Floating header over map */}
      <SafeAreaView edges={['top']} style={s.headerSafe} pointerEvents="box-none">
        <View style={s.header}>
          <TouchableOpacity style={s.headerBtn} onPress={() => router.back()} activeOpacity={0.75}>
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: colors.textPrimary }]}>Driver on the way</Text>
          <View style={s.headerBtn} />
        </View>
      </SafeAreaView>

      {/* Loading state */}
      {!driverLoc && !notFound && (
        <View style={[s.overlay, { backgroundColor: colors.bgPrimary || '#FBFAF7' }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[s.overlayText, { color: colors.textSecondary }]}>Waiting for driver location…</Text>
        </View>
      )}

      {/* Not found state */}
      {notFound && (
        <View style={[s.overlay, { backgroundColor: colors.bgPrimary || '#FBFAF7' }]}>
          <Ionicons name="location-outline" size={40} color={colors.textSecondary} />
          <Text style={[s.overlayText, { color: colors.textSecondary }]}>Driver location not available yet.</Text>
          <Text style={[s.overlayText, { fontSize: 13, marginTop: 4, color: colors.textSecondary }]}>
            Try again after the driver taps "I'm on my way".
          </Text>
        </View>
      )}

      {/* Bottom info card — shown once driver location is known */}
      {driverLoc && !notFound && (
        <View style={[s.infoCard, { backgroundColor: colors.bgCard || '#fff' }]}>
          {arrived ? (
            <View style={s.arrivedRow}>
              <View style={[s.arrivedIconWrap, { backgroundColor: '#10B981' + '22' }]}>
                <Ionicons name="checkmark-circle" size={26} color="#10B981" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.arrivedTitle, { color: colors.textPrimary }]}>Driver has arrived!</Text>
                <Text style={[s.arrivedSub, { color: colors.textSecondary }]}>Head outside to meet your driver.</Text>
              </View>
            </View>
          ) : (
            <View style={s.etaRow}>
              <View style={s.etaBlock}>
                <Text style={[s.etaLabel, { color: colors.textSecondary }]}>ETA</Text>
                <Text style={[s.etaValue, { color: colors.primary }]}>
                  {durationMin === null ? '—' : durationMin < 1 ? '<1 min' : `${durationMin} min`}
                </Text>
              </View>
              <View style={[s.etaDivider, { backgroundColor: colors.border }]} />
              <View style={s.etaBlock}>
                <Text style={[s.etaLabel, { color: colors.textSecondary }]}>DISTANCE</Text>
                <Text style={[s.etaValue, { color: colors.textPrimary }]}>
                  {distanceMi === null ? '—' : distanceMi < 0.1 ? 'Arriving' : `${distanceMi.toFixed(1)} mi`}
                </Text>
              </View>
              <View style={[s.etaDivider, { backgroundColor: colors.border }]} />
              <View style={s.etaBlock}>
                <Text style={[s.etaLabel, { color: colors.textSecondary }]}>UPDATES</Text>
                <Text style={[s.etaValue, { color: colors.textPrimary }]}>Every 10s</Text>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },

  headerSafe: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 8,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
  },

  driverMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#DE5D20',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#DE5D20',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 6,
    borderWidth: 2.5,
    borderColor: '#fff',
  },
  riderDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#15233A',
    borderWidth: 2,
    borderColor: '#fff',
  },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 40,
  },
  overlayText: {
    fontSize: 15,
    textAlign: 'center',
  },

  infoCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 16,
    paddingBottom: 36,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },

  etaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  etaBlock: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  etaDivider: {
    width: 1,
    height: 36,
  },
  etaLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  etaValue: {
    fontSize: 20,
    fontWeight: '800',
  },

  arrivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 4,
  },
  arrivedIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrivedTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 2,
  },
  arrivedSub: {
    fontSize: 13,
    fontWeight: '500',
  },
});
