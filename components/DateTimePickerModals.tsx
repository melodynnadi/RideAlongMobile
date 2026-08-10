import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '@/hooks/ThemeContext';
import type { AppColors } from '@/constants/theme';

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
  eyebrow,
  minDate,
  maxDate,
  initialDisplayDate,
}: {
  visible: boolean;
  selectedDate?: string;
  onClose: () => void;
  onSelect: (value: string) => void;
  title?: string;
  eyebrow?: string;
  minDate?: string;
  maxDate?: string;
  initialDisplayDate?: string;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [month, setMonth] = useState(() => parseSelectedDate(selectedDate || initialDisplayDate));
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  useEffect(() => {
    if (visible) {
      setMonth(parseSelectedDate(selectedDate || initialDisplayDate));
      setYearPickerOpen(false);
    }
  }, [selectedDate, visible, initialDisplayDate]);

  const weeks = useMemo(() => monthGrid(month), [month]);
  const today = toYMD(new Date());
  const monthLabel = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  // Bound the quick-jump year list by minDate/maxDate when given, otherwise
  // default to a wide range — this is what makes picking a birth year (or
  // any far-off date) a single tap instead of dozens of month-chevron taps.
  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const minYear = minDate ? Number(minDate.slice(0, 4)) : currentYear - 100;
    const maxYear = maxDate ? Number(maxDate.slice(0, 4)) : currentYear + 10;
    const list: number[] = [];
    for (let y = maxYear; y >= minYear; y--) list.push(y);
    return list;
  }, [minDate, maxDate]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.modalHeader}>
            <View>
              {eyebrow ? <Text style={styles.modalEyebrow}>{eyebrow}</Text> : null}
              <Text style={styles.modalTitle}>{title}</Text>
            </View>
            <TouchableOpacity style={styles.closeIcon} onPress={onClose} accessibilityRole="button">
              <Ionicons name="close" size={18} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.monthRow}>
            <TouchableOpacity
              style={styles.navButton}
              onPress={() => setMonth(addMonths(month, -1))}
              disabled={yearPickerOpen}
            >
              <Ionicons name="chevron-back" size={18} color={yearPickerOpen ? colors.textSecondary : colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setYearPickerOpen((open) => !open)} accessibilityRole="button">
              <Text style={styles.monthLabel}>{monthLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.navButton}
              onPress={() => setMonth(addMonths(month, 1))}
              disabled={yearPickerOpen}
            >
              <Ionicons name="chevron-forward" size={18} color={yearPickerOpen ? colors.textSecondary : colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {yearPickerOpen ? (
            <ScrollView style={styles.yearList} contentContainerStyle={styles.yearGrid}>
              {years.map((year) => {
                const selected = year === month.getFullYear();
                return (
                  <TouchableOpacity
                    key={year}
                    style={[styles.yearChip, selected && styles.yearChipSelected]}
                    onPress={() => {
                      const next = new Date(month);
                      next.setFullYear(year);
                      setMonth(next);
                      setYearPickerOpen(false);
                    }}
                  >
                    <Text style={[styles.yearChipText, selected && styles.yearChipTextSelected]}>{year}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : (
            <>
              <View style={styles.weekdayRow}>
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                  <Text key={`${day}-${index}`} style={styles.weekday}>{day}</Text>
                ))}
              </View>

              {weeks.map((week, rowIndex) => (
                <View key={rowIndex} style={styles.dayRow}>
                  {week.map((date, colIndex) => {
                    const value = date ? toYMD(date) : '';
                    const outOfRange = !!date && ((!!minDate && value < minDate) || (!!maxDate && value > maxDate));
                    const isDisabled = !date || outOfRange;
                    const selected = !!date && !outOfRange && value === selectedDate;
                    const isToday = !!date && value === today;
                    return (
                      <TouchableOpacity
                        key={`${rowIndex}-${colIndex}`}
                        disabled={isDisabled}
                        style={[
                          styles.dayButton,
                          !date && styles.dayButtonEmpty,
                          outOfRange && styles.dayButtonDisabled,
                          isToday && !selected && !outOfRange && styles.dayButtonToday,
                          selected && styles.dayButtonSelected,
                        ]}
                        onPress={() => {
                          if (isDisabled) return;
                          onSelect(value);
                          onClose();
                        }}
                      >
                        <Text style={[
                          styles.dayText,
                          outOfRange && styles.dayTextDisabled,
                          selected && styles.dayTextSelected,
                          isToday && !selected && !outOfRange && styles.dayTextToday,
                        ]}>
                          {date ? date.getDate() : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function parseTimeRange(value?: string) {
  if (value?.includes('–')) {
    const [fromStr, toStr] = value.split('–').map((s) => s.trim());
    return { mode: 'range' as const, from: parseTime(fromStr), to: parseTime(toStr) };
  }
  return { mode: 'exact' as const, from: parseTime(value), to: null };
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
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [mode, setMode] = useState<'exact' | 'range'>('exact');

  // FROM (or exact) time
  const [hour, setHour] = useState(3);
  const [minute, setMinute] = useState(0);
  const [period, setPeriod] = useState<'AM' | 'PM'>('PM');

  // TO time (range mode only)
  const [toHour, setToHour] = useState(5);
  const [toMinute, setToMinute] = useState(0);
  const [toPeriod, setToPeriod] = useState<'AM' | 'PM'>('PM');

  // Which side the shared controls (minute chips, steppers) are editing
  const [active, setActive] = useState<'from' | 'to'>('from');

  useEffect(() => {
    if (!visible) return;
    const parsed = parseTimeRange(selectedTime);
    setMode(parsed.mode);
    setHour(parsed.from.hour);
    setMinute(parsed.from.minute);
    setPeriod(parsed.from.period);
    if (parsed.to) {
      setToHour(parsed.to.hour);
      setToMinute(parsed.to.minute);
      setToPeriod(parsed.to.period);
    }
    setActive('from');
  }, [selectedTime, visible]);

  const switchToRange = () => {
    if (mode === 'range') return;
    // Default TO = FROM + 2 hours
    const from24 = period === 'PM' ? (hour === 12 ? 12 : hour + 12) : (hour === 12 ? 0 : hour);
    const to24 = (from24 + 2) % 24;
    setToHour(to24 % 12 || 12);
    setToMinute(minute);
    setToPeriod(to24 >= 12 ? 'PM' : 'AM');
    setMode('range');
    setActive('from');
  };

  const minuteOptions = [0, 15, 30, 45];
  const presetTimes = ['8:00 AM', '12:00 PM', '3:00 PM', '6:00 PM'];

  const fromValue = `${hour}:${pad2(minute)} ${period}`;
  const toValue = `${toHour}:${pad2(toMinute)} ${toPeriod}`;

  // Shared controls operate on whichever side is "active"
  const activeHour = active === 'from' ? hour : toHour;
  const activeMinute = active === 'from' ? minute : toMinute;
  const activePeriod = active === 'from' ? period : toPeriod;
  const stepActiveHour = (dir: 1 | -1) => {
    const fn = (h: number) => dir === 1 ? (h === 12 ? 1 : h + 1) : (h === 1 ? 12 : h - 1);
    if (active === 'from') setHour(fn); else setToHour(fn);
  };
  const setActiveMinute = (m: number) => { if (active === 'from') setMinute(m); else setToMinute(m); };
  const toggleActivePeriod = () => {
    if (active === 'from') setPeriod((p) => p === 'AM' ? 'PM' : 'AM');
    else setToPeriod((p) => p === 'AM' ? 'PM' : 'AM');
  };

  const handleConfirm = () => {
    onSelect(mode === 'range' ? `${fromValue} – ${toValue}` : fromValue);
    onClose();
  };

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
              <Ionicons name="close" size={18} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Mode toggle */}
          <View style={styles.modeToggle}>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'exact' && styles.modeBtnActive]}
              onPress={() => setMode('exact')}
              activeOpacity={0.8}
            >
              <Text style={[styles.modeBtnText, mode === 'exact' && styles.modeBtnTextActive]}>Exact time</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'range' && styles.modeBtnActive]}
              onPress={switchToRange}
              activeOpacity={0.8}
            >
              <Text style={[styles.modeBtnText, mode === 'range' && styles.modeBtnTextActive]}>Time window</Text>
            </TouchableOpacity>
          </View>

          {mode === 'range' && (
            <>
              {/* FROM / TO summary with active selector */}
              <View style={styles.rangeSummaryRow}>
                <TouchableOpacity
                  style={[styles.rangeSide, active === 'from' && styles.rangeSideActive]}
                  onPress={() => setActive('from')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.rangeSideLabel}>FROM</Text>
                  <Text style={[styles.rangeSideTime, active === 'from' && styles.rangeSideTimeActive]}>{fromValue}</Text>
                </TouchableOpacity>
                <Ionicons name="arrow-forward" size={18} color={colors.textSecondary} style={styles.rangeArrow} />
                <TouchableOpacity
                  style={[styles.rangeSide, active === 'to' && styles.rangeSideActive]}
                  onPress={() => setActive('to')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.rangeSideLabel}>TO</Text>
                  <Text style={[styles.rangeSideTime, active === 'to' && styles.rangeSideTimeActive]}>{toValue}</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.rangeHint}>Tap a side to edit it</Text>
            </>
          )}

          {/* Main time display (shared for exact + active side of range) */}
          <View style={styles.timeDisplay}>
            <TouchableOpacity style={[styles.timeStepper, styles.timeStepperUp]} onPress={() => stepActiveHour(1)}>
              <Ionicons name="chevron-up" size={18} color={colors.primary} />
            </TouchableOpacity>
            <Text style={styles.timeValue}>{activeHour}:{pad2(activeMinute)}</Text>
            <TouchableOpacity style={styles.periodButton} onPress={toggleActivePeriod}>
              <Text style={styles.periodText}>{activePeriod}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.timeStepper, styles.timeStepperDown]} onPress={() => stepActiveHour(-1)}>
              <Ionicons name="chevron-down" size={18} color={colors.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.minuteRow}>
            {minuteOptions.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.minuteChip, activeMinute === option && styles.minuteChipActive]}
                onPress={() => setActiveMinute(option)}
              >
                <Text style={[styles.minuteChipText, activeMinute === option && styles.minuteChipTextActive]}>{pad2(option)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {mode === 'exact' && (
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
          )}

          <TouchableOpacity style={styles.primaryButton} onPress={handleConfirm}>
            <Text style={styles.primaryText}>{mode === 'range' ? 'Set time window' : 'Set time'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(5,12,30,0.68)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 390, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 18, shadowColor: colors.textPrimary, shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.18, shadowRadius: 30, elevation: 18 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalEyebrow: { color: colors.textSecondary, fontSize: 11, lineHeight: 14, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  modalTitle: { color: colors.textPrimary, fontSize: 22, lineHeight: 28, fontWeight: '800', marginTop: 2 },
  closeIcon: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center' },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 16, backgroundColor: colors.bgSecondary, padding: 8, marginBottom: 14 },
  navButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  monthLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  weekdayRow: { flexDirection: 'row', marginBottom: 7 },
  weekday: { flex: 1, textAlign: 'center', color: colors.textSecondary, fontSize: 11, fontWeight: '800' },
  dayRow: { flexDirection: 'row', gap: 5, marginBottom: 5 },
  dayButton: { flex: 1, aspectRatio: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border },
  dayButtonEmpty: { opacity: 0, borderWidth: 0 },
  dayButtonDisabled: { opacity: 0.28 },
  dayButtonToday: { borderColor: colors.primary, backgroundColor: colors.primaryDim },
  dayButtonSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  dayText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  dayTextDisabled: { color: colors.textSecondary },
  dayTextToday: { color: colors.primary },
  dayTextSelected: { color: colors.textInverse, fontWeight: '900' },
  yearList: { maxHeight: 260 },
  yearGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 4 },
  yearChip: { minWidth: 72, flexGrow: 1, height: 42, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
  yearChipSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  yearChipText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  yearChipTextSelected: { color: colors.textInverse, fontWeight: '900' },
  timeDisplay: { minHeight: 110, borderRadius: 18, backgroundColor: colors.bgSecondary, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  timeValue: { color: colors.textPrimary, fontSize: 46, lineHeight: 54, fontWeight: '900' },
  timeStepper: { position: 'absolute', right: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  timeStepperUp: { top: 14 },
  timeStepperDown: { bottom: 14 },
  periodButton: { position: 'absolute', left: 16, top: 37, borderRadius: 18, backgroundColor: colors.primaryDim, paddingHorizontal: 13, paddingVertical: 8, borderWidth: 1, borderColor: colors.primaryBorder },
  periodText: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  minuteRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  minuteChip: { flex: 1, height: 42, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
  minuteChipActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  minuteChipText: { color: colors.textSecondary, fontSize: 14, fontWeight: '800' },
  minuteChipTextActive: { color: colors.textInverse },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  presetChip: { borderRadius: 14, backgroundColor: colors.primaryDim, paddingHorizontal: 11, paddingVertical: 8 },
  presetText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  primaryButton: { height: 50, borderRadius: 25, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: colors.textInverse, fontSize: 16, fontWeight: '800' },
  // Mode toggle
  modeToggle: { flexDirection: 'row', borderRadius: 14, backgroundColor: colors.bgSecondary, borderWidth: 1, borderColor: colors.border, padding: 3, marginBottom: 14, gap: 3 },
  modeBtn: { flex: 1, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  modeBtnActive: { backgroundColor: colors.bgCard, shadowColor: colors.textPrimary, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  modeBtnText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  modeBtnTextActive: { color: colors.textPrimary, fontWeight: '800' },
  // Range summary
  rangeSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  rangeSide: { flex: 1, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.bgSecondary, paddingVertical: 10, paddingHorizontal: 12 },
  rangeSideActive: { borderColor: colors.primary, backgroundColor: colors.primaryDim },
  rangeSideLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 2 },
  rangeSideTime: { color: colors.textPrimary, fontSize: 17, fontWeight: '800' },
  rangeSideTimeActive: { color: colors.primary },
  rangeArrow: { flexShrink: 0 },
  rangeHint: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', textAlign: 'center', marginBottom: 10 },
  });
}
