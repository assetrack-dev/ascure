import { ReactNode, RefObject, useEffect, useMemo, useRef, useState } from 'react';
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
import { Theme, uiTheme, useTheme } from './theme';

export { uiTheme } from './theme';
export type { Theme, ThemeMode } from './theme';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
type HeaderIconName = 'back' | 'menu' | 'refresh' | 'close' | 'add';

type HeaderAction = {
  icon: HeaderIconName;
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
};

function useStyles() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return { theme, styles };
}

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
  scrollRef,
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
  scrollRef?: RefObject<ScrollView | null>;
}) {
  const { theme, styles } = useStyles();
  const headerRightActions = rightActions ?? (rightAction ? [rightAction] : []);
  const content = scroll ? (
    <ScrollView ref={scrollRef} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={styles.content}>{children}</View>
  );

  const body = (
    <SafeAreaView style={styles.safeArea}>
      <ExpoStatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
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
  const { styles } = useStyles();
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
  const theme = useTheme();
  return <Feather name={HEADER_ICON_GLYPHS[name]} size={22} color={theme.colors.textPrimary} />;
}

export function Card({ children }: { children: ReactNode }) {
  const { styles } = useStyles();
  return <View style={styles.card}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const { styles } = useStyles();
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function BodyText({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  const { styles } = useStyles();
  return <Text style={muted ? styles.bodyMuted : styles.bodyText}>{children}</Text>;
}

export function ErrorBanner({ message }: { message?: string | null }) {
  const { styles } = useStyles();
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
  const { styles } = useStyles();
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
  const { styles } = useStyles();
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
  const { theme, styles } = useStyles();
  return (
    <View style={styles.loadingBlock}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

export function LoadingScreen({ label }: { label: string }) {
  const { theme, styles } = useStyles();
  return (
    <SafeAreaView style={styles.loadingScreen}>
      <ExpoStatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      <ActivityIndicator size="large" color={theme.colors.primary} />
      <Text style={styles.loadingScreenText}>{label}</Text>
    </SafeAreaView>
  );
}

export function Skeleton({
  height = 14,
  width = '100%',
  radius,
}: {
  height?: number;
  width?: DimensionValue;
  radius?: number;
}) {
  const theme = useTheme();
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
        borderRadius: radius ?? theme.radius.control,
        backgroundColor: theme.colors.surfacePressed,
        opacity: pulse,
      }}
    />
  );
}

export function SkeletonCard() {
  const { styles } = useStyles();
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
  const { theme, styles } = useStyles();
  return (
    <View style={styles.emptyState}>
      {icon ? (
        <View style={styles.emptyIconCircle}>
          <Feather name={icon} size={22} color={theme.colors.textSecondary} />
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
  const { theme, styles } = useStyles();
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
          color={
            variant === 'secondary' || variant === 'ghost'
              ? theme.colors.primary
              : variant === 'success'
                ? theme.colors.onStatus
                : theme.colors.textOnPrimary
          }
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
  const { styles } = useStyles();
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
  const { theme, styles } = useStyles();
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.textInput, multiline && styles.textArea, !editable && styles.inputDisabled]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
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
  const { theme, styles } = useStyles();
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
          color={theme.colors.textSecondary}
        />
      </Pressable>

      {isOpen ? (
        <View style={styles.dropdownPanel}>
          {showSearch ? (
            <View style={styles.dropdownSearchWrap}>
              <Feather name="search" size={16} color={theme.colors.textMuted} />
              <TextInput
                style={styles.dropdownSearchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search..."
                placeholderTextColor={theme.colors.textMuted}
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
                      <Feather name="check" size={16} color={theme.colors.primary} />
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
  const { styles } = useStyles();
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
  const { styles } = useStyles();
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
  const { styles } = useStyles();
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
  success: 'buttonSuccess',
  ghost: 'buttonGhost',
} as const;

const buttonLabelStyles = {
  primary: 'buttonTextPrimary',
  secondary: 'buttonTextSecondary',
  danger: 'buttonTextPrimary',
  success: 'buttonTextOnStatus',
  ghost: 'buttonTextGhost',
} as const;

function createStyles(t: Theme) {
  const c = t.colors;
  return StyleSheet.create({
    keyboardRoot: {
      flex: 1,
      backgroundColor: c.background,
    },
    safeArea: {
      flex: 1,
      backgroundColor: c.background,
      paddingTop: Platform.OS === 'android' ? NativeStatusBar.currentHeight ?? 0 : 0,
    },
    screen: {
      flex: 1,
      backgroundColor: c.background,
    },
    header: {
      paddingHorizontal: t.spacing.screen,
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
      fontFamily: t.fonts.display,
      color: c.textPrimary,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 12,
      lineHeight: 16,
      fontFamily: t.fonts.body,
      color: c.textSecondary,
      textAlign: 'center',
    },
    scrollContent: {
      paddingHorizontal: t.spacing.screen,
      paddingBottom: 128,
      gap: t.spacing.section,
    },
    content: {
      flex: 1,
      paddingHorizontal: t.spacing.screen,
      gap: t.spacing.section,
    },
    footer: {
      paddingHorizontal: t.spacing.screen,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.background,
      gap: 12,
    },
    card: {
      backgroundColor: c.card,
      borderRadius: t.radius.card,
      padding: 14,
      gap: 10,
      borderWidth: 1,
      borderColor: c.border,
      ...t.shadow.card,
    },
    sectionTitle: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '600',
      fontFamily: t.fonts.display,
      color: c.textPrimary,
    },
    bodyText: {
      fontSize: 15,
      lineHeight: 22,
      fontFamily: t.fonts.body,
      color: c.textPrimary,
    },
    bodyMuted: {
      fontSize: 14,
      lineHeight: 21,
      fontFamily: t.fonts.body,
      color: c.textSecondary,
    },
    errorBanner: {
      backgroundColor: c.dangerSoft,
      borderRadius: t.radius.control,
      borderWidth: 1,
      borderColor: c.dangerBorder,
      padding: 14,
    },
    errorText: {
      fontSize: 14,
      lineHeight: 20,
      color: c.dangerText,
      fontWeight: '600',
      fontFamily: t.fonts.bodySemibold,
    },
    successBanner: {
      backgroundColor: c.successSoft,
      borderRadius: t.radius.control,
      borderWidth: 1,
      borderColor: c.successBorder,
      padding: 14,
    },
    successText: {
      fontSize: 14,
      lineHeight: 20,
      color: c.successText,
      fontWeight: '600',
      fontFamily: t.fonts.bodySemibold,
    },
    warningBanner: {
      backgroundColor: c.warningSoft,
      borderRadius: t.radius.control,
      borderWidth: 1,
      borderColor: c.warningBorder,
      padding: 14,
    },
    warningText: {
      fontSize: 14,
      lineHeight: 20,
      color: c.warningText,
      fontWeight: '600',
      fontFamily: t.fonts.bodySemibold,
    },
    loadingBlock: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 24,
      gap: 12,
    },
    loadingText: {
      fontSize: 15,
      fontFamily: t.fonts.body,
      color: c.textSecondary,
    },
    loadingScreen: {
      flex: 1,
      backgroundColor: c.background,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
      paddingHorizontal: 24,
    },
    loadingScreenText: {
      fontSize: 16,
      fontFamily: t.fonts.body,
      color: c.textSecondary,
      textAlign: 'center',
    },
    emptyState: {
      backgroundColor: c.surfaceMuted,
      borderRadius: t.radius.card,
      padding: 18,
      borderWidth: 1,
      borderColor: c.border,
      gap: 8,
    },
    emptyIconCircle: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: 2,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: '700',
      fontFamily: t.fonts.display,
      color: c.textPrimary,
    },
    emptyDescription: {
      fontSize: 14,
      lineHeight: 21,
      fontFamily: t.fonts.body,
      color: c.textSecondary,
    },
    button: {
      minHeight: 46,
      borderRadius: t.radius.card,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 10,
      paddingHorizontal: 16,
    },
    buttonPrimary: {
      backgroundColor: c.primary,
    },
    buttonSecondary: {
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
    },
    buttonDanger: {
      backgroundColor: c.danger,
    },
    buttonSuccess: {
      backgroundColor: c.success,
    },
    buttonGhost: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: c.border,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    buttonPressed: {
      transform: [{ scale: 0.99 }],
    },
    buttonPrimaryPressed: {
      backgroundColor: c.primaryStrong,
    },
    buttonText: {
      fontSize: 15,
      fontWeight: '700',
      fontFamily: t.fonts.bodyBold,
    },
    buttonTextPrimary: {
      color: c.textOnPrimary,
    },
    buttonTextOnStatus: {
      color: c.onStatus,
    },
    buttonTextSecondary: {
      color: c.textPrimary,
    },
    buttonTextGhost: {
      color: c.textPrimary,
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
      fontFamily: t.fonts.bodyBold,
      color: c.primary,
    },
    inlineButtonDisabled: {
      color: c.textMuted,
    },
    fieldWrap: {
      gap: 6,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: '600',
      fontFamily: t.fonts.bodySemibold,
      color: c.textSecondary,
    },
    textInput: {
      minHeight: 46,
      borderRadius: t.radius.card,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      fontFamily: t.fonts.body,
      color: c.textPrimary,
    },
    textArea: {
      minHeight: 78,
      textAlignVertical: 'top',
    },
    inputDisabled: {
      backgroundColor: c.surfaceMuted,
      color: c.textSecondary,
    },
    keyValueRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
    },
    keyValueLabel: {
      flex: 1,
      fontSize: 13,
      fontFamily: t.fonts.body,
      color: c.textSecondary,
    },
    keyValueValueWrap: {
      flex: 1.2,
      alignItems: 'flex-end',
    },
    keyValueValue: {
      fontSize: 13,
      color: c.textPrimary,
      fontWeight: '500',
      fontFamily: t.fonts.bodyMedium,
      textAlign: 'right',
    },
    chip: {
      alignSelf: 'flex-start',
      borderRadius: t.radius.pill,
      paddingHorizontal: 9,
      paddingVertical: 4,
      backgroundColor: c.surfaceMuted,
      borderWidth: 1,
      borderColor: c.border,
    },
    chipSuccess: {
      backgroundColor: c.successSoft,
      borderColor: c.successBorder,
    },
    chipWarning: {
      backgroundColor: c.warningSoft,
      borderColor: c.warningBorder,
    },
    chipDanger: {
      backgroundColor: c.dangerSoft,
      borderColor: c.dangerBorder,
    },
    chipInfo: {
      backgroundColor: c.infoSoft,
      borderColor: c.infoBorder,
    },
    chipText: {
      fontSize: 12,
      fontWeight: '600',
      fontFamily: t.fonts.bodySemibold,
      color: c.textPrimary,
    },
    chipTextSuccess: {
      color: c.successText,
    },
    chipTextWarning: {
      color: c.warningText,
    },
    chipTextDanger: {
      color: c.dangerText,
    },
    chipTextInfo: {
      color: c.infoText,
    },
    selectCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 10,
      borderRadius: t.radius.card,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
    },
    selectCardSelected: {
      borderColor: c.primary,
      backgroundColor: c.surfaceMuted,
    },
    selectCardPressed: {
      opacity: 0.92,
    },
    selectIndicator: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    selectIndicatorInner: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: c.primary,
    },
    selectTextWrap: {
      flex: 1,
      gap: 4,
    },
    selectTitle: {
      fontSize: 14,
      fontWeight: '600',
      fontFamily: t.fonts.bodySemibold,
      color: c.textPrimary,
    },
    selectDescription: {
      fontSize: 12,
      fontFamily: t.fonts.body,
      color: c.textSecondary,
    },
    dropdownControl: {
      minHeight: 46,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      borderRadius: t.radius.card,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    dropdownControlOpen: {
      borderColor: c.primary,
    },
    dropdownControlPressed: {
      backgroundColor: c.surfacePressed,
    },
    dropdownValue: {
      flex: 1,
      fontSize: 15,
      color: c.textPrimary,
      fontWeight: '600',
      fontFamily: t.fonts.bodySemibold,
    },
    dropdownPlaceholder: {
      color: c.textMuted,
      fontWeight: '400',
    },
    dropdownPanel: {
      marginTop: 6,
      borderRadius: t.radius.card,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
      overflow: 'hidden',
      ...t.shadow.card,
    },
    dropdownSearchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      backgroundColor: c.surfaceMuted,
    },
    dropdownSearchInput: {
      flex: 1,
      minHeight: 42,
      fontSize: 14,
      fontFamily: t.fonts.body,
      color: c.textPrimary,
      paddingVertical: 8,
    },
    dropdownList: {
      maxHeight: 250,
    },
    dropdownEmptyText: {
      fontSize: 13,
      fontFamily: t.fonts.body,
      color: c.textSecondary,
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
      borderBottomColor: c.surfaceMuted,
    },
    dropdownOptionSelected: {
      backgroundColor: c.primarySoft,
    },
    dropdownOptionPressed: {
      backgroundColor: c.surfacePressed,
    },
    dropdownOptionTextWrap: {
      flex: 1,
      gap: 2,
    },
    dropdownOptionLabel: {
      fontSize: 14,
      fontWeight: '600',
      fontFamily: t.fonts.bodySemibold,
      color: c.textPrimary,
    },
    dropdownOptionDescription: {
      fontSize: 12,
      fontFamily: t.fonts.body,
      color: c.textSecondary,
    },
    headerIconButton: {
      minWidth: 38,
      minHeight: 38,
      width: 38,
      height: 38,
      borderRadius: t.radius.card,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: 'transparent',
    },
    headerIconButtonPressed: {
      backgroundColor: c.surfacePressed,
      borderColor: c.border,
    },
    headerIconButtonDisabled: {
      opacity: 0.48,
    },
  });
}
