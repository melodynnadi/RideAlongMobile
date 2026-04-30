import { Platform, Linking, Alert } from 'react-native';

// Throttle state to prevent multiple rapid calls
let isOpening = false;
let lastOpenTime = 0;
const THROTTLE_DELAY = 1000; // 1 second between opens

/**
 * Opens the given address in the user's preferred navigation app.
 * - iOS: Opens Apple Maps using the maps:// URL scheme
 * - Android: Opens Google Maps using the geo: URL scheme or https fallback
 * 
 * Includes throttling to prevent multiple rapid taps from causing conflicts.
 * 
 * @param address - The address string to open in maps
 */
export async function openAddressInMaps(address: string): Promise<void> {
  // Throttle: prevent opening if already in progress or too soon after last open
  const now = Date.now();
  if (isOpening || (now - lastOpenTime < THROTTLE_DELAY)) {
    return;
  }

  if (!address || typeof address !== 'string' || address.trim() === '') {
    Alert.alert('Invalid Address', 'No address available to open in maps.');
    return;
  }

  const encodedAddress = encodeURIComponent(address.trim());

  try {
    isOpening = true;
    lastOpenTime = now;

    let url: string;

    if (Platform.OS === 'ios') {
      // iOS: Use Apple Maps
      url = `maps://?q=${encodedAddress}`;
    } else if (Platform.OS === 'android') {
      // Android: Use Google Maps geo: scheme
      url = `geo:0,0?q=${encodedAddress}`;
    } else {
      // Fallback for web or other platforms: Use Google Maps web URL
      url = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
    }

    const canOpen = await Linking.canOpenURL(url);
    
    if (canOpen) {
      await Linking.openURL(url);
    } else {
      // If the native app URL doesn't work, try Google Maps web as fallback
      const fallbackUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
      await Linking.openURL(fallbackUrl);
    }
  } catch (error) {
    console.error('Error opening maps:', error);
    // Only show alert for legitimate errors, not throttled attempts
    if (error && (error as any).message && !(error as any).message.includes('throttle')) {
      Alert.alert(
        'Unable to Open Maps',
        'Could not open the address in your navigation app. Please ensure you have a maps app installed.'
      );
    }
  } finally {
    // Reset the flag after a short delay to allow the app to switch
    setTimeout(() => {
      isOpening = false;
    }, 500);
  }
}
