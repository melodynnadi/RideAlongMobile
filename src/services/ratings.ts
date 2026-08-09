import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { firestore } from '@/constants/services';

export async function hasUserRatedRide(rideId: string, userId: string): Promise<boolean> {
  if (!rideId || !userId) return false;
  try {
    const rating = await getDoc(doc(firestore, 'rideRatings', `${rideId}_${userId}`));
    return rating.exists();
  } catch {
    return false;
  }
}

export async function findPendingRatingRide(
  userId: string,
  role: 'rider' | 'driver',
): Promise<string | null> {
  if (!userId) return null;

  const roleField = role === 'rider' ? 'riderId' : 'driverId';
  const ratedField = role === 'rider' ? 'riderRated' : 'driverRated';

  const load = async (useOrder: boolean) => {
    const parts = [
      collection(firestore, 'confirmedRides'),
      where(roleField, '==', userId),
      where('status', 'in', ['COMPLETED', 'completed']),
    ] as any[];
    if (useOrder) parts.push(orderBy('completedAt', 'desc'));
    parts.push(limit(25));
    return getDocs(query.apply(null, parts as any));
  };

  let snapshot;
  try {
    snapshot = await load(true);
  } catch {
    snapshot = await load(false);
  }

  const rides = snapshot.docs
    .map((ride) => ({ id: ride.id, data: ride.data() as any }))
    .sort((a, b) => {
      const at = a.data?.completedAt?.toMillis?.() ?? a.data?.updatedAt?.toMillis?.() ?? a.data?.createdAt?.toMillis?.() ?? 0;
      const bt = b.data?.completedAt?.toMillis?.() ?? b.data?.updatedAt?.toMillis?.() ?? b.data?.createdAt?.toMillis?.() ?? 0;
      return bt - at;
    });

  for (const ride of rides) {
    if (ride.data?.[ratedField] === true) continue;
    const alreadyRated = await hasUserRatedRide(ride.id, userId);
    if (!alreadyRated) return ride.id;
  }

  return null;
}

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
          // Only count rides where this user was the driver, not rides where they were the rider
          if (String(data.status || '').toUpperCase() === 'COMPLETED' && String(data.driverId) === userId) valid.add(docu.id);
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
