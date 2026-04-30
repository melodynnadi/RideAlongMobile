import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Keyboard } from 'react-native';
import { getApiBaseUrl } from '@/constants/services';
import { firebaseAuth } from '@/constants/services';

type Suggestion = { description: string; place_id: string; displayText: string };

function newToken() {
  return 'tok_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

interface CityAutocompleteProps {
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  onSelected: (location: string) => void;
  apiKey?: string;
}

export function CityAutocomplete({
  placeholder,
  value,
  onChangeText,
  onSelected,
  apiKey,
}: CityAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [timer, setTimer] = useState<any>(null);
  const [hasError, setHasError] = useState(false);
  const token = useMemo(() => newToken(), []);

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
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor="#94A3B8"
        value={value}
        onFocus={() => setOpen(true)}
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
        <View style={styles.dropdown}>
          {loading ? (
            <View style={styles.item}>
              <Text style={styles.itemText}>Searching...</Text>
            </View>
          ) : hasError ? (
            <View style={styles.item}>
              <Text style={[styles.itemText, { color: '#64748B' }]}>
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
                <Text style={styles.itemText}>{s.description}</Text>
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
    top: 48,
    left: 0,
    right: 0,
    backgroundColor: 'white',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    maxHeight: 250,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    zIndex: 1000,
  },
  item: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  itemText: {
    fontSize: 14,
    color: '#0F172A',
  },
});
