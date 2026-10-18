import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Search, X, MapPin, Plus } from 'lucide-react-native';
import { firebaseAuth, getApiBaseUrl } from '@/constants/services';
import KeyboardAwareModalView from '@/components/KeyboardAwareModalView';
import { useAppTheme } from '@/hooks/ThemeContext';
import type { AppColors } from '@/constants/theme';

interface University {
  id: string;
  name: string;
  city: string;
  state: string;
  displayName: string;
  custom?: boolean;
  url?: string;
}

interface UniversitySearchProps {
  value?: string;
  onSelect: (university: University | null) => void;
  placeholder?: string;
  allowCustom?: boolean;
}

const normalizeQuery = (text: string): string => text.toLowerCase()
  .replace(/[^\w\s&]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const tokenize = (text: string): string[] => text.split(/\s+/).filter((token) => token.length > 0);

const rankResults = (results: University[], query: string): University[] => {
  const qNorm = normalizeQuery(query);
  const qTokens = tokenize(qNorm);
  return results
    .map((university) => {
      const nNorm = normalizeQuery(university.name || '');
      const nTokens = tokenize(nNorm);
      let score = 0;
      if (nNorm === qNorm) score += 100000;
      if (nNorm.startsWith(qNorm)) score += 50000;
      if (qNorm.includes('university of texas')) {
        if (nNorm.startsWith('the university of texas at')) score += 80000;
        if (nNorm.startsWith('university of texas at')) score += 75000;
      }
      if (qTokens.every((token) => nTokens.some((nameToken) => nameToken.includes(token)))) score += 30000;
      qTokens.forEach((queryToken) => nTokens.forEach((nameToken) => {
        if (nameToken === queryToken) score += 800;
        else if (nameToken.startsWith(queryToken)) score += 500;
        else if (queryToken.length > 2 && nameToken.includes(queryToken)) score += 250;
      }));
      if (nNorm.includes('a and m') && qNorm.includes('a&m')) score += 1500;
      if (nNorm.includes('a&m') && qNorm.includes('a and m')) score += 1500;
      if (nNorm.includes('university of texas') && qNorm.includes('ut')) score += 1200;
      return { university, score: score - nNorm.length };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ university }) => university);
};

export function UniversitySearch({
  value = '',
  onSelect,
  placeholder = 'Search any U.S. university...',
  allowCustom = true,
}: UniversitySearchProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [modalVisible, setModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<University[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
  }, []);

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

      // getApiBaseUrl swaps localhost for the dev machine's LAN IP so this works on a physical phone.
      const baseUrl = getApiBaseUrl();

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
          <MapPin size={14} color={colors.textSecondary} />
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
          <ActivityIndicator size="large" color={colors.primary} />
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
          <Search size={48} color={colors.textSecondary} />
          <Text style={styles.emptyText}>No universities found</Text>
          {allowCustom && (
            <Text style={styles.emptyHint}>
              {"You can enter a custom name if your university isn't listed"}
            </Text>
          )}
        </View>
      );
    }

    return (
      <View style={styles.emptyState}>
        <Search size={48} color={colors.textSecondary} />
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
        <Search size={20} color={colors.textSecondary} style={styles.searchIcon} />
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
        <KeyboardAwareModalView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select University</Text>
            <TouchableOpacity
              onPress={() => setModalVisible(false)}
              style={styles.closeButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <X size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchContainer}>
            <Search size={20} color={colors.textSecondary} style={styles.modalSearchIcon} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={handleSearchChange}
              placeholder={placeholder}
              placeholderTextColor={colors.textSecondary}
              keyboardAppearance={colors.statusBar === 'light-content' ? 'dark' : 'light'}
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
                <X size={20} color={colors.textSecondary} />
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
                  <Plus size={20} color={colors.primary} />
                  <Text style={styles.customButtonText}>
                    {"My university isn't listed"}
                  </Text>
                </TouchableOpacity>
              ) : null
            }
          />
        </KeyboardAwareModalView>
      </Modal>
    </View>
  );
}

// Built from the app theme so the field and the picker follow light/dark mode.
const makeStyles = (colors: AppColors) => StyleSheet.create({
  container: {
    width: '100%',
  },
  inputTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 54,
  },
  searchIcon: {
    marginRight: 8,
  },
  inputText: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  inputPlaceholder: {
    flex: 1,
    fontSize: 16,
    color: colors.textSecondary,
  },
  modal: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  closeButton: {
    padding: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderRadius: 14,
    margin: 16,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalSearchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 14,
    color: colors.textPrimary,
  },
  resultsList: {
    padding: 16,
    flexGrow: 1,
  },
  resultItem: {
    backgroundColor: colors.bgCard,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultContent: {
    gap: 6,
  },
  universityName: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  universityLocation: {
    fontSize: 14,
    color: colors.textSecondary,
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
    color: colors.textSecondary,
    marginTop: 16,
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 8,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 16,
    color: colors.red,
    textAlign: 'center',
  },
  customButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryDim,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    gap: 8,
  },
  customButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
});
