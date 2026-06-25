import React, { useEffect, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const NAVY = '#15233A';
const ORANGE = '#DE5D20';
const MUTED = '#8B94A6';
const BORDER = '#E5E0D8';
const BG = '#FBFAF7';

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function toYMD(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount);
  return next;
}

function monthGrid(date: Date) {
  const first = startOfMonth(date);
  const firstDay = first.getDay();
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const weeks: (Date | null)[][] = [];
  let cursor = 1 - firstDay;
  for (let row = 0; row < 6; row++) {
    const week: (Date | null)[] = [];
    for (let col = 0; col < 7; col++) {
      week.push(cursor < 1 || cursor > daysInMonth ? null : new Date(date.getFullYear(), date.getMonth(), cursor));
      cursor++;
    }
    weeks.push(week);
  }
  return weeks;
}

function parseSelectedDate(value?: string) {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function formatDateLabel(value?: string) {
  if (!value) return '';
  const parts = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const date = parts
    ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function parseTime(value?: string) {
  const now = new Date();
  if (!value) {
    const rounded = Math.ceil(now.getMinutes() / 15) * 15;
    let hour24 = now.getHours();
    let minute = rounded;
    if (minute >= 60) {
      minute = 0;
      hour24 = (hour24 + 1) % 24;
    }
    return { hour: hour24 % 12 || 12, minute, period: hour24 >= 12 ? 'PM' as const : 'AM' as const };
  }

  const match = value.trim().match(/^(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM)?$/i);
  if (!match) return { hour: 3, minute: 0, period: 'PM' as const };
  let hour = Number(match[1]);
  const minute = Math.max(0, Math.min(59, Number(match[2] || 0)));
  const period = (match[3]?.toUpperCase() === 'AM' ? 'AM' : 'PM') as 'AM' | 'PM';
  if (hour > 12) hour = hour % 12 || 12;
  if (hour < 1) hour = 12;
  return { hour, minute: Math.round(minute / 15) * 15 % 60, period };
}

export function DatePickerModal({
  visible,
  selectedDate,
  onClose,
  onSelect,
  title = 'Select date',
}: {
  visible: boolean;
  selectedDate?: string;
  onClose: () => void;
  onSelect: (value: string) => void;
  title?: string;
}) {
  const [month, setMonth] = useState(() => parseSelectedDate(selectedDate));
  useEffect(() => {
    if (visible) setMonth(parseSelectedDate(selectedDate));
  }, [selectedDate, visible]);

  const weeks = useMemo(() => monthGrid(month), [month]);
  const today = toYMD(new Date());
  const monthLabel = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalEyebrow}>Ride date</Text>
              <Text style={styles.modalTitle}>{title}</Text>
            </View>
            <TouchableOpacity style={styles.closeIcon} onPress={onClose} accessibilityRole="button">
              <Ionicons name="close" size={18} color={NAVY} />
            </TouchableOpacity>
          </View>

          <View style={styles.monthRow}>
            <TouchableOpacity style={styles.navButton} onPress={() => setMonth(addMonths(month, -1))}>
              <Ionicons name="chevron-back" size={18} color={NAVY} />
            </TouchableOpacity>
            <Text style={styles.monthLabel}>{monthLabel}</Text>
            <TouchableOpacity style={styles.navButton} onPress={() => setMonth(addMonths(month, 1))}>
              <Ionicons name="chevron-forward" size={18} color={NAVY} />
            </TouchableOpacity>
          </View>

          <View style={styles.weekdayRow}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
              <Text key={`${day}-${index}`} style={styles.weekday}>{day}</Text>
            ))}
          </View>

          {weeks.map((week, rowIndex) => (
            <View key={rowIndex} style={styles.dayRow}>
              {week.map((date, colIndex) => {
                const value = date ? toYMD(date) : '';
                const selected = !!date && value === selectedDate;
                const isToday = !!date && value === today;
                return (
                  <TouchableOpacity
                    key={`${rowIndex}-${colIndex}`}
                    disabled={!date}
                    style={[styles.dayButton, !date && styles.dayButtonEmpty, isToday && !selected && styles.dayButtonToday, selected && styles.dayButtonSelected]}
                    onPress={() => {
                      if (!date) return;
                      onSelect(value);
                      onClose();
                    }}
                  >
                    <Text style={[styles.dayText, selected && styles.dayTextSelected, isToday && !selected && styles.dayTextToday]}>{date ? date.getDate() : ''}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>
      </View>
    </Modal>
  );
}

export function TimePickerModal({
  visible,
  selectedTime,
  onClose,
  onSelect,
  title = 'Select time',
}: {
  visible: boolean;
  selectedTime?: string;
  onClose: () => void;
  onSelect: (value: string) => void;
  title?: string;
}) {
  const initial = parseTime(selectedTime);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [period, setPeriod] = useState<'AM' | 'PM'>(initial.period);

  useEffect(() => {
    if (!visible) return;
    const next = parseTime(selectedTime);
    setHour(next.hour);
    setMinute(next.minute);
    setPeriod(next.period);
  }, [selectedTime, visible]);

  const minuteOptions = [0, 15, 30, 45];
  const presetTimes = ['8:00 AM', '12:00 PM', '3:00 PM', '6:00 PM'];
  const value = `${hour}:${pad2(minute)} ${period}`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalEyebrow}>Ride time</Text>
              <Text style={styles.modalTitle}>{title}</Text>
            </View>
            <TouchableOpacity style={styles.closeIcon} onPress={onClose} accessibilityRole="button">
              <Ionicons name="close" size={18} color={NAVY} />
            </TouchableOpacity>
          </View>

          <View style={styles.timeDisplay}>
            <TouchableOpacity style={[styles.timeStepper, styles.timeStepperUp]} onPress={() => setHour((current) => current === 12 ? 1 : current + 1)}>
              <Ionicons name="chevron-up" size={18} color={ORANGE} />
            </TouchableOpacity>
            <Text style={styles.timeValue}>{hour}:{pad2(minute)}</Text>
            <TouchableOpacity style={styles.periodButton} onPress={() => setPeriod(period === 'AM' ? 'PM' : 'AM')}>
              <Text style={styles.periodText}>{period}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.timeStepper, styles.timeStepperDown]} onPress={() => setHour((current) => current === 1 ? 12 : current - 1)}>
              <Ionicons name="chevron-down" size={18} color={ORANGE} />
            </TouchableOpacity>
          </View>

          <View style={styles.minuteRow}>
            {minuteOptions.map((option) => (
              <TouchableOpacity key={option} style={[styles.minuteChip, minute === option && styles.minuteChipActive]} onPress={() => setMinute(option)}>
                <Text style={[styles.minuteChipText, minute === option && styles.minuteChipTextActive]}>{pad2(option)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.presetRow}>
            {presetTimes.map((preset) => (
              <TouchableOpacity key={preset} style={styles.presetChip} onPress={() => {
                const parsed = parseTime(preset);
                setHour(parsed.hour);
                setMinute(parsed.minute);
                setPeriod(parsed.period);
              }}>
                <Text style={styles.presetText}>{preset}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.primaryButton} onPress={() => { onSelect(value); onClose(); }}>
            <Text style={styles.primaryText}>Set time</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(21,35,58,0.32)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 390, borderRadius: 20, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 18, shadowColor: NAVY, shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.18, shadowRadius: 30, elevation: 18 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalEyebrow: { color: MUTED, fontSize: 11, lineHeight: 14, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  modalTitle: { color: NAVY, fontSize: 22, lineHeight: 28, fontWeight: '800', marginTop: 2 },
  closeIcon: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 16, backgroundColor: BG, padding: 8, marginBottom: 14 },
  navButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  monthLabel: { color: NAVY, fontSize: 15, fontWeight: '800' },
  weekdayRow: { flexDirection: 'row', marginBottom: 7 },
  weekday: { flex: 1, textAlign: 'center', color: MUTED, fontSize: 11, fontWeight: '800' },
  dayRow: { flexDirection: 'row', gap: 5, marginBottom: 5 },
  dayButton: { flex: 1, aspectRatio: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#F1EEE8' },
  dayButtonEmpty: { opacity: 0, borderWidth: 0 },
  dayButtonToday: { borderColor: ORANGE, backgroundColor: '#FFF7ED' },
  dayButtonSelected: { borderColor: ORANGE, backgroundColor: ORANGE },
  dayText: { color: NAVY, fontSize: 14, fontWeight: '700' },
  dayTextToday: { color: ORANGE },
  dayTextSelected: { color: '#FFFFFF', fontWeight: '900' },
  timeDisplay: { minHeight: 110, borderRadius: 18, backgroundColor: BG, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  timeValue: { color: NAVY, fontSize: 46, lineHeight: 54, fontWeight: '900' },
  timeStepper: { position: 'absolute', right: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  timeStepperUp: { top: 14 },
  timeStepperDown: { bottom: 14 },
  periodButton: { position: 'absolute', left: 16, top: 37, borderRadius: 18, backgroundColor: '#FEF0E8', paddingHorizontal: 13, paddingVertical: 8, borderWidth: 1, borderColor: '#F8CFB8' },
  periodText: { color: ORANGE, fontSize: 13, fontWeight: '900' },
  minuteRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  minuteChip: { flex: 1, height: 42, borderRadius: 13, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  minuteChipActive: { backgroundColor: NAVY, borderColor: NAVY },
  minuteChipText: { color: MUTED, fontSize: 14, fontWeight: '800' },
  minuteChipTextActive: { color: '#FFFFFF' },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  presetChip: { borderRadius: 14, backgroundColor: '#FEF0E8', paddingHorizontal: 11, paddingVertical: 8 },
  presetText: { color: ORANGE, fontSize: 12, fontWeight: '800' },
  primaryButton: { height: 50, borderRadius: 25, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
