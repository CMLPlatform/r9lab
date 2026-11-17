import { Image } from 'expo-image';
import { View } from 'react-native';
import { AppButton } from '@/components/base/AppButton';
import { AppText } from '@/components/base/AppText';
import { VARIANT_FOREGROUND_COLOR } from '@/components/base/appButtonVariants';
import { Card } from '@/components/base/Card';
import { Icon } from '@/components/base/Icon';
import { useAppTheme } from '@/theme/appThemeContext';
import { heading } from '@/utils/a11y';
import { NewProductPill, ProfilePill } from './InlinePills';
import { productsScreenStyles as styles } from './shared';

type ProductsWelcomeCardProps = {
  isAuthenticated: boolean;
  visible: boolean | null;
  onDismiss: () => void;
  onSignIn: () => void;
  onGoToProfile: () => void;
};

export function ProductsWelcomeCard({
  isAuthenticated,
  visible,
  onDismiss,
  onSignIn,
  onGoToProfile,
}: ProductsWelcomeCardProps) {
  const theme = useAppTheme();

  if (visible !== true) return null;

  return (
    // Mark column + text column: the title, body and actions share one left edge. From md the
    // actions move beside the text so a wide card has no empty band under a short line of copy.
    <Card className="p-4 md:px-6 md:py-5">
      <View className="flex-row items-start gap-3 md:items-center md:gap-4">
        {/* Decorative: expo-image drops an empty alt, so the wrapper hides the subtree. */}
        <View
          aria-hidden
          className="h-11 w-11 items-center justify-center rounded-md bg-primary/12"
        >
          <Image
            accessibilityIgnoresInvertColors
            source={
              theme.dark
                ? require('@/assets/images/mark-dark.png')
                : require('@/assets/images/mark.png')
            }
            style={styles.welcomeBrandMark}
            contentFit="contain"
          />
        </View>

        <View className="flex-1 gap-3 md:flex-row md:items-center md:gap-6">
          <View className="flex-1 gap-1">
            {/* min-h-11 centres the title on the 44px mark when the body wraps below it. */}
            <View className="min-h-11 justify-center md:min-h-0">
              <AppText variant="heading" className="font-bold" {...heading(2)}>
                {isAuthenticated ? 'Verify your email to start creating' : 'Welcome to R9lab'}
              </AppText>
            </View>
            {!isAuthenticated ? (
              <AppText className="text-muted-foreground" style={styles.welcomeBodyText}>
                Browse products freely. Sign in when you are ready to add your own.
              </AppText>
            ) : (
              <View className="flex-row flex-wrap items-center">
                <AppText className="text-muted-foreground" style={styles.welcomeBodyText}>
                  You can browse products and manage your
                </AppText>
                <ProfilePill />
                <AppText className="text-muted-foreground" style={styles.welcomeBodyText}>
                  . Once your email is verified, you can use the{' '}
                </AppText>
                <NewProductPill />
                <AppText className="text-muted-foreground" style={styles.welcomeBodyText}>
                  {' '}
                  button to create products.
                </AppText>
              </View>
            )}
          </View>

          <View className="flex-row flex-wrap items-center gap-2">
            {!isAuthenticated ? (
              <AppButton onPress={onSignIn}>Sign in</AppButton>
            ) : (
              <AppButton onPress={onGoToProfile}>
                <Icon
                  name="mail-check"
                  size={18}
                  color={VARIANT_FOREGROUND_COLOR.primary(theme.colors)}
                />
                Verify email
              </AppButton>
            )}
            <AppButton variant="ghost" onPress={onDismiss}>
              {isAuthenticated ? 'Got it' : 'Maybe later'}
            </AppButton>
          </View>
        </View>
      </View>
    </Card>
  );
}
