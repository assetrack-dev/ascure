import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { Feather } from '@expo/vector-icons';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { ErrorBanner } from '../ui';
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
    <SafeAreaView style={styles.backdrop} edges={['bottom']}>
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
          {/* Dark radial hero: layered dark surfaces + a faint blueprint grid,
              approximated with theme dark tokens (no gradient/asset deps). */}
          <View style={styles.hero}>
            <View style={styles.heroGlow} pointerEvents="none" />
            <BlueprintGrid theme={theme} />
            <View style={styles.brand}>
              <View style={styles.logoTile}>
                <Image
                  source={require('../../assets/brand/monogram.png')}
                  style={styles.logo}
                  resizeMode="contain"
                  accessibilityLabel="ASCURE"
                />
              </View>
              <Text style={styles.wordmark}>ASCURE</Text>
              <Text style={styles.tagline}>Asset Inspection Platform</Text>
            </View>
          </View>

          {/* White sheet with a 26px top radius overlapping the hero. */}
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Sign in</Text>
            <Text style={styles.sheetSubtitle}>Field access · works offline</Text>

            <View style={styles.field}>
              <Text style={styles.label}>Work email</Text>
              <View style={styles.inputWrap}>
                <Feather
                  name="mail"
                  size={18}
                  color={theme.colors.textMuted}
                  style={styles.leadingIcon}
                />
                <TextInput
                  style={[styles.input, styles.inputWithLeading]}
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
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputWrap}>
                <Feather
                  name="lock"
                  size={18}
                  color={theme.colors.textMuted}
                  style={styles.leadingIcon}
                />
                <TextInput
                  style={[styles.input, styles.inputWithLeading, styles.inputWithAction]}
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

            {/* Full-width blue Sign In (58 tall). Uses the exact handleLogin
                handler + canSubmit gate; only the chrome differs from AppButton. */}
            <Pressable
              accessibilityRole="button"
              disabled={!canSubmit}
              onPress={handleLogin}
              style={({ pressed }) => [
                styles.signIn,
                !canSubmit && styles.signInDisabled,
                pressed && canSubmit && styles.signInPressed,
              ]}
            >
              {isSubmitting ? (
                <ActivityIndicator color={theme.colors.textOnPrimary} />
              ) : null}
              <Text style={[styles.signInText, !canSubmit && styles.signInTextDisabled]}>
                {isSubmitting ? 'Signing in...' : 'Sign In'}
              </Text>
            </Pressable>

            <View style={styles.footerRow}>
              <View style={styles.footerDot} />
              <Text style={styles.footnote}>Secure field access · Works offline</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Faint blueprint grid: layered hairline Views on the dark hero. Pure decoration. */
function BlueprintGrid({ theme }: { theme: Theme }) {
  const line = theme.colors.chromeBorder;
  const verticals = [0.18, 0.38, 0.58, 0.78];
  const horizontals = [0.22, 0.46, 0.7];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {verticals.map((left) => (
        <View
          key={`v-${left}`}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${left * 100}%`,
            width: 1,
            backgroundColor: line,
          }}
        />
      ))}
      {horizontals.map((top) => (
        <View
          key={`h-${top}`}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: `${top * 100}%`,
            height: 1,
            backgroundColor: line,
          }}
        />
      ))}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: {
      flex: 1,
    },
    backdrop: {
      flex: 1,
      // Dark hero base — dark chrome token so top safe-area matches the hero.
      backgroundColor: t.colors.chrome,
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: 'flex-end',
    },
    hero: {
      flexGrow: 1,
      minHeight: 300,
      backgroundColor: t.colors.chrome,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      paddingTop: 72,
      paddingBottom: 56,
      overflow: 'hidden',
    },
    // Soft central glow — a rounded translucent panel behind the monogram.
    heroGlow: {
      position: 'absolute',
      top: '18%',
      width: 320,
      height: 320,
      borderRadius: 160,
      backgroundColor: t.colors.chromePanel,
      opacity: 0.5,
    },
    brand: {
      alignItems: 'center',
      gap: 14,
    },
    logoTile: {
      width: 96,
      height: 96,
      borderRadius: 26,
      backgroundColor: '#FFFFFF',
      alignItems: 'center',
      justifyContent: 'center',
      ...t.shadow.raised,
    },
    logo: {
      width: 60,
      height: 60,
    },
    wordmark: {
      fontFamily: t.fonts.display,
      fontSize: 30,
      fontWeight: '700',
      letterSpacing: 8,
      color: '#FFFFFF',
      textAlign: 'center',
      marginTop: 4,
    },
    tagline: {
      fontFamily: t.fonts.monoMedium,
      fontSize: 11,
      letterSpacing: 3,
      textTransform: 'uppercase',
      color: t.colors.onChromeMuted,
      textAlign: 'center',
    },
    sheet: {
      backgroundColor: t.colors.card,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      paddingHorizontal: 24,
      paddingTop: 28,
      paddingBottom: 28,
      gap: 16,
    },
    sheetTitle: {
      fontFamily: t.fonts.display,
      fontSize: 24,
      fontWeight: '700',
      letterSpacing: -0.4,
      color: t.colors.textPrimary,
    },
    sheetSubtitle: {
      fontFamily: t.fonts.body,
      fontSize: 13,
      color: t.colors.textSecondary,
      marginTop: -8,
    },
    field: {
      gap: 7,
    },
    label: {
      fontFamily: t.fonts.mono,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: t.colors.textMuted,
    },
    inputWrap: {
      justifyContent: 'center',
    },
    leadingIcon: {
      position: 'absolute',
      left: 16,
      zIndex: 1,
    },
    input: {
      minHeight: 56,
      borderRadius: t.radius.control,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      backgroundColor: t.colors.surfaceMuted,
      paddingHorizontal: 16,
      fontSize: 15,
      fontFamily: t.fonts.body,
      color: t.colors.textPrimary,
    },
    inputWithLeading: {
      paddingLeft: 46,
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
      fontFamily: t.fonts.bodyBold,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1,
      color: t.colors.primary,
    },
    submit: {
      marginTop: 4,
    },
    signIn: {
      minHeight: 58,
      borderRadius: t.radius.control,
      backgroundColor: t.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 10,
      paddingHorizontal: 18,
      marginTop: 4,
      ...t.shadow.cta,
    },
    signInDisabled: {
      backgroundColor: t.colors.surfaceMuted,
      shadowOpacity: 0,
      elevation: 0,
    },
    signInPressed: {
      backgroundColor: t.colors.primaryStrong,
      transform: [{ scale: 0.99 }],
    },
    signInText: {
      fontFamily: t.fonts.display,
      fontSize: 17,
      fontWeight: '700',
      letterSpacing: 0.2,
      color: t.colors.textOnPrimary,
    },
    signInTextDisabled: {
      color: t.colors.textMuted,
    },
    footerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 2,
    },
    footerDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: t.colors.success,
    },
    footnote: {
      fontFamily: t.fonts.bodySemibold,
      fontSize: 12,
      fontWeight: '600',
      color: t.colors.textSecondary,
      textAlign: 'center',
    },
  });
