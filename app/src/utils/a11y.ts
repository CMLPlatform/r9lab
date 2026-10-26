import {
  Platform,
  type PressableProps,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';

/**
 * Props that associate an input with the `FormFieldError` sharing its `id`
 * and, by default, mark it invalid while the error shows. Pass
 * `{ invalid: false }` for a hint that describes the field without
 * claiming the value is wrong (e.g. a minimum-length cue before typing).
 * `accessibilityDescribedBy` is not in RN core's `TextInputProps`, but
 * react-native-web forwards it to `aria-describedby`.
 */
export function describedBy(
  id: string,
  hasError: boolean,
  { invalid = true }: { invalid?: boolean } = {},
): Partial<TextInputProps> {
  if (!hasError) return {};
  return {
    accessibilityDescribedBy: id,
    ...(invalid ? { 'aria-invalid': true } : {}),
  } as Partial<TextInputProps>;
}

/**
 * Marks a field the form cannot submit without (pair it with the visible
 * "(required)" in the label). Only for fields the form truly needs: an empty
 * observation is valid research data, so data fields stay unmarked.
 * react-native-web forwards `aria-required`; native has no required state,
 * so it gets a spoken hint instead.
 */
export function requiredField(): Partial<TextInputProps> {
  return Platform.OS === 'web'
    ? ({ 'aria-required': true } as Partial<TextInputProps>)
    : { accessibilityHint: 'Required' };
}

/**
 * Keeps a node in the accessibility tree while taking it off the screen. Not
 * `display: none` or zero opacity: both can drop it from the tree.
 */
export const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  overflow: 'hidden',
} as const satisfies ViewStyle;

/**
 * Props that render text as a heading at `level` (web: `<h1>`–`<h3>`).
 * `aria-level` is not in RN core's types; react-native-web reads it to pick
 * the element, and without it every `header` role becomes an `<h1>`.
 *
 * Level 1 is the screen's own title, and there is at most one per screen:
 * `useScreenEntryFocus` moves keyboard focus to it on entry. Sections and
 * dialog titles are level 2, headings inside them level 3.
 */
export function heading(level: 1 | 2 | 3): Partial<TextProps> {
  return { accessibilityRole: 'header', 'aria-level': level } as Partial<TextProps>;
}

/**
 * react-native-web presses a Pressable on Space only when its role is button, so a
 * radio or other choice built on Pressable answers Enter alone. Spread this onto it
 * so Space chooses it too, as the WAI-ARIA radio pattern expects. Web only: native
 * platforms have no key events here.
 */
export function pressOnSpace(onPress: () => void): Partial<PressableProps> {
  const onKeyDown = (event: { key: string; preventDefault(): void }) => {
    if (event.key !== ' ') return;
    // Space would otherwise scroll the page.
    event.preventDefault();
    onPress();
  };
  return { onKeyDown } as Partial<PressableProps>;
}
