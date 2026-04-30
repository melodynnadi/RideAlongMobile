import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, FlatList, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, MapPin, Clock, Star, Calendar, DollarSign, Flag } from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { useTheme } from '@/hooks/useTheme';
import { router } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, getCountFromServer, limit, onSnapshot, orderBy, query, where, documentId } from 'firebase/firestore';
import { firebaseAuth, firestore } from '@/constants/services';
import { computeFilteredAverageRating } from '@/src/services/ratings';
import FlagRideModal from '@/components/FlagRideModal';
import { submitDriverFlag } from '@/src/services/flagService';
import { AddressLink } from '@/components/AddressLink';

export type HistoryItem = {
  id: string;
  date?: string;
  time?: string;
  from?: string;
  to?: string;
  rider?: string;
  riderId?: string;
  rating?: number;
  price?: number;
  status?: string;
  duration?: string;
  ridePostingId?: string; // grouping key for multi-seat rides
  seatCount?: number; // number of passenger seats represented in a grouped card
};

export default function RideHistoryScreen() {
  const theme = useTheme();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [totalRides, setTotalRides] = useState(0);
  const [loading, setLoading] = useState(true);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [flagModalVisible, setFlagModalVisible] = useState(false);
  const [selectedRideId, setSelectedRideId] = useState<string | null>(null);

  const handleFlagPress = (rideId: string) => {
    setSelectedRideId(rideId);
    setFlagModalVisible(true);
  };

  const handleFlagSubmit = async (data: { reason: string; details?: string }) => {
    if (!selectedRideId) return false;
    try {
      const user = firebaseAuth.currentUser;
      if (!user) {
        Alert.alert('Authentication required', 'Please sign in to flag a ride.');
        return false;
      }
      await submitDriverFlag(selectedRideId, {
        reason: data.reason,
        details: data.details || '',
        flaggedByRole: 'driver',
        flaggedById: user.uid,
      });
      Alert.alert('Success', 'Ride flagged successfully. An admin will review your report.');
      return true;
    } catch (error) {
      console.error('Flag submission error:', error);
      Alert.alert('Error', 'Failed to flag ride. Please try again.');
      return false;
    }
  };

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(firebaseAuth, (user) => {
      if (!user) {
        setItems([]);
        setAvgRating(null);
        setLoading(false);
        return;
      }

      // Compute average rating only from ratings tied to existing, COMPLETED confirmed rides
      (async () => {
        try {
          const { avg } = await computeFilteredAverageRating(user.uid);
          if (typeof avg === 'number' && isFinite(avg)) setAvgRating(avg);
        } catch {}
      })();

      // Fetch total rides count (separate from paginated list for accurate stat display)
      (async () => {
        try {
          const countSnap = await getCountFromServer(query(
            collection(firestore, 'confirmedRides'),
            where('driverId', '==', user.uid),
            where('status', '==', 'COMPLETED')
          ));
          setTotalRides(countSnap.data().count);
        } catch (err) {
          console.warn('[ride-history] Failed to fetch total rides count:', err);
        }
      })();

      // Subscribe to completed and flagged confirmed rides with index fallback
      let currentUnsub: (() => void) | null = null;
      const subscribe = (useOrder: boolean) => {
        const base = [
          collection(firestore, 'confirmedRides'),
          where('driverId', '==', user.uid),
          where('status', 'in', ['COMPLETED', 'FLAGGED']),
        ] as any[];
        if (useOrder) base.push(orderBy('completedAt', 'desc'));
        base.push(limit(100));
        const qy = query.apply(null, base as any);
        currentUnsub = onSnapshot(
          qy,
          (snap) => {
            const data = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
            // Map to UI items
            const mapped: HistoryItem[] = data.map((r) => {
              const when = getHistoryDateTime(r);
              return {
                id: String(r.id),
                date: when?.toISOString() ?? (r.date || undefined),
                time: r.time || (when ? when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : undefined),
                from: getAddress(r, 'pickup'),
                to: getAddress(r, 'dropoff'),
                rider: r.riderName || r.userName || 'Rider',
                riderId: r.riderId || r.userId || r.requesterId,
                rating: undefined,
                price: getContributionNumber(r) ?? 0,
                status: r.status,
                duration: getDurationText(r),
                ridePostingId: r.ridePostingId || r.originalRidePosting?.id || undefined,
              };
            });
            if (!useOrder) {
              mapped.sort((a, b) => {
                const at = a.date ? Date.parse(a.date) : 0;
                const bt = b.date ? Date.parse(b.date) : 0;
                return bt - at;
              });
            }
            
            // Note: Total rides count is fetched separately on mount for accuracy
            // Don't update totalRides here since it would be capped by limit(100)
            
            // Enrich with ratings the rider gave to this driver per ride
            (async () => {
              try {
                const uidStr = String(user.uid);
                const enriched = await Promise.all(
                  mapped.map(async (it) => {
                    let stars: number | undefined = undefined;
                    // Prefer direct doc id: rideRatings/{rideId}_{riderId}
                    if (it.riderId) {
                      try {
                        const rd = await getDoc(doc(firestore, 'rideRatings', `${it.id}_${it.riderId}`));
                        if (rd.exists()) {
                          const d: any = rd.data();
                          if (String(d.rateeId) === uidStr && typeof d.stars === 'number') stars = d.stars;
                        }
                      } catch {}
                    }
                    if (stars === undefined) {
                      // Fallback: query by rideId and rateeId=driver
                      try {
                        const qy = query(
                          collection(firestore, 'rideRatings'),
                          where('rideId', '==', it.id),
                          where('rateeId', '==', uidStr),
                          limit(1)
                        );
                        const s = await getDocs(qy);
                        const docu = s.docs[0];
                        if (docu) {
                          const d: any = docu.data();
                          if (typeof d.stars === 'number') stars = d.stars;
                        }
                      } catch {}
                    }
                    return { ...it, rating: typeof stars === 'number' ? stars : undefined } as HistoryItem;
                  })
                );
                // Group multi-seat rides (same ridePostingId) into a single card
                const byPosting = new Map<string, HistoryItem[]>();
                enriched.forEach((it) => {
                  const key = it.ridePostingId || it.id;
                  const arr = byPosting.get(key) || [];
                  arr.push(it);
                  byPosting.set(key, arr);
                });
                const grouped: HistoryItem[] = [];
                byPosting.forEach((arr, key) => {
                  if (arr.length === 1) {
                    grouped.push(arr[0]);
                  } else {
                    // Aggregate - use the most recent date from the group for sorting
                    const sorted = [...arr].sort((a, b) => {
                      const at = a.date ? Date.parse(a.date) : 0;
                      const bt = b.date ? Date.parse(b.date) : 0;
                      return bt - at;
                    });
                    const latest = sorted[0]; // Use the most recently dated seat as base
                    const riderNames = arr.map(r => r.rider).filter(Boolean) as string[];
                    const priceSum = arr.reduce((sum, r) => sum + (r.price || 0), 0);
                    const ratings = arr.map(r => r.rating).filter(r => typeof r === 'number') as number[];
                    const avgRating = ratings.length ? (ratings.reduce((a,b)=>a+b,0) / ratings.length) : undefined;
                    grouped.push({
                      ...latest,
                      id: key, // unified id for card
                      rider: riderNames.slice(0, 3).join(', ') + (riderNames.length > 3 ? ` +${riderNames.length - 3} more` : ''),
                      price: priceSum,
                      rating: avgRating,
                      seatCount: arr.length,
                    });
                  }
                });
                // Sort grouped by date descending (ISO string already)
                grouped.sort((a, b) => {
                  const at = a.date ? Date.parse(a.date) : 0;
                  const bt = b.date ? Date.parse(b.date) : 0;
                  return bt - at;
                });
                setItems(grouped);
              } catch {
                setItems(mapped);
              }
            })();
            setLoading(false);
          },
          (err) => {
            // Missing index fallback
            if (String(err?.code) === 'failed-precondition' && useOrder) {
              if (currentUnsub) currentUnsub();
              subscribe(false);
            } else if (useOrder) {
              if (currentUnsub) currentUnsub();
              subscribe(false);
            } else {
              setLoading(false);
            }
          }
        );
      };
      subscribe(true);

      return () => {
        if (currentUnsub) currentUnsub();
      };
    });
    return () => unsubAuth();
  }, []);

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

  const getAverageRatingText = () => (typeof avgRating === 'number' ? avgRating.toFixed(1) : '—');

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
            ${Number(item.price || 0).toFixed(2)}{item.seatCount && item.seatCount > 1 ? ` · ${item.seatCount} seats` : ''}
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
          <Text style={styles.driverText}>Rider: {item.rider}</Text>
        </View>
        <View style={styles.ratingContainer}>
          {renderStars(Math.round(item.rating || 0))}
          <Text style={styles.ratingText}>
            ({typeof item.rating === 'number' ? item.rating.toFixed(1) : '0.0'})
          </Text>
        </View>
        {String(item.status || '').toUpperCase() !== 'FLAGGED' && (
          <TouchableOpacity 
            style={styles.flagButton}
            onPress={() => handleFlagPress(item.id)}
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
            {totalRides}
          </Text>
          <Text style={styles.statLabel}>Total Rides</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={[styles.statNumber, { color: '#F59E0B' }]}>
            {getAverageRatingText()}
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
        onSubmit={handleFlagSubmit}
      />
    </SafeAreaView>
  );
}

// Helpers copied from home screen for mapping

function toDateField(v: any): Date | null {
  try {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v?.toDate === 'function') return v.toDate();
    if (typeof v === 'number') return new Date(v);
    if (typeof v === 'string') {
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  } catch { return null; }
}

function composeDateTime(dateStr?: any, timeStr?: any): Date | null {
  try {
    if (!dateStr && !timeStr) return null;
    if (dateStr && timeStr && typeof dateStr === 'string' && typeof timeStr === 'string') {
      const d = new Date(`${dateStr}T${timeStr}`);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof dateStr === 'string') {
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof timeStr === 'string') {
      const d = new Date(timeStr);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  } catch { return null; }
}

function getHistoryDateTime(cr: any): Date | null {
  return (
    composeDateTime(cr?.date, cr?.time) ||
    toDateField(cr?.completedAt || cr?.confirmedAt || cr?.createdAt)
  );
}

function getAddress(r: any, kind: 'pickup' | 'dropoff'): string | undefined {
  const loc = kind === 'pickup' ? (r?.pickup || r?.pickupLocation || r?.from) : (r?.dropoff || r?.dropoffLocation || r?.to);
  if (typeof loc === 'string') return loc;
  if (loc?.address) return String(loc.address);
  const addr = kind === 'pickup' ? (r?.pickupAddress || r?.fromAddress) : (r?.dropoffAddress || r?.toAddress);
  if (typeof addr === 'string') return addr;
  return undefined;
}

function parseCurrency(v: any): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const num = Number(v.replace(/[^0-9.\-]/g, ''));
    return isNaN(num) ? undefined : num;
  }
  return undefined;
}

function getContributionNumber(cr: any): number | undefined {
  const v = cr?.contributionAmount ?? cr?.price;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseCurrency(v);
  return undefined;
}

function getDurationText(r: any): string | undefined {
  try {
    const d = r?.duration;
    if (typeof d?.text === 'string' && d.text.trim()) return normalizeDurationString(d.text.trim());
    if (typeof d === 'string') return normalizeDurationString(d);
    if (typeof d === 'number') {
      const mins = Math.round(d);
      if (mins < 60) return `${mins} min`;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
    }
    const seconds = r?.durationSeconds ?? r?.duration_secs ?? r?.durationSec;
    if (typeof seconds === 'number') {
      const mins = Math.round(seconds / 60);
      if (mins < 60) return `${mins} min`;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
    }
    return undefined;
  } catch { return undefined; }
}

function normalizeDurationString(s: string): string {
  try {
    const lower = s.toLowerCase();
    if (/^\d+\s*hr(\s+\d+\s*min)?$/.test(lower) || /^\d+\s*min$/.test(lower)) return s;
    const hMatch = lower.match(/(\d+(?:\.\d+)?)\s*(h|hr|hour|hours)/);
    const mMatch = lower.match(/(\d+(?:\.\d+)?)\s*(m|min|minute|minutes)/);
    let h = hMatch ? parseFloat(hMatch[1]) : 0;
    let m = mMatch ? parseFloat(mMatch[1]) : 0;
    if (!hMatch && !mMatch) {
      const onlyMin = lower.match(/(\d+(?:\.\d+)?)\s*m/);
      if (onlyMin) m = parseFloat(onlyMin[1]);
    }
    if (h && h % 1 !== 0) {
      const frac = h - Math.floor(h);
      m += frac * 60;
      h = Math.floor(h);
    }
    m = Math.round(m);
    if (m >= 60) { h += Math.floor(m / 60); m = m % 60; }
    if (h > 0 && m > 0) return `${h} hr ${m} min`;
    if (h > 0) return `${h} hr`;
    if (m > 0) return `${m} min`;
    return s;
  } catch { return s; }
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
