
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Plus, User, Phone, Edit2, Trash2 } from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/hooks/useTheme';
import { router } from 'expo-router';
import { firebaseAuth } from '@/constants/services';
import { 
  getEmergencyContacts, 
  addEmergencyContact, 
  updateEmergencyContact, 
  removeEmergencyContact,
  validatePhoneNumber,
  formatPhoneNumber,
  debugFirebaseConnection,
  EmergencyContact 
} from '@/src/services/emergencyContactsService';

export default function EmergencyContactsScreen() {
  const theme = useTheme();
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [editingContact, setEditingContact] = useState<EmergencyContact | null>(null);
  const [newContact, setNewContact] = useState({ name: '', phone: '', relationship: '' });
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load emergency contacts on component mount
  useEffect(() => {
    loadEmergencyContacts();
    
    // Debug: Check authentication state
    const user = firebaseAuth.currentUser;
    console.log('Current user:', user ? { uid: user.uid, email: user.email } : 'Not authenticated');
  }, []);

  const loadEmergencyContacts = async () => {
    try {
      setLoading(true);
      
      // Debug Firebase connection
      const debugInfo = await debugFirebaseConnection();
      console.log('Firebase Debug Info:', debugInfo);
      
      if (!debugInfo.user) {
        Alert.alert('Authentication Error', 'Please sign in to view emergency contacts.');
        return;
      }
      
      if (!debugInfo.canAccessFirestore) {
        Alert.alert('Connection Error', `Cannot access database: ${debugInfo.error}`);
        return;
      }
      
      const contacts = await getEmergencyContacts();
      setEmergencyContacts(contacts);
    } catch (error) {
      console.error('Error loading emergency contacts:', error);
      Alert.alert(
        'Error Loading Contacts',
        'Could not load your emergency contacts. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSaveContact = async () => {
    if (!newContact.name || !newContact.phone) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    if (!validatePhoneNumber(newContact.phone)) {
      Alert.alert('Invalid Phone Number', 'Please enter a valid phone number');
      return;
    }

    try {
      setSaving(true);
      
      if (editingContact) {
        // Update existing contact
        await updateEmergencyContact(editingContact.id, {
          name: newContact.name.trim(),
          phone: newContact.phone.trim(),
          relationship: newContact.relationship.trim(),
        });
      } else {
        // Add new contact
        await addEmergencyContact({
          name: newContact.name.trim(),
          phone: newContact.phone.trim(),
          relationship: newContact.relationship.trim(),
        });
      }

      // Reload contacts and reset form
      await loadEmergencyContacts();
      setNewContact({ name: '', phone: '', relationship: '' });
      setIsAddingContact(false);
      setEditingContact(null);

      Alert.alert(
        'Success', 
        editingContact ? 'Emergency contact updated!' : 'Emergency contact added!'
      );
    } catch (error) {
      console.error('Error saving contact:', error);
      
      // Extract error message for better user feedback
      let errorMessage = 'Could not save the contact. Please try again.';
      
      if (error instanceof Error) {
        if (error.message.includes('User must be authenticated')) {
          errorMessage = 'Please sign in to add emergency contacts.';
        } else if (error.message.includes('Driver profile not found')) {
          errorMessage = 'Driver profile not found. Please complete your profile first.';
        } else if (error.message.includes('Permission denied')) {
          errorMessage = 'Permission denied. Please check your account permissions.';
        } else if (error.message.includes('network')) {
          errorMessage = 'Network error. Please check your internet connection.';
        } else {
          errorMessage = error.message;
        }
      }
      
      Alert.alert('Save Failed', errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleEditContact = (contact: EmergencyContact) => {
    setEditingContact(contact);
    setNewContact({
      name: contact.name,
      phone: contact.phone,
      relationship: contact.relationship,
    });
    setIsAddingContact(true);
  };

  const handleDeleteContact = async (contactId: string, contactName: string) => {
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
              await removeEmergencyContact(contactId);
              await loadEmergencyContacts();
              Alert.alert('Success', 'Emergency contact removed');
            } catch (error) {
              console.error('Error deleting contact:', error);
              Alert.alert(
                'Delete Failed',
                error instanceof Error ? error.message : 'Could not remove the contact. Please try again.'
              );
            }
          }
        }
      ]
    );
  };

  const handleCancelEdit = () => {
    setIsAddingContact(false);
    setEditingContact(null);
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
        {/* Loading Indicator */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={[styles.loadingText, { color: theme.colors.secondary }]}>
              Loading your emergency contacts...
            </Text>
          </View>
        ) : (
          <>
            {/* Add New Contact Form */}
            {isAddingContact ? (
              <Card style={styles.addContactCard}>
                <Text style={[styles.addContactTitle, { color: theme.colors.secondary }]}>
                  {editingContact ? 'Edit Emergency Contact' : 'Add Emergency Contact'}
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
                disabled={saving}
              >
                <Text style={styles.saveButtonText}>
                  {saving ? 'Saving...' : (editingContact ? 'Update Contact' : 'Save Contact')}
                </Text>
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
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.secondary }]}>
            Your Emergency Contacts
          </Text>
          
          {emergencyContacts.length === 0 ? (
            <Card style={styles.emptyCard}>
              <Text style={[styles.emptyText, { color: theme.colors.secondary }]}>
                No emergency contacts added yet.
              </Text>
              <Text style={styles.emptySubtext}>
                Add your first emergency contact to get started.
              </Text>
            </Card>
          ) : (
            emergencyContacts.map((contact) => (
              <Card key={contact.id} style={styles.contactCard}>
                <View style={styles.contactContent}>
                  <View style={styles.contactLeft}>
                    <View style={[styles.contactIcon, { backgroundColor: theme.colors.primary + '20' }]}>
                      <User size={24} color={theme.colors.primary} />
                    </View>
                    <View style={styles.contactInfo}>
                      <Text style={[styles.contactName, { color: theme.colors.secondary }]}>
                        {contact.name}
                      </Text>
                      <Text style={styles.contactPhone}>
                        {formatPhoneNumber(contact.phone)}
                      </Text>
                      {contact.relationship && (
                        <Text style={styles.contactRelationship}>{contact.relationship}</Text>
                      )}
                    </View>
                  </View>
                  
                  <View style={styles.contactActions}>
                    <TouchableOpacity 
                      style={styles.actionButton}
                      onPress={() => handleEditContact(contact)}
                    >
                      <Edit2 size={18} color="#64748B" />
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={styles.actionButton}
                      onPress={() => handleDeleteContact(contact.id, contact.name)}
                    >
                      <Trash2 size={18} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              </Card>
            ))
          )}
        </View>
          </>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '500',
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
  emptyCard: {
    backgroundColor: 'white',
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
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
});
