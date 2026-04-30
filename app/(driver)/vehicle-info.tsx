import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Car, Palette, Hash, Users, Save, Edit2 } from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { useTheme } from '@/hooks/useTheme';
import { router } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, updateDoc, setDoc } from 'firebase/firestore';
import { firebaseAuth, firestore } from '@/constants/services';

interface VehicleInfo {
  make?: string;
  model?: string;
  year?: string;
  color?: string;
  licensePlate?: string;
  seats?: number;
}

export default function VehicleInfoScreen() {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [vehicleInfo, setVehicleInfo] = useState<VehicleInfo>({
    make: '',
    model: '',
    year: '',
    color: '',
    licensePlate: '',
    seats: 4,
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
      if (user) {
        await loadVehicleInfo(user.uid);
      } else {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const loadVehicleInfo = async (uid: string) => {
    try {
      setLoading(true);
      
      // Try to get vehicle info from drivers collection
      const driverRef = doc(firestore, 'drivers', uid);
      const driverSnap = await getDoc(driverRef);
      
      if (driverSnap.exists()) {
        const driverData = driverSnap.data();
        const vehicleData = driverData.vehicleInfo || {};
        
        // If vehicle info is not in driver doc, try to get from application
        if (!vehicleData.make && driverData.applicationId) {
          const appRef = doc(firestore, 'driverApplications', driverData.applicationId);
          const appSnap = await getDoc(appRef);
          
          if (appSnap.exists()) {
            const appData = appSnap.data();
            const appVehicleInfo = appData.vehicleInfo || {};
            
            setVehicleInfo({
              make: appVehicleInfo.make || '',
              model: appVehicleInfo.model || '',
              year: appVehicleInfo.year || '',
              color: appVehicleInfo.color || appVehicleInfo.colour || '',
              licensePlate: appVehicleInfo.licensePlate || appVehicleInfo.license || '',
              seats: appVehicleInfo.seats || 4,
            });
          }
        } else {
          setVehicleInfo({
            make: vehicleData.make || '',
            model: vehicleData.model || '',
            year: vehicleData.year || '',
            color: vehicleData.color || vehicleData.colour || '',
            licensePlate: vehicleData.licensePlate || vehicleData.license || '',
            seats: vehicleData.seats || 4,
          });
        }
      }
    } catch (error) {
      console.error('Error loading vehicle info:', error);
      Alert.alert('Error', 'Failed to load vehicle information');
    } finally {
      setLoading(false);
    }
  };

  const saveVehicleInfo = async () => {
    const user = firebaseAuth.currentUser;
    if (!user) return;

    try {
      setSaving(true);
      
      const driverRef = doc(firestore, 'drivers', user.uid);
      const payload = {
        vehicleInfo: {
          make: vehicleInfo.make?.trim() || '',
          model: vehicleInfo.model?.trim() || '',
          year: vehicleInfo.year?.trim() || '',
          color: vehicleInfo.color?.trim() || '',
          licensePlate: vehicleInfo.licensePlate?.trim() || '',
          seats: vehicleInfo.seats || 4,
        },
      };

      try {
        await updateDoc(driverRef, payload);
      } catch {
        await setDoc(driverRef, payload, { merge: true });
      }

      Alert.alert('Success', 'Vehicle information updated successfully');
      setEditMode(false);
    } catch (error: any) {
      console.error('Error saving vehicle info:', error);
      Alert.alert('Error', error?.message || 'Failed to save vehicle information');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: '#F8FAFC' }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#F8FAFC' }]}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <ArrowLeft size={24} color={theme.colors.secondary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.colors.secondary }]}>
          Vehicle Information
        </Text>
        {!editMode && (
          <TouchableOpacity 
            style={styles.editButton}
            onPress={() => setEditMode(true)}
          >
            <Edit2 size={20} color={theme.colors.primary} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Card style={styles.infoCard}>
          {/* Make */}
          <View style={styles.infoItem}>
            <View style={[styles.iconContainer, { backgroundColor: theme.colors.primary + '20' }]}>
              <Car size={20} color={theme.colors.primary} />
            </View>
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Make</Text>
              {editMode ? (
                <TextInput
                  style={styles.input}
                  placeholder="e.g., Toyota, Honda, Ford"
                  value={vehicleInfo.make}
                  onChangeText={(text) => setVehicleInfo({ ...vehicleInfo, make: text })}
                />
              ) : (
                <Text style={[styles.infoValue, { color: theme.colors.secondary }]}>
                  {vehicleInfo.make || 'Not specified'}
                </Text>
              )}
            </View>
          </View>

          {/* Model */}
          <View style={styles.infoItem}>
            <View style={[styles.iconContainer, { backgroundColor: theme.colors.primary + '20' }]}>
              <Car size={20} color={theme.colors.primary} />
            </View>
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Model</Text>
              {editMode ? (
                <TextInput
                  style={styles.input}
                  placeholder="e.g., Camry, Civic, F-150"
                  value={vehicleInfo.model}
                  onChangeText={(text) => setVehicleInfo({ ...vehicleInfo, model: text })}
                />
              ) : (
                <Text style={[styles.infoValue, { color: theme.colors.secondary }]}>
                  {vehicleInfo.model || 'Not specified'}
                </Text>
              )}
            </View>
          </View>

          {/* Year */}
          <View style={styles.infoItem}>
            <View style={[styles.iconContainer, { backgroundColor: '#F0F9FF' }]}>
              <Hash size={20} color="#3B82F6" />
            </View>
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Year</Text>
              {editMode ? (
                <TextInput
                  style={styles.input}
                  placeholder="e.g., 2020"
                  value={vehicleInfo.year}
                  onChangeText={(text) => setVehicleInfo({ ...vehicleInfo, year: text })}
                  keyboardType="numeric"
                />
              ) : (
                <Text style={[styles.infoValue, { color: '#64748B' }]}>
                  {vehicleInfo.year || 'Not specified'}
                </Text>
              )}
            </View>
          </View>

          <View style={styles.divider} />

          {/* Color */}
          <View style={styles.infoItem}>
            <View style={[styles.iconContainer, { backgroundColor: '#FEF3E2' }]}>
              <Palette size={20} color="#F97316" />
            </View>
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Color</Text>
              {editMode ? (
                <TextInput
                  style={styles.input}
                  placeholder="e.g., Silver, Black, White"
                  value={vehicleInfo.color}
                  onChangeText={(text) => setVehicleInfo({ ...vehicleInfo, color: text })}
                />
              ) : (
                <Text style={[styles.infoValue, { color: '#64748B' }]}>
                  {vehicleInfo.color || 'Not specified'}
                </Text>
              )}
            </View>
          </View>

          {/* License Plate */}
          <View style={styles.infoItem}>
            <View style={[styles.iconContainer, { backgroundColor: '#F8FAFC' }]}>
              <Hash size={20} color="#64748B" />
            </View>
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>License Plate</Text>
              {editMode ? (
                <TextInput
                  style={styles.input}
                  placeholder="e.g., ABC1234"
                  value={vehicleInfo.licensePlate}
                  onChangeText={(text) => setVehicleInfo({ ...vehicleInfo, licensePlate: text })}
                  autoCapitalize="characters"
                />
              ) : (
                <Text style={[styles.infoValue, { color: '#64748B' }]}>
                  {vehicleInfo.licensePlate || 'Not specified'}
                </Text>
              )}
            </View>
          </View>

          {/* Seats */}
          <View style={styles.infoItem}>
            <View style={[styles.iconContainer, { backgroundColor: '#F3E8FF' }]}>
              <Users size={20} color="#8B5CF6" />
            </View>
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Passenger Seats</Text>
              {editMode ? (
                <TextInput
                  style={styles.input}
                  placeholder="e.g., 4"
                  value={vehicleInfo.seats?.toString() || '4'}
                  onChangeText={(text) => setVehicleInfo({ ...vehicleInfo, seats: parseInt(text) || 4 })}
                  keyboardType="numeric"
                />
              ) : (
                <Text style={[styles.infoValue, { color: '#64748B' }]}>
                  {vehicleInfo.seats || 'Not specified'}
                </Text>
              )}
            </View>
          </View>
        </Card>

        {editMode && (
          <View style={styles.buttonContainer}>
            <TouchableOpacity 
              style={[styles.cancelButton, { borderColor: theme.colors.secondary + '30' }]}
              onPress={() => {
                setEditMode(false);
                if (firebaseAuth.currentUser) {
                  loadVehicleInfo(firebaseAuth.currentUser.uid);
                }
              }}
            >
              <Text style={[styles.cancelButtonText, { color: theme.colors.secondary }]}>
                Cancel
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.saveButton, { backgroundColor: theme.colors.primary }]}
              onPress={saveVehicleInfo}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <Save size={20} color="white" />
                  <Text style={styles.saveButtonText}>Save</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    flex: 1,
    marginLeft: 12,
  },
  editButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  infoCard: {
    backgroundColor: 'white',
    padding: 16,
    marginBottom: 16,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '500',
  },
  input: {
    fontSize: 16,
    fontWeight: '500',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#F8FAFC',
  },
  divider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 12,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 32,
  },
  cancelButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    backgroundColor: 'white',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
});
