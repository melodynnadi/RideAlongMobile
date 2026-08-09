import React from 'react';
import { View } from 'react-native';

export const PROVIDER_GOOGLE = undefined;

export default function WebMapView({ children, style }: any) {
  return <View style={style}>{children}</View>;
}

export function Marker({ children }: any) {
  return <>{children}</>;
}

export function Circle() {
  return null;
}

export function Polyline() {
  return null;
}
