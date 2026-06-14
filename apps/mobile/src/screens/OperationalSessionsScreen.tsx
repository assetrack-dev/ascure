import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { api, ApiError } from '../api';
import { useSession } from '../context/AuthContext';
import type { RootStackScreenProps } from '../navigation/types';
import {
  formatOperationalSessionScope,
  formatOperationalSessionStatus,
  formatSessionDate,
  getOperationalSessionAssignedQaLabel,
  getOperationalSessionGroup,
  getOperationalSessionMetadataSummary,
  getOperationalSessionProgressLabel,
  getOperationalSessionStatusTone,
  OPERATIONAL_SESSION_GROUPS,
  type OperationalSessionGroupKey,
} from '../operationalSessions';
import type { OperationalSession } from '../types';
import {
  BodyText,
  Card,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  Screen,
  SectionTitle,
  StatusChip,
} from '../ui';
import { Theme, useTheme } from '../theme';

export function OperationalSessionsScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation =
    useNavigation<RootStackScreenProps<'OperationalSessions'>['navigation']>();
  const { token, handleUnauthorized } = useSession();
  const [sessions, setSessions] = useState<OperationalSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFinalItems, setShowFinalItems] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      const nextSessions = await api.getOperationalSessions(token);
      setSessions(nextSessions);
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        await handleUnauthorized(loadError);
        return;
      }

      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load operational sessions.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [handleUnauthorized, token]);

  useFocusEffect(
    useCallback(() => {
      void loadSessions();
    }, [loadSessions]),
  );

  const groupedSessions = useMemo(
    () => groupSessions(sessions, showFinalItems),
    [sessions, showFinalItems],
  );
  const visibleCount = useMemo(
    () =>
      Object.values(groupedSessions).reduce(
        (total, entries) => total + entries.length,
        0,
      ),
    [groupedSessions],
  );

  return (
    <Screen
      title="Operational Sessions"
      leftAction={{
        icon: 'back',
        onPress: () => navigation.goBack(),
        accessibilityLabel: 'Back',
      }}
      rightAction={{
        icon: 'refresh',
        onPress: loadSessions,
        accessibilityLabel: 'Refresh sessions',
        disabled: isLoading,
      }}
    >
      <ErrorBanner message={error} />

      <Card>
        <View style={styles.listHeader}>
          <View style={styles.headerTextWrap}>
            <SectionTitle>Inspection Workspace</SectionTitle>
            <BodyText muted>
              Assigned operational sessions for field inspection work.
            </BodyText>
          </View>
          <Text style={styles.countText}>{visibleCount}</Text>
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: showFinalItems }}
          onPress={() => setShowFinalItems((current) => !current)}
          style={({ pressed }) => [styles.toggleRow, pressed && styles.pressedRow]}
        >
          <View style={styles.toggleTextWrap}>
            <Text style={styles.toggleTitle}>Show approved</Text>
            <Text style={styles.toggleMeta}>
              Approved sessions stay hidden until this is enabled.
            </Text>
          </View>
          <View style={[styles.switchTrack, showFinalItems && styles.switchTrackOn]}>
            <View style={[styles.switchThumb, showFinalItems && styles.switchThumbOn]} />
          </View>
        </Pressable>
      </Card>

      {isLoading && sessions.length === 0 ? (
        <LoadingBlock label="Loading operational sessions..." />
      ) : null}

      {!isLoading && visibleCount === 0 ? (
        <EmptyState
          icon="clipboard"
          title="No operational sessions"
          description="Assigned inspection sessions will appear here when they are available."
        />
      ) : null}

      {visibleCount > 0
        ? OPERATIONAL_SESSION_GROUPS.filter(
            (entry) => showFinalItems || entry.group !== 'COMPLETED',
          ).map((entry) => (
            <SessionGroup
              key={entry.group}
              label={entry.label}
              tone={entry.tone}
              sessions={groupedSessions[entry.group]}
              onOpen={(session) =>
                navigation.navigate('OperationalSessionDetail', {
                  sessionId: session.id,
                  sessionNo: session.sessionNo,
                })
              }
            />
          ))
        : null}
    </Screen>
  );
}

function SessionGroup({
  label,
  tone,
  sessions,
  onOpen,
}: {
  label: string;
  tone: 'info' | 'success' | 'danger';
  sessions: OperationalSession[];
  onOpen: (session: OperationalSession) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Card>
      <View style={styles.listHeader}>
        <SectionTitle>{label}</SectionTitle>
        <StatusChip label={String(sessions.length)} tone={tone} />
      </View>

      {sessions.length === 0 ? (
        <Text style={styles.emptyGroupText}>No sessions in this group.</Text>
      ) : (
        <View style={styles.sessionList}>
          {sessions.map((session) => (
            <SessionCard key={session.id} session={session} onPress={() => onOpen(session)} />
          ))}
        </View>
      )}
    </Card>
  );
}

function SessionCard({
  session,
  onPress,
}: {
  session: OperationalSession;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.sessionCard, pressed && styles.pressedRow]}
    >
      <View style={styles.sessionHeader}>
        <View style={styles.sessionTitleWrap}>
          <Text style={styles.sessionNo} numberOfLines={1}>
            {session.sessionNo}
          </Text>
          <Text style={styles.sessionScope} numberOfLines={1}>
            {formatOperationalSessionScope(session.scope)}
          </Text>
        </View>
        <StatusChip
          label={formatOperationalSessionStatus(session.status)}
          tone={getOperationalSessionStatusTone(session.status)}
        />
      </View>

      <Text style={styles.locationText} numberOfLines={2}>
        {getOperationalSessionMetadataSummary(session)}
      </Text>

      <View style={styles.metaGrid}>
        <SessionMeta label="Due" value={formatSessionDate(session.dueDate)} />
        <SessionMeta label="Progress" value={getOperationalSessionProgressLabel(session)} />
        <SessionMeta label="QA/QC" value={getOperationalSessionAssignedQaLabel(session)} />
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.updatedText} numberOfLines={1}>
          Updated {formatSessionDate(session.updatedAt)}
        </Text>
        <Feather name="chevron-right" size={18} color={theme.colors.textMuted} />
      </View>
    </Pressable>
  );
}

function SessionMeta({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.metaItem}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function groupSessions(sessions: OperationalSession[], showFinalItems: boolean) {
  const grouped: Record<OperationalSessionGroupKey, OperationalSession[]> = {
    ASSIGNED: [],
    IN_PROGRESS: [],
    NEEDS_ATTENTION: [],
    COMPLETED: [],
  };

  sessions.forEach((session) => {
    const group = getOperationalSessionGroup(session.status, showFinalItems);

    if (group) {
      grouped[group].push(session);
    }
  });

  Object.values(grouped).forEach((entries) => {
    entries.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  });

  return grouped;
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    listHeader: {
      minHeight: 36,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    headerTextWrap: {
      flex: 1,
      gap: 4,
    },
    countText: {
      minWidth: 38,
      borderRadius: 19,
      overflow: 'hidden',
      backgroundColor: t.colors.surfaceMuted,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderWidth: 1,
      borderColor: t.colors.border,
      color: t.colors.textPrimary,
      fontSize: 14,
      fontWeight: '700',
      textAlign: 'center',
    },
    toggleRow: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surfaceMuted,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    pressedRow: {
      backgroundColor: t.colors.surfacePressed,
      transform: [{ scale: 0.995 }],
    },
    toggleTextWrap: {
      flex: 1,
      gap: 2,
    },
    toggleTitle: {
      color: t.colors.textPrimary,
      fontSize: 14,
      lineHeight: 19,
      fontWeight: '700',
    },
    toggleMeta: {
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '500',
    },
    switchTrack: {
      width: 44,
      height: 26,
      borderRadius: 13,
      backgroundColor: t.colors.border,
      padding: 3,
    },
    switchTrackOn: {
      backgroundColor: t.colors.primary,
    },
    switchThumb: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: t.colors.card,
    },
    switchThumbOn: {
      transform: [{ translateX: 18 }],
    },
    emptyGroupText: {
      color: t.colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '500',
    },
    sessionList: {
      gap: 10,
    },
    sessionCard: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
      padding: 12,
      gap: 9,
    },
    sessionHeader: {
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 10,
    },
    sessionTitleWrap: {
      flex: 1,
      gap: 2,
    },
    sessionNo: {
      color: t.colors.textPrimary,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '800',
    },
    sessionScope: {
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
    },
    locationText: {
      color: t.colors.textPrimary,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '600',
    },
    metaGrid: {
      gap: 7,
    },
    metaItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    metaLabel: {
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '600',
    },
    metaValue: {
      flex: 1,
      color: t.colors.textPrimary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
      textAlign: 'right',
    },
    cardFooter: {
      minHeight: 24,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      borderTopWidth: 1,
      borderTopColor: t.colors.surfaceMuted,
      paddingTop: 8,
    },
    updatedText: {
      flex: 1,
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '500',
    },
  });
