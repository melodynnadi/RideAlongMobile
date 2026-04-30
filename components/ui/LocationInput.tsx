import React from 'react';
import { View } from 'react-native';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import { MapPin } from 'lucide-react-native';
import { useTheme } from '@/hooks/useTheme';

interface LocationInputProps {
  placeholder: string;
  onLocationSelect: (location: {
    latitude: number;
    longitude: number;
    address: string;
    placeId?: string;
  }) => void;
  value?: string;
}

export function LocationInput({ 
  placeholder, 
  onLocationSelect, 
  value 
}: LocationInputProps) {
  const theme = useTheme();

  return (
    <View style={{ flex: 1 }}>
      <GooglePlacesAutocomplete
        placeholder={placeholder}
        onPress={(data, details = null) => {
          if (details) {
            onLocationSelect({
              latitude: details.geometry.location.lat,
              longitude: details.geometry.location.lng,
              address: data.description,
              placeId: data.place_id,
            });
          }
        }}
        query={{
          key: process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY,
          language: 'en',
          types: 'establishment',
        }}
        fetchDetails={true}
        textInputProps={{
          value,
          style: {
            backgroundColor: theme.colors.card,
            borderWidth: 1,
            borderColor: theme.colors.muted + '30',
            borderRadius: theme.borderRadius.xl,
            color: theme.colors.text,
            fontSize: 16,
            paddingVertical: theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
            paddingLeft: theme.spacing.xl + theme.spacing.md,
            minHeight: 48,
          },
          placeholderTextColor: theme.colors.muted,
        }}
        styles={{
          container: {
            flex: 1,
          },
          listView: {
            backgroundColor: theme.colors.card,
            borderRadius: theme.borderRadius.xl,
            marginTop: theme.spacing.xs,
            ...theme.shadows.md,
          },
          row: {
            backgroundColor: theme.colors.card,
            padding: theme.spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.muted + '20',
          },
          description: {
            color: theme.colors.text,
            fontSize: 14,
          },
          separator: {
            backgroundColor: theme.colors.muted + '20',
            height: 1,
          },
        }}
        renderLeftButton={() => (
          <View style={{
            position: 'absolute',
            left: theme.spacing.md,
            top: '50%',
            transform: [{ translateY: -12 }],
            zIndex: 1,
          }}>
            <MapPin size={20} color={theme.colors.muted} />
          </View>
        )}
        enablePoweredByContainer={false}
        debounce={300}
      />
    </View>
  );
}
