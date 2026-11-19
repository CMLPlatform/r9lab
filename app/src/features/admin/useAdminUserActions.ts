import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useAppFeedback } from '@/hooks/useAppFeedback';
import type { AdminUser, ErasureContent } from '@/services/api/adminUsers';
import { getErrorMessage } from '@/utils/errors';
import { useAdminUserMutations } from './queries';

const ERASE_COPY: Record<ErasureContent, string> = {
  anonymize:
    'This deletes the account and its personal data. Its products stay on R9lab without a name. You cannot undo this.',
  delete:
    'This deletes the account, its personal data, and every product it recorded with their photos and files. You cannot undo this.',
};

/** Each admin action on one user: a confirmation through the dialog provider, then the call. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one hook per screen keeps the confirm-then-call flows side by side.
export function useAdminUserActions(user: AdminUser) {
  const router = useRouter();
  const feedback = useAppFeedback();
  const { setRole, setActive, resetMfa, erase } = useAdminUserMutations(user.id);
  const { mutate: mutateRole } = setRole;
  const { mutate: mutateActive } = setActive;
  const { mutate: mutateResetMfa } = resetMfa;
  const { mutate: mutateErase } = erase;
  const name = user.username ?? user.email;
  const nextRole = user.role === 'lab' ? 'contributor' : 'lab';

  const fail = useCallback(
    (fallback: string) => (error: unknown) => feedback.error(getErrorMessage(error, fallback)),
    [feedback],
  );

  const changeRole = useCallback(
    () =>
      feedback.alert({
        title: nextRole === 'lab' ? 'Make this a lab account?' : 'Make this a contributor account?',
        message:
          nextRole === 'lab'
            ? `${name} can then upload research files and gets the larger upload quota.`
            : `${name} loses research-file uploads and the larger quota. Files already stored stay.`,
        buttons: [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Change role',
            onPress: () =>
              mutateRole(nextRole, {
                onSuccess: () => feedback.toast('Role changed.'),
                onError: fail("Couldn't change the role."),
              }),
          },
        ],
      }),
    [feedback, fail, mutateRole, name, nextRole],
  );

  const resetTwoStep = useCallback(
    () =>
      feedback.alert({
        title: 'Reset two-step verification?',
        message: `Only do this after you have confirmed who is asking. ${name} can then sign in with just a password and set it up again.`,
        buttons: [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Reset',
            style: 'destructive',
            onPress: () =>
              mutateResetMfa(undefined, {
                onSuccess: () => feedback.toast('Two-step verification reset.'),
                onError: fail("Couldn't reset two-step verification."),
              }),
          },
        ],
      }),
    [feedback, fail, mutateResetMfa, name],
  );

  const setAccountActive = useCallback(
    (isActive: boolean) =>
      feedback.alert({
        title: isActive ? 'Reactivate this account?' : 'Suspend this account?',
        message: isActive
          ? `${name} can sign in again.`
          : `${name} is signed out everywhere and cannot sign in until you reactivate the account. Their products stay.`,
        buttons: [
          { text: 'Cancel', style: 'cancel' },
          {
            text: isActive ? 'Reactivate' : 'Suspend',
            style: isActive ? 'default' : 'destructive',
            onPress: () =>
              mutateActive(isActive, {
                onSuccess: () =>
                  feedback.toast(isActive ? 'Account reactivated.' : 'Account suspended.'),
                onError: fail("Couldn't change the account status."),
              }),
          },
        ],
      }),
    [feedback, fail, mutateActive, name],
  );
  const suspend = useCallback(() => setAccountActive(false), [setAccountActive]);
  const reactivate = useCallback(() => setAccountActive(true), [setAccountActive]);

  // Second step: typing the email is the strong confirmation an erasure needs.
  const confirmErase = useCallback(
    (content: ErasureContent) =>
      feedback.input({
        title: content === 'delete' ? 'Delete account and products?' : 'Delete account?',
        message: `${ERASE_COPY[content]}\n\nType ${user.email} to confirm.`,
        placeholder: user.email,
        buttons: [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            disabled: (value) => value.trim().toLowerCase() !== user.email.toLowerCase(),
            onPress: () =>
              mutateErase(content, {
                onSuccess: () => {
                  feedback.toast('Account deleted.');
                  router.navigate('/admin/users');
                },
                onError: fail("Couldn't delete the account."),
              }),
          },
        ],
      }),
    [feedback, fail, mutateErase, router, user.email],
  );
  // First step: what happens to the products the account recorded.
  const eraseAccount = useCallback(
    () =>
      feedback.alert({
        title: 'Delete this account?',
        message: 'Choose what happens to the products it recorded.',
        buttons: [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Keep products', onPress: () => confirmErase('anonymize') },
          {
            text: 'Delete products too',
            style: 'destructive',
            onPress: () => confirmErase('delete'),
          },
        ],
      }),
    [feedback, confirmErase],
  );

  return { nextRole, changeRole, resetTwoStep, suspend, reactivate, eraseAccount };
}
