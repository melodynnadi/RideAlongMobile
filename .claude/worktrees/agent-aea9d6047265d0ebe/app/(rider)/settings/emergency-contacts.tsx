
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Plus, User, Edit2, Trash2 } from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/hooks/useTheme';
import { router } from 'expo-router';
import { useEmergencyContactsStore } from '@/stores/emergencyContactsStore';
import { EmergencyContact } from '@/types';

export default function EmergencyContactsScreen() {
  const theme = useTheme();
  const { 
    contacts, 
    isLoading, 
    loadContacts, 
    addContact, 
    updateContact, 
    deleteContact 
  } = useEmergencyContactsStore();
  
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [newContact, setNewContact] = useState<Omit<EmergencyContact, 'id'>>({ 
    name: '', 
    phone: '', 
    relationship: '' 
  });

  useEffect(() => {
    loadContacts().catch(error => {
      console.error('Failed to load emergency contacts:', error);
      Alert.alert('Error', 'Failed to load your emergency contacts. Please try again.');
    });
  }, [loadContacts]);

  const handleSaveContact = async () => {
    if (!newContact.name.trim() || !newContact.phone.trim()) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    try {
      if (editingIndex !== null) {
        await updateContact(editingIndex, newContact);
        setEditingIndex(null);
      } else {
        await addContact(newContact);
      }
      
      setNewContact({ name: '', phone: '', relationship: '' });
      setIsAddingContact(false);
      Alert.alert('Success', 'Emergency contact saved successfully!');
    } catch (error) {
      console.error('Failed to save emergency contact:', error);
      Alert.alert('Error', 'Failed to save emergency contact. Please try again.');
    }
  };

  const handleEditContact = (index: number) => {
    const contact = contacts[index];
    setNewContact({
      name: contact.name,
      phone: contact.phone,
      relationship: contact.relationship,
    });
    setEditingIndex(index);
    setIsAddingContact(true);
  };

  const handleDeleteContact = (index: number, contactName: string) => {
    Alert.alert(
      'Remove Emergency Contact',
      `Are you sure you want to remove ${contactName} from your emergency contacts?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Remove', 
          style: 'destructive', 
          onPress: async () => {
            try {
              await deleteContact(index);
              Alert.alert('Success', 'Emergency contact removed successfully!');
            } catch (error) {
              console.error('Failed to delete emergency contact:', error);
              Alert.alert('Error', 'Failed to remove emergency contact. Please try again.');
            }
          }
        }
      ]
    );
  };

  const handleCancelEdit = () => {
    setIsAddingContact(false);
    setEditingIndex(null);
    setNewContact({ name: '', phone: '', relationship: '' });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#F8FAFC' }]}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => router.canGoBack() ? router.back() : router.push('/settings')}
        >
          <ArrowLeft size={24} color={theme.colors.secondary} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: theme.colors.secondary }]}>
            Emergency Contacts
          </Text>
          <Text style={styles.headerSubtitle}>
            People to contact in case of emergency
          </Text>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Loading indicator */}
        {isLoading && !isAddingContact && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={styles.loadingText}>Loading emergency contacts...</Text>
          </View>
        )}

        {/* Add New Contact Form */}
        {isAddingContact ? (
          <Card style={styles.addContactCard}>
            <Text style={[styles.addContactTitle, { color: theme.colors.secondary }]}>
              {editingIndex !== null ? 'Edit Emergency Contact' : 'Add Emergency Contact'}
            </Text>
            
            <View style={styles.formGroup}>
              <Text style={styles.label}>Name *</Text>
              <TextInput
                style={styles.input}
                value={newContact.name}
                onChangeText={(text) => setNewContact({ ...newContact, name: text })}
                placeholder="Enter full name"
                placeholderTextColor="#64748B"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Phone Number *</Text>
              <TextInput
                style={styles.input}
                value={newContact.phone}
                onChangeText={(text) => setNewContact({ ...newContact, phone: text })}
                placeholder="+1 (555) 123-4567"
                keyboardType="phone-pad"
                placeholderTextColor="#64748B"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Relationship</Text>
              <TextInput
                style={styles.input}
                value={newContact.relationship}
                onChangeText={(text) => setNewContact({ ...newContact, relationship: text })}
                placeholder="e.g., Mother, Friend, Roommate"
                placeholderTextColor="#64748B"
              />
            </View>

            <View style={styles.formActions}>
              <Button 
                variant="outline" 
                style={styles.cancelButton}
                onPress={handleCancelEdit}
              >
                <Text style={[styles.cancelButtonText, { color: theme.colors.secondary }]}>
                  Cancel
                </Text>
              </Button>
              <Button 
                variant="primary" 
                style={styles.saveButton}
                onPress={handleSaveContact}
              >
                <Text style={styles.saveButtonText}>Save Contact</Text>
              </Button>
            </View>
          </Card>
        ) : (
          <Button 
            variant="primary" 
            style={styles.addButton}
            onPress={() => setIsAddingContact(true)}
          >
            <View style={styles.buttonContent}>
              <Plus size={20} color="white" />
              <Text style={[styles.addButtonText, { color: 'white' }]}>
                Add Emergency Contact
              </Text>
            </View>
          </Button>
        )}

        {/* Emergency Contacts List */}
        {!isLoading && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.colors.secondary }]}>
              Your Emergency Contacts
            </Text>
            
            {contacts.length === 0 ? (
              <Card style={styles.emptyStateCard}>
                <Text style={[styles.emptyStateTitle, { color: theme.colors.secondary }]}>
                  No Emergency Contacts
                </Text>
                <Text style={styles.emptyStateText}>
                  Add emergency contacts to keep your loved ones informed about your rides.
                </Text>
              </Card>
            ) : (
              contacts.map((contact, index) => (
            <Card key={index} style={styles.contactCard}>
              <View style={styles.contactContent}>
                <View style={styles.contactLeft}>
                  <View style={[styles.contactIcon, { backgroundColor: theme.colors.primary + '20' }]}>
                    <User size={24} color={theme.colors.primary} />
                  </View>
                  <View style={styles.contactInfo}>
                    <Text style={[styles.contactName, { color: theme.colors.secondary }]}>
                      {contact.name}
                    </Text>
                    <Text style={styles.contactPhone}>{contact.phone}</Text>
                    <Text style={styles.contactRelationship}>{contact.relationship}</Text>
                  </View>
                </View>
                
                <View style={styles.contactActions}>
                  <TouchableOpacity 
                    style={styles.actionButton}
                    onPress={() => handleEditContact(index)}
                  >
                    <Edit2 size={18} color="#64748B" />
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={styles.actionButton}
                    onPress={() => handleDeleteContact(index, contact.name)}
                  >
                    <Trash2 size={18} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              </View>
            </Card>
          ))
            )}
          </View>
        )}

        {/* Info Card */}
        <Card style={styles.infoCard}>
          <Text style={[styles.infoTitle, { color: theme.colors.secondary }]}>
            How Emergency Contacts Work
          </Text>
          <Text style={styles.infoText}>
            Your emergency contacts will be notified if:
          </Text>
          <View style={styles.infoFeatures}>
            <Text style={styles.infoFeature}>• You don&apos;t arrive at your destination on time</Text>
            <Text style={styles.infoFeature}>• You activate the emergency button in the app</Text>
            <Text style={styles.infoFeature}>• Your ride is significantly delayed or cancelled</Text>
            <Text style={styles.infoFeature}>• You share your live location during a ride</Text>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 16,
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
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#64748B',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  addButton: {
    marginBottom: 32,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  addContactCard: {
    backgroundColor: 'white',
    padding: 20,
    marginBottom: 32,
  },
  addContactTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
  },
  formActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
  },
  saveButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  contactCard: {
    backgroundColor: 'white',
    padding: 16,
    marginBottom: 12,
  },
  contactContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  contactLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  contactIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  contactPhone: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 2,
  },
  contactRelationship: {
    fontSize: 14,
    color: '#6366F1',
    fontWeight: '500',
  },
  contactActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    padding: 8,
  },
  infoCard: {
    backgroundColor: 'white',
    padding: 16,
    marginBottom: 32,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  infoText: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 12,
  },
  infoFeatures: {
    gap: 6,
  },
  infoFeature: {
    fontSize: 14,
    color: '#64748B',
    lineHeight: 18,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#64748B',
  },
  emptyStateCard: {
    backgroundColor: 'white',
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
  },
});
