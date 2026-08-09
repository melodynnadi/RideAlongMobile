/**
 * DynamicLegalDocument Component
 * 
 * A reusable component for displaying legal documents (Terms of Service, Privacy Policy)
 * that fetches content from Firebase Firestore with loading states, error handling,
 * and offline caching support.
 */

import React, { useState, useEffect } from 'react';
import { 
  Text, 
  StyleSheet, 
  ScrollView, 
  View, 
  TouchableOpacity, 
  ActivityIndicator,
  Alert 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, RefreshCw, WifiOff } from 'lucide-react-native';
import { useTheme } from '@/hooks/useTheme';
import { 
  fetchTermsOfService, 
  fetchPrivacyPolicy, 
  getFallbackContent 
} from '@/utils/legalDocumentsService';
import type { LegalDocument } from '@/types';

interface DynamicLegalDocumentProps {
  documentType: 'terms' | 'privacy';
  onBack?: () => void;
}

// Markdown-like content renderer for mobile
const ContentRenderer = ({ content }: { content: string }) => {
  const theme = useTheme();
  
  // Parse text with bold formatting **text** -> bold text
  const parseTextWithBold = (text: string, baseStyle: any) => {
    const boldRegex = /\*\*(.*?)\*\*/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    let key = 0;

    while ((match = boldRegex.exec(text)) !== null) {
      // Add text before the bold part
      if (match.index > lastIndex) {
        parts.push(
          <Text key={key++} style={baseStyle}>
            {text.substring(lastIndex, match.index)}
          </Text>
        );
      }
      
      // Add the bold text
      parts.push(
        <Text key={key++} style={[baseStyle, styles.boldText]}>
          {match[1]}
        </Text>
      );
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text after the last bold part
    if (lastIndex < text.length) {
      parts.push(
        <Text key={key++} style={baseStyle}>
          {text.substring(lastIndex)}
        </Text>
      );
    }
    
    return parts.length > 0 ? parts : [<Text key={0} style={baseStyle}>{text}</Text>];
  };
  
  // Simple markdown parser for mobile display
  const renderContent = (text: string) => {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    
    lines.forEach((line, index) => {
      const trimmedLine = line.trim();
      
      if (!trimmedLine) {
        // Empty line - add spacing
        elements.push(<View key={`space-${index}`} style={styles.spacing} />);
      } else if (trimmedLine.startsWith('# ')) {
        // H1 - Main title
        const titleText = trimmedLine.substring(2);
        elements.push(
          <Text key={index} style={[styles.h1, { color: theme.colors.primary }]}>
            {parseTextWithBold(titleText, [styles.h1, { color: theme.colors.primary }])}
          </Text>
        );
      } else if (trimmedLine.startsWith('## ')) {
        // H2 - Section title
        const sectionText = trimmedLine.substring(3);
        elements.push(
          <Text key={index} style={[styles.h2, { color: theme.colors.secondary }]}>
            {parseTextWithBold(sectionText, [styles.h2, { color: theme.colors.secondary }])}
          </Text>
        );
      } else if (trimmedLine.startsWith('### ')) {
        // H3 - Subsection
        const subsectionText = trimmedLine.substring(4);
        elements.push(
          <Text key={index} style={styles.h3}>
            {parseTextWithBold(subsectionText, styles.h3)}
          </Text>
        );
      } else if (trimmedLine.startsWith('- ')) {
        // Bullet point
        const bulletText = trimmedLine.substring(2);
        elements.push(
          <View key={index} style={styles.listItem}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.listText}>
              {parseTextWithBold(bulletText, styles.listText)}
            </Text>
          </View>
        );
      } else {
        // Regular paragraph
        elements.push(
          <Text key={index} style={styles.paragraph}>
            {parseTextWithBold(trimmedLine, styles.paragraph)}
          </Text>
        );
      }
    });
    
    return elements;
  };
  
  return <View style={styles.contentContainer}>{renderContent(content)}</View>;
};

export function DynamicLegalDocument({
  documentType,
  onBack 
}: DynamicLegalDocumentProps) {
  const theme = useTheme();
  const [document, setDocument] = useState<LegalDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  };

  const fetchDocument = async (showRefreshIndicator = false) => {
    try {
      if (showRefreshIndicator) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const result = documentType === 'terms' 
        ? await fetchTermsOfService()
        : await fetchPrivacyPolicy();

      if (result.success && result.document) {
        setDocument(result.document);
      } else {
        throw new Error(result.error || 'Failed to load document');
      }
    } catch (err) {
      console.error(`Error loading ${documentType}:`, err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      
      // Show fallback content
      const fallbackDoc = getFallbackContent(documentType);
      setDocument(fallbackDoc);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDocument();
  }, [documentType]);

  const handleRefresh = () => {
    fetchDocument(true);
  };

  const handleRetry = () => {
    Alert.alert(
      'Retry Loading',
      'Would you like to try loading the document again?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Retry', onPress: () => fetchDocument() },
      ]
    );
  };

  const getTitle = () => {
    if (document?.title) return document.title;
    return documentType === 'terms' ? 'Terms of Service' : 'Privacy Policy';
  };

  const getLastUpdated = () => {
    if (document?.lastUpdated) {
      return document.lastUpdated.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }
    return 'January 2025';
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#F8FAFC' }} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={handleBack}
          >
            <ArrowLeft size={24} color={theme.colors.secondary} />
          </TouchableOpacity>
        </View>
        
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading {getTitle()}...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F8FAFC' }} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={24} color={theme.colors.secondary} />
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.refreshButton}
          onPress={handleRefresh}
          disabled={isRefreshing}
          accessibilityRole="button"
          accessibilityLabel="Refresh document"
        >
          <RefreshCw 
            size={20} 
            color={isRefreshing ? '#94A3B8' : theme.colors.secondary}
            style={isRefreshing ? { transform: [{ rotate: '180deg' }] } : undefined}
          />
        </TouchableOpacity>
      </View>

      <ScrollView 
        contentContainerStyle={styles.container} 
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: theme.colors.primary }]}>
          {getTitle()}
        </Text>
        
        {error && (
          <View style={styles.errorBanner}>
            <View style={styles.errorContent}>
              <WifiOff size={16} color="#DC2626" />
              <Text style={styles.errorText}>
                Content may be outdated. Tap retry to refresh.
              </Text>
            </View>
            <TouchableOpacity onPress={handleRetry} style={styles.retryButton}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {document?.content && (
          <ContentRenderer content={document.content} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingBottom: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },
  refreshButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#64748B',
    fontWeight: '500',
  },
  container: { 
    padding: 16, 
    paddingBottom: 32 
  },
  title: { 
    fontSize: 28, 
    fontWeight: '800', 
    marginBottom: 8, 
    color: '#0F172A' 
  },
  metaContainer: {
    marginBottom: 24,
  },
  subtitle: { 
    fontSize: 14, 
    color: '#64748B', 
    marginBottom: 4 
  },
  version: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 12,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  errorContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  errorText: {
    fontSize: 14,
    color: '#DC2626',
    flex: 1,
  },
  retryButton: {
    backgroundColor: '#DC2626',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  retryText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  contentContainer: {
    gap: 8,
  },
  spacing: {
    height: 8,
  },
  h1: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 8,
    marginTop: 16,
  },
  h2: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 20,
  },
  h3: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 12,
    color: '#0F172A',
  },
  paragraph: {
    fontSize: 14,
    color: '#334155',
    lineHeight: 22,
    marginBottom: 8,
  },
  listItem: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
    alignItems: 'flex-start',
    paddingLeft: 8,
  },
  bullet: {
    fontSize: 16,
    lineHeight: 22,
    color: '#0F172A',
  },
  listText: {
    flex: 1,
    fontSize: 14,
    color: '#334155',
    lineHeight: 22,
  },
  boldText: {
    fontWeight: '700',
  },
});
export default DynamicLegalDocument;
