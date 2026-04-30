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
  ActivityIndicator,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import { router } from 'expo-router';
import { firestore, firebaseAuth, getApiBaseUrl } from '@/constants/services';
import { addDoc, collection, serverTimestamp, doc, getDoc, query, where, getDocs } from 'firebase/firestore';
import { GOOGLE_MAPS_API_KEY } from '@/constants/services';
import * as Location from 'expo-location';
import { computeMaxPrice } from '@/src/utils/pricing';
import EmailTriggerService from '@/services/EmailTriggerService';
import { MapPin, Navigation, Calendar, Clock, DollarSign, ArrowUpDown, LocateFixed, FileText, Send, Route, Timer, Ruler, Users, Car } from 'lucide-react-native';

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
      <Text style={styles.label}>{label}</Text>
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
            <View style={styles.autoEmpty}><Text style={styles.placesEmptyText}>Searchingâ€¦</Text></View>
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
  const theme = useTheme();
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
  const [seatsOpen, setSeatsOpen] = useState(false);

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
        const userDoc = await getDoc(doc(firestore, 'users', user.uid));
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
        pickupCoords: pickupCoords || null,
        dropoffCoords: dropoffCoords || null,
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

        console.log('âœ… Ride posting created with preferred route notifications:', result);

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
        router.push('/(tabs)');
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
        router.push('/(tabs)');
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

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoid}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: theme.colors.secondary }]}>
              Offer a Ride
            </Text>
            <Text style={styles.headerSubtitle}>
              Share your route, earn along the way
            </Text>
          </View>

          <FlatList
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            data={[0]}
            ListHeaderComponent={(
              <View>

        {/* â”€â”€ Route Card â”€â”€ */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Route size={18} color={theme.colors.primary} />
            <Text style={[styles.cardTitle, { color: theme.colors.secondary }]}>Your Route</Text>
          </View>

          {/* Route visualization with connector line */}
          <View style={styles.routeContainer}>
            {/* Vertical connector */}
            <View style={styles.routeLineCol}>
              <View style={[styles.routeDot, { backgroundColor: theme.colors.primary }]} />
              <View style={[styles.routeLine, { backgroundColor: theme.colors.primary + '30' }]} />
              <View style={[styles.routeDot, { backgroundColor: '#94A3B8' }]} />
            </View>

            {/* Inputs */}
            <View style={styles.routeInputCol}>
              <View style={styles.routeInputWrap}>
                <AddressAutocomplete
                  label="Pickup"
                  placeholder="Starting point"
                  value={pickupLocation}
                  apiKey={GOOGLE_MAPS_API_KEY}
                  onChangeText={(t) => { setPickupLocation(t); setPickupCoords(null); }}
                  onSelected={({ address, coords }) => { setPickupLocation(address); setPickupCoords(coords); }}
                  zIndex={60}
                />
              </View>
              <View style={styles.routeInputWrap}>
                <AddressAutocomplete
                  label="Dropoff"
                  placeholder="Destination"
                  value={dropoffLocation}
                  apiKey={GOOGLE_MAPS_API_KEY}
                  onChangeText={(t) => { setDropoffLocation(t); setDropoffCoords(null); }}
                  onSelected={({ address, coords }) => { setDropoffLocation(address); setDropoffCoords(coords); }}
                  zIndex={50}
                />
              </View>
            </View>
          </View>

          {/* Quick actions row */}
          <View style={styles.quickActions}>
            <TouchableOpacity
              style={[styles.quickBtn, { borderColor: theme.colors.primary + '30' }]}
              onPress={useCurrentLocation}
              disabled={locLoading}
            >
              {locLoading ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
              ) : (
                <LocateFixed size={16} color={theme.colors.primary} />
              )}
              <Text style={[styles.quickBtnText, { color: theme.colors.primary }]}>
                {locLoading ? 'Locatingâ€¦' : 'Current Location'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.quickBtn, { borderColor: '#94A3B830' }]}
              onPress={swapLocations}
            >
              <ArrowUpDown size={16} color="#64748B" />
              <Text style={[styles.quickBtnText, { color: '#64748B' }]}>Swap</Text>
            </TouchableOpacity>
          </View>

          {/* Distance / Duration info strip */}
          {(pickupCoords && dropoffCoords) && (
            <View style={styles.infoStrip}>
              <View style={styles.infoStripItem}>
                <Ruler size={15} color={theme.colors.primary} />
                <Text style={styles.infoStripLabel}>Distance</Text>
                <Text style={[styles.infoStripValue, { color: theme.colors.secondary }]}>
                  {calcLoading ? 'â€¦' : distanceText}
                </Text>
              </View>
              <View style={[styles.infoStripDivider, { backgroundColor: '#E2E8F0' }]} />
              <View style={styles.infoStripItem}>
                <Timer size={15} color={theme.colors.primary} />
                <Text style={styles.infoStripLabel}>Duration</Text>
                <Text style={[styles.infoStripValue, { color: theme.colors.secondary }]}>
                  {calcLoading ? 'â€¦' : durationText}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* â”€â”€ Schedule Card â”€â”€ */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Calendar size={18} color={theme.colors.primary} />
            <Text style={[styles.cardTitle, { color: theme.colors.secondary }]}>Schedule</Text>
          </View>

          <View style={styles.scheduleRow}>
            <TouchableOpacity
              style={styles.scheduleInput}
              onPress={() => { Keyboard.dismiss(); setCalendarOpen(true); }}
              activeOpacity={0.7}
            >
              <View style={[styles.scheduleIconWrap, { backgroundColor: '#EEF2FF' }]}>
                <Calendar size={18} color="#6366F1" />
              </View>
              <View style={styles.scheduleTextWrap}>
                <Text style={styles.scheduleLabel}>Date</Text>
                <Text style={[styles.scheduleValue, !date && styles.schedulePlaceholder]}>
                  {date || 'Select date'}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.scheduleInput}
              onPress={() => { Keyboard.dismiss(); setTimeOpen(true); }}
              activeOpacity={0.7}
            >
              <View style={[styles.scheduleIconWrap, { backgroundColor: '#FFF7ED' }]}>
                <Clock size={18} color={theme.colors.primary} />
              </View>
              <View style={styles.scheduleTextWrap}>
                <Text style={styles.scheduleLabel}>Time</Text>
                <Text style={[styles.scheduleValue, !time && styles.schedulePlaceholder]}>
                  {time || 'Select time'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          <CalendarModal
            visible={calendarOpen}
            month={calendarMonth}
            selectedDate={date}
            primaryColor={theme.colors.primary}
            secondaryColor={theme.colors.secondary}
            onClose={() => setCalendarOpen(false)}
            onSelect={(ds) => { setDate(ds); setCalendarOpen(false); setCalendarMonth(new Date(ds)); }}
          />
          <TimeModal
            visible={timeOpen}
            initialTime={time}
            primaryColor={theme.colors.primary}
            secondaryColor={theme.colors.secondary}
            onClose={() => setTimeOpen(false)}
            onSelect={(ts) => { setTime(ts); setTimeOpen(false); }}
          />
        </View>

        {/* â”€â”€ Seats & Price Card â”€â”€ */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <DollarSign size={18} color={theme.colors.primary} />
            <Text style={[styles.cardTitle, { color: theme.colors.secondary }]}>Seats & Price</Text>
          </View>

          {/* Seats selector */}
          <Text style={styles.fieldLabel}>Available seats</Text>
          <View style={styles.seatsRow}>
            {([1, 2] as const).map((s) => (
              <TouchableOpacity
                key={s}
                style={[
                  styles.seatOption,
                  seats === s && [styles.seatOptionActive, { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary + '08' }],
                ]}
                onPress={() => setSeats(s)}
                activeOpacity={0.7}
              >
                <View style={[styles.seatIconWrap, seats === s ? { backgroundColor: theme.colors.primary + '15' } : { backgroundColor: '#F1F5F9' }]}>
                  <Users size={18} color={seats === s ? theme.colors.primary : '#94A3B8'} />
                </View>
                <Text style={[styles.seatOptionText, seats === s && { color: theme.colors.primary, fontWeight: '800' }]}>
                  {s} Seat{s === 1 ? '' : 's'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <SeatsModal
            visible={seatsOpen}
            selected={seats}
            primaryColor={theme.colors.primary}
            onClose={() => setSeatsOpen(false)}
            onSelect={(s) => setSeats(s)}
          />

          {/* Price per seat */}
          <Text style={[styles.fieldLabel, { marginTop: 18 }]}>Price per seat</Text>
          <View style={styles.priceInputRow}>
            <View style={[styles.pricePrefix, { backgroundColor: theme.colors.primary + '10' }]}>
              <Text style={[styles.pricePrefixText, { color: theme.colors.primary }]}>$</Text>
            </View>
            <TextInput
              style={styles.priceInput}
              placeholderTextColor="#9CA3AF"
              placeholder="0.00"
              value={contribution}
              onChangeText={(t) => {
                const cleaned = t.replace(/[^0-9.]/g, '');
                const parts = cleaned.split('.');
                let normalized = parts.shift() || '';
                if (parts.length > 0) normalized += '.' + parts.join('');
                setContribution(normalized);
              }}
              keyboardType="numeric"
              onBlur={() => {
                const priceNum = Number(String(contribution).replace(/[^0-9.\-]/g, ''));
                const cap = maxPrice || 0;
                if (!isNaN(priceNum) && cap > 0 && priceNum > cap) {
                  setContribution(cap.toFixed(2));
                  setShowCapBanner(`Price capped at $${cap.toFixed(2)}.`);
                  setTimeout(() => setShowCapBanner(null), 2200);
                }
              }}
            />
          </View>
          <Text style={styles.priceHint}>
            Max for {seats} seat(s): ${maxPrice.toFixed(2)} (based on {typeof distanceMiles === 'number' ? `${distanceMiles.toFixed(1)} mi` : '--'})
          </Text>
          {showCapBanner ? (
            <View style={styles.bannerInfo}>
              <Text style={styles.bannerInfoText}>{showCapBanner}</Text>
            </View>
          ) : null}
        </View>

        {/* â”€â”€ Notes Card â”€â”€ */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <FileText size={18} color={theme.colors.primary} />
            <Text style={[styles.cardTitle, { color: theme.colors.secondary }]}>Notes</Text>
            <Text style={styles.optionalBadge}>Optional</Text>
          </View>
          <TextInput
            style={styles.notesInput}
            placeholder="Music preferences, pet-friendly, trunk spaceâ€¦"
            placeholderTextColor="#9CA3AF"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        {/* â”€â”€ Submit Button â”€â”€ */}
        <TouchableOpacity
          style={[
            styles.submitBtn,
            { backgroundColor: theme.colors.primary },
            (!isFormValid || submitting) && styles.submitBtnDisabled,
          ]}
          onPress={handleSubmit}
          disabled={submitting || !isFormValid}
          accessibilityRole="button"
          accessibilityLabel="Post offered ride"
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
          ) : (
            <Send size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
          )}
          <Text style={styles.submitBtnText}>{submitting ? 'Postingâ€¦' : 'Offer Ride'}</Text>
        </TouchableOpacity>

        <View style={{ height: 32 }} />
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

const styles = StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
    backgroundColor: '#F1F5F9',
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#F1F5F9',
  },
  flex: {
    flex: 1,
  },
  /* â”€â”€ Header â”€â”€ */
  header: {
    padding: 16,
    paddingBottom: 0,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#64748B',
  },
  /* â”€â”€ Scroll â”€â”€ */
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  /* â”€â”€ Card â”€â”€ */
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
    letterSpacing: -0.2,
  },
  /* â”€â”€ Route visualization â”€â”€ */
  routeContainer: {
    flexDirection: 'row',
    gap: 14,
  },
  routeLineCol: {
    width: 20,
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 28,
  },
  routeDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  routeLine: {
    width: 2,
    flex: 1,
    marginVertical: 4,
  },
  routeInputCol: {
    flex: 1,
  },
  routeInputWrap: {
    marginBottom: 2,
  },
  /* â”€â”€ Quick actions â”€â”€ */
  quickActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  quickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: '#FAFBFC',
  },
  quickBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  /* â”€â”€ Info strip â”€â”€ */
  infoStrip: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    alignItems: 'center',
  },
  infoStripItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  infoStripDivider: {
    width: 1,
    height: 36,
    marginHorizontal: 8,
  },
  infoStripLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoStripValue: {
    fontSize: 17,
    fontWeight: '800',
  },
  /* â”€â”€ Schedule â”€â”€ */
  scheduleRow: {
    flexDirection: 'row',
    gap: 12,
  },
  scheduleInput: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  scheduleIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleTextWrap: {
    flex: 1,
  },
  scheduleLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  scheduleValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  schedulePlaceholder: {
    color: '#94A3B8',
    fontWeight: '500',
  },
  /* â”€â”€ Seats â”€â”€ */
  seatsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
  },
  seatOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    backgroundColor: '#FAFBFC',
  },
  seatOptionActive: {
    borderWidth: 2,
  },
  seatIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatOptionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#475569',
  },
  /* â”€â”€ Payment â”€â”€ */
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 10,
  },
  priceInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    overflow: 'hidden',
  },
  pricePrefix: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pricePrefixText: {
    fontSize: 20,
    fontWeight: '800',
  },
  priceInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  priceHint: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
  },
  /* â”€â”€ Notes â”€â”€ */
  optionalBadge: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  notesInput: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    padding: 14,
    fontSize: 15,
    color: '#1E293B',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  /* â”€â”€ Submit â”€â”€ */
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    paddingVertical: 18,
    marginTop: 4,
    shadowColor: '#E05E1A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  /* â”€â”€ Banner â”€â”€ */
  bannerInfo: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  bannerInfoText: {
    color: '#065F46',
    fontSize: 12,
    fontWeight: '600',
  },
  /* â”€â”€ Autocomplete (shared) â”€â”€ */
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1E293B',
  },
  autoWrap: {
    position: 'relative',
    marginBottom: 10,
  },
  autoPanel: {
    position: 'absolute',
    top: 68,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    maxHeight: 240,
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    zIndex: 999,
  },
  autoItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  autoItemRow: {
    flexDirection: 'column',
  },
  autoMainText: {
    color: '#1E293B',
    fontSize: 14,
    fontWeight: '600',
  },
  autoSecondaryText: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  autoText: {
    color: '#1E293B',
    fontSize: 14,
  },
  autoEmpty: {
    padding: 14,
  },
  placesEmptyText: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
  },
  /* â”€â”€ Calendar Modal â”€â”€ */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  calendarCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  monthTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1E293B',
  },
  navBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: '#F8FAFC',
  },
  navBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  weekdaysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 6,
  },
  weekday: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    color: '#94A3B8',
  },
  daysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  dayCell: {
    width: `${100 / 7}%`,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#FAFBFC',
  },
  dayText: {
    fontSize: 14,
    color: '#1E293B',
    fontWeight: '600',
  },
  closeBtn: {
    marginTop: 12,
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  closeBtnText: {
    fontWeight: '600',
    fontSize: 14,
  },
  /* â”€â”€ Time Modal â”€â”€ */
  timeCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  clockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 12,
  },
  clockDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    flex: 1,
  },
  clockText: {
    fontSize: 44,
    fontWeight: '800',
  },
  stepperCol: {
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    backgroundColor: '#F8FAFC',
  },
  stepBtnText: {
    fontSize: 22,
    fontWeight: '800',
  },
  ampmPill: {
    marginLeft: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 9999,
    borderWidth: 1.5,
  },
  ampmText: {
    fontWeight: '800',
    fontSize: 14,
  },
  timeColumns: {
    flexDirection: 'row',
    gap: 12,
  },
  timeCol: {
    flex: 1,
  },
  timeWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
    marginBottom: 10,
  },
  timeChip: {
    backgroundColor: '#F1F5F9',
    borderRadius: 9999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minWidth: 48,
    alignItems: 'center',
  },
  timeChipActive: {
    backgroundColor: '#E05E1A',
  },
  timeChipText: {
    fontWeight: '700',
    fontSize: 14,
    color: '#475569',
  },
  timeFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  confirmBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 12,
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  /* â”€â”€ Suggestion legacy â”€â”€ */
  suggestionsPanel: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    marginTop: 8,
    overflow: 'hidden',
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  suggestionItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  suggestionText: {
    fontSize: 14,
    color: '#1E293B',
    fontWeight: '600',
  },
  suggestionSub: {
    fontSize: 12,
    color: '#64748B',
  },
  /* â”€â”€ Legacy compat â”€â”€ */
  inputWrapper: {
    position: 'relative',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  section: {
    marginBottom: 16,
  },
  pickerWrap: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    overflow: 'hidden',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  chip: {
    backgroundColor: '#F1F5F9',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: 12,
    color: '#1E293B',
    fontWeight: '600',
  },
});
