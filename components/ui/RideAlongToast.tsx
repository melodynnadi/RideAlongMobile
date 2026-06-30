import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { useAppTheme } from '@/hooks/ThemeContext';

// ─── Shared card shell ────────────────────────────────────────────────────────

type CardProps = {
  left: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: { label: string; color?: string; onPress: () => void };
  hide: () => void;
};

function ToastCard({ left, title, subtitle, action, hide }: CardProps) {
  const { colors, isDark } = useAppTheme();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.bgCard,
          borderColor: colors.border,
          shadowColor: isDark ? '#000' : '#1A2942',
        },
      ]}
    >
      <View style={styles.leftSlot}>{left}</View>

      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {action ? (
        <TouchableOpacity
          onPress={() => { action.onPress(); hide(); }}
          style={[styles.actionBtn, { backgroundColor: action.color ?? colors.textPrimary }]}
          activeOpacity={0.8}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.actionLabel, { color: action.color === colors.primary ? '#fff' : colors.bg }]}>
            {action.label}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─── Dot indicator ────────────────────────────────────────────────────────────

function Dot({ color }: { color: string }) {
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

// ─── Avatar (for messages) ────────────────────────────────────────────────────

function Avatar({ initials, online }: { initials: string; online?: boolean }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.avatarWrap}>
      <View style={[styles.avatar, { backgroundColor: colors.primaryDim }]}>
        <Text style={[styles.avatarText, { color: colors.primary }]}>{initials}</Text>
      </View>
      {online ? <View style={[styles.onlineDot, { borderColor: colors.bgCard }]} /> : null}
    </View>
  );
}

// ─── Toast type renderers (passed as react-native-toast-message config) ───────

type ToastProps = {
  text1?: string;
  text2?: string;
  hide: () => void;
  props?: Record<string, any>;
};

function SuccessToast({ text1 = '', text2, hide }: ToastProps) {
  const { colors } = useAppTheme();
  return (
    <ToastCard
      left={<Dot color={colors.green} />}
      title={text1}
      subtitle={text2}
      hide={hide}
    />
  );
}

function ErrorToast({ text1 = '', text2, hide, props }: ToastProps) {
  const { colors } = useAppTheme();
  return (
    <ToastCard
      left={<Dot color={colors.red} />}
      title={text1}
      subtitle={text2}
      action={props?.action}
      hide={hide}
    />
  );
}

function InfoToast({ text1 = '', text2, hide, props }: ToastProps) {
  const { colors } = useAppTheme();
  return (
    <ToastCard
      left={<Dot color={colors.primary} />}
      title={text1}
      subtitle={text2}
      action={props?.action}
      hide={hide}
    />
  );
}

function WarningToast({ text1 = '', text2, hide, props }: ToastProps) {
  const { colors } = useAppTheme();
  return (
    <ToastCard
      left={<Dot color={colors.primary} />}
      title={text1}
      subtitle={text2}
      action={props?.action}
      hide={hide}
    />
  );
}

function MessageToast({ text1 = '', text2, hide, props }: ToastProps) {
  const initials: string = props?.initials ?? '?';
  const online: boolean = props?.online ?? false;
  const time: string | undefined = props?.time;
  const { colors } = useAppTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.bgCard,
          borderColor: colors.border,
          shadowColor: colors.textPrimary,
        },
      ]}
    >
      <View style={styles.leftSlot}>
        <Avatar initials={initials} online={online} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
          {text1}
        </Text>
        {text2 ? (
          <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
            {text2}
          </Text>
        ) : null}
      </View>
      {time ? (
        <Text style={[styles.timeLabel, { color: colors.textSecondary }]}>{time}</Text>
      ) : null}
    </View>
  );
}

function LoadingToast({ text1 = '', text2, hide }: ToastProps) {
  const { colors } = useAppTheme();
  return (
    <ToastCard
      left={<ActivityIndicator size="small" color={colors.primary} />}
      title={text1}
      subtitle={text2}
      hide={hide}
    />
  );
}

// ─── Exported config ──────────────────────────────────────────────────────────

export const toastConfig = {
  success: (props: any) => <SuccessToast {...props} />,
  error: (props: any) => <ErrorToast {...props} />,
  info: (props: any) => <InfoToast {...props} />,
  warning: (props: any) => <WarningToast {...props} />,
  message: (props: any) => <MessageToast {...props} />,
  loading: (props: any) => <LoadingToast {...props} />,
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    width: '92%',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    // Shadow
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 16,
    elevation: 6,
    alignSelf: 'center',
  },
  leftSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 17,
  },
  actionBtn: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    flexShrink: 0,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  timeLabel: {
    fontSize: 11,
    fontWeight: '500',
    flexShrink: 0,
  },
  // Avatar
  avatarWrap: {
    position: 'relative',
    width: 36,
    height: 36,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '700',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#22C55E',
    borderWidth: 2,
  },
});
