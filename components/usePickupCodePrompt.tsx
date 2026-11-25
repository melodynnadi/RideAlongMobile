/**
 * Asks the driver for the rider's 4-digit pickup code. iOS uses the system
 * prompt; React Native's Alert.prompt does nothing on Android, so Android gets a
 * sheet. Render `pickupCodePrompt` somewhere in the screen.
 */
import { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { singleLineInput } from '@/constants/inputStyles';
import { AndroidBottomSpacer } from '@/components/ui/AndroidBottomInset';
import { KeyboardAvoidingView } from '@/components/ui/KeyboardAvoidingView';
import { useAppTheme } from '@/hooks/ThemeContext';

type Request = { title: string; onSubmit: (code: string) => void };

const MESSAGE = 'Ask your rider for their 4-digit verification code';

export function usePickupCodePrompt() {
  const { colors } = useAppTheme();
  const [request, setRequest] = useState<Request | null>(null);
  const [code, setCode] = useState('');

  const askForPickupCode = useCallback((next: Request) => {
    if (Platform.OS !== 'ios') {
      setCode('');
      setRequest(next);
      return;
    }
    Alert.prompt(
      next.title,
      MESSAGE,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: (input?: string) => {
          if (!input || !input.trim()) { Alert.alert('Code required', "Please enter the rider's verification code."); return; }
          next.onSubmit(input.trim());
        } },
      ],
      'plain-text', '', 'number-pad',
    );
  }, []);

  const s = useMemo(() => StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
    title: { color: colors.textPrimary, fontSize: 22, fontWeight: '700' },
    message: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 4, marginBottom: 16 },
    input: { height: 64, borderRadius: 16, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.bgCard, color: colors.textPrimary, fontSize: 30, fontWeight: '700', letterSpacing: 10, textAlign: 'center', ...singleLineInput },
    actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
    button: { flex: 1, minHeight: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.border },
    confirm: { backgroundColor: colors.primary, borderColor: colors.primary },
    buttonText: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  }), [colors]);

  const close = () => setRequest(null);
  const ready = code.length === 4;
  const submit = () => {
    if (!request || !ready) return;
    const { onSubmit } = request;
    close();
    onSubmit(code);
  };

  const pickupCodePrompt = Platform.OS === 'ios' ? null : (
    <Modal visible={!!request} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={s.overlay} behavior="height">
        <View style={s.sheet}>
          <Text style={s.title}>{request?.title}</Text>
          <Text style={s.message}>{MESSAGE}</Text>
          <TextInput
            style={s.input}
            value={code}
            onChangeText={(text) => setCode(text.replace(/\D/g, ''))}
            onSubmitEditing={submit}
            keyboardType="number-pad"
            maxLength={4}
            autoFocus
            accessibilityLabel="Verification code"
          />
          <View style={s.actions}>
            <TouchableOpacity style={s.button} onPress={close} accessibilityRole="button">
              <Text style={s.buttonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.button, s.confirm, !ready && { opacity: 0.5 }]}
              onPress={submit}
              disabled={!ready}
              accessibilityRole="button"
              accessibilityState={{ disabled: !ready }}
            >
              <Text style={[s.buttonText, { color: colors.textInverse }]}>Confirm</Text>
            </TouchableOpacity>
          </View>
          <AndroidBottomSpacer />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  return { askForPickupCode, pickupCodePrompt };
}
