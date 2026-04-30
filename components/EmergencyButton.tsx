import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { Phone } from 'lucide-react-native';
import { callEmergencyServices } from '@/utils/callEmergencyServices';

interface EmergencyButtonProps {
  /**
   * Custom label for the button. Defaults to "Call 911"
   */
  label?: string;
}

/**
 * EmergencyButton Component
 * 
 * Displays a prominent emergency call button that opens the device's native
 * dialer to contact emergency services (911).
 * 
 * Complies with Apple App Store and Google Play safety policies:
 * - Does NOT auto-dial
 * - Shows confirmation before opening dialer
 * - Uses native phone dialer (not VoIP)
 * 
 * Usage:
 * ```tsx
 * <EmergencyButton />
 * <EmergencyButton label="Emergency: Call 911" />
 * ```
 */
export function EmergencyButton({ label = 'Call 911' }: EmergencyButtonProps) {
  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.button}
        onPress={callEmergencyServices}
        accessibilityRole="button"
        accessibilityLabel="Call emergency services"
        accessibilityHint="Opens confirmation dialog before calling 911"
      >
        <Phone size={20} color="#FFFFFF" />
        <Text style={styles.buttonText}>{label}</Text>
      </TouchableOpacity>
      
      <Text style={styles.disclaimer}>
        RideAlong does not provide emergency response services.{'\n'}
        This will connect you with local emergency services.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginVertical: 12,
  },
  button: {
    backgroundColor: '#DC2626',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  disclaimer: {
    fontSize: 11,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 16,
    paddingHorizontal: 4,
  },
});
