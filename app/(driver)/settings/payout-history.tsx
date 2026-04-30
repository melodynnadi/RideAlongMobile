import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { router } from 'expo-router';
import { useTheme } from '@/hooks/useTheme';
import { Card } from '@/components/ui/Card';
import { fetchPayouts, type Payout } from '@/src/services/payouts';

export default function PayoutHistoryScreen() {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [payouts, setPayouts] = useState<Payout[]>([]);

  const loadPayouts = async () => {
    try {
      console.log('[PayoutHistory] Loading payouts...');
      const result = await fetchPayouts(50); // Get more payouts for history page
      setPayouts(result.payouts);
      console.log('[PayoutHistory] Loaded', result.payouts.length, 'payouts');
    } catch (error) {
      console.error('[PayoutHistory] Failed to load payouts:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPayouts();
    setRefreshing(false);
  };

  useEffect(() => {
    loadPayouts().finally(() => setLoading(false));
  }, []);

  // Parse date values that may arrive as ISO strings, ms timestamps, or Unix seconds
  const parseDate = (raw: any): Date | null => {
    if (raw === null || raw === undefined) return null;
    // If number or numeric string, decide if seconds vs milliseconds
    let num: number | null = null;
    if (typeof raw === 'number') num = raw;
    else if (typeof raw === 'string' && /^\d+$/.test(raw)) num = Number(raw);
    if (num !== null) {
      // Heuristic: treat anything < 1e12 as seconds (current ms timestamps ~1.7e12)
      if (num < 1e12) num = num * 1000; // convert seconds -> ms
      return new Date(num);
    }
    try {
      const d = new Date(raw);
      if (isNaN(d.getTime())) return null;
      return d;
    } catch {
      return null;
    }
  };

  const formatDate = (raw: any) => {
    const date = parseDate(raw);
    if (!date) return '—';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (raw: any) => {
    const date = parseDate(raw);
    if (!date) return '—';
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return '#10B981'; // Green for completed
      case 'pending':
      case 'in_transit':
        return '#F59E0B'; // Orange for pending/in transit
      case 'failed':
      case 'canceled':
        return '#EF4444'; // Red for failed/canceled
      default:
        return '#6B7280'; // Gray for unknown
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'paid':
        return 'Completed';
      case 'in_transit':
        return 'In Transit';
      case 'canceled':
        return 'Canceled';
      default:
        return status.charAt(0).toUpperCase() + status.slice(1);
    }
  };

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
          <Text style={[styles.headerTitle, { color: theme.colors.secondary }]}>Payout History</Text>
          <Text style={styles.headerSubtitle}>View all your payouts</Text>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />
        }
      >
        {payouts.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={[styles.emptyText, { color: theme.colors.muted }]}>
              No payout history yet
            </Text>
          </Card>
        ) : (
          <View style={styles.payoutsList}>
            {payouts.map((payout) => (
              <Card key={payout.id} style={styles.payoutCard}>
                <View style={styles.payoutHeader}>
                  <View style={styles.payoutInfo}>
                    <View style={styles.payoutTitleRow}>
                      <Text style={[styles.payoutType, { color: theme.colors.secondary }]}>
                        {payout.method === 'instant' ? '⚡ Instant Deposit' : 'Standard Payout'}
                      </Text>
                      <View style={[styles.statusBadge, { backgroundColor: getStatusColor(payout.status) + '20' }]}>
                        <Text style={[styles.statusText, { color: getStatusColor(payout.status) }]}>
                          {getStatusText(payout.status)}
                        </Text>
                      </View>
                    </View>
                    {parseDate(payout.date) && (
                      <Text style={[styles.payoutDate, { color: theme.colors.muted }]}>
                        {formatDate(payout.date)}{formatTime(payout.date) !== '—' ? ` at ${formatTime(payout.date)}` : ''}
                      </Text>
                    )}
                    {payout.arrivalDate && (
                      <Text style={[styles.arrivalDate, { color: '#10B981' }]}>
                        Arrived {formatDate(payout.arrivalDate)}
                      </Text>
                    )}
                  </View>
                  <Text style={[styles.payoutAmount, { color: '#10B981' }]}>
                    +${payout.amount.toFixed(2)}
                  </Text>
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1 
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
    flex: 1 
  },
  headerTitle: { 
    fontSize: 24, 
    fontWeight: 'bold', 
    marginBottom: 2 
  },
  headerSubtitle: { 
    fontSize: 14, 
    color: '#64748B' 
  },
  content: { 
    flex: 1, 
    paddingHorizontal: 16 
  },
  emptyCard: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    textAlign: 'center',
  },
  payoutsList: {
    gap: 12,
    paddingBottom: 24,
  },
  payoutCard: {
    padding: 16,
  },
  payoutHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  payoutInfo: {
    flex: 1,
    gap: 4,
  },
  payoutTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  payoutType: {
    fontSize: 16,
    fontWeight: '600',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  payoutDate: {
    fontSize: 14,
  },
  arrivalDate: {
    fontSize: 12,
    fontWeight: '500',
  },
  payoutAmount: {
    fontSize: 20,
    fontWeight: '700',
    marginLeft: 12,
  },
});
