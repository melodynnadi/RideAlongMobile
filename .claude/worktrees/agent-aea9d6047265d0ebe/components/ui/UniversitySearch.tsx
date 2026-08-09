import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Pressable,
} from 'react-native';
import { Search, X, MapPin, Plus } from 'lucide-react-native';
import { firebaseAuth } from '@/constants/services';

interface University {
  id: string;
  name: string;
  city: string;
  state: string;
  displayName: string;
  custom?: boolean;
}

interface UniversitySearchProps {
  value?: string;
  onSelect: (university: University | null) => void;
  placeholder?: string;
  allowCustom?: boolean;
}

export function UniversitySearch({
  value = '',
  onSelect,
  placeholder = 'Search any U.S. university...',
  allowCustom = true,
}: UniversitySearchProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<University[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  // Normalize and rank results for better search relevance
  const normalizeQuery = (text: string): string => {
    return text.toLowerCase()
      .replace(/[^\w\s&]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const tokenize = (text: string): string[] => {
    return text.split(/\s+/).filter(t => t.length > 0);
  };

  const rankResults = (results: University[], query: string): University[] => {
    const qNorm = normalizeQuery(query);
    const qTokens = tokenize(qNorm);
    
    const scoredResults = results.map(university => {
      const name = university.name || '';
      const nNorm = normalizeQuery(name);
      const nTokens = tokenize(nNorm);

      let score = 0;

      // Exact normalized match
      if (nNorm === qNorm) score += 100000;

      // Starts-with normalized
      if (nNorm.startsWith(qNorm)) score += 50000;

      // Special boost for "The University of Texas at [location]" when searching "university of texas at"
      if (qNorm.includes('university of texas at') || qNorm.includes('university of texas')) {
        if (nNorm.startsWith('the university of texas at')) score += 80000;
        if (nNorm.startsWith('university of texas at')) score += 75000;
      }

      // Token-level matching: all query tokens present -> big boost
      const hasAllTokens = qTokens.every(t => nTokens.some(nt => nt.includes(t)));
      if (hasAllTokens) score += 30000;

      // Per-token partials and starts-with bonuses
      for (const qt of qTokens) {
        for (const nt of nTokens) {
          if (nt === qt) score += 800;
          else if (nt.startsWith(qt)) score += 500;
          else if (qt.length > 2 && nt.includes(qt)) score += 250;
        }
      }

      // Synonym bonuses (e.g., a&m vs a and m, & vs and)
      if (nNorm.includes('a and m') && qNorm.includes('a&m')) score += 1500;
      if (nNorm.includes('a&m') && qNorm.includes('a and m')) score += 1500;
      if (nNorm.includes('university of texas') && qNorm.includes('ut')) score += 1200;

      // Name length slight penalty to prefer concise matches
      score -= nNorm.length;

      return { university, score };
    });

    scoredResults.sort((a, b) => b.score - a.score);
    return scoredResults.map(r => r.university);
  };

  const performSearch = useCallback(async (query: string) => {
    if (query.length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const user = firebaseAuth.currentUser;
      let headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      if (user) {
        const token = await user.getIdToken();
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Use backend URL from environment variable
      const baseUrl = process.env.EXPO_PUBLIC_API_URL || 'https://ridealongwebapp.onrender.com';

      const response = await fetch(
        `${baseUrl}/api/universities/search?query=${encodeURIComponent(query)}&limit=50`,
        { headers }
      );

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      const data = await response.json();
      console.log('University search response:', { 
        query, 
        resultsCount: data.results?.length, 
        data: JSON.stringify(data).substring(0, 200) 
      });
      
      // Rank results by relevance before displaying
      const rankedResults = rankResults(data.results || [], query);
      setResults(rankedResults);
    } catch (err) {
      console.error('University search error:', err);
      setError('Failed to search universities. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearchChange = useCallback((text: string) => {
    setSearchQuery(text);

    // Clear previous timer
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // Debounce search
    debounceTimer.current = setTimeout(() => {
      performSearch(text);
    }, 300);
  }, [performSearch]);

  const handleSelectUniversity = (university: University) => {
    onSelect(university);
    setModalVisible(false);
    setSearchQuery('');
    setResults([]);
  };

  const handleCustomEntry = () => {
    if (searchQuery.trim()) {
      onSelect({
        id: 'custom',
        name: searchQuery.trim(),
        city: '',
        state: '',
        displayName: searchQuery.trim(),
        custom: true,
      });
      setModalVisible(false);
      setSearchQuery('');
      setResults([]);
    }
  };

  const renderUniversityItem = ({ item }: { item: University }) => (
    <TouchableOpacity
      style={styles.resultItem}
      onPress={() => handleSelectUniversity(item)}
      activeOpacity={0.7}
    >
      <View style={styles.resultContent}>
        <Text style={styles.universityName}>{item.name}</Text>
        <View style={styles.locationRow}>
          <MapPin size={14} color="#6b7280" />
          <Text style={styles.universityLocation}>
            {item.city}, {item.state}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderEmptyState = () => {
    if (loading) {
      return (
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color="#E05E1A" />
          <Text style={styles.emptyText}>Searching universities...</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.emptyState}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      );
    }

    if (searchQuery.length >= 2 && results.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Search size={48} color="#9ca3af" />
          <Text style={styles.emptyText}>No universities found</Text>
          {allowCustom && (
            <Text style={styles.emptyHint}>
              You can enter a custom name if your university isn't listed
            </Text>
          )}
        </View>
      );
    }

    return (
      <View style={styles.emptyState}>
        <Search size={48} color="#9ca3af" />
        <Text style={styles.emptyText}>Start typing to search</Text>
        <Text style={styles.emptyHint}>
          Search for any U.S. university or college
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.inputTrigger}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.7}
      >
        <Search size={20} color="#6b7280" style={styles.searchIcon} />
        <Text style={value ? styles.inputText : styles.inputPlaceholder}>
          {value || placeholder}
        </Text>
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select University</Text>
            <TouchableOpacity
              onPress={() => setModalVisible(false)}
              style={styles.closeButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <X size={24} color="#111827" />
            </TouchableOpacity>
          </View>

          <View style={styles.searchContainer}>
            <Search size={20} color="#6b7280" style={styles.modalSearchIcon} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={handleSearchChange}
              placeholder={placeholder}
              placeholderTextColor="#9ca3af"
              autoFocus
              autoCapitalize="words"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setSearchQuery('');
                  setResults([]);
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <X size={20} color="#6b7280" />
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            data={results}
            renderItem={renderUniversityItem}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={renderEmptyState}
            contentContainerStyle={styles.resultsList}
            keyboardShouldPersistTaps="handled"
            ListFooterComponent={
              allowCustom && searchQuery.trim().length >= 2 ? (
                <TouchableOpacity
                  style={styles.customButton}
                  onPress={handleCustomEntry}
                  activeOpacity={0.7}
                >
                  <Plus size={20} color="#E05E1A" />
                  <Text style={styles.customButtonText}>
                    My university isn't listed
                  </Text>
                </TouchableOpacity>
              ) : null
            }
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  inputTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    minHeight: 48,
  },
  searchIcon: {
    marginRight: 8,
  },
  inputText: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
  },
  inputPlaceholder: {
    flex: 1,
    fontSize: 16,
    color: '#9ca3af',
  },
  modal: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
  },
  closeButton: {
    padding: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    margin: 16,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  modalSearchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 12,
    color: '#111827',
  },
  resultsList: {
    padding: 16,
    flexGrow: 1,
  },
  resultItem: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  resultContent: {
    gap: 6,
  },
  universityName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  universityLocation: {
    fontSize: 14,
    color: '#6b7280',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    minHeight: 300,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#6b7280',
    marginTop: 16,
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 8,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 16,
    color: '#dc2626',
    textAlign: 'center',
  },
  customButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fef3f2',
    borderRadius: 8,
    padding: 16,
    marginTop: 16,
    gap: 8,
  },
  customButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#E05E1A',
  },
});
