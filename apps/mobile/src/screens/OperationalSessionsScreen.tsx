import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { api, ApiError } from '../api';
import { cachedFetch } from '../offlineCache';
import { useSession } from '../context/AuthContext';
import type { RootStackScreenProps } from '../navigation/types';
import {
  formatOperationalSessionScope,
  formatOperationalSessionStatus,
  formatSessionDate,
  getOperationalSessionAssignedQaLabel,
  getOperationalSessionGroup,
  getOperationalSessionMetadataSummary,
  getOperationalSessionProgress,
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
  Mono,
  Screen,
  SectionTitle,
  StatusChip,
  StatusSpineTile,
  type SpineTone,
} from '../ui';
import { Theme, useTheme } from '../theme';

// Render groups by ACTION PRIORITY (handoff 2h): Needs Attention first, then
// In Progress, then Assigned, then Completed. The source array's declaration
// order differs, so map to this local order without mutating it.
const GROUP_RENDER_ORDER: OperationalSessionGroupKey[] = [
  'NEEDS_ATTENTION',
  'IN_PROGRESS',
  'ASSIGNED',
  'COMPLETED',
];

const GROUP_SPINE: Record<OperationalSessionGroupKey, SpineTone> = {
  NEEDS_ATTENTION: 'red',
  IN_PROGRESS: 'blue',
  ASSIGNED: 'amber',
  COMPLETED: 'green',
};

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

      const { value: nextSessions } = await cachedFetch('operational-sessions', undefined, () =>
        api.getOperationalSessions(token),
      );
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

  const renderGroups = useMemo(
    () =>
      GROUP_RENDER_ORDER.map(
        (key) => OPERATIONAL_SESSION_GROUPS.find((entry) => entry.group === key)!,
      ).filter((entry) => showFinalItems || entry.group !== 'COMPLETED'),
    [showFinalItems],
  );

  return (
    <Screen
      title="Sessions"
      subtitle="Assigned inspection work — triage by priority."
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
          <View style={styles.countPill}>
            <Mono size={15} color={theme.colors.textPrimary}>
              {String(visibleCount)}
            </Mono>
          </View>
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
        ? renderGroups.map((entry) => (
            <SessionGroup
              key={entry.group}
              label={entry.label}
              tone={entry.tone}
              spine={GROUP_SPINE[entry.group]}
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
  spine,
  sessions,
  onOpen,
}: {
  label: string;
  tone: 'info' | 'success' | 'danger';
  spine: SpineTone;
  sessions: OperationalSession[];
  onOpen: (session: OperationalSession) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        <SectionTitle>{label}</SectionTitle>
        <StatusChip label={String(sessions.length)} tone={tone} />
      </View>
      {sessions.length === 0 ? (
        <Text style={styles.emptyGroupText}>No sessions in this group.</Text>
      ) : (
        <View style={styles.sessionList}>
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              spine={spine}
              onPress={() => onOpen(session)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function SessionRow({
  session,
  spine,
  onPress,
}: {
  session: OperationalSession;
  spine: SpineTone;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const progress = getOperationalSessionProgress(session);
  const dueLabel = formatSessionDate(session.dueDate);
  const qaLabel = getOperationalSessionAssignedQaLabel(session);

  return (
    <StatusSpineTile
      code={session.sessionNo}
      spine={spine}
      chip={{
        label: formatOperationalSessionStatus(session.status),
        tone: getOperationalSessionStatusTone(session.status),
      }}
      secondary={getOperationalSessionMetadataSummary(session)}
      meta={[
        formatOperationalSessionScope(session.scope),
        `Due ${dueLabel}`,
        `QA · ${qaLabel}`,
      ]}
      onPress={onPress}
      rightSlot={
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>
            {progress.inspectedAssets} / {progress.totalAssets}
          </Text>
        </View>
      }
    />
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
    countPill: {
      minWidth: 38,
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.surfaceMuted,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: t.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toggleRow: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      borderRadius: t.radius.control,
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
      fontFamily: t.fonts.bodyBold,
      fontWeight: '700',
    },
    toggleMeta: {
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      fontFamily: t.fonts.body,
      fontWeight: '500',
    },
    switchTrack: {
      width: 44,
      height: 26,
      borderRadius: 13,
      backgroundColor: t.colors.borderStrong,
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
    group: {
      gap: 10,
    },
    emptyGroupText: {
      color: t.colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontFamily: t.fonts.bodyMedium,
      fontWeight: '500',
    },
    groupHeader: {
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    sessionList: {
      gap: 10,
    },
    // Live count pill ("18 / 21") on the tile's top row (handoff 2h).
    countBadge: {
      borderRadius: t.radius.chip,
      backgroundColor: t.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: t.colors.border,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    countBadgeText: {
      fontSize: 12,
      fontFamily: t.fonts.monoMedium,
      letterSpacing: 0.2,
      color: t.colors.textSecondary,
    },
  });
