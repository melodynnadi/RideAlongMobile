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
  Share,
  Switch,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/hooks/ThemeContext';
import { router, useLocalSearchParams } from 'expo-router';
import { firestore, firebaseAuth, getApiBaseUrl } from '@/constants/services';
import { addDoc, collection, serverTimestamp, doc, getDoc, query, where, getDocs } from 'firebase/firestore';
import { GOOGLE_MAPS_API_KEY } from '@/constants/services';
import * as Location from 'expo-location';
import { computeMaxPrice, computeDriverMaxPrice, formatContributionRange } from '@/src/utils/pricing';
import EmailTriggerService from '@/services/EmailTriggerService';
import { Ionicons } from '@expo/vector-icons';
import { DriverBottomNav } from '@/components/DriverBottomNav';
import { DatePickerModal, TimePickerModal, formatDateLabel } from '@/components/DateTimePickerModals';

type Coords = { lat: number; lng: number };
type Suggestion = { description: string; place_id: string; mainText: string; secondaryText: string };

function newToken() {
  return 'tok_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

const modalStyles = StyleSheet.create({
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(5,12,30,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  calendarCard: { width: '100%', maxWidth: 360, borderRadius: 22, backgroundColor: '#FFFFFF', padding: 18 },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  navBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  navBtnText: { fontSize: 18, fontWeight: '800' },
  monthTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  weekdaysRow: { flexDirection: 'row', marginBottom: 6 },
  weekday: { flex: 1, textAlign: 'center', color: '#8B94A6', fontSize: 11, fontWeight: '700' },
  daysRow: { flexDirection: 'row' },
  dayCell: { flex: 1, aspectRatio: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center', margin: 2 },
  dayText: { color: '#15233A', fontSize: 13, fontWeight: '700' },
  closeBtn: { minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  closeBtnText: { fontSize: 14, fontWeight: '800' },
  timeCard: { width: '100%', maxWidth: 360, borderRadius: 22, backgroundColor: '#FFFFFF', padding: 18 },
  clockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginVertical: 8 },
  stepperCol: { gap: 8 },
  stepBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { fontSize: 18, fontWeight: '800' },
  clockDisplay: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  clockText: { fontSize: 34, lineHeight: 40, fontWeight: '800' },
  ampmPill: { minWidth: 52, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  ampmText: { fontSize: 12, fontWeight: '800' },
  timeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  timeChip: { height: 38, minWidth: 72, borderRadius: 19, borderWidth: 1, borderColor: '#E5E0D8', alignItems: 'center', justifyContent: 'center' },
  timeChipActive: { borderColor: 'transparent' },
  timeChipText: { color: '#6B7280', fontSize: 13, fontWeight: '700' },
  timeFooter: { flexDirection: 'row', gap: 10, marginTop: 12 },
  confirmBtn: { flex: 1, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  confirmBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  suggestionItem: { minHeight: 48, borderBottomWidth: 1, justifyContent: 'center' },
  suggestionText: { fontSize: 15, fontWeight: '700' },
});

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
  const { colors: acColors } = useAppTheme();
  const acStyles = useMemo(() => StyleSheet.create({
    autoWrap: { position: 'relative', marginBottom: 10 },
    label: { color: acColors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6 },
    input: {
      minHeight: 48,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: acColors.border,
      backgroundColor: acColors.bgCard,
      color: acColors.textPrimary,
      paddingHorizontal: 14,
      fontSize: 14,
      fontWeight: '600',
    },
    autoPanel: {
      position: 'absolute',
      top: 76,
      left: 0,
      right: 0,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: acColors.border,
      backgroundColor: acColors.bgCard,
      overflow: 'hidden',
      zIndex: 100,
      elevation: 12,
    },
    autoStateRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 },
    autoIconWrap: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: acColors.primaryDim },
    placesEmptyText: { color: acColors.textSecondary, fontSize: 13, fontWeight: '600' },
    autoItem: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: acColors.border },
    autoItemRow: { flex: 1, minWidth: 0 },
    autoMainText: { color: acColors.textPrimary, fontSize: 14, fontWeight: '700' },
    autoSecondaryText: { color: acColors.textSecondary, fontSize: 12, marginTop: 2 },
  }), [acColors]);
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
    <View style={[acStyles.autoWrap, { zIndex }]}>
      {!!label && <Text style={acStyles.label}>{label}</Text>}
      <TextInput
        style={acStyles.input}
        placeholder={placeholder}
        placeholderTextColor={acColors.textSecondary}
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
        <View style={acStyles.autoPanel}>
          {loading ? (
            <View style={acStyles.autoStateRow}>
              <View style={acStyles.autoIconWrap}><Ionicons name="search-outline" size={15} color={acColors.primary} /></View>
              <Text style={acStyles.placesEmptyText}>Searching locations...</Text>
            </View>
          ) : (
            items.slice(0, 10).map((s, idx) => (
              <TouchableOpacity
                key={`${s.place_id}-${idx}`}
                style={acStyles.autoItem}
                onPress={async () => {
                  setOpen(false);
                  setItems([]);
                  justSelected.current = true;
                  await fetchDetails(s.place_id);
                  setTimeout(() => Keyboard.dismiss(), 50);
                }}
              >
                <View style={acStyles.autoIconWrap}>
                  <Ionicons name={idx === 0 ? 'location' : 'location-outline'} size={15} color={acColors.primary} />
                </View>
                <View style={acStyles.autoItemRow}>
                  <Text style={acStyles.autoMainText} numberOfLines={1}>{s.mainText}</Text>
                  {s.secondaryText ? <Text style={acStyles.autoSecondaryText} numberOfLines={1}>{s.secondaryText}</Text> : null}
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

async function geocodeAddress(address: string): Promise<Coords | null> {
  const q = address.trim();
  if (!q || !GOOGLE_MAPS_API_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&components=country:US&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    const json = await res.json();
    const loc = json?.results?.[0]?.geometry?.location;
    if (typeof loc?.lat === 'number' && typeof loc?.lng === 'number') {
      return { lat: loc.lat, lng: loc.lng };
    }
  } catch {}
  return null;
}

async function fetchRouteMetricsForCoords(origin: Coords, destination: Coords) {
  if (!GOOGLE_MAPS_API_KEY) return null;
  try {
    const origins = `${origin.lat},${origin.lng}`;
    const destinations = `${destination.lat},${destination.lng}`;
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?units=imperial&origins=${encodeURIComponent(origins)}&destinations=${encodeURIComponent(destinations)}&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    const json = await res.json();
    const element = json?.rows?.[0]?.elements?.[0];
    const distanceMeters = element?.distance?.value;
    const durationSeconds = element?.duration?.value;
    if (typeof distanceMeters !== 'number' || typeof durationSeconds !== 'number') return null;
    return {
      distanceText: element?.distance?.text || null,
      durationText: element?.duration?.text || null,
      distanceMiles: distanceMeters / 1609.34,
      durationMinutes: durationSeconds / 60,
    };
  } catch {}
  return null;
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
      <View style={modalStyles.modalBackdrop}>
        <View style={modalStyles.calendarCard}>
          <View style={modalStyles.calendarHeader}>
            <TouchableOpacity onPress={() => setM(addMonths(m, -1))} style={[modalStyles.navBtn, { borderColor: primaryColor }]}><Text style={[modalStyles.navBtnText, { color: primaryColor }]}>{'<'}</Text></TouchableOpacity>
            <Text style={[modalStyles.monthTitle, { color: secondaryColor }]}>{monthLabel}</Text>
            <TouchableOpacity onPress={() => setM(addMonths(m, 1))} style={[modalStyles.navBtn, { borderColor: primaryColor }]}><Text style={[modalStyles.navBtnText, { color: primaryColor }]}>{'>'}</Text></TouchableOpacity>
          </View>
          <View style={modalStyles.weekdaysRow}>
            {weekdays.map((w) => (
              <Text key={w} style={modalStyles.weekday}>{w}</Text>
            ))}
          </View>
          {weeks.map((row, ridx) => (
            <View key={ridx} style={modalStyles.daysRow}>
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
                      modalStyles.dayCell,
                      isEmpty && { opacity: 0.25 },
                      isSelected && { backgroundColor: primaryColor },
                      !isSelected && isToday && { borderWidth: 1.5, borderColor: primaryColor, backgroundColor: '#FFF7ED' },
                    ]}
                    onPress={() => { if (d) { onSelect(toYMD(d)); onClose(); } }}
                  >
                    <Text style={[
                      modalStyles.dayText,
                      isSelected && { color: '#FFFFFF', fontWeight: '800' },
                      !isSelected && isToday && { color: '#1F2937', fontWeight: '800' },
                    ]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
          <TouchableOpacity onPress={onClose} style={modalStyles.closeBtn}><Text style={[modalStyles.closeBtnText, { color: primaryColor }]}>Close</Text></TouchableOpacity>
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
      <View style={modalStyles.modalBackdrop}>
        <View style={modalStyles.timeCard}>
          <Text style={[modalStyles.monthTitle, { color: secondaryColor, marginBottom: 8 }]}>Select Time</Text>
          <View style={modalStyles.clockRow}>
            <View style={modalStyles.stepperCol}>
              <TouchableOpacity onPress={incHour} style={[modalStyles.stepBtn, { borderColor: primaryColor }]}><Text style={[modalStyles.stepBtnText, { color: primaryColor }]}>+</Text></TouchableOpacity>
              <TouchableOpacity onPress={decHour} style={[modalStyles.stepBtn, { borderColor: primaryColor }]}><Text style={[modalStyles.stepBtnText, { color: primaryColor }]}>-</Text></TouchableOpacity>
            </View>
            <View style={modalStyles.clockDisplay}>
              <Text style={[modalStyles.clockText, { color: secondaryColor }]}>{hour}</Text>
              <Text style={[modalStyles.clockText, { color: secondaryColor }]}>:</Text>
              <Text style={[modalStyles.clockText, { color: secondaryColor }]}>{pad2(minute)}</Text>
              <TouchableOpacity onPress={() => setAmPm(ampm === 'AM' ? 'PM' : 'AM')} style={[modalStyles.ampmPill, { borderColor: primaryColor, backgroundColor: '#FFF7ED' }]}>
                <Text style={[modalStyles.ampmText, { color: primaryColor }]}>{ampm}</Text>
              </TouchableOpacity>
            </View>
            <View style={modalStyles.stepperCol}>
              <TouchableOpacity onPress={incMinute} style={[modalStyles.stepBtn, { borderColor: primaryColor }]}><Text style={[modalStyles.stepBtnText, { color: primaryColor }]}>+</Text></TouchableOpacity>
              <TouchableOpacity onPress={decMinute} style={[modalStyles.stepBtn, { borderColor: primaryColor }]}><Text style={[modalStyles.stepBtnText, { color: primaryColor }]}>-</Text></TouchableOpacity>
            </View>
          </View>
          <View style={[modalStyles.timeWrap, { justifyContent: 'center' }]}> 
            {(['AM','PM'] as const).map(x => (
              <TouchableOpacity key={x} style={[modalStyles.timeChip, ampm===x && [modalStyles.timeChipActive, { backgroundColor: primaryColor }]]} onPress={() => setAmPm(x)}>
                <Text style={[modalStyles.timeChipText, ampm===x && { color: '#FFFFFF', fontWeight: '800' }]}>{x}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={modalStyles.timeFooter}>
            <TouchableOpacity onPress={onClose} style={modalStyles.closeBtn}><Text style={[modalStyles.closeBtnText, { color: secondaryColor }]}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => { onSelect(`${hour}:${pad2(minute)} ${ampm}`); onClose(); }} style={[modalStyles.confirmBtn, { backgroundColor: primaryColor }]}>
              <Text style={modalStyles.confirmBtnText}>Set</Text>
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
      <View style={modalStyles.modalBackdrop}>
        <View style={modalStyles.calendarCard}>
          <Text style={[modalStyles.monthTitle, { marginBottom: 8 }]}>Select seats</Text>
          {[1, 2].map((s) => (
            <TouchableOpacity key={s} onPress={() => { onSelect(s as 1 | 2); onClose(); }} style={[modalStyles.suggestionItem, { borderBottomColor: '#F3F4F6' }]}> 
              <Text style={[modalStyles.suggestionText, { color: selected === s ? primaryColor : '#1F2937' }]}>{s} seat{s === 1 ? '' : 's'}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={onClose} style={modalStyles.closeBtn}><Text style={[modalStyles.closeBtnText, { color: primaryColor }]}>Close</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default function BookScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => StyleSheet.create({
  // ── From createStyles (previously themed) ────────────────────────────────
  root: { flex: 1, backgroundColor: colors.bg },
  formCard: { marginHorizontal: 20, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 14 },
  ceoInputBtn: { flex: 1, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, justifyContent: 'center', paddingHorizontal: 14 },
  ceoInputText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  ceoInputPlaceholder: { color: colors.textSecondary },
  seatPill: { height: 40, minWidth: 64, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
  seatPillText: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
  priceBox: { marginHorizontal: 20, minHeight: 70, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  priceInputCeo: { flex: 1, color: colors.textPrimary, fontSize: 30, fontWeight: '400', paddingVertical: 0, textAlignVertical: 'center' },
  suggestedText: { color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '600', textAlign: 'right' },
  notesCeo: { marginHorizontal: 20, minHeight: 92, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 14, color: colors.textPrimary, fontSize: 14, lineHeight: 20, textAlignVertical: 'top' },
  routeMiniRow: { flexDirection: 'row', gap: 12 },
  routeDots: { width: 22, alignItems: 'center', paddingTop: 19 },
  routeMiniDot: { width: 10, height: 10, borderRadius: 5 },
  routeMiniLine: { width: 1, flex: 1, borderLeftWidth: 1, borderStyle: 'dashed', borderColor: colors.border, marginVertical: 6 },
  stopPlus: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  routeFields: { flex: 1 },
  addStopText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700', marginTop: -2, marginBottom: 6, marginLeft: 12 },
  fieldGroupLabel: { marginHorizontal: 20, marginTop: 16, marginBottom: 8, color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1.3 },
  whenRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  timeBtn: { flex: 0.7 },
  seatPillRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  seatPillActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  seatPillTextActive: { color: colors.textInverse },
  priceDollar: { color: colors.primary, fontSize: 28, fontWeight: '300', marginRight: 8 },
  suggestedWrap: { alignItems: 'flex-end', maxWidth: 142 },
  suggestedLabel: { color: colors.textSecondary, fontSize: 8, fontWeight: '800', letterSpacing: 0.8 },
  capMiniBanner: { marginHorizontal: 20, marginTop: 8, borderRadius: 14, backgroundColor: colors.bgSecondary, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.border },
  capMiniText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  continueBtn: { marginHorizontal: 20, marginTop: 16, height: 54, borderRadius: 27, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  continueText: { color: colors.textInverse, fontSize: 16, fontWeight: '800' },
  // ── Header ────────────────────────────────────────────────────────────────
  hdr:            { flexDirection:'row', alignItems:'center', paddingHorizontal:16, paddingTop:8, paddingBottom:14 },
  backBtn:        { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bgCard, alignItems:'center', justifyContent:'center', borderWidth: 1, borderColor: colors.border },
  pageIntro:      { paddingHorizontal:20, paddingTop:10, paddingBottom:14 },
  pageTitle:      { fontSize:24, lineHeight:30, fontWeight:'700', color:colors.textPrimary, letterSpacing:-0.25 },
  hdrTitle:       { fontSize:22, fontWeight:'800', color:colors.textPrimary, letterSpacing:-0.5 },
  hdrSub:         { fontSize:12, color:colors.textSecondary, marginTop:1 },
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
  mapInfoBar:     { position:'absolute', bottom:0, left:0, right:0, flexDirection:'row', alignItems:'center', padding:14, borderTopWidth:1, borderTopColor:'rgba(0,0,0,0.1)' },
  mapInfoTitle:   { color:'white', fontSize:15, fontWeight:'800' },
  mapInfoSub:     { color:'rgba(255,255,255,0.5)', fontSize:12, marginTop:2 },
  mapEarnBadge:   { alignItems:'center', backgroundColor:'rgba(244,98,31,0.15)', borderRadius:12, paddingHorizontal:10, paddingVertical:6, borderWidth:1, borderColor:'rgba(244,98,31,0.3)' },
  mapEarnLabel:   { color:'rgba(255,255,255,0.5)', fontSize:10, fontWeight:'600' },
  mapEarnValue:   { color:colors.primary, fontSize:16, fontWeight:'800' },
  // ── Demand Strip ──────────────────────────────────────────────────────────
  demandStrip:    { marginHorizontal:16, marginBottom:16, backgroundColor:colors.bgSecondary, borderRadius:14, borderWidth:1, borderColor:colors.border, paddingVertical:8, paddingHorizontal:12, gap:6 },
  demandItem:     { flexDirection:'row', alignItems:'center', gap:6 },
  demandText:     { color:colors.textSecondary, fontSize:12 },
  // ── Glass Cards ───────────────────────────────────────────────────────────
  glassCard:      { marginHorizontal:16, marginBottom:14, borderRadius:22, borderWidth:1.5, borderColor:colors.border, overflow:'hidden', backgroundColor:colors.bgCard, shadowColor:colors.textPrimary, shadowOffset:{width:0,height:3}, shadowOpacity:0.07, shadowRadius:12, elevation:3 },
  glassCardInner: { padding:18 },
  cardHdr:        { flexDirection:'row', alignItems:'center', gap:10, marginBottom:16 },
  cardIconWrap:   { width:32, height:32, borderRadius:10, alignItems:'center', justifyContent:'center' },
  cardTitle:      { fontSize:16, fontWeight:'800', color:colors.textPrimary, flex:1, letterSpacing:-0.3 },
  // ── Route ─────────────────────────────────────────────────────────────────
  connectorCol:   { width:18, alignItems:'center', paddingTop:30, paddingBottom:20 },
  connectorDot:   { width:10, height:10, borderRadius:5 },
  connectorLine:  { width:2, flex:1, marginVertical:4, backgroundColor:colors.border },
  quickActionsRow:{ flexDirection:'row', gap:10, marginTop:12 },
  quickBtn:       { flexDirection:'row', alignItems:'center', gap:6, paddingHorizontal:14, paddingVertical:9, borderRadius:12, borderWidth:1, borderColor:colors.primaryBorder, backgroundColor:colors.primaryDim },
  quickBtnText:   { fontSize:13, fontWeight:'600', color:colors.primary },
  infoStrip:      { flexDirection:'row', backgroundColor:colors.bgSecondary, borderRadius:14, padding:12, marginTop:14, alignItems:'center' },
  infoStripItem:  { flex:1, alignItems:'center', gap:3 },
  infoStripDiv:   { width:1, height:32, backgroundColor:colors.border },
  infoStripLabel: { fontSize:9, fontWeight:'700', color:colors.textSecondary, letterSpacing:0.8, textTransform:'uppercase' },
  infoStripVal:   { fontSize:15, fontWeight:'800', color:colors.textPrimary },
  // ── Schedule ──────────────────────────────────────────────────────────────
  scheduleBtn:    { flex:1, flexDirection:'row', alignItems:'center', gap:10, backgroundColor:colors.bgSecondary, borderRadius:14, padding:12, borderWidth:1, borderColor:colors.border },
  scheduleBtnFilled: { borderColor:colors.primaryBorder, backgroundColor:colors.primaryDim },
  scheduleIconWrap: { width:36, height:36, borderRadius:10, alignItems:'center', justifyContent:'center' },
  scheduleLabel:  { fontSize:9, fontWeight:'700', color:colors.textSecondary, letterSpacing:0.8, textTransform:'uppercase', marginBottom:2 },
  scheduleValue:  { fontSize:14, fontWeight:'700', color:colors.textPrimary },
  schedulePlaceholder: { color:colors.textSecondary, fontWeight:'500' },
  // ── Seats ─────────────────────────────────────────────────────────────────
  popularTag:     { backgroundColor:colors.primaryDim, borderRadius:12, paddingHorizontal:8, paddingVertical:3 },
  popularTagText: { color:colors.primary, fontSize:11, fontWeight:'700' },
  seatRow:        { flexDirection:'row', gap:12 },
  seatBtn:        { flex:1, borderRadius:16, borderWidth:1.5, borderColor:colors.border, backgroundColor:colors.bgSecondary, padding:14, alignItems:'center', gap:8 },
  seatBtnActive:  { borderColor:colors.primaryBorder, backgroundColor:colors.primaryDim },
  seatIconRow:    { flexDirection:'row', gap:6 },
  seatIconWrap:   { width:38, height:38, borderRadius:12, backgroundColor:colors.border, alignItems:'center', justifyContent:'center' },
  seatIconWrapActive: { backgroundColor:colors.primaryDim },
  seatBtnLabel:   { fontSize:15, fontWeight:'600', color:colors.textSecondary },
  seatBtnSub:     { fontSize:11, color:colors.textSecondary, textAlign:'center' },
  // ── Pricing ───────────────────────────────────────────────────────────────
  aiTag:          { backgroundColor:colors.amberDim, borderRadius:12, paddingHorizontal:8, paddingVertical:3 },
  aiTagText:      { color:colors.amber, fontSize:11, fontWeight:'700' },
  priceRangeWrap: { marginBottom:14 },
  priceRangeBar:  { height:4, backgroundColor:colors.border, borderRadius:2, marginBottom:6, overflow:'hidden' },
  priceRangeFill: { height:'100%' as any, backgroundColor:colors.primary, borderRadius:2 },
  priceRangeLabel:{ fontSize:12, color:colors.textSecondary },
  priceInputRow:  { flexDirection:'row', alignItems:'center', borderRadius:14, borderWidth:1.5, borderColor:colors.border, backgroundColor:colors.bgCard, overflow:'hidden', marginBottom:12 },
  priceDollarBox: { paddingHorizontal:16, paddingVertical:16, backgroundColor:colors.primaryDim, alignItems:'center', justifyContent:'center' },
  priceInput:     { flex:1, fontSize:22, fontWeight:'700', color:colors.textPrimary, paddingHorizontal:12, paddingVertical:14 },
  pricePerSeat:   { paddingRight:16, fontSize:14, color:colors.textSecondary, fontWeight:'500' },
  earningsRow:    { flexDirection:'row', gap:12, marginBottom:10 },
  earningsItem:   { flex:1, backgroundColor:colors.bgSecondary, borderRadius:12, padding:12, alignItems:'center' },
  earningsLabel:  { fontSize:11, color:colors.textSecondary, fontWeight:'500', marginBottom:4 },
  earningsValue:  { fontSize:18, fontWeight:'800', color:colors.textPrimary },
  priceHintText:  { fontSize:12, color:colors.textSecondary },
  capBanner:      { marginTop:8, paddingVertical:8, paddingHorizontal:12, borderRadius:10, backgroundColor:colors.greenDim, borderWidth:1, borderColor:colors.greenBorder },
  capBannerText:  { color:colors.green, fontSize:12, fontWeight:'600' },
  // ── Ride Vibe ─────────────────────────────────────────────────────────────
  optionalTag:    { fontSize:11, color:colors.textSecondary, backgroundColor:colors.bgSecondary, paddingHorizontal:8, paddingVertical:3, borderRadius:8 },
  vibeSubLabel:   { fontSize:13, color:colors.textSecondary, marginBottom:12 },
  vibeChipsRow:   { flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:14 },
  vibeChip:       { paddingHorizontal:12, paddingVertical:8, borderRadius:20, backgroundColor:colors.bgSecondary, borderWidth:1, borderColor:colors.border },
  vibeChipActive: { backgroundColor:colors.purpleDim, borderColor:colors.purpleBorder },
  vibeChipText:   { fontSize:13, color:colors.textSecondary, fontWeight:'500' },
  vibeChipTextActive: { color:colors.purple, fontWeight:'700' },
  notesInput:     { backgroundColor:colors.bgCard, borderRadius:12, borderWidth:1, borderColor:colors.border, padding:12, fontSize:14, color:colors.textPrimary, minHeight:64, textAlignVertical:'top' },
  // ── Campus Activity ───────────────────────────────────────────────────────
  campusActivityTitle: { fontSize:15, fontWeight:'800', color:colors.textPrimary, marginBottom:12 },
  campusActivityRow:   { flexDirection:'row', alignItems:'center', paddingVertical:10, gap:10 },
  campusActivityDot:   { width:6, height:6, borderRadius:3, backgroundColor:colors.primary, flexShrink:0 },
  campusActivityText:  { flex:1, fontSize:13, color:colors.textSecondary },
  // ── GO LIVE Button ────────────────────────────────────────────────────────
  goLiveBtn:      { height:60, borderRadius:22, flexDirection:'row', alignItems:'center', justifyContent:'center', overflow:'hidden', marginBottom:10 },
  goLiveGlow:     { borderRadius:22, backgroundColor:colors.primary, shadowColor:colors.primary, shadowOpacity:0.8, shadowRadius:30, shadowOffset:{width:0,height:0} },
  goLiveBtnText:  { color:'white', fontSize:20, fontWeight:'900', letterSpacing:1 },
  goLiveArrow:    { position:'absolute', right:20, width:34, height:34, borderRadius:17, backgroundColor:'rgba(255,255,255,0.2)', alignItems:'center', justifyContent:'center' },
  goLiveSubText:  { textAlign:'center', fontSize:12, color:colors.textSecondary, marginBottom:4 },
  // ── Autocomplete (dark themed) ────────────────────────────────────────────
  label: { fontSize:12, fontWeight:'600', color:colors.textSecondary, marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 },
  input: { backgroundColor:colors.bgCard, borderWidth:1, borderColor:colors.border, borderRadius:14, paddingHorizontal:14, paddingVertical:12, fontSize:15, color:colors.textPrimary },
  autoWrap: { position:'relative', marginBottom:10 },
  autoPanel: { position:'absolute', top:54, left:0, right:0, backgroundColor:colors.bgCard, borderRadius:16, borderWidth:1, borderColor:colors.border, maxHeight:268, overflow:'hidden', elevation:24, shadowColor:colors.textPrimary, shadowOffset:{width:0,height:10}, shadowOpacity:0.12, shadowRadius:18, zIndex:999 },
  autoItem:       { minHeight:56, paddingHorizontal:12, paddingVertical:10, borderBottomWidth:1, borderBottomColor:colors.border, flexDirection:'row', alignItems:'center', gap:10 },
  autoIconWrap:   { width:28, height:28, borderRadius:14, backgroundColor:colors.primaryDim, alignItems:'center', justifyContent:'center', flexShrink:0 },
  autoItemRow:    { flex:1, minWidth:0 },
  autoMainText: { color:colors.textPrimary, fontSize:14, lineHeight:18, fontWeight:'700' },
  autoSecondaryText: { color:colors.textSecondary, fontSize:12, lineHeight:16, marginTop:2, fontWeight:'500' },
  autoText: { color:colors.textPrimary, fontSize:14 },
  autoStateRow:   { minHeight:54, paddingHorizontal:12, paddingVertical:12, flexDirection:'row', alignItems:'center', gap:10 },
  autoEmpty:      { padding:14 },
  placesEmptyText:{ flex:1, color:colors.textSecondary, fontSize:13, lineHeight:18, fontWeight:'600' },
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
  suggestionsPanel:   { backgroundColor:colors.bgCard, borderWidth:1, borderColor:colors.border, borderRadius:12, marginTop:8, overflow:'hidden', position:'absolute', top:48, left:0, right:0, zIndex:10 },
  suggestionItem:     { paddingHorizontal:14, paddingVertical:10, borderBottomWidth:1, borderBottomColor:colors.border, backgroundColor:colors.bgCard },
  suggestionText:     { fontSize:14, color:colors.textPrimary, fontWeight:'600' },
  suggestionSub:      { fontSize:12, color:colors.textSecondary },
  inputWrapper:       { position:'relative' },
  textArea:           { height:100, textAlignVertical:'top' },
  section:            { marginBottom:16 },
  pickerWrap:         { borderWidth:1, borderColor:colors.border, borderRadius:12, overflow:'hidden' },
  chipsRow:           { flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:8 },
  chip:               { backgroundColor:colors.bgSecondary, borderRadius:16, paddingHorizontal:10, paddingVertical:6 },
  chipText:           { fontSize:12, color:colors.textPrimary, fontWeight:'600' },
  // ── Legacy compat (unused but kept for safety) ────────────────────────────
  keyboardAvoid:  { flex:1 },
  safeArea:       { flex:1 },
  flex:           { flex:1 },
  header:         { padding:16, paddingBottom:0 },
  headerTitle:    { fontSize:28, fontWeight:'bold', marginBottom:4, color:colors.textPrimary },
  headerSubtitle: { fontSize:16, color:colors.textSecondary },
  scrollArea:     { flex:1 },
  scrollContent:  { padding:16, paddingBottom:40 },
  card:           { backgroundColor:colors.bgCard, borderRadius:18, padding:18, marginBottom:14, borderWidth:1, borderColor:colors.border },
  cardHeader:     { flexDirection:'row', alignItems:'center', gap:10, marginBottom:16 },
  routeContainer: { flexDirection:'row', gap:14 },
  routeLineCol:   { width:20, alignItems:'center', paddingTop:28, paddingBottom:28 },
  routeDot:       { width:12, height:12, borderRadius:6 },
  routeLine:      { width:2, flex:1, marginVertical:4 },
  routeInputCol:  { flex:1 },
  routeInputWrap: { marginBottom:2 },
  quickActions:   { flexDirection:'row', gap:10, marginTop:8 },
  infoStripDivider:{ width:1, height:36, marginHorizontal:8 },
  infoStripValue: { fontSize:17, fontWeight:'800', color:colors.textPrimary },
  scheduleRow:    { flexDirection:'row', gap:12 },
  scheduleInput:  { flex:1, flexDirection:'row', alignItems:'center', backgroundColor:colors.bgSecondary, borderRadius:12, padding:14, gap:12, borderWidth:1, borderColor:colors.border },
  scheduleTextWrap:{ flex:1 },
  seatsRow:       { flexDirection:'row', gap:12, marginBottom:4 },
  seatOption:     { flex:1, flexDirection:'row', alignItems:'center', gap:10, paddingVertical:14, paddingHorizontal:16, borderRadius:12, borderWidth:1.5, borderColor:colors.border, backgroundColor:colors.bgSecondary },
  seatOptionActive:{ borderWidth:2 },
  seatOptionText: { fontSize:15, fontWeight:'600', color:colors.textSecondary },
  fieldLabel:     { fontSize:14, fontWeight:'600', color:colors.textSecondary, marginBottom:10 },
  priceHint:      { marginTop:8, fontSize:12, fontWeight:'500', color:colors.textSecondary },
  optionalBadge:  { fontSize:11, fontWeight:'600', color:colors.textSecondary, backgroundColor:colors.bgSecondary, paddingHorizontal:8, paddingVertical:3, borderRadius:6, overflow:'hidden' },
  submitBtn:      { flexDirection:'row', alignItems:'center', justifyContent:'center', borderRadius:16, paddingVertical:18, marginTop:4 },
  submitBtnDisabled:{ opacity:0.5 },
  submitBtnText:  { color:colors.textInverse, fontSize:18, fontWeight:'700', letterSpacing:0.3 },
  bannerInfo:     { marginTop:8, paddingVertical:8, paddingHorizontal:12, borderRadius:10, backgroundColor:colors.greenDim, borderWidth:1, borderColor:colors.greenBorder },
  bannerInfoText: { color:colors.green, fontSize:12, fontWeight:'600' },
  pricePrefix:    { paddingHorizontal:16, paddingVertical:14, justifyContent:'center', alignItems:'center' },
  pricePrefixText:{ fontSize:20, fontWeight:'800' },
  mapLoadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems:'center', justifyContent:'center', backgroundColor:`${colors.bg}99` },
  mapPinWrap: { width:30, height:30, borderRadius:15, alignItems:'center', justifyContent:'center', backgroundColor:colors.bgCard, borderWidth:2, borderColor:colors.bgCard, shadowColor:'#000', shadowOpacity:0.18, shadowRadius:8, shadowOffset:{width:0,height:4}, elevation:5 },
  mapPin: { width:14, height:14, borderRadius:7 },
  }), [colors]);
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ pickup?: string; dropoff?: string; date?: string; time?: string }>();
  const paramText = (value?: string | string[]) => Array.isArray(value) ? value[0] || '' : value || '';
  const [date, setDate] = useState(() => paramText(params.date));
  const [time, setTime] = useState(() => paramText(params.time));
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
  const [pickupLocation, setPickupLocation] = useState(() => paramText(params.pickup));
  const [dropoffLocation, setDropoffLocation] = useState(() => paramText(params.dropoff));
  const [contribution, setContribution] = useState('');
  const [priceEdited, setPriceEdited] = useState(false);
  // seats limited to 1 or 2
  const [seats, setSeats] = useState<1 | 2>(1);
  const [maxPrice, setMaxPrice] = useState<number>(0);
  const [showCapBanner, setShowCapBanner] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Recurring ride state
  const [isRecurring, setIsRecurring] = useState(false);
  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
  const [recurringDays, setRecurringDays] = useState<number[]>([]);
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

  const incomingPickup = paramText(params.pickup);
  const incomingDropoff = paramText(params.dropoff);
  const incomingDate = paramText(params.date);
  const incomingTime = paramText(params.time);

  useEffect(() => {
    if (incomingPickup || incomingDropoff) {
      setPickupCoords(null);
      setDropoffCoords(null);
      setDistanceText('--');
      setDurationText('--');
      setDistanceMiles(null);
      setDurationMinutes(null);
      setContribution('');
      setPriceEdited(false);
    }

    setPickupLocation(incomingPickup);
    setDropoffLocation(incomingDropoff);
    setDate(incomingDate);
    setTime(incomingTime);
  }, [incomingPickup, incomingDropoff, incomingDate, incomingTime]);

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
      return result;
    }
    // If already 24h 'HH:mm'
    const m2 = /^(\d{1,2}):(\d{1,2})$/.exec(trimmed);
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
        const [year, month, day] = d.split('-').map(n => parseInt(n, 10));
        const [hours, minutes] = t24.split(':').map(n => parseInt(n, 10));
        const dt = new Date(year, month - 1, day, hours, minutes || 0);
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

      // Check student verification status before allowing post.
      // Check both drivers and riders docs — a driver upgraded from a rider-only
      // account may only have verification on the riders side, and vice versa.
      try {
        const [driverDoc, riderDoc] = await Promise.all([
          getDoc(doc(firestore, 'drivers', user.uid)),
          getDoc(doc(firestore, 'riders', user.uid)),
        ]);
        const driverData = driverDoc.exists() ? driverDoc.data() : null;
        const riderData  = riderDoc.exists()  ? riderDoc.data()  : null;
        const isVerified =
          driverData?.isVerified === true ||
          riderData?.isVerified  === true ||
          ['approved','auto-approved'].includes(String(driverData?.verificationStatus||'').toLowerCase()) ||
          ['approved','auto-approved'].includes(String(riderData?.verificationStatus||'').toLowerCase());
        const verificationDeadline = driverData?.verificationDeadline ?? riderData?.verificationDeadline;
        const isPastDeadline = verificationDeadline
          ? new Date() > (typeof verificationDeadline?.toDate === 'function' ? verificationDeadline.toDate() : new Date(verificationDeadline))
          : false;

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
      } catch (e) {
        console.warn('verification check error', e);
      }

      // Basic validation
      if (!pickupLocation.trim() || !dropoffLocation.trim()) {
        Alert.alert('Missing info', 'Please enter both pickup and dropoff locations.');
        return;
      }
      if (isRecurring && recurringDays.length === 0) {
        Alert.alert('Select days', 'Please select at least one day of the week for the recurring schedule.');
        return;
      }
      if (!isRecurring && !date.trim()) {
        Alert.alert('Missing date', 'Please select a date for this ride.');
        return;
      }

      setSubmitting(true);

      let submitPickupCoords = pickupCoords;
      let submitDropoffCoords = dropoffCoords;

      if (!submitPickupCoords) {
        submitPickupCoords = await geocodeAddress(pickupLocation);
        if (submitPickupCoords) setPickupCoords(submitPickupCoords);
      }

      if (!submitDropoffCoords) {
        submitDropoffCoords = await geocodeAddress(dropoffLocation);
        if (submitDropoffCoords) setDropoffCoords(submitDropoffCoords);
      }

      if (!submitPickupCoords || !submitDropoffCoords) {
        Alert.alert(
          'Select locations',
          'Please choose pickup and dropoff from the suggestions so we can place your ride on the map.'
        );
        return;
      }

      let submitDistanceMiles = distanceMiles;
      let submitDurationMinutes = durationMinutes;
      let submitDistanceText = distanceText;
      let submitDurationText = durationText;
      if (submitDistanceMiles == null || submitDurationMinutes == null) {
        const metrics = await fetchRouteMetricsForCoords(submitPickupCoords, submitDropoffCoords);
        if (metrics) {
          submitDistanceMiles = metrics.distanceMiles;
          submitDurationMinutes = metrics.durationMinutes;
          submitDistanceText = metrics.distanceText || '--';
          submitDurationText = metrics.durationText || '--';
          setDistanceMiles(metrics.distanceMiles);
          setDurationMinutes(metrics.durationMinutes);
          setDistanceText(metrics.distanceText || '--');
          setDurationText(metrics.durationText || '--');
        }
      }

      // Parse contribution (price per seat)
      const priceNum = (() => {
        const n = Number(String(contribution).replace(/[^0-9.\-]/g, ''));
        return isNaN(n) ? null : n;
      })();

      // Seats already constrained to 1 or 2
      const seatsNum: 1 | 2 = seats >= 2 ? 2 : 1;

      const dist = typeof submitDistanceMiles === 'number' ? submitDistanceMiles : 0;
      const fallbackDriverPrice = computeDriverMaxPrice(dist, seatsNum);
      const resolvedPriceNum = priceNum && priceNum > 0 ? priceNum : fallbackDriverPrice;
      if (!resolvedPriceNum || resolvedPriceNum <= 0) {
        Alert.alert('Invalid price', 'Please enter a valid price per seat.');
        return;
      }

      if (seatsNum == null || seatsNum <= 0 || seatsNum > 2) {
        Alert.alert('Invalid seats', 'Available seats must be 1 or 2.');
        return;
      }

      // Enforce max price cap based on distance & seats
      const cap = computeMaxPrice(dist, seatsNum);
      if (cap > 0 && resolvedPriceNum > cap) {
        Alert.alert('Price exceeds maximum', `The maximum for ${seatsNum} seat(s) is $${cap.toFixed(2)} based on ${dist ? dist.toFixed(1) : '--'} mi.`);
        return;
      }

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

        pickupGeo: submitPickupCoords
          ? {
              address: pickupLocation || null,
              latitude: submitPickupCoords.lat,
              longitude: submitPickupCoords.lng,
              lat: submitPickupCoords.lat,
              lng: submitPickupCoords.lng,
            }
          : null,

        dropoffGeo: submitDropoffCoords
          ? {
              address: dropoffLocation || null,
              latitude: submitDropoffCoords.lat,
              longitude: submitDropoffCoords.lng,
              lat: submitDropoffCoords.lat,
              lng: submitDropoffCoords.lng,
            }
          : null,

        pickupCoords: submitPickupCoords || null,
        dropoffCoords: submitDropoffCoords || null,
        pickupLat: submitPickupCoords?.lat ?? null,
        pickupLng: submitPickupCoords?.lng ?? null,
        dropoffLat: submitDropoffCoords?.lat ?? null,
        dropoffLng: submitDropoffCoords?.lng ?? null,
        date: date || null,
        time: time || null,
        departureTime: requestedTime || null,
        availableSeats: seatsNum,
        pricePerSeat: resolvedPriceNum,
        postType: 'ride_offer',
        // Legacy fallbacks some lists use
        contributionAmount: resolvedPriceNum,
        estimatedFare: null,
        notes: notes || null,
        rideVibe: selectedVibes,
        preferences: selectedVibes,
        // Include distance/duration details if available
        distance: (submitDistanceText || submitDistanceMiles != null) ? {
          text: submitDistanceText || null,
          miles: submitDistanceMiles != null ? Number(submitDistanceMiles.toFixed(3)) : null,
          meters: submitDistanceMiles != null ? Math.round(submitDistanceMiles * 1609.34) : null,
        } : null,
        duration: (submitDurationText || submitDurationMinutes != null) ? {
          text: submitDurationText || null,
          minutes: submitDurationMinutes != null ? Number(submitDurationMinutes.toFixed(3)) : null,
          seconds: submitDurationMinutes != null ? Math.round((submitDurationMinutes || 0) * 60) : null,
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

      // Call backend API
      const apiUrl = getApiBaseUrl();
      try {
        // Recurring schedule path
        if (isRecurring) {
          const token = await firebaseAuth.currentUser?.getIdToken();
          const schedulePayload = {
            from: pickupLocation,
            to: dropoffLocation,
            fromCoords: submitPickupCoords,
            toCoords: submitDropoffCoords,
            departureTime: time ? to24h(time) : '09:00',
            daysOfWeek: recurringDays,
            seats: seatsNum,
            pricePerSeat: resolvedPriceNum,
            notes: notes.trim() || null,
            vehicleInfo: payload.vehicleInfo || null,
          };
          const scheduleRes = await fetch(`${apiUrl}/api/ride-schedules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify(schedulePayload),
          });
          const scheduleResult = await scheduleRes.json();
          if (!scheduleRes.ok) throw new Error(scheduleResult.error || 'Failed to create recurring schedule');
          Alert.alert('Recurring ride scheduled!', `Your ride will repeat on selected days. ${scheduleResult.instancesCreated} upcoming rides have been posted.`, [{ text: 'OK', onPress: () => router.replace('/(driver)' as any) }]);
          return;
        }

        // One-time posting path
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
                price: String(resolvedPriceNum),
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
        setPriceEdited(false);
        setSeats(1);
        setNotes('');

        Alert.alert('Ride Posted!', 'Your ride is now visible to riders.');
        router.replace('/(driver)' as any);
      } catch (apiError: any) {
        console.error('Ride posting API error:', apiError);
        throw apiError;
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

  const applyCurrentLocation = async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    try {
      setLocLoading(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (!silent) {
          Alert.alert('Permission required', 'Location permission is needed to use your current location.');
        }
        return;
      }
      const pos =
        (await Location.getLastKnownPositionAsync()) ||
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      if (!pos) return;
      const results = await Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
  const r = results?.[0];
  const address = r ? [r.name, r.street, r.city, r.region].filter(Boolean).join(', ') : 'Current location';
  setPickupLocation(address);
  setPickupCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch (e) {
      if (!silent) {
        Alert.alert('Location error', 'Could not get your location. Please try again.');
      }
    } finally {
      setLocLoading(false);
    }
  };

  useEffect(() => {
    if (pickupLocation.trim()) return;
    applyCurrentLocation({ silent: true });
  }, [pickupLocation]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const pickupText = pickupLocation.trim();
      const dropoffText = dropoffLocation.trim();
      if (!pickupText || !dropoffText) {
        setDistanceText('--');
        setDurationText('--');
        setDistanceMiles(null);
        setDurationMinutes(null);
        return;
      }
      if (pickupCoords && dropoffCoords) return;

      setCalcLoading(true);
      const [nextPickupCoords, nextDropoffCoords] = await Promise.all([
        pickupCoords ? Promise.resolve(pickupCoords) : geocodeAddress(pickupText),
        dropoffCoords ? Promise.resolve(dropoffCoords) : geocodeAddress(dropoffText),
      ]);
      if (cancelled) return;
      if (nextPickupCoords) setPickupCoords(nextPickupCoords);
      if (nextDropoffCoords) setDropoffCoords(nextDropoffCoords);
      if (!nextPickupCoords || !nextDropoffCoords) {
        setDistanceText('--');
        setDurationText('--');
        setDistanceMiles(null);
        setDurationMinutes(null);
        setCalcLoading(false);
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pickupLocation, dropoffLocation, pickupCoords, dropoffCoords]);

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
        setDistanceMiles(null);
        setDurationMinutes(null);
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
    if (!isNaN(priceNum) && cap > 0 && priceNum > cap) {
      setContribution(cap.toFixed(2));
      setPriceEdited(false);
      setShowCapBanner(`Price capped at $${cap.toFixed(2)} for ${s} seat(s).`);
      setTimeout(() => setShowCapBanner(null), 2500);
    } else if (!priceEdited && cap > 0) {
      setContribution(cap.toFixed(2));
    }
  }, [seats, distanceMiles, contribution, priceEdited]);

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

  const [selectedVibes] = useState<string[]>([]);

  // ── Smart pricing computed ────────────────────────────────────────────────
  const priceNum = Number(String(contribution).replace(/[^0-9.]/g, '')) || 0;
  const totalEarnings = priceNum > 0 ? (priceNum * seats).toFixed(2) : null;
  const uberEstimate = distanceMiles && distanceMiles > 0
    ? (distanceMiles * 2.1 + 2.5).toFixed(2) : null;
  const riderSavings = uberEstimate && priceNum > 0
    ? Math.max(0, Number(uberEstimate) - priceNum).toFixed(2) : null;
  const routeIsReady = !!(pickupLocation && dropoffLocation && pickupCoords && dropoffCoords);
  const suggestedText = distanceMiles && distanceMiles > 0
    ? formatContributionRange(distanceMiles, seats)
    : 'Select route to estimate';


  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
    >
      <StatusBar barStyle={colors.statusBar} />

      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>

          <FlatList
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 88 + insets.bottom }}
            data={[0]}
            ListHeaderComponent={(
              <View>
                <View style={styles.pageIntro}>
                  <Text style={styles.pageTitle}>Post a ride</Text>
                </View>

                <View style={styles.formCard}>
                  <View style={styles.routeMiniRow}>
                    <View style={styles.routeDots}>
                      <View style={[styles.routeMiniDot, { backgroundColor: colors.textPrimary }]} />
                      <View style={styles.routeMiniLine} />
                      <Text style={styles.stopPlus}>+</Text>
                      <View style={styles.routeMiniLine} />
                      <View style={[styles.routeMiniDot, { backgroundColor: colors.primary }]} />
                    </View>

                    <View style={styles.routeFields}>
                      <AddressAutocomplete
                        label=""
                        placeholder="Austin, TX"
                        value={pickupLocation}
                        onChangeText={(t) => {
                          setPickupLocation(t);
                          setPickupCoords(null);
                        }}
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
                        onChangeText={(t) => {
                          setDropoffLocation(t);
                          setDropoffCoords(null);
                        }}
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
                  <TouchableOpacity style={styles.ceoInputBtn} onPress={() => setCalendarOpen(true)}>
                    <Text style={[styles.ceoInputText, !date && styles.ceoInputPlaceholder]}>{date ? formatDateLabel(date) : 'Fri, Nov 20'}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={[styles.ceoInputBtn, styles.timeBtn]} onPress={() => setTimeOpen(true)}>
                    <Text style={[styles.ceoInputText, !time && styles.ceoInputPlaceholder]}>{time || '3:00 PM'}</Text>
                  </TouchableOpacity>
                </View>

                <DatePickerModal
                  visible={calendarOpen}
                  selectedDate={date}
                  onClose={() => setCalendarOpen(false)}
                  onSelect={setDate}
                />

                <TimePickerModal
                  visible={timeOpen}
                  selectedTime={time}
                  onClose={() => setTimeOpen(false)}
                  onSelect={setTime}
                />

                <Text style={styles.fieldGroupLabel}>SEATS AVAILABLE</Text>
                <View style={styles.seatPillRow}>
                  {([1, 2] as const).map((n) => (
                    <TouchableOpacity
                      key={n}
                      onPress={() => setSeats(n)}
                      style={[styles.seatPill, seats === n && styles.seatPillActive]}
                    >
                      <Text style={[styles.seatPillText, seats === n && styles.seatPillTextActive]}>{n}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fieldGroupLabel}>PRICE PER SEAT</Text>
                <View style={styles.priceBox}>
                  <Text style={styles.priceDollar}>$</Text>
                  <TextInput
                    value={contribution}
                    onChangeText={(value) => {
                      setPriceEdited(true);
                      setContribution(value);
                    }}
                    placeholder="28"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="decimal-pad"
                    style={styles.priceInputCeo}
                  />

                  <View style={styles.suggestedWrap}>
                    <Text style={styles.suggestedLabel}>MIN / MAX</Text>
                    <Text style={styles.suggestedText}>{suggestedText}</Text>
                  </View>
                </View>

                {maxPrice > 0 ? (
                  <View style={styles.capMiniBanner}>
                    <Text style={styles.capMiniText}>
                      Max allowed is ${maxPrice.toFixed(2)} per seat for this route.
                    </Text>
                  </View>
                ) : null}

                {/* ── Recurring ride ── */}
                <Text style={styles.fieldGroupLabel}>REPEAT WEEKLY</Text>
                <View style={{ marginHorizontal: 20, borderRadius: 18, borderWidth: 1, borderColor: isRecurring ? colors.primary : colors.border, backgroundColor: colors.bgCard, overflow: 'hidden', marginBottom: 4 }}>
                  {/* Toggle row */}
                  <TouchableOpacity
                    activeOpacity={0.75}
                    onPress={() => { setIsRecurring(v => !v); if (isRecurring) setRecurringDays([]); }}
                    style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 }}
                  >
                    <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: isRecurring ? colors.primaryDim : colors.bgSecondary, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="repeat-outline" size={18} color={isRecurring ? colors.primary : colors.textSecondary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.textPrimary, fontSize: 14, fontWeight: '700' }}>Post this ride every week</Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                        {isRecurring && recurringDays.length > 0
                          ? `Every ${recurringDays.map(d => DAY_LABELS[d]).join(', ')} · 8 weeks ahead`
                          : 'Automatically create instances 8 weeks out'}
                      </Text>
                    </View>
                    <Switch
                      value={isRecurring}
                      onValueChange={v => { setIsRecurring(v); if (!v) setRecurringDays([]); }}
                      trackColor={{ false: colors.border, true: colors.primaryDim }}
                      thumbColor={isRecurring ? colors.primary : '#fff'}
                    />
                  </TouchableOpacity>

                  {/* Day picker — only visible when toggled on */}
                  {isRecurring && (
                    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 16, paddingVertical: 14 }}>
                      <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1.3, marginBottom: 12 }}>REPEATS ON</Text>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        {(['Su','Mo','Tu','We','Th','Fr','Sa'] as const).map((abbr, idx) => {
                          const selected = recurringDays.includes(idx);
                          return (
                            <TouchableOpacity
                              key={idx}
                              onPress={() => setRecurringDays(prev => selected ? prev.filter(d => d !== idx) : [...prev, idx].sort())}
                              activeOpacity={0.7}
                              style={{
                                width: 38, height: 38, borderRadius: 19,
                                alignItems: 'center', justifyContent: 'center',
                                backgroundColor: selected ? colors.primary : colors.bgSecondary,
                                borderWidth: selected ? 0 : 1,
                                borderColor: colors.border,
                              }}
                            >
                              <Text style={{ fontSize: 12, fontWeight: '700', color: selected ? colors.textInverse : colors.textSecondary }}>{abbr}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      {recurringDays.length === 0 && (
                        <Text style={{ color: colors.red, fontSize: 12, marginTop: 10, fontWeight: '600' }}>Select at least one day</Text>
                      )}
                    </View>
                  )}
                </View>

                <Text style={styles.fieldGroupLabel}>NOTE FOR RIDERS (OPTIONAL)</Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Heading home for the weekend. Aux is open"
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  style={styles.notesCeo}
                />

                <TouchableOpacity
                  onPress={handleSubmit}
                  disabled={submitting || !isFormValid}
                  style={[styles.continueBtn, (submitting || !isFormValid) && styles.submitBtnDisabled]}
                >
                  {submitting ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.continueText}>{isRecurring ? `Schedule recurring ride →` : `Post ride →`}</Text>
                  )}
                </TouchableOpacity>

                <View style={{ height: 4 }} />
              </View>
            )}
            renderItem={() => null}
            keyExtractor={() => 'content'}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          />
        </SafeAreaView>
      <DriverBottomNav activeTab="offer" />
    </KeyboardAvoidingView>
  );
}



// (module-level styles moved into BookScreen useMemo)
const _REMOVED_STYLES_PLACEHOLDER = null;


