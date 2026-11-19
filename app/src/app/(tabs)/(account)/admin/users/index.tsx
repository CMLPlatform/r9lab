import { AdminGate } from '@/components/admin/AdminGate';
import { AdminUsersList } from '@/components/admin/AdminUsersList';

export default function AdminUsersScreen() {
  return (
    <AdminGate redirectTo="/admin/users">
      <AdminUsersList />
    </AdminGate>
  );
}
