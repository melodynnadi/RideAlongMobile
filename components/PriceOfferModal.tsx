import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAppTheme } from '@/hooks/ThemeContext';
import { formatMoney } from '@/services/offers';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** e.g. "Counter-offer", "Offer a price" */
  title: string;
  subtitle?: string;
  /** The price on the table, shown for comparison and used as the starting value. */
  referenceLabel: string;
  referenceAmount: number;
  min: number;
  max: number | null;
  confirmLabel: string;
  /** Small print under the input, e.g. "You can only counter once." */
  note?: string;
  /** Whether the proposed price must differ from the reference (true for counters). */
  mustDiffer?: boolean;
  onSubmit: (amount: number) => Promise<void> | void;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function PriceOfferModal({
  visible, onClose, title, subtitle, referenceLabel, referenceAmount, min, max, confirmLabel, note, mustDiffer, onSubmit,
}: Props) {
  const { colors } = useAppTheme();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) setText(referenceAmount > 0 ? referenceAmount.toFixed(2) : '');
  }, [visible, referenceAmount]);

  const amount = round2(Number(text.replace(/[^0-9.]/g, '')) || 0);
  const error = !amount
    ? 'Enter a price.'
    : amount < min
      ? `The minimum is ${formatMoney(min)}.`
      : max != null && amount > max
        ? `The maximum for this route is ${formatMoney(max)}.`
        : mustDiffer && amount === round2(referenceAmount)
          ? 'Choose a different price, or accept the current one instead.'
          : '';

  const step = (delta: number) => {
    const next = round2(Math.max(min, (amount || referenceAmount) + delta));
    setText((max != null ? Math.min(max, next) : next).toFixed(2));
  };

  const submit = async () => {
    if (error || busy) return;
    try {
      setBusy(true);
      await onSubmit(amount);
    } finally {
      setBusy(false);
    }
  };

  const s = useMemo(() => StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, paddingBottom: Platform.OS === 'ios' ? 34 : 20 },
    handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 14 },
    headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 18 },
    title: { color: colors.textPrimary, fontSize: 22, fontWeight: '700' },
    subtitle: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 3 },
    close: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    refRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.bgSecondary, marginBottom: 14 },
    refLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    refValue: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
    inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    stepBtn: { width: 48, height: 64, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
    inputWrap: { flex: 1, height: 64, borderRadius: 16, borderWidth: 1.5, borderColor: error && text ? colors.red : colors.primary, backgroundColor: colors.bgCard, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
    dollar: { color: colors.primary, fontSize: 28, fontWeight: '400', marginRight: 2 },
    input: { minWidth: 90, color: colors.textPrimary, fontSize: 30, fontWeight: '600', textAlign: 'center', paddingVertical: 0 },
    range: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 8 },
    error: { color: colors.red, fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 6, minHeight: 16 },
    note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: colors.primaryDim },
    noteText: { flex: 1, color: colors.textPrimary, fontSize: 12, lineHeight: 18 },
    confirm: { marginTop: 16, minHeight: 54, borderRadius: 27, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    confirmText: { color: colors.textInverse, fontSize: 16, fontWeight: '700' },
  }), [colors, error, text]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.headRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{title}</Text>
              {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
            </View>
            <TouchableOpacity style={s.close} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={18} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={s.refRow}>
            <Text style={s.refLabel}>{referenceLabel}</Text>
            <Text style={s.refValue}>{formatMoney(referenceAmount)}</Text>
          </View>

          <View style={s.inputRow}>
            <TouchableOpacity style={s.stepBtn} onPress={() => step(-1)} accessibilityLabel="Lower by one dollar">
              <Ionicons name="remove" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <View style={s.inputWrap}>
              <Text style={s.dollar}>$</Text>
              <TextInput
                style={s.input}
                value={text}
                onChangeText={(t) => setText(t.replace(/[^0-9.]/g, ''))}
                keyboardType="decimal-pad"
                selectTextOnFocus
                accessibilityLabel="Price per seat"
              />
            </View>
            <TouchableOpacity style={s.stepBtn} onPress={() => step(1)} accessibilityLabel="Raise by one dollar">
              <Ionicons name="add" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <Text style={s.range}>
            Per seat · {max != null ? `${formatMoney(min)} – ${formatMoney(max)} for this route` : `at least ${formatMoney(min)}`}
          </Text>
          <Text style={s.error}>{text ? error : ''}</Text>

          {note ? (
            <View style={s.note}>
              <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
              <Text style={s.noteText}>{note}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[s.confirm, (!!error || busy) && { opacity: 0.5 }]}
            onPress={() => void submit()}
            disabled={!!error || busy}
            accessibilityRole="button"
          >
            {busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={s.confirmText}>{confirmLabel.replace('{amount}', formatMoney(amount))}</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
