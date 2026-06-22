import React from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useTheme } from '@/hooks/useTheme';
import { DynamicLegalDocument } from '@/components/DynamicLegalDocument';

export default function PrivacyScreen() {
  const theme = useTheme();
  
  const handleError = (error: string) => {
    console.error('Privacy Policy loading error:', error);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F8FAFC' }} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => router.push('/sign-up')}
          accessibilityRole="button"
          accessibilityLabel="Go back to Sign Up"
        >
          <ArrowLeft size={24} color={theme.colors.secondary} />
        </TouchableOpacity>
      </View>

      <DynamicLegalDocument 
        documentId="privacy" 
        title="Privacy Policy"
        onError={handleError}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
});