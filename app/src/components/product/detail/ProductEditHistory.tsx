import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { View } from 'react-native';
import { AppText } from '@/components/base/AppText';
import { ErrorState } from '@/components/base/ErrorState';
import { useAuth } from '@/context/auth';
import { getRevisions } from '@/services/api/products';
import type { ApiProductRevision } from '@/types/api';
import type { Product } from '@/types/Product';
import { getErrorMessage } from '@/utils/errors';

const FIELD_LABELS: Record<string, string> = {
  name: 'name',
  description: 'description',
  brand: 'brand',
  model: 'model',
  product_type_id: 'type',
  amount_in_parent: 'amount',
  weight_g: 'weight',
  height_cm: 'height',
  width_cm: 'width',
  depth_cm: 'depth',
  circularity_properties: 'circularity',
};

function editorLabel(revision: ApiProductRevision): string {
  if (revision.editor_username) return revision.editor_username;
  return revision.by_moderator ? 'A moderator' : 'Hidden';
}

function RevisionRow({ revision }: { revision: ApiProductRevision }) {
  const fields = revision.changed_fields.map((field) => FIELD_LABELS[field] ?? field).join(', ');
  return (
    <View className="gap-0.5 py-1">
      <AppText variant="caption" className="text-muted-foreground">
        {new Date(revision.created_at).toLocaleString()} · {editorLabel(revision)}
      </AppText>
      <AppText variant="data">Changed {fields || 'nothing'}</AppText>
    </View>
  );
}

/** The edit list under "Last updated": time, editor and changed fields, newest first. */
export default function ProductEditHistory({ product }: { product: Product }) {
  const id = product.id;
  // The viewer decides what the server returns (values for the owner and admins only).
  const viewerID = useAuth().user?.id;
  const query = useQuery({
    queryKey: ['revisions', product.role, id, product.version, viewerID] as const,
    queryFn: () => getRevisions(id as number, product.role, viewerID !== undefined),
    enabled: typeof id === 'number',
  });
  const retry = useCallback(() => void query.refetch(), [query]);

  if (query.isError) {
    return (
      <ErrorState
        compact
        title="Couldn't load the edit history"
        message={getErrorMessage(query.error, 'Check your connection and try again.')}
        onRetry={retry}
      />
    );
  }
  if (!query.data) {
    return <AppText variant="caption">Loading edits…</AppText>;
  }
  const { items, total } = query.data;
  return (
    <View testID="edit-history" accessibilityLabel="Edit history">
      {items.length === 0 ? (
        <AppText variant="caption">
          No edits recorded. Edits made before edit history was added are not listed.
        </AppText>
      ) : (
        items.map((revision) => <RevisionRow key={revision.id} revision={revision} />)
      )}
      {total > items.length ? (
        <AppText variant="caption" className="text-muted-foreground">
          Showing the latest {items.length} of {total} edits.
        </AppText>
      ) : null}
    </View>
  );
}
