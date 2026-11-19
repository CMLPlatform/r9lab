import { type ComponentProps, useCallback } from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import { AppText } from '@/components/base/AppText';
import { openExternalUrl } from '@/services/externalLinks';
import { cn } from '@/utils/cn';
import { normalizeHttpUrl } from '@/utils/urlSafety';

// react-native-web renders `href` as a real <a>, which is focusable and opens
// on Enter. A Text with only onPress gets a tab stop whose Enter key does nothing.
const WEB_ANCHOR_PROPS = {
  hrefAttrs: { target: '_blank', rel: 'noopener noreferrer' },
};
// Read out, not shown, so a screen-reader user knows the link leaves this tab.
const NEW_TAB_HINT = ' (opens in new tab)';

/**
 * Inline link to an http(s) URL inside running text. Renders plain text when
 * `url` is missing or not http(s), so an unconfigured origin leaves no dead link.
 */
export function ExternalTextLink({
  url,
  className,
  ...rest
}: Omit<ComponentProps<typeof AppText>, 'onPress' | 'accessibilityRole'> & {
  url: string | undefined;
}) {
  const safeUrl = url ? normalizeHttpUrl(url) : null;
  const open = useCallback(() => {
    if (safeUrl) void openExternalUrl(safeUrl);
  }, [safeUrl]);
  if (!safeUrl) return <AppText className={className} {...rest} />;
  if (Platform.OS !== 'web') {
    return (
      <AppText
        accessibilityRole="link"
        className={cn('underline', className)}
        onPress={open}
        {...rest}
      />
    );
  }
  // Web gets the anchor alone: with onPress as well, the click would also navigate this tab.
  const { accessibilityLabel, children, ...textProps } = rest;
  return (
    <AppText
      accessibilityRole="link"
      className={cn('underline', className)}
      {...{ href: safeUrl, ...WEB_ANCHOR_PROPS }}
      {...textProps}
      accessibilityLabel={accessibilityLabel ? `${accessibilityLabel}${NEW_TAB_HINT}` : undefined}
    >
      {children}
      <Text style={styles.visuallyHidden}>{NEW_TAB_HINT}</Text>
    </AppText>
  );
}

const styles = StyleSheet.create({
  visuallyHidden: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
});
