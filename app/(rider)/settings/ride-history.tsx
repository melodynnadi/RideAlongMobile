import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, FlatList, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, MapPin, Clock, Star, Calendar, DollarSign, Flag } from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { useTheme } from '@/hooks/useTheme';
import { router } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { firebaseAuth, firestore } from '@/constants/services';
import { FlagRideModal } from '@/components/FlagRideModal';
import { AddressLink } from '@/components/AddressLink';

export type HistoryItem = {
  id: string;
  rideId?: string;
  date?: string;
  time?: string;
  from?: string;
  to?: string;
  driver?: string;
  rating?: number;
  price?: number;
  status?: string;
  duration?: string;
};

export default function RideHistoryScreen() {
  const theme = useTheme();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [completedRidesCount, setCompletedRidesCount] = useState(0);
  const [intersectionAvgRating, setIntersectionAvgRating] = useState<string>('—');
  const validCompletedRideIdsRef = useRef<Set<string>>(new Set());
  const ratingsByRideIdMapRef = useRef<Map<string, { stars: number; createdAt?: number }>>(new Map());
  const [flagModalVisible, setFlagModalVisible] = useState(false);
  const [selectedRideId, setSelectedRideId] = useState<string | null>(null);

  useEffect(() => {
    // Helpers to parse and normalize fields from different sources
    const parseAmount = (v: any): number => {
      if (typeof v === 'number' && isFinite(v)) return v;
      if (typeof v === 'string') {
        const m = v.replace(/[^0-9.\-]/g, '');
        const n = parseFloat(m);
        return isNaN(n) ? 0 : n;
      }
      return 0;
    };
    const toDateSafe = (v: any): Date | null => {
      if (!v) return null;
      if (v instanceof Date) return v;
      // Firestore Timestamp
      if (typeof v === 'object' && typeof (v as any).toDate === 'function') {
        try { return (v as any).toDate(); } catch { /* noop */ }
      }
      if (typeof v === 'string') {
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
      }
      return null;
    };
    const composeDateTime = (date?: any, time?: any): Date | null => {
      const d = date ? new Date(date) : null;
      if (d && !isNaN(d.getTime())) {
        if (typeof time === 'string') {
          const dt = new Date(`${d.toDateString()} ${time}`);
          if (!isNaN(dt.getTime())) return dt;
        }
        return d;
      }
      return null;
    };

    const keyFor = (r: any, id: string): string => {
      const rr = r?.rideRequestId || r?.originalRideRequest?.id;
      if (rr) return `rr_${rr}`;
      const rp = r?.ridePostingId || r?.originalRidePosting?.id;
      const rid = r?.riderId || r?.riderUid || r?.rider?.id || r?.rider?.uid;
      if (rp && rid) return `rp_${rp}_${rid}`;
      return `id_${id}`;
    };

    const normalize = (src: 'hist' | 'conf', id: string, r: any): { item: HistoryItem; sortAt: number } => {
      const date = r?.date ?? r?.dateLabel;
      const time = r?.time ?? r?.pickupTime;
      const from = r?.from ?? r?.pickup ?? r?.pickupLocation?.address;
      const to = r?.to ?? r?.dropoff ?? r?.dropoffLocation?.address;
      const price = parseAmount(r?.price ?? r?.actualFare ?? r?.estimatedFare ?? r?.contributionAmount);
      const rating = typeof r?.rating === 'number' ? r?.rating : (typeof r?.driverRating === 'number' ? r?.driverRating : 0);
      const status = r?.status ?? (src === 'conf' ? 'COMPLETED' : undefined);
      const duration = r?.duration ?? r?.durationLabel;
      // Resolve a stable rideId used by rideRatings (prefer confirmed ride doc id)
      const rideId = r?.rideId || r?.confirmedRideId || (src === 'conf' ? id : undefined);
      // Prefer a completion timestamp-like field
      const sortDate = toDateSafe(r?.completedAt) || toDateSafe(r?.createdAt) || composeDateTime(date, time) || toDateSafe(r?.updatedAt) || new Date(0);
      const item: HistoryItem = { id, rideId, date, time, from, to, driver: r?.driverName ?? r?.driver?.name, rating, price, status, duration };
      return { item, sortAt: sortDate ? sortDate.getTime() : 0 };
    };

    const unsubAuth = onAuthStateChanged(firebaseAuth, (user) => {
      setLoading(true);
      let histMap = new Map<string, { item: HistoryItem; sortAt: number }>();
      let confMap = new Map<string, { item: HistoryItem; sortAt: number }>();
      const unsubs: Array<() => void> = [];

      // Ratings by rideId for this rider
      let ratingsByRideId = new Map<string, { stars: number; createdAt?: number }>();

      const publish = () => {
        // Merge by union of keys so we can borrow rideId from confirmed entries
        const allKeys = new Set<string>([...Array.from(histMap.keys()), ...Array.from(confMap.keys())]);
        const rows: Array<{ item: HistoryItem; sortAt: number }> = [];
        allKeys.forEach((k) => {
          const h = histMap.get(k);
          const c = confMap.get(k);
          const chosen = h ?? c; // prefer history
          if (!chosen) return;
          let base = chosen.item;
          const sortAt = chosen.sortAt;
          // If missing rideId on history, borrow from confirmed entry
          const rideId = base.rideId || c?.item.rideId;
          if (rideId && ratingsByRideId.has(rideId)) {
            const entry = ratingsByRideId.get(rideId)!;
            base = { ...base, rideId, rating: entry.stars };
          } else if (rideId) {
            base = { ...base, rideId };
          }
          rows.push({ item: base, sortAt });
        });
        rows.sort((a, b) => b.sortAt - a.sortAt);
        setItems(rows.map((r) => r.item));
        setLoading(false);
      };

      // Clear when signed out
      if (!user) {
        setItems([]);
        setLoading(false);
        return;
      }

      // rideHistory source
      try {
        const qHist = query(
          collection(firestore, 'rideHistory'),
          where('riderId', '==', user.uid),
          orderBy('createdAt', 'desc')
        );
        const u1 = onSnapshot(qHist, (snap) => {
          const map = new Map<string, { item: HistoryItem; sortAt: number }>();
          snap.forEach((d) => {
            const r = d.data();
            const key = keyFor(r, d.id);
            map.set(key, normalize('hist', d.id, r));
          });
          histMap = map;
          publish();
        }, () => setLoading(false));
        unsubs.push(u1);
      } catch {
        // ignore
      }

      // confirmedRides COMPLETED and FLAGGED as supplement
      try {
        const qConf = query(
          collection(firestore, 'confirmedRides'),
          where('riderId', '==', user.uid),
          where('status', 'in', ['COMPLETED', 'FLAGGED'])
        );
        const u2 = onSnapshot(qConf, (snap) => {
          const map = new Map<string, { item: HistoryItem; sortAt: number }>();
          const rideIds = new Set<string>();
          snap.forEach((d) => {
            const r = d.data();
            // Exclude rides that were resolved from flagged status (they already have ratings)
            if (r?.resolvedFromFlagged === true) return;
            const key = keyFor(r, d.id);
            map.set(key, normalize('conf', d.id, r));
            rideIds.add(String(d.id));
          });
          confMap = map;
          setCompletedRidesCount(rideIds.size);
          validCompletedRideIdsRef.current = rideIds;
          recomputeIntersectionAvg();
          publish();
        }, () => setLoading(false));
        unsubs.push(u2);
      } catch {
        // ignore
      }

      // rideRatings by this rider (rateeId == user.uid)
      try {
        const qRatings = query(
          collection(firestore, 'rideRatings'),
          where('rateeId', '==', user.uid)
        );
        const u3 = onSnapshot(qRatings, (snap) => {
          const map = new Map<string, { stars: number; createdAt?: number }>();
          snap.forEach((d) => {
            const r = d.data() as any;
            const stars = typeof r?.stars === 'number' ? r.stars : (typeof r?.rating === 'number' ? r.rating : undefined);
            const rideId = r?.rideId as string | undefined;
            let createdAt: number | undefined;
            const ca = r?.createdAt;
            if (ca && typeof ca?.toDate === 'function') {
              try { createdAt = ca.toDate().getTime(); } catch { /* noop */ }
            } else if (typeof ca === 'string') {
              const td = new Date(ca).getTime();
              if (!isNaN(td)) createdAt = td;
            }
            if (rideId && typeof stars === 'number') {
              // If multiple ratings exist for the same ride, keep the latest
              const prev = map.get(rideId);
              if (!prev || (createdAt || 0) >= (prev.createdAt || 0)) {
                map.set(rideId, { stars, createdAt });
              }
            }
          });
          ratingsByRideId = map;
          ratingsByRideIdMapRef.current = map;
          recomputeIntersectionAvg();
          publish();
        }, () => setLoading(false));
        unsubs.push(u3);
      } catch {
        // ignore
      }

      return () => { unsubs.forEach((u) => u && u()); };
    });

    return () => unsubAuth();
  }, []);

  const handleFlaggedUpdate = (rideId: string) => {
    // Optimistically update the UI
    setItems(prev => prev.map(item => 
      item.rideId === rideId || item.id === rideId 
        ? { ...item, status: 'FLAGGED' } 
        : item
    ));
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '—';
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getAverageRating = () => {
    const rated = items.filter((ride) => typeof ride.rating === 'number' && ride.rating! > 0);
    if (!rated.length) return '0.0';
    const totalRating = rated.reduce((total, ride) => total + (ride.rating || 0), 0);
    return (totalRating / rated.length).toFixed(1);
  };

  const getIntersectionAvgRating = () => {
    return intersectionAvgRating;
  };

  const recomputeIntersectionAvg = () => {
    try {
      const valid = validCompletedRideIdsRef.current;
      const ratings = ratingsByRideIdMapRef.current;
      let sum = 0;
      let count = 0;
      ratings.forEach((v, id) => {
        if (valid.has(id) && typeof v?.stars === 'number' && isFinite(v.stars)) {
          sum += v.stars;
          count += 1;
        }
      });
      setIntersectionAvgRating(count ? (sum / count).toFixed(1) : '—');
    } catch {}
  };

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, index) => (
      <Star
        key={index}
        size={12}
        color={index < rating ? '#F59E0B' : '#E5E7EB'}
        fill={index < rating ? '#F59E0B' : 'transparent'}
      />
    ));
  };

  const renderRideItem = ({ item }: { item: HistoryItem }) => (
    <Card style={styles.rideCard}>
      <View style={styles.rideHeader}>
        <View style={styles.dateContainer}>
          <Calendar size={16} color={theme.colors.primary} />
          <Text style={[styles.rideDate, { color: theme.colors.secondary }]}>
            {formatDate(item.date || '')}
          </Text>
          {String(item.status || '').toUpperCase() === 'FLAGGED' && (
            <View style={styles.flaggedBadge}>
              <Text style={styles.flaggedBadgeText}>Flagged</Text>
            </View>
          )}
        </View>
        <View style={styles.priceContainer}>
          <DollarSign size={16} color="#10B981" />
          <Text style={[styles.ridePrice, { color: '#10B981' }]}>
            ${Number(item.price || 0).toFixed(2)}
          </Text>
        </View>
      </View>

      <View style={styles.routeContainer}>
        <View style={styles.routePoint}>
          <View style={[styles.routeDot, { backgroundColor: theme.colors.primary }]} />
          <AddressLink address={item.from || 'Unknown'} textStyle={[styles.locationText, { color: theme.colors.secondary }]} />
        </View>
        <View style={styles.routeLine} />
        <View style={styles.routePoint}>
          <MapPin size={16} color="#EF4444" />
          <AddressLink address={item.to || 'Unknown'} textStyle={[styles.locationText, { color: theme.colors.secondary }]} />
        </View>
      </View>

      <View style={styles.rideDetails}>
        <View style={styles.detailItem}>
          <Clock size={14} color="#64748B" />
          <Text style={styles.detailText}>{item.time}</Text>
        </View>
        <View style={styles.detailItem}>
          <Text style={styles.driverText}>Driver: {item.driver}</Text>
        </View>
        <View style={styles.ratingContainer}>
          {renderStars(item.rating || 0)}
          <Text style={styles.ratingText}>({item.rating || 0})</Text>
        </View>
        {String(item.status || '').toUpperCase() !== 'FLAGGED' && (
          <TouchableOpacity 
            style={styles.flagButton}
            onPress={() => {
              setSelectedRideId(item.rideId || item.id);
              setFlagModalVisible(true);
            }}
          >
            <Flag size={16} color="#EF4444" />
          </TouchableOpacity>
        )}
      </View>
    </Card>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#F8FAFC' }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => router.canGoBack() ? router.back() : router.push('/settings')}
        >
          <ArrowLeft size={24} color={theme.colors.secondary} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: theme.colors.secondary }]}>
            Ride History
          </Text>
          <Text style={styles.headerSubtitle}>
            View your complete ride history and stats
          </Text>
        </View>
      </View>

      {/* Stats Summary */}
      <View style={[styles.statsContainer, { backgroundColor: '#F8FAFC' }]}>
        <Card style={styles.statCard}>
          <Text style={[styles.statNumber, { color: theme.colors.secondary }]}>
            {completedRidesCount}
          </Text>
          <Text style={styles.statLabel}>Total Rides</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={[styles.statNumber, { color: '#F59E0B' }]}>
            {getIntersectionAvgRating()}
          </Text>
          <Text style={styles.statLabel}>Avg Rating</Text>
        </Card>
      </View>

      {/* Ride History List */}
      <View style={styles.contentArea}>
        <FlatList
          data={items}
          renderItem={renderRideItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            loading ? null : (
              <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                <Text style={{ color: '#64748B' }}>No rides yet.</Text>
              </View>
            )
          }
        />
      </View>

      {/* Flag Ride Modal */}
      <FlagRideModal
        visible={flagModalVisible}
        onClose={() => {
          setFlagModalVisible(false);
          setSelectedRideId(null);
        }}
        rideId={selectedRideId}
        onFlagged={handleFlaggedUpdate}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#64748B',
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
  contentArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: 8,
  },
  listContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 20,
  },
  rideCard: {
    marginBottom: 12,
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  rideHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  dateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rideDate: {
    fontSize: 14,
    fontWeight: '500',
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ridePrice: {
    fontSize: 16,
    fontWeight: '600',
  },
  routeContainer: {
    marginBottom: 12,
  },
  routePoint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  routeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  routeLine: {
    width: 2,
    height: 20,
    backgroundColor: '#E5E7EB',
    marginLeft: 8,
    marginVertical: 2,
  },
  locationText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  rideDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailText: {
    fontSize: 12,
    color: '#64748B',
  },
  driverText: {
    fontSize: 12,
    color: '#64748B',
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    fontSize: 12,
    color: '#64748B',
    marginLeft: 4,
  },
  flagButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
  },
  flaggedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EF4444',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
    gap: 4,
  },
  flaggedBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '600',
  },
});
