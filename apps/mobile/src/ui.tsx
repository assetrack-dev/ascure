import { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  StatusBar as NativeStatusBar,
  View,
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type HeaderIconName = 'back' | 'menu' | 'refresh' | 'close' | 'add';

type HeaderAction = {
  icon: HeaderIconName;
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
};

export const uiTheme = {
  colors: {
    primary: '#111827',
    background: '#F5F7FA',
    card: '#FFFFFF',
    border: '#E5E7EB',
    textPrimary: '#111827',
    textSecondary: '#6B7280',
    textMuted: '#9CA3AF',
    surfaceMuted: '#F9FAFB',
    surfacePressed: '#F3F4F6',
    danger: '#B91C1C',
    dangerSoft: '#FEF2F2',
    success: '#166534',
    successSoft: '#ECFDF5',
    warning: '#92400E',
    warningSoft: '#FFFBEB',
  },
  radius: {
    card: 8,
    control: 12,
    pill: 999,
  },
  spacing: {
    screen: 20,
    section: 16,
    card: 16,
  },
} as const;

export function Screen({
  title,
  subtitle,
  children,
  actions,
  leftAction,
  rightAction,
  rightActions,
  footer,
  scroll = true,
  keyboardAware = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  leftAction?: HeaderAction;
  rightAction?: HeaderAction;
  rightActions?: HeaderAction[];
  footer?: ReactNode;
  scroll?: boolean;
  keyboardAware?: boolean;
}) {
  const headerRightActions = rightActions ?? (rightAction ? [rightAction] : []);
  const content = scroll ? (
    <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={styles.content}>{children}</View>
  );

  const body = (
    <SafeAreaView style={styles.safeArea}>
      <ExpoStatusBar style="dark" />
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.topBar}>
            <View style={styles.headerSide}>
              {leftAction ? <HeaderIconButton {...leftAction} /> : null}
            </View>
            <View style={styles.headerTextWrap}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
            </View>
            <View style={[styles.headerSide, styles.headerSideRight]}>
              {headerRightActions.map((action, index) => (
                <HeaderIconButton key={`${action.icon}-${index}`} {...action} />
              ))}
            </View>
          </View>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          {actions ? <View style={styles.headerActions}>{actions}</View> : null}
        </View>
        {content}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </SafeAreaView>
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

export function HeaderIconButton({
  icon,
  onPress,
  accessibilityLabel,
  disabled = false,
}: HeaderAction) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.headerIconButton,
        pressed && !disabled && styles.headerIconButtonPressed,
        disabled && styles.headerIconButtonDisabled,
      ]}
    >
      <HeaderIcon name={icon} />
    </Pressable>
  );
}

function HeaderIcon({ name }: { name: HeaderIconName }) {
  if (name === 'menu') {
    return (
      <View style={styles.menuIcon}>
        <View style={styles.menuIconLine} />
        <View style={styles.menuIconLine} />
        <View style={styles.menuIconLine} />
      </View>
    );
  }

  if (name === 'refresh') {
    return (
      <View style={styles.refreshIcon}>
        <View style={styles.refreshArc} />
        <View style={styles.refreshHead} />
      </View>
    );
  }

  if (name === 'close') {
    return (
      <View style={styles.closeIcon}>
        <View style={[styles.closeIconLine, styles.closeIconLineForward]} />
        <View style={[styles.closeIconLine, styles.closeIconLineBack]} />
      </View>
    );
  }

  if (name === 'add') {
    return (
      <View style={styles.addIcon}>
        <View style={styles.addIconHorizontal} />
        <View style={styles.addIconVertical} />
      </View>
    );
  }

  return (
    <View style={styles.backIcon}>
      <View style={[styles.backIconLine, styles.backIconLineTop]} />
      <View style={[styles.backIconLine, styles.backIconLineBottom]} />
    </View>
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

export function SuccessBanner({ message }: { message?: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <View style={styles.successBanner}>
      <Text style={styles.successText}>{message}</Text>
    </View>
  );
}

export function WarningBanner({ message }: { message?: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <View style={styles.warningBanner}>
      <Text style={styles.warningText}>{message}</Text>
    </View>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <View style={styles.loadingBlock}>
      <ActivityIndicator size="large" color={uiTheme.colors.primary} />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

export function LoadingScreen({ label }: { label: string }) {
  return (
    <SafeAreaView style={styles.loadingScreen}>
      <ExpoStatusBar style="dark" />
      <ActivityIndicator size="large" color={uiTheme.colors.primary} />
      <Text style={styles.loadingScreenText}>{label}</Text>
    </SafeAreaView>
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
      {loading ? (
        <ActivityIndicator
          color={variant === 'secondary' || variant === 'ghost' ? uiTheme.colors.primary : '#ffffff'}
        />
      ) : null}
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
  keyboardType?: TextInputProps['keyboardType'];
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
        placeholderTextColor={uiTheme.colors.textMuted}
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
    backgroundColor: uiTheme.colors.background,
  },
  safeArea: {
    flex: 1,
    backgroundColor: uiTheme.colors.background,
    paddingTop: Platform.OS === 'android' ? NativeStatusBar.currentHeight ?? 0 : 0,
  },
  screen: {
    flex: 1,
    backgroundColor: uiTheme.colors.background,
  },
  header: {
    paddingHorizontal: uiTheme.spacing.screen,
    paddingBottom: 10,
    gap: 8,
  },
  topBar: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerSide: {
    width: 84,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  headerTextWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSideRight: {
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: uiTheme.colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: uiTheme.colors.textSecondary,
    textAlign: 'center',
  },
  scrollContent: {
    paddingHorizontal: uiTheme.spacing.screen,
    paddingBottom: 140,
    gap: uiTheme.spacing.section,
  },
  content: {
    flex: 1,
    paddingHorizontal: uiTheme.spacing.screen,
    gap: uiTheme.spacing.section,
  },
  footer: {
    paddingHorizontal: uiTheme.spacing.screen,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.background,
    gap: 12,
  },
  card: {
    backgroundColor: uiTheme.colors.card,
    borderRadius: uiTheme.radius.card,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
  },
  sectionTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    color: uiTheme.colors.textPrimary,
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
    color: uiTheme.colors.textPrimary,
  },
  bodyMuted: {
    fontSize: 14,
    lineHeight: 21,
    color: uiTheme.colors.textSecondary,
  },
  errorBanner: {
    backgroundColor: uiTheme.colors.dangerSoft,
    borderRadius: uiTheme.radius.control,
    borderWidth: 1,
    borderColor: '#FECACA',
    padding: 14,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#991b1b',
    fontWeight: '600',
  },
  successBanner: {
    backgroundColor: uiTheme.colors.successSoft,
    borderRadius: uiTheme.radius.control,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    padding: 14,
  },
  successText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#166534',
    fontWeight: '600',
  },
  warningBanner: {
    backgroundColor: uiTheme.colors.warningSoft,
    borderRadius: uiTheme.radius.control,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 14,
  },
  warningText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#92400e',
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
    color: uiTheme.colors.textSecondary,
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: uiTheme.colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  loadingScreenText: {
    fontSize: 16,
    color: uiTheme.colors.textSecondary,
    textAlign: 'center',
  },
  emptyState: {
    backgroundColor: uiTheme.colors.surfaceMuted,
    borderRadius: uiTheme.radius.card,
    padding: 18,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: uiTheme.colors.textPrimary,
  },
  emptyDescription: {
    fontSize: 14,
    lineHeight: 21,
    color: uiTheme.colors.textSecondary,
  },
  button: {
    minHeight: 50,
    borderRadius: uiTheme.radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
  },
  buttonPrimary: {
    backgroundColor: uiTheme.colors.primary,
  },
  buttonSecondary: {
    backgroundColor: uiTheme.colors.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
  },
  buttonDanger: {
    backgroundColor: uiTheme.colors.danger,
  },
  buttonGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonPressed: {
    transform: [{ scale: 0.99 }],
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  buttonTextPrimary: {
    color: '#ffffff',
  },
  buttonTextSecondary: {
    color: uiTheme.colors.textPrimary,
  },
  buttonTextGhost: {
    color: uiTheme.colors.textPrimary,
  },
  inlineButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  inlineButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: uiTheme.colors.primary,
  },
  inlineButtonDisabled: {
    color: uiTheme.colors.textMuted,
  },
  fieldWrap: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: uiTheme.colors.textSecondary,
  },
  textInput: {
    minHeight: 52,
    borderRadius: uiTheme.radius.control,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.card,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: uiTheme.colors.textPrimary,
  },
  textArea: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  inputDisabled: {
    backgroundColor: uiTheme.colors.surfaceMuted,
    color: uiTheme.colors.textSecondary,
  },
  keyValueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  keyValueLabel: {
    flex: 1,
    fontSize: 14,
    color: uiTheme.colors.textSecondary,
  },
  keyValueValueWrap: {
    flex: 1.2,
    alignItems: 'flex-end',
  },
  keyValueValue: {
    fontSize: 14,
    color: uiTheme.colors.textPrimary,
    fontWeight: '500',
    textAlign: 'right',
  },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: uiTheme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: uiTheme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
  },
  chipSuccess: {
    backgroundColor: uiTheme.colors.successSoft,
    borderColor: '#BBF7D0',
  },
  chipWarning: {
    backgroundColor: uiTheme.colors.warningSoft,
    borderColor: '#FDE68A',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: uiTheme.colors.textPrimary,
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
    borderRadius: uiTheme.radius.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.card,
  },
  selectCardSelected: {
    borderColor: uiTheme.colors.primary,
    backgroundColor: uiTheme.colors.surfaceMuted,
  },
  selectCardPressed: {
    opacity: 0.92,
  },
  selectIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: uiTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectIndicatorInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: uiTheme.colors.primary,
  },
  selectTextWrap: {
    flex: 1,
    gap: 4,
  },
  selectTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: uiTheme.colors.textPrimary,
  },
  selectDescription: {
    fontSize: 13,
    color: uiTheme.colors.textSecondary,
  },
  headerIconButton: {
    minWidth: 38,
    minHeight: 38,
    width: 38,
    height: 38,
    borderRadius: uiTheme.radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  headerIconButtonPressed: {
    backgroundColor: uiTheme.colors.surfacePressed,
    borderColor: uiTheme.colors.border,
  },
  headerIconButtonDisabled: {
    opacity: 0.48,
  },
  menuIcon: {
    width: 18,
    gap: 4,
  },
  menuIconLine: {
    height: 2,
    borderRadius: 1,
    backgroundColor: uiTheme.colors.textPrimary,
  },
  backIcon: {
    width: 22,
    height: 22,
    position: 'relative',
  },
  backIconLine: {
    position: 'absolute',
    left: 5,
    width: 12,
    height: 2,
    borderRadius: 1,
    backgroundColor: uiTheme.colors.textPrimary,
  },
  backIconLineTop: {
    top: 6,
    transform: [{ rotate: '-45deg' }],
  },
  backIconLineBottom: {
    top: 14,
    transform: [{ rotate: '45deg' }],
  },
  refreshIcon: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshArc: {
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: uiTheme.colors.textPrimary,
    borderLeftColor: 'transparent',
    transform: [{ rotate: '24deg' }],
  },
  refreshHead: {
    position: 'absolute',
    right: 3,
    top: 4,
    width: 0,
    height: 0,
    borderTopWidth: 4,
    borderBottomWidth: 4,
    borderLeftWidth: 6,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: uiTheme.colors.textPrimary,
    transform: [{ rotate: '26deg' }],
  },
  closeIcon: {
    width: 20,
    height: 20,
    position: 'relative',
  },
  closeIconLine: {
    position: 'absolute',
    left: 2,
    top: 9,
    width: 16,
    height: 2,
    borderRadius: 1,
    backgroundColor: uiTheme.colors.textPrimary,
  },
  closeIconLineForward: {
    transform: [{ rotate: '45deg' }],
  },
  closeIconLineBack: {
    transform: [{ rotate: '-45deg' }],
  },
  addIcon: {
    width: 20,
    height: 20,
    position: 'relative',
  },
  addIconHorizontal: {
    position: 'absolute',
    left: 3,
    top: 9,
    width: 14,
    height: 2,
    borderRadius: 1,
    backgroundColor: uiTheme.colors.textPrimary,
  },
  addIconVertical: {
    position: 'absolute',
    left: 9,
    top: 3,
    width: 2,
    height: 14,
    borderRadius: 1,
    backgroundColor: uiTheme.colors.textPrimary,
  },
});
