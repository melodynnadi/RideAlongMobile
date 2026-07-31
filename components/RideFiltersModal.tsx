import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { View, Text, Modal, TouchableOpacity, TextInput, StyleSheet, ScrollView, Platform, Keyboard } from 'react-native';
import { X, Calendar, MapPin, PartyPopper } from 'lucide-react-native';
import { Ionicons } from '@expo/vector-icons';
import { TimeBucket, type RideFilterOptions, getDefaultFilters } from '@/utils/rideFilters';
import { GOOGLE_MAPS_API_KEY } from '@/constants/services';
import KeyboardAwareModalView from '@/components/KeyboardAwareModalView';
import { useAppTheme } from '@/hooks/ThemeContext';

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
  const { colors } = useAppTheme();
  const [filters, setFilters] = useState<RideFilterOptions>(initialFilters);

  const styles = useMemo(() => StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(15, 23, 42, 0.38)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: colors.bg,
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
      backgroundColor: colors.border,
      alignSelf: 'center',
      marginTop: 10,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 20,
      paddingTop: 14,
      paddingBottom: 18,
    },
    headerIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    headerCopy: {
      flex: 1,
    },
    headerTitle: {
      fontSize: 25,
      lineHeight: 31,
      fontWeight: '700',
      letterSpacing: -0.3,
      color: colors.textPrimary,
    },
    headerSubtitle: {
      color: colors.textSecondary,
      fontSize: 13,
      marginTop: 2,
    },
    closeButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bgCard,
      borderWidth: 1,
      borderColor: colors.border,
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
      borderColor: colors.border,
      backgroundColor: colors.bgCard,
    },
    filterLabel: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: 10,
    },
    helperText: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 6,
    },
    inputContainer: {
      minHeight: 50,
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.bgSecondary,
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
      color: colors.textPrimary,
    },
    timeBucketContainer: {
      flexDirection: 'column',
      gap: 8,
    },
    timePill: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.bgSecondary,
    },
    timePillActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryDim,
    },
    timePillLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
      lineHeight: 18,
    },
    timePillLabelActive: {
      color: colors.primary,
    },
    timePillSub: {
      fontSize: 11,
      color: colors.textSecondary,
      lineHeight: 15,
    },
    timePillSubActive: {
      color: colors.primary,
      opacity: 0.8,
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
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.bgSecondary,
    },
    priceCurrency: {
      fontSize: 16,
      fontWeight: '500',
      color: colors.textSecondary,
      marginLeft: 14,
    },
    priceInput: {
      flex: 1,
      height: 50,
      paddingHorizontal: 10,
      paddingVertical: 0,
      fontSize: 15,
      color: colors.textPrimary,
    },
    priceSeparator: {
      fontSize: 14,
      color: colors.textSecondary,
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
      borderColor: colors.border,
      borderRadius: 24,
      backgroundColor: colors.bgSecondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    seatButtonActive: {
      borderColor: colors.textPrimary,
      backgroundColor: colors.textPrimary,
    },
    seatButtonText: {
      fontSize: 16,
      fontWeight: '500',
      color: colors.textPrimary,
    },
    seatButtonTextActive: {
      color: colors.textInverse,
    },
    footer: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 18,
      gap: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.bgCard,
    },
    clearButton: {
      minWidth: 104,
      height: 52,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 26,
      backgroundColor: colors.bgCard,
      alignItems: 'center',
      justifyContent: 'center',
    },
    clearButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    applyButton: {
      flex: 1,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    applyButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textInverse,
    },
    suggestionsPanel: {
      marginTop: 8,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgCard,
      overflow: 'hidden',
    },
    suggestionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 11,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    suggestionIconWrap: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.primaryDim,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    suggestionMainText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textPrimary,
      lineHeight: 18,
    },
    suggestionSecondaryText: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 1,
      lineHeight: 16,
    },
  }), [colors]);

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
    if (filters.eventName) count++;
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
            <View style={styles.headerIcon}>
              <Ionicons name="funnel-outline" size={16} color={colors.primary} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.headerTitle}>Filter rides</Text>
              <Text style={styles.headerSubtitle}>Narrow results by trip details</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Scrollable Content */}
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Date Filter */}
            <View style={styles.filterGroup}>
              <Text style={styles.filterLabel}>Date</Text>
              <View style={styles.inputContainer}>
                <Calendar size={19} color={colors.textSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.textInput}
                  placeholder="YYYY-MM-DD"
                  value={filters.date || ''}
                  onChangeText={(text) => updateFilter('date', text || null)}
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
              <Text style={styles.helperText}>Leave empty for any date</Text>
            </View>

            {/* Time of Day Filter */}
            <View style={styles.filterGroup}>
              <Text style={styles.filterLabel}>Time of day</Text>
              <View style={styles.timeBucketContainer}>
                {([
                  { key: TimeBucket.MORNING, icon: 'sunny-outline', label: 'Morning', sub: '5 AM–12 PM' },
                  { key: TimeBucket.AFTERNOON, icon: 'partly-sunny-outline', label: 'Afternoon', sub: '12–5 PM' },
                  { key: TimeBucket.EVENING, icon: 'moon-outline', label: 'Evening', sub: '5 PM–12 AM' },
                ] as const).map(({ key, icon, label, sub }) => {
                  const active = filters.timeBucket === key;
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[styles.timePill, active && styles.timePillActive]}
                      onPress={() => updateFilter('timeBucket', active ? null : key)}
                      activeOpacity={0.75}
                    >
                      <Ionicons name={icon} size={15} color={active ? colors.primary : colors.textSecondary} />
                      <View style={{ marginLeft: 6 }}>
                        <Text style={[styles.timePillLabel, active && styles.timePillLabelActive]}>{label}</Text>
                        <Text style={[styles.timePillSub, active && styles.timePillSubActive]}>{sub}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Pickup Location */}
            <View style={styles.filterGroup}>
              <Text style={styles.filterLabel}>Pickup location</Text>
              <View style={styles.inputContainer}>
                <MapPin size={19} color={colors.textSecondary} style={styles.inputIcon} />
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
                  onBlur={() => setTimeout(() => setShowPickupSuggestions(false), 150)}
                  placeholderTextColor={colors.textTertiary}
                />
                {filters.pickupLocation ? (
                  <TouchableOpacity onPress={() => { updateFilter('pickupLocation', null); setPickupSuggestions([]); }} style={{ paddingRight: 12 }}>
                    <Ionicons name="close-circle" size={17} color={colors.textSecondary} />
                  </TouchableOpacity>
                ) : null}
              </View>
              {showPickupSuggestions && pickupSuggestions.length > 0 && (
                <View style={styles.suggestionsPanel}>
                  {pickupSuggestions.slice(0, 5).map((s, idx) => (
                    <TouchableOpacity
                      key={`${s.place_id}-${idx}`}
                      style={[styles.suggestionItem, idx === pickupSuggestions.slice(0, 5).length - 1 && { borderBottomWidth: 0 }]}
                      onPress={() => {
                        const displayText = s.secondaryText ? `${s.mainText}, ${s.secondaryText}` : s.mainText;
                        updateFilter('pickupLocation', displayText);
                        setShowPickupSuggestions(false);
                        setPickupSuggestions([]);
                        Keyboard.dismiss();
                      }}
                    >
                      <View style={styles.suggestionIconWrap}>
                        <Ionicons name={idx === 0 ? 'location' : 'location-outline'} size={14} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.suggestionMainText} numberOfLines={1}>{s.mainText}</Text>
                        {s.secondaryText ? <Text style={styles.suggestionSecondaryText} numberOfLines={1}>{s.secondaryText}</Text> : null}
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Dropoff Location */}
            <View style={styles.filterGroup}>
              <Text style={styles.filterLabel}>Destination</Text>
              <View style={styles.inputContainer}>
                <MapPin size={19} color={colors.textSecondary} style={styles.inputIcon} />
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
                  onBlur={() => setTimeout(() => setShowDropoffSuggestions(false), 150)}
                  placeholderTextColor={colors.textTertiary}
                />
                {filters.dropoffLocation ? (
                  <TouchableOpacity onPress={() => { updateFilter('dropoffLocation', null); setDropoffSuggestions([]); }} style={{ paddingRight: 12 }}>
                    <Ionicons name="close-circle" size={17} color={colors.textSecondary} />
                  </TouchableOpacity>
                ) : null}
              </View>
              {showDropoffSuggestions && dropoffSuggestions.length > 0 && (
                <View style={styles.suggestionsPanel}>
                  {dropoffSuggestions.slice(0, 5).map((s, idx) => (
                    <TouchableOpacity
                      key={`${s.place_id}-${idx}`}
                      style={[styles.suggestionItem, idx === dropoffSuggestions.slice(0, 5).length - 1 && { borderBottomWidth: 0 }]}
                      onPress={() => {
                        const displayText = s.secondaryText ? `${s.mainText}, ${s.secondaryText}` : s.mainText;
                        updateFilter('dropoffLocation', displayText);
                        setShowDropoffSuggestions(false);
                        setDropoffSuggestions([]);
                        Keyboard.dismiss();
                      }}
                    >
                      <View style={styles.suggestionIconWrap}>
                        <Ionicons name={idx === 0 ? 'location' : 'location-outline'} size={14} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.suggestionMainText} numberOfLines={1}>{s.mainText}</Text>
                        {s.secondaryText ? <Text style={styles.suggestionSecondaryText} numberOfLines={1}>{s.secondaryText}</Text> : null}
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Event / occasion */}
            <View style={styles.filterGroup}>
              <Text style={styles.filterLabel}>Event</Text>
              <View style={styles.inputContainer}>
                <PartyPopper size={19} color={colors.textSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.textInput}
                  placeholder="Concert, game day, move-in weekend..."
                  value={filters.eventName || ''}
                  onChangeText={(text) => updateFilter('eventName', text || null)}
                  placeholderTextColor={colors.textTertiary}
                />
                {filters.eventName ? (
                  <TouchableOpacity onPress={() => updateFilter('eventName', null)} style={{ paddingRight: 12 }}>
                    <Ionicons name="close-circle" size={17} color={colors.textSecondary} />
                  </TouchableOpacity>
                ) : null}
              </View>
              <Text style={styles.helperText}>Find rides other students posted for the same event</Text>
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
                    placeholderTextColor={colors.textTertiary}
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
                    placeholderTextColor={colors.textTertiary}
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
