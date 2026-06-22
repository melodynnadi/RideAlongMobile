import React from 'react';
import { View, ViewProps } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { surfaceShadow } from '@/theme/designSystem';

interface CardProps extends ViewProps {
  variant?: 'default' | 'elevated';
}

export function Card({ variant = 'default', style, children, ...props }: CardProps) {
  const theme = useTheme();

  const getCardStyles = () => {
    const baseStyles = {
      backgroundColor: theme.colors.card,
      borderRadius: theme.borderRadius['2xl'],
      padding: theme.spacing.lg,
    };

    const variantStyles = {
      default: {
        borderWidth: 1,
        borderColor: theme.colors.muted + '20',
      },
      elevated: {
        ...surfaceShadow,
        borderWidth: 1,
        borderColor: theme.colors.muted + '18',
      },
    };

    return {
      ...baseStyles,
      ...variantStyles[variant],
    };
  };

  return (
    <View style={[getCardStyles(), style]} {...props}>
      {children}
    </View>
  );
}
