import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { fetchPayouts, type Payout } from '@/src/services/payouts';

import { useReturnNavigation } from '@/src/hooks/useReturnNavigation';
import { useAppTheme } from '@/hooks/ThemeContext';

export default function PayoutHistoryScreen() {
  const { colors } = useAppTheme();
  const { goBack } = useReturnNavigation('/(driver)/settings');
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [payouts, setPayouts]     = useState<Payout[]>([]);

  const s = useMemo(() => StyleSheet.create({
    root:    { flex: 1, backgroundColor: colors.bg },
    safe:    { flex: 1 },
    content: { paddingBottom: 60 },

    hdr:     { position: 'relative', minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 },
    backBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
    hdrTitle:{ color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25, flex: 1, marginLeft: 12 },

    lifetimeBanner: {
      marginHorizontal: 20,
      marginBottom: 28,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgCard,
      padding: 20,
      shadowColor: colors.textPrimary,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.06,
      shadowRadius: 10,
      elevation: 2,
    },
    lifetimeLabel:  { color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 6 },
    lifetimeAmount: { color: colors.primary, fontSize: 38, fontWeight: '300', letterSpacing: -1, marginBottom: 4 },
    lifetimeSub:    { color: colors.textSecondary, fontSize: 13 },

    loadingWrap:  { alignItems: 'center', paddingTop: 40 },

    emptyCard: {
      marginHorizontal: 20,
      borderRadius: 20,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.border,
      backgroundColor: colors.bgCard,
      padding: 32,
      alignItems: 'center',
    },
    emptyIcon:  { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 6 },
    emptyText:  { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 },

    monthGroup: { marginBottom: 24 },
    monthLabel: { marginHorizontal: 20, marginBottom: 10, color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
    monthCard: {
      marginHorizontal: 20,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgCard,
      overflow: 'hidden',
      shadowColor: colors.textPrimary,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.04,
      shadowRadius: 8,
      elevation: 1,
    },

    payRow:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
    payRowBorder:  { borderBottomWidth: 1, borderBottomColor: colors.border },
    payIcon:       { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    payIconDone:   { backgroundColor: colors.greenDim },
    payIconPending:{ backgroundColor: colors.primaryDim },
    payInfo:       { flex: 1 },
    payDate:       { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
    payBank:       { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    payAmount:     { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
    payAmountPending: { color: colors.primary },
  }), [colors]);

  const loadPayouts = async () => {
    try {
      const result = await fetchPayouts(50);
      setPayouts(result.payouts);
    } catch (e) {
      console.error('[PayoutHistory] Failed to load payouts:', e);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPayouts();
    setRefreshing(false);
  };

  useEffect(() => { loadPayouts().finally(() => setLoading(false)); }, []);

  const parseDate = (raw: any): Date | null => {
    if (raw === null || raw === undefined) return null;
    let num: number | null = null;
    if (typeof raw === 'number') num = raw;
    else if (typeof raw === 'string' && /^\d+$/.test(raw)) num = Number(raw);
    if (num !== null) {
      if (num < 1e12) num = num * 1000;
      return new Date(num);
    }
    try {
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    } catch { return null; }
  };

  const formatDateShort = (raw: any): string => {
    const d = parseDate(raw);
    if (!d) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getMonthKey = (raw: any): string => {
    const d = parseDate(raw);
    if (!d) return 'Unknown';
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
  };

  const lifetimeEarned = payouts.reduce((sum, p) => sum + (p.amount || 0), 0);
  const totalRides     = payouts.length;
  const avgPerRide     = totalRides > 0 ? lifetimeEarned / totalRides : 0;

  const firstPayoutDate = payouts.length > 0 ? parseDate(payouts[payouts.length - 1]?.date) : null;
  const sinceLabel      = firstPayoutDate
    ? firstPayoutDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null;

  // Group payouts by month
  const grouped: { month: string; items: Payout[] }[] = [];
  payouts.forEach((p) => {
    const monthKey = getMonthKey(p.date);
    const existing = grouped.find((g) => g.month === monthKey);
    if (existing) existing.items.push(p);
    else grouped.push({ month: monthKey, items: [p] });
  });

  const isPending  = (status: string) => status === 'pending' || status === 'in_transit';
  return (
    <View style={s.root}>
      <StatusBar barStyle={colors.statusBar} />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>

        {/* Header */}<ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
<View style={s.hdr}>
          <TouchableOpacity
            style={s.backBtn}
            onPress={goBack}
          >
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.hdrTitle}>Payouts</Text>
          <View style={{ width: 40 }} />
        </View>
          {/* Lifetime banner */}
          <View style={s.lifetimeBanner}>
            <Text style={s.lifetimeLabel}>LIFETIME EARNED</Text>
            <Text style={s.lifetimeAmount}>${lifetimeEarned.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
            {sinceLabel && (
              <Text style={s.lifetimeSub}>
                Since {sinceLabel} · {totalRides} rides · avg ${avgPerRide.toFixed(2)}
              </Text>
            )}
          </View>

          {loading ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : payouts.length === 0 ? (
            <View style={s.emptyCard}>
              <View style={s.emptyIcon}>
                <Ionicons name="wallet-outline" size={26} color={colors.primary} />
              </View>
              <Text style={s.emptyTitle}>No payouts yet</Text>
              <Text style={s.emptyText}>Your completed payouts will appear here.</Text>
            </View>
          ) : (
            grouped.map(({ month, items }) => (
              <View key={month} style={s.monthGroup}>
                <Text style={s.monthLabel}>{month}</Text>
                <View style={s.monthCard}>
                  {items.map((payout, idx) => {
                    const pending  = isPending(payout.status);
                    const dateStr  = formatDateShort(payout.date);
                    const amountStr = `$${payout.amount.toFixed(2)}`;
                    const isLast   = idx === items.length - 1;
                    return (
                      <View key={payout.id} style={[s.payRow, !isLast && s.payRowBorder]}>
                        <View style={[s.payIcon, pending ? s.payIconPending : s.payIconDone]}>
                          <Ionicons
                            name={pending ? 'time-outline' : 'checkmark'}
                            size={14}
                            color={pending ? colors.primary : colors.green}
                          />
                        </View>
                        <View style={s.payInfo}>
                          <Text style={s.payDate}>{dateStr}</Text>
                          {payout.bankLast4 ? (
                            <Text style={s.payBank}>Chase ●● {payout.bankLast4}</Text>
                          ) : null}
                        </View>
                        <Text style={[s.payAmount, pending && s.payAmountPending]}>
                          {amountStr}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
