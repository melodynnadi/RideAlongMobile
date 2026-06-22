import React from 'react';
import { Text, Pressable, StyleSheet, TextStyle, ViewStyle } from 'react-native';
import { openAddressInMaps } from '@/utils/openAddressInMaps';

interface AddressLinkProps {
  /**
   * The address text to display and make tappable
   */
  address: string;
  
  /**
   * Optional style for the text element
   */
  textStyle?: TextStyle;
  
  /**
   * Optional style for the pressable container
   */
  containerStyle?: ViewStyle;
  
  /**
   * Optional number of lines (default: undefined, no limit)
   */
  numberOfLines?: number;
}

/**
 * AddressLink Component
 * 
 * Renders an address as a tappable link that opens the user's preferred navigation app.
 * - On iOS: Opens Apple Maps
 * - On Android: Opens Google Maps
 * 
 * Usage:
 * ```tsx
 * <AddressLink 
 *   address="123 Main St, San Francisco, CA" 
 *   textStyle={styles.locationText}
 * />
 * ```
 */
export function AddressLink({ 
  address, 
  textStyle, 
  containerStyle,
  numberOfLines 
}: AddressLinkProps) {
  const handlePress = () => {
    openAddressInMaps(address);
  };

  return (
    <Pressable 
      onPress={handlePress}
      style={({ pressed }) => [
        styles.container,
        containerStyle,
        pressed && styles.pressed
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${address} in maps`}
      accessibilityHint="Opens the address in your navigation app"
    >
      <Text 
        style={[styles.text, textStyle]} 
        numberOfLines={numberOfLines}
      >
        {address}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    // Slight opacity change on press for feedback
  },
  pressed: {
    opacity: 0.7,
  },
  text: {
    // Default text style - will be overridden by textStyle prop
    color: '#64748B',
    fontSize: 14,
  },
});
