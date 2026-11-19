import { View } from 'react-native';
import DetailSectionHeader from '@/components/base/DetailSectionHeader';
import { ProductTypeField } from '@/components/product/ProductTypeField';
import { entityLabel, type Product, typeRowLabels } from '@/types/Product';

interface Props {
  product: Product;
  editMode: boolean;
  onTypeChange?: (newType: number) => void;
}

const NOOP = () => {};

export default function ProductType({ product, editMode, onTypeChange = NOOP }: Props) {
  // View mode states the type in OverviewFacts; this is the edit control.
  if (!editMode) return null;

  return (
    <View>
      <DetailSectionHeader
        title={typeRowLabels(product.role).title}
        tooltipTitle={`Select a fitting category for the ${entityLabel(product)}.`}
      />
      <ProductTypeField
        typeID={product.productTypeID}
        recorded={product.productType}
        entityRole={product.role}
        onTypeChange={onTypeChange}
      />
    </View>
  );
}
