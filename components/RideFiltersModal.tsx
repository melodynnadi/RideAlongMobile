import React, { useState, useRef, useCallback } from 'react';
import { View, Text, Modal, TouchableOpacity, TextInput, StyleSheet, ScrollView, Platform, Keyboard } from 'react-native';
import { X, Calendar, Clock, MapPin, DollarSign, Users } from 'lucide-react-native';
import { TimeBucket, type RideFilterOptions, getDefaultFilters } from '@/utils/rideFilters';
import { GOOGLE_MAPS_API_KEY } from '@/constants/services';

type Suggestion = { description: string; place_id: string; mainText: string; secondaryText: string };

interface RideFiltersModalProps {
  visible: boolean;
  onClose: () => void;
  onApply: (filters: RideFilterOptions) => void;
  initialFilters: RideFilterOptions;
  showSeatsFilter?: boolean; // Only show for riders
}

export function RideFiltersModal({
  visible,
  onClose,
  onApply,
  initialFilters,
  showSeatsFilter = false
}: RideFiltersModalProps) {
  const [filters, setFilters] = useState<RideFilterOptions>(initialFilters);

  // Autocomplete state for pickup and dropoff
  const [pickupSuggestions, setPickupSuggestions] = useState<Suggestion[]>([]);
  const [dropoffSuggestions, setDropoffSuggestions] = useState<Suggestion[]>([]);
  const [showPickupSuggestions, setShowPickupSuggestions] = useState(false);
  const [showDropoffSuggestions, setShowDropoffSuggestions] = useState(false);
  const pickupTimer = useRef<any>(null);
  const dropoffTimer = useRef<any>(null);

  const fetchSuggestions = useCallback(async (
    query: string,
    setSuggestions: (s: Suggestion[]) => void,
    setShow: (b: boolean) => void,
  ) => {
    if (!query || query.trim().length < 2) {
      setSuggestions([]);
      setShow(false);
      return;
    }
    try {
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${GOOGLE_MAPS_API_KEY}&components=country:us`;
      const res = await fetch(url);
      const json = await res.json();
      const items: Suggestion[] = (json?.predictions || []).map((p: any) => ({
        description: p.description,
        place_id: p.place_id,
        mainText: p.structured_formatting?.main_text || p.description,
        secondaryText: p.structured_formatting?.secondary_text || '',
      }));
      setSuggestions(items);
      setShow(items.length > 0);
    } catch {
      setSuggestions([]);
      setShow(false);
    }
  }, []);

  const updateFilter = <K extends keyof RideFilterOptions>(
    key: K,
    value: RideFilterOptions[K]
  ) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleClearAll = () => {
    const defaults = getDefaultFilters();
    setFilters(defaults);
  };

  const handleApply = () => {
    onApply(filters);
    onClose();
  };

  const activeFilterCount = () => {
    let count = 0;
    if (filters.date) count++;
    if (filters.timeBucket) count++;
    if (filters.pickupLocation) count++;
    if (filters.dropoffLocation) count++;
    if (filters.minPrice !== null || filters.maxPrice !== null) count++;
    if (showSeatsFilter && filters.seats) count++;
    return count;
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Filter Rides</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X size={24} color="#2D3748" />
            </TouchableOpacity>
          </View>

          {/* Scrollable Content */}
          <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* Date Filter */}
            <View style={styles.filterGroup}>
              <Text style={styles.filterLabel}>Date</Text>
              <View style={styles.inputContainer}>
                <Calendar size={20} color="#718096" style={styles.inputIcon} />
                <TextInput
                  style={styles.textInput}
                  placeholder="YYYY-MM-DD"
                  value={filters.date || ''}
                  onChangeText={(text) => updateFilter('date', text || null)}
                  placeholderTextColor="#A0AEC0"
                />
              </View>
              <Text style={styles.helperText}>Leave empty for any date</Text>
            </View>

            {/* Time of Day Filter */}
            <View style={styles.filterGroup}>
              <Text style={styles.filterLabel}>Time of Day</Text>
              <View style={styles.timeBucketContainer}>
                <TouchableOpacity
                  style={[
                    styles.timeBucketButton,
                    filters.timeBucket === TimeBucket.MORNING && styles.timeBucketButtonActive
                  ]}
                  onPress={() =>
                    updateFilter(
                      'timeBucket',
                      filters.timeBucket === TimeBucket.MORNING ? null : TimeBucket.MORNING
                    )
                  }
                >
                  <Text
                    style={[
                      styles.timeBucketText,
                      filters.timeBucket === TimeBucket.MORNING && styles.timeBucketTextActive
                    ]}
                  >
                    Morning
                  </Text>
                  <Text
                    style={[
                      styles.timeBucketSubtext,
                      filters.timeBucket === TimeBucket.MORNING && styles.timeBucketSubtextActive
                    ]}
                  >
                    5 AM - 12 PM
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.timeBucketButton,
                    filters.timeBucket === TimeBucket.AFTERNOON && styles.timeBucketButtonActive
                  ]}
                  onPress={() =>
                    updateFilter(
                      'timeBucket',
                      filters.timeBucket === TimeBucket.AFTERNOON ? null : TimeBucket.AFTERNOON
                    )
                  }
                >
                  <Text
                    style={[
                      styles.timeBucketText,
                      filters.timeBucket === TimeBucket.AFTERNOON && styles.timeBucketTextActive
                    ]}
                  >
                    Afternoon
                  </Text>
                  <Text
                    style={[
                      styles.timeBucketSubtext,
                      filters.timeBucket === TimeBucket.AFTERNOON && styles.timeBucketSubtextActive
                    ]}
                  >
                    12 PM - 5 PM
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.timeBucketButton,
                    filters.timeBucket === TimeBucket.EVENING && styles.timeBucketButtonActive
                  ]}
                  onPress={() =>
                    updateFilter(
                      'timeBucket',
                      filters.timeBucket === TimeBucket.EVENING ? null : TimeBucket.EVENING
                    )
                  }
                >
                  <Text
                    style={[
                      styles.timeBucketText,
                      filters.timeBucket === TimeBucket.EVENING && styles.timeBucketTextActive
                    ]}
                  >
                    Evening
                  </Text>
                  <Text
                    style={[
                      styles.timeBucketSubtext,
                      filters.timeBucket === TimeBucket.EVENING && styles.timeBucketSubtextActive
                    ]}
                  >
                    5 PM - 12 AM
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Pickup Location */}
            <View style={[styles.filterGroup, { zIndex: 12 }]}>
              <Text style={styles.filterLabel}>Pickup Location</Text>
              <View style={styles.inputContainer}>
                <MapPin size={20} color="#718096" style={styles.inputIcon} />
                <TextInput
                  style={styles.textInput}
                  placeholder="Enter pickup location"
                  value={filters.pickupLocation || ''}
                  onFocus={() => { if (pickupSuggestions.length > 0) setShowPickupSuggestions(true); }}
                  onChangeText={(text) => {
                    updateFilter('pickupLocation', text || null);
                    if (pickupTimer.current) clearTimeout(pickupTimer.current);
                    pickupTimer.current = setTimeout(() => fetchSuggestions(text, setPickupSuggestions, setShowPickupSuggestions), 250);
                  }}
                  placeholderTextColor="#A0AEC0"
                />
              </View>
              {showPickupSuggestions && pickupSuggestions.length > 0 && (
                <View style={styles.suggestionsPanel}>
                  {pickupSuggestions.slice(0, 5).map((s, idx) => (
                    <TouchableOpacity
                      key={`${s.place_id}-${idx}`}
                      style={styles.suggestionItem}
                      onPress={() => {
                        const displayText = s.secondaryText ? `${s.mainText}, ${s.secondaryText}` : s.mainText;
                        updateFilter('pickupLocation', displayText);
                        setShowPickupSuggestions(false);
                        setPickupSuggestions([]);
                        Keyboard.dismiss();
                      }}
                    >
                      <Text style={styles.suggestionMainText} numberOfLines={1}>{s.mainText}</Text>
                      {s.secondaryText ? <Text style={styles.suggestionSecondaryText} numberOfLines={1}>{s.secondaryText}</Text> : null}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Dropoff Location */}
            <View style={[styles.filterGroup, { zIndex: 11 }]}>
              <Text style={styles.filterLabel}>Dropoff Location</Text>
              <View style={styles.inputContainer}>
                <MapPin size={20} color="#718096" style={styles.inputIcon} />
                <TextInput
                  style={styles.textInput}
                  placeholder="Enter dropoff location"
                  value={filters.dropoffLocation || ''}
                  onFocus={() => { if (dropoffSuggestions.length > 0) setShowDropoffSuggestions(true); }}
                  onChangeText={(text) => {
                    updateFilter('dropoffLocation', text || null);
                    if (dropoffTimer.current) clearTimeout(dropoffTimer.current);
                    dropoffTimer.current = setTimeout(() => fetchSuggestions(text, setDropoffSuggestions, setShowDropoffSuggestions), 250);
                  }}
                  placeholderTextColor="#A0AEC0"
                />
              </View>
              {showDropoffSuggestions && dropoffSuggestions.length > 0 && (
                <View style={styles.suggestionsPanel}>
                  {dropoffSuggestions.slice(0, 5).map((s, idx) => (
                    <TouchableOpacity
                      key={`${s.place_id}-${idx}`}
                      style={styles.suggestionItem}
                      onPress={() => {
                        const displayText = s.secondaryText ? `${s.mainText}, ${s.secondaryText}` : s.mainText;
                        updateFilter('dropoffLocation', displayText);
                        setShowDropoffSuggestions(false);
                        setDropoffSuggestions([]);
                        Keyboard.dismiss();
                      }}
                    >
                      <Text style={styles.suggestionMainText} numberOfLines={1}>{s.mainText}</Text>
                      {s.secondaryText ? <Text style={styles.suggestionSecondaryText} numberOfLines={1}>{s.secondaryText}</Text> : null}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Price Range */}
            <View style={styles.filterGroup}>
              <Text style={styles.filterLabel}>Price Range</Text>
              <View style={styles.priceRangeContainer}>
                <View style={styles.priceInputWrapper}>
                  <Text style={styles.priceCurrency}>$</Text>
                  <TextInput
                    style={styles.priceInput}
                    placeholder="Min"
                    keyboardType="decimal-pad"
                    value={filters.minPrice !== null ? filters.minPrice.toString() : ''}
                    onChangeText={(text) =>
                      updateFilter('minPrice', text ? parseFloat(text) : null)
                    }
                    placeholderTextColor="#A0AEC0"
                  />
                </View>
                <Text style={styles.priceSeparator}>to</Text>
                <View style={styles.priceInputWrapper}>
                  <Text style={styles.priceCurrency}>$</Text>
                  <TextInput
                    style={styles.priceInput}
                    placeholder="Max"
                    keyboardType="decimal-pad"
                    value={filters.maxPrice !== null ? filters.maxPrice.toString() : ''}
                    onChangeText={(text) =>
                      updateFilter('maxPrice', text ? parseFloat(text) : null)
                    }
                    placeholderTextColor="#A0AEC0"
                  />
                </View>
              </View>
            </View>

            {/* Seats Filter (only for riders) */}
            {showSeatsFilter && (
              <View style={styles.filterGroup}>
                <Text style={styles.filterLabel}>Number of Seats</Text>
                <View style={styles.seatsContainer}>
                  <TouchableOpacity
                    style={[
                      styles.seatButton,
                      filters.seats === 1 && styles.seatButtonActive
                    ]}
                    onPress={() => updateFilter('seats', filters.seats === 1 ? null : 1)}
                  >
                    <Text
                      style={[
                        styles.seatButtonText,
                        filters.seats === 1 && styles.seatButtonTextActive
                      ]}
                    >
                      1 Seat
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.seatButton,
                      filters.seats === 2 && styles.seatButtonActive
                    ]}
                    onPress={() => updateFilter('seats', filters.seats === 2 ? null : 2)}
                  >
                    <Text
                      style={[
                        styles.seatButtonText,
                        filters.seats === 2 && styles.seatButtonTextActive
                      ]}
                    >
                      2 Seats
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.clearButton} onPress={handleClearAll}>
              <Text style={styles.clearButtonText}>Clear All</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.applyButton} onPress={handleApply}>
              <Text style={styles.applyButtonText}>
                Apply {activeFilterCount() > 0 && `(${activeFilterCount()})`}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#2D3748',
  },
  closeButton: {
    padding: 4,
  },
  scrollContent: {
    padding: 20,
  },
  filterGroup: {
    marginBottom: 24,
  },
  filterLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3748',
    marginBottom: 12,
  },
  helperText: {
    fontSize: 12,
    color: '#718096',
    marginTop: 6,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  inputIcon: {
    marginLeft: 12,
  },
  textInput: {
    flex: 1,
    padding: 12,
    fontSize: 16,
    color: '#2D3748',
  },
  timeBucketContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  timeBucketButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
  },
  timeBucketButtonActive: {
    borderColor: '#E05E1A',
    backgroundColor: '#E05E1A',
  },
  timeBucketText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D3748',
    marginBottom: 2,
    textAlign: 'center',
  },
  timeBucketTextActive: {
    color: '#FFFFFF',
  },
  timeBucketSubtext: {
    fontSize: 11,
    color: '#718096',
    textAlign: 'center',
  },
  timeBucketSubtextActive: {
    color: 'rgba(255, 255, 255, 0.9)',
  },
  priceRangeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  priceInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  priceCurrency: {
    fontSize: 16,
    fontWeight: '500',
    color: '#718096',
    marginLeft: 12,
  },
  priceInput: {
    flex: 1,
    padding: 12,
    fontSize: 16,
    color: '#2D3748',
  },
  priceSeparator: {
    fontSize: 14,
    color: '#718096',
    fontWeight: '500',
  },
  seatsContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  seatButton: {
    flex: 1,
    padding: 16,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
  },
  seatButtonActive: {
    borderColor: '#E05E1A',
    backgroundColor: '#E05E1A',
  },
  seatButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#2D3748',
  },
  seatButtonTextActive: {
    color: '#FFFFFF',
  },
  footer: {
    flexDirection: 'row',
    padding: 20,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#EDF2F7',
  },
  clearButton: {
    flex: 1,
    padding: 16,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
  },
  clearButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3748',
  },
  applyButton: {
    flex: 1,
    padding: 16,
    borderRadius: 8,
    backgroundColor: '#E05E1A',
    alignItems: 'center',
  },
  applyButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  suggestionsPanel: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    marginTop: 2,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 6 },
      android: { elevation: 6 },
    }),
  },
  suggestionItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  suggestionMainText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3748',
  },
  suggestionSecondaryText: {
    fontSize: 13,
    color: '#718096',
    marginTop: 1,
  },
});
