import React, { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

export default function SplashScreen() {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.94)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const intro = Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 420,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 70,
        friction: 8,
        useNativeDriver: true,
      }),
    ]);

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );

    intro.start();
    pulse.start();

    return () => {
      intro.stop();
      pulse.stop();
    };
  }, [fadeAnim, glowAnim, scaleAnim]);

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <Animated.View
        style={[
          styles.glow,
          {
            opacity: glowAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0.16, 0.3],
            }),
            transform: [{
              scale: glowAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.92, 1.08],
              }),
            }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <Image
          source={require('../assets/logo+text - Edited.png')}
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
    backgroundColor: '#FBFAF7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  glow: {
    position: 'absolute',
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: '#E05E1A',
  },
  content: {
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 42,
  },
  logo: {
    width: '100%',
    maxWidth: 320,
    height: 92,
  },
});
