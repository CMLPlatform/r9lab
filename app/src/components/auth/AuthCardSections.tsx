import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { AppButton } from '@/components/base/AppButton';
import { AppText } from '@/components/base/AppText';
import { Card } from '@/components/base/Card';
import { IosAnnouncement } from '@/components/base/IosAnnouncement';
import { heading } from '@/utils/a11y';
import { cn } from '@/utils/cn';

/** Single-Card auth screen scaffold (forgot-password, reset-password, mfa, verify). */
export function AuthCard({
  title,
  subtitle,
  contentStyle,
  children,
}: {
  title: string;
  // A short line directly under the title (e.g. mfa's mode description),
  // grouped tighter than the rest of the card's content.
  subtitle?: ReactNode;
  contentStyle?: ViewStyle;
  children: ReactNode;
}) {
  return (
    <Card>
      <View className="p-4 gap-4" style={contentStyle}>
        <View className="gap-1.5">
          <AppText variant="display" {...heading(1)}>
            {title}
          </AppText>
          {subtitle}
        </View>
        {children}
      </View>
    </Card>
  );
}

/** The danger-colored inline error text repeated across the auth forms. */
export function AuthFormError({
  message,
  className,
}: {
  message?: string | null;
  className?: string;
}) {
  if (!message) return null;
  return (
    <AppText
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      className={cn('text-destructive', className)}
    >
      <IosAnnouncement text={message} />
      {message}
    </AppText>
  );
}

/** The centered "Back to login" ghost action row repeated across the auth forms. */
export function AuthBackToLoginAction({ onPress }: { onPress: () => void }) {
  return (
    <View className="flex-row gap-4 justify-center mt-2">
      <AppButton variant="ghost" onPress={onPress}>
        Back to login
      </AppButton>
    </View>
  );
}
