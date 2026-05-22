import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  DimensionValue,
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
import { Feather } from '@expo/vector-icons';

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
    primary: '#0F766E',
    primaryStrong: '#115E59',
    primarySoft: '#CCFBF1',
    background: '#F5F7FA',
    card: '#FFFFFF',
    border: '#E5E7EB',
    textPrimary: '#111827',
    textSecondary: '#6B7280',
    textMuted: '#9CA3AF',
    textOnPrimary: '#FFFFFF',
    surfaceMuted: '#F9FAFB',
    surfacePressed: '#F3F4F6',
    danger: '#B91C1C',
    dangerSoft: '#FEF2F2',
    dangerBorder: '#FECACA',
    success: '#166534',
    successSoft: '#ECFDF5',
    successBorder: '#BBF7D0',
    warning: '#92400E',
    warningSoft: '#FFFBEB',
    warningBorder: '#FDE68A',
    info: '#1D4ED8',
    infoSoft: '#EFF6FF',
    infoBorder: '#BFDBFE',
  },
  radius: {
    card: 12,
    control: 10,
    pill: 999,
  },
  spacing: {
    screen: 16,
    section: 12,
    card: 12,
  },
  shadow: {
    card: {
      shadowColor: '#0F172A',
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    raised: {
      shadowColor: '#0F172A',
      shadowOpacity: 0.1,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
      elevation: 6,
    },
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

const HEADER_ICON_GLYPHS: Record<HeaderIconName, keyof typeof Feather.glyphMap> = {
  back: 'chevron-left',
  menu: 'menu',
  refresh: 'refresh-cw',
  close: 'x',
  add: 'plus',
};

function HeaderIcon({ name }: { name: HeaderIconName }) {
  return <Feather name={HEADER_ICON_GLYPHS[name]} size={22} color={uiTheme.colors.textPrimary} />;
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

export function Skeleton({
  height = 14,
  width = '100%',
  radius = uiTheme.radius.control,
}: {
  height?: number;
  width?: DimensionValue;
  radius?: number;
}) {
  const pulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );

    animation.start();

    return () => animation.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={{
        height,
        width,
        borderRadius: radius,
        backgroundColor: uiTheme.colors.surfacePressed,
        opacity: pulse,
      }}
    />
  );
}

export function SkeletonCard() {
  return (
    <View style={styles.card}>
      <Skeleton height={16} width="55%" />
      <Skeleton height={12} width="85%" />
      <Skeleton height={12} width="40%" />
    </View>
  );
}

export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon?: keyof typeof Feather.glyphMap;
}) {
  return (
    <View style={styles.emptyState}>
      {icon ? (
        <View style={styles.emptyIconCircle}>
          <Feather name={icon} size={22} color={uiTheme.colors.textSecondary} />
        </View>
      ) : null}
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
        pressed && !(disabled || loading) && variant === 'primary' && styles.buttonPrimaryPressed,
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
  autoCapitalize = 'none',
}: {
  label: string;
  value: string;
  onChangeText: (nextValue: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  editable?: boolean;
  multiline?: boolean;
  autoCapitalize?: TextInputProps['autoCapitalize'];
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
        autoCapitalize={autoCapitalize}
      />
    </View>
  );
}

export type DropdownOption = {
  label: string;
  value: string;
  description?: string | null;
};

const DROPDOWN_SEARCH_THRESHOLD = 5;

export function Dropdown({
  label,
  value,
  options,
  placeholder = 'Select an option',
  onSelect,
  disabled = false,
}: {
  label?: string;
  value: string;
  options: DropdownOption[];
  placeholder?: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedOption = options.find((option) => option.value === value) ?? null;
  const showSearch = options.length > DROPDOWN_SEARCH_THRESHOLD;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) => option.label.toLowerCase().includes(normalizedQuery))
    : options;

  function handleSelect(nextValue: string) {
    onSelect(nextValue);
    setIsOpen(false);
    setQuery('');
  }

  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => setIsOpen((current) => !current)}
        style={({ pressed }) => [
          styles.dropdownControl,
          isOpen && styles.dropdownControlOpen,
          disabled && styles.inputDisabled,
          pressed && !disabled && styles.dropdownControlPressed,
        ]}
      >
        <Text
          style={[styles.dropdownValue, !selectedOption && styles.dropdownPlaceholder]}
          numberOfLines={1}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </Text>
        <Feather
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={uiTheme.colors.textSecondary}
        />
      </Pressable>

      {isOpen ? (
        <View style={styles.dropdownPanel}>
          {showSearch ? (
            <View style={styles.dropdownSearchWrap}>
              <Feather name="search" size={16} color={uiTheme.colors.textMuted} />
              <TextInput
                style={styles.dropdownSearchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search..."
                placeholderTextColor={uiTheme.colors.textMuted}
                autoCapitalize="none"
              />
            </View>
          ) : null}
          <ScrollView
            style={styles.dropdownList}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            {filteredOptions.length === 0 ? (
              <Text style={styles.dropdownEmptyText}>No matches found.</Text>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = option.value === value;

                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    onPress={() => handleSelect(option.value)}
                    style={({ pressed }) => [
                      styles.dropdownOption,
                      isSelected && styles.dropdownOptionSelected,
                      pressed && styles.dropdownOptionPressed,
                    ]}
                  >
                    <View style={styles.dropdownOptionTextWrap}>
                      <Text style={styles.dropdownOptionLabel} numberOfLines={1}>
                        {option.label}
                      </Text>
                      {option.description ? (
                        <Text style={styles.dropdownOptionDescription} numberOfLines={1}>
                          {option.description}
                        </Text>
                      ) : null}
                    </View>
                    {isSelected ? (
                      <Feather name="check" size={16} color={uiTheme.colors.primary} />
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      ) : null}
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
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}) {
  return (
    <View
      style={[
        styles.chip,
        tone === 'success' && styles.chipSuccess,
        tone === 'warning' && styles.chipWarning,
        tone === 'danger' && styles.chipDanger,
        tone === 'info' && styles.chipInfo,
      ]}
    >
      <Text
        style={[
          styles.chipText,
          tone === 'success' && styles.chipTextSuccess,
          tone === 'warning' && styles.chipTextWarning,
          tone === 'danger' && styles.chipTextDanger,
          tone === 'info' && styles.chipTextInfo,
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
    paddingBottom: 8,
    gap: 6,
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
    fontSize: 12,
    lineHeight: 16,
    color: uiTheme.colors.textSecondary,
    textAlign: 'center',
  },
  scrollContent: {
    paddingHorizontal: uiTheme.spacing.screen,
    paddingBottom: 128,
    gap: uiTheme.spacing.section,
  },
  content: {
    flex: 1,
    paddingHorizontal: uiTheme.spacing.screen,
    gap: uiTheme.spacing.section,
  },
  footer: {
    paddingHorizontal: uiTheme.spacing.screen,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.background,
    gap: 12,
  },
  card: {
    backgroundColor: uiTheme.colors.card,
    borderRadius: uiTheme.radius.card,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    ...uiTheme.shadow.card,
  },
  sectionTitle: {
    fontSize: 15,
    lineHeight: 20,
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
  emptyIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiTheme.colors.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    marginBottom: 2,
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
    minHeight: 46,
    borderRadius: uiTheme.radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
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
  buttonPrimaryPressed: {
    backgroundColor: uiTheme.colors.primaryStrong,
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
    minHeight: 36,
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
    gap: 6,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: uiTheme.colors.textSecondary,
  },
  textInput: {
    minHeight: 46,
    borderRadius: uiTheme.radius.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: uiTheme.colors.textPrimary,
  },
  textArea: {
    minHeight: 78,
    textAlignVertical: 'top',
  },
  inputDisabled: {
    backgroundColor: uiTheme.colors.surfaceMuted,
    color: uiTheme.colors.textSecondary,
  },
  keyValueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  keyValueLabel: {
    flex: 1,
    fontSize: 13,
    color: uiTheme.colors.textSecondary,
  },
  keyValueValueWrap: {
    flex: 1.2,
    alignItems: 'flex-end',
  },
  keyValueValue: {
    fontSize: 13,
    color: uiTheme.colors.textPrimary,
    fontWeight: '500',
    textAlign: 'right',
  },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: uiTheme.radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
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
  chipDanger: {
    backgroundColor: uiTheme.colors.dangerSoft,
    borderColor: uiTheme.colors.dangerBorder,
  },
  chipInfo: {
    backgroundColor: uiTheme.colors.infoSoft,
    borderColor: uiTheme.colors.infoBorder,
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
  chipTextDanger: {
    color: uiTheme.colors.danger,
  },
  chipTextInfo: {
    color: uiTheme.colors.info,
  },
  selectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
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
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: uiTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectIndicatorInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: uiTheme.colors.primary,
  },
  selectTextWrap: {
    flex: 1,
    gap: 4,
  },
  selectTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: uiTheme.colors.textPrimary,
  },
  selectDescription: {
    fontSize: 12,
    color: uiTheme.colors.textSecondary,
  },
  dropdownControl: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: uiTheme.radius.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dropdownControlOpen: {
    borderColor: uiTheme.colors.primary,
  },
  dropdownControlPressed: {
    backgroundColor: uiTheme.colors.surfacePressed,
  },
  dropdownValue: {
    flex: 1,
    fontSize: 15,
    color: uiTheme.colors.textPrimary,
    fontWeight: '600',
  },
  dropdownPlaceholder: {
    color: uiTheme.colors.textMuted,
    fontWeight: '400',
  },
  dropdownPanel: {
    marginTop: 6,
    borderRadius: uiTheme.radius.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.card,
    overflow: 'hidden',
    ...uiTheme.shadow.card,
  },
  dropdownSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.surfaceMuted,
  },
  dropdownSearchInput: {
    flex: 1,
    minHeight: 42,
    fontSize: 14,
    color: uiTheme.colors.textPrimary,
    paddingVertical: 8,
  },
  dropdownList: {
    maxHeight: 250,
  },
  dropdownEmptyText: {
    fontSize: 13,
    color: uiTheme.colors.textSecondary,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: uiTheme.colors.surfaceMuted,
  },
  dropdownOptionSelected: {
    backgroundColor: uiTheme.colors.primarySoft,
  },
  dropdownOptionPressed: {
    backgroundColor: uiTheme.colors.surfacePressed,
  },
  dropdownOptionTextWrap: {
    flex: 1,
    gap: 2,
  },
  dropdownOptionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: uiTheme.colors.textPrimary,
  },
  dropdownOptionDescription: {
    fontSize: 12,
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
});
