import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { X } from 'lucide-react-native';
import { useTheme } from '@/hooks/useTheme';
import { Button } from '@/components/ui/Button';
import type { AddBankAccountPayload } from '@/types';

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
  accountType?: string;
}

export function AddBankAccountModal({
  visible,
  onClose,
  onSubmit,
  loading = false,
}: AddBankAccountModalProps) {
  const theme = useTheme();
  const [formData, setFormData] = useState<AddBankAccountPayload>({
    accountHolderName: '',
    accountNumber: '',
    routingNumber: '',
    accountType: 'individual',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    // Account holder name validation
    if (!formData.accountHolderName.trim()) {
      newErrors.accountHolderName = 'Account holder name is required';
    } else if (formData.accountHolderName.trim().length < 2) {
      newErrors.accountHolderName = 'Name must be at least 2 characters';
    }

    // Routing number validation (9 digits for US banks)
    if (!formData.routingNumber.trim()) {
      newErrors.routingNumber = 'Routing number is required';
    } else if (!/^\d{9}$/.test(formData.routingNumber.trim())) {
      newErrors.routingNumber = 'Routing number must be exactly 9 digits';
    }

    // Account number validation (4-17 digits for US banks)
    if (!formData.accountNumber.trim()) {
      newErrors.accountNumber = 'Account number is required';
    } else if (!/^\d{4,17}$/.test(formData.accountNumber.trim())) {
      newErrors.accountNumber = 'Account number must be 4-17 digits';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(formData);
      // Reset form on success
      setFormData({
        accountHolderName: '',
        accountNumber: '',
        routingNumber: '',
        accountType: 'individual',
      });
      setErrors({});
    } catch (error) {
      // Error handling is done by the parent component
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!submitting && !loading) {
      setFormData({
        accountHolderName: '',
        accountNumber: '',
        routingNumber: '',
        accountType: 'individual',
      });
      setErrors({});
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modalContainer}>
          <View style={[styles.modalContent, { backgroundColor: 'white' }]}>
            {/* Header */}
            <View style={styles.header}>
              <View>
                <Text style={[styles.title, { color: theme.colors.secondary }]}>
                  Add Bank Account
                </Text>
                <Text style={styles.subtitle}>
                  Connect your bank for payouts
                </Text>
              </View>
              <TouchableOpacity
                onPress={handleClose}
                disabled={submitting || loading}
                style={styles.closeButton}
              >
                <X size={24} color={theme.colors.secondary} />
              </TouchableOpacity>
            </View>

            {/* Form */}
            <ScrollView
              style={styles.form}
              showsVerticalScrollIndicator={false}
            >
              {/* Account Holder Name */}
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: theme.colors.secondary }]}>
                  Account Holder Name *
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    { 
                      borderColor: errors.accountHolderName ? '#EF4444' : '#E2E8F0',
                      color: theme.colors.secondary,
                    }
                  ]}
                  value={formData.accountHolderName}
                  onChangeText={(text) => {
                    setFormData({ ...formData, accountHolderName: text });
                    if (errors.accountHolderName) {
                      setErrors({ ...errors, accountHolderName: undefined });
                    }
                  }}
                  placeholder="John Doe"
                  placeholderTextColor="#94A3B8"
                  autoCapitalize="words"
                  editable={!submitting && !loading}
                />
                {errors.accountHolderName && (
                  <Text style={styles.errorText}>{errors.accountHolderName}</Text>
                )}
              </View>

              {/* Routing Number */}
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: theme.colors.secondary }]}>
                  Routing Number *
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    { 
                      borderColor: errors.routingNumber ? '#EF4444' : '#E2E8F0',
                      color: theme.colors.secondary,
                    }
                  ]}
                  value={formData.routingNumber}
                  onChangeText={(text) => {
                    // Only allow digits
                    const digits = text.replace(/\D/g, '');
                    setFormData({ ...formData, routingNumber: digits });
                    if (errors.routingNumber) {
                      setErrors({ ...errors, routingNumber: undefined });
                    }
                  }}
                  placeholder="123456789"
                  placeholderTextColor="#94A3B8"
                  keyboardType="number-pad"
                  maxLength={9}
                  editable={!submitting && !loading}
                />
                {errors.routingNumber && (
                  <Text style={styles.errorText}>{errors.routingNumber}</Text>
                )}
                <Text style={styles.helpText}>
                  9-digit number found on your checks
                </Text>
              </View>

              {/* Account Number */}
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: theme.colors.secondary }]}>
                  Account Number *
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    { 
                      borderColor: errors.accountNumber ? '#EF4444' : '#E2E8F0',
                      color: theme.colors.secondary,
                    }
                  ]}
                  value={formData.accountNumber}
                  onChangeText={(text) => {
                    // Only allow digits
                    const digits = text.replace(/\D/g, '');
                    setFormData({ ...formData, accountNumber: digits });
                    if (errors.accountNumber) {
                      setErrors({ ...errors, accountNumber: undefined });
                    }
                  }}
                  placeholder="0000123456789"
                  placeholderTextColor="#94A3B8"
                  keyboardType="number-pad"
                  maxLength={17}
                  secureTextEntry
                  editable={!submitting && !loading}
                />
                {errors.accountNumber && (
                  <Text style={styles.errorText}>{errors.accountNumber}</Text>
                )}
              </View>

              {/* Account Type */}
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: theme.colors.secondary }]}>
                  Account Type *
                </Text>
                <View style={styles.accountTypeContainer}>
                  <TouchableOpacity
                    style={[
                      styles.accountTypeButton,
                      formData.accountType === 'individual' && { 
                        backgroundColor: theme.colors.primary,
                        borderColor: theme.colors.primary,
                      }
                    ]}
                    onPress={() => setFormData({ ...formData, accountType: 'individual' })}
                    disabled={submitting || loading}
                  >
                    <Text style={[
                      styles.accountTypeText,
                      formData.accountType === 'individual' && styles.accountTypeTextActive
                    ]}>
                      Individual
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.accountTypeButton,
                      formData.accountType === 'company' && { 
                        backgroundColor: theme.colors.primary,
                        borderColor: theme.colors.primary,
                      }
                    ]}
                    onPress={() => setFormData({ ...formData, accountType: 'company' })}
                    disabled={submitting || loading}
                  >
                    <Text style={[
                      styles.accountTypeText,
                      formData.accountType === 'company' && styles.accountTypeTextActive
                    ]}>
                      Company
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Security Notice */}
              <View style={styles.securityNotice}>
                <Text style={styles.securityText}>
                  🔒 Your bank information is encrypted and securely stored. We use Stripe to process all transactions.
                </Text>
              </View>
            </ScrollView>

            {/* Action Buttons */}
            <View style={styles.actions}>
              <Button
                variant="secondary"
                onPress={handleClose}
                disabled={submitting || loading}
                style={{ flex: 1 }}
              >
                <Text style={{ fontWeight: '600', color: theme.colors.secondary }}>
                  Cancel
                </Text>
              </Button>
              <Button
                variant="primary"
                onPress={handleSubmit}
                loading={submitting || loading}
                disabled={submitting || loading}
                style={{ flex: 1 }}
              >
                {submitting || loading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={{ fontWeight: '700', color: 'white' }}>
                    Add Account
                  </Text>
                )}
              </Button>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748B',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  form: {
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    backgroundColor: 'white',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 12,
    marginTop: 4,
  },
  helpText: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 4,
  },
  accountTypeContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  accountTypeButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: 'white',
    alignItems: 'center',
  },
  accountTypeText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#64748B',
  },
  accountTypeTextActive: {
    color: 'white',
  },
  securityNotice: {
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
  },
  securityText: {
    fontSize: 13,
    color: '#166534',
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 24,
  },
});
