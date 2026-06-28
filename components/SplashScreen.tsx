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

  const opacity = useRef(new Animated.Value(animated ? 0 : 1)).current;
  const scale   = useRef(new Animated.Value(animated ? 0.1 : 1)).current;

  useEffect(() => {
    if (!animated) return;

    const entrance = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
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

    entrance.start();
    return () => entrance.stop();
  }, [animated, opacity, scale]);

  return (
    <View style={[styles.container, dark ? styles.containerDark : styles.containerLight]}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Animated.View
        style={{
          opacity,
          transform: [{ scale }],
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
