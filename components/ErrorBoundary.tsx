import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

const NAVY   = '#15233A';
const ORANGE = '#DE5D20';
const BG     = '#FBFAF7';
const BORDER = '#E5E0D8';
const MUTED  = '#8B94A6';

export type RouteErrorFallbackProps = { error: Error; retry: () => void };

// Exported for expo-router route-level error boundaries (named export `ErrorBoundary` in layout files)
export function RouteErrorFallback({ error, retry }: RouteErrorFallbackProps) {
  const goBack = () => {
    try {
      if (router.canGoBack()) { router.back(); } else { router.replace('/' as any); }
    } catch {}
  };

  return (
    <View style={s.wrap}>
      <Ionicons name="alert-circle-outline" size={52} color={MUTED} />
      <Text style={s.title}>Something went wrong</Text>
      <Text style={s.msg} numberOfLines={4}>
        {error?.message || 'An unexpected error occurred. Please try again.'}
      </Text>
      <TouchableOpacity style={s.primary} onPress={retry} activeOpacity={0.8}>
        <Text style={s.primaryText}>Try again</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.secondary} onPress={goBack} activeOpacity={0.8}>
        <Text style={s.secondaryText}>Go back</Text>
      </TouchableOpacity>
    </View>
  );
}

interface Props  { children: React.ReactNode }
interface State  { hasError: boolean; error: Error | null }

// Class-based wrapper for top-level and programmatic use
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(_error: Error, _info: React.ErrorInfo) {}

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      return <RouteErrorFallback error={this.state.error!} retry={this.reset} />;
    }
    return this.props.children;
  }
}

const s = StyleSheet.create({
  wrap:          { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  title:         { color: NAVY, fontSize: 20, fontWeight: '700', marginTop: 8, textAlign: 'center' },
  msg:           { color: MUTED, fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 8 },
  primary:       { height: 50, borderRadius: 25, backgroundColor: ORANGE, paddingHorizontal: 32, alignItems: 'center', justifyContent: 'center', width: '100%' },
  primaryText:   { color: '#FFF', fontSize: 15, fontWeight: '700' },
  secondary:     { height: 44, borderRadius: 22, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center', width: '100%' },
  secondaryText: { color: NAVY, fontSize: 14, fontWeight: '600' },
});
