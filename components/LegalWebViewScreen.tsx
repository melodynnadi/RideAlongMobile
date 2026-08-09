import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';

import { useAppTheme } from '@/hooks/ThemeContext';
import { hitSlop } from '@/theme/designSystem';

type LegalWebViewScreenProps = {
  title: string;
  url: string;
};

export function LegalWebViewScreen({ title, url }: LegalWebViewScreenProps) {
  const { colors } = useAppTheme();
  const [loading, setLoading] = useState(true);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'left', 'right']}>
      <StatusBar style={colors.statusBar === 'light-content' ? 'light' : 'dark'} />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.backButton, { borderColor: colors.border, backgroundColor: colors.bgCard }]}
          onPress={() => router.back()}
          hitSlop={hitSlop}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
          {title}
        </Text>
      </View>

      <View style={styles.body}>
        {loading ? (
          <View style={[StyleSheet.absoluteFillObject, styles.loading, { backgroundColor: colors.bg }]}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : null}
        <WebView
          source={{ uri: url }}
          style={[styles.webView, { backgroundColor: colors.bg }, loading && { opacity: 0 }]}
          onLoadEnd={() => setLoading(false)}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  body: { flex: 1 },
  loading: { alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  webView: { flex: 1 },
});
