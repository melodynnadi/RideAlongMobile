import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  StatusBar,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, limit, query, setDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';
import { firebaseAuth, firebaseConfig, firestore, storage } from '@/constants/services';

import { useReturnNavigation } from '@/src/hooks/useReturnNavigation';
import { useAppTheme } from '@/hooks/ThemeContext';

interface VehicleInfo {
  make?: string;
  model?: string;
  year?: string;
  color?: string;
  licensePlate?: string;
  seats?: number;
  amenities?: string[];
  imageUrl?: string;
  imagePath?: string;
}

const AMENITY_OPTIONS = ['A/C', 'USB charging', 'Trunk space', 'Aux jack', 'Bluetooth', 'Pet-friendly', 'Bike rack'];
const SEAT_OPTIONS = [1, 2, 3, 4, 5, 6];

async function uploadVehicleImageFile(sourceUri: string, uid: string, idToken: string) {
  const jpegFormat = (ImageManipulator as any)?.SaveFormat?.JPEG || 'jpeg';
  const resized = await ImageManipulator.manipulateAsync(
    sourceUri,
    [{ resize: { width: 1200 } }],
    { compress: 0.78, format: jpegFormat as any },
  );

  const bucket = firebaseConfig.storageBucket;
  if (!bucket) throw new Error('Firebase Storage is not configured.');

  const imagePath = 'vehicleImages/' + uid + '/' + Date.now() + '_vehicle.jpg';
  const uploadUrl =
    'https://firebasestorage.googleapis.com/v0/b/' +
    encodeURIComponent(bucket) +
    '/o?name=' +
    encodeURIComponent(imagePath);

  const response = await FileSystem.uploadAsync(uploadUrl, resized.uri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      Authorization: 'Firebase ' + idToken,
      'Content-Type': 'image/jpeg',
    },
  });

  if (response.status < 200 || response.status >= 300) {
    let message = 'Vehicle image upload failed.';
    try {
      const body = JSON.parse(response.body);
      message = body?.error?.message || body?.error || message;
    } catch {}
    throw new Error(message);
  }

  const imageUrl = await getDownloadURL(storageRef(storage, imagePath));
  return { imageUrl, imagePath };
}
export default function VehicleInfoScreen() {
  const { colors } = useAppTheme();
  const { goBack } = useReturnNavigation('/(driver)/settings');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [vehicleInfo, setVehicleInfo] = useState<VehicleInfo>({
    make: '', model: '', year: '', color: '', licensePlate: '', seats: 3, amenities: [],
  });
  const [driverData, setDriverData] = useState<any>(null);
  const [pendingImageUri, setPendingImageUri] = useState<string | null>(null);

  const s = useMemo(() => StyleSheet.create({
    root:        { flex: 1, backgroundColor: colors.bg },
    safe:        { flex: 1 },
    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    content:     { paddingBottom: 40 },

    hdr:       { position: 'relative', minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 },
    backBtn:   { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
    hdrTitle:  { color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25, flex: 1, marginLeft: 12 },

    heroCard: {
      marginHorizontal: 20,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgSecondary,
      padding: 24,
      alignItems: 'center',
      marginBottom: 24,
    },
    vehicleImageButton: {
      width: '100%', aspectRatio: 16 / 9, marginBottom: 14,
      borderRadius: 12, overflow: 'visible',
    },
    vehicleImage: {
      width: '100%', height: '100%', borderRadius: 12,
      backgroundColor: colors.bgSecondary,
    },
    vehiclePlaceholder: {
      width: '100%', height: '100%', borderRadius: 12,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.bgSecondary, borderWidth: 1, borderColor: colors.border,
    },
    editImageBadge: {
      position: 'absolute', right: 10, bottom: 10,
      width: 34, height: 34, borderRadius: 17,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.bgCard,
    },
    heroName:    { color: colors.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
    heroSub:     { color: colors.textSecondary, fontSize: 14, marginTop: 4, textAlign: 'center' },
    changePhotoText: { color: colors.primary, fontSize: 13, fontWeight: '700', marginTop: 10 },

    sectionLabel: { marginHorizontal: 20, marginBottom: 8, marginTop: 4, color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
    sectionCard: {
      marginHorizontal: 20,
      marginBottom: 20,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgCard,
      padding: 16,
      shadowColor: colors.textPrimary,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.04,
      shadowRadius: 8,
      elevation: 1,
    },
    fieldRow:  { flexDirection: 'row', gap: 8 },
    fieldWrap: { marginBottom: 12 },
    fieldLabel:{ color: colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '500',
      backgroundColor: colors.bgSecondary,
    },

    pillRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    seatPill:       { height: 40, minWidth: 48, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    seatPillActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
    seatPillText:   { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
    seatPillTextActive: { color: colors.bgCard },

    chipsWrap:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip:         { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSecondary, paddingHorizontal: 12, paddingVertical: 8 },
    chipActive:   { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
    chipText:     { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    chipTextActive: { color: colors.bgCard },

    saveBtn: {
      marginHorizontal: 20,
      marginTop: 8,
      height: 54,
      borderRadius: 27,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    saveBtnText: { color: colors.textInverse, fontSize: 16, fontWeight: '700' },
  }), [colors]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
      if (user) await loadVehicleInfo(user.uid);
      else setLoading(false);
    });
    return unsubscribe;
  }, []);

  const loadVehicleInfo = async (uid: string) => {
    try {
      setLoading(true);
      const driverRef = doc(firestore, 'drivers', uid);
      const driverSnap = await getDoc(driverRef);
      const data = driverSnap.exists() ? driverSnap.data() : {};
      let applicationData: any = {};

      if (data.applicationId) {
        const applicationSnap = await getDoc(
          doc(firestore, 'driverApplications', String(data.applicationId)),
        );
        if (applicationSnap.exists()) applicationData = applicationSnap.data();
      }
      if (!Object.keys(applicationData).length) {
        try {
          const uidApplication = await getDoc(doc(firestore, 'driverApplications', uid));
          if (uidApplication.exists()) applicationData = uidApplication.data();
        } catch {}
      }

      if (!Object.keys(applicationData).length) {
        const email = firebaseAuth.currentUser?.email;
        const lookups = [
          query(collection(firestore, 'driverApplications'), where('userUid', '==', uid), limit(1)),
          ...(email
            ? [query(
                collection(firestore, 'driverApplications'),
                where('personalInfo.email', '==', email),
                limit(1),
              )]
            : []),
        ];

        for (const lookup of lookups) {
          try {
            const snapshot = await getDocs(lookup);
            if (!snapshot.empty) {
              applicationData = snapshot.docs[0].data();
              break;
            }
          } catch {}
        }
      }

      const applicationVehicle = applicationData.vehicleInfo || {};
      const storedVehicle = data.vehicleInfo || {};
      const vd = { ...applicationVehicle, ...storedVehicle };
      const makeModelParts = String(vd.makeModel || '').trim().split(/\s+/).filter(Boolean);
      const makeModelHasYear = /^\d{4}$/.test(makeModelParts[0] || '');
      const parsedYear = makeModelHasYear ? makeModelParts[0] : '';
      const parsedMake = makeModelParts[makeModelHasYear ? 1 : 0] || '';
      const parsedModel = makeModelParts.slice(makeModelHasYear ? 2 : 1).join(' ');

      setDriverData({ ...applicationData, ...data, vehicleInfo: vd });
      setVehicleInfo({
        make: vd.make || parsedMake,
        model: vd.model || parsedModel,
        year: String(vd.year || parsedYear),
        color: vd.color || vd.colour || '',
        licensePlate: vd.licensePlate || vd.license || '',
        seats: Number(vd.seats || 3),
        amenities: Array.isArray(vd.amenities) ? vd.amenities : [],
        imageUrl:
          vd.imageUrl ||
          vd.vehicleImageUrl ||
          (Array.isArray(vd.imageList) ? vd.imageList[0] : vd.imageList) ||
          '',
        imagePath: vd.imagePath || '',
      });
    } catch {
      Alert.alert('Error', 'Failed to load vehicle information');
    } finally {
      setLoading(false);
    }
  };
  const saveVehicleInfo = async () => {
    const user = firebaseAuth.currentUser;
    if (!user) return;

    const make  = vehicleInfo.make?.trim() || '';
    const model = vehicleInfo.model?.trim() || '';
    const year  = vehicleInfo.year?.trim() || '';
    const plate = vehicleInfo.licensePlate?.trim() || '';

    if (!make || !model) {
      Alert.alert('Missing info', 'Please enter your vehicle make and model.');
      return;
    }
    const yearNum = parseInt(year, 10);
    const maxYear = new Date().getFullYear() + 1;
    if (!year || isNaN(yearNum) || yearNum < 1980 || yearNum > maxYear) {
      Alert.alert('Invalid year', `Please enter a valid vehicle year (1980–${maxYear}).`);
      return;
    }
    if (!plate) {
      Alert.alert('Missing info', 'Please enter your license plate number.');
      return;
    }

    try {
      setSaving(true);
      let imageUrl = vehicleInfo.imageUrl || '';
      let imagePath = vehicleInfo.imagePath || '';

      if (pendingImageUri) {
        const uploaded = await uploadVehicleImageFile(
          pendingImageUri,
          user.uid,
          await user.getIdToken(),
        );
        imageUrl = uploaded.imageUrl;
        imagePath = uploaded.imagePath;
      }

      const licensePlate = plate;
      const savedVehicle = {
        ...(driverData?.vehicleInfo || {}),
        makeModel: [year, make, model].filter(Boolean).join(' '),
        make,
        model,
        year,
        color: vehicleInfo.color?.trim() || '',
        license: licensePlate,
        licensePlate,
        seats: vehicleInfo.seats || 3,
        amenities: vehicleInfo.amenities || [],
        imageUrl,
        imagePath,
      };

      await setDoc(
        doc(firestore, 'drivers', user.uid),
        { vehicleInfo: savedVehicle },
        { merge: true },
      );

      setVehicleInfo(savedVehicle);
      setDriverData((current: any) => ({ ...(current || {}), vehicleInfo: savedVehicle }));
      setPendingImageUri(null);
      Alert.alert('Saved', 'Vehicle information and amenities were updated.');
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to save vehicle information');
    } finally {
      setSaving(false);
    }
  };

  const chooseVehicleImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Photo access needed', 'Allow photo access to choose a vehicle image.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.9,
      });
      const selectedUri = result.canceled ? null : result.assets[0]?.uri;
      if (!selectedUri) return;

      const user = firebaseAuth.currentUser;
      if (!user) throw new Error('You must be signed in to update your vehicle photo.');

      setPendingImageUri(selectedUri);
      setUploadingImage(true);

      const { imageUrl, imagePath } = await uploadVehicleImageFile(
        selectedUri,
        user.uid,
        await user.getIdToken(),
      );

      const savedVehicle = {
        ...(driverData?.vehicleInfo || {}),
        ...vehicleInfo,
        imageUrl,
        imagePath,
        amenities: vehicleInfo.amenities || [],
      };
      await setDoc(
        doc(firestore, 'drivers', user.uid),
        { vehicleInfo: savedVehicle },
        { merge: true },
      );

      setVehicleInfo(savedVehicle);
      setDriverData((current: any) => ({ ...(current || {}), vehicleInfo: savedVehicle }));
      setPendingImageUri(null);
    } catch (error: any) {
      Alert.alert('Image unavailable', error?.message || 'Could not save that vehicle image.');
    } finally {
      setUploadingImage(false);
    }
  };
  const toggleAmenity = (a: string) => {
    setVehicleInfo((prev) => ({
      ...prev,
      amenities: prev.amenities?.includes(a)
        ? prev.amenities.filter((x) => x !== a)
        : [...(prev.amenities || []), a],
    }));
  };

  const displayName = `${vehicleInfo.year || ''} ${vehicleInfo.make || ''} ${vehicleInfo.model || ''}`.trim() || 'Your Vehicle';

  const vehicleImage = pendingImageUri || vehicleInfo.imageUrl || null;
  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <View style={s.loadingWrap}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle={colors.statusBar} />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>

          {/* Header */}
          <View style={s.hdr}>
            <TouchableOpacity
              style={s.backBtn}
              onPress={goBack}
            >
              <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={s.hdrTitle}>Vehicle</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Vehicle hero card */}
          <View style={s.heroCard}>
            <TouchableOpacity
              style={s.vehicleImageButton}
              onPress={chooseVehicleImage}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Change vehicle photo"
            >
              {vehicleImage ? (
                <Image source={{ uri: vehicleImage }} style={s.vehicleImage} resizeMode="cover" />
              ) : (
                <View style={s.vehiclePlaceholder}>
                  <Ionicons name="car-outline" size={44} color={colors.textSecondary} />
                </View>
              )}
              <View style={s.editImageBadge}>
                {uploadingImage ? <ActivityIndicator size="small" color={colors.textInverse} /> : <Ionicons name="camera" size={16} color={colors.textInverse} />}
              </View>
            </TouchableOpacity>
            <Text style={s.heroName}>{displayName}</Text>
            {vehicleInfo.color ? <Text style={s.heroSub}>{vehicleInfo.color}</Text> : null}
            <TouchableOpacity onPress={chooseVehicleImage} disabled={uploadingImage} activeOpacity={0.75}>
              <Text style={s.changePhotoText}>
                {vehicleImage ? 'Change vehicle photo' : 'Add vehicle photo'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* BASICS */}
          <Text style={s.sectionLabel}>BASICS</Text>
          <View style={s.sectionCard}>
            <View style={s.fieldRow}>
              <View style={[s.fieldWrap, { flex: 0.4 }]}>
                <Text style={s.fieldLabel}>YEAR</Text>
                <TextInput
                  style={s.input}
                  value={vehicleInfo.year}
                  onChangeText={(t) => setVehicleInfo((p) => ({ ...p, year: t }))}
                  placeholder="2021"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="numeric"
                  maxLength={4}
                />
              </View>
              <View style={[s.fieldWrap, { flex: 0.3 }]}>
                <Text style={s.fieldLabel}>MAKE</Text>
                <TextInput
                  style={s.input}
                  value={vehicleInfo.make}
                  onChangeText={(t) => setVehicleInfo((p) => ({ ...p, make: t }))}
                  placeholder="Honda"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
              <View style={[s.fieldWrap, { flex: 0.3 }]}>
                <Text style={s.fieldLabel}>MODEL</Text>
                <TextInput
                  style={s.input}
                  value={vehicleInfo.model}
                  onChangeText={(t) => setVehicleInfo((p) => ({ ...p, model: t }))}
                  placeholder="Civic"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
            </View>
            <View style={s.fieldWrap}>
              <Text style={s.fieldLabel}>LICENSE PLATE</Text>
              <TextInput
                style={s.input}
                value={vehicleInfo.licensePlate}
                onChangeText={(t) => setVehicleInfo((p) => ({ ...p, licensePlate: t }))}
                placeholder="TX 8RZP-129"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="characters"
              />
            </View>
            <View style={s.fieldWrap}>
              <Text style={s.fieldLabel}>COLOR</Text>
              <TextInput
                style={s.input}
                value={vehicleInfo.color}
                onChangeText={(t) => setVehicleInfo((p) => ({ ...p, color: t }))}
                placeholder="Silver"
                placeholderTextColor={colors.textSecondary}
              />
            </View>
          </View>

          {/* SEATS AVAILABLE */}
          <Text style={s.sectionLabel}>SEATS AVAILABLE</Text>
          <View style={s.sectionCard}>
            <View style={s.pillRow}>
              {SEAT_OPTIONS.map((n) => (
                <TouchableOpacity
                  key={n}
                  style={[s.seatPill, vehicleInfo.seats === n && s.seatPillActive]}
                  onPress={() => setVehicleInfo((p) => ({ ...p, seats: n }))}
                >
                  <Text style={[s.seatPillText, vehicleInfo.seats === n && s.seatPillTextActive]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* AMENITIES */}
          <Text style={s.sectionLabel}>AMENITIES</Text>
          <View style={s.sectionCard}>
            <View style={s.chipsWrap}>
              {AMENITY_OPTIONS.map((a) => {
                const active = vehicleInfo.amenities?.includes(a);
                return (
                  <TouchableOpacity
                    key={a}
                    style={[s.chip, active && s.chipActive]}
                    onPress={() => toggleAmenity(a)}
                  >
                    <Text style={[s.chipText, active && s.chipTextActive]}>{a}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          {/* Save */}
          <TouchableOpacity style={s.saveBtn} onPress={saveVehicleInfo} disabled={saving || uploadingImage}>
            {saving ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={s.saveBtnText}>Save</Text>
            )}
          </TouchableOpacity>

          <View style={{ height: 24 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
