import { useState } from 'react';
import { api } from '../api';
import { AppButton, BodyText, Card, ErrorBanner, Screen, TextField } from '../ui';
import { SessionUser } from '../types';

export function LoginScreen({
  onAuthenticated,
}: {
  onAuthenticated: (token: string, user: SessionUser) => Promise<void>;
}) {
  const [email, setEmail] = useState('technician@ascure.local');
  const [password, setPassword] = useState('Tech123!');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin() {
    try {
      setIsSubmitting(true);
      setError(null);

      const response = await api.login(email.trim(), password);
      await onAuthenticated(response.access_token, response.user);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to sign in.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen
      title="ASCURE Field"
      subtitle="Sign in to start field check-ins, open visits, and complete dynamic inspection forms."
      keyboardAware
    >
      <Card>
        <BodyText>
          Use the technician account below for the seeded MVP flow, or replace it with another valid backend user.
        </BodyText>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="technician@ascure.local"
          keyboardType="email-address"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Enter password"
          secureTextEntry
        />
        <ErrorBanner message={error} />
        <AppButton
          label={isSubmitting ? 'Signing in...' : 'Sign In'}
          onPress={handleLogin}
          loading={isSubmitting}
          disabled={!email.trim() || !password}
        />
      </Card>
    </Screen>
  );
}
