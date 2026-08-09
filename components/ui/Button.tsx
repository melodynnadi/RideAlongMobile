import React from 'react';
import { Pressable, Text, ActivityIndicator, PressableProps, ViewStyle } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { hitSlop, layout } from '@/theme/designSystem';

interface ButtonProps extends PressableProps {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'success' | 'warning' | 'error';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  children: React.ReactNode;
  fullWidth?: boolean;
}

export function Button({ 
  variant = 'primary', 
  size = 'md', 
  loading = false, 
  style, 
  children, 
  disabled,
  fullWidth = false,
  ...props 
}: ButtonProps) {
  const theme = useTheme();

  const getButtonStyles = (): ViewStyle => {
    const baseStyles: ViewStyle = {
      borderRadius: theme.borderRadius['2xl'],
      justifyContent: 'center',
      alignItems: 'center',
      flexDirection: 'row',
      width: fullWidth ? '100%' : undefined,
      minHeight: layout.minimumTouchTarget,
    };

    const sizeStyles = {
      sm: {
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        minHeight: 44,
      },
      md: {
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        minHeight: 52,
      },
      lg: {
        paddingVertical: theme.spacing.lg,
        paddingHorizontal: theme.spacing.xl,
        minHeight: 58,
      },
    };

    const variantStyles = {
      primary: {
        backgroundColor: theme.colors.primary,
        borderWidth: 0,
        borderColor: theme.colors.secondary,
      },
      secondary: {
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.muted,
      },
      outline: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: theme.colors.secondary,
      },
      ghost: {
        backgroundColor: 'transparent',
        borderWidth: 0,
      },
      success: {
        backgroundColor: theme.colors.success,
        borderWidth: 0,
      },
      warning: {
        backgroundColor: theme.colors.warning,
        borderWidth: 0,
      },
      error: {
        backgroundColor: theme.colors.error,
        borderWidth: 0,
      },
    };

    const disabledStyles = disabled || loading ? {
      opacity: 0.6,
    } : {};

    return {
      ...baseStyles,
      ...sizeStyles[size],
      ...variantStyles[variant],
      ...disabledStyles,
    };
  };

  const getTextColor = () => {
    switch (variant) {
      case 'primary':
      case 'success':
      case 'error':
        return theme.colors.textOnPrimary;
      case 'secondary':
        return theme.colors.textPrimary;
      case 'outline':
      case 'ghost':
        return theme.colors.primary;
      case 'warning':
        return theme.colors.bg;
      default:
        return theme.colors.text;
    }
  };

  const getTextSize = () => {
    switch (size) {
      case 'sm':
        return 14;
      case 'md':
        return 16;
      case 'lg':
        return 18;
      default:
        return 16;
    }
  };

  const isTextChild = typeof children === 'string' || typeof children === 'number';

  return (
    <Pressable
      style={({ pressed }) => [getButtonStyles(), pressed && !(disabled || loading) && { opacity: 0.86, transform: [{ scale: 0.99 }] }, style as any]}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: loading }}
      hitSlop={hitSlop}
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={getTextColor()} />
      ) : isTextChild ? (
        <Text
          style={{
            color: getTextColor(),
            fontSize: getTextSize(),
            fontWeight: '600',
            textAlign: 'center',
          }}
        >
          {children as any}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}
