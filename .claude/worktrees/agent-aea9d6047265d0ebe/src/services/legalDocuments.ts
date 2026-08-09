import { doc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { firestore } from '@/constants/services';
import { LegalDocument, LegalDocumentCache, LegalDocumentServiceResponse } from '@/types';

const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const CACHE_KEY_PREFIX = 'legal_document_';

/**
 * Legal Documents Service
 * 
 * Fetches Terms of Service and Privacy Policy content from Firebase Firestore
 * with local caching using AsyncStorage for offline viewing.
 * 
 * Features:
 * - Firestore integration with fallback to default content
 * - 30-minute cache duration for optimal performance
 * - Offline functionality with cached documents
 * - Proper error handling and retry mechanisms
 */
export class LegalDocumentsService {
  private static instance: LegalDocumentsService;
  private connectionTimeout = 10000; // 10 seconds

  public static getInstance(): LegalDocumentsService {
    if (!LegalDocumentsService.instance) {
      LegalDocumentsService.instance = new LegalDocumentsService();
    }
    return LegalDocumentsService.instance;
  }

  /**
   * Fetches a legal document by ID (terms or privacy)
   * @param documentId - The document ID ('terms' or 'privacy')
   * @returns Promise<LegalDocumentServiceResponse>
   */
  async getLegalDocument(documentId: 'terms' | 'privacy'): Promise<LegalDocumentServiceResponse> {
    try {
      // First, try to get from cache
      const cachedDocument = await this.getCachedDocument(documentId);
      if (cachedDocument && !this.isCacheExpired(cachedDocument)) {
        return {
          success: true,
          document: cachedDocument.document,
          fromCache: true
        };
      }

      // If cache is expired or doesn't exist, fetch from Firestore
      const firestoreDocument = await this.fetchFromFirestore(documentId);
      if (firestoreDocument) {
        // Cache the document
        await this.cacheDocument(documentId, firestoreDocument);
        return {
          success: true,
          document: firestoreDocument,
          fromCache: false
        };
      }

      // If Firestore fails, try to return expired cache or default content
      if (cachedDocument) {
        return {
          success: true,
          document: cachedDocument.document,
          fromCache: true
        };
      }

      // Last resort: return default content
      const defaultDocument = this.getDefaultDocument(documentId);
      return {
        success: true,
        document: defaultDocument,
        fromCache: false
      };

    } catch (error) {
      console.error(`Error fetching legal document ${documentId}:`, error);
      
      // Try to return cached content on error
      const cachedDocument = await this.getCachedDocument(documentId);
      if (cachedDocument) {
        return {
          success: true,
          document: cachedDocument.document,
          fromCache: true
        };
      }

      // Return default content if no cache available
      return {
        success: false,
        error: 'Unable to load document. Please check your connection and try again.',
        document: this.getDefaultDocument(documentId)
      };
    }
  }

  /**
   * Prefetches legal documents for better performance
   * Should be called during app initialization
   */
  async prefetchDocuments(): Promise<void> {
    try {
      // Prefetch both terms and privacy documents silently
      await Promise.allSettled([
        this.getLegalDocument('terms'),
        this.getLegalDocument('privacy')
      ]);
    } catch (error) {
      console.warn('Error prefetching legal documents:', error);
    }
  }

  /**
   * Manually refresh a document (bypass cache)
   */
  async refreshDocument(documentId: 'terms' | 'privacy'): Promise<LegalDocumentServiceResponse> {
    try {
      // Clear existing cache
      await this.clearDocumentCache(documentId);
      
      // Fetch fresh document
      return await this.getLegalDocument(documentId);
    } catch (error) {
      console.error(`Error refreshing document ${documentId}:`, error);
      return {
        success: false,
        error: 'Unable to refresh document. Please try again.'
      };
    }
  }

  /**
   * Clear all cached legal documents
   */
  async clearAllCache(): Promise<void> {
    try {
      await Promise.allSettled([
        this.clearDocumentCache('terms'),
        this.clearDocumentCache('privacy')
      ]);
    } catch (error) {
      console.error('Error clearing legal documents cache:', error);
    }
  }

  // Private methods

  private async fetchFromFirestore(documentId: string): Promise<LegalDocument | null> {
    try {
      const docRef = doc(firestore, 'legalDocuments', documentId);
      const docSnap = await Promise.race([
        getDoc(docRef),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), this.connectionTimeout)
        )
      ]);

      if (docSnap.exists()) {
        const data = docSnap.data();
        return {
          id: documentId,
          title: data.title || (documentId === 'terms' ? 'Terms of Service' : 'Privacy Policy'),
          content: data.content || '',
          lastUpdated: data.lastUpdated || new Date().toISOString(),
          version: data.version
        };
      }
      return null;
    } catch (error) {
      console.error(`Firestore fetch error for ${documentId}:`, error);
      return null;
    }
  }

  private async getCachedDocument(documentId: string): Promise<LegalDocumentCache | null> {
    try {
      const cacheKey = `${CACHE_KEY_PREFIX}${documentId}`;
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error(`Cache retrieval error for ${documentId}:`, error);
    }
    return null;
  }

  private async cacheDocument(documentId: string, document: LegalDocument): Promise<void> {
    try {
      const cacheKey = `${CACHE_KEY_PREFIX}${documentId}`;
      const cache: LegalDocumentCache = {
        document,
        timestamp: Date.now(),
        expiresAt: Date.now() + CACHE_DURATION_MS
      };
      await AsyncStorage.setItem(cacheKey, JSON.stringify(cache));
    } catch (error) {
      console.error(`Cache storage error for ${documentId}:`, error);
    }
  }

  private isCacheExpired(cache: LegalDocumentCache): boolean {
    return Date.now() > cache.expiresAt;
  }

  private async clearDocumentCache(documentId: string): Promise<void> {
    try {
      const cacheKey = `${CACHE_KEY_PREFIX}${documentId}`;
      await AsyncStorage.removeItem(cacheKey);
    } catch (error) {
      console.error(`Cache clearing error for ${documentId}:`, error);
    }
  }

  private getDefaultDocument(documentId: 'terms' | 'privacy'): LegalDocument {
    if (documentId === 'terms') {
      return {
        id: 'terms',
        title: 'Terms of Service',
        content: `**1. Acceptance of Terms**

By accessing or using RideAlong's services, you agree to be bound by these Terms of Service ("Terms"). If you disagree with any part of these Terms, you may not access the service.

**2. Eligibility**

**Student Verification Required**
• Be at least 18 years old
• Possess a valid .edu email address from an accredited institution  
• Be currently enrolled as a student
• Provide valid government‑issued identification
• Complete our verification process

**Additional Requirements for Drivers**
• Valid driver's license and clean driving record
• Vehicle registration and current insurance
• Pass our background check and vehicle inspection

**3. Service Description**

RideAlong connects verified college students for ride‑sharing within campus communities. Our platform facilitates cost‑sharing for rides, not commercial transportation services.

**4. User Responsibilities**

• Maintain accurate account information
• Follow all applicable laws and regulations
• Treat other users with respect and courtesy
• Report any safety concerns or violations immediately

**5. Privacy and Data**

Your privacy is important to us. Please review our Privacy Policy to understand how we collect, use, and protect your information.

**6. Limitation of Liability**

RideAlong provides a platform service only. We are not responsible for the actions of drivers or riders, vehicle conditions, or ride outcomes.

**7. Changes to Terms**

We may update these Terms at any time. Continued use constitutes acceptance of any changes.

For questions about these Terms, contact us at legal@ridealong.app`,
        lastUpdated: 'January 2025',
        version: '1.0'
      };
    } else {
      return {
        id: 'privacy',
        title: 'Privacy Policy',
        content: `**Overview**

This Privacy Policy explains how RideAlong collects, uses, and protects your information. By using our app, you agree to the practices described in this policy.

**Information We Collect**

• Account data (name, .edu email, phone number)
• Verification data (student status, government‑issued ID metadata)
• Ride activity (pickup/dropoff locations you enter, dates, preferences)
• Device identifiers and app diagnostics
• Payment‑related identifiers handled via our processor (we do not store full card numbers)

**How We Use Information**

• Provide and improve the RideAlong service
• Verify student eligibility and enhance safety
• Match riders and drivers and facilitate cost‑sharing
• Send important notifications about rides and account updates
• Analyze usage patterns to improve our platform

**Information Sharing**

We do not sell personal information. We share data only:
• With ride participants (name, contact info, limited profile details)
• With our service providers (payment processing, background checks)
• When required by law or to protect safety

**Data Security**

We use industry‑standard encryption and security measures to protect your information.

**Your Rights**

• Access and update your account information
• Delete your account and associated data
• Opt out of non‑essential communications
• Request data portability

**Contact Us**

For privacy questions or requests, contact us at privacy@ridealong.app`,
        lastUpdated: 'January 2025',
        version: '1.0'
      };
    }
  }
}

// Export singleton instance for easy use
export const legalDocumentsService = LegalDocumentsService.getInstance();