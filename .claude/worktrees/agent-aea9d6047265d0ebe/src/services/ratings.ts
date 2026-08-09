import { collection, doc, documentId, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { firestore } from '@/constants/services';

/**
 * Get driver's cached rating from their profile document (fast path).
 * Falls back to computing from rideRatings if not available.
 * Returns { avg, count } where avg is null if no ratings exist.
 */
export async function computeFilteredAverageRating(
  userId: string
): Promise<{ avg: number | null; count: number | null }> {
  try {
    // Fast path: Use cached rating from driver document
    // This is updated by server-side rating aggregation
    const driverDoc = await getDoc(doc(firestore, 'drivers', userId));
    if (driverDoc.exists()) {
      const data = driverDoc.data();
      const cachedRating = data?.rating;
      const ratingCount = data?.ratingCount || data?.totalRatings || data?.ratingsCount;
      
      if (typeof cachedRating === 'number' && isFinite(cachedRating)) {
        // Return cached rating (much faster than recomputing)
        return { 
          avg: cachedRating, 
          count: typeof ratingCount === 'number' ? ratingCount : null 
        };
      }
    }

    // Fallback: Compute from rideRatings (slow path, only if no cached rating)
    // This should rarely happen since server updates driver.rating on every new rating
    return await computeRatingFromScratch(userId);
  } catch (err) {
    console.warn('[computeFilteredAverageRating] Error:', err);
    return { avg: null, count: null };
  }
}

/**
 * Compute rating from scratch by querying all ratings and validating against confirmed rides.
 * This is slow and should only be used as a fallback when cached rating is unavailable.
 */
async function computeRatingFromScratch(
  userId: string
): Promise<{ avg: number | null; count: number | null }> {
  try {
    const rs = await getDocs(
      query(collection(firestore, 'rideRatings'), where('rateeId', '==', userId), limit(200))
    );
    const ratings = rs.docs.map((d) => d.data() as any);
    if (ratings.length === 0) return { avg: null, count: null };

    const rideIds = Array.from(new Set(ratings.map((r: any) => String(r.rideId)).filter(Boolean)));
    const valid = new Set<string>();
    
    // Query confirmedRides in chunks of 10 (Firestore 'in' query limit)
    for (let i = 0; i < rideIds.length; i += 10) {
      const chunk = rideIds.slice(i, i + 10);
      try {
        const snap = await getDocs(
          query(collection(firestore, 'confirmedRides'), where(documentId(), 'in', chunk)) as any
        );
        snap.forEach((docu) => {
          const data: any = docu.data() || {};
          if (String(data.status || '').toUpperCase() === 'COMPLETED') valid.add(docu.id);
        });
      } catch {
        // ignore chunk errors and continue
      }
    }

    const filtered = ratings.filter(
      (r: any) => valid.has(String(r.rideId)) && typeof r.stars === 'number'
    );
    if (filtered.length === 0) return { avg: null, count: 0 };
    const sum = filtered.reduce((acc: number, r: any) => acc + (Number(r.stars) || 0), 0);
    const avg = sum / filtered.length;
    return { avg, count: filtered.length };
  } catch {
    return { avg: null, count: null };
  }
}
