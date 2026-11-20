import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { AppButton } from '@/components/base/AppButton';
import { AppDialog } from '@/components/base/AppDialog';
import { AppText } from '@/components/base/AppText';
import { CenteredSpinner } from '@/components/base/CenteredSpinner';
import { ErrorState } from '@/components/base/ErrorState';
import { Icon } from '@/components/base/Icon';
import { InfoTooltip } from '@/components/base/InfoTooltip';
import { PRESS_TINT, type PressState, pressFill } from '@/components/base/pressFeedback';
import { Searchbar } from '@/components/base/Searchbar';
import CPVCard from '@/components/product/CPVCard';
import { MIN_TAP_TARGET, radius } from '@/constants';
import { useCategorySelection } from '@/features/products/useCategorySelection';
import { useAppTheme } from '@/theme/appThemeContext';
import type { CPVCategory } from '@/types/CPVCategory';
import { heading } from '@/utils/a11y';

const TITLE = 'Browse categories';

type Props = {
  visible: boolean;
  onDismiss: () => void;
  /** Gets the picked product type's id; the dialog closes itself after. */
  onSelect: (typeId: number) => void;
  /** The control that opened the dialog, so native screen readers return focus to it on close. */
  triggerRef?: RefObject<View | null>;
};

/** The whole CPV tree, level by level, with search: for when the form's type-ahead finds nothing. */
export function CategoryBrowserDialog({ visible, onDismiss, onSelect, triggerRef }: Props) {
  // A fresh key per opening starts each one at the root with an empty search, while the
  // content stays mounted through the close fade.
  const [opening, setOpening] = useState(0);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setOpening((n) => n + 1);
  }
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);
  // A lookup that resolves after Close or Escape does not apply the type.
  const handleSelect = useCallback(
    (typeId: number) => {
      if (!visibleRef.current) return false;
      onSelect(typeId);
      onDismiss();
      return true;
    },
    [onSelect, onDismiss],
  );
  return (
    <AppDialog
      visible={visible}
      onDismiss={onDismiss}
      accessibilityLabel={TITLE}
      size="large"
      triggerRef={triggerRef}
    >
      <CategoryBrowser key={opening} onDismiss={onDismiss} onSelect={handleSelect} />
    </AppDialog>
  );
}

function CategoryBrowser({
  onDismiss,
  onSelect,
}: {
  onDismiss: () => void;
  onSelect: (typeId: number) => boolean;
}) {
  const {
    loading,
    loadFailed,
    pickFailed,
    retryLoad,
    history,
    filtered,
    commonTypes,
    recents,
    searchQuery,
    debouncedSearchQuery,
    setSearchQuery,
    selectBranch,
    moveUp,
    pick,
  } = useCategorySelection(onSelect);

  const renderItem = useCallback(
    ({ item }: { item: CPVCategory }) => (
      <CategoryListItem item={item} onSelectType={pick} onSelectBranch={selectBranch} />
    ),
    [pick, selectBranch],
  );
  const keyExtractor = useCallback((item: CPVCategory) => String(item.id), []);

  // Shortcut sections show only at the taxonomy root with no active search.
  const atRoot = history.length === 0 && !searchQuery;
  const showCommon = atRoot && commonTypes.length > 0;
  const showRecents = atRoot && recents.length > 0;
  const listHeader =
    showCommon || showRecents ? (
      <View className="gap-6">
        {showCommon ? (
          <View className="gap-3">
            <AppText variant="eyebrow">Common types</AppText>
            {commonTypes.map((item) => (
              <RecentCategoryCard key={item.name} item={item} onSelectType={pick} />
            ))}
          </View>
        ) : null}
        {showRecents ? (
          <View className="gap-3">
            <AppText variant="eyebrow">Recent</AppText>
            {recents.map((item) => (
              <RecentCategoryCard key={item.name} item={item} onSelectType={pick} />
            ))}
          </View>
        ) : null}
        <AppText variant="eyebrow">All categories</AppText>
      </View>
    ) : null;

  return (
    <View className="flex-1 gap-3">
      <View className="flex-row items-center justify-between gap-2">
        <AppText variant="title" {...heading(2)} className="font-semibold">
          {TITLE}
        </AppText>
        <AppButton variant="ghost" onPress={onDismiss}>
          Close
        </AppButton>
      </View>
      <View className="gap-3">
        <Searchbar
          placeholder="Search"
          onChangeText={setSearchQuery}
          value={searchQuery}
          // Search-first: the field is ready to type into the moment the picker opens.
          autoFocus
        />
        <View className="flex-row items-start gap-1">
          <AppText variant="caption" className="text-muted-foreground flex-1">
            Type a name (e.g. laptop) to search every category, or browse below. Tap a category to
            select it as the type.
          </AppText>
          <InfoTooltip title="Product types come from CPV, a standard list of product categories. Pick the most specific category you're sure of. A broader one is fine. R9lab uses it for filtering and for the research statistics." />
        </View>
        {pickFailed ? (
          <AppText variant="label" className="text-destructive" accessibilityRole="alert">
            Couldn't select that type. Try again.
          </AppText>
        ) : null}
        {history.length > 0 && <CPVHistory history={history} onPress={moveUp} />}
      </View>
      <FlatList
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-4 py-2"
        data={filtered}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          loadFailed ? (
            <ErrorState
              message={
                debouncedSearchQuery
                  ? "Couldn't search the categories."
                  : "Couldn't load the category list."
              }
              onRetry={retryLoad}
            />
          ) : loading ? (
            <CenteredSpinner />
          ) : debouncedSearchQuery ? (
            // debouncedSearchQuery is what `filtered` was computed from.
            <View className="items-center gap-2 p-8">
              <AppText className="text-center text-muted-foreground">
                No categories match &ldquo;{debouncedSearchQuery}&rdquo;. Try a broader term.
              </AppText>
            </View>
          ) : null
        }
      />
    </View>
  );
}

function CategoryListItem({
  item,
  onSelectType,
  onSelectBranch,
}: {
  item: CPVCategory;
  onSelectType: (item: CPVCategory) => void | Promise<void>;
  onSelectBranch: (item: CPVCategory) => void;
}) {
  const handleSelect = useCallback(() => onSelectType(item), [onSelectType, item]);
  const handleBranch = useCallback(() => onSelectBranch(item), [onSelectBranch, item]);
  return (
    <View>
      <CPVCard
        CPV={item}
        onPress={handleSelect}
        actionElement={<CPVLink CPV={item} onPress={handleBranch} />}
      />
    </View>
  );
}

function RecentCategoryCard({
  item,
  onSelectType,
}: {
  item: CPVCategory;
  onSelectType: (item: CPVCategory) => void | Promise<void>;
}) {
  const handleSelect = useCallback(() => onSelectType(item), [onSelectType, item]);
  return <CPVCard CPV={item} onPress={handleSelect} />;
}

function CPVHistory({ history, onPress }: { history: CPVCategory[]; onPress?: () => void }) {
  const { colors, tokens } = useAppTheme();
  // A tinted (tonal) control: pressed and hovered it fills primary-strong with
  // primary-foreground ink, as the tonal button does.
  const historyStyle = useCallback(
    (state: PressState) => [
      styles.history,
      { backgroundColor: tokens.surface.accent },
      pressFill(state, colors.primaryStrong),
    ],
    [tokens, colors.primaryStrong],
  );
  return (
    <Pressable
      style={historyStyle}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Go back to parent category"
    >
      {(state: PressState) => {
        const ink = state.pressed || state.hovered ? colors.onPrimary : colors.primary;
        return (
          <>
            <Icon size="md" name="chevron-left" color={ink} />
            <AppText
              numberOfLines={2}
              ellipsizeMode={'tail'}
              className="shrink"
              style={{ color: ink }}
            >
              {history.at(-1)?.description}
            </AppText>
          </>
        );
      }}
    </Pressable>
  );
}

function CPVLink({ CPV, onPress }: { CPV: CPVCategory; onPress?: () => void }) {
  const { colors } = useAppTheme();

  if (CPV.childCount <= 0) {
    return <View style={{ height: MIN_TAP_TARGET }} />;
  }

  return (
    <Pressable
      className={PRESS_TINT}
      style={styles.link}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Browse ${CPV.childCount} subcategories`}
    >
      <AppText variant="caption" className="text-right" style={{ color: colors.primary }}>
        <AppText variant="data" style={{ color: colors.primary }}>
          {CPV.childCount}
        </AppText>{' '}
        subcategories
      </AppText>
      <Icon size="md" name="chevron-right" color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  history: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    minHeight: MIN_TAP_TARGET,
    borderRadius: radius.control,
  },
  link: {
    minHeight: MIN_TAP_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
    paddingHorizontal: 12,
    borderRadius: radius.control,
  },
});
