import { useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { AppButton, Card, ErrorBanner, Screen, TextField } from '../ui';
import { Theme, useTheme } from '../theme';

export function LoginScreen() {
  const { signIn } = useAuth();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin() {
    try {
      setIsSubmitting(true);
      setError(null);

      const response = await api.login(email.trim(), password);
      await signIn(response.access_token, response.user);
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
      <View style={styles.brandLockup}>
        <Image
          source={require('../../assets/brand/monogram.png')}
          style={styles.brandMark}
          resizeMode="contain"
          accessibilityLabel="ASCURE"
        />
        <Text style={styles.brandWordmark}>ASCURE</Text>
        <Text style={styles.brandTagline}>Asset Inspection Platform</Text>
      </View>
      <Card>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="name@ascure.local"
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

const createStyles = (t: Theme) =>
  StyleSheet.create({
    brandLockup: {
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
    },
    brandMark: {
      width: 72,
      height: 72,
      borderRadius: 20,
    },
    brandWordmark: {
      fontSize: 22,
      fontWeight: '800',
      letterSpacing: 3,
      color: t.colors.textPrimary,
    },
    brandTagline: {
      fontSize: 13,
      fontWeight: '500',
      color: t.colors.textSecondary,
    },
  });
