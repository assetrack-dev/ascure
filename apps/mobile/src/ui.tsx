import { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Screen({
  title,
  subtitle,
  children,
  actions,
  footer,
  scroll = true,
  keyboardAware = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  keyboardAware?: boolean;
}) {
  const content = scroll ? (
    <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={styles.content}>{children}</View>
  );

  const body = (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {actions ? <View style={styles.headerActions}>{actions}</View> : null}
      </View>
      {content}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );

  if (!keyboardAware) {
    return body;
  }

  return (
    <KeyboardAvoidingView
      style={styles.keyboardRoot}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {body}
    </KeyboardAvoidingView>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function BodyText({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <Text style={muted ? styles.bodyMuted : styles.bodyText}>{children}</Text>;
}

export function ErrorBanner({ message }: { message?: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <View style={styles.loadingBlock}>
      <ActivityIndicator size="large" color="#0f5cd8" />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

export function LoadingScreen({ label }: { label: string }) {
  return (
    <View style={styles.loadingScreen}>
      <StatusBar style="dark" />
      <ActivityIndicator size="large" color="#0f5cd8" />
      <Text style={styles.loadingScreenText}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
    </View>
  );
}

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[buttonVariantStyles[variant]],
        (disabled || loading) && styles.buttonDisabled,
        pressed && !(disabled || loading) && styles.buttonPressed,
      ]}
    >
      {loading ? <ActivityIndicator color={variant === 'secondary' ? '#0f172a' : '#ffffff'} /> : null}
      <Text style={[styles.buttonText, styles[buttonLabelStyles[variant]]]}>{label}</Text>
    </Pressable>
  );
}

export function InlineButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={styles.inlineButton}>
      <Text style={[styles.inlineButtonText, disabled && styles.inlineButtonDisabled]}>{label}</Text>
    </Pressable>
  );
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  keyboardType,
  editable = true,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (nextValue: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'numeric' | 'email-address';
  editable?: boolean;
  multiline?: boolean;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.textInput, multiline && styles.textArea, !editable && styles.inputDisabled]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#7b8aa3"
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        editable={editable}
        multiline={multiline}
        autoCapitalize="none"
      />
    </View>
  );
}

export function KeyValueRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <View style={styles.keyValueRow}>
      <Text style={styles.keyValueLabel}>{label}</Text>
      <View style={styles.keyValueValueWrap}>
        {typeof value === 'string' ? <Text style={styles.keyValueValue}>{value}</Text> : value}
      </View>
    </View>
  );
}

export function StatusChip({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'warning';
}) {
  return (
    <View
      style={[
        styles.chip,
        tone === 'success' && styles.chipSuccess,
        tone === 'warning' && styles.chipWarning,
      ]}
    >
      <Text
        style={[
          styles.chipText,
          tone === 'success' && styles.chipTextSuccess,
          tone === 'warning' && styles.chipTextWarning,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export function SelectCard({
  label,
  selected,
  onPress,
  description,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  description?: string | null;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.selectCard,
        selected && styles.selectCardSelected,
        pressed && styles.selectCardPressed,
      ]}
    >
      <View style={styles.selectIndicator}>{selected ? <View style={styles.selectIndicatorInner} /> : null}</View>
      <View style={styles.selectTextWrap}>
        <Text style={styles.selectTitle}>{label}</Text>
        {description ? <Text style={styles.selectDescription}>{description}</Text> : null}
      </View>
    </Pressable>
  );
}

const buttonVariantStyles = {
  primary: 'buttonPrimary',
  secondary: 'buttonSecondary',
  danger: 'buttonDanger',
  ghost: 'buttonGhost',
} as const;

const buttonLabelStyles = {
  primary: 'buttonTextPrimary',
  secondary: 'buttonTextSecondary',
  danger: 'buttonTextPrimary',
  ghost: 'buttonTextGhost',
} as const;

const styles = StyleSheet.create({
  keyboardRoot: {
    flex: 1,
    backgroundColor: '#f4f7fb',
  },
  screen: {
    flex: 1,
    backgroundColor: '#f4f7fb',
    paddingTop: Platform.OS === 'android' ? 24 : 16,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 12,
  },
  headerTextWrap: {
    gap: 6,
  },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#526277',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 140,
    gap: 16,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    gap: 16,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#d7deea',
    backgroundColor: '#f4f7fb',
    gap: 12,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#dce5f1',
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: '#0f172a',
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#10233d',
  },
  bodyMuted: {
    fontSize: 14,
    lineHeight: 21,
    color: '#607086',
  },
  errorBanner: {
    backgroundColor: '#fee2e2',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
    padding: 14,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#991b1b',
    fontWeight: '600',
  },
  loadingBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 12,
  },
  loadingText: {
    fontSize: 15,
    color: '#526277',
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: '#f4f7fb',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  loadingScreenText: {
    fontSize: 16,
    color: '#526277',
    textAlign: 'center',
  },
  emptyState: {
    backgroundColor: '#eef4fb',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#d9e4f2',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  emptyDescription: {
    fontSize: 14,
    lineHeight: 21,
    color: '#526277',
  },
  button: {
    minHeight: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
  },
  buttonPrimary: {
    backgroundColor: '#0f5cd8',
  },
  buttonSecondary: {
    backgroundColor: '#e5edf8',
  },
  buttonDanger: {
    backgroundColor: '#c03636',
  },
  buttonGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#c8d6e8',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonPressed: {
    transform: [{ scale: 0.99 }],
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  buttonTextPrimary: {
    color: '#ffffff',
  },
  buttonTextSecondary: {
    color: '#10233d',
  },
  buttonTextGhost: {
    color: '#0f172a',
  },
  inlineButton: {
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  inlineButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f5cd8',
  },
  inlineButtonDisabled: {
    color: '#94a3b8',
  },
  fieldWrap: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#10233d',
  },
  textInput: {
    minHeight: 54,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#c7d5e8',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#0f172a',
  },
  textArea: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  inputDisabled: {
    backgroundColor: '#edf2f8',
    color: '#617086',
  },
  keyValueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  keyValueLabel: {
    flex: 1,
    fontSize: 14,
    color: '#607086',
  },
  keyValueValueWrap: {
    flex: 1.2,
    alignItems: 'flex-end',
  },
  keyValueValue: {
    fontSize: 14,
    color: '#0f172a',
    fontWeight: '600',
    textAlign: 'right',
  },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#e5edf8',
  },
  chipSuccess: {
    backgroundColor: '#dcfce7',
  },
  chipWarning: {
    backgroundColor: '#fef3c7',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1e293b',
  },
  chipTextSuccess: {
    color: '#166534',
  },
  chipTextWarning: {
    color: '#92400e',
  },
  selectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#c7d5e8',
    backgroundColor: '#ffffff',
  },
  selectCardSelected: {
    borderColor: '#0f5cd8',
    backgroundColor: '#eef4ff',
  },
  selectCardPressed: {
    opacity: 0.92,
  },
  selectIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#0f5cd8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectIndicatorInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#0f5cd8',
  },
  selectTextWrap: {
    flex: 1,
    gap: 4,
  },
  selectTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  selectDescription: {
    fontSize: 13,
    color: '#607086',
  },
});
