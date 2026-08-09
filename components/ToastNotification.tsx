// ToastNotification Component for React Native
import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ToastProps {
  visible: boolean;
  title: string;
  message: string;
  onDismiss: () => void;
  onPress?: () => void;
  duration?: number;
}

export default function ToastNotification({
  visible,
  title,
  message,
  onDismiss,
  onPress,
  duration = 4000,
}: ToastProps) {
  const translateY = useRef(new Animated.Value(-100)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.timing(translateY, {
      toValue: -100,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      onDismiss();
    });
  }, [onDismiss, translateY]);

  useEffect(() => {
    if (visible) {
      // Slide in
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 50,
        friction: 8,
      }).start();

      // Auto dismiss
      timerRef.current = setTimeout(() => {
        hide();
      }, duration);
    } else {
      // Slide out
      Animated.timing(translateY, {
        toValue: -100,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [visible, duration, hide, translateY]);

  const handlePress = () => {
    hide();
    if (onPress) {
      onPress();
    }
  };

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateY }],
        },
      ]}
    >
      <TouchableOpacity
        style={styles.toast}
        onPress={handlePress}
        activeOpacity={0.9}
      >
        <View style={styles.iconContainer}>
          <Ionicons name="chatbubbles" size={24} color="#E05E1A" />
        </View>
        <View style={styles.content}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message} numberOfLines={2}>
            {message}
          </Text>
        </View>
        <TouchableOpacity style={styles.closeButton} onPress={hide}>
          <Ionicons name="close" size={20} color="#9ca3af" />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    zIndex: 9999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#E05E1A',
  },
  iconContainer: {
    marginRight: 12,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 2,
  },
  message: {
    fontSize: 13,
    color: '#6b7280',
  },
  closeButton: {
    padding: 4,
    marginLeft: 8,
  },
});
