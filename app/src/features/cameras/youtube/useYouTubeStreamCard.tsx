import { showStreamStopFailed } from '@/components/cameras/streamingFeedback';
import { useStreamSession } from '@/context/streamSession';
import { useStopYouTubeStreamMutation, useStreamStatusQuery } from '@/features/cameras/r9cam/hooks';
import { useServerPreferenceToggle } from '@/features/cameras/serverPreferenceToggle';
import { useAppFeedback } from '@/hooks/useAppFeedback';
import { useElapsed } from '@/hooks/useElapsed';

export function useYouTubeStreamCard(cameraId: string, isOnline: boolean) {
  const { enabled: youtubeEnabled } = useServerPreferenceToggle('youtube_streaming_enabled');
  const { setActiveStream } = useStreamSession();
  const feedback = useAppFeedback();
  const { data: streamStatus, isLoading: statusLoading } = useStreamStatusQuery(cameraId, {
    enabled: isOnline && youtubeEnabled,
  });
  const stopMutation = useStopYouTubeStreamMutation(cameraId);
  const elapsed = useElapsed(streamStatus?.started_at ?? null);

  const handleStop = () => {
    feedback.alert({
      title: 'End live stream?',
      message: 'This will stop the broadcast and save the recording.',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End stream',
          style: 'destructive',
          onPress: () =>
            stopMutation.mutate(undefined, {
              onSuccess: () => setActiveStream(null),
              onError: (error) => showStreamStopFailed(feedback, error),
            }),
        },
      ],
    });
  };

  return {
    state: {
      youtubeEnabled,
      streamStatus,
      statusLoading,
      isLive: !!streamStatus,
      isStopping: stopMutation.isPending,
      elapsed,
    },
    actions: {
      handleStop,
    },
  };
}
