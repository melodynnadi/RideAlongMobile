import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Dimensions, Modal, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/hooks/useTheme';
import { router } from 'expo-router';
import { WebView } from 'react-native-webview';

interface RoleCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  onPress: () => void;
  primary?: boolean;
}

function RoleCard({ icon, title, description, onPress, primary }: RoleCardProps) {
  const theme = useTheme();
  return (
    <TouchableOpacity
      style={[styles.roleCard, primary && { borderColor: theme.colors.primary, borderWidth: 2 }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={[styles.roleIconContainer, { backgroundColor: primary ? theme.colors.primary + '20' : '#F1F5F9' }]}>
        <Ionicons name={icon} size={28} color={primary ? theme.colors.primary : '#475569'} />
      </View>
      <View style={styles.roleTextContainer}>
        <Text style={[styles.roleTitle, { color: theme.colors.secondary }]}>{title}</Text>
        <Text style={styles.roleDescription}>{description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#CBD5E1" />
    </TouchableOpacity>
  );
}

export default function SelectRoleScreen() {
  const theme = useTheme();
  const [showDriverWebView, setShowDriverWebView] = useState(false);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <LinearGradient colors={['#F8FAFC', '#EFF6FF']} style={styles.gradient}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.heroSection}>
            <Text style={[styles.welcomeTitle, { color: theme.colors.secondary }]}>
              Welcome to{'\n'}
              <Text style={{ color: theme.colors.primary }}>RideAlong!</Text>
            </Text>
            <Text style={styles.welcomeSubtitle}>
              Your trusted companion for safe, affordable rides with fellow students
            </Text>
          </View>

          <View style={styles.rolesSection}>
            <Text style={[styles.rolesTitle, { color: theme.colors.secondary }]}>
              How would you like to join?
            </Text>

            <RoleCard
              icon="map-outline"
              title="Ride with us"
              description="Book affordable rides to and from campus with verified student drivers"
              onPress={() => router.push({ pathname: '/(auth)/sign-up', params: { role: 'rider' } })}
              primary
            />

            <RoleCard
              icon="car-outline"
              title="Drive & earn"
              description="Earn money giving rides to fellow students on your schedule"
              onPress={() => setShowDriverWebView(true)}
            />
          </View>

          <TouchableOpacity onPress={() => router.push('/(auth)/sign-in')} style={styles.signInContainer}>
            <Text style={styles.signInText}>
              Already have an account?{' '}
              <Text style={[styles.signInLink, { color: theme.colors.primary }]}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        </SafeAreaView>
      </LinearGradient>

      {/* Driver sign-up WebView modal */}
      <Modal
        visible={showDriverWebView}
        animationType="slide"
        onRequestClose={() => setShowDriverWebView(false)}
      >
        <SafeAreaView style={styles.modalContainer} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Driver Application</Text>
            <TouchableOpacity
              onPress={() => setShowDriverWebView(false)}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={28} color="#1E293B" />
            </TouchableOpacity>
          </View>
          <WebView
            source={{ uri: 'https://ridealongapp.com/pages/driver-signup' }}
            style={{ flex: 1 }}
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#E05E1A" />
              </View>
            )}
          />
        </SafeAreaView>
      </Modal>
    </ScrollView>
  );
}

const { height } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  gradient: { flex: 1, minHeight: height },
  safeArea: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  heroSection: { alignItems: 'center', paddingTop: 40, paddingBottom: 32 },
  welcomeTitle: {
    fontSize: 34, fontWeight: '800', textAlign: 'center',
    marginBottom: 12, lineHeight: 42,
  },
  welcomeSubtitle: {
    fontSize: 16, color: '#64748B', textAlign: 'center',
    lineHeight: 24, fontWeight: '400',
  },
  rolesSection: { paddingBottom: 20 },
  rolesTitle: {
    fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 16,
  },
  roleCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'white', borderRadius: 20,
    padding: 18, marginBottom: 12, borderWidth: 1, borderColor: '#F1F5F9',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 6,
  },
  roleIconContainer: {
    width: 52, height: 52, borderRadius: 26,
    justifyContent: 'center', alignItems: 'center', marginRight: 16,
  },
  roleTextContainer: { flex: 1 },
  roleTitle: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  roleDescription: { fontSize: 14, color: '#64748B', lineHeight: 20 },
  signInContainer: { alignItems: 'center', paddingVertical: 24, paddingBottom: 40 },
  signInText: { fontSize: 16, color: '#64748B', textAlign: 'center', fontWeight: '500' },
  signInLink: { fontWeight: '700', textDecorationLine: 'underline' },
  modalContainer: { flex: 1, backgroundColor: 'white' },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#1E293B' },
  closeButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
