import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Keyboard, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { getApiBaseUrl, firebaseAuth } from '@/constants/services';

type Suggestion = { description: string; place_id: string; displayText: string };

interface CityAutocompleteProps {
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  onSelected: (location: string) => void;
  apiKey?: string;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  dropdownStyle?: StyleProp<ViewStyle>;
  zIndex?: number;
}

export function CityAutocomplete({
  placeholder,
  value,
  onChangeText,
  onSelected,
  apiKey,
  containerStyle,
  inputStyle,
  dropdownStyle,
  zIndex = 20,
}: CityAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [timer, setTimer] = useState<any>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
    return () => sub.remove();
  }, []);
  const fetchLocations = async (q: string) => {
    if (!q || q.trim().length < 2) {
      setItems([]);
      return;
    }

    try {
      setLoading(true);
      setHasError(false);

      let json: any = null;

      // Try backend proxy first
      try {
        const apiBase = getApiBaseUrl();
        const user = firebaseAuth.currentUser;

        if (user) {
          const authToken = await user.getIdToken();
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);

          const url = `${apiBase}/api/places/autocomplete?input=${encodeURIComponent(q)}`;
          const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${authToken}` },
          }).finally(() => clearTimeout(timeoutId));

          if (res.ok) json = await res.json();
        }
      } catch {}

      // Fallback: call Google Places API directly (works in React Native, no CORS)
      if (!json && apiKey) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&key=${apiKey}&components=country:us`;
          const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeoutId));
          if (res.ok) json = await res.json();
        } catch {}
      }

      if (!json) {
        setHasError(true);
        setItems([]);
        return;
      }

      const suggestions = (json?.predictions || []).map((p: any) => {
        const mainText = p.structured_formatting?.main_text || '';
        const desc = p.description || mainText;
        let displayText = desc;
        if (mainText && !desc.toLowerCase().startsWith(mainText.toLowerCase())) {
          displayText = mainText + ', ' + desc;
        }
        return { description: desc, place_id: p.place_id, displayText: displayText.trim() };
      });

      setItems(suggestions);
    } catch {
      setHasError(true);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { zIndex }, containerStyle]}>
      <TextInput
        style={[styles.input, inputStyle]}
        placeholder={placeholder}
        placeholderTextColor="#94A3B8"
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChangeText={(t) => {
          onChangeText(t);
          setOpen(true);
          setHasError(false);
          if (timer) clearTimeout(timer);
          const id = setTimeout(() => fetchLocations(t), 300);
          setTimer(id);
        }}
        autoCapitalize="words"
      />
      {open && (items.length > 0 || loading || hasError) && (
        <View style={[styles.dropdown, dropdownStyle]}>
          {loading ? (
            <View style={styles.stateRow}>
              <View style={styles.iconWrap}><Ionicons name="search-outline" size={15} color="#DE5D20" /></View>
              <Text style={styles.stateText}>Searching locations...</Text>
            </View>
          ) : hasError ? (
            <View style={styles.stateRow}>
              <View style={styles.iconWrap}><Ionicons name="alert-circle-outline" size={15} color="#8B94A6" /></View>
              <Text style={styles.stateText}>
                Could not load suggestions. You can still type manually.
              </Text>
            </View>
          ) : (
            items.slice(0, 8).map((s, idx) => (
              <TouchableOpacity
                key={`${s.place_id}-${idx}`}
                style={styles.item}
                onPress={() => {
                  setOpen(false);
                  onSelected(s.displayText);
                  onChangeText(s.displayText);
                  setTimeout(() => Keyboard.dismiss(), 50);
                }}
              >
                <View style={styles.iconWrap}>
                  <Ionicons name={idx === 0 ? 'location' : 'location-outline'} size={15} color="#DE5D20" />
                </View>
                <View style={styles.itemCopy}>
                  <Text style={styles.itemText} numberOfLines={1}>{s.displayText.split(',')[0]}</Text>
                  <Text style={styles.itemSubText} numberOfLines={1}>{s.description}</Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  input: {
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    fontSize: 14,
  },
  dropdown: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    backgroundColor: 'white',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E0D8',
    maxHeight: 268,
    shadowColor: '#15233A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 12,
    zIndex: 1000,
    overflow: 'hidden',
  },
  item: {
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1EEE8',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FEF0E8',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  itemCopy: {
    flex: 1,
    minWidth: 0,
  },
  itemText: {
    fontSize: 14,
    lineHeight: 18,
    color: '#15233A',
    fontWeight: '700',
  },
  itemSubText: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    color: '#8B94A6',
    fontWeight: '500',
  },
  stateRow: {
    minHeight: 54,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stateText: {
    flex: 1,
    color: '#8B94A6',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
});
