import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Platform, View } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';
import { AppButton } from '@/components/base/AppButton';
import { AppText } from '@/components/base/AppText';
import { Chip } from '@/components/base/Chip';
import { useDialog } from '@/components/base/dialogContext';
import { SingleSelectFilterModal } from '@/components/base/FilterSelectionModal';
import { IconButton } from '@/components/base/IconButton';
import { FADE_ENTER, FADE_EXIT, ROW_MOVE } from '@/components/base/motion';
import { Separator } from '@/components/base/ui/separator';
import LocalizedFloatInput from '@/components/product/LocalizedFloatInput';
import { bomWarnings, formatGrams, totalMaterialMassG } from '@/features/products/materialBalance';
import { useProductMaterials } from '@/features/products/useProductMaterials';
import type { MaterialOption } from '@/services/api/materials';
import { useAppTheme } from '@/theme/appThemeContext';
import type { ApiMaterialUnit } from '@/types/api';
import type { Product, ProductMaterial } from '@/types/Product';
import { heading } from '@/utils/a11y';
import { decimalSeparatorFor, parseLocalizedFloat } from '@/utils/locale';

interface Props {
  product: Product;
  editMode?: boolean;
  /** False while moderating someone else's record. Defaults to true. */
  canEdit?: boolean;
}

const UNITS: ApiMaterialUnit[] = ['g', 'kg', 'm', 'cm'];
const DEFAULT_UNIT: ApiMaterialUnit = 'g';
const QUANTITY_ERROR = 'Enter a quantity above 0.';

/**
 * Recorded bill of materials, as a sub-block of Properties.
 *
 * In edit mode on a saved record, rows are added, changed and removed
 * immediately through `/v1/{products|components}/{id}/materials` (see
 * `useProductMaterials`). The line under each row is the source of the
 * material's reference data (density and the like), never of the quantity
 * observed on this record.
 */
export default function ProductMaterials({ product, editMode = false, canEdit = true }: Props) {
  const editable = editMode && canEdit && typeof product.id === 'number';
  const dialog = useDialog();
  const { materials, options, optionsLoading, add, update, remove } = useProductMaterials(
    product,
    editable,
  );

  const confirmRemove = (material: ProductMaterial) =>
    dialog.alert({
      title: 'Remove material?',
      message: `Remove ${material.name} from the bill of materials?`,
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => remove.mutate(material.materialID),
        },
      ],
    });

  // Distinct from `[]`: the payload never carried a bill of materials, so
  // saying "none recorded" would be a claim we cannot make.
  if (materials === undefined) return null;
  // Nothing to add to on an unsaved draft or someone else's record.
  if (editMode && !editable && materials.length === 0) return null;

  const total = totalMaterialMassG(materials);
  const warnings = bomWarnings(product, materials);

  return (
    <View className="mt-4">
      <View className="mb-2 flex-row items-center gap-1.5">
        <AppText variant="body" {...heading(3)} className="font-semibold">
          Materials
        </AppText>
        {materials.length > 0 ? (
          <AppText variant="data" className="text-muted-foreground">
            {`(${materials.length})`}
          </AppText>
        ) : null}
      </View>
      <LayoutAnimationConfig skipEntering skipExiting>
        {materials.map((material) => (
          <MaterialRow
            key={material.materialID}
            material={material}
            editable={editable}
            // biome-ignore lint/performance/noJsxPropsBind: handlers close over this row's state; short list.
            onQuantity={(quantity) => update.mutate({ materialID: material.materialID, quantity })}
            // biome-ignore lint/performance/noJsxPropsBind: handlers close over this row's state; short list.
            onUnit={(unit) => update.mutate({ materialID: material.materialID, unit })}
            // biome-ignore lint/performance/noJsxPropsBind: handlers close over this row's state; short list.
            onRemove={() => confirmRemove(material)}
          />
        ))}
      </LayoutAnimationConfig>
      {materials.length === 0 ? (
        // Unset, like an empty spec row: a dash.
        <AppText className="mb-2">—</AppText>
      ) : null}
      {materials.length > 0 ? (
        <AppText variant="caption" className="mb-2 px-4 text-muted-foreground">
          {total === undefined
            ? 'Total mass not available: some rows are not in g or kg.'
            : `Total mass: ${formatGrams(total)}`}
        </AppText>
      ) : null}
      <Warnings messages={warnings} />
      {editable ? (
        <AddMaterial
          taken={materials}
          options={options}
          loading={optionsLoading}
          adding={add.isPending}
          // biome-ignore lint/performance/noJsxPropsBind: handlers close over this row's state; short list.
          onAdd={(materialID, quantity, unit, onSuccess) =>
            add.mutate({ materialID, quantity, unit }, { onSuccess })
          }
        />
      ) : null}
    </View>
  );
}

function MaterialRow({
  material,
  editable,
  onQuantity,
  onUnit,
  onRemove,
}: {
  material: ProductMaterial;
  editable: boolean;
  onQuantity: (quantity: number) => void;
  onUnit: (unit: ApiMaterialUnit) => void;
  onRemove: () => void;
}) {
  const [error, setError] = useState<string>();
  const changeQuantity = (value: number | undefined) => {
    if (value === undefined || value <= 0) {
      setError(QUANTITY_ERROR);
      return;
    }
    setError(undefined);
    if (value !== material.quantity) onQuantity(value);
  };

  return (
    <Animated.View entering={FADE_ENTER} exiting={FADE_EXIT} layout={ROW_MOVE}>
      <Separator />
      {/* The house spec row: name as the label, the recorded quantity as data. */}
      <LocalizedFloatInput
        label={material.name}
        value={material.quantity}
        // In edit mode too: changing the unit keeps the number, so the unit must sit beside it.
        unit={material.unit}
        editable={editable}
        // biome-ignore lint/performance/noJsxPropsBind: handlers close over this row's state; short list.
        onChange={changeQuantity}
        error={error}
      />
      {editable ? (
        <View className="mb-1 flex-row items-center justify-between px-4">
          <UnitChoice label={`Unit for ${material.name}`} value={material.unit} onChange={onUnit} />
          <IconButton
            icon="trash-2"
            accessibilityLabel={`Remove ${material.name}`}
            onPress={onRemove}
          />
        </View>
      ) : null}
      <AppText variant="caption" className="mb-2 px-4 text-muted-foreground">
        {material.source ? `Material reference: ${material.source}` : 'No reference recorded.'}
      </AppText>
    </Animated.View>
  );
}

function UnitChoice({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ApiMaterialUnit;
  onChange: (unit: ApiMaterialUnit) => void;
}) {
  const theme = useAppTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} className="flex-row gap-2">
      {UNITS.map((unit) => (
        <Chip
          key={unit}
          accessibilityRole="radio"
          accessibilityState={{ checked: unit === value }}
          accessibilityLabel={unit}
          style={unit === value ? { borderWidth: 2, borderColor: theme.colors.primary } : undefined}
          // biome-ignore lint/performance/noJsxPropsBind: four short chips, re-rendered only on a data change.
          onPress={() => onChange(unit)}
        >
          {unit}
        </Chip>
      ))}
    </View>
  );
}

/** Picker, then quantity and unit for the picked material: a row needs a quantity above 0, so none is guessed. */
function AddMaterial({
  taken,
  options,
  loading,
  adding,
  onAdd,
}: {
  taken: ProductMaterial[];
  options: MaterialOption[];
  loading: boolean;
  adding: boolean;
  // `onSuccess` lets the form keep its input when the write fails.
  onAdd: (
    materialID: number,
    quantity: number,
    unit: ApiMaterialUnit,
    onSuccess: () => void,
  ) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<{ id: number; name: string }>();
  // The typed text, not the blurred value: on native, a tap on Add can leave the field focused.
  const [quantityText, setQuantityText] = useState('');
  const [unit, setUnit] = useState<ApiMaterialUnit>(DEFAULT_UNIT);
  const [error, setError] = useState<string>();

  // A material appears once per bill of materials: offered ones exclude the recorded rows.
  const available = useMemo(() => {
    const query = search.trim().toLowerCase();
    const takenIDs = new Set(taken.map((m) => m.materialID));
    return options.filter(
      (o) =>
        !takenIDs.has(o.id) &&
        (!query ||
          o.name.toLowerCase().includes(query) ||
          (o.description?.toLowerCase().includes(query) ?? false)),
    );
  }, [options, taken, search]);

  // Names are not unique: the picker's values are ids, and a name shared with
  // another material gets its source, description or id to tell them apart.
  const labels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of options) counts.set(o.name, (counts.get(o.name) ?? 0) + 1);
    return Object.fromEntries(
      options.map((o) => [
        String(o.id),
        (counts.get(o.name) ?? 0) > 1
          ? `${o.name} (${o.source ?? o.description ?? `#${o.id}`})`
          : o.name,
      ]),
    );
  }, [options]);
  const pick = (value: string) => {
    const option = options.find((o) => String(o.id) === value);
    if (option) setPicked({ id: option.id, name: labels[value] ?? option.name });
  };
  const reset = () => {
    setPicked(undefined);
    setQuantityText('');
    setUnit(DEFAULT_UNIT);
    setError(undefined);
  };
  const confirm = () => {
    const quantity = parseLocalizedFloat(quantityText, decimalSeparatorFor());
    if (!picked || quantity === undefined || quantity <= 0) {
      setError(QUANTITY_ERROR);
      return;
    }
    onAdd(picked.id, quantity, unit, reset);
  };
  const openPicker = () => {
    setSearch('');
    setPickerOpen(true);
  };
  const closePicker = () => setPickerOpen(false);

  return (
    <View className="px-4">
      {picked ? (
        <View>
          <AppText variant="body" className="font-semibold">
            {`Add ${picked.name}`}
          </AppText>
          <LocalizedFloatInput
            label="Quantity"
            value={undefined}
            onChangeText={setQuantityText}
            error={error}
          />
          <UnitChoice label={`Unit for ${picked.name}`} value={unit} onChange={setUnit} />
          <View className="mt-2 flex-row gap-2">
            {/* biome-ignore lint/performance/noJsxPropsBind: closes over the picker state; short list. */}
            <AppButton variant="primary" disabled={adding} onPress={confirm}>
              Add
            </AppButton>
            {/* biome-ignore lint/performance/noJsxPropsBind: closes over the picker state; short list. */}
            <AppButton variant="ghost" onPress={reset}>
              Cancel
            </AppButton>
          </View>
        </View>
      ) : (
        // biome-ignore lint/performance/noJsxPropsBind: handlers close over this row's state; short list.
        <AppButton variant="ghost" className="self-start px-2" onPress={openPicker}>
          Add material
        </AppButton>
      )}
      <SingleSelectFilterModal
        visible={pickerOpen}
        // biome-ignore lint/performance/noJsxPropsBind: handlers close over this row's state; short list.
        onDismiss={closePicker}
        title="Add material"
        items={available.map((o) => String(o.id))}
        labels={labels}
        isLoading={loading}
        value=""
        // biome-ignore lint/performance/noJsxPropsBind: handlers close over this row's state; short list.
        onValueChange={pick}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search materials"
        allowNew={false}
      />
    </View>
  );
}

/** Non-blocking notes: a polite live region, so a screen reader hears one appear without losing its place. */
function Warnings({ messages }: { messages: string[] }) {
  const theme = useAppTheme();
  const text = messages.join(' ');
  // VoiceOver ignores accessibilityLiveRegion, so iOS gets an explicit announcement.
  useEffect(() => {
    if (text && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(text);
  }, [text]);

  if (messages.length === 0) return null;
  return (
    <View accessibilityLiveRegion="polite" role="status" className="mb-2 gap-1 px-4">
      {messages.map((message) => (
        <AppText key={message} variant="caption" style={{ color: theme.tokens.status.warning }}>
          {message}
        </AppText>
      ))}
    </View>
  );
}
