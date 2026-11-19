import type { ReactNode, RefObject } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  type View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { Easing, FadeInUp, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { breakpoints } from '@/constants';
import { swallowKey, useModalPresence } from '@/hooks/useModalPresence';
import { useReturnFocus } from '@/hooks/useReturnFocus';
import { useAppTheme } from '@/theme/appThemeContext';
import { OverlaySurface } from './OverlaySurface';

type AppDialogProps = {
  visible: boolean;
  onDismiss: () => void;
  /**
   * Names the dialog for assistive tech. Required: react-native-web renders the Modal
   * with role="dialog" and aria-modal, and without a name a screen reader announces only
   * "dialog", so the user cannot tell which one opened. Pass the visible title's text.
   */
  accessibilityLabel: string;
  /** When false, tapping the backdrop or pressing Escape/back does not dismiss. Defaults to true. */
  dismissable?: boolean;
  /** The element that opened this dialog, so native screen readers can return focus to it on close. */
  triggerRef?: RefObject<View | null>;
  /**
   * 'large' holds a fixed 85% height up to 720 wide, for content that scrolls itself
   * (a FlatList must not sit inside the default ScrollView). Below the md breakpoint it
   * fills the screen instead: a card with scrim around it leaves too little list once
   * the keyboard is up.
   */
  size?: 'default' | 'large';
  children: ReactNode;
};

const NOOP = () => {};
// The surface's p-4, in px, for the full-screen variant that adds safe-area insets to it.
const PAD = 16;

// Swallow presses so tapping inside the dialog does not dismiss it.
function stopPropagation(e: { stopPropagation: () => void }) {
  e.stopPropagation();
}

const LANDSCAPE_PHONE_MAX_HEIGHT = 500;

/**
 * Shared dialog chrome: a centered surface over a scrim.
 *
 * NOTE: uses RN-core Modal for native focus trap and Escape→onRequestClose.
 */
export function AppDialog({
  visible,
  onDismiss,
  accessibilityLabel,
  dismissable = true,
  triggerRef,
  size = 'default',
  children,
}: AppDialogProps) {
  const large = size === 'large';
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // A phone either way up: in landscape (about 390 px tall) the card leaves the list a sliver.
  const fullScreen = large && (width < breakpoints.md || height < LANDSCAPE_PHONE_MAX_HEIGHT);
  const baseSurface = [theme.tokens.elevation.overlay, large ? styles.fill : styles.shrink];
  // The surface itself reaches the screen edges; its content clears notch and home bar.
  const surfaceStyle = fullScreen
    ? [
        ...baseSurface,
        {
          paddingTop: insets.top + PAD,
          paddingBottom: insets.bottom + PAD,
          paddingLeft: insets.left + PAD,
          paddingRight: insets.right + PAD,
        },
      ]
    : baseSurface;
  // A closing dialog stays mounted through its exit; a second Escape or backdrop
  // press in that window must not dismiss again.
  const handleDismiss = dismissable && visible ? onDismiss : undefined;
  const { mounted, fadeStyle } = useModalPresence(visible);
  // Every dialog inherits return-focus on close; triggerRef is optional and
  // only needed for native screen-reader focus restore (web works without it).
  useReturnFocus(mounted, triggerRef);

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={handleDismiss ?? NOOP}
      // Lands on the element react-native-web gives role="dialog": Modal spreads its
      // remaining props onto it. RN core treats aria-label the same on native.
      aria-label={accessibilityLabel}
    >
      {/* Tap-outside-to-dismiss, and the wrapper that stops a tap on the card
          from reaching it. Neither is a control: assistive tech dismisses the
          dialog with its own buttons or the system back gesture, and a
          full-screen unlabelled button would swallow the card it contains. */}
      <Animated.View
        style={[styles.fill, fadeStyle]}
        pointerEvents={visible ? 'auto' : 'none'}
        // Focus stays on the pressed button through the exit; Enter there must not press it again.
        // Spread: RN's TypeScript types omit onKeyDownCapture; RN-Web and native both take it.
        {...{ onKeyDownCapture: visible ? undefined : swallowKey }}
      >
        <Pressable
          accessible={false}
          tabIndex={-1}
          className={fullScreen ? 'flex-1' : 'flex-1 items-center justify-center p-4'}
          style={{ backgroundColor: theme.tokens.overlay.scrim }}
          onPress={handleDismiss}
        >
          <Pressable
            accessible={false}
            tabIndex={-1}
            onPress={stopPropagation}
            className="w-full"
            style={fullScreen ? styles.fill : large ? styles.largeWrapper : styles.dialogWrapper}
          >
            <KeyboardAvoidingView behavior="padding" style={large ? styles.fill : styles.shrink}>
              <Animated.View
                style={large ? styles.fill : styles.shrink}
                entering={FadeInUp.duration(200)
                  .easing(Easing.out(Easing.quad))
                  .reduceMotion(ReduceMotion.System)}
              >
                <OverlaySurface
                  className={fullScreen ? 'rounded-none p-4' : 'p-4'}
                  style={surfaceStyle}
                  tone="surface"
                >
                  {large ? (
                    children
                  ) : (
                    <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
                      {children}
                    </ScrollView>
                  )}
                </OverlaySurface>
              </Animated.View>
            </KeyboardAvoidingView>
          </Pressable>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  dialogWrapper: {
    maxWidth: 480,
    maxHeight: '85%',
  },
  largeWrapper: {
    maxWidth: 720,
    height: '85%',
  },
  shrink: {
    flexShrink: 1,
  },
});
