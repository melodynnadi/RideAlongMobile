// Sample promotion data to add to Firestore for testing
// Collection: promotions
// Add these documents to test the promotions feature

export const samplePromotions = [
  // 1. Weekend Warrior Bonus
  {
    title: "Weekend Warrior Bonus",
    description: "Complete 15 rides this weekend and earn a $75 bonus! Available Saturday and Sunday only.",
    category: "weekend-bonus",
    categoryName: "Weekend Specials",
    target: "drivers",
    platforms: ["mobile"],
    type: "bonus",
    value: 75,
    valueType: "fixed_amount",
    
    conditions: {
      minRides: 15,
      timeRange: {
        start: "00:00",
        end: "23:59"
      },
      dayOfWeek: ["saturday", "sunday"]
    },
    
    usageLimit: 1,
    totalUsageLimit: 100,
    currentUsageCount: 23,
    
    // Update these dates to be current/future
    startDate: "2024-12-21T00:00:00.000Z",
    endDate: "2024-12-22T23:59:59.000Z",
    
    backgroundColor: "#4CAF50",
    textColor: "#FFFFFF",
    priority: 1,
    featured: true,
    status: "active",
    
    termsAndConditions: "Bonus paid within 48 hours of completion. Must complete all 15 rides between Saturday 12:00 AM and Sunday 11:59 PM. Rides must be completed within service area.",
    requiresActivation: false
  },

  // 2. Refer a Driver
  {
    title: "Refer New Drivers",
    description: "Earn $100 for each new driver you refer! They get $50 signup bonus too.",
    category: "referral",
    categoryName: "Referral Program",
    target: "drivers",
    platforms: ["mobile", "web"],
    type: "referral",
    value: 100,
    valueType: "fixed_amount",
    
    usageLimit: 10,
    
    startDate: "2024-12-01T00:00:00.000Z",
    endDate: "2025-03-31T23:59:59.000Z",
    
    backgroundColor: "#6B46C1",
    textColor: "#FFFFFF",
    priority: 2,
    featured: true,
    status: "active",
    
    termsAndConditions: "Referred driver must complete 20 rides within their first 30 days. Bonus paid after referee completes requirement. Valid for drivers who sign up using your referral link.",
    requiresActivation: false
  },

  // 3. Prime Time Surge
  {
    title: "Prime Time Surge",
    description: "Earn 50% extra on rides between 7-9 AM and 5-7 PM on weekdays!",
    category: "surge",
    categoryName: "Surge Pricing",
    target: "drivers",
    platforms: ["mobile"],
    type: "bonus",
    value: 50,
    valueType: "percentage",
    
    conditions: {
      timeRange: {
        start: "07:00",
        end: "09:00"
      },
      dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"]
    },
    
    startDate: "2024-12-15T00:00:00.000Z",
    endDate: "2025-01-15T23:59:59.000Z",
    
    backgroundColor: "#F59E0B",
    textColor: "#FFFFFF",
    priority: 3,
    featured: false,
    status: "active",
    
    termsAndConditions: "Applies to rides completed during specified hours. Bonus calculated on base fare only. Valid Monday-Friday, 7-9 AM and 5-7 PM.",
    requiresActivation: false
  },

  // 4. New Driver Welcome
  {
    title: "New Driver Welcome Bonus",
    description: "Complete your first 10 rides and get a $50 bonus! Plus keep 100% of your earnings.",
    category: "new-driver",
    categoryName: "New Driver",
    target: "drivers",
    platforms: ["mobile"],
    type: "bonus",
    value: 50,
    valueType: "fixed_amount",
    
    conditions: {
      minRides: 10,
      maxRides: 10
    },
    
    usageLimit: 1,
    
    startDate: "2024-12-01T00:00:00.000Z",
    endDate: "2025-06-30T23:59:59.000Z",
    
    backgroundColor: "#E05E1A",
    textColor: "#FFFFFF",
    priority: 1,
    featured: true,
    status: "active",
    
    termsAndConditions: "Available to drivers who signed up within the last 30 days. Must complete 10 rides within first 14 days of activation. Bonus paid immediately after 10th ride completion.",
    requiresActivation: true
  },

  // 5. Tyler City Special
  {
    title: "Tyler City Bonus",
    description: "Extra $5 per ride in Tyler this month! Help us grow in your city.",
    category: "city-expansion",
    categoryName: "City Expansion",
    target: "drivers",
    platforms: ["mobile"],
    type: "bonus",
    value: 5,
    valueType: "fixed_amount",
    
    conditions: {
      specificCities: ["Tyler"]
    },
    
    totalUsageLimit: 500,
    currentUsageCount: 178,
    
    startDate: "2024-12-01T00:00:00.000Z",
    endDate: "2024-12-31T23:59:59.000Z",
    
    backgroundColor: "#059669",
    textColor: "#FFFFFF",
    priority: 4,
    featured: false,
    status: "active",
    
    termsAndConditions: "Applies to rides with pickup or dropoff in Tyler city limits. Bonus per completed ride. Limited to first 500 rides.",
    requiresActivation: false
  },

  // 6. Eco-Friendly Vehicle Incentive
  {
    title: "Go Green, Earn More",
    description: "Drive an electric or hybrid vehicle? Get 15% extra earnings on every ride!",
    category: "eco",
    categoryName: "Green Initiative",
    target: "drivers",
    platforms: ["mobile"],
    type: "bonus",
    value: 15,
    valueType: "percentage",
    
    conditions: {
      vehicleTypes: ["electric", "hybrid"]
    },
    
    startDate: "2024-12-01T00:00:00.000Z",
    endDate: "2025-12-31T23:59:59.000Z",
    
    backgroundColor: "#10B981",
    textColor: "#FFFFFF",
    priority: 5,
    featured: false,
    status: "active",
    
    termsAndConditions: "Vehicle must be registered as electric or hybrid in your driver profile. Bonus applies to all completed rides. Ongoing promotion for eco-friendly drivers.",
    requiresActivation: false
  },

  // 7. Holiday Rush Bonus
  {
    title: "Holiday Rush - Triple Earnings",
    description: "Drive during the holidays and earn 3x on all rides Dec 23-26!",
    category: "holiday",
    categoryName: "Holiday Special",
    target: "both",
    platforms: ["mobile", "web"],
    type: "bonus",
    value: 3,
    valueType: "multiplier",
    
    conditions: {
      timeRange: {
        start: "00:00",
        end: "23:59"
      }
    },
    
    startDate: "2024-12-23T00:00:00.000Z",
    endDate: "2024-12-26T23:59:59.000Z",
    
    backgroundColor: "#DC2626",
    textColor: "#FFFFFF",
    priority: 1,
    featured: true,
    status: "active",
    
    termsAndConditions: "3x earnings on base fare only. Valid Dec 23-26, all day. No limit on number of rides. Help riders get to their holiday destinations!",
    requiresActivation: false
  },

  // 8. No Commission Week
  {
    title: "0% Commission This Week",
    description: "Keep 100% of your earnings! We're waiving all platform fees this week.",
    category: "special",
    categoryName: "Special Offer",
    target: "drivers",
    platforms: ["mobile"],
    type: "discount",
    value: 100,
    valueType: "percentage",
    
    startDate: "2024-12-16T00:00:00.000Z",
    endDate: "2024-12-22T23:59:59.000Z",
    
    backgroundColor: "#8B5CF6",
    textColor: "#FFFFFF",
    priority: 1,
    featured: true,
    status: "active",
    
    termsAndConditions: "Platform commission fee waived for all completed rides. Standard payment processing fees still apply. Valid for one week only.",
    requiresActivation: false
  }
];

// Instructions to add to Firestore:
// 1. Go to Firebase Console > Firestore Database
// 2. Create collection "promotions" if it doesn't exist
// 3. Add each promotion as a new document
// 4. Copy the entire object (excluding comments)
// 5. Update startDate and endDate to current/future dates
// 6. Set status to "active"
// 7. Save the document

// Note: You can use Firebase Admin SDK or manually add through Firebase Console
