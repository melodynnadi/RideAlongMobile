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
  Share,
  FlatList,
  Keyboard,
  Modal,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import { router } from 'expo-router';
import { firestore, firebaseAuth, getApiBaseUrl } from '@/constants/services';
import { logActivity } from '@/utils/activityLogger';
import { addDoc, collection, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { GOOGLE_MAPS_API_KEY } from '@/constants/services';
import * as Location from 'expo-location';
import { PaymentModal } from '@/components/PaymentModal';
import { checkCanRequestRide } from '@/services/verification';
import { computeBaseFare } from '@/utils/fees';
import { MapPin, Navigation, Calendar, Clock, DollarSign, ArrowUpDown, LocateFixed, FileText, Send, Route, Timer, Ruler } from 'lucide-react-native';

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
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (t: string) => void;
  onSelected: (p: { address: string; coords: Coords }) => void;
  apiKey: string;
  country?: string;
  zIndex?: number;
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
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&key=${apiKey}&components=country:${country}&sessiontoken=${token}`;
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
            <View style={styles.autoEmpty}><Text style={styles.placesEmptyText}>Searching…</Text></View>
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
  const [minContribution, setMinContribution] = useState<number | null>(null);
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [pendingRideData, setPendingRideData] = useState<any>(null);
  const [tempRideId, setTempRideId] = useState<string>(() => `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`);

  const to24h = (t: string): string => {
    // Convert 'h:mm AM/PM' or 'h:mmAM' to 'HH:mm'
    const m = /^\s*(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)\s*$/i.exec(t);
    if (m) {
      let h = parseInt(m[1], 10);
      const mm = Math.max(0, Math.min(59, parseInt(m[2] || '0', 10)));
      const ampm = m[3].toLowerCase();
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      return `${pad2(h)}:${pad2(mm)}`;
    }
    // If already 24h 'HH:mm'
    const m2 = /^\s*(\d{1,2}):(\d{1,2})\s*$/.exec(t);
    if (m2) {
      const h = Math.max(0, Math.min(23, parseInt(m2[1], 10)));
      const mm = Math.max(0, Math.min(59, parseInt(m2[2], 10)));
      return `${pad2(h)}:${pad2(mm)}`;
    }
    return t; // fallback
  };

  const toRequestedDate = (d?: string, t?: string): Date | null => {
    try {
      if (!d && !t) return null;
      if (d && t) {
        const t24 = /am|pm/i.test(t) ? to24h(t) : t;
        const dt = new Date(`${d}T${t24}`);
        return isNaN(dt.getTime()) ? null : dt;
      }
      if (d) {
        const dt = new Date(d);
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
      // Check verification status before proceeding
      if (!checkCanRequestRide()) {
        return;
      }

      const user = firebaseAuth.currentUser;
      if (!user) {
        Alert.alert('Sign in required', 'Please sign in to book a ride.');
        router.push('/(auth)/sign-in');
        return;
      }

      // Basic validation
      if (!pickupLocation.trim() || !dropoffLocation.trim()) {
        Alert.alert('Missing info', 'Please enter both pickup and dropoff locations.');
        return;
      }

      // Parse contribution
      const priceNum = (() => {
        const n = Number(String(contribution).replace(/[^0-9.\-]/g, ''));
        return isNaN(n) ? null : n;
      })();

      // Validate against minimum if available
      if (minContribution != null && (priceNum == null || priceNum < minContribution)) {
        Alert.alert('Contribution too low', `Minimum: $${minContribution.toFixed(2)}`);
        return;
      }

      if (!priceNum || priceNum <= 0) {
        Alert.alert('Invalid price', 'Please enter a valid price for the ride.');
        return;
      }

      const requestedTime = toRequestedDate(date || undefined, time || undefined);

      // Save the ride data to post after payment
      const payload: any = {
        userId: user.uid,
        riderId: user.uid,
        userEmail: user.email || null,
        riderEmail: user.email || null,
        pickup: pickupLocation || null,
        dropoff: dropoffLocation || null,
        date: date || null,
        time: time || null,
        distance: distanceText || null,
        requestedTime: requestedTime || null,
        passengers: 1,
        estimatedFare: priceNum,
        contributionAmount: priceNum,
        notes: notes || null,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      // Replace undefined with null to avoid Firestore issues
      Object.keys(payload).forEach((k) => {
        if (payload[k] === undefined) payload[k] = null;
      });

      setPendingRideData(payload);
      setPaymentModalVisible(true);
    } catch (err: any) {
      console.error('Form validation error:', err);
      Alert.alert('Error', err?.message || 'Please check your inputs');
    }
  };

  const handlePaymentSuccess = async (paymentIntentId: string) => {
    try {
      if (!pendingRideData) {
        Alert.alert('Error', 'No ride data found');
        return;
      }

      const user = firebaseAuth.currentUser;
      if (!user) {
        Alert.alert('Error', 'User not authenticated');
        return;
      }

      // Get user's full name from pending data or auth
      const userName = user.displayName || pendingRideData.riderName || 'Rider';

      // Add paymentIntentId to ride data
      const rideDataWithPayment = {
        ...pendingRideData,
        riderName: userName,
        paymentIntentId,
        paymentStatus: 'authorized', // Payment is authorized but not yet captured
      };

      // Call backend API to create ride request and send notifications
      const apiUrl = getApiBaseUrl();
      console.log('🚀 Creating ride request via API:', `${apiUrl}/api/ride-requests`);
      console.log('🚀 Request payload:', JSON.stringify({ 
        ...rideDataWithPayment, 
        pickupLocation: rideDataWithPayment.pickup?.substring(0, 50),
        dropoffLocation: rideDataWithPayment.dropoff?.substring(0, 50)
      }, null, 2));
      
      let response;
      try {
        response = await fetch(`${apiUrl}/api/ride-requests`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(rideDataWithPayment),
          // Add timeout handling
        });
      } catch (networkError: any) {
        console.error('Network error:', networkError);
        throw new Error('Cannot connect to server. Using fallback method.');
      }

      console.log('Response status:', response.status);

      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Non-JSON response:', text.substring(0, 200));
        throw new Error(`Server error (${response.status}). Using fallback method.`);
      }

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.message || result.error || 'Failed to create ride request');
      }

      console.log('Ride request created:', result);

      void logActivity({
        type: 'ride_request_created',
        entityType: 'rideRequest',
        entityId: result.requestId,
        metadata: {
          contribution: pendingRideData.contributionAmount ?? null,
          requestedTime: pendingRideData.requestedTime ? new Date(pendingRideData.requestedTime).toISOString() : null,
          paymentIntentId,
        },
      });

      // Clear the form
      setDate('');
      setTime('');
      setPickupLocation('');
      setDropoffLocation('');
      setContribution('');
      setNotes('');
      setPendingRideData(null);
      setPaymentModalVisible(false);
      setTempRideId(`temp_${Date.now()}_${Math.random().toString(36).slice(2)}`);

      const newRequestId: string | null = result?.requestId || result?.id || result?.rideRequestId || null;
      void newRequestId; // captured for future use
      Alert.alert('Request Posted!', 'Your ride request is live. Drivers will be able to find you.');
      router.push('/rider');
    } catch (e: any) {
      console.error('Ride request API error:', e);
      
      // Fallback: Create directly in Firestore if API fails
      try {
        console.log('Attempting fallback: Creating ride request directly in Firestore');
        const docRef = await addDoc(collection(firestore, 'rideRequests'), rideDataWithPayment);
        
        // Auto-save preferred route (fallback path)
        try {
          const pickup = (pendingRideData.pickup || '').trim().toLowerCase().replace(/\s+/g, ' ');
          const dropoff = (pendingRideData.dropoff || '').trim().toLowerCase().replace(/\s+/g, ' ');
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
                userType: 'rider',
                origin: pickup,
                destination: dropoff,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
              console.log('Auto-saved preferred route for rider (fallback)');
            }
          }
        } catch (routeErr) {
          console.warn('Failed to auto-save preferred route:', routeErr);
        }

        void logActivity({
          type: 'ride_request_created',
          entityType: 'rideRequest',
          entityId: docRef.id,
          metadata: {
            contribution: pendingRideData.contributionAmount ?? null,
            requestedTime: pendingRideData.requestedTime ? new Date(pendingRideData.requestedTime).toISOString() : null,
            paymentIntentId,
          },
        });

        // Clear the form
        setDate('');
        setTime('');
        setPickupLocation('');
        setDropoffLocation('');
        setContribution('');
        setNotes('');
        setPendingRideData(null);
        setTempRideId(`temp_${Date.now()}_${Math.random().toString(36).slice(2)}`);
        setPaymentModalVisible(false);

        Alert.alert('Request Posted!', 'Your ride request is live. Drivers will be able to find you.');
        router.push('/rider');
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError);
        Alert.alert('Submit failed', 'Could not submit your request. Please try again.');
        throw e; // Re-throw original error
      }
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
          // compute minimum contribution using two-tier pricing from fees.ts
          // Intracity (<25 mi): $2.50 base + $0.95/mi; Intercity (>=25 mi): segment-based
          if (miles != null) {
            const est = computeBaseFare(miles, 1);
            setMinContribution(Number(est.toFixed(2)));
          } else {
            setMinContribution(null);
          }
        } else {
          setDistanceText('--');
          setDurationText('--');
          setDistanceMiles(null);
          setDurationMinutes(null);
          setMinContribution(null);
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

  const isFormValid = pickupLocation.trim() && dropoffLocation.trim() && 
    (minContribution == null || (Number(contribution) && Number(contribution) >= minContribution));

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: theme.colors.secondary }]}>
          Book a Ride
        </Text>
        <Text style={styles.headerSubtitle}>
          Where would you like to go?
        </Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
        style={styles.flex}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <FlatList
            style={styles.scrollArea}
            data={[0]}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListHeaderComponent={(
              <View>

        {/* ── Route Card ── */}
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
                  placeholder="Where are you?"
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
                  placeholder="Where to?"
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
                {locLoading ? 'Locating…' : 'Current Location'}
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
                  {calcLoading ? '…' : distanceText}
                </Text>
              </View>
              <View style={[styles.infoStripDivider, { backgroundColor: '#E2E8F0' }]} />
              <View style={styles.infoStripItem}>
                <Timer size={15} color={theme.colors.primary} />
                <Text style={styles.infoStripLabel}>Duration</Text>
                <Text style={[styles.infoStripValue, { color: theme.colors.secondary }]}>
                  {calcLoading ? '…' : durationText}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* ── Schedule Card ── */}
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

        {/* ── Payment Card ── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <DollarSign size={18} color={theme.colors.primary} />
            <Text style={[styles.cardTitle, { color: theme.colors.secondary }]}>Payment</Text>
          </View>

          <Text style={styles.fieldLabel}>Your contribution</Text>
          <View style={styles.priceInputRow}>
            <View style={[styles.pricePrefix, { backgroundColor: theme.colors.primary + '10' }]}>
              <Text style={[styles.pricePrefixText, { color: theme.colors.primary }]}>$</Text>
            </View>
            <TextInput
              style={styles.priceInput}
              placeholderTextColor="#9CA3AF"
              placeholder="0.00"
              value={contribution}
              onChangeText={setContribution}
              keyboardType="numeric"
            />
          </View>
          <Text style={[styles.priceHint, { color: minContribution ? (Number(contribution) && Number(contribution) < (minContribution ?? 0) ? '#DC2626' : '#64748B') : '#94A3B8' }]}>
            {minContribution == null ? 'Enter pickup & dropoff to see minimum' : `Minimum: $${minContribution.toFixed(2)}${Number(contribution) && Number(contribution) < minContribution ? '  ·  Amount too low' : ''}`}
          </Text>
        </View>

        {/* ── Notes Card ── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <FileText size={18} color={theme.colors.primary} />
            <Text style={[styles.cardTitle, { color: theme.colors.secondary }]}>Notes</Text>
            <Text style={styles.optionalBadge}>Optional</Text>
          </View>
          <TextInput
            style={styles.notesInput}
            placeholder="Special instructions, luggage, accessibility needs…"
            placeholderTextColor="#9CA3AF"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        {/* ── Submit Button ── */}
        <TouchableOpacity
          style={[
            styles.submitBtn,
            { backgroundColor: theme.colors.primary },
            (!isFormValid || submitting) && styles.submitBtnDisabled,
          ]}
          onPress={handleSubmit}
          disabled={submitting || !isFormValid}
          accessibilityRole="button"
          accessibilityLabel="Submit ride request"
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
          ) : (
            <Send size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
          )}
          <Text style={styles.submitBtnText}>{submitting ? 'Booking…' : 'Book Ride'}</Text>
        </TouchableOpacity>

        <View style={{ height: 32 }} />
              </View>
            )}
            renderItem={() => null}
            keyExtractor={() => 'content'}
            showsVerticalScrollIndicator={false}
          />
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>

      {/* Payment Modal */}
      {pendingRideData && paymentModalVisible && (
        <PaymentModal
          visible={paymentModalVisible}
          onClose={() => {
            setPaymentModalVisible(false);
            setPendingRideData(null);
            setSubmitting(false);
          }}
          rideId={tempRideId}
          driverId={firebaseAuth.currentUser?.uid || null}
          baseFare={pendingRideData.contributionAmount || 0}
          onPaymentSuccess={handlePaymentSuccess}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F1F5F9',
  },
  flex: {
    flex: 1,
  },
  /* ── Header ── */
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
  /* ── Scroll ── */
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  /* ── Card ── */
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
  /* ── Route visualization ── */
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
  /* ── Quick actions ── */
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
  /* ── Info strip ── */
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
  /* ── Schedule ── */
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
  /* ── Payment ── */
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
  },
  /* ── Notes ── */
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
  /* ── Submit ── */
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
  /* ── Autocomplete (shared) ── */
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
  /* ── Calendar Modal ── */
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
  /* ── Time Modal ── */
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
  /* ── Suggestion legacy ── */
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
  /* ── Legacy compat ── */
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
