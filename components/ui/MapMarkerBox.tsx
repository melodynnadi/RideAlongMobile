import type { ReactNode } from 'react';
import { PixelRatio, Platform, View } from 'react-native';

// react-native-maps 1.20 on Android's new architecture never learns a marker's size, so it draws
// every custom marker into a 100x100 pixel bitmap: small ones land off-centre and big ones are
// cut off on high-density screens. This fills that bitmap exactly and scales the content to fit.
const BITMAP_DP = 100 / PixelRatio.get();

/** `size` is the content's width/height; `align` should match the marker's anchor. */
export function MapMarkerBox({ size, align = 'center', children }: {
  size: number;
  align?: 'center' | 'bottom';
  children: ReactNode;
}) {
  if (Platform.OS !== 'android') return <>{children}</>;
  return (
    <View
      collapsable={false}
      style={{
        width: BITMAP_DP,
        height: BITMAP_DP,
        alignItems: 'center',
        justifyContent: align === 'bottom' ? 'flex-end' : 'center',
      }}
    >
      <View
        collapsable={false}
        style={{ flexShrink: 0, transformOrigin: align, transform: [{ scale: Math.min(1, BITMAP_DP / size) }] }}
      >
        {children}
      </View>
    </View>
  );
}
