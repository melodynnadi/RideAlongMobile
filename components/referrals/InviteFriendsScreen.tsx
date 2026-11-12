/**
 * Invite friends: the user's invite code/link for each program they can
 * invite to (rider invites rider, driver invites driver), the real reward
 * terms from the server, sharing, a QR code, and progress for friends and
 * the user's own rewards. Friends are shown by first name and last initial
 * only — never their contact, verification or payment details.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, RefreshControl, ScrollView, Share, StatusBar, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { SvgXml } from 'react-native-svg';
import Toast from 'react-native-toast-message';

import { useAppTheme } from '@/hooks/ThemeContext';
import { AppColors } from '@/constants/theme';
import {
  fetchInviteQr, fetchMoreFriends, fetchReferralSummary, formatCents, inviteMessage,
  type FriendItem, type ReferralProgram, type ReferralSummary, type RewardView,
} from '@/services/referrals';

// expo-clipboard is a native module: builds made before it was added don't
// have it, so fall back to the share sheet (which has its own Copy action).
let Clipboard: { setStringAsync(text: string): Promise<boolean> } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Clipboard = require('expo-clipboard');
} catch {
  Clipboard = null;
}

const STATUS_TONE: Record<string, 'green' | 'amber' | 'blue' | 'muted' | 'primary'> = {
  ready: 'green', earned: 'green', paid: 'green', used: 'muted',
  pending_payout: 'blue', in_review: 'blue', joined: 'blue',
  verification_needed: 'amber', qualifying_ride_needed: 'amber',
  expired: 'muted', revoked: 'muted',
};

export function InviteFriendsScreen({ role }: { role: ReferralProgram }) {
  const { colors } = useAppTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const [data, setData] = useState<ReferralSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [program, setProgram] = useState<ReferralProgram>(role);
  const [qr, setQr] = useState<Record<string, string>>({});
  const [qrOpen, setQrOpen] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const next = await fetchReferralSummary();
      setData(next);
      // Default to the program for the mode the user is in, if they can invite to it.
      setProgram((cur) => (next.invites.some((i) => i.program === cur) ? cur : next.invites[0]?.program ?? cur));
    } catch (e: any) {
      setError(e?.message || 'Couldn’t load your invites.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const back = () => {
    const to = typeof params.returnTo === 'string' && params.returnTo ? params.returnTo : `/(${role})/settings`;
    router.navigate(to as any);
  };

  const invite = data?.invites.find((i) => i.program === program) ?? null;

  const copy = async (text: string, what: string) => {
    if (Clipboard) {
      try {
        await Clipboard.setStringAsync(text);
        Toast.show({ type: 'success', text1: `${what} copied` });
        return;
      } catch { /* fall through to the share sheet */ }
    }
    await Share.share({ message: text }).catch(() => undefined);
  };
  const share = async () => {
    if (!invite) return;
    await Share.share({ message: inviteMessage(invite), url: invite.url }).catch(() => undefined);
  };
  const toggleQr = async () => {
    if (!invite) return;
    const open = !qrOpen;
    setQrOpen(open);
    if (open && !qr[invite.program]) {
      try {
        const svg = await fetchInviteQr(invite.program);
        setQr((q) => ({ ...q, [invite.program]: svg }));
      } catch {
        setQrOpen(false);
        Toast.show({ type: 'error', text1: 'Couldn’t load the QR code' });
      }
    }
  };
  const loadMore = async () => {
    if (!data?.friends.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchMoreFriends(data.friends.nextCursor);
      setData((d) => (d ? { ...d, friends: { items: [...d.friends.items, ...page.items], nextCursor: page.nextCursor } } : d));
    } catch {
      Toast.show({ type: 'error', text1: 'Couldn’t load more friends' });
    } finally {
      setLoadingMore(false);
    }
  };

  const Badge = ({ status, label }: { status: string; label: string }) => {
    const tone = STATUS_TONE[status] || 'muted';
    const bg = { green: colors.greenDim, amber: colors.amberDim, blue: colors.blueDim, muted: colors.border, primary: colors.primaryDim }[tone];
    const fg = { green: colors.green, amber: colors.amber, blue: colors.blue, muted: colors.textSecondary, primary: colors.primary }[tone];
    return <View style={[s.badge, { backgroundColor: bg }]}><Text style={[s.badgeText, { color: fg }]}>{label}</Text></View>;
  };

  const RewardRow = ({ r, title }: { r: RewardView; title: string }) => (
    <View style={s.row}>
      <View style={s.rowIcon}><Ionicons name={r.kind === 'driver_bonus' ? 'cash-outline' : 'pricetag-outline'} size={18} color={colors.primary} /></View>
      <View style={{ flex: 1 }}>
        <View style={s.rowTop}><Text style={s.rowTitle}>{title} · {formatCents(r.amountCents)}</Text><Badge status={r.status} label={r.label} /></View>
        <Text style={s.rowDetail}>{r.detail}</Text>
      </View>
    </View>
  );

  const FriendRow = ({ item }: { item: FriendItem }) => (
    <View style={s.row}>
      <View style={s.avatar}><Text style={s.avatarText}>{item.friend.name.slice(0, 1).toUpperCase()}</Text></View>
      <View style={{ flex: 1 }}>
        <View style={s.rowTop}><Text style={s.rowTitle}>{item.friend.name}</Text><Badge status={item.friend.status} label={item.friend.label} /></View>
        <Text style={s.rowDetail}>Friend: {item.friend.detail}</Text>
        {item.myReward ? <Text style={s.rowDetail}>You: {item.myReward.label} — {item.myReward.detail}</Text> : null}
      </View>
    </View>
  );

  const terms = invite?.terms;
  const amt = terms ? formatCents(terms.rewardCents) : '';
  const min = terms ? formatCents(terms.minQualifyingFareCents) : '';

  return (
    <View style={s.root}>
      <StatusBar barStyle={colors.statusBar} />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={back} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.title}>Invite friends</Text>
        </View>

        {!data && !error ? (
          <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
        ) : error && !data ? (
          <View style={s.center}>
            <Text style={s.muted}>{error}</Text>
            <TouchableOpacity style={s.secondaryBtn} onPress={() => void load()}><Text style={s.secondaryText}>Try again</Text></TouchableOpacity>
          </View>
        ) : data ? (
          <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
            {data.invites.length > 1 ? (
              <View style={s.segment}>
                {data.invites.map((i) => (
                  <TouchableOpacity key={i.program} style={[s.segmentBtn, program === i.program && s.segmentOn]} onPress={() => { setProgram(i.program); setQrOpen(false); }} accessibilityRole="button" accessibilityState={{ selected: program === i.program }}>
                    <Text style={[s.segmentText, program === i.program && s.segmentTextOn]}>{i.program === 'driver' ? 'Invite drivers' : 'Invite riders'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {!data.open ? (
              <View style={s.notice}><Ionicons name="pause-circle-outline" size={18} color={colors.amber} /><Text style={s.noticeText}>New invites are paused right now. Rewards already in progress still count.</Text></View>
            ) : null}

            {invite && terms ? (
              <View style={s.card}>
                <Text style={s.headline}>{invite.program === 'driver' ? `Earn ${amt} for each driver you bring` : `Give ${amt}, get ${amt}`}</Text>
                <Text style={s.body}>
                  {invite.program === 'driver'
                    ? `New drivers who join with your code earn ${amt} after their first trip with at least ${min} in passenger fares (within ${terms.qualifyDays} days). That unlocks your ${amt}, which you earn with your own next trip of ${min}+. Bonuses go to your payout account after a ${terms.holdHours}-hour review, once both of you are approved and student-verified.`
                    : `Friends who join with your code get ${amt} off a ride of ${min} or more once their student status is approved. When they complete a paid ride of ${min}+ within ${terms.qualifyDays} days, you get ${amt} off one of your rides of ${min}+, after a ${terms.holdHours}-hour check.`}
                  {` Up to ${terms.monthlyReferrerCap ?? 5} rewards a month. Codes work for new accounts only.`}
                </Text>

                <View style={s.codeBox}>
                  <Text style={s.codeLabel}>YOUR CODE</Text>
                  <Text style={s.code} selectable>{invite.code}</Text>
                  <Text style={s.link} selectable numberOfLines={1}>{invite.url}</Text>
                </View>

                <TouchableOpacity style={s.primaryBtn} onPress={() => void share()} accessibilityRole="button">
                  <Ionicons name="share-outline" size={18} color={colors.textInverse} /><Text style={s.primaryText}>Share invite</Text>
                </TouchableOpacity>
                <View style={s.btnRow}>
                  <TouchableOpacity style={s.secondaryBtn} onPress={() => void copy(invite.code, 'Code')} accessibilityRole="button"><Ionicons name="copy-outline" size={16} color={colors.textPrimary} /><Text style={s.secondaryText}>Copy code</Text></TouchableOpacity>
                  <TouchableOpacity style={s.secondaryBtn} onPress={() => void copy(invite.url, 'Link')} accessibilityRole="button"><Ionicons name="link-outline" size={16} color={colors.textPrimary} /><Text style={s.secondaryText}>Copy link</Text></TouchableOpacity>
                  <TouchableOpacity style={s.secondaryBtn} onPress={() => void toggleQr()} accessibilityRole="button"><Ionicons name="qr-code-outline" size={16} color={colors.textPrimary} /><Text style={s.secondaryText}>{qrOpen ? 'Hide QR' : 'QR code'}</Text></TouchableOpacity>
                </View>
                {qrOpen ? (
                  <View style={s.qrBox}>
                    {qr[invite.program] ? <SvgXml xml={qr[invite.program]} width={200} height={200} /> : <ActivityIndicator color={colors.primary} />}
                    <Text style={s.muted}>Friends can scan this with their phone camera.</Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={s.card}>
                <Text style={s.body}>
                  {role === 'driver'
                    ? 'You can invite other drivers once your driver application is approved.'
                    : 'Invites aren’t available on this account yet.'}
                </Text>
              </View>
            )}

            {data.myReferral?.reward ? (
              <>
                <Text style={s.section}>YOUR SIGN-UP REWARD</Text>
                <View style={s.card}><RewardRow r={data.myReferral.reward} title={data.myReferral.reward.kind === 'driver_bonus' ? 'New driver bonus' : 'Welcome discount'} /></View>
              </>
            ) : null}

            {data.rewards.length ? (
              <>
                <Text style={s.section}>YOUR INVITE REWARDS</Text>
                <View style={s.card}>{data.rewards.map((r) => <RewardRow key={r.id} r={r} title={r.kind === 'driver_bonus' ? 'Driver bonus' : 'Ride discount'} />)}</View>
              </>
            ) : null}

            <Text style={s.section}>FRIENDS YOU’VE INVITED</Text>
            <View style={s.card}>
              {data.friends.items.length
                ? data.friends.items.map((item) => <FriendRow key={item.key} item={item} />)
                : <Text style={s.muted}>No one has joined with your code yet.</Text>}
              {data.friends.nextCursor ? (
                <TouchableOpacity style={[s.secondaryBtn, { alignSelf: 'center', marginTop: 8 }]} onPress={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? <ActivityIndicator color={colors.primary} size="small" /> : <Text style={s.secondaryText}>Show more</Text>}
                </TouchableOpacity>
              ) : null}
            </View>
            <Text style={s.fine}>RideAlong pays for referral rewards — drivers always get their full fare. Bonuses are only shown as paid once they’ve been sent.</Text>
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
    backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bgCard, borderWidth: 1, borderColor: c.border },
    title: { color: c.textPrimary, fontSize: 22, fontWeight: '800' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
    content: { padding: 16, paddingBottom: 48, gap: 12 },
    segment: { flexDirection: 'row', backgroundColor: c.bgCard, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: c.border },
    segmentBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
    segmentOn: { backgroundColor: c.primary },
    segmentText: { color: c.textSecondary, fontSize: 13, fontWeight: '700' },
    segmentTextOn: { color: c.textInverse },
    notice: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: c.amberDim, borderRadius: 12, padding: 12 },
    noticeText: { flex: 1, color: c.textPrimary, fontSize: 13, lineHeight: 18 },
    card: { backgroundColor: c.bgCard, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 16, gap: 12 },
    headline: { color: c.textPrimary, fontSize: 20, fontWeight: '800' },
    body: { color: c.textSecondary, fontSize: 14, lineHeight: 20 },
    codeBox: { alignItems: 'center', paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: c.primaryBorder, backgroundColor: c.primaryDim, gap: 4 },
    codeLabel: { color: c.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
    code: { color: c.textPrimary, fontSize: 28, fontWeight: '800', letterSpacing: 4 },
    link: { color: c.textSecondary, fontSize: 12, maxWidth: '90%' },
    primaryBtn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: 12, backgroundColor: c.primary },
    primaryText: { color: c.textInverse, fontSize: 15, fontWeight: '800' },
    btnRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    secondaryBtn: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', minHeight: 40, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: c.borderMid, flexGrow: 1 },
    secondaryText: { color: c.textPrimary, fontSize: 13, fontWeight: '700' },
    qrBox: { alignItems: 'center', gap: 8, paddingVertical: 8, backgroundColor: '#FFFFFF', borderRadius: 12 },
    section: { color: c.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 1, marginTop: 8 },
    row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
    rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primaryDim },
    avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.blueDim },
    avatarText: { color: c.blue, fontWeight: '800' },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
    rowTitle: { color: c.textPrimary, fontSize: 14, fontWeight: '700', flexShrink: 1 },
    rowDetail: { color: c.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
    badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
    badgeText: { fontSize: 11, fontWeight: '800' },
    muted: { color: c.textSecondary, fontSize: 13, textAlign: 'center' },
    fine: { color: c.textTertiary, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 8 },
  });
}
