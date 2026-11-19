import { type ComponentProps, useCallback } from 'react';
import { Platform } from 'react-native';
import { AppText } from '@/components/base/AppText';
import { openExternalUrl } from '@/services/externalLinks';
import { cn } from '@/utils/cn';
import { normalizeHttpUrl } from '@/utils/urlSafety';

// react-native-web renders `href` as a real <a>, which is focusable and opens
// on Enter. A Text with only onPress gets a tab stop whose Enter key does nothing.
const WEB_ANCHOR_PROPS = {
  hrefAttrs: { target: '_blank', rel: 'noopener noreferrer' },
};

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
  const webProps = Platform.OS === 'web' ? { href: safeUrl, ...WEB_ANCHOR_PROPS } : {};
  return (
    <AppText
      accessibilityRole="link"
      onPress={open}
      className={cn('underline', className)}
      {...webProps}
      {...rest}
    />
  );
}
