import 'react-native-get-random-values';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Share,
  ActivityIndicator,     // ← ADD
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '@/hooks/ThemeContext';
import { AppColors, BRAND } from '@/constants/theme';
import { router } from 'expo-router';
import { firestore, firebaseAuth, getApiBaseUrl } from '@/constants/services';
import { addDoc, collection, serverTimestamp, doc, getDoc, query, where, getDocs } from 'firebase/firestore';
import { GOOGLE_MAPS_API_KEY } from '@/constants/services';
import * as Location from 'expo-location';
import { computeMaxPrice } from '@/src/utils/pricing';
import EmailTriggerService from '@/services/EmailTriggerService';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';

type Coords = { lat: number; lng: number };
type Suggestion = { description: string; place_id: string; mainText: string; secondaryText: string };

function newToken() {
  return 'tok_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function AddressAutocomplete({
  label,
  placeholder,
  value,
  onChangeText,
  onSelected,
  apiKey,
  country = 'us',
  zIndex = 50,
  onlyCities = false,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (t: string) => void;
  onSelected: (p: { address: string; coords: Coords }) => void;
  apiKey: string;
  country?: string;
  zIndex?: number;
  onlyCities?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [timer, setTimer] = useState<any>(null);
  const justSelected = useRef(false);
  const token = useMemo(() => newToken(), []);

  const fetchAuto = async (q: string) => {
    if (!q || q.trim().length < 2) {
      setItems([]);
      return;
    }
    try {
      setLoading(true);
      const typeParam = onlyCities ? '&types=(cities)' : '';
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&key=${apiKey}&components=country:${country}${typeParam}&sessiontoken=${token}`;
      const res = await fetch(url);
      const json = await res.json();
      setItems((json?.predictions || []).map((p: any) => ({
        description: p.description,
        place_id: p.place_id,
        mainText: p.structured_formatting?.main_text || p.description,
        secondaryText: p.structured_formatting?.secondary_text || '',
      })));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchDetails = async (place_id: string) => {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&fields=name,formatted_address,geometry&key=${apiKey}&sessiontoken=${token}`;
    const res = await fetch(url);
    const json = await res.json();
    const name = json?.result?.name || '';
    const fmtAddr = json?.result?.formatted_address || value;
    // Prepend place name for named establishments (e.g. "Walmart Supercenter")
    const addr = (name && fmtAddr && !fmtAddr.startsWith(name)) ? `${name}, ${fmtAddr}` : fmtAddr;
    const loc = json?.result?.geometry?.location;
    if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
      onSelected({ address: addr, coords: { lat: loc.lat, lng: loc.lng } });
    } else {
      onSelected({ address: addr, coords: { lat: 0, lng: 0 } });
    }
  };

  return (
    <View style={[styles.autoWrap, { zIndex }]}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        value={value}
        onFocus={() => setOpen(true)}
        onChangeText={(t) => {
          if (justSelected.current) { justSelected.current = false; return; }
          onChangeText(t);
          setOpen(true);
          if (timer) clearTimeout(timer);
          const id = setTimeout(() => fetchAuto(t), 220);
          setTimer(id);
        }}
      />
      {open && (items.length > 0 || loading) && (
        <View style={styles.autoPanel}>
          {loading ? (
            <View style={styles.autoEmpty}><Text style={styles.placesEmptyText}>Searching...</Text></View>
          ) : (
            items.slice(0, 10).map((s, idx) => (
              <TouchableOpacity
                key={`${s.place_id}-${idx}`}
                style={styles.autoItem}
                onPress={async () => {
                  setOpen(false);
                  setItems([]);
                  justSelected.current = true;
                  await fetchDetails(s.place_id);
                  setTimeout(() => Keyboard.dismiss(), 50);
                }}
              >
                <View style={styles.autoItemRow}>
                  <Text style={styles.autoMainText} numberOfLines={1}>{s.mainText}</Text>
                  {s.secondaryText ? <Text style={styles.autoSecondaryText} numberOfLines={1}>{s.secondaryText}</Text> : null}
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
      )}
    </View>
  );
}

function pad2(n: number) { return String(n).padStart(2, '0'); }

function toYMD(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number) {
  const nd = new Date(d);
  nd.setMonth(nd.getMonth() + n);
  return nd;
}

function getMonthMatrix(d: Date) {
  const start = startOfMonth(d);
  const firstDay = start.getDay(); // 0 Sun .. 6 Sat
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const weeks: Array<Array<Date | null>> = [];
  let current = 1 - firstDay; // begin from previous month fillers
  for (let w = 0; w < 6; w++) {
    const row: Array<Date | null> = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(d.getFullYear(), d.getMonth(), current);
      if (current < 1 || current > daysInMonth) {
        row.push(null);
      } else {
        row.push(day);
      }
      current++;
    }
    weeks.push(row);
  }
  return weeks;
}

function CalendarModal({ visible, month, selectedDate, primaryColor, secondaryColor, onClose, onSelect }: {
  visible: boolean;
  month: Date;
  selectedDate?: string;
  primaryColor: string;
  secondaryColor: string;
  onClose: () => void;
  onSelect: (dateStr: string) => void;
}) {
  const [m, setM] = useState<Date>(month);
  useEffect(() => setM(month), [month]);
  const weeks = useMemo(() => getMonthMatrix(m), [m]);
  const monthLabel = m.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const todayStr = toYMD(new Date());
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.calendarCard}>
          <View style={styles.calendarHeader}>
            <TouchableOpacity onPress={() => setM(addMonths(m, -1))} style={[styles.navBtn, { borderColor: primaryColor }]}><Text style={[styles.navBtnText, { color: primaryColor }]}>{'<'}</Text></TouchableOpacity>
            <Text style={[styles.monthTitle, { color: secondaryColor }]}>{monthLabel}</Text>
            <TouchableOpacity onPress={() => setM(addMonths(m, 1))} style={[styles.navBtn, { borderColor: primaryColor }]}><Text style={[styles.navBtnText, { color: primaryColor }]}>{'>'}</Text></TouchableOpacity>
          </View>
          <View style={styles.weekdaysRow}>
            {weekdays.map((w) => (
              <Text key={w} style={styles.weekday}>{w}</Text>
            ))}
          </View>
          {weeks.map((row, ridx) => (
            <View key={ridx} style={styles.daysRow}>
              {row.map((d, cidx) => {
                const isEmpty = !d;
                const label = d ? String(d.getDate()) : '';
                const dStr = d ? toYMD(d) : '';
                const isSelected = !!d && selectedDate === dStr;
                const isToday = !!d && todayStr === dStr;
                return (
                  <TouchableOpacity
                    key={`${ridx}-${cidx}`}
                    disabled={isEmpty}
                    style={[
                      styles.dayCell,
                      isEmpty && { opacity: 0.25 },
                      isSelected && { backgroundColor: primaryColor },
                      !isSelected && isToday && { borderWidth: 1.5, borderColor: primaryColor, backgroundColor: '#FFF7ED' },
                    ]}
                    onPress={() => { if (d) { onSelect(toYMD(d)); onClose(); } }}
                  >
                    <Text style={[
                      styles.dayText,
                      isSelected && { color: '#FFFFFF', fontWeight: '800' },
                      !isSelected && isToday && { color: '#1F2937', fontWeight: '800' },
                    ]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}><Text style={[styles.closeBtnText, { color: primaryColor }]}>Close</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function TimeModal({ visible, initialTime, primaryColor, secondaryColor, onClose, onSelect }: {
  visible: boolean;
  initialTime?: string;
  primaryColor: string;
  secondaryColor: string;
  onClose: () => void;
  onSelect: (timeStr: string) => void;
}) {
  // Parse an input like "9", "9:30", "9am", "9:30 PM", or "21:15" to 12h state
  const parseTo12h = (s?: string): { h12: number; m: number; ampm: 'AM' | 'PM' } => {
    const now = new Date();
    const round30 = (n: number) => Math.round(n / 30) * 30;
    if (!s) {
      let h24 = now.getHours();
      let m = round30(now.getMinutes());
      // Handle minute overflow
      if (m >= 60) {
        m = 0;
        h24 = (h24 + 1) % 24;
      }
      const ampm: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM';
      let h12 = h24 % 12;
      if (h12 === 0) h12 = 12;
      return { h12, m, ampm };
    }
    let str = s.trim().toLowerCase();
    const hasAM = /am?$/.test(str);
    const hasPM = /pm?$/.test(str);
    str = str.replace(/\s/g, '').replace(/(am|pm|a|p)$/,'');
    let h = 0, m = 0;
    if (str.includes(':') || str.includes('.')) {
      const parts = str.split(/[:.]/);
      h = parseInt(parts[0] || '0', 10) || 0;
      m = parseInt(parts[1] || '0', 10) || 0;
    } else if (str.length <= 2) {
      h = parseInt(str || '0', 10) || 0;
      m = 0;
    } else {
      h = parseInt(str.slice(0, -2) || '0', 10) || 0;
      m = parseInt(str.slice(-2) || '0', 10) || 0;
    }
    if (hasPM && h < 12) h += 12;
    if (hasAM && h === 12) h = 0;
    // Clamp and round to nearest 30
    h = Math.max(0, Math.min(23, h));
    m = Math.max(0, Math.min(59, m));
    m = round30(m);
    // Handle minute overflow
    if (m >= 60) {
      m = 0;
      h = (h + 1) % 24;
    }
  const ampm: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
    let h12 = h % 12; if (h12 === 0) h12 = 12;
    return { h12, m, ampm };
  };
  const init = parseTo12h(initialTime);
  const [hour, setHour] = useState<number>(init.h12);
  const [minute, setMinute] = useState<number>(init.m);
  const [ampm, setAmPm] = useState<'AM'|'PM'>(init.ampm === 'AM' ? 'AM' : 'PM');
  useEffect(() => {
    const p = parseTo12h(initialTime);
    setHour(p.h12);
    setMinute(p.m);
  setAmPm(p.ampm === 'AM' ? 'AM' : 'PM');
  }, [initialTime, visible]);
  const hours = Array.from({ length: 12 }, (_, i) => i + 1);
  // digital clock steppers will adjust minutes by 30
  const incHour = () => setHour((h) => (h % 12) + 1);
  const decHour = () => setHour((h) => (h === 1 ? 12 : h - 1));
  const incMinute = () => setMinute((m) => {
    const nm = (m + 30) % 60;
    if (nm < m) setHour((h) => (h % 12) + 1);
    return nm;
  });
  const decMinute = () => setMinute((m) => {
    const nm = (m + 30) % 60; // +30 with wrap (0->30, 30->0)
    if (m === 0) setHour((h) => (h === 1 ? 12 : h - 1));
    return nm;
  });
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.timeCard}>
          <Text style={[styles.monthTitle, { color: secondaryColor, marginBottom: 8 }]}>Select Time</Text>
          <View style={styles.clockRow}>
            <View style={styles.stepperCol}>
              <TouchableOpacity onPress={incHour} style={[styles.stepBtn, { borderColor: primaryColor }]}><Text style={[styles.stepBtnText, { color: primaryColor }]}>+</Text></TouchableOpacity>
              <TouchableOpacity onPress={decHour} style={[styles.stepBtn, { borderColor: primaryColor }]}><Text style={[styles.stepBtnText, { color: primaryColor }]}>-</Text></TouchableOpacity>
            </View>
            <View style={styles.clockDisplay}>
              <Text style={[styles.clockText, { color: secondaryColor }]}>{hour}</Text>
              <Text style={[styles.clockText, { color: secondaryColor }]}>:</Text>
              <Text style={[styles.clockText, { color: secondaryColor }]}>{pad2(minute)}</Text>
              <TouchableOpacity onPress={() => setAmPm(ampm === 'AM' ? 'PM' : 'AM')} style={[styles.ampmPill, { borderColor: primaryColor, backgroundColor: '#FFF7ED' }]}>
                <Text style={[styles.ampmText, { color: primaryColor }]}>{ampm}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.stepperCol}>
              <TouchableOpacity onPress={incMinute} style={[styles.stepBtn, { borderColor: primaryColor }]}><Text style={[styles.stepBtnText, { color: primaryColor }]}>+</Text></TouchableOpacity>
              <TouchableOpacity onPress={decMinute} style={[styles.stepBtn, { borderColor: primaryColor }]}><Text style={[styles.stepBtnText, { color: primaryColor }]}>-</Text></TouchableOpacity>
            </View>
          </View>
          <View style={[styles.timeWrap, { justifyContent: 'center' }]}> 
            {(['AM','PM'] as const).map(x => (
              <TouchableOpacity key={x} style={[styles.timeChip, ampm===x && [styles.timeChipActive, { backgroundColor: primaryColor }]]} onPress={() => setAmPm(x)}>
                <Text style={[styles.timeChipText, ampm===x && { color: '#FFFFFF', fontWeight: '800' }]}>{x}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.timeFooter}>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}><Text style={[styles.closeBtnText, { color: secondaryColor }]}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => { onSelect(`${hour}:${pad2(minute)} ${ampm}`); onClose(); }} style={[styles.confirmBtn, { backgroundColor: primaryColor }]}>
              <Text style={styles.confirmBtnText}>Set</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SeatsModal({ visible, selected, primaryColor, onClose, onSelect }: {
  visible: boolean;
  selected: 1 | 2;
  primaryColor: string;
  onClose: () => void;
  onSelect: (s: 1 | 2) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.calendarCard}>
          <Text style={[styles.monthTitle, { marginBottom: 8 }]}>Select seats</Text>
          {[1, 2].map((s) => (
            <TouchableOpacity key={s} onPress={() => { onSelect(s as 1 | 2); onClose(); }} style={[styles.suggestionItem, { borderBottomColor: '#F3F4F6' }]}> 
              <Text style={[styles.suggestionText, { color: selected === s ? primaryColor : '#1F2937' }]}>{s} seat{s === 1 ? '' : 's'}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}><Text style={[styles.closeBtnText, { color: primaryColor }]}>Close</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default function BookScreen() {
  const { colors, isDark } = useAppTheme();
  const themed = createStyles(colors, isDark);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
    if (!date) return new Date();
    const parts = date.split('-');
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10) - 1, d = parseInt(parts[2], 10);
      const dt = new Date(y, m, d);
      if (!isNaN(dt.getTime())) return dt;
    }
    return new Date();
  });
  const [timeOpen, setTimeOpen] = useState(false);
  const [pickupLocation, setPickupLocation] = useState('');
  const [dropoffLocation, setDropoffLocation] = useState('');
  const [contribution, setContribution] = useState('');
  // seats limited to 1 or 2
  const [seats, setSeats] = useState<1 | 2>(1);
  const [maxPrice, setMaxPrice] = useState<number>(0);
  const [showCapBanner, setShowCapBanner] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showDateSug, setShowDateSug] = useState(false);
  const [showTimeSug, setShowTimeSug] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [distanceText, setDistanceText] = useState<string>('--');
  const [durationText, setDurationText] = useState<string>('--');
  const [calcLoading, setCalcLoading] = useState<boolean>(false);
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);

  const to24h = (t: string): string => {
    // Convert 'h:mm AM/PM' or 'h:mmAM' to 'HH:mm'
    const trimmed = t.trim();
    const m = /^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)$/i.exec(trimmed);
    if (m) {
      let h = parseInt(m[1], 10);
      const mm = Math.max(0, Math.min(59, parseInt(m[2] || '0', 10)));
      const ampm = m[3].toLowerCase();
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      const result = `${pad2(h)}:${pad2(mm)}`;
      console.log(`[to24h] Converted "${t}" to "${result}"`);
      return result;
    }
    // If already 24h 'HH:mm'
    const m2 = /^(\d{1,2}):(\d{1,2})$/.exec(trimmed);
    if (m2) {
      const h = Math.max(0, Math.min(23, parseInt(m2[1], 10)));
      const mm = Math.max(0, Math.min(59, parseInt(m2[2], 10)));
      return `${pad2(h)}:${pad2(mm)}`;
    }
    console.log(`[to24h] No match for "${t}", returning as-is`);
    return t; // fallback
  };

  const toRequestedDate = (d?: string, t?: string): Date | null => {
    try {
      if (!d && !t) return null;
      if (d && t) {
        const t24 = /am|pm/i.test(t) ? to24h(t) : t;
        console.log(`[toRequestedDate] date="${d}", time="${t}", t24="${t24}"`);
        // Parse date components to avoid timezone issues
        const [year, month, day] = d.split('-').map(n => parseInt(n, 10));
        const [hours, minutes] = t24.split(':').map(n => parseInt(n, 10));
        console.log(`[toRequestedDate] Parsed: year=${year}, month=${month}, day=${day}, hours=${hours}, minutes=${minutes}`);
        // Use local timezone explicitly to avoid UTC conversion
        const dt = new Date(year, month - 1, day, hours, minutes || 0);
        console.log(`[toRequestedDate] Created Date: ${dt.toString()}`);
        return isNaN(dt.getTime()) ? null : dt;
      }
      if (d) {
        const [year, month, day] = d.split('-').map(n => parseInt(n, 10));
        const dt = new Date(year, month - 1, day);
        return isNaN(dt.getTime()) ? null : dt;
      }
      if (t) {
        const dt = new Date(t);
        return isNaN(dt.getTime()) ? null : dt;
      }
      return null;
    } catch {
      return null;
    }
  };

  const handleSubmit = async () => {
    try {
      const user = firebaseAuth.currentUser;
      if (!user) {
        Alert.alert('Sign in required', 'Please sign in to offer a ride.');
        router.push('/(auth)/sign-in');
        return;
      }

      // Check student verification status before allowing post
      // Only block if BOTH not verified AND past deadline (matching server logic)
      try {
        const userDoc = await getDoc(doc(firestore, 'drivers', user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          const isVerified = data?.isVerified === true;
          const verificationDeadline = data?.verificationDeadline;
          const isPastDeadline = verificationDeadline 
            ? new Date() > (typeof verificationDeadline?.toDate === 'function' ? verificationDeadline.toDate() : new Date(verificationDeadline))
            : false;
          
          // Only block if not verified AND past deadline
          if (!isVerified && isPastDeadline) {
            Alert.alert(
              'Verification Deadline Passed',
              'Your verification deadline has passed. Please verify your student status immediately to post rides.',
              [
                { text: 'Cancel', style: 'cancel' },
                { 
                  text: 'Verify Now', 
                  onPress: async () => {
                    try {
                      const token = await firebaseAuth.currentUser?.getIdToken();
                      if (token) {
                        const url = `https://ridealongapp.com/pages/driver-login?token=${encodeURIComponent(token)}`;
                        const { Linking } = require('react-native');
                        await Linking.openURL(url);
                      }
                    } catch (e) {
                      console.warn('handleVerifyStudent error', e);
                    }
                  },
                  style: 'default'
                },
              ]
            );
            return;
          }
        }
      } catch (e) {
        console.warn('verification check error', e);
      }

      // Basic validation
      if (!pickupLocation.trim() || !dropoffLocation.trim()) {
        Alert.alert('Missing info', 'Please enter both pickup and dropoff locations.');
        return;
      }

      if (!pickupCoords || !dropoffCoords) {
        Alert.alert(
          'Select locations',
          'Please choose pickup and dropoff from the suggestions so we can place your ride on the map.'
        );
        return;
      }

      setSubmitting(true);

      // Parse contribution (price per seat)
      const priceNum = (() => {
        const n = Number(String(contribution).replace(/[^0-9.\-]/g, ''));
        return isNaN(n) ? null : n;
      })();

  // Seats already constrained to 1 or 2
  const seatsNum: 1 | 2 = seats >= 2 ? 2 : 1;

      if (priceNum == null || priceNum <= 0) {
        Alert.alert('Invalid price', 'Please enter a valid price per seat.');
        return;
      }

      if (seatsNum == null || seatsNum <= 0 || seatsNum > 2) {
        Alert.alert('Invalid seats', 'Available seats must be 1 or 2.');
        return;
      }

      // Enforce max price cap based on distance & seats
      const dist = typeof distanceMiles === 'number' ? distanceMiles : 0;
      const cap = computeMaxPrice(dist, seatsNum);
      if (priceNum > cap) {
        Alert.alert('Price exceeds maximum', `The maximum for ${seatsNum} seat(s) is $${cap.toFixed(2)} based on ${dist ? dist.toFixed(1) : '--'} mi.`);
        return;
      }

  // No maximum cap enforcement; only suggest minimum.

      const requestedTime = toRequestedDate(date || undefined, time || undefined);

      // Map to ridePostings schema for drivers
      const payload: any = {
        driverId: user.uid,
        driverEmail: user.email || null,
        // Ride type: intracity (<25mi) or intercity (>=25mi)
        rideType: dist > 0 && dist < 25 ? 'intracity' : 'intercity',
        // Store both address fields and plain strings for compatibility
        pickup: pickupLocation || null,
        dropoff: dropoffLocation || null,
        pickupAddress: pickupLocation || null,
        dropoffAddress: dropoffLocation || null,

        pickupLocation: pickupCoords
          ? {
              address: pickupLocation || null,
              latitude: pickupCoords.lat,
              longitude: pickupCoords.lng,
              lat: pickupCoords.lat,
              lng: pickupCoords.lng,
            }
          : null,

        dropoffLocation: dropoffCoords
          ? {
              address: dropoffLocation || null,
              latitude: dropoffCoords.lat,
              longitude: dropoffCoords.lng,
              lat: dropoffCoords.lat,
              lng: dropoffCoords.lng,
            }
          : null,

        pickupCoords: pickupCoords || null,
        dropoffCoords: dropoffCoords || null,
        pickupLat: pickupCoords?.lat ?? null,
        pickupLng: pickupCoords?.lng ?? null,
        dropoffLat: dropoffCoords?.lat ?? null,
        dropoffLng: dropoffCoords?.lng ?? null,
        date: date || null,
        time: time || null,
        departureTime: requestedTime || null,
        availableSeats: seatsNum,
        pricePerSeat: priceNum,
        postType: 'ride_offer',
        // Legacy fallbacks some lists use
        contributionAmount: priceNum,
        estimatedFare: null,
        notes: notes || null,
        rideVibe: selectedVibes,
        preferences: selectedVibes,
        // Include distance/duration details if available
        distance: (distanceText || distanceMiles != null) ? {
          text: distanceText || null,
          miles: distanceMiles != null ? Number(distanceMiles.toFixed(3)) : null,
          meters: distanceMiles != null ? Math.round(distanceMiles * 1609.34) : null,
        } : null,
        duration: (durationText || durationMinutes != null) ? {
          text: durationText || null,
          minutes: durationMinutes != null ? Number(durationMinutes.toFixed(3)) : null,
          seconds: durationMinutes != null ? Math.round((durationMinutes || 0) * 60) : null,
        } : null,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        timestamp: serverTimestamp(),
      };

      // Replace undefined with null to avoid Firestore issues
      Object.keys(payload).forEach((k) => {
        if (payload[k] === undefined) payload[k] = null;
      });

      // Call backend API to create ride posting and trigger preferred route notifications
      const apiUrl = getApiBaseUrl();
      console.log('Creating ride posting via API:', `${apiUrl}/api/ride-postings`);
      
      try {
        const response = await fetch(`${apiUrl}/api/ride-postings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        const result = await response.json();
        
        if (!response.ok) {
          throw new Error(result.message || result.error || 'Failed to create ride posting');
        }

        console.log('Ride posting created with preferred route notifications:', result);

        // Send ride posted email
        try {
          const user = firebaseAuth.currentUser;
          if (user && user.email) {
            await EmailTriggerService.sendRidePostedEmail(
              user.email,
              user.displayName || 'Driver',
              {
                pickup: pickupLocation,
                dropoff: dropoffLocation,
                date: date,
                time: time,
                price: contribution,
              }
            );
          }
        } catch (emailErr) {
          console.warn('[postRide] Email send error:', emailErr);
        }

        // Clear the form
        setDate('');
        setTime('');
        setPickupLocation('');
        setDropoffLocation('');
        setContribution('');
        setSeats(1);
        setNotes('');

        Alert.alert('Ride Posted!', 'Your ride is now visible to riders.');
        router.push('/driver' as any);
      } catch (apiError: any) {
        console.error('Ride posting API error:', apiError);
        
        // Fallback: Create directly in Firestore if API fails
        console.log('Attempting fallback: Creating ride posting directly in Firestore');
        const fallbackRef = await addDoc(collection(firestore, 'ridePostings'), payload);
        const fallbackRideId = fallbackRef.id;

        // Auto-save preferred route (fallback path)
        try {
          const pickup = (pickupLocation || '').trim().toLowerCase().replace(/\s+/g, ' ');
          const dropoff = (dropoffLocation || '').trim().toLowerCase().replace(/\s+/g, ' ');
          if (pickup && dropoff) {
            const routeQuery = query(
              collection(firestore, 'preferredRoutes'),
              where('userId', '==', user.uid),
              where('origin', '==', pickup),
              where('destination', '==', dropoff)
            );
            const routeSnap = await getDocs(routeQuery);
            if (routeSnap.empty) {
              await addDoc(collection(firestore, 'preferredRoutes'), {
                userId: user.uid,
                userType: 'driver',
                origin: pickup,
                destination: dropoff,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
              console.log('Auto-saved preferred route for driver (fallback)');
            }
          }
        } catch (routeErr) {
          console.warn('Failed to auto-save preferred route:', routeErr);
        }

        // Send ride posted email (fallback path)
        try {
          const user = firebaseAuth.currentUser;
          if (user && user.email) {
            await EmailTriggerService.sendRidePostedEmail(
              user.email,
              user.displayName || 'Driver',
              {
                pickup: pickupLocation,
                dropoff: dropoffLocation,
                date: date,
                time: time,
                price: contribution,
              }
            );
          }
        } catch (emailErr) {
          console.warn('[postRide] Email send error:', emailErr);
        }

        // Clear the form
        setDate('');
        setTime('');
        setPickupLocation('');
        setDropoffLocation('');
        setContribution('');
        setSeats(1);
        setNotes('');

        Alert.alert('Ride Posted!', 'Your ride is now visible to riders.');
        router.push('/driver' as any);
      }
    } catch (e) {
  console.warn('ride posting submit error', e);
  Alert.alert('Submit failed', 'Could not post your ride. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // 12-hour parsing handled by modal; text input kept simple.

  const swapLocations = () => {
  const prevPickup = pickupLocation;
  const prevPickupCoords = pickupCoords;
  setPickupLocation(dropoffLocation);
  setDropoffLocation(prevPickup);
  setPickupCoords(dropoffCoords);
  setDropoffCoords(prevPickupCoords || null);
  };

  const useCurrentLocation = async () => {
    try {
      setLocLoading(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Location permission is needed to use your current location.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const results = await Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
  const r = results?.[0];
  const address = r ? [r.name, r.street, r.city, r.region].filter(Boolean).join(', ') : 'Current location';
  setPickupLocation(address);
  setPickupCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch (e) {
      Alert.alert('Location error', 'Could not get your location. Please try again.');
    } finally {
      setLocLoading(false);
    }
  };

  // Distance/Duration calculation using Google Distance Matrix API
  useEffect(() => {
    let timer: any;
    const fetchDistance = async () => {
      if (!pickupCoords || !dropoffCoords) return;
      try {
        setCalcLoading(true);
        const origins = `${pickupCoords.lat},${pickupCoords.lng}`;
        const destinations = `${dropoffCoords.lat},${dropoffCoords.lng}`;
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?units=imperial&origins=${encodeURIComponent(origins)}&destinations=${encodeURIComponent(destinations)}&key=${GOOGLE_MAPS_API_KEY}`;
        const res = await fetch(url);
        const json = await res.json();
        const element = json?.rows?.[0]?.elements?.[0];
        const distance = element?.distance?.text ?? null;
        const duration = element?.duration?.text ?? null;
        const distanceMeters = element?.distance?.value ?? null; // in meters
        const durationSeconds = element?.duration?.value ?? null; // in seconds
        if (distance && duration) {
          setDistanceText(distance);
          setDurationText(duration);
          // also set numeric forms
          const miles = distanceMeters != null ? distanceMeters / 1609.34 : null;
          const minutes = durationSeconds != null ? durationSeconds / 60 : null;
          setDistanceMiles(miles);
          setDurationMinutes(minutes);
          // no suggested minimum
        } else {
          setDistanceText('--');
          setDurationText('--');
          setDistanceMiles(null);
          setDurationMinutes(null);
        }
      } catch {
        setDistanceText('--');
        setDurationText('--');
      } finally {
        setCalcLoading(false);
      }
    };
    // Debounce slightly to avoid spamming
    timer = setTimeout(fetchDistance, 250);
    return () => clearTimeout(timer);
  }, [pickupCoords, dropoffCoords]);

  // Recompute max price when seats or distance change
  useEffect(() => {
    const dist = typeof distanceMiles === 'number' ? distanceMiles : 0;
    const s: 1 | 2 = seats >= 2 ? 2 : 1;
    const cap = computeMaxPrice(dist, s);
    setMaxPrice(cap);
    // Clamp price if above cap
    const priceNum = Number(String(contribution).replace(/[^0-9.\-]/g, ''));
    if (!isNaN(priceNum) && priceNum > cap) {
      setContribution(cap.toFixed(2));
      setShowCapBanner(`Price capped at $${cap.toFixed(2)} for ${s} seat(s).`);
      setTimeout(() => setShowCapBanner(null), 2500);
    }
  }, [seats, distanceMiles]);

  // Clamp on contribution changes (prevent above max)
  useEffect(() => {
    const cap = maxPrice || 0;
    const priceNum = Number(String(contribution).replace(/[^0-9.\-]/g, ''));
    if (!isNaN(priceNum) && cap > 0 && priceNum > cap) {
      setContribution(cap.toFixed(2));
      setShowCapBanner(`Price capped at $${cap.toFixed(2)}.`);
      setTimeout(() => setShowCapBanner(null), 2200);
    }
  }, [contribution, maxPrice]);

  const isFormValid = pickupLocation.trim() && dropoffLocation.trim() && 
    Number(contribution) > 0 && seats > 0 &&
    !(maxPrice > 0 && Number(contribution) > maxPrice);

  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);

  // ── Smart pricing computed ────────────────────────────────────────────────
  const priceNum = Number(String(contribution).replace(/[^0-9.]/g, '')) || 0;
  const totalEarnings = priceNum > 0 ? (priceNum * seats).toFixed(2) : null;
  const uberEstimate = distanceMiles && distanceMiles > 0
    ? (distanceMiles * 2.1 + 2.5).toFixed(2) : null;
  const riderSavings = uberEstimate && priceNum > 0
    ? Math.max(0, Number(uberEstimate) - priceNum).toFixed(2) : null;
  const suggestedMin = distanceMiles && distanceMiles > 0
    ? Math.max(3, Math.round(distanceMiles * 0.7)) : 5;
  const suggestedMax = distanceMiles && distanceMiles > 0
    ? Math.max(7, Math.round(distanceMiles * 1.1)) : 9;
  const routeIsReady = !!(pickupLocation && dropoffLocation && pickupCoords && dropoffCoords);
  const grossEarnings = priceNum > 0 ? priceNum * seats : 0;
  const platformFee = grossEarnings * 0.08;
  const netEarnings = Math.max(0, grossEarnings - platformFee);
  const suggestedText = distanceMiles && distanceMiles > 0
    ? `$${suggestedMin}-${suggestedMax} · gas split for ${Math.round(durationMinutes || 0) || '--'}min`
    : 'Select route to estimate';


  return (
    <KeyboardAvoidingView
      style={themed.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
    >
      <StatusBar barStyle={colors.statusBar} />
      <LinearGradient
        colors={colors.gradientBg as unknown as readonly [string, string, ...string[]]}
        style={StyleSheet.absoluteFillObject}
      />

      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>

          {/* ── Header ── */}
          <View style={styles.hdr}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.hdrTitle, { color: colors.textPrimary }]}>Post a ride</Text>
              <Text style={[styles.hdrSub, { color: colors.textSecondary }]}>Step 1 of 3 · Route</Text>
            </View>
          </View>

          <FlatList
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 80 }}
            data={[0]}
            ListHeaderComponent={(
              <View>
                <View style={styles.stepWrap}>
                  <Text style={styles.stepText}>STEP 1 OF 3 · ROUTE</Text>
                  <View style={styles.stepTrack}>
                    <View style={styles.stepFill} />
                  </View>
                </View>

                <View style={themed.formCard}>
                  <View style={styles.routeMiniRow}>
                    <View style={styles.routeDots}>
                      <View style={[styles.routeMiniDot, { backgroundColor: '#13213A' }]} />
                      <View style={styles.routeMiniLine} />
                      <Text style={styles.stopPlus}>+</Text>
                      <View style={styles.routeMiniLine} />
                      <View style={[styles.routeMiniDot, { backgroundColor: BRAND.orange }]} />
                    </View>

                    <View style={styles.routeFields}>
                      <AddressAutocomplete
                        label=""
                        placeholder="Austin, TX"
                        value={pickupLocation}
                        onChangeText={setPickupLocation}
                        onSelected={({ address, coords }) => {
                          setPickupLocation(address);
                          setPickupCoords(coords);
                        }}
                        apiKey={GOOGLE_MAPS_API_KEY}
                        zIndex={60}
                      />

                      <Text style={styles.addStopText}>+ stop</Text>

                      <AddressAutocomplete
                        label=""
                        placeholder="Houston, TX"
                        value={dropoffLocation}
                        onChangeText={setDropoffLocation}
                        onSelected={({ address, coords }) => {
                          setDropoffLocation(address);
                          setDropoffCoords(coords);
                        }}
                        apiKey={GOOGLE_MAPS_API_KEY}
                        zIndex={50}
                      />
                    </View>
                  </View>
                </View>

                <Text style={styles.fieldGroupLabel}>WHEN</Text>
                <View style={styles.whenRow}>
                  <TouchableOpacity style={themed.ceoInputBtn} onPress={() => setCalendarOpen(true)}>
                    <Text style={themed.ceoInputText}>{date || 'Fri, Nov 20'}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={[themed.ceoInputBtn, styles.timeBtn]} onPress={() => setTimeOpen(true)}>
                    <Text style={themed.ceoInputText}>{time || '3:00 PM'}</Text>
                  </TouchableOpacity>
                </View>

                <CalendarModal
                  visible={calendarOpen}
                  month={date ? new Date(date) : new Date()}
                  selectedDate={date}
                  primaryColor={BRAND.orange}
                  secondaryColor="#13213A"
                  onClose={() => setCalendarOpen(false)}
                  onSelect={setDate}
                />

                <TimeModal
                  visible={timeOpen}
                  initialTime={time}
                  primaryColor={BRAND.orange}
                  secondaryColor="#13213A"
                  onClose={() => setTimeOpen(false)}
                  onSelect={setTime}
                />

                <Text style={styles.fieldGroupLabel}>SEATS AVAILABLE</Text>
                <View style={styles.seatPillRow}>
                  {([1, 2] as const).map((n) => (
                    <TouchableOpacity
                      key={n}
                      onPress={() => setSeats(n)}
                      style={[themed.seatPill, seats === n && styles.seatPillActive]}
                    >
                      <Text style={[themed.seatPillText, seats === n && styles.seatPillTextActive]}>{n}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fieldGroupLabel}>PRICE PER SEAT</Text>
                <View style={themed.priceBox}>
                  <Text style={styles.priceDollar}>$</Text>
                  <TextInput
                    value={contribution}
                    onChangeText={setContribution}
                    placeholder="28"
                    placeholderTextColor="#94A3B8"
                    keyboardType="decimal-pad"
                    style={themed.priceInputCeo}
                  />

                  <View style={styles.suggestedWrap}>
                    <Text style={styles.suggestedLabel}>SUGGESTED</Text>
                    <Text style={themed.suggestedText}>{suggestedText}</Text>
                  </View>
                </View>

                {maxPrice > 0 ? (
                  <View style={styles.capMiniBanner}>
                    <Text style={styles.capMiniText}>
                      Max allowed is ${maxPrice.toFixed(2)} per seat for this route.
                    </Text>
                  </View>
                ) : null}

                <Text style={styles.fieldGroupLabel}>NOTE FOR RIDERS (OPTIONAL)</Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Heading home for the weekend. Aux is open"
                  placeholderTextColor="#94A3B8"
                  multiline
                  style={themed.notesCeo}
                />

                <Text style={styles.fieldGroupLabel}>RIDE VIBE (OPTIONAL)</Text>
                <View style={styles.vibeCompactRow}>
                  {['Quiet', 'Social', 'Music', 'Study-friendly', 'Luggage OK'].map((vibe) => {
                    const active = selectedVibes.includes(vibe);

                    return (
                      <TouchableOpacity
                        key={vibe}
                        onPress={() => {
                          setSelectedVibes((prev) =>
                            active ? prev.filter((item) => item !== vibe) : [...prev, vibe]
                          );
                        }}
                        style={[themed.vibeCompactChip, active && styles.vibeCompactChipActive]}
                      >
                        <Text style={[themed.vibeCompactText, active && styles.vibeCompactTextActive]}>
                          {vibe}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={themed.earningsSummary}>
                  <View style={styles.summaryRow}>
                    <Text style={themed.summaryLabel}>
                      {seats} seat{seats === 1 ? '' : 's'} x ${priceNum > 0 ? priceNum.toFixed(0) : '--'}
                    </Text>
                    <Text style={themed.summaryValue}>${grossEarnings.toFixed(2)}</Text>
                  </View>

                  <View style={styles.summaryRow}>
                    <Text style={themed.summaryLabel}>Platform fee (8%)</Text>
                    <Text style={themed.summaryValue}>-${platformFee.toFixed(2)}</Text>
                  </View>

                  <View style={styles.summaryDivider} />

                  <View style={styles.summaryRow}>
                    <Text style={themed.summaryLabel}>You'll earn</Text>
                    <Text style={styles.netEarnValue}>${netEarnings.toFixed(2)}</Text>
                  </View>
                </View>

                <TouchableOpacity
                  onPress={handleSubmit}
                  disabled={submitting || !isFormValid}
                  style={[styles.continueBtn, (submitting || !isFormValid) && styles.submitBtnDisabled]}
                >
                  {submitting ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.continueText}>Continue →</Text>
                  )}
                </TouchableOpacity>

                <View style={{ height: 20 }} />
              </View>
            )}
            renderItem={() => null}
            keyExtractor={() => 'content'}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />
        </SafeAreaView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}


const createStyles = (colors: AppColors, isDark: boolean) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    card: {
      marginHorizontal: 16,
      marginBottom: 14,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.borderMid,
      overflow: 'hidden',
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
    },
    title: {
      color: colors.textPrimary,
    },
    subtitle: {
      color: colors.textSecondary,
    },
    primaryText: {
      color: colors.primary,
    },

    formCard: {
      marginHorizontal: 20,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: isDark ? colors.borderMid : '#DDE3EC',
      backgroundColor: isDark ? colors.glassBg : '#FFFFFF',
      padding: 12,
    },
    ceoInputBtn: {
      flex: 1,
      minHeight: 48,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: isDark ? colors.borderMid : '#DDE3EC',
      backgroundColor: isDark ? colors.bgInput : '#FFFFFF',
      justifyContent: 'center',
      paddingHorizontal: 14,
    },
    ceoInputText: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    seatPill: {
      height: 34,
      minWidth: 54,
      borderRadius: 17,
      borderWidth: 1,
      borderColor: isDark ? colors.borderMid : '#DDE3EC',
      backgroundColor: isDark ? colors.bgInput : '#FFFFFF',
      alignItems: 'center',
      justifyContent: 'center',
    },
    seatPillText: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '700',
    },
    priceBox: {
      marginHorizontal: 20,
      minHeight: 60,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: isDark ? colors.borderMid : '#DDE3EC',
      backgroundColor: isDark ? colors.bgInput : '#FFFFFF',
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
    },
    priceInputCeo: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: 28,
      fontWeight: '400',
      paddingVertical: 10,
    },
    suggestedText: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '600',
      textAlign: 'right',
    },
    notesCeo: {
      marginHorizontal: 20,
      minHeight: 84,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: isDark ? colors.borderMid : '#DDE3EC',
      backgroundColor: isDark ? colors.bgInput : '#FFFFFF',
      padding: 14,
      color: colors.textPrimary,
      fontSize: 14,
      textAlignVertical: 'top',
    },
    vibeCompactChip: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: isDark ? colors.borderMid : '#DDE3EC',
      backgroundColor: isDark ? colors.bgInput : '#FFFFFF',
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    vibeCompactText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    earningsSummary: {
      marginHorizontal: 20,
      marginTop: 14,
      borderRadius: 12,
      backgroundColor: isDark ? colors.glassBg : '#F7F5EF',
      padding: 14,
    },
    summaryLabel: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    summaryValue: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '700',
    },
      });

const styles = StyleSheet.create({

  stepWrap: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 10,
  paddingHorizontal: 20,
  marginBottom: 12,
},
stepText: {
  fontSize: 10,
  color: '#7A8FA8',
  fontWeight: '800',
  letterSpacing: 2,
},
stepTrack: {
  flex: 1,
  height: 2,
  backgroundColor: '#D6DAE1',
},
stepFill: {
  width: '34%',
  height: 2,
  backgroundColor: BRAND.orange,
},
routeMiniRow: {
  flexDirection: 'row',
  gap: 10,
},
routeDots: {
  width: 18,
  alignItems: 'center',
  paddingTop: 18,
},
routeMiniDot: {
  width: 8,
  height: 8,
  borderRadius: 4,
},
routeMiniLine: {
  width: 1,
  flex: 1,
  backgroundColor: '#CBD5E1',
  marginVertical: 4,
},
stopPlus: {
  color: '#94A3B8',
  fontSize: 12,
  fontWeight: '700',
},
routeFields: {
  flex: 1,
},
addStopText: {
  color: '#94A3B8',
  fontSize: 11,
  fontWeight: '600',
  marginTop: -4,
  marginBottom: 4,
  marginLeft: 10,
},
fieldGroupLabel: {
  marginHorizontal: 20,
  marginTop: 14,
  marginBottom: 8,
  color: '#7A8FA8',
  fontSize: 10,
  fontWeight: '800',
  letterSpacing: 2,
},
whenRow: {
  flexDirection: 'row',
  gap: 8,
  paddingHorizontal: 20,
},
timeBtn: {
  flex: 0.7,
},
seatPillRow: {
  flexDirection: 'row',
  gap: 8,
  paddingHorizontal: 20,
},
seatPillActive: {
  backgroundColor: '#13213A',
  borderColor: '#13213A',
},
seatPillTextActive: {
  color: '#FFFFFF',
},
priceDollar: {
  color: BRAND.orange,
  fontSize: 28,
  fontWeight: '300',
  marginRight: 8,
},
suggestedWrap: {
  alignItems: 'flex-end',
  maxWidth: 132,
},
suggestedLabel: {
  color: '#94A3B8',
  fontSize: 8,
  fontWeight: '800',
  letterSpacing: 0.8,
},
capMiniBanner: {
  marginHorizontal: 20,
  marginTop: 8,
  borderRadius: 10,
  backgroundColor: 'rgba(16,185,129,0.1)',
  paddingHorizontal: 12,
  paddingVertical: 8,
},
capMiniText: {
  color: '#10B981',
  fontSize: 12,
  fontWeight: '700',
},
vibeCompactRow: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: 8,
  paddingHorizontal: 20,
},
vibeCompactChipActive: {
  backgroundColor: 'rgba(244,98,31,0.12)',
  borderColor: BRAND.orange,
},
vibeCompactTextActive: {
  color: BRAND.orange,
},
summaryRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 8,
},
summaryDivider: {
  height: 1,
  borderStyle: 'dashed',
  borderWidth: 0.5,
  borderColor: '#D6DAE1',
  marginVertical: 8,
},
netEarnValue: {
  color: BRAND.orange,
  fontSize: 22,
  fontWeight: '400',
},
continueBtn: {
  marginHorizontal: 20,
  marginTop: 14,
  height: 54,
  borderRadius: 27,
  backgroundColor: BRAND.orange,
  alignItems: 'center',
  justifyContent: 'center',
},
continueText: {
  color: '#FFFFFF',
  fontSize: 15,
  fontWeight: '800',
},

  // ── Header ────────────────────────────────────────────────────────────────
  hdr:            { flexDirection:'row', alignItems:'center', paddingHorizontal:16, paddingTop:8, paddingBottom:14 },
  backBtn:        { width:38, height:38, borderRadius:19, backgroundColor:'rgba(255,255,255,0.08)', alignItems:'center', justifyContent:'center' },
  hdrTitle:       { fontSize:22, fontWeight:'800', color:'#F0F4FF', letterSpacing:-0.5 },
  hdrSub:         { fontSize:12, color:'#7A8FA8', marginTop:1 },
  livePill:       { flexDirection:'row', alignItems:'center', gap:5, backgroundColor:'rgba(16,185,129,0.15)', paddingHorizontal:10, paddingVertical:4, borderRadius:16, borderWidth:1, borderColor:'rgba(16,185,129,0.25)' },
  liveDot:        { width:6, height:6, borderRadius:3, backgroundColor:'#10B981' },
  liveText:       { color:'#10B981', fontSize:10, fontWeight:'800', letterSpacing:1.2 },

  // ── Map Hero ──────────────────────────────────────────────────────────────
  mapHero:        { marginHorizontal:16, marginBottom:8, height:220, borderRadius:24, overflow:'hidden', borderWidth:1.5, borderColor:'rgba(59,130,246,0.18)' },
  mapGridH:       { position:'absolute', left:0, right:0, height:1, backgroundColor:'rgba(59,130,246,0.06)' },
  mapGridV:       { position:'absolute', top:0, bottom:0, width:1, backgroundColor:'rgba(59,130,246,0.06)' },
  mapMarker:      { position:'absolute', width:18, height:18, alignItems:'center', justifyContent:'center' },
  mapMarkerRing:  { position:'absolute', width:18, height:18, borderRadius:9, borderWidth:2 },
  mapMarkerCore:  { width:10, height:10, borderRadius:5, shadowOpacity:1, shadowRadius:8, shadowOffset:{width:0,height:0} },
  mapRouteLine:   { position:'absolute', height:2.5, backgroundColor:'rgba(244,98,31,0.5)', borderRadius:2 },
  mapPromptWrap:  { position:'absolute', top:0, left:0, right:0, bottom:40, alignItems:'center', justifyContent:'center', gap:8 },
  mapPromptText:  { color:'rgba(255,255,255,0.3)', fontSize:12, textAlign:'center' },
  mapInfoBar:     { position:'absolute', bottom:0, left:0, right:0, flexDirection:'row', alignItems:'center', padding:14, borderTopWidth:1, borderTopColor:'rgba(255,255,255,0.06)' },
  mapInfoTitle:   { color:'white', fontSize:15, fontWeight:'800' },
  mapInfoSub:     { color:'rgba(255,255,255,0.5)', fontSize:12, marginTop:2 },
  mapEarnBadge:   { alignItems:'center', backgroundColor:'rgba(244,98,31,0.15)', borderRadius:12, paddingHorizontal:10, paddingVertical:6, borderWidth:1, borderColor:'rgba(244,98,31,0.3)' },
  mapEarnLabel:   { color:'rgba(255,255,255,0.5)', fontSize:10, fontWeight:'600' },
  mapEarnValue:   { color:BRAND.orange, fontSize:16, fontWeight:'800' },

  // ── Demand Strip ──────────────────────────────────────────────────────────
  demandStrip:    { marginHorizontal:16, marginBottom:16, backgroundColor:'rgba(255,255,255,0.04)', borderRadius:14, borderWidth:1, borderColor:'rgba(255,255,255,0.07)', paddingVertical:8, paddingHorizontal:12, gap:6 },
  demandItem:     { flexDirection:'row', alignItems:'center', gap:6 },
  demandText:     { color:'rgba(255,255,255,0.55)', fontSize:12 },

  // ── Glass Cards ───────────────────────────────────────────────────────────
  glassCard:      { marginHorizontal:16, marginBottom:14, borderRadius:22, borderWidth:1.5, borderColor:'rgba(255,255,255,0.08)', overflow:'hidden', backgroundColor:'rgba(255,255,255,0.03)' },
  glassCardInner: { padding:18 },
  cardHdr:        { flexDirection:'row', alignItems:'center', gap:10, marginBottom:16 },
  cardIconWrap:   { width:32, height:32, borderRadius:10, alignItems:'center', justifyContent:'center' },
  cardTitle:      { fontSize:16, fontWeight:'800', color:'#F0F4FF', flex:1, letterSpacing:-0.3 },

  // ── Route ─────────────────────────────────────────────────────────────────
  connectorCol:   { width:18, alignItems:'center', paddingTop:30, paddingBottom:20 },
  connectorDot:   { width:10, height:10, borderRadius:5 },
  connectorLine:  { width:2, flex:1, marginVertical:4, backgroundColor:'rgba(255,255,255,0.1)' },
  quickActionsRow:{ flexDirection:'row', gap:10, marginTop:12 },
  quickBtn:       { flexDirection:'row', alignItems:'center', gap:6, paddingHorizontal:14, paddingVertical:9, borderRadius:12, borderWidth:1, borderColor:'rgba(244,98,31,0.3)', backgroundColor:'rgba(244,98,31,0.06)' },
  quickBtnText:   { fontSize:13, fontWeight:'600', color:BRAND.orange },
  infoStrip:      { flexDirection:'row', backgroundColor:'rgba(255,255,255,0.05)', borderRadius:14, padding:12, marginTop:14, alignItems:'center' },
  infoStripItem:  { flex:1, alignItems:'center', gap:3 },
  infoStripDiv:   { width:1, height:32, backgroundColor:'rgba(255,255,255,0.08)' },
  infoStripLabel: { fontSize:9, fontWeight:'700', color:'#7A8FA8', letterSpacing:0.8, textTransform:'uppercase' },
  infoStripVal:   { fontSize:15, fontWeight:'800', color:'#F0F4FF' },

  // ── Schedule ──────────────────────────────────────────────────────────────
  scheduleBtn:    { flex:1, flexDirection:'row', alignItems:'center', gap:10, backgroundColor:'rgba(255,255,255,0.05)', borderRadius:14, padding:12, borderWidth:1, borderColor:'rgba(255,255,255,0.08)' },
  scheduleBtnFilled: { borderColor:'rgba(244,98,31,0.3)', backgroundColor:'rgba(244,98,31,0.06)' },
  scheduleIconWrap: { width:36, height:36, borderRadius:10, alignItems:'center', justifyContent:'center' },
  scheduleLabel:  { fontSize:9, fontWeight:'700', color:'#7A8FA8', letterSpacing:0.8, textTransform:'uppercase', marginBottom:2 },
  scheduleValue:  { fontSize:14, fontWeight:'700', color:'#F0F4FF' },
  schedulePlaceholder: { color:'#475569', fontWeight:'500' },

  // ── Seats ─────────────────────────────────────────────────────────────────
  popularTag:     { backgroundColor:'rgba(244,98,31,0.15)', borderRadius:12, paddingHorizontal:8, paddingVertical:3 },
  popularTagText: { color:BRAND.orange, fontSize:11, fontWeight:'700' },
  seatRow:        { flexDirection:'row', gap:12 },
  seatBtn:        { flex:1, borderRadius:16, borderWidth:1.5, borderColor:'rgba(255,255,255,0.08)', backgroundColor:'rgba(255,255,255,0.04)', padding:14, alignItems:'center', gap:8 },
  seatBtnActive:  { borderColor:'rgba(244,98,31,0.5)', backgroundColor:'rgba(244,98,31,0.08)' },
  seatIconRow:    { flexDirection:'row', gap:6 },
  seatIconWrap:   { width:38, height:38, borderRadius:12, backgroundColor:'rgba(255,255,255,0.05)', alignItems:'center', justifyContent:'center' },
  seatIconWrapActive: { backgroundColor:'rgba(244,98,31,0.15)' },
  seatBtnLabel:   { fontSize:15, fontWeight:'600', color:'#7A8FA8' },
  seatBtnSub:     { fontSize:11, color:'#475569', textAlign:'center' },

  // ── Pricing ───────────────────────────────────────────────────────────────
  aiTag:          { backgroundColor:'rgba(245,158,11,0.15)', borderRadius:12, paddingHorizontal:8, paddingVertical:3 },
  aiTagText:      { color:'#F59E0B', fontSize:11, fontWeight:'700' },
  priceRangeWrap: { marginBottom:14 },
  priceRangeBar:  { height:4, backgroundColor:'rgba(255,255,255,0.08)', borderRadius:2, marginBottom:6, overflow:'hidden' },
  priceRangeFill: { height:'100%' as any, backgroundColor:BRAND.orange, borderRadius:2 },
  priceRangeLabel:{ fontSize:12, color:'#7A8FA8' },
  priceInputRow:  { flexDirection:'row', alignItems:'center', borderRadius:14, borderWidth:1.5, borderColor:'rgba(255,255,255,0.1)', backgroundColor:'rgba(255,255,255,0.05)', overflow:'hidden', marginBottom:12 },
  priceDollarBox: { paddingHorizontal:16, paddingVertical:16, backgroundColor:'rgba(244,98,31,0.1)', alignItems:'center', justifyContent:'center' },

  priceInput:     { flex:1, fontSize:22, fontWeight:'700', color:'#F0F4FF', paddingHorizontal:12, paddingVertical:14 },
  pricePerSeat:   { paddingRight:16, fontSize:14, color:'#7A8FA8', fontWeight:'500' },
  earningsRow:    { flexDirection:'row', gap:12, marginBottom:10 },
  earningsItem:   { flex:1, backgroundColor:'rgba(255,255,255,0.04)', borderRadius:12, padding:12, alignItems:'center' },
  earningsLabel:  { fontSize:11, color:'#7A8FA8', fontWeight:'500', marginBottom:4 },
  earningsValue:  { fontSize:18, fontWeight:'800', color:'#F0F4FF' },
  priceHintText:  { fontSize:12, color:'#475569' },
  capBanner:      { marginTop:8, paddingVertical:8, paddingHorizontal:12, borderRadius:10, backgroundColor:'rgba(16,185,129,0.1)', borderWidth:1, borderColor:'rgba(16,185,129,0.25)' },
  capBannerText:  { color:'#10B981', fontSize:12, fontWeight:'600' },

  // ── Ride Vibe ─────────────────────────────────────────────────────────────
  optionalTag:    { fontSize:11, color:'#7A8FA8', backgroundColor:'rgba(255,255,255,0.06)', paddingHorizontal:8, paddingVertical:3, borderRadius:8 },
  vibeSubLabel:   { fontSize:13, color:'#7A8FA8', marginBottom:12 },
  vibeChipsRow:   { flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:14 },
  vibeChip:       { paddingHorizontal:12, paddingVertical:8, borderRadius:20, backgroundColor:'rgba(255,255,255,0.06)', borderWidth:1, borderColor:'rgba(255,255,255,0.08)' },
  vibeChipActive: { backgroundColor:'rgba(139,92,246,0.2)', borderColor:'rgba(139,92,246,0.5)' },
  vibeChipText:   { fontSize:13, color:'#7A8FA8', fontWeight:'500' },
  vibeChipTextActive: { color:'#C4B5FD', fontWeight:'700' },
  notesInput:     { backgroundColor:'rgba(255,255,255,0.04)', borderRadius:12, borderWidth:1, borderColor:'rgba(255,255,255,0.08)', padding:12, fontSize:14, color:'#F0F4FF', minHeight:64, textAlignVertical:'top' },

  // ── Campus Activity ───────────────────────────────────────────────────────
  campusActivityTitle: { fontSize:15, fontWeight:'800', color:'#F0F4FF', marginBottom:12 },
  campusActivityRow:   { flexDirection:'row', alignItems:'center', paddingVertical:10, gap:10 },
  campusActivityDot:   { width:6, height:6, borderRadius:3, backgroundColor:BRAND.orange, flexShrink:0 },
  campusActivityText:  { flex:1, fontSize:13, color:'rgba(255,255,255,0.55)' },

  // ── GO LIVE Button ────────────────────────────────────────────────────────
  goLiveBtn:      { height:60, borderRadius:22, flexDirection:'row', alignItems:'center', justifyContent:'center', overflow:'hidden', marginBottom:10 },
  goLiveGlow:     { borderRadius:22, backgroundColor:BRAND.orange, shadowColor:BRAND.orange, shadowOpacity:0.8, shadowRadius:30, shadowOffset:{width:0,height:0} },
  goLiveBtnText:  { color:'white', fontSize:20, fontWeight:'900', letterSpacing:1 },
  goLiveArrow:    { position:'absolute', right:20, width:34, height:34, borderRadius:17, backgroundColor:'rgba(255,255,255,0.2)', alignItems:'center', justifyContent:'center' },
  goLiveSubText:  { textAlign:'center', fontSize:12, color:'#475569', marginBottom:4 },

  // ── Autocomplete (dark themed) ────────────────────────────────────────────
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7A8FA8',
    marginBottom: 5,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE3EC',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#13213A',
  },

  autoWrap: {
    position: 'relative',
    marginBottom: 10,
  },
  autoPanel: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DDE3EC',
    maxHeight: 220,
    overflow: 'hidden',
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    zIndex: 999,
  },
  autoItem:       { paddingHorizontal:14, paddingVertical:12, borderBottomWidth:1, borderBottomColor:'rgba(255,255,255,0.06)' },
  autoItemRow:    { flexDirection:'column' },
  autoMainText: {
    color: '#13213A',
    fontSize: 14,
    fontWeight: '600',
  },
  autoSecondaryText: {
    color: '#7A8FA8',
    fontSize: 12,
    marginTop: 2,
  },
  autoText: {
    color: '#13213A',
    fontSize: 14,
  },
  autoEmpty:      { padding:14 },
  placesEmptyText:{ color:'#7A8FA8', fontSize:13, textAlign:'center' },

  // ── Calendar Modal (keep existing light theme for modals) ─────────────────
  modalBackdrop:  { flex:1, backgroundColor:'rgba(0,0,0,0.65)', justifyContent:'center', alignItems:'center', padding:20 },
  calendarCard:   { width:'100%', maxWidth:380, backgroundColor:'#FFFFFF', borderRadius:22, padding:20, shadowColor:'#000', shadowOffset:{width:0,height:12}, shadowOpacity:0.25, shadowRadius:30, elevation:16 },
  calendarHeader: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:12 },
  monthTitle:     { fontSize:17, fontWeight:'700', color:'#1E293B' },
  navBtn:         { paddingHorizontal:12, paddingVertical:8, borderRadius:10, borderWidth:1, backgroundColor:'#F8FAFC' },
  navBtnText:     { fontSize:16, fontWeight:'700' },
  weekdaysRow:    { flexDirection:'row', justifyContent:'space-between', marginTop:8, marginBottom:6 },
  weekday:        { width:`${100/7}%`, textAlign:'center', fontSize:12, fontWeight:'700', color:'#94A3B8' },
  daysRow:        { flexDirection:'row', justifyContent:'space-between', marginBottom:4 },
  dayCell:        { width:`${100/7}%`, height:44, alignItems:'center', justifyContent:'center', borderRadius:12, backgroundColor:'#FAFBFC' },
  dayText:        { fontSize:14, color:'#1E293B', fontWeight:'600' },
  closeBtn:       { marginTop:12, alignSelf:'flex-end', paddingHorizontal:12, paddingVertical:8 },
  closeBtnText:   { fontWeight:'600', fontSize:14 },

  // ── Time Modal ────────────────────────────────────────────────────────────
  timeCard:       { width:'100%', maxWidth:380, backgroundColor:'#FFFFFF', borderRadius:22, padding:20, shadowColor:'#000', shadowOffset:{width:0,height:12}, shadowOpacity:0.25, shadowRadius:30, elevation:16 },
  clockRow:       { flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginVertical:12 },
  clockDisplay:   { flexDirection:'row', alignItems:'center', justifyContent:'center', gap:4, flex:1 },
  clockText:      { fontSize:44, fontWeight:'800', color:'#1E293B' },
  stepperCol:     { width:56, alignItems:'center', justifyContent:'center', gap:10 },
  stepBtn:        { width:44, height:44, borderRadius:12, alignItems:'center', justifyContent:'center', borderWidth:1, backgroundColor:'#F8FAFC' },
  stepBtnText:    { fontSize:22, fontWeight:'800' },
  ampmPill:       { marginLeft:8, paddingHorizontal:12, paddingVertical:6, borderRadius:9999, borderWidth:1.5 },
  ampmText:       { fontWeight:'800', fontSize:14 },
  timeColumns:    { flexDirection:'row', gap:12 },
  timeCol:        { flex:1 },
  timeWrap:       { flexDirection:'row', flexWrap:'wrap', gap:8, marginTop:10, marginBottom:10 },
  timeChip:       { backgroundColor:'#F1F5F9', borderRadius:9999, paddingVertical:8, paddingHorizontal:14, minWidth:48, alignItems:'center' },
  timeChipActive: { backgroundColor:'#E05E1A' },
  timeChipText:   { fontWeight:'700', fontSize:14, color:'#475569' },
  timeFooter:     { flexDirection:'row', justifyContent:'flex-end', alignItems:'center', gap:12, marginTop:8 },
  confirmBtn:     { paddingHorizontal:24, paddingVertical:10, borderRadius:12 },
  confirmBtnText: { color:'#FFFFFF', fontWeight:'700', fontSize:15 },

  // ── Suggestion / Seat Modal (legacy) ──────────────────────────────────────
  suggestionsPanel:   { backgroundColor:'#FFFFFF', borderWidth:1, borderColor:'#E2E8F0', borderRadius:12, marginTop:8, overflow:'hidden', position:'absolute', top:48, left:0, right:0, zIndex:10 },
  suggestionItem:     { paddingHorizontal:14, paddingVertical:10, borderBottomWidth:1, borderBottomColor:'#F1F5F9', backgroundColor:'#FFFFFF' },
  suggestionText:     { fontSize:14, color:'#1E293B', fontWeight:'600' },
  suggestionSub:      { fontSize:12, color:'#64748B' },
  inputWrapper:       { position:'relative' },
  textArea:           { height:100, textAlignVertical:'top' },
  section:            { marginBottom:16 },
  pickerWrap:         { borderWidth:1, borderColor:'#E2E8F0', borderRadius:12, overflow:'hidden' },
  chipsRow:           { flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:8 },
  chip:               { backgroundColor:'#F1F5F9', borderRadius:16, paddingHorizontal:10, paddingVertical:6 },
  chipText:           { fontSize:12, color:'#1E293B', fontWeight:'600' },

  // ── Legacy compat (unused but kept for safety) ────────────────────────────
  keyboardAvoid:  { flex:1 },
  safeArea:       { flex:1 },
  flex:           { flex:1 },
  header:         { padding:16, paddingBottom:0 },
  headerTitle:    { fontSize:28, fontWeight:'bold', marginBottom:4, color:'#F0F4FF' },
  headerSubtitle: { fontSize:16, color:'#7A8FA8' },
  scrollArea:     { flex:1 },
  scrollContent:  { padding:16, paddingBottom:40 },
  card:           { backgroundColor:'rgba(255,255,255,0.05)', borderRadius:18, padding:18, marginBottom:14, borderWidth:1, borderColor:'rgba(255,255,255,0.08)' },
  cardHeader:     { flexDirection:'row', alignItems:'center', gap:10, marginBottom:16 },
  routeContainer: { flexDirection:'row', gap:14 },
  routeLineCol:   { width:20, alignItems:'center', paddingTop:28, paddingBottom:28 },
  routeDot:       { width:12, height:12, borderRadius:6 },
  routeLine:      { width:2, flex:1, marginVertical:4 },
  routeInputCol:  { flex:1 },
  routeInputWrap: { marginBottom:2 },
  quickActions:   { flexDirection:'row', gap:10, marginTop:8 },
  infoStripDivider:{ width:1, height:36, marginHorizontal:8 },
  infoStripValue: { fontSize:17, fontWeight:'800', color:'#F0F4FF' },
  scheduleRow:    { flexDirection:'row', gap:12 },
  scheduleInput:  { flex:1, flexDirection:'row', alignItems:'center', backgroundColor:'rgba(255,255,255,0.05)', borderRadius:12, padding:14, gap:12, borderWidth:1, borderColor:'rgba(255,255,255,0.08)' },
  scheduleTextWrap:{ flex:1 },
  seatsRow:       { flexDirection:'row', gap:12, marginBottom:4 },
  seatOption:     { flex:1, flexDirection:'row', alignItems:'center', gap:10, paddingVertical:14, paddingHorizontal:16, borderRadius:12, borderWidth:1.5, borderColor:'rgba(255,255,255,0.08)', backgroundColor:'rgba(255,255,255,0.04)' },
  seatOptionActive:{ borderWidth:2 },
  seatOptionText: { fontSize:15, fontWeight:'600', color:'#475569' },
  fieldLabel:     { fontSize:14, fontWeight:'600', color:'#7A8FA8', marginBottom:10 },
  priceHint:      { marginTop:8, fontSize:12, fontWeight:'500', color:'#475569' },
  optionalBadge:  { fontSize:11, fontWeight:'600', color:'#94A3B8', backgroundColor:'rgba(255,255,255,0.06)', paddingHorizontal:8, paddingVertical:3, borderRadius:6, overflow:'hidden' },
  submitBtn:      { flexDirection:'row', alignItems:'center', justifyContent:'center', borderRadius:16, paddingVertical:18, marginTop:4 },
  submitBtnDisabled:{ opacity:0.5 },
  submitBtnText:  { color:'#FFFFFF', fontSize:18, fontWeight:'700', letterSpacing:0.3 },
  bannerInfo:     { marginTop:8, paddingVertical:8, paddingHorizontal:12, borderRadius:10, backgroundColor:'rgba(16,185,129,0.1)', borderWidth:1, borderColor:'rgba(16,185,129,0.3)' },
  bannerInfoText: { color:'#10B981', fontSize:12, fontWeight:'600' },
  pricePrefix:    { paddingHorizontal:16, paddingVertical:14, justifyContent:'center', alignItems:'center' },
  pricePrefixText:{ fontSize:20, fontWeight:'800' },
  mapLoadingOverlay: {
  ...StyleSheet.absoluteFillObject,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(8,14,23,0.25)',
},

mapPinWrap: {
  width: 30,
  height: 30,
  borderRadius: 15,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(255,255,255,0.92)',
  borderWidth: 2,
  borderColor: '#FFFFFF',
  shadowColor: '#000',
  shadowOpacity: 0.18,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 4 },
  elevation: 5,
},

mapPin: {
  width: 14,
  height: 14,
  borderRadius: 7,
},
});