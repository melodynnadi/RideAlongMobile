import React, { useState, useRef, useMemo } from 'react';
import {
  Modal, View, Text, TextInput, StyleSheet, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
  Animated,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import DismissKeyboardView from '@/components/DismissKeyboardView';
import { Ionicons } from '@expo/vector-icons';
import type { AddBankAccountPayload } from '@/types';
import { useAppTheme } from '@/hooks/ThemeContext';

// ─── Styled Input ─────────────────────────────────────────────────────────────
function StyledInput({ label, value, onChangeText, placeholder, keyboardType, maxLength,
  secureTextEntry, autoCapitalize, error, helpText, editable, isDark, colors }: {
  label: string; value: string; onChangeText: (t: string) => void;
  placeholder: string; keyboardType?: any; maxLength?: number;
  secureTextEntry?: boolean; autoCapitalize?: any; error?: string;
  helpText?: string; editable?: boolean; isDark: boolean; colors: any;
}) {
  const focused = useRef(new Animated.Value(0)).current;
  const borderColor = focused.interpolate({
    inputRange:  [0, 1],
    outputRange: [error ? colors.redBorder : colors.border, colors.primaryBorder],
  });
  return (
    <View style={si.inputGroup}>
      <Text style={[si.label, { color: colors.textSecondary }]}>{label}</Text>
      <Animated.View style={[si.inputWrap, { backgroundColor: colors.bgInput, borderColor }]}>
        <BlurView intensity={isDark ? 15 : 30} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
        <TextInput
          style={[si.textInput, { color: colors.textPrimary }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          keyboardType={keyboardType}
          maxLength={maxLength}
          secureTextEntry={secureTextEntry}
          autoCapitalize={autoCapitalize || 'none'}
          editable={editable !== false}
          onFocus={() => Animated.timing(focused, { toValue: 1, duration: 180, useNativeDriver: false }).start()}
          onBlur={()  => Animated.timing(focused, { toValue: 0, duration: 180, useNativeDriver: false }).start()}
        />
      </Animated.View>
      {error    ? <Text style={si.errorText}>{error}</Text>    : null}
      {helpText ? <Text style={[si.helpText, { color: colors.textSecondary }]}>{helpText}</Text> : null}
    </View>
  );
}

const si = StyleSheet.create({
  inputGroup: { marginBottom: 18 },
  label:      { fontSize: 12, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 },
  inputWrap:  { borderRadius: 14, borderWidth: 1.5, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', height: 52 },
  textInput:  { flex: 1, paddingHorizontal: 16, fontSize: 15, fontWeight: '400', height: '100%' },
  errorText:  { fontSize: 12, color: '#EF4444', marginTop: 5 },
  helpText:   { fontSize: 12, marginTop: 5, fontWeight: '400' },
});

// ─── Props ────────────────────────────────────────────────────────────────────
interface AddBankAccountModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (payload: AddBankAccountPayload) => Promise<void>;
  loading?: boolean;
}

interface FormErrors {
  accountHolderName?: string;
  accountNumber?: string;
  routingNumber?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function AddBankAccountModal({ visible, onClose, onSubmit, loading = false }: AddBankAccountModalProps) {
  const { colors, isDark } = useAppTheme();
  const [formData, setFormData] = useState<AddBankAccountPayload>({
    accountHolderName: '',
    accountNumber: '',
    routingNumber: '',
    accountType: 'individual',
  });
  const [errors,     setErrors]     = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const s = useMemo(() => StyleSheet.create({
    flex: { flex: 1 },
    overlay:  { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },

    sheet: {
      borderTopLeftRadius: 28, borderTopRightRadius: 28,
      borderWidth: 1.5, borderBottomWidth: 0,
      overflow: 'hidden',
      maxHeight: '92%',
      paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    },

    handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 },

    header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16 },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    headerIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    title:      { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
    subtitle:   { fontSize: 13, fontWeight: '400', marginTop: 1 },
    closeBtn:   { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },

    form: { paddingHorizontal: 24 },

    typeRow: { flexDirection: 'row', gap: 12 },
    typeBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
    typeBtnText: { fontSize: 15, fontWeight: '600' },

    securityBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 4 },
    securityText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '400' },

    actions:       { flexDirection: 'row', gap: 12, paddingHorizontal: 24, paddingTop: 16, borderTopWidth: 1 },
    cancelBtn:     { flex: 1, borderRadius: 50, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingVertical: 15 },
    cancelBtnText: { fontSize: 15, fontWeight: '600' },
    submitBtn:     { borderRadius: 50, paddingVertical: 15, alignItems: 'center', justifyContent: 'center',
      shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
    submitBtnText: { fontSize: 15, fontWeight: '700', color: colors.textInverse, letterSpacing: 0.2 },
  }), [colors]);

  const validate = (): boolean => {
    const e: FormErrors = {};
    if (!formData.accountHolderName.trim())                              e.accountHolderName = 'Account holder name is required';
    else if (formData.accountHolderName.trim().length < 2)              e.accountHolderName = 'Name must be at least 2 characters';
    if (!formData.routingNumber.trim())                                  e.routingNumber = 'Routing number is required';
    else if (!/^\d{9}$/.test(formData.routingNumber.trim()))            e.routingNumber = 'Must be exactly 9 digits';
    if (!formData.accountNumber.trim())                                  e.accountNumber = 'Account number is required';
    else if (!/^\d{4,17}$/.test(formData.accountNumber.trim()))         e.accountNumber = 'Must be 4–17 digits';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      await onSubmit(formData);
      reset();
    } catch {}
    finally { setSubmitting(false); }
  };

  const reset = () => {
    setFormData({ accountHolderName: '', accountNumber: '', routingNumber: '', accountType: 'individual' });
    setErrors({});
  };

  const handleClose = () => {
    if (submitting || loading) return;
    reset();
    onClose();
  };

  const busy = submitting || loading;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <DismissKeyboardView style={s.flex}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={handleClose} />

        <View style={[s.sheet, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          {/* Blur background */}
          <BlurView intensity={isDark ? 40 : 70} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />

          {/* Drag handle */}
          <View style={[s.handle, { backgroundColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)' }]} />

          {/* Header */}
          <View style={s.header}>
            <View style={s.headerLeft}>
              <LinearGradient colors={[colors.primary, colors.primaryLight]} style={s.headerIcon}>
                <Ionicons name="card" size={20} color="white" />
              </LinearGradient>
              <View>
                <Text style={[s.title, { color: colors.textPrimary }]}>Add Bank Account</Text>
                <Text style={[s.subtitle, { color: colors.textSecondary }]}>Connect your bank for payouts</Text>
              </View>
            </View>
            <TouchableOpacity onPress={handleClose} disabled={busy} style={[s.closeBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]} accessibilityRole="button" accessibilityLabel="Close add bank account">
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Form */}
          <ScrollView style={s.form} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            <StyledInput
              label="Account Holder Name *"
              value={formData.accountHolderName}
              onChangeText={(t) => { setFormData({ ...formData, accountHolderName: t }); setErrors({ ...errors, accountHolderName: undefined }); }}
              placeholder="John Doe"
              autoCapitalize="words"
              error={errors.accountHolderName}
              editable={!busy}
              isDark={isDark}
              colors={colors}
            />

            <StyledInput
              label="Routing Number *"
              value={formData.routingNumber}
              onChangeText={(t) => { const d = t.replace(/\D/g, ''); setFormData({ ...formData, routingNumber: d }); setErrors({ ...errors, routingNumber: undefined }); }}
              placeholder="123456789"
              keyboardType="number-pad"
              maxLength={9}
              error={errors.routingNumber}
              helpText="9-digit number found on your checks"
              editable={!busy}
              isDark={isDark}
              colors={colors}
            />

            <StyledInput
              label="Account Number *"
              value={formData.accountNumber}
              onChangeText={(t) => { const d = t.replace(/\D/g, ''); setFormData({ ...formData, accountNumber: d }); setErrors({ ...errors, accountNumber: undefined }); }}
              placeholder="0000123456789"
              keyboardType="number-pad"
              maxLength={17}
              secureTextEntry
              error={errors.accountNumber}
              editable={!busy}
              isDark={isDark}
              colors={colors}
            />

            {/* Account Type */}
            <View style={si.inputGroup}>
              <Text style={[si.label, { color: colors.textSecondary }]}>Account Type *</Text>
              <View style={s.typeRow}>
                {(['individual', 'company'] as const).map((type) => {
                  const active = formData.accountType === type;
                  return (
                    <TouchableOpacity
                      key={type}
                      onPress={() => setFormData({ ...formData, accountType: type })}
                      disabled={busy}
                      activeOpacity={0.8}
                      style={{ flex: 1 }}
                    >
                      {active ? (
                        <LinearGradient colors={[colors.primary, colors.primaryLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.typeBtn}>
                          <Text style={[s.typeBtnText, { color: colors.textInverse }]}>{type.charAt(0).toUpperCase() + type.slice(1)}</Text>
                        </LinearGradient>
                      ) : (
                        <View style={[s.typeBtn, { backgroundColor: colors.bgInput, borderWidth: 1.5, borderColor: colors.border }]}>
                          <Text style={[s.typeBtnText, { color: colors.textSecondary }]}>{type.charAt(0).toUpperCase() + type.slice(1)}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Security notice */}
            <View style={[s.securityBox, { backgroundColor: colors.greenDim, borderColor: colors.greenBorder }]}>
              <Ionicons name="shield-checkmark" size={16} color={colors.green} />
              <Text style={[s.securityText, { color: isDark ? colors.greenLight : colors.green }]}>
                Your bank info is encrypted and processed securely via Stripe.
              </Text>
            </View>

            <View style={{ height: 8 }} />
          </ScrollView>

          {/* Actions */}
          <View style={[s.actions, { borderTopColor: colors.border }]}>
            <TouchableOpacity onPress={handleClose} disabled={busy} style={[s.cancelBtn, { borderColor: colors.border, backgroundColor: colors.bgInput }]}>
              <Text style={[s.cancelBtnText, { color: colors.textPrimary }]}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleSubmit} disabled={busy} activeOpacity={0.86} style={{ flex: 1 }}>
              <LinearGradient
                colors={busy ? ['#9CA3AF', '#9CA3AF'] : [colors.primary, colors.primaryLight]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={s.submitBtn}
              >
                {busy
                  ? <ActivityIndicator color="white" size="small" />
                  : <Text style={s.submitBtnText}>Add Account</Text>
                }
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
        </KeyboardAvoidingView>
      </DismissKeyboardView>
    </Modal>
  );
}

export default AddBankAccountModal;
