import React from 'react';
import { TextInput, TextInputProps, View, Text, ViewStyle } from 'react-native';
import { useTheme } from '@/hooks/useTheme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export function Input({ 
  label, 
  error, 
  icon, 
  size = 'md', 
  style, 
  ...props 
}: InputProps) {
  const theme = useTheme();

  const getSizeStyles = () => {
    const sizes = {
      sm: {
        fontSize: 14,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        minHeight: 36,
      },
      md: {
        fontSize: 16,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        minHeight: 48,
      },
      lg: {
        fontSize: 18,
        paddingVertical: theme.spacing.lg,
        paddingHorizontal: theme.spacing.xl,
        minHeight: 56,
      },
    };
    return sizes[size];
  };

  const inputStyles = {
  backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: error ? theme.colors.error : theme.colors.muted + '30',
    borderRadius: theme.borderRadius.xl,
  color: theme.colors.secondary,
    ...getSizeStyles(),
  };

  return (
  <View style={{ marginBottom: theme.spacing.sm }}>
      {label && (
        <Text style={{
          color: "#e0e0e0d3",
          fontSize: 15,
          fontWeight: '600',
          marginBottom: theme.spacing.xs,
        }}>
          {label}
        </Text>
      )}
      <View style={{ position: 'relative' }}>
        {icon && (
          <View style={{
            position: 'absolute',
            left: theme.spacing.md,
            top: '50%',
            transform: [{ translateY: -12 }],
            zIndex: 1,
          }}>
            {icon}
          </View>
        )}
        <TextInput
          style={[
            inputStyles,
            ...(icon ? [{ paddingLeft: theme.spacing.xl + theme.spacing.md }] : []),
            style,
          ]}
          placeholderTextColor={theme.colors.muted}
          {...props}
        />
      </View>
      {error && (
        <Text style={{
          color: theme.colors.error,
          fontSize: 12,
          marginTop: theme.spacing.xs,
        }}>
          {error}
        </Text>
      )}
    </View>
  );
}
