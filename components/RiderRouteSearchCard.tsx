import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type RiderRoutePayload = {
  pickup: string;
  dropoff: string;
  pickupCoords: { lat: number; lng: number };
  dropoffCoords: { lat: number; lng: number };
  distanceText: string;
  durationText: string;
  minContribution: number | null;
};

export function RiderRouteSearchCard({
  onContinue,
}: {
  onContinue: (route: RiderRoutePayload) => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Where to?</Text>

      <TouchableOpacity
        style={styles.button}
        onPress={() =>
          onContinue({
            pickup: '',
            dropoff: '',
            pickupCoords: { lat: 0, lng: 0 },
            dropoffCoords: { lat: 0, lng: 0 },
            distanceText: '',
            durationText: '',
            minContribution: null,
          })
        }
      >
        <Text style={styles.buttonText}>Continue booking</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 18,
    marginBottom: 18,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0D1B2A',
    marginBottom: 12,
  },
  button: {
    height: 48,
    borderRadius: 16,
    backgroundColor: '#F4621F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
});