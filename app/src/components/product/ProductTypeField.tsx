import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  type TextInput,
  View,
} from 'react-native';
import { AppButton } from '@/components/base/AppButton';
import { AppText } from '@/components/base/AppText';
import { ErrorState } from '@/components/base/ErrorState';
import { PRESS_TINT } from '@/components/base/pressFeedback';
import { Searchbar } from '@/components/base/Searchbar';
import { CategoryBrowserDialog } from '@/components/product/CategoryBrowserDialog';
import CPVCard, { CpvTypeLoadError } from '@/components/product/CPVCard';
import { MIN_TAP_TARGET, WEB_FOCUS_RING } from '@/constants';
import {
  isSameWord,
  usePickProductType,
  useProductTypeSearch,
  useTypeShortcuts,
} from '@/features/products/useCategorySelection';
import { useCpvType } from '@/features/products/useCpvType';
import type { CPVCategory } from '@/types/CPVCategory';
import { type Product, typeRowLabels } from '@/types/Product';
import { cn } from '@/utils/cn';

// Enough to scan without pushing the rest of the form off screen; typing narrows the rest.
const MAX_OPTIONS = 8;
const MAX_SHORTCUTS = 6;

type Props = {
  typeID: number | undefined;
  /** The type as the record carries it, so a saved product shows it without a fetch. */
  recorded?: Product['productType'];
  entityRole: Product['role'];
  onTypeChange: (typeID: number) => void;
};

/**
 * The type row's edit control: the current type, a type-ahead over every product type,
 * and a link to browse the whole tree when no word matches.
 */
export function ProductTypeField({ typeID, recorded, entityRole, onTypeChange }: Props) {
  const labels = typeRowLabels(entityRole);
  const cpvType = useCpvType(typeID, recorded);
  const [query, setQuery] = useState('');
  const { search, debouncedSearchQuery } = useProductTypeSearch(query.trim());
  const { commonTypes, recents } = useTypeShortcuts();
  const searchRef = useRef<TextInput>(null);

  const handleInlineSelect = useCallback(
    (id: number) => {
      setQuery('');
      onTypeChange(id);
      // The pressed option unmounts with the list; keep keyboard focus in the row. Web only:
      // on a phone, focusing the field would raise the keyboard after a tap.
      if (Platform.OS === 'web') searchRef.current?.focus();
      return true;
    },
    [onTypeChange],
  );
  const { pick, picking, pickFailed, clearPickError } = usePickProductType(handleInlineSelect);
  const handleBrowserSelect = useCallback(
    (id: number) => {
      clearPickError();
      setQuery('');
      onTypeChange(id);
    },
    [clearPickError, onTypeChange],
  );
  const handleQueryChange = useCallback(
    (text: string) => {
      clearPickError();
      setQuery(text);
    },
    [clearPickError],
  );

  // Shortcuts only before a first pick: changing a set type starts from typing or browsing.
  const shortcuts =
    typeID === undefined && !query
      ? dedupeByName([...recents, ...commonTypes]).slice(0, MAX_SHORTCUTS)
      : [];
  // The debounced query lags the field by 300 ms, so after a pick, a clear or a fresh word
  // its matches belong to the old text and must not stay tappable.
  const searching = isSameWord(query.trim(), debouncedSearchQuery);
  const results = (search.data ?? []).slice(0, MAX_OPTIONS);
  const total = search.data?.length ?? 0;
  // A failed search says so through ErrorState, which announces itself.
  const status =
    // Placeholder data is the last word's matches; wait for the new count.
    !searching || search.isError || !search.data || search.isPlaceholderData
      ? ''
      : total === 0
        ? `No type matches “${debouncedSearchQuery}”. Try a broader word, or browse.`
        : total > MAX_OPTIONS
          ? `First ${MAX_OPTIONS} of ${total >= 50 ? 'many' : total} matches. Keep typing to narrow them down.`
          : `${total} ${total === 1 ? 'match' : 'matches'}`;

  // VoiceOver ignores accessibilityLiveRegion; announce explicitly.
  useEffect(() => {
    if (Platform.OS === 'ios' && status) AccessibilityInfo.announceForAccessibility(status);
  }, [status]);

  return (
    <View className="gap-2">
      {cpvType.status === 'ready' ? <CPVCard CPV={cpvType.type} /> : null}
      {cpvType.status === 'error' && typeID !== undefined ? (
        <CpvTypeLoadError typeID={typeID} retry={cpvType.retry} />
      ) : null}
      <Searchbar
        ref={searchRef}
        value={query}
        onChangeText={handleQueryChange}
        placeholder="Search types, e.g. laptop"
        accessibilityLabel={typeID === undefined ? labels.choose : `Change ${labels.title}`}
        loading={search.isFetching && debouncedSearchQuery !== ''}
      />
      {shortcuts.length > 0 ? (
        <View className="gap-1">
          <AppText variant="eyebrow">Suggestions</AppText>
          {shortcuts.map((item) => (
            <TypeOption key={item.name} item={item} onPick={pick} busy={picking} />
          ))}
        </View>
      ) : null}
      {/* Always mounted, so screen readers announce each change of the count; out of the
          layout while empty, so it adds no gap. */}
      <AppText
        variant="caption"
        className="text-muted-foreground"
        style={status ? undefined : styles.offscreen}
        accessibilityLiveRegion="polite"
        aria-live="polite"
      >
        {status}
      </AppText>
      {searching && search.isError ? (
        <ErrorState message="Couldn't search the categories." onRetry={search.refetch} />
      ) : null}
      {searching && !search.isError && results.length > 0 ? (
        <View className="gap-1">
          {results.map((item) => (
            <TypeOption key={item.name} item={item} onPick={pick} busy={picking} />
          ))}
        </View>
      ) : null}
      {pickFailed ? (
        <AppText variant="label" className="text-destructive" accessibilityRole="alert">
          Couldn't select that type. Try again.
        </AppText>
      ) : null}
      <BrowseCategories disabled={picking} onSelect={handleBrowserSelect} />
    </View>
  );
}

/** Button and dialog for browsing the whole tree; the dialog returns focus to the button. */
function BrowseCategories({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (typeID: number) => void;
}) {
  const [browsing, setBrowsing] = useState(false);
  const buttonRef = useRef<View>(null);
  const open = useCallback(() => setBrowsing(true), []);
  const close = useCallback(() => setBrowsing(false), []);
  return (
    <>
      {/* Disabled while an inline pick resolves: its late answer would override the browser's. */}
      <AppButton
        ref={buttonRef}
        variant="ghost"
        className="self-start"
        onPress={open}
        disabled={disabled}
      >
        Browse categories
      </AppButton>
      <CategoryBrowserDialog
        visible={browsing}
        onDismiss={close}
        onSelect={onSelect}
        triggerRef={buttonRef}
      />
    </>
  );
}

function dedupeByName(items: CPVCategory[]): CPVCategory[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.name) && seen.add(item.name));
}

function TypeOption({
  item,
  onPick,
  busy,
}: {
  item: CPVCategory;
  onPick: (item: CPVCategory) => unknown;
  busy: boolean;
}) {
  const handlePress = useCallback(() => onPick(item), [onPick, item]);
  // Hand-authored types may carry their label in the name alone.
  const label = item.description || item.name;
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      // The code reads as noise after every option; it stays visible as the second line.
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      className={cn(
        'rounded-lg border border-border bg-card px-3 py-2',
        PRESS_TINT,
        WEB_FOCUS_RING,
      )}
      style={{ minHeight: MIN_TAP_TARGET }}
    >
      <AppText numberOfLines={2}>{label}</AppText>
      <AppText variant="caption" className="text-muted-foreground">
        {item.name}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  offscreen: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
  },
});
