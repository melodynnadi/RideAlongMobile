import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Alert, ActivityIndicator, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import {
  getEmergencyContacts,
  addEmergencyContact,
  updateEmergencyContact,
  removeEmergencyContact,
  validatePhoneNumber,
  formatPhoneNumber,
  EmergencyContact,
} from '@/src/services/emergencyContactsService';

import { useReturnNavigation } from '@/src/hooks/useReturnNavigation';
import { useAppTheme } from '@/hooks/ThemeContext';

export default function EmergencyContactsScreen() {
  const { colors } = useAppTheme();
  const { goBack } = useReturnNavigation('/(driver)/settings');
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [editingContact, setEditingContact]   = useState<EmergencyContact | null>(null);
  const [newContact, setNewContact]           = useState({ name: '', phone: '', relationship: '' });
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [saving, setSaving]                   = useState(false);

  const s = useMemo(() => StyleSheet.create({
    root:        { flex: 1, backgroundColor: colors.bg },
    safe:        { flex: 1 },
    loadingWrap: { paddingTop: 60, alignItems: 'center' },

    hdr:      { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingBottom: 10 },
    backBtn:  { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
    hdrTitle: { color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '700', flex: 1, marginLeft: 12 },

    content: { paddingHorizontal: 20, paddingBottom: 60 },

    addBtn:     { height: 50, borderRadius: 25, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 24 },
    addBtnText: { color: colors.textInverse, fontSize: 15, fontWeight: '700' },

    formCard: { borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 20, marginBottom: 24, shadowColor: colors.textPrimary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 1 },
    formTitle:  { color: colors.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 20 },
    formGroup:  { marginBottom: 14 },
    formLabel:  { color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 6 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.textPrimary, fontSize: 14, fontWeight: '500', backgroundColor: colors.bgSecondary },
    formActions:    { flexDirection: 'row', gap: 12, marginTop: 18 },
    cancelBtn:      { flex: 1, height: 46, borderRadius: 23, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    cancelBtnText:  { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
    saveBtn:        { flex: 1, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    saveBtnText:    { color: colors.textInverse, fontSize: 14, fontWeight: '700' },

    sectionLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 10, marginTop: 4 },

    emptyCard:  { borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, backgroundColor: colors.bgCard, padding: 28, alignItems: 'center', marginBottom: 24 },
    emptyIcon:  { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
    emptyTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 8 },
    emptyText:  { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 18 },

    contactsCard: { borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, marginBottom: 24, overflow: 'hidden', shadowColor: colors.textPrimary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
    contactRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
    contactBorder:{ borderBottomWidth: 1, borderBottomColor: colors.border },
    contactIcon:  { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    contactInfo:  { flex: 1 },
    contactName:  { color: colors.textPrimary, fontSize: 15, fontWeight: '600', marginBottom: 2 },
    contactPhone: { color: colors.textSecondary, fontSize: 13 },
    contactRel:   { color: colors.primary, fontSize: 12, marginTop: 2, fontWeight: '500' },
    contactActions:   { flexDirection: 'row', gap: 6 },
    actionBtn:        { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center' },
    actionBtnDanger:  { borderColor: colors.redBorder, backgroundColor: colors.redDim },

    infoCard: { borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 16, marginBottom: 24 },
    infoTitle:  { color: colors.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: 10 },
    infoText:   { color: colors.textSecondary, fontSize: 13, marginBottom: 8 },
    infoBullet: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  }), [colors]);

  useEffect(() => { loadContacts(); }, []);

  const loadContacts = async () => {
    try {
      setLoading(true);
      setEmergencyContacts(await getEmergencyContacts());
    } catch { Alert.alert('Error Loading Contacts', 'Could not load your emergency contacts. Please try again.'); }
    finally { setLoading(false); }
  };

  const handleSaveContact = async () => {
    if (!newContact.name || !newContact.phone) { Alert.alert('Error', 'Please fill in all required fields'); return; }
    if (!validatePhoneNumber(newContact.phone)) { Alert.alert('Invalid Phone Number', 'Please enter a valid phone number'); return; }
    try {
      setSaving(true);
      if (editingContact) {
        await updateEmergencyContact(editingContact.id, { name: newContact.name.trim(), phone: newContact.phone.trim(), relationship: newContact.relationship.trim() });
      } else {
        await addEmergencyContact({ name: newContact.name.trim(), phone: newContact.phone.trim(), relationship: newContact.relationship.trim() });
      }
      await loadContacts();
      setNewContact({ name: '', phone: '', relationship: '' });
      setIsAddingContact(false);
      setEditingContact(null);
      Alert.alert('Success', editingContact ? 'Emergency contact updated!' : 'Emergency contact added!');
    } catch (e) {
      let msg = 'Could not save the contact. Please try again.';
      if (e instanceof Error) {
        if (e.message.includes('User must be authenticated')) msg = 'Please sign in to add emergency contacts.';
        else if (e.message.includes('Driver profile not found')) msg = 'Driver profile not found. Please complete your profile first.';
        else if (e.message.includes('Permission denied')) msg = 'Permission denied. Please check your account permissions.';
        else if (e.message.includes('network')) msg = 'Network error. Please check your internet connection.';
        else msg = e.message;
      }
      Alert.alert('Save Failed', msg);
    } finally { setSaving(false); }
  };

  const handleEditContact = (contact: EmergencyContact) => {
    setEditingContact(contact);
    setNewContact({ name: contact.name, phone: contact.phone, relationship: contact.relationship });
    setIsAddingContact(true);
  };

  const handleDeleteContact = (contactId: string, contactName: string) => {
    Alert.alert('Remove Emergency Contact', `Are you sure you want to remove ${contactName}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try {
          await removeEmergencyContact(contactId);
          await loadContacts();
          Alert.alert('Success', 'Emergency contact removed');
        } catch (e) { Alert.alert('Delete Failed', e instanceof Error ? e.message : 'Could not remove the contact.'); }
      } },
    ]);
  };

  const handleCancel = () => { setIsAddingContact(false); setEditingContact(null); setNewContact({ name: '', phone: '', relationship: '' }); };

  return (
    <View style={s.root}>
      <StatusBar barStyle={colors.statusBar} />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
<View style={s.hdr}>
          <TouchableOpacity style={s.backBtn} onPress={goBack}>
            <Ionicons name="arrow-back" size={19} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.hdrTitle}>Emergency Contacts</Text>
        </View>
          {loading ? (
            <View style={s.loadingWrap}><ActivityIndicator size="large" color={colors.primary} /></View>
          ) : (
            <>
              {isAddingContact ? (
                <View style={s.formCard}>
                  <Text style={s.formTitle}>{editingContact ? 'Edit Contact' : 'Add Emergency Contact'}</Text>
                  <View style={s.formGroup}>
                    <Text style={s.formLabel}>FULL NAME *</Text>
                    <TextInput style={s.input} value={newContact.name} onChangeText={(t) => setNewContact((p) => ({ ...p, name: t }))} placeholder="Enter full name" placeholderTextColor={colors.textSecondary} />
                  </View>
                  <View style={s.formGroup}>
                    <Text style={s.formLabel}>PHONE NUMBER *</Text>
                    <TextInput style={s.input} value={newContact.phone} onChangeText={(t) => setNewContact((p) => ({ ...p, phone: t }))} placeholder="+1 (555) 123-4567" keyboardType="phone-pad" placeholderTextColor={colors.textSecondary} />
                  </View>
                  <View style={[s.formGroup, { marginBottom: 0 }]}>
                    <Text style={s.formLabel}>RELATIONSHIP</Text>
                    <TextInput style={s.input} value={newContact.relationship} onChangeText={(t) => setNewContact((p) => ({ ...p, relationship: t }))} placeholder="e.g., Mother, Friend, Roommate" placeholderTextColor={colors.textSecondary} />
                  </View>
                  <View style={s.formActions}>
                    <TouchableOpacity style={s.cancelBtn} onPress={handleCancel}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>
                    <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSaveContact} disabled={saving}>
                      {saving ? <ActivityIndicator color={colors.textInverse} /> : <Text style={s.saveBtnText}>{editingContact ? 'Update' : 'Save'}</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity style={s.addBtn} onPress={() => setIsAddingContact(true)}>
                  <Ionicons name="add" size={20} color={colors.textInverse} />
                  <Text style={s.addBtnText}>Add Emergency Contact</Text>
                </TouchableOpacity>
              )}

              <Text style={s.sectionLabel}>YOUR CONTACTS</Text>
              {emergencyContacts.length === 0 ? (
                <View style={s.emptyCard}>
                  <View style={s.emptyIcon}><Ionicons name="people-outline" size={26} color={colors.primary} /></View>
                  <Text style={s.emptyTitle}>No contacts yet</Text>
                  <Text style={s.emptyText}>Add emergency contacts so they can be notified if something goes wrong on a ride.</Text>
                </View>
              ) : (
                <View style={s.contactsCard}>
                  {emergencyContacts.map((contact, idx) => (
                    <View key={contact.id} style={[s.contactRow, idx < emergencyContacts.length - 1 && s.contactBorder]}>
                      <View style={s.contactIcon}>
                        <Ionicons name="person-outline" size={18} color={colors.primary} />
                      </View>
                      <View style={s.contactInfo}>
                        <Text style={s.contactName}>{contact.name}</Text>
                        <Text style={s.contactPhone}>{formatPhoneNumber(contact.phone)}</Text>
                        {contact.relationship ? <Text style={s.contactRel}>{contact.relationship}</Text> : null}
                      </View>
                      <View style={s.contactActions}>
                        <TouchableOpacity style={s.actionBtn} onPress={() => handleEditContact(contact)}>
                          <Ionicons name="pencil-outline" size={15} color={colors.textSecondary} />
                        </TouchableOpacity>
                        <TouchableOpacity style={[s.actionBtn, s.actionBtnDanger]} onPress={() => handleDeleteContact(contact.id, contact.name)}>
                          <Ionicons name="trash-outline" size={15} color={colors.red} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              <View style={s.infoCard}>
                <Text style={s.infoTitle}>How Emergency Contacts Work</Text>
                <Text style={s.infoText}>Your contacts will be notified if:</Text>
                {["You don't arrive at your destination on time", "You activate the emergency button", "Your ride is significantly delayed or cancelled", "You share your live location during a ride"].map((item) => (
                  <Text key={item} style={s.infoBullet}>• {item}</Text>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
