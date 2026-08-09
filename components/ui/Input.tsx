import React, { useState } from 'react';
import { TextInput, TextInputProps, View, Text } from 'react-native';
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
  const [focused, setFocused] = useState(false);

  const getSizeStyles = () => {
    const sizes = {
      sm: {
        fontSize: 14,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        minHeight: 44,
      },
      md: {
        fontSize: 16,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        minHeight: 52,
      },
      lg: {
        fontSize: 18,
        paddingVertical: theme.spacing.lg,
        paddingHorizontal: theme.spacing.xl,
        minHeight: 58,
      },
    };
    return sizes[size];
  };

  const inputStyles = {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: error ? theme.colors.error : focused ? theme.colors.focus : theme.colors.muted + '45',
    borderRadius: theme.borderRadius.xl,
    color: theme.colors.textPrimary,
    ...getSizeStyles(),
  };

  return (
  <View style={{ marginBottom: theme.spacing.sm }}>
      {label && (
        <Text style={{
          color: theme.colors.textPrimary,
          fontSize: 14,
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
          {...props}
          style={[
            inputStyles,
            ...(icon ? [{ paddingLeft: theme.spacing.xl + theme.spacing.md }] : []),
            style,
          ]}
          placeholderTextColor={theme.colors.muted}
          accessibilityLabel={props.accessibilityLabel || label || props.placeholder}
          accessibilityHint={error || props.accessibilityHint}
          accessibilityState={{ disabled: !props.editable }}
          onFocus={(event) => { setFocused(true); props.onFocus?.(event); }}
          onBlur={(event) => { setFocused(false); props.onBlur?.(event); }}
        />
      </View>
      {error && (
        <Text style={{
          color: theme.colors.error,
          fontSize: 13,
          marginTop: theme.spacing.xs,
        }}>
          {error}
        </Text>
      )}
    </View>
  );
}
