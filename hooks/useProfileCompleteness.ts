import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import type { Ionicons } from '@expo/vector-icons';
import { firebaseAuth, firestore } from '@/constants/services';
import { usePaymentStore } from '@/stores/paymentStore';

export type ProfileCompletionItem = {
  id: string;
  title: string;
  description: string;
  cta: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  route: string;
};

type Role = 'rider' | 'driver';

function isVerified(data: any): boolean {
  if (!data) return false;
  return data.isVerified === true
    || ['approved', 'auto-approved'].includes(String(data.verificationStatus || '').toLowerCase());
}

function hasSetDriverPreferences(data: any): boolean {
  if (!data) return false;
  return !!data.genderPreference
    || !!data.smokingPreference
    || !!data.talkativeness
    || !!data.personality
    || !!data.maxPassengers
    || (Array.isArray(data.musicPreferences) && data.musicPreferences.length > 0);
}

/**
 * Derives which parts of a rider/driver profile are still incomplete, so the
 * home screen can nudge the user to finish them instead of showing backend
 * promotions. Replaces the old usePromotions() carousel data source.
 */
export function useProfileCompleteness(role: Role) {
  const uid = firebaseAuth.currentUser?.uid;
  const [profileDoc, setProfileDoc] = useState<any | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  // Student verification can be satisfied from either role's doc (e.g. a
  // dual-role user verified while signed in as a rider) — mirrors the
  // fallback already used on the driver home screen's verification listener.
  const [otherRoleDoc, setOtherRoleDoc] = useState<any | null>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactsLoaded, setContactsLoaded] = useState(false);

  const paymentMethods = usePaymentStore((s) => s.paymentMethods);
  const [paymentsLoaded, setPaymentsLoaded] = useState(role !== 'rider');

  useEffect(() => {
    if (!uid) {
      setProfileDoc(null);
      setProfileLoaded(true);
      return undefined;
    }
    const ref = doc(firestore, role === 'driver' ? 'drivers' : 'riders', uid);
    return onSnapshot(ref, (snap) => {
      setProfileDoc(snap.exists() ? snap.data() : null);
      setProfileLoaded(true);
    }, (error) => {
      setProfileLoaded(true);
      console.warn('[useProfileCompleteness] profile listener error:', error);
    });
  }, [uid, role]);

  useEffect(() => {
    if (!uid) {
      setOtherRoleDoc(null);
      return undefined;
    }
    const ref = doc(firestore, role === 'driver' ? 'riders' : 'drivers', uid);
    return onSnapshot(ref, (snap) => {
      setOtherRoleDoc(snap.exists() ? snap.data() : null);
    }, (error) => {
      console.warn('[useProfileCompleteness] other-role verification listener error:', error);
    });
  }, [uid, role]);

  useEffect(() => {
    if (!uid) {
      setContacts([]);
      setContactsLoaded(true);
      return undefined;
    }
    const ref = doc(firestore, 'users', uid);
    return onSnapshot(ref, (snap) => {
      const data = snap.data();
      setContacts(Array.isArray(data?.emergencyContacts) ? data!.emergencyContacts : []);
      setContactsLoaded(true);
    }, (error) => {
      setContactsLoaded(true);
      console.warn('[useProfileCompleteness] emergency contacts listener error:', error);
    });
  }, [uid]);

  useEffect(() => {
    if (role !== 'rider' || !uid) return;
    setPaymentsLoaded(false);
    usePaymentStore.getState().loadPaymentMethods(uid).finally(() => setPaymentsLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, uid]);

  const loading = !profileLoaded || !contactsLoaded || !paymentsLoaded;

  const items = useMemo<ProfileCompletionItem[]>(() => {
    if (!uid || !profileDoc) return [];
    const list: ProfileCompletionItem[] = [];
    const hasPhone = !!(profileDoc.phoneNumber || profileDoc.phone);

    const accountComplete = role === 'driver'
      ? hasPhone && !!(profileDoc.dateOfBirth || profileDoc.dob)
      : !!profileDoc.firstName && !!profileDoc.lastName && hasPhone;
    if (!accountComplete) {
      list.push({
        id: 'account',
        title: 'Finish your account details',
        description: role === 'driver'
          ? 'Add your phone number and date of birth so we can verify it’s really you.'
          : 'Add your name and phone number so drivers know who they’re picking up.',
        cta: 'Add details',
        icon: 'person-outline',
        route: role === 'driver' ? '/(driver)/settings/account-settings' : '/(rider)/settings/account-settings',
      });
    }

    const preferencesSet = role === 'driver' ? hasSetDriverPreferences(profileDoc) : !!profileDoc.preferencesUpdatedAt;
    if (!preferencesSet) {
      list.push({
        id: 'preferences',
        title: 'Set your ride preferences',
        description: 'Tell us about music, conversation, and who you’d like to ride with.',
        cta: 'Set preferences',
        icon: 'options-outline',
        route: role === 'driver' ? '/(driver)/settings/driver-ride-preferences' : '/(rider)/settings/ride-preferences',
      });
    }

    if (!contacts.length) {
      list.push({
        id: 'emergency-contacts',
        title: 'Add an emergency contact',
        description: 'Give us someone to reach if a ride ever needs extra help.',
        cta: 'Add contact',
        icon: 'medkit-outline',
        route: role === 'driver' ? '/(driver)/settings/emergency-contacts' : '/(rider)/settings/emergency-contacts',
      });
    }

    if (!isVerified(profileDoc) && !isVerified(otherRoleDoc)) {
      list.push({
        id: 'student-verification',
        title: 'Verify your student status',
        description: 'Upload your student ID to unlock rides and keep the community verified.',
        cta: 'Verify now',
        icon: 'school-outline',
        route: role === 'driver' ? '/(driver)/settings/driver-student-verification' : '/(rider)/settings/student-verification',
      });
    }

    if (role === 'rider') {
      if (!paymentMethods.length) {
        list.push({
          id: 'payment-methods',
          title: 'Add a payment method',
          description: 'Save a card so you can book a ride the moment you find one.',
          cta: 'Add payment',
          icon: 'card-outline',
          route: '/(rider)/settings/payment-methods',
        });
      }
    } else {
      // Vehicle info is saved as a nested object (settings screen writes 'vehicleInfo';
      // the verification pipeline sometimes writes 'vehicle' instead) — check both shapes.
      const vehicleData = profileDoc.vehicleInfo || profileDoc.vehicle || {};
      const vehicleComplete = !!(vehicleData.make || profileDoc.make)
        && !!(vehicleData.model || profileDoc.model)
        && !!(vehicleData.licensePlate || vehicleData.license || profileDoc.licensePlate);
      if (!vehicleComplete) {
        list.push({
          id: 'vehicle-info',
          title: 'Add your vehicle info',
          description: 'Riders want to know what to look for — add your car’s make, model, and plate.',
          cta: 'Add vehicle',
          icon: 'car-outline',
          route: '/(driver)/settings/vehicle-info',
        });
      }

      if (!profileDoc.stripeAccountId) {
        list.push({
          id: 'payouts',
          title: 'Set up payouts',
          description: 'Connect a payout method so you get paid right after every ride.',
          cta: 'Set up payouts',
          icon: 'cash-outline',
          route: '/(driver)/settings/payout-history',
        });
      }
    }

    return list;
  }, [uid, profileDoc, otherRoleDoc, contacts, role, paymentMethods]);

  return { items, loading };
}
