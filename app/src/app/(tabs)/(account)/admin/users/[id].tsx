import { useLocalSearchParams } from 'expo-router';
import { AdminGate } from '@/components/admin/AdminGate';
import { AdminUserDetail } from '@/components/admin/AdminUserDetail';

export default function AdminUserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <AdminGate redirectTo={`/admin/users/${id}`}>
      <AdminUserDetail id={id} />
    </AdminGate>
  );
}
