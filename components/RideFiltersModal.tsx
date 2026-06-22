import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, TextInput, StyleSheet, ScrollView, Platform, Keyboard } from 'react-native';
import { X, Calendar, MapPin } from 'lucide-react-native';
import { TimeBucket, type RideFilterOptions, getDefaultFilters } from '@/utils/rideFilters';
import { GOOGLE_MAPS_API_KEY } from '@/constants/services';
import KeyboardAwareModalView from '@/components/KeyboardAwareModalView';

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

  useEffect(() => {
    if (visible) setFilters(initialFilters);
  }, [initialFilters, visible]);

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
      <KeyboardAwareModalView style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.dragHandle} />
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.headerTitle}>Filter rides</Text>
              <Text style={styles.headerSubtitle}>Narrow results by trip details</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X size={20} color="#15233A" />
            </TouchableOpacity>
          </View>

          {/* Scrollable Content */}
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Date Filter */}
            <View style={styles.filterGroup}>
              <Text style={styles.filterLabel}>Date</Text>
              <View style={styles.inputContainer}>
                <Calendar size={19} color="#8B94A6" style={styles.inputIcon} />
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
              <Text style={styles.filterLabel}>Time of day</Text>
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
              <Text style={styles.filterLabel}>Pickup location</Text>
              <View style={styles.inputContainer}>
                <MapPin size={19} color="#8B94A6" style={styles.inputIcon} />
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
              <Text style={styles.filterLabel}>Destination</Text>
              <View style={styles.inputContainer}>
                <MapPin size={19} color="#8B94A6" style={styles.inputIcon} />
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
              <Text style={styles.filterLabel}>Price per seat</Text>
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
                <Text style={styles.filterLabel}>Seats needed</Text>
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
              <Text style={styles.clearButtonText}>Reset</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.applyButton} onPress={handleApply}>
              <Text style={styles.applyButtonText}>
                Show rides {activeFilterCount() > 0 && `(${activeFilterCount()})`}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAwareModalView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.38)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FBFAF7',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '92%',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.14,
        shadowRadius: 18,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  dragHandle: {
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#D4CEC4',
    alignSelf: 'center',
    marginTop: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 18,
  },
  headerCopy: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 25,
    lineHeight: 31,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: '#15233A',
  },
  headerSubtitle: {
    color: '#8B94A6',
    fontSize: 13,
    marginTop: 2,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E0D8',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  filterGroup: {
    marginBottom: 12,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E5E0D8',
    backgroundColor: '#FFFFFF',
  },
  filterLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#15233A',
    marginBottom: 10,
  },
  helperText: {
    fontSize: 11,
    color: '#8B94A6',
    marginTop: 6,
  },
  inputContainer: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D7DCE3',
    borderRadius: 14,
    backgroundColor: '#FCFCFB',
  },
  inputIcon: {
    marginLeft: 14,
  },
  textInput: {
    flex: 1,
    height: 50,
    paddingHorizontal: 12,
    paddingVertical: 0,
    fontSize: 15,
    color: '#15233A',
  },
  timeBucketContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  timeBucketButton: {
    flex: 1,
    minHeight: 62,
    paddingVertical: 10,
    paddingHorizontal: 5,
    borderWidth: 1,
    borderColor: '#D7DCE3',
    borderRadius: 14,
    backgroundColor: '#FCFCFB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeBucketButtonActive: {
    borderColor: '#15233A',
    backgroundColor: '#15233A',
  },
  timeBucketText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#15233A',
    marginBottom: 2,
    textAlign: 'center',
  },
  timeBucketTextActive: {
    color: '#FFFFFF',
  },
  timeBucketSubtext: {
    fontSize: 11,
    color: '#8B94A6',
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
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D7DCE3',
    borderRadius: 14,
    backgroundColor: '#FCFCFB',
  },
  priceCurrency: {
    fontSize: 16,
    fontWeight: '500',
    color: '#8B94A6',
    marginLeft: 14,
  },
  priceInput: {
    flex: 1,
    height: 50,
    paddingHorizontal: 10,
    paddingVertical: 0,
    fontSize: 15,
    color: '#15233A',
  },
  priceSeparator: {
    fontSize: 14,
    color: '#8B94A6',
    fontWeight: '500',
  },
  seatsContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  seatButton: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#D7DCE3',
    borderRadius: 24,
    backgroundColor: '#FCFCFB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatButtonActive: {
    borderColor: '#15233A',
    backgroundColor: '#15233A',
  },
  seatButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#15233A',
  },
  seatButtonTextActive: {
    color: '#FFFFFF',
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 18,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E0D8',
    backgroundColor: '#FFFFFF',
  },
  clearButton: {
    minWidth: 104,
    height: 52,
    borderWidth: 1,
    borderColor: '#D7DCE3',
    borderRadius: 26,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#15233A',
  },
  applyButton: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#DE5D20',
    alignItems: 'center',
    justifyContent: 'center',
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
    borderColor: '#D7DCE3',
    borderRadius: 14,
    marginTop: 6,
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 6 },
      android: { elevation: 6 },
    }),
  },
  suggestionItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEAE3',
  },
  suggestionMainText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#15233A',
  },
  suggestionSecondaryText: {
    fontSize: 13,
    color: '#8B94A6',
    marginTop: 1,
  },
});
