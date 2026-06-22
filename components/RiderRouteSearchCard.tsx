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
  const continueWithDemoRoute = () =>
    onContinue({
      pickup: 'Austin, TX',
      dropoff: 'Houston, TX',
      pickupCoords: { lat: 30.2672, lng: -97.7431 },
      dropoffCoords: { lat: 29.7604, lng: -95.3698 },
      distanceText: '165 mi',
      durationText: '~2h 40m',
      minContribution: 28,
    });

  return (
    <View style={styles.card}>
      <View style={styles.routeBox}>
        <View style={styles.rail}>
          <View style={styles.pickupDot} />
          <View style={styles.line} />
          <View style={styles.dropoffDot} />
        </View>

        <View style={styles.fields}>
          <TouchableOpacity style={styles.field} activeOpacity={0.86} onPress={continueWithDemoRoute}>
            <Text style={styles.fieldText}>Austin, TX</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.field} activeOpacity={0.86} onPress={continueWithDemoRoute}>
            <Text style={styles.fieldText}>Houston, TX</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.metaRow}>
        <TouchableOpacity style={styles.metaPill} activeOpacity={0.86} onPress={continueWithDemoRoute}>
          <Text style={styles.metaText}>Fri, Nov 20</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.metaPill} activeOpacity={0.86} onPress={continueWithDemoRoute}>
          <Text style={styles.metaText}>Anytime</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.button}
        onPress={continueWithDemoRoute}
      >
        <Text style={styles.buttonText}>{'Find a ride ->'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 18,
    marginBottom: 18,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#0D1B48',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
  },
  routeBox: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  rail: {
    width: 22,
    alignItems: 'center',
    paddingTop: 15,
    paddingBottom: 15,
  },
  pickupDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0D1B48',
  },
  dropoffDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E95E15',
  },
  line: {
    width: 1,
    flex: 1,
    marginVertical: 7,
    borderLeftWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
  },
  fields: {
    flex: 1,
    gap: 7,
  },
  field: {
    minHeight: 34,
    borderWidth: 1,
    borderColor: '#D7DDE5',
    borderRadius: 9,
    justifyContent: 'center',
    paddingHorizontal: 13,
    backgroundColor: '#FFFFFF',
  },
  fieldText: {
    color: '#17233C',
    fontSize: 13,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
    paddingLeft: 22,
  },
  metaPill: {
    flex: 1,
    minHeight: 34,
    borderWidth: 1,
    borderColor: '#D7DDE5',
    borderRadius: 9,
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
  },
  metaText: {
    color: '#17233C',
    fontSize: 12,
    fontWeight: '600',
  },
  button: {
    height: 44,
    borderRadius: 22,
    backgroundColor: '#DE5D20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});
