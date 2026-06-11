import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Share,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Promotion } from '@/types';
import { promotionService } from '@/services/promotions';
import * as Notifications from 'expo-notifications';

interface PromotionDetailsModalProps {
  visible: boolean;
  promotion: Promotion | null;
  onClose: () => void;
  onClaim: (promotionId: string) => void;
  isClaimed: boolean;
  isLoading?: boolean;
}

export const PromotionDetailsModal: React.FC<PromotionDetailsModalProps> = ({
  visible,
  promotion,
  onClose,
  onClaim,
  isClaimed,
  isLoading = false,
}) => {
  if (!promotion) return null;

  const displayValue = promotionService.getPromotionDisplayValue(promotion);
  const isExpiringSoon = promotionService.isExpiringSoon(promotion);
  const daysUntilExpiry = promotionService.getDaysUntilExpiry(promotion);
  const p = promotion as any; // for fields not yet in the Promotion type

  const getDisplayValueOnly = () => {
    if (promotion.valueType === 'percentage') return `${promotion.value}%`;
    return `$${promotion.value}`;
  };

  const getExpiryText = () => {
    if (daysUntilExpiry <= 0) return 'Expired';
    if (daysUntilExpiry === 1) return 'Expires today';
    if (isExpiringSoon) return `Expires in ${daysUntilExpiry} days`;
    return `Valid until ${new Date(promotion.endDate).toLocaleDateString()}`;
  };

  const getCategoryIcon = () => {
    if (promotion.icon) {
      const iconMap: { [key: string]: string } = {
        'fa-user': 'person',
        'fa-users': 'people',
        'fa-gift': 'gift',
        'fa-star': 'star',
        'fa-bolt': 'flash',
        'fa-percent': 'percent',
        'fa-money-bill-wave': 'cash',
        'fa-car': 'car',
        'fa-award': 'trophy',
        'fa-tag': 'pricetag',
        'fa-info-circle': 'information-circle',
        'fa-cog': 'settings',
        'fa-heart': 'heart',
      };
      const cleanIcon = promotion.icon.replace(/^(fas|far|fab|fal)\s+/, '');
      return iconMap[cleanIcon] || 'person';
    }
    switch (promotion.type as string) {
      case 'discount':    return 'pricetag';
      case 'cashback':    return 'cash';
      case 'referral':    return 'people';
      case 'reward':      return 'gift';
      case 'informational': return 'person';
      default:            return 'pricetag';
    }
  };

  const handleShare = async () => {
    try {
      const message = promotion.type === 'informational'
        ? `${promotion.title}\n\n${promotion.description}\n\nCheck out RideAlong for more info!`
        : `Check out this offer on RideAlong: ${promotion.title}\n\nGet ${displayValue} off your next ride!\n\n${promotion.description}`;
      await Share.share({ message, title: promotion.title });
    } catch (error) {
      console.error('Error sharing promotion:', error);
    }
  };

  const handleSetReminder = async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Please enable notifications to set reminders for promotions.',
          [{ text: 'OK' }]
        );
        return;
      }

      const reminderDate = new Date();
      if (promotion.type === 'informational') {
        reminderDate.setDate(reminderDate.getDate() + 1);
        reminderDate.setHours(10, 0, 0, 0);
      } else {
        const expiryDate = new Date(promotion.endDate);
        reminderDate.setTime(expiryDate.getTime() - 24 * 60 * 60 * 1000);
        reminderDate.setHours(10, 0, 0, 0);
      }

      const secondsUntil = Math.max(60, Math.floor((reminderDate.getTime() - Date.now()) / 1000));

      await Notifications.scheduleNotificationAsync({
        content: {
          title: promotion.type === 'informational' ? 'Reminder' : 'Promotion Expiring Soon!',
          body: promotion.type === 'informational'
            ? `Don't forget: ${promotion.title}`
            : `Your ${displayValue} offer expires soon! Don't miss out.`,
          data: { promotionId: promotion.id },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: secondsUntil,
          repeats: false,
        },
      });

      Alert.alert(
        'Reminder Set',
        `You'll be reminded about this ${promotion.type === 'informational' ? 'info' : 'offer'} on ${reminderDate.toLocaleDateString()}.`,
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('Error setting reminder:', error);
      Alert.alert('Error', 'Failed to set reminder. Please try again.');
    }
  };

  const renderContent = () => (
    <>
      {/* Top colored section */}
      <View style={[styles.topSection, { backgroundColor: promotion.backgroundColor || '#F4621F' }]}>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </TouchableOpacity>

        {promotion.type !== 'informational' && (
          <View style={styles.valueBadge}>
            <Text style={styles.valueBadgeText}>
              {promotion.valueType === 'percentage'
                ? `+${promotion.value}% BONUS`
                : `+${getDisplayValueOnly()} BONUS`}
            </Text>
          </View>
        )}

        <View style={styles.iconContainer}>
          <Ionicons name={getCategoryIcon() as any} size={56} color="#FFFFFF" />
        </View>

        {promotion.type !== 'informational' && (
          <Text style={styles.largeValue}>{getDisplayValueOnly()}</Text>
        )}

        <Text style={styles.mainTitle}>{promotion.title}</Text>

        {promotion.type !== 'informational' && (isExpiringSoon || daysUntilExpiry <= 0) && (
          <View style={styles.expiryBadge}>
            <Ionicons name="time" size={16} color="#FFFFFF" />
            <Text style={styles.expiryBadgeText}>
              {daysUntilExpiry <= 0 ? 'EXPIRED!' : 'EXPIRES TODAY!'}
            </Text>
          </View>
        )}
      </View>

      {/* Scrollable body */}
      <ScrollView style={styles.bottomSection} showsVerticalScrollIndicator={false}>
        <View style={styles.aboutSection}>
          <Text style={styles.sectionTitle}>About this offer</Text>
          <Text style={styles.descriptionText}>{promotion.description}</Text>
        </View>

        {promotion.type !== 'informational' && (
          <View style={styles.validPeriodSection}>
            <Ionicons name="calendar-outline" size={24} color="#6B7280" />
            <View style={styles.validPeriodText}>
              <Text style={styles.validPeriodLabel}>Valid Period</Text>
              <Text style={styles.validPeriodDates}>
                {new Date(promotion.startDate).toLocaleDateString()} –{' '}
                {new Date(promotion.endDate).toLocaleDateString()}
              </Text>
              <Text style={styles.validPeriodExpiry}>{getExpiryText()}</Text>
            </View>
          </View>
        )}

        {(p.minOrderAmount || p.maxDiscount || p.code) && (
          <View style={styles.additionalDetails}>
            {p.code && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Promo Code</Text>
                <Text style={styles.detailValue}>{p.code}</Text>
              </View>
            )}
            {p.minOrderAmount && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Minimum Order</Text>
                <Text style={styles.detailValue}>${p.minOrderAmount}</Text>
              </View>
            )}
            {p.maxDiscount && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Maximum Discount</Text>
                <Text style={styles.detailValue}>${p.maxDiscount}</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Action buttons */}
      <View style={styles.actionSection}>
        {promotion.type !== 'informational' && (
          isClaimed ? (
            <View style={styles.claimedContainer}>
              <Ionicons name="checkmark-circle" size={24} color="#10B981" />
              <Text style={styles.claimedText}>Already Claimed</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.claimButton, { opacity: isLoading ? 0.7 : 1 }]}
              onPress={() => onClaim(promotion.id)}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={24} color="#FFFFFF" />
                  <Text style={styles.claimButtonText}>Claim Offer</Text>
                </>
              )}
            </TouchableOpacity>
          )
        )}

        <View style={styles.secondaryActions}>
          <TouchableOpacity style={styles.secondaryButton} onPress={handleShare}>
            <Ionicons name="share-outline" size={20} color="#6B7280" />
            <Text style={styles.secondaryButtonText}>Share</Text>
          </TouchableOpacity>
          <View style={styles.actionDivider} />
          <TouchableOpacity style={styles.secondaryButton} onPress={handleSetReminder}>
            <Ionicons name="alarm-outline" size={20} color="#6B7280" />
            <Text style={styles.secondaryButtonText}>Set Reminder</Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          {renderContent()}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet:          { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%' },
  topSection:          { paddingTop: 24, paddingHorizontal: 20, paddingBottom: 32, alignItems: 'center', position: 'relative', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  closeButton:         { position: 'absolute', top: 12, right: 12, zIndex: 10, padding: 8, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 20, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  valueBadge:          { backgroundColor: 'rgba(255,255,255,0.25)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginBottom: 24 },
  valueBadgeText:      { color: '#FFFFFF', fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  iconContainer:       { width: 96, height: 96, borderRadius: 48, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  largeValue:          { fontSize: 56, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 8 },
  mainTitle:           { fontSize: 24, fontWeight: 'bold', color: '#FFFFFF', textAlign: 'center', marginBottom: 16 },
  expiryBadge:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EF4444', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, marginTop: 8 },
  expiryBadgeText:     { color: '#FFFFFF', fontSize: 16, fontWeight: '700', marginLeft: 6, letterSpacing: 0.5 },
  bottomSection:       { backgroundColor: '#FFFFFF', maxHeight: 400 },
  aboutSection:        { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  sectionTitle:        { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 12 },
  descriptionText:     { fontSize: 15, lineHeight: 22, color: '#6B7280' },
  validPeriodSection:  { flexDirection: 'row', paddingHorizontal: 24, paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  validPeriodText:     { flex: 1, marginLeft: 16 },
  validPeriodLabel:    { fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: 4 },
  validPeriodDates:    { fontSize: 14, color: '#6B7280', marginBottom: 4 },
  validPeriodExpiry:   { fontSize: 13, color: '#9CA3AF' },
  additionalDetails:   { paddingHorizontal: 24, paddingTop: 20 },
  detailItem:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  detailLabel:         { fontSize: 15, color: '#6B7280' },
  detailValue:         { fontSize: 15, fontWeight: '600', color: '#111827' },
  actionSection:       { backgroundColor: '#FFFFFF', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40, borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  claimButton:         { flexDirection: 'row', backgroundColor: '#F4621F', paddingVertical: 18, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 12, gap: 8 },
  claimButtonText:     { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  secondaryActions:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  secondaryButton:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  secondaryButtonText: { marginLeft: 8, fontSize: 15, color: '#6B7280', fontWeight: '500' },
  actionDivider:       { width: 1, height: 24, backgroundColor: '#E5E7EB' },
  claimedContainer:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#D1FAE5', paddingVertical: 18, borderRadius: 12, marginBottom: 12 },
  claimedText:         { marginLeft: 8, fontSize: 18, fontWeight: '700', color: '#10B981' },
});

export default PromotionDetailsModal;