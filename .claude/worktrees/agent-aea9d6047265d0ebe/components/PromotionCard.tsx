import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ImageBackground,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Promotion } from '@/types';
import { promotionService } from '@/services/promotions';

interface PromotionCardProps {
  promotion: Promotion;
  onPress: (promotion: Promotion) => void;
  isLoading?: boolean;
  isClaimed?: boolean;
  style?: any;
}

export const PromotionCard: React.FC<PromotionCardProps> = ({
  promotion,
  onPress,
  isLoading = false,
  isClaimed = false,
  style,
}) => {
  const displayValue = promotionService.getPromotionDisplayValue(promotion);
  const isExpiringSoon = promotionService.isExpiringSoon(promotion);
  const daysUntilExpiry = promotionService.getDaysUntilExpiry(promotion);

  // Get just the value with prefix for the large display number
  const getDisplayValueOnly = () => {
    if (promotion.valueType === 'percentage') {
      return `${promotion.value}%`;
    } else {
      // For 'fixed' and 'credit' types, add $ prefix
      return `$${promotion.value}`;
    }
  };

  const getExpiryText = () => {
    if (daysUntilExpiry <= 0) return 'Expired';
    if (daysUntilExpiry === 1) return 'Expires today';
    if (isExpiringSoon) return `${daysUntilExpiry} days left`;
    return `Valid until ${promotion.endDate.toLocaleDateString()}`;
  };

  const getCategoryIcon = () => {
    // Use icon from database if available
    if (promotion.icon) {
      // Map FontAwesome icon names to Ionicons names
      const iconMap: { [key: string]: string } = {
        'fa-user': 'person-outline',
        'fa-users': 'people-outline',
        'fa-gift': 'gift-outline',
        'fa-star': 'star-outline',
        'fa-bolt': 'flash-outline',
        'fa-percent': 'percentage-outline',
        'fa-money-bill-wave': 'cash-outline',
        'fa-car': 'car-outline',
        'fa-award': 'trophy-outline',
        'fa-tag': 'pricetag-outline',
        'fa-info-circle': 'information-circle-outline',
        'fa-cog': 'settings-outline',
        'fa-heart': 'heart-outline',
      };
      
      // Remove 'fas ', 'far ', etc. prefixes if present
      const cleanIcon = promotion.icon.replace(/^(fas|far|fab|fal)\s+/, '');
      
      // Return mapped icon or use the raw value if no mapping exists
      return iconMap[cleanIcon] || 'person-outline';
    }
    
    // Fallback to type-based icons
    switch (promotion.type) {
      case 'discount':
        return 'flash'; // Lightning bolt for discounts (like your orange icon)
      case 'cashback':
        return 'cash-outline';
      case 'referral':
        return 'people-outline';
      case 'reward':
        return 'gift-outline'; // Gift box for rewards (like your blue icon)
      case 'informational':
        return 'person-outline'; // User/profile icon for informational
      default:
        return 'pricetag-outline';
    }
  };

  const renderContent = () => (
    <View style={styles.cardContent}>
      {/* Header with badge */}
      {(promotion.featured || promotion.priority === 1) && (
        <View style={styles.headerBadge}>
          {promotion.featured ? (
            <>
              <Ionicons name="star" size={14} color="#FFD700" />
              <Text style={styles.badgeText}>Featured</Text>
            </>
          ) : (
            <Text style={styles.badgeText}>Hot Deal</Text>
          )}
        </View>
      )}

      {/* Title and discount row */}
      <View style={styles.titleSection}>
        <View style={styles.titleRow}>
          <View style={styles.iconContainer}>
            <Ionicons 
              name={getCategoryIcon() as any} 
              size={18} 
              color={promotion.textColor || '#FFFFFF'} 
            />
          </View>
          <Text 
            style={[
              styles.promotionTitle, 
              { color: promotion.textColor || '#FFFFFF' }
            ]}
            numberOfLines={2}
          >
            {promotion.title}
          </Text>
        </View>
        
        {/* Only show discount for non-informational promotions */}
        {promotion.type !== 'informational' && (
          <View style={styles.discountSection}>
            <Text 
              style={[
                styles.discountValue, 
                { color: promotion.textColor || '#FFFFFF' }
              ]}
            >
              {getDisplayValueOnly()}
            </Text>
          </View>
        )}
      </View>

      {/* Full-width description */}
      <View style={styles.descriptionSection}>
        <Text 
          style={[
            styles.promotionDescription, 
            { color: promotion.textColor ? `${promotion.textColor}CC` : '#FFFFFFCC' }
          ]}
          numberOfLines={3}
        >
          {promotion.description}
        </Text>
      </View>

      {/* Claimed badge */}
      {isClaimed && (
        <View style={styles.claimedBadge}>
          <Ionicons name="checkmark-circle" size={12} color="#10B981" />
          <Text style={styles.claimedText}>Claimed</Text>
        </View>
      )}
    </View>
  );

  return (
    <TouchableOpacity 
      style={[styles.card, style]} 
      onPress={() => onPress(promotion)}
      activeOpacity={0.8}
    >
      {promotion.imageUrl ? (
        <ImageBackground
          source={{ uri: promotion.imageUrl }}
          style={styles.backgroundImage}
          resizeMode="cover"
        >
          <LinearGradient
            colors={[
              `${promotion.backgroundColor}CC`,
              promotion.backgroundColor
            ]}
            style={styles.overlay}
          >
            {renderContent()}
          </LinearGradient>
        </ImageBackground>
      ) : (
        <LinearGradient
          colors={[promotion.backgroundColor, `${promotion.backgroundColor}DD`]}
          style={styles.gradientBackground}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          {renderContent()}
        </LinearGradient>
      )}
    </TouchableOpacity>
  );
};

const { width: screenWidth } = Dimensions.get('window');
const cardWidth = screenWidth - 40; // Full width minus section padding (20px on each side)

const styles = StyleSheet.create({
  card: {
    width: cardWidth,
    height: 120,
    marginRight: 16,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  backgroundImage: {
    width: '100%',
    height: '100%',
  },
  gradientBackground: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    width: '100%',
    height: '100%',
  },
  cardContent: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    justifyContent: 'space-between',
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 8,
  },
  badgeText: {
    marginLeft: 4,
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  titleSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  promotionTitle: {
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 21,
    flex: 1,
  },
  discountSection: {
    alignItems: 'flex-end',
  },
  descriptionSection: {
    width: '100%',
    flex: 1,
  },
  promotionDescription: {
    fontSize: 14,
    lineHeight: 19,
    opacity: 0.85,
    width: '100%',
  },
  discountValue: {
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 30,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  metaRowSolo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    alignSelf: 'flex-end',
    width: '100%',
    marginTop: 10,
  },
  metaText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.9)',
    opacity: 0.9,
    textAlign: 'right',
  },
  
  claimedBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  claimedText: {
    marginLeft: 4,
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

export default PromotionCard;