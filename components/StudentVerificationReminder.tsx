import React, { useCallback, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { firebaseAuth, firestore } from '@/constants/services';
import { openStudentVerification } from '@/src/utils/studentVerificationNav';
import { shouldShowVerificationReminder } from '@/src/utils/verificationReminderPolicy';

// A quiet, dismissible alternative after the email sequence has ended.
export function StudentVerificationReminder({ role }: { role: 'rider' | 'driver' }) {
  const [visible, setVisible] = useState(false);
  const dismissedUid = useRef<string | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    setVisible(false);
    const user = firebaseAuth.currentUser;
    if (!user || dismissedUid.current === user.uid) return;
    const uid = user.uid;
    void Promise.all([
      getDoc(doc(firestore, 'riders', uid)),
      getDoc(doc(firestore, 'drivers', uid)),
      getDocs(query(collection(firestore, 'studentVerifications'), where('userId', '==', uid), limit(1))),
    ]).then(([rider, driver, submissions]) => {
      if (!active || firebaseAuth.currentUser?.uid !== uid) return;
      const profiles = [rider, driver].filter(s => s.exists()).map(s => s.data()!);
      setVisible(shouldShowVerificationReminder(user.metadata.creationTime, profiles, !submissions.empty));
    }).catch(() => {}); // Never show an unverified prompt when status cannot be checked.
    return () => { active = false; };
  }, []));
  if (!visible) return null;
  return (
    <View style={styles.card}>
      <TouchableOpacity accessibilityRole="button" onPress={() => openStudentVerification(role)} style={styles.content}>
        <Text style={styles.title}>Verify your student status</Text>
        <Text style={styles.message}>Ready when you are. Submit your verification in the app.</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Dismiss student verification reminder"
        hitSlop={12} onPress={() => { dismissedUid.current = firebaseAuth.currentUser?.uid || null; setVisible(false); }}>
        <Text style={styles.dismiss}>×</Text>
      </TouchableOpacity>
    </View>
  );
}
const styles = StyleSheet.create({
  card: { marginHorizontal: 20, marginBottom: 16, padding: 16, borderRadius: 14, backgroundColor: '#FFF4E9', flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  content: { flex: 1 },
  title: { color: '#15233A', fontSize: 15, fontWeight: '700' },
  message: { color: '#5B5660', fontSize: 13, lineHeight: 19, marginTop: 4 },
  dismiss: { color: '#795237', fontSize: 24, lineHeight: 24 },
});
