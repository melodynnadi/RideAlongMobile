/**
 * Custom Toast Component for RideAlong Driver App
 * Beautiful animated notification card with RideAlong branding
 */

import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { BaseToast, BaseToastProps } from 'react-native-toast-message';
import { BlurView } from 'expo-blur';

const COLORS = {
  primary: '#E05E1A',
  navy: '#1A2942',
  white: '#F8FAFC',
  success: '#10B981',
  error: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',
};

interface CustomToastProps extends BaseToastProps {
  type: 'success' | 'error' | 'info' | 'warning';
}

export const CustomToast = {
  success: (props: any) => (
    <View style={styles.container}>
      <View style={styles.innerContainer}>
        <View style={styles.contentWrapper}>
          <View style={[styles.iconCircle, { backgroundColor: COLORS.success }]}>
            <Text style={styles.iconText}>✓</Text>
          </View>
          <View style={styles.textContainer}>
            <Text style={styles.title} numberOfLines={1}>
              {props.text1}
            </Text>
            {props.text2 ? (
              <Text style={styles.message} numberOfLines={3}>
                {props.text2}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  ),

  error: (props: any) => (
    <View style={styles.container}>
      <View style={styles.innerContainer}>
        <View style={styles.contentWrapper}>
          <View style={[styles.iconCircle, { backgroundColor: COLORS.error }]}>
            <Text style={styles.iconText}>✕</Text>
          </View>
          <View style={styles.textContainer}>
            <Text style={styles.title} numberOfLines={1}>
              {props.text1}
            </Text>
            {props.text2 ? (
              <Text style={styles.message} numberOfLines={3}>
                {props.text2}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  ),

  info: (props: any) => (
    <View style={styles.container}>
      <View style={styles.innerContainer}>
        <View style={styles.contentWrapper}>
          <View style={[styles.iconCircle, { backgroundColor: 'rgba(255, 255, 255, 0.2)' }]}>
            <Text style={styles.iconText}>ℹ</Text>
          </View>
          <View style={styles.textContainer}>
            <Text style={styles.title} numberOfLines={1}>
              {props.text1}
            </Text>
            {props.text2 ? (
              <Text style={styles.message} numberOfLines={3}>
                {props.text2}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  ),

  warning: (props: any) => (
    <View style={styles.container}>
      <View style={styles.innerContainer}>
        <View style={styles.contentWrapper}>
          <View style={[styles.iconCircle, { backgroundColor: COLORS.warning }]}>
            <Text style={styles.iconText}>⚠</Text>
          </View>
          <View style={styles.textContainer}>
            <Text style={styles.title} numberOfLines={1}>
              {props.text1}
            </Text>
            {props.text2 ? (
              <Text style={styles.message} numberOfLines={3}>
                {props.text2}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  ),
};

const styles = StyleSheet.create({
  container: {
    width: '95%',
    marginTop: 8,
    marginHorizontal: '2.5%',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  innerContainer: {
    backgroundColor: COLORS.navy,
    borderRadius: 14,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  leftAccent: {
    width: 4,
  },
  contentWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    paddingLeft: 10,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  iconText: {
    fontSize: 18,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  logoImage: {
    width: 32,
    height: 32,
  },
  textContainer: {
    flex: 1,
    paddingRight: 4,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
    letterSpacing: 0.1,
  },
  message: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.9)',
    lineHeight: 17,
    fontWeight: '500',
  },
});
