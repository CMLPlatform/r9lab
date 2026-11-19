import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/base/AppText';
import { DisclosureChevron } from '@/components/base/DisclosureChevron';
import { PRESS_TINT } from '@/components/base/pressFeedback';
import { MIN_TAP_TARGET, WEB_FOCUS_RING } from '@/constants';
import { useAppTheme } from '@/theme/appThemeContext';
import { entityLabelTitle, type Product } from '@/types/Product';
import { cn } from '@/utils/cn';
import { getProfileHref } from '@/utils/router/profiles';
import ProductEditHistory from './ProductEditHistory';

interface Props {
  product: Product;
}

/** Footer row: caption label, data value (DESIGN.md ramp). */
function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="flex-row items-center gap-2">
      <AppText variant="caption" className="text-muted-foreground">
        {label}:
      </AppText>
      {children}
    </View>
  );
}

export default function ProductMetaData({ product }: Props) {
  const router = useRouter();
  const theme = useAppTheme();
  const { ownerUsername } = product;
  const [historyOpen, setHistoryOpen] = useState(false);
  const toggleHistory = useCallback(() => setHistoryOpen((open) => !open), []);
  const openOwner = useCallback(() => {
    if (ownerUsername) router.push(getProfileHref(ownerUsername));
  }, [ownerUsername, router]);
  return (
    <View className="gap-1 mb-2">
      {product.createdAt ? (
        <MetaRow label="Created">
          <AppText variant="data">{new Date(product.createdAt).toLocaleDateString()}</AppText>
        </MetaRow>
      ) : null}
      {product.updatedAt ? (
        <MetaRow label="Last updated">
          {typeof product.id === 'number' ? (
            <Pressable
              onPress={toggleHistory}
              accessibilityRole="button"
              accessibilityState={{ expanded: historyOpen }}
              // Starts with the visible text, so voice control can name the button (WCAG 2.5.3).
              accessibilityLabel={`Last updated ${new Date(product.updatedAt).toLocaleDateString()}. ${historyOpen ? 'Hide' : 'Show'} edit history`}
              className={cn('flex-row items-center gap-1 rounded-md', PRESS_TINT, WEB_FOCUS_RING)}
              style={styles.link}
            >
              <AppText variant="data" className="text-primary underline">
                {new Date(product.updatedAt).toLocaleDateString()}
              </AppText>
              <DisclosureChevron expanded={historyOpen} size="sm" color={theme.colors.primary} />
            </Pressable>
          ) : (
            <AppText variant="data">{new Date(product.updatedAt).toLocaleDateString()}</AppText>
          )}
        </MetaRow>
      ) : null}
      {historyOpen ? <ProductEditHistory product={product} /> : null}
      <MetaRow label="Owner">
        {product.ownerUsername ? (
          // 44px floor via padding that a negative margin lets overlap the row,
          // same as ProductCard's owner link: the text stays caption-sized.
          <Pressable
            onPress={openOwner}
            accessibilityRole="link"
            accessibilityLabel={`View ${product.ownerUsername}'s profile`}
            className={cn('justify-center rounded-md', PRESS_TINT, WEB_FOCUS_RING)}
            style={styles.link}
          >
            <AppText variant="data" className="text-primary underline">
              {product.ownerUsername}
            </AppText>
          </Pressable>
        ) : (
          <AppText variant="data">Anonymous</AppText>
        )}
      </MetaRow>
      <MetaRow label={`${entityLabelTitle(product)} ID`}>
        <AppText variant="data">{product.id}</AppText>
      </MetaRow>
    </View>
  );
}

// Shared by the owner and edit-history links.
const styles = StyleSheet.create({
  link: {
    minHeight: MIN_TAP_TARGET,
    // A short username ("bob") left a ~25px-wide target; nothing sits to its right.
    minWidth: MIN_TAP_TARGET,
    paddingVertical: 12,
    marginVertical: -12,
  },
});
