import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAppTheme } from '@/hooks/ThemeContext';

const LOGO_LIGHT = require('../assets/logo+text - Edited.png');
const LOGO_DARK  = require('../assets/RideAlongSplashDarkMode - Edited.png');

type SplashScreenProps = {
  animated?: boolean;
};

export default function SplashScreen({ animated = true }: SplashScreenProps) {
  const { isDark: dark } = useAppTheme();

  const opacity  = useRef(new Animated.Value(animated ? 0 : 1)).current;
  const scale    = useRef(new Animated.Value(animated ? 0.1 : 1)).current;
  const breathe  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!animated) return;

    const entrance = Animated.parallel([
      // Snap in fast
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      // Multi-step scale: blast in → overshoot → bounce → settle
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.22,
          duration: 380,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.91,
          duration: 130,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1.07,
          duration: 100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1.0,
          duration: 80,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ]);

    // Noticeable breathe once settled
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1.08,
          duration: 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    entrance.start(() => pulse.start());

    return () => {
      entrance.stop();
      pulse.stop();
    };
  }, [animated, breathe, opacity, scale]);

  const combinedScale = Animated.multiply(scale, breathe);

  return (
    <View style={[styles.container, dark ? styles.containerDark : styles.containerLight]}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Animated.View
        style={{
          opacity,
          transform: [{ scale: combinedScale }],
          alignItems: 'center',
        }}
      >
        <Image
          source={dark ? LOGO_DARK : LOGO_LIGHT}
          style={styles.logo}
          resizeMode="contain"
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  containerLight: {
    backgroundColor: '#FBFAF7',
  },
  containerDark: {
    backgroundColor: '#0B1635',
  },
  logo: {
    width: 260,
    height: 260,
  },
});
