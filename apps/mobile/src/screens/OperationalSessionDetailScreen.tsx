import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from '../api';
import { useSession } from '../context/AuthContext';
import type { RootStackScreenProps } from '../navigation/types';
import {
  formatOperationalSessionScope,
  formatOperationalSessionStatus,
  formatSessionDate,
  getOperationalSessionAssignedQaLabel,
  getOperationalSessionCompanyLabel,
  getOperationalSessionMetadataSummary,
  getOperationalSessionProgress,
  getOperationalSessionStatusTone,
} from '../operationalSessions';
import type { OperationalSession } from '../types';
import {
  AppButton,
  BodyText,
  Card,
  EmptyState,
  ErrorBanner,
  KeyValueRow,
  LoadingBlock,
  Screen,
  SectionTitle,
  StatusChip,
  SuccessBanner,
  uiTheme,
} from '../ui';
import { formatDateTime } from '../utils';

type LifecycleAction = 'start' | 'submit';

export function OperationalSessionDetailScreen({
  route,
  navigation,
}: RootStackScreenProps<'OperationalSessionDetail'>) {
  const { token, handleUnauthorized } = useSession();
  const [session, setSession] = useState<OperationalSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<LifecycleAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      const nextSession = await api.getOperationalSession(token, route.params.sessionId);
      setSession(nextSession);
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        await handleUnauthorized(loadError);
        return;
      }

      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load this operational session.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [handleUnauthorized, route.params.sessionId, token]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const handleLifecycleAction = useCallback(
    async (action: LifecycleAction) => {
      if (!session) {
        return;
      }

      try {
        setError(null);
        setNotice(null);
        setActionInProgress(action);

        const nextSession =
          action === 'start'
            ? await api.startOperationalSession(token, session.id)
            : await api.submitOperationalSession(token, session.id);

        setSession(nextSession);
        setNotice(action === 'start' ? 'Session started.' : 'Session submitted.');
      } catch (actionError) {
        if (actionError instanceof ApiError && actionError.status === 401) {
          await handleUnauthorized(actionError);
          return;
        }

        setError(
          actionError instanceof Error
            ? actionError.message
            : 'Unable to update this session. Check the connection and try again.',
        );
      } finally {
        setActionInProgress(null);
      }
    },
    [handleUnauthorized, session, token],
  );

  const canStart = session?.status === 'DRAFT' || session?.status === 'ASSIGNED';
  const canSubmit = session?.status === 'IN_PROGRESS' || session?.status === 'AMENDMENT_REQUIRED';

  return (
    <Screen
      title="Session Detail"
      leftAction={{
        icon: 'back',
        onPress: () => navigation.goBack(),
        accessibilityLabel: 'Back',
      }}
      rightAction={{
        icon: 'refresh',
        onPress: loadSession,
        accessibilityLabel: 'Refresh session',
        disabled: isLoading,
      }}
    >
      <ErrorBanner message={error} />
      <SuccessBanner message={notice} />

      {isLoading && !session ? <LoadingBlock label="Loading session detail..." /> : null}

      {!isLoading && !session ? (
        <EmptyState
          icon="alert-circle"
          title="Session unavailable"
          description="This operational session could not be loaded."
        />
      ) : null}

      {session ? (
        <>
          <Card>
            <View style={styles.headerRow}>
              <View style={styles.titleWrap}>
                <Text style={styles.sessionNo} numberOfLines={1}>
                  {session.sessionNo}
                </Text>
                <Text style={styles.scopeText} numberOfLines={1}>
                  {formatOperationalSessionScope(session.scope)}
                </Text>
              </View>
              <StatusChip
                label={formatOperationalSessionStatus(session.status)}
                tone={getOperationalSessionStatusTone(session.status)}
              />
            </View>

            <Text style={styles.metadataSummary} numberOfLines={3}>
              {getOperationalSessionMetadataSummary(session)}
            </Text>

            <View style={styles.detailRows}>
              <KeyValueRow label="Company" value={getOperationalSessionCompanyLabel(session)} />
              <KeyValueRow label="QA/QC" value={getOperationalSessionAssignedQaLabel(session)} />
              <KeyValueRow label="MAINHEAD" value={session.mainhead?.name ?? 'Not set'} />
              <KeyValueRow label="Target Date" value={formatSessionDate(session.targetDate)} />
              <KeyValueRow label="Due Date" value={formatSessionDate(session.dueDate)} />
              <KeyValueRow label="Updated" value={formatDateTime(session.updatedAt)} />
            </View>
          </Card>

          <Card>
            <SectionTitle>Remarks</SectionTitle>
            <BodyText muted>{session.remarks?.trim() || 'No remarks recorded.'}</BodyText>
          </Card>

          <ProgressCard session={session} />

          <Card>
            <SectionTitle>Inspections</SectionTitle>
            <BodyText muted>
              Inspections and assigned assets will be connected in the next sprint.
            </BodyText>
          </Card>

          <Card>
            <View style={styles.actionHeader}>
              <SectionTitle>Actions</SectionTitle>
              <Text style={styles.actionMeta}>Mobile field actions</Text>
            </View>

            {canStart ? (
              <AppButton
                label="Start Session"
                onPress={() => {
                  void handleLifecycleAction('start');
                }}
                loading={actionInProgress === 'start'}
                disabled={Boolean(actionInProgress)}
              />
            ) : null}

            {canSubmit ? (
              <AppButton
                label="Submit Session"
                onPress={() => {
                  void handleLifecycleAction('submit');
                }}
                loading={actionInProgress === 'submit'}
                disabled={Boolean(actionInProgress)}
              />
            ) : null}

            {!canStart && !canSubmit ? (
              <BodyText muted>No mobile action is available for this status.</BodyText>
            ) : null}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function ProgressCard({ session }: { session: OperationalSession }) {
  const progress = getOperationalSessionProgress(session);

  return (
    <Card>
      <View style={styles.actionHeader}>
        <SectionTitle>Progress</SectionTitle>
        <StatusChip label={`${progress.completionPercentage}%`} tone="info" />
      </View>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.min(Math.max(progress.completionPercentage, 0), 100)}%` },
          ]}
        />
      </View>
      <View style={styles.detailRows}>
        <KeyValueRow label="Total Assets" value={String(progress.totalAssets)} />
        <KeyValueRow label="Completed Assets" value={String(progress.completedAssets)} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleWrap: {
    flex: 1,
    gap: 3,
  },
  sessionNo: {
    color: uiTheme.colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  scopeText: {
    color: uiTheme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  metadataSummary: {
    color: uiTheme.colors.textPrimary,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },
  detailRows: {
    gap: 8,
  },
  actionHeader: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  actionMeta: {
    color: uiTheme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  progressTrack: {
    height: 9,
    borderRadius: 5,
    backgroundColor: uiTheme.colors.surfaceMuted,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
  },
  progressFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: uiTheme.colors.primary,
  },
});
