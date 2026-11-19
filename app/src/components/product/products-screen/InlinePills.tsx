import { AppText } from '@/components/base/AppText';
import { useAppTheme } from '@/theme/appThemeContext';
import { palette } from '@/theme/palette.generated';
import { productsScreenStyles as styles } from './shared';

type NewProductPillProps = {
  label?: string;
};

export function NewProductPill({ label = 'New product' }: NewProductPillProps) {
  const theme = useAppTheme();

  // NOTE: plain emphasized text, not a pill: it names the control, it is not one.
  return (
    <AppText
      className="font-bold"
      style={[styles.inlineButtonText, { color: theme.colors.primary }]}
    >
      {label}
    </AppText>
  );
}

export function ProfilePill() {
  const theme = useAppTheme();
  // `primary` measures 3.73:1 in dark at 14px bold (not WCAG large text, so 4.5:1
  // applies); `primaryStrong` passes. Plain text so the sentence stays one text node.
  return (
    <AppText
      testID="profile-pill-label"
      className="font-bold"
      style={[styles.inlineProfileText, { color: palette[theme.scheme].primaryStrong }]}
    >
      account
    </AppText>
  );
}
