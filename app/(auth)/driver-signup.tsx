import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView,
  Dimensions, Linking, Animated, Easing, Image, TextInput,
  KeyboardAvoidingView, Platform, useColorScheme, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { createUserWithEmailAndPassword, updateProfile, sendEmailVerification } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { firebaseAuth, firestore, storage } from '@/constants/services';
import { UniversitySearch } from '@/components/ui/UniversitySearch';

const { width, height } = Dimensions.get('window');

// ─── Design Tokens ────────────────────────────────────────────────────────────
const COLORS = {
  orange:       '#F4621F',
  orangeLight:  '#FF8C4A',
  orangeGlow:   'rgba(244,98,31,0.15)',
  orangeBorder: 'rgba(244,98,31,0.45)',
  navy:         '#0D1B2A',
  green:        '#10B981',
  red:          '#EF4444',
  darkBg:       '#080E17',
  darkCard:     'rgba(255,255,255,0.06)',
  darkBorder:   'rgba(255,255,255,0.11)',
  darkText:     '#F0F4FF',
  darkSub:      '#7A8FA8',
  darkInput:    'rgba(255,255,255,0.07)',
  darkInputBorder: 'rgba(255,255,255,0.13)',
  lightBg:      '#EEF1F7',
  lightCard:    'rgba(255,255,255,0.75)',
  lightBorder:  'rgba(255,255,255,0.9)',
  lightText:    '#0D1B2A',
  lightSub:     '#5A6A7E',
  lightInput:   'rgba(255,255,255,0.9)',
  lightInputBorder: 'rgba(200,210,225,0.8)',
};

function useAppTheme() {
  const dark = useColorScheme() === 'dark';
  return {
    dark,
    bg:          dark ? COLORS.darkBg          : COLORS.lightBg,
    card:        dark ? COLORS.darkCard        : COLORS.lightCard,
    border:      dark ? COLORS.darkBorder      : COLORS.lightBorder,
    text:        dark ? COLORS.darkText        : COLORS.lightText,
    sub:         dark ? COLORS.darkSub         : COLORS.lightSub,
    input:       dark ? COLORS.darkInput       : COLORS.lightInput,
    inputBorder: dark ? COLORS.darkInputBorder : COLORS.lightInputBorder,
  };
}

// ─── Floating Orb ─────────────────────────────────────────────────────────────
function FloatingOrb({ startX, startY, size, color, opacity, driftX, driftY, duration }: {
  startX: number; startY: number; size: number; color: string;
  opacity: number; driftX: number; driftY: number; duration: number;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();
  }, []);
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, driftX] });
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, driftY] });
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute',
      left: startX - size / 2, top: startY - size / 2,
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: color, opacity,
      transform: [{ translateX }, { translateY }],
      shadowColor: color, shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.8, shadowRadius: size / 3,
    }} />
  );
}

// ─── Styled Input ─────────────────────────────────────────────────────────────
function StyledInput({ label, value, onChangeText, placeholder, keyboardType,
  autoCapitalize, error, helpText, editable, theme, secureTextEntry }: {
  label: string; value: string; onChangeText: (t: string) => void;
  placeholder: string; keyboardType?: any; autoCapitalize?: any;
  error?: string; helpText?: string; editable?: boolean;
  theme: ReturnType<typeof useAppTheme>; secureTextEntry?: boolean;
}) {
  const focused = useRef(new Animated.Value(0)).current;
  const borderColor = focused.interpolate({
    inputRange:  [0, 1],
    outputRange: [error ? 'rgba(239,68,68,0.6)' : theme.inputBorder, COLORS.orangeBorder],
  });
  return (
    <View style={s.inputGroup}>
      <Text style={[s.label, { color: theme.sub }]}>{label}</Text>
      <Animated.View style={[s.inputWrap, { backgroundColor: theme.input, borderColor }]}>
        <BlurView intensity={theme.dark ? 20 : 40} tint={theme.dark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
        <TextInput
          style={[s.textInput, { color: theme.text }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.dark ? '#3A5570' : '#A0B0C0'}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize || 'none'}
          secureTextEntry={secureTextEntry}
          editable={editable !== false}
          onFocus={() => Animated.timing(focused, { toValue: 1, duration: 180, useNativeDriver: false }).start()}
          onBlur={()  => Animated.timing(focused, { toValue: 0, duration: 180, useNativeDriver: false }).start()}
        />
      </Animated.View>
      {error    ? <Text style={s.errorText}>{error}</Text>    : null}
      {helpText ? <Text style={[s.helpText, { color: theme.sub }]}>{helpText}</Text> : null}
    </View>
  );
}

// ─── Photo Upload Button ──────────────────────────────────────────────────────
function PhotoUpload({ label, uri, onPick, theme }: {
  label: string; uri: string | null;
  onPick: () => void; theme: ReturnType<typeof useAppTheme>;
}) {
  return (
    <TouchableOpacity onPress={onPick} activeOpacity={0.8} style={[s.photoBtn, {
      backgroundColor: uri ? COLORS.orangeGlow : theme.input,
      borderColor: uri ? COLORS.orangeBorder : theme.inputBorder,
    }]}>
      <BlurView intensity={theme.dark ? 20 : 30} tint={theme.dark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
      {uri ? (
        <View style={s.photoBtnInner}>
          <Ionicons name="checkmark-circle" size={24} color={COLORS.orange} />
          <Text style={[s.photoBtnText, { color: COLORS.orange }]}>{label} ✓</Text>
        </View>
      ) : (
        <View style={s.photoBtnInner}>
          <Ionicons name="camera-outline" size={24} color={theme.sub} />
          <Text style={[s.photoBtnText, { color: theme.sub }]}>{label}</Text>
          <Text style={[s.photoBtnSub, { color: theme.sub }]}>Tap to upload</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Step Bar ─────────────────────────────────────────────────────────────────
function StepBar({ current, total }: { current: number; total: number }) {
  return (
    <View style={s.stepBar}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[
          s.stepSegment,
          { backgroundColor: i < current ? COLORS.orange : 'rgba(150,170,190,0.25)' },
          i < total - 1 && { marginRight: 5 },
        ]} />
      ))}
    </View>
  );
}

// ─── Select Button ────────────────────────────────────────────────────────────
function SelectRow({ label, options, value, onSelect, theme }: {
  label: string; options: { label: string; value: string }[];
  value: string; onSelect: (v: string) => void;
  theme: ReturnType<typeof useAppTheme>;
}) {
  return (
    <View style={s.inputGroup}>
      <Text style={[s.label, { color: theme.sub }]}>{label}</Text>
      <View style={s.selectRow}>
        {options.map((opt) => {
          const active = value === opt.value;
          return active ? (
            <TouchableOpacity key={opt.value} onPress={() => onSelect(opt.value)} activeOpacity={0.8} style={{ flex: 1 }}>
              <LinearGradient colors={[COLORS.orange, COLORS.orangeLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.selectBtn}>
                <Text style={[s.selectBtnText, { color: 'white' }]}>{opt.label}</Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity key={opt.value} onPress={() => onSelect(opt.value)} activeOpacity={0.8}
              style={[s.selectBtn, s.selectBtnInactive, { borderColor: theme.inputBorder, backgroundColor: theme.input, flex: 1 }]}>
              <Text style={[s.selectBtnText, { color: theme.sub }]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ─── Checkbox ─────────────────────────────────────────────────────────────────
function Checkbox({ checked, onToggle, label, theme, linkLabel, onLinkPress }: {
  checked: boolean; onToggle: () => void; label: string;
  theme: ReturnType<typeof useAppTheme>; linkLabel?: string; onLinkPress?: () => void;
}) {
  return (
    <TouchableOpacity onPress={onToggle} style={s.checkRow} activeOpacity={0.7}>
      <View style={[s.checkbox, checked && s.checkboxActive]}>
        {checked && <Ionicons name="checkmark" size={13} color="white" />}
      </View>
      <Text style={[s.checkLabel, { color: theme.sub }]}>
        {label}
        {linkLabel ? (
          <Text onPress={onLinkPress} style={s.checkLink}> {linkLabel}</Text>
        ) : null}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function DriverSignupScreen() {
  const theme = useAppTheme();
  const [step, setStep] = useState(1);
  const TOTAL = 5;

  // Step 1 — Personal Info
  const [firstName,      setFirstName]      = useState('');
  const [lastName,       setLastName]       = useState('');
  const [email,          setEmail]          = useState('');
  const [phone,          setPhone]          = useState('');
  const [university,     setUniversity]     = useState('');
  const [universityData, setUniversityData] = useState<any>(null);
  const [dob,            setDob]            = useState('');
  const [password,       setPassword]       = useState('');

  // Step 2 — License
  const [licenseNumber,  setLicenseNumber]  = useState('');
  const [licenseState,   setLicenseState]   = useState('');
  const [licenseExpiry,  setLicenseExpiry]  = useState('');
  const [licenseFront,   setLicenseFront]   = useState<string | null>(null);
  const [licenseBack,    setLicenseBack]    = useState<string | null>(null);

  // Step 3 — Vehicle
  const [vehicleYear,    setVehicleYear]    = useState('');
  const [vehicleMake,    setVehicleMake]    = useState('');
  const [vehicleModel,   setVehicleModel]   = useState('');
  const [vehicleColor,   setVehicleColor]   = useState('');
  const [licensePlate,   setLicensePlate]   = useState('');
  const [vehicleSeats,   setVehicleSeats]   = useState('');

  // Step 4 — Insurance
  const [insCompany,     setInsCompany]     = useState('');
  const [insPolicy,      setInsPolicy]      = useState('');
  const [insExpiry,      setInsExpiry]      = useState('');
  const [insDoc,         setInsDoc]         = useState<string | null>(null);

  // Step 5 — Agreements
  const [agreeTerms,     setAgreeTerms]     = useState(false);
  const [agreeDriver,    setAgreeDriver]    = useState(false);
  const [agreeBackground,setAgreeBackground]= useState(false);
  const [agreeStudent,   setAgreeStudent]   = useState(false);

  const [loading,     setLoading]     = useState(false);
  const [showErrors,  setShowErrors]  = useState(false);

  // entrance animations
  const fadeTop  = useRef(new Animated.Value(0)).current;
  const slideTop = useRef(new Animated.Value(30)).current;
  const fadeCard = useRef(new Animated.Value(0)).current;
  const slideCard= useRef(new Animated.Value(40)).current;

  useEffect(() => {
    fadeTop.setValue(0); slideTop.setValue(30);
    fadeCard.setValue(0); slideCard.setValue(40);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(fadeTop,  { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring(slideTop, { toValue: 0, friction: 8,   useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(fadeCard,  { toValue: 1, duration: 340, useNativeDriver: true }),
        Animated.spring(slideCard, { toValue: 0, friction: 8,   useNativeDriver: true }),
      ]),
    ]).start();
  }, [step]);

  const pickImage = async (setter: (uri: string) => void) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Please allow photo access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!result.canceled && result.assets[0]) setter(result.assets[0].uri);
  };

  const stepErrors = useMemo(() => {
    const e: Record<string, string> = {};
    if (step === 1) {
      if (!firstName.trim())                                     e.firstName = 'Required';
      if (!lastName.trim())                                      e.lastName  = 'Required';
      if (!email.trim())                                         e.email     = 'Required';
      else if (!/^[^@\s]+@[^@\s]+\.edu$/i.test(email))         e.email     = 'Must be a .edu email';
      if (!phone.trim())                                         e.phone     = 'Required';
      if (!university.trim())                                    e.university= 'Required';
      if (!dob.trim())                                           e.dob       = 'Required';
      if (!password || password.length < 8)                     e.password  = 'Min 8 characters';
    }
    if (step === 2) {
      if (!licenseNumber.trim()) e.licenseNumber = 'Required';
      if (!licenseState.trim())  e.licenseState  = 'Required';
      if (!licenseExpiry.trim()) e.licenseExpiry = 'Required';
      if (!licenseFront)         e.licenseFront  = 'Please upload front of license';
      if (!licenseBack)          e.licenseBack   = 'Please upload back of license';
    }
    if (step === 3) {
      if (!vehicleYear.trim())  e.vehicleYear  = 'Required';
      if (!vehicleMake.trim())  e.vehicleMake  = 'Required';
      if (!vehicleModel.trim()) e.vehicleModel = 'Required';
      if (!vehicleColor.trim()) e.vehicleColor = 'Required';
      if (!licensePlate.trim()) e.licensePlate = 'Required';
      if (!vehicleSeats)        e.vehicleSeats = 'Required';
    }
    if (step === 4) {
      if (!insCompany.trim()) e.insCompany = 'Required';
      if (!insPolicy.trim())  e.insPolicy  = 'Required';
      if (!insExpiry.trim())  e.insExpiry  = 'Required';
      if (!insDoc)            e.insDoc     = 'Please upload insurance document';
    }
    if (step === 5) {
      if (!agreeTerms)      e.agreeTerms      = 'Required';
      if (!agreeDriver)     e.agreeDriver     = 'Required';
      if (!agreeBackground) e.agreeBackground = 'Required';
      if (!agreeStudent)    e.agreeStudent    = 'Required';
    }
    return e;
  }, [step, firstName, lastName, email, phone, university, dob, password,
      licenseNumber, licenseState, licenseExpiry, licenseFront, licenseBack,
      vehicleYear, vehicleMake, vehicleModel, vehicleColor, licensePlate, vehicleSeats,
      insCompany, insPolicy, insExpiry, insDoc,
      agreeTerms, agreeDriver, agreeBackground, agreeStudent]);

  const handleNext = () => {
    if (Object.keys(stepErrors).length) {
      setShowErrors(true);
      Alert.alert('Please complete this step', Object.values(stepErrors).join('\n'));
      return;
    }
    setShowErrors(false);
    if (step < TOTAL) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) { setStep(step - 1); setShowErrors(false); }
    else router.back();
  };

  const uploadFile = async (uri: string, path: string): Promise<string> => {
    const response = await fetch(uri);
    const blob = await response.blob();
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, blob);
    return getDownloadURL(storageRef);
  };

  const handleSubmit = async () => {
    if (Object.keys(stepErrors).length) {
      setShowErrors(true);
      Alert.alert('Please complete all fields', Object.values(stepErrors).join('\n'));
      return;
    }
    try {
      setLoading(true);
      const cred = await createUserWithEmailAndPassword(firebaseAuth, email.trim().toLowerCase(), password);
      const { user } = cred;
      await updateProfile(user, { displayName: `${firstName} ${lastName}` });
      await sendEmailVerification(user);

      // Upload files
      const [licenseFrontUrl, licenseBackUrl, insDocUrl] = await Promise.all([
        licenseFront ? uploadFile(licenseFront, `drivers/${user.uid}/license_front`) : Promise.resolve(''),
        licenseBack  ? uploadFile(licenseBack,  `drivers/${user.uid}/license_back`)  : Promise.resolve(''),
        insDoc       ? uploadFile(insDoc,        `drivers/${user.uid}/insurance`)     : Promise.resolve(''),
      ]);

      await setDoc(doc(firestore, 'drivers', user.uid), {
        firstName: firstName.trim(),
        lastName:  lastName.trim(),
        email:     email.trim().toLowerCase(),
        phone:     phone.trim(),
        university: universityData?.name || university,
        universityData: universityData || { name: university, custom: true },
        dateOfBirth: dob,
        license: { number: licenseNumber, state: licenseState, expiry: licenseExpiry, frontUrl: licenseFrontUrl, backUrl: licenseBackUrl },
        vehicle: { year: vehicleYear, make: vehicleMake, model: vehicleModel, color: vehicleColor, plate: licensePlate, seats: vehicleSeats },
        insurance: { company: insCompany, policyNumber: insPolicy, expiry: insExpiry, docUrl: insDocUrl },
        status: 'pending_review',
        isVerified: false,
        emailVerified: false,
        createdAt: serverTimestamp(),
      });

      Alert.alert(
        '✅ Application Submitted!',
        `Thank you ${firstName}! Your driver application is under review. We'll email you at ${email} once approved.\n\nPlease verify your email to activate your account.`,
        [{ text: 'Continue', onPress: () => router.replace('/(auth)/verify-email') }],
      );
    } catch (err: any) {
      let msg = 'Submission failed';
      if (err?.code === 'auth/email-already-in-use') msg = 'This email is already registered.';
      else if (err?.code === 'auth/invalid-email')   msg = 'Invalid email address.';
      else if (err?.code === 'auth/weak-password')   msg = 'Password is too weak.';
      Alert.alert('❌ Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const stepTitles = ['Personal Info', "Driver's License", 'Vehicle Info', 'Insurance', 'Review & Submit'];
  const stepSubs   = [
    'Tell us about yourself',
    'Upload your license details',
    'Tell us about your car',
    'Upload your insurance',
    'Review and agree to terms',
  ];

  const stateOptions = [
    { label: 'TX', value: 'TX' }, { label: 'OK', value: 'OK' },
    { label: 'LA', value: 'LA' }, { label: 'AR', value: 'AR' },
    { label: 'NM', value: 'NM' }, { label: 'Other', value: 'other' },
  ];

  const seatOptions = [
    { label: '2 seats', value: '2' },
    { label: '4 seats', value: '4' },
    { label: '6 seats', value: '6' },
  ];

  const bgGradient: [string, string, string] = theme.dark
    ? ['#080E17', '#0D1620', '#111E2C']
    : ['#EEF1F7', '#F5F7FB', '#FFFFFF'];

  return (
    <View style={s.root}>
      <StatusBar barStyle={theme.dark ? 'light-content' : 'dark-content'} />
      <LinearGradient colors={bgGradient} style={StyleSheet.absoluteFillObject} />

      <FloatingOrb startX={-40}          startY={height * 0.08} size={260} color={COLORS.orange} opacity={theme.dark ? 0.10 : 0.06} driftX={22}  driftY={18}  duration={5510} />
      <FloatingOrb startX={width + 40}   startY={height * 0.42} size={220} color={COLORS.navy}   opacity={theme.dark ? 0.28 : 0.05} driftX={-18} driftY={24}  duration={6840} />
      <FloatingOrb startX={width * 0.82} startY={height * 0.22} size={100} color={COLORS.orangeLight} opacity={theme.dark ? 0.08 : 0.05} driftX={-10} driftY={16} duration={7600} />

      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: 48 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* Top bar */}
            <Animated.View style={[s.topBar, { opacity: fadeTop, transform: [{ translateY: slideTop }] }]}>
              <TouchableOpacity onPress={handleBack} style={[s.backBtn, { backgroundColor: theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)' }]}>
                <Ionicons name="arrow-back" size={20} color={theme.text} />
              </TouchableOpacity>
              <Image source={require('@/assets/images/logo.png')} style={s.logoImage} resizeMode="contain" />
            </Animated.View>

            {/* Step bar */}
            <Animated.View style={{ opacity: fadeTop, transform: [{ translateY: slideTop }] }}>
              <StepBar current={step} total={TOTAL} />
            </Animated.View>

            {/* Hero */}
            <Animated.View style={[s.hero, { opacity: fadeTop, transform: [{ translateY: slideTop }] }]}>
              <Text style={[s.stepChip, { color: COLORS.orange }]}>Step {step} of {TOTAL}</Text>
              <Text style={[s.heroTitle, { color: theme.text }]}>{stepTitles[step - 1]}</Text>
              <Text style={[s.heroSub, { color: theme.sub }]}>{stepSubs[step - 1]}</Text>
            </Animated.View>

            {/* Glass card */}
            <Animated.View style={[s.card, {
              backgroundColor: theme.card, borderColor: theme.border,
              opacity: fadeCard, transform: [{ translateY: slideCard }],
            }]}>
              <BlurView intensity={theme.dark ? 28 : 55} tint={theme.dark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
              <View style={s.cardInner}>

                {/* ── Step 1 ── */}
                {step === 1 && (
                  <>
                    <View style={s.row}>
                      <View style={{ flex: 1 }}>
                        <StyledInput label="First Name *" value={firstName} onChangeText={setFirstName} placeholder="Jane" autoCapitalize="words" error={showErrors ? stepErrors.firstName : undefined} theme={theme} />
                      </View>
                      <View style={{ width: 12 }} />
                      <View style={{ flex: 1 }}>
                        <StyledInput label="Last Name *" value={lastName} onChangeText={setLastName} placeholder="Doe" autoCapitalize="words" error={showErrors ? stepErrors.lastName : undefined} theme={theme} />
                      </View>
                    </View>
                    <StyledInput label="University Email (.edu) *" value={email} onChangeText={setEmail} placeholder="you@university.edu" keyboardType="email-address" error={showErrors ? stepErrors.email : undefined} theme={theme} />
                    <StyledInput label="Phone Number *" value={phone} onChangeText={setPhone} placeholder="+1 (555) 000-0000" keyboardType="phone-pad" error={showErrors ? stepErrors.phone : undefined} theme={theme} />
                    <View style={s.inputGroup}>
                      <Text style={[s.label, { color: theme.sub }]}>University *</Text>
                      <View style={[s.inputWrap, { borderColor: showErrors && stepErrors.university ? 'rgba(239,68,68,0.6)' : theme.inputBorder, backgroundColor: theme.input, height: 'auto', minHeight: 52 }]}>
                        <UniversitySearch
                          value={university}
                          onSelect={(uni) => {
                            if (uni) { setUniversity(uni.displayName || uni.name); setUniversityData(uni); }
                            else     { setUniversity(''); setUniversityData(null); }
                          }}
                          placeholder="Search your university..."
                        />
                      </View>
                      {showErrors && stepErrors.university ? <Text style={s.errorText}>{stepErrors.university}</Text> : null}
                    </View>
                    <StyledInput label="Date of Birth *" value={dob} onChangeText={setDob} placeholder="MM/DD/YYYY" keyboardType="numbers-and-punctuation" helpText="Must be 18 or older" error={showErrors ? stepErrors.dob : undefined} theme={theme} />
                    <StyledInput label="Password *" value={password} onChangeText={setPassword} placeholder="Min 8 characters" secureTextEntry helpText="You'll use this to sign in" error={showErrors ? stepErrors.password : undefined} theme={theme} />
                  </>
                )}

                {/* ── Step 2 ── */}
                {step === 2 && (
                  <>
                    <StyledInput label="License Number *" value={licenseNumber} onChangeText={setLicenseNumber} placeholder="DL1234567" autoCapitalize="characters" error={showErrors ? stepErrors.licenseNumber : undefined} theme={theme} />
                    <SelectRow label="State Issued *" options={stateOptions} value={licenseState} onSelect={setLicenseState} theme={theme} />
                    {showErrors && stepErrors.licenseState ? <Text style={[s.errorText, { marginTop: -8, marginBottom: 12 }]}>{stepErrors.licenseState}</Text> : null}
                    <StyledInput label="Expiry Date *" value={licenseExpiry} onChangeText={setLicenseExpiry} placeholder="MM/DD/YYYY" keyboardType="numbers-and-punctuation" error={showErrors ? stepErrors.licenseExpiry : undefined} theme={theme} />
                    <Text style={[s.label, { color: theme.sub, marginBottom: 10 }]}>License Photos *</Text>
                    <View style={s.photoRow}>
                      <View style={{ flex: 1 }}>
                        <PhotoUpload label="Front" uri={licenseFront} onPick={() => pickImage(setLicenseFront)} theme={theme} />
                        {showErrors && stepErrors.licenseFront ? <Text style={s.errorText}>{stepErrors.licenseFront}</Text> : null}
                      </View>
                      <View style={{ width: 12 }} />
                      <View style={{ flex: 1 }}>
                        <PhotoUpload label="Back" uri={licenseBack} onPick={() => pickImage(setLicenseBack)} theme={theme} />
                        {showErrors && stepErrors.licenseBack ? <Text style={s.errorText}>{stepErrors.licenseBack}</Text> : null}
                      </View>
                    </View>
                  </>
                )}

                {/* ── Step 3 ── */}
                {step === 3 && (
                  <>
                    <View style={s.row}>
                      <View style={{ flex: 1 }}>
                        <StyledInput label="Year *" value={vehicleYear} onChangeText={setVehicleYear} placeholder="2020" keyboardType="number-pad" error={showErrors ? stepErrors.vehicleYear : undefined} theme={theme} />
                      </View>
                      <View style={{ width: 12 }} />
                      <View style={{ flex: 1 }}>
                        <StyledInput label="Make *" value={vehicleMake} onChangeText={setVehicleMake} placeholder="Honda" autoCapitalize="words" error={showErrors ? stepErrors.vehicleMake : undefined} theme={theme} />
                      </View>
                    </View>
                    <View style={s.row}>
                      <View style={{ flex: 1 }}>
                        <StyledInput label="Model *" value={vehicleModel} onChangeText={setVehicleModel} placeholder="Civic" autoCapitalize="words" error={showErrors ? stepErrors.vehicleModel : undefined} theme={theme} />
                      </View>
                      <View style={{ width: 12 }} />
                      <View style={{ flex: 1 }}>
                        <StyledInput label="Color *" value={vehicleColor} onChangeText={setVehicleColor} placeholder="White" autoCapitalize="words" error={showErrors ? stepErrors.vehicleColor : undefined} theme={theme} />
                      </View>
                    </View>
                    <StyledInput label="License Plate *" value={licensePlate} onChangeText={setLicensePlate} placeholder="ABC1234" autoCapitalize="characters" error={showErrors ? stepErrors.licensePlate : undefined} theme={theme} />
                    <SelectRow label="Passenger Seats *" options={seatOptions} value={vehicleSeats} onSelect={setVehicleSeats} theme={theme} />
                    {showErrors && stepErrors.vehicleSeats ? <Text style={[s.errorText, { marginTop: -8 }]}>{stepErrors.vehicleSeats}</Text> : null}
                    <View style={[s.infoBox, { backgroundColor: theme.dark ? 'rgba(244,98,31,0.08)' : 'rgba(244,98,31,0.06)', borderColor: 'rgba(244,98,31,0.25)' }]}>
                      <Ionicons name="information-circle" size={15} color={COLORS.orange} />
                      <Text style={[s.infoText, { color: theme.sub }]}>RideAlong allows max 2 passengers per ride for safety and comfort.</Text>
                    </View>
                  </>
                )}

                {/* ── Step 4 ── */}
                {step === 4 && (
                  <>
                    <View style={s.row}>
                      <View style={{ flex: 1 }}>
                        <StyledInput label="Insurance Company *" value={insCompany} onChangeText={setInsCompany} placeholder="State Farm" autoCapitalize="words" error={showErrors ? stepErrors.insCompany : undefined} theme={theme} />
                      </View>
                      <View style={{ width: 12 }} />
                      <View style={{ flex: 1 }}>
                        <StyledInput label="Policy Number *" value={insPolicy} onChangeText={setInsPolicy} placeholder="POL123456" autoCapitalize="characters" error={showErrors ? stepErrors.insPolicy : undefined} theme={theme} />
                      </View>
                    </View>
                    <StyledInput label="Policy Expiry *" value={insExpiry} onChangeText={setInsExpiry} placeholder="MM/DD/YYYY" keyboardType="numbers-and-punctuation" error={showErrors ? stepErrors.insExpiry : undefined} theme={theme} />
                    <Text style={[s.label, { color: theme.sub, marginBottom: 10 }]}>Insurance Document *</Text>
                    <PhotoUpload label="Upload Insurance Doc" uri={insDoc} onPick={() => pickImage(setInsDoc)} theme={theme} />
                    {showErrors && stepErrors.insDoc ? <Text style={s.errorText}>{stepErrors.insDoc}</Text> : null}
                  </>
                )}

                {/* ── Step 5 ── */}
                {step === 5 && (
                  <>
                    {/* Summary */}
                    <View style={[s.reviewBox, { backgroundColor: theme.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)', borderColor: theme.inputBorder }]}>
                      <Text style={[s.reviewTitle, { color: theme.text }]}>Application Summary</Text>
                      {[
                        { icon: 'person-outline' as const,        label: 'Name',      value: `${firstName} ${lastName}` },
                        { icon: 'mail-outline' as const,          label: 'Email',     value: email },
                        { icon: 'school-outline' as const,        label: 'University',value: university },
                        { icon: 'card-outline' as const,          label: 'License',   value: `${licenseState} — ${licenseNumber}` },
                        { icon: 'car-outline' as const,           label: 'Vehicle',   value: `${vehicleYear} ${vehicleMake} ${vehicleModel}` },
                        { icon: 'shield-outline' as const,        label: 'Insurance', value: insCompany },
                      ].map(({ icon, label, value }) => (
                        <View key={label} style={s.reviewRow}>
                          <View style={[s.reviewIcon, { backgroundColor: theme.dark ? 'rgba(244,98,31,0.10)' : COLORS.orangeGlow }]}>
                            <Ionicons name={icon} size={15} color={COLORS.orange} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[s.reviewLabel, { color: theme.sub }]}>{label}</Text>
                            <Text style={[s.reviewValue, { color: theme.text }]} numberOfLines={1}>{value}</Text>
                          </View>
                        </View>
                      ))}
                    </View>

                    {/* Agreements */}
                    <View style={s.agreements}>
                      <Checkbox checked={agreeTerms} onToggle={() => setAgreeTerms(v => !v)} theme={theme}
                        label="I agree to the" linkLabel="Terms of Service & Privacy Policy"
                        onLinkPress={() => Linking.openURL('https://ridealongapp.com/pages/terms')} />
                      <Checkbox checked={agreeDriver} onToggle={() => setAgreeDriver(v => !v)} theme={theme}
                        label="I agree to the Driver Agreement and understand my responsibilities" />
                      <Checkbox checked={agreeBackground} onToggle={() => setAgreeBackground(v => !v)} theme={theme}
                        label="I consent to verification of my student status, license, and insurance" />
                      <Checkbox checked={agreeStudent} onToggle={() => setAgreeStudent(v => !v)} theme={theme}
                        label="I confirm I am a currently enrolled student at an accredited university" />
                    </View>
                    {showErrors && Object.keys(stepErrors).length ? (
                      <Text style={[s.errorText, { marginTop: 4 }]}>Please agree to all terms above</Text>
                    ) : null}
                  </>
                )}

                {/* CTA */}
                <TouchableOpacity
                  onPress={step < TOTAL ? handleNext : handleSubmit}
                  disabled={loading}
                  activeOpacity={0.86}
                  style={{ marginTop: 24 }}
                >
                  <LinearGradient colors={[COLORS.orange, COLORS.orangeLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.ctaBtn}>
                    <Text style={s.ctaBtnText}>
                      {step < TOTAL ? 'Continue' : (loading ? 'Submitting…' : 'Submit Application')}
                    </Text>
                    {!loading && (
                      <View style={s.ctaArrow}>
                        <Ionicons name={step < TOTAL ? 'arrow-forward' : 'checkmark'} size={16} color="white" />
                      </View>
                    )}
                  </LinearGradient>
                </TouchableOpacity>

              </View>
            </Animated.View>

            <TouchableOpacity onPress={() => router.push('/(auth)/sign-in')} style={s.footer}>
              <Text style={[s.footerText, { color: theme.sub }]}>
                Already have an account?{'  '}<Text style={s.footerLink}>Sign In</Text>
              </Text>
            </TouchableOpacity>

          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 22, flexGrow: 1 },

  topBar:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 4 },
  backBtn:   { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  logoImage: { height: 52, width: 52, borderRadius: 14 },

  stepBar:     { flexDirection: 'row', marginTop: 16, marginBottom: 4 },
  stepSegment: { flex: 1, height: 3, borderRadius: 2 },

  hero:      { paddingTop: 18, paddingBottom: 20 },
  stepChip:  { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 },
  heroTitle: { fontSize: 32, fontWeight: '800', letterSpacing: -1, lineHeight: 40 },
  heroSub:   { fontSize: 14, fontWeight: '400', marginTop: 6, lineHeight: 20 },

  card: {
    borderRadius: 26, borderWidth: 1.5, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.09, shadowRadius: 22, elevation: 10,
  },
  cardInner: { padding: 22 },

  row:        { flexDirection: 'row' },
  inputGroup: { marginBottom: 16 },
  label:      { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 },
  inputWrap:  { borderRadius: 14, borderWidth: 1.5, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', height: 52 },
  textInput:  { flex: 1, paddingHorizontal: 16, fontSize: 15, fontWeight: '400', height: '100%' },
  errorText:  { fontSize: 12, color: COLORS.red, marginTop: 4 },
  helpText:   { fontSize: 12, marginTop: 4, fontWeight: '400' },

  photoRow: { flexDirection: 'row', marginBottom: 4 },
  photoBtn: {
    borderRadius: 16, borderWidth: 1.5, overflow: 'hidden',
    paddingVertical: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  photoBtnInner: { alignItems: 'center', gap: 6 },
  photoBtnText:  { fontSize: 13, fontWeight: '600' },
  photoBtnSub:   { fontSize: 11, fontWeight: '400' },

  selectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  selectBtn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  selectBtnInactive: { borderWidth: 1.5 },
  selectBtnText: { fontSize: 13, fontWeight: '600' },

  infoBox:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 8 },
  infoText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '400' },

  reviewBox:   { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12, marginBottom: 20 },
  reviewTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  reviewRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewIcon:  { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  reviewLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 1 },
  reviewValue: { fontSize: 14, fontWeight: '600' },

  agreements: { gap: 14, marginBottom: 4 },
  checkRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox:   { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: 'rgba(150,170,190,0.5)', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxActive: { backgroundColor: COLORS.orange, borderColor: COLORS.orange },
  checkLabel: { flex: 1, fontSize: 13, lineHeight: 20, fontWeight: '400' },
  checkLink:  { color: COLORS.orange, fontWeight: '600' },

  ctaBtn:    { borderRadius: 50, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    shadowColor: COLORS.orange, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 8 },
  ctaBtnText:{ fontSize: 17, fontWeight: '700', color: 'white', letterSpacing: 0.2 },
  ctaArrow:  { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },

  footer:     { alignItems: 'center', paddingTop: 24 },
  footerText: { fontSize: 14, fontWeight: '400' },
  footerLink: { color: COLORS.orange, fontWeight: '700' },
});