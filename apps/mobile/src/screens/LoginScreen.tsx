import { useMemo, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { AppButton, ErrorBanner } from '../ui';
import { Theme, useTheme } from '../theme';

export function LoginScreen() {
  const { signIn } = useAuth();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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

  const canSubmit = Boolean(email.trim()) && Boolean(password) && !isSubmitting;

  return (
    <SafeAreaView style={styles.backdrop} edges={['top', 'bottom']}>
      <ExpoStatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <View style={styles.brand}>
              <Image
                source={require('../../assets/brand/monogram.png')}
                style={styles.logo}
                resizeMode="contain"
                accessibilityLabel="ASCURE"
              />
              <Text style={styles.wordmark}>ASCURE</Text>
              <Text style={styles.tagline}>Asset Inspection Platform</Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Work email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="name@ascure.local"
                placeholderTextColor={theme.colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  style={[styles.input, styles.inputWithAction]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter password"
                  placeholderTextColor={theme.colors.textMuted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="go"
                  onSubmitEditing={() => {
                    if (canSubmit) {
                      void handleLogin();
                    }
                  }}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  hitSlop={8}
                  onPress={() => setShowPassword((current) => !current)}
                  style={styles.showButton}
                >
                  <Text style={styles.showButtonText}>{showPassword ? 'HIDE' : 'SHOW'}</Text>
                </Pressable>
              </View>
            </View>

            <ErrorBanner message={error} />

            <View style={styles.submit}>
              <AppButton
                label={isSubmitting ? 'Signing in...' : 'Sign In'}
                onPress={handleLogin}
                loading={isSubmitting}
                disabled={!canSubmit}
              />
            </View>
          </View>

          <Text style={styles.footnote}>Secure field access · ASCURE</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: {
      flex: 1,
    },
    backdrop: {
      flex: 1,
      backgroundColor: t.colors.chrome,
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingVertical: 32,
      gap: 18,
    },
    card: {
      width: '100%',
      maxWidth: 420,
      backgroundColor: t.colors.card,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: t.colors.border,
      paddingHorizontal: 24,
      paddingVertical: 28,
      gap: 18,
      ...t.shadow.raised,
    },
    brand: {
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
    },
    logo: {
      width: 60,
      height: 60,
      borderRadius: 16,
      marginBottom: 2,
    },
    wordmark: {
      fontSize: 22,
      fontWeight: '800',
      letterSpacing: 5,
      color: t.colors.textPrimary,
      textAlign: 'center',
    },
    tagline: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 2,
      textTransform: 'uppercase',
      color: t.colors.textSecondary,
      textAlign: 'center',
    },
    field: {
      gap: 7,
    },
    label: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: t.colors.textSecondary,
    },
    inputWrap: {
      justifyContent: 'center',
    },
    input: {
      minHeight: 50,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surfaceMuted,
      paddingHorizontal: 14,
      fontSize: 15,
      color: t.colors.textPrimary,
    },
    inputWithAction: {
      paddingRight: 68,
    },
    showButton: {
      position: 'absolute',
      right: 8,
      paddingHorizontal: 8,
      paddingVertical: 8,
    },
    showButtonText: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1,
      color: t.colors.textSecondary,
    },
    submit: {
      marginTop: 2,
    },
    footnote: {
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: t.colors.onChromeMuted,
      textAlign: 'center',
    },
  });
