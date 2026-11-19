import { useCallback, useRef } from 'react';
import { Platform, View } from 'react-native';
import { AppText } from '@/components/base/AppText';
import { useDialog } from '@/components/base/dialogContext';
import { startAccountExport } from '@/services/api/accountExport';
import { getErrorMessage } from '@/utils/errors';
import { ProfileAction } from './shared';

const TITLE = 'Download your data';

/**
 * Download of the whole account (details, products, photos) as one ZIP. Web only:
 * native would have to hold the archive, up to the upload quota, in memory, so it
 * points to the web app instead.
 */
export function DataExportAction() {
  const dialog = useDialog();
  const triggerRef = useRef<View>(null);
  const download = useCallback(async () => {
    try {
      await startAccountExport();
      dialog.toast('Download started');
    } catch (error) {
      dialog.alert({
        title: 'Download failed',
        message: getErrorMessage(error, 'Try again later.'),
        triggerRef,
      });
    }
  }, [dialog]);

  if (Platform.OS !== 'web') {
    return (
      <View className="mx-1 min-h-11 px-4 py-2.5">
        <AppText className="font-semibold">{TITLE}</AppText>
        <AppText variant="caption" className="mt-px text-muted-foreground">
          Download it from r9lab.io in a browser
        </AppText>
      </View>
    );
  }
  return (
    <View className="mx-1">
      <ProfileAction
        icon="download"
        title={TITLE}
        subtitle="Your account, products and photos as one ZIP file"
        onPress={download}
        hideChevron
        triggerRef={triggerRef}
      />
    </View>
  );
}
