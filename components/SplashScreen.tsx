import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Image } from 'react-native';

interface SplashScreenProps {
  onLoadingComplete?: () => void;
}

export default function SplashScreen({ onLoadingComplete }: SplashScreenProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    // Simple entrance animation
    const animation = Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]);

    animation.start();

    // Auto-complete after 3 seconds
    const timer = setTimeout(() => {
      onLoadingComplete?.();
    }, 3000);

    return () => {
      animation.stop();
      clearTimeout(timer);
    };
  }, [fadeAnim, scaleAnim, onLoadingComplete]);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {/* Logo and Text Layout matching web app */}
        <View style={styles.logoContainer}>
          <Image 
            source={require('../assets/images/RideAlongWebLogo.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
          <Text style={styles.logoText}>RideAlong</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  logoImage: {
    width: 40,
    height: 40,
  },
  logoText: {
    fontSize: 42,
    fontWeight: '800',
    color: '#E05E1A',
  },
});