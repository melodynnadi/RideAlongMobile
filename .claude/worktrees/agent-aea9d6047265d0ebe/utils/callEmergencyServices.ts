import { Alert, Linking, Platform } from 'react-native';

/**
 * Opens the device's native dialer to call emergency services (911).
 * 
 * IMPORTANT: This function complies with Apple App Store and Google Play policies:
 * - Does NOT auto-dial
 * - Shows a confirmation dialog first
 * - Uses the native dialer via Linking.openURL
 * - Does NOT use VoIP or internal calling
 * 
 * Use this function when users need to contact emergency services during a safety incident.
 */
export function callEmergencyServices(): void {
  // Show confirmation dialog before opening dialer
  Alert.alert(
    'Contact Emergency Services',
    'Are you sure you want to call 911? This will open your phone\'s dialer.',
    [
      {
        text: 'Cancel',
        style: 'cancel',
      },
      {
        text: 'Call 911',
        style: 'destructive',
        onPress: () => {
          openEmergencyDialer();
        },
      },
    ],
    { cancelable: true }
  );
}

/**
 * Opens the device's native phone dialer with 911 pre-populated.
 * The user must manually press "call" to complete the connection.
 */
function openEmergencyDialer(): void {
  const emergencyNumber = '911';
  const url = `tel:${emergencyNumber}`;

  Linking.canOpenURL(url)
    .then((supported) => {
      if (!supported) {
        Alert.alert(
          'Unable to Open Dialer',
          'Your device cannot make phone calls. Please use another device to contact emergency services.'
        );
      } else {
        return Linking.openURL(url);
      }
    })
    .catch((error) => {
      console.error('Error opening emergency dialer:', error);
      Alert.alert(
        'Error',
        'Could not open the phone dialer. Please manually dial 911 for emergency assistance.'
      );
    });
}
