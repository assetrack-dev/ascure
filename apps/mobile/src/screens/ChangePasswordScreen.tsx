import { useState } from 'react';
import { api } from '../api';
import { useSession } from '../context/AuthContext';
import { AppButton, BodyText, Card, ErrorBanner, Screen, TextField } from '../ui';

export function ChangePasswordScreen() {
  const { token, user, setUser, signOut } = useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    if (newPassword === currentPassword) {
      setError('New password must be different from your current password.');
      return;
    }

    try {
      setIsSubmitting(true);
      // The endpoint returns the refreshed user (mustChangePassword cleared);
      // updating the session swaps the RootNavigator into the main app.
      const refreshed = await api.changePassword(token, currentPassword, newPassword);
      setUser(refreshed);
    } catch (changeError) {
      setError(
        changeError instanceof Error ? changeError.message : 'Unable to change password.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen
      title="Set a new password"
      subtitle="You must set a new password before continuing."
      keyboardAware
    >
      <Card>
        <BodyText muted>Signed in as {user.email}</BodyText>
        <TextField
          label="Current (temporary) password"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          placeholder="Enter current password"
          secureTextEntry
        />
        <TextField
          label="New password"
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="At least 8 characters"
          secureTextEntry
        />
        <TextField
          label="Confirm new password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Re-enter new password"
          secureTextEntry
        />
        <ErrorBanner message={error} />
        <AppButton
          label={isSubmitting ? 'Saving...' : 'Update password'}
          onPress={handleSubmit}
          loading={isSubmitting}
          disabled={!currentPassword || !newPassword || !confirmPassword}
        />
        <AppButton label="Sign out" variant="secondary" onPress={signOut} />
      </Card>
    </Screen>
  );
}
