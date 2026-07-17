/**
 * Legal Documents Service
 * 
 * Service to fetch Terms of Service and Privacy Policy content from Firebase Firestore
 * with local caching for offline viewing and performance optimization.
 * 
 * Following the pattern from the web dashboard implementation.
 */

import { doc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { firestore } from '@/constants/services';
import type {
  LegalDocument,
  LegalDocumentServiceResponse,
  LegalDocumentCache
} from '@/types';

// Cache configuration
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
const CACHE_KEY_PREFIX = 'legal_document_';

// Firestore collection name
const LEGAL_DOCUMENTS_COLLECTION = 'legalDocuments';

/**
 * Cache management utilities
 */
const CacheManager = {
  /**
   * Get cached document if valid
   */
  async getCached(documentType: string): Promise<LegalDocument | null> {
    try {
      const cacheKey = `${CACHE_KEY_PREFIX}${documentType}`;
      const cachedData = await AsyncStorage.getItem(cacheKey);
      
      if (!cachedData) {
        return null;
      }

      const parsed: LegalDocumentCache = JSON.parse(cachedData);

      // Check if cache is still valid
      if (Date.now() - parsed.timestamp > CACHE_DURATION) {
        await AsyncStorage.removeItem(cacheKey);
        return null;
      }

      return parsed.document;
    } catch (error) {
      console.warn(`Error reading cache for ${documentType}:`, error);
      return null;
    }
  },

  /**
   * Cache document for offline access
   */
  async setCached(documentType: string, document: LegalDocument): Promise<void> {
    try {
      const cacheKey = `${CACHE_KEY_PREFIX}${documentType}`;
      const cachedData: LegalDocumentCache = {
        document,
        timestamp: Date.now(),
        expiresAt: Date.now() + CACHE_DURATION,
      };
      
      await AsyncStorage.setItem(cacheKey, JSON.stringify(cachedData));
    } catch (error) {
      console.warn(`Error caching document ${documentType}:`, error);
      // Don't throw - caching failure shouldn't break the app
    }
  },

  /**
   * Clear all cached legal documents
   */
  async clearCache(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const legalDocKeys = keys.filter(key => key.startsWith(CACHE_KEY_PREFIX));
      await AsyncStorage.multiRemove(legalDocKeys);
    } catch (error) {
      console.warn('Error clearing legal documents cache:', error);
    }
  },
};

/**
 * Fetch legal document from Firestore
 */
async function fetchLegalDocumentFromFirestore(documentType: string): Promise<LegalDocument | null> {
  try {
    const docRef = doc(firestore, LEGAL_DOCUMENTS_COLLECTION, documentType);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      console.warn(`Legal document ${documentType} not found in Firestore`);
      return null;
    }

    const data = docSnap.data();
    
    // Convert Firestore timestamps to Date objects
    return {
      id: docSnap.id,
      title: data.title || 'Legal Document',
      content: data.content || '',
      version: data.version || '1.0',
      lastUpdated: data.lastUpdated?.toDate() || new Date(),
      effectiveDate: data.effectiveDate?.toDate(),
      documentType: data.documentType || 'terms',
      platform: data.platform || 'all',
      status: data.status || 'active',
      createdBy: data.createdBy,
      sections: data.sections || [],
    } as LegalDocument;
  } catch (error) {
    console.error(`Error fetching ${documentType} from Firestore:`, error);
    throw error;
  }
}

/**
 * Generic function to fetch legal document with caching
 */
async function fetchLegalDocument(documentType: string): Promise<LegalDocumentServiceResponse> {
  try {
    // First, try to get from cache
    const cachedDocument = await CacheManager.getCached(documentType);
    if (cachedDocument) {
      console.log(`Using cached ${documentType}`);
      return { success: true, document: cachedDocument };
    }

    // If not in cache or expired, fetch from Firestore
    console.log(`Fetching ${documentType} from Firestore`);
    const document = await fetchLegalDocumentFromFirestore(documentType);
    
    if (!document) {
      return { 
        success: false, 
        error: `Document ${documentType} not found` 
      };
    }

    // Cache the document for offline access
    await CacheManager.setCached(documentType, document);

    return { success: true, document };
  } catch (error) {
    console.error(`Error fetching legal document ${documentType}:`, error);
    
    // Try to return cached version as fallback
    const cachedDocument = await CacheManager.getCached(documentType);
    if (cachedDocument) {
      console.log(`Using stale cached ${documentType} as fallback`);
      return { success: true, document: cachedDocument };
    }
    
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Fetch Terms of Service
 */
export async function fetchTermsOfService(): Promise<LegalDocumentServiceResponse> {
  return await fetchLegalDocument('terms');
}

/**
 * Fetch Privacy Policy
 */
export async function fetchPrivacyPolicy(): Promise<LegalDocumentServiceResponse> {
  return await fetchLegalDocument('privacy');
}

/**
 * Prefetch both legal documents for offline access
 * Useful to call during app initialization or when network is available
 */
export async function prefetchLegalDocuments(): Promise<void> {
  try {
    console.log('Prefetching legal documents...');
    await Promise.all([
      fetchTermsOfService(),
      fetchPrivacyPolicy(),
    ]);
    console.log('Legal documents prefetched successfully');
  } catch (error) {
    console.warn('Error prefetching legal documents:', error);
    // Don't throw - prefetching failure shouldn't break the app
  }
}

/**
 * Clear cached legal documents
 * Useful for testing or when forcing a refresh
 */
export async function clearLegalDocumentsCache(): Promise<void> {
  await CacheManager.clearCache();
}

/**
 * Check if legal documents are cached
 */
export async function areLegalDocumentsCached(): Promise<{
  termsOfService: boolean;
  privacyPolicy: boolean;
}> {
  const [terms, privacy] = await Promise.all([
    CacheManager.getCached('terms'),
    CacheManager.getCached('privacy'),
  ]);
  
  return {
    termsOfService: terms !== null,
    privacyPolicy: privacy !== null,
  };
}

/**
 * Fallback content for when documents cannot be loaded
 */
export const getFallbackContent = (documentType: 'terms' | 'privacy'): LegalDocument => {
  const baseDocument = {
    id: documentType === 'terms' ? 'terms-of-service' : 'privacy-policy',
    version: '1.0',
    lastUpdated: new Date().toISOString(),
    documentType,
    platform: 'mobile' as const,
    status: 'active' as const,
    sections: [],
  };

  if (documentType === 'terms') {
    return {
      ...baseDocument,
      title: 'Terms of Service',
      content: `
# Terms of Service

We're currently updating our Terms of Service. Please check back later or contact our support team for the latest version.

## Contact Information
For questions about our Terms of Service, please contact:
- Email: support@ridealongapp.com
- Website: www.ridealong.com

Thank you for your understanding.
      `.trim(),
    };
  } else {
    return {
      ...baseDocument,
      title: 'Privacy Policy',
      content: `
# Privacy Policy

We're currently updating our Privacy Policy. Please check back later or contact our support team for the latest version.

## Contact Information
For questions about our Privacy Policy, please contact:
- Email: privacy@ridealong.com
- Website: www.ridealong.com

Thank you for your understanding.
      `.trim(),
    };
  }
};