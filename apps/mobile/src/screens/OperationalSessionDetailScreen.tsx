import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
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
import type { OperationalSession, OperationalSessionAssignedAsset } from '../types';
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

function formatCompactEnum(value: string | null | undefined) {
  if (!value) {
    return 'Not recorded';
  }

  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatAssetType(asset: OperationalSessionAssignedAsset) {
  const code = asset.assetType.code?.trim();
  const name = asset.assetType.name?.trim();

  if (code && name) {
    return `${code} - ${name}`;
  }

  return name || code || 'Not recorded';
}

function formatCoordinates(latitude: number | null, longitude: number | null) {
  if (latitude === null || longitude === null) {
    return null;
  }

  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

function assetStatusTone(
  status: OperationalSessionAssignedAsset['status'],
): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'ACTIVE') {
    return 'success';
  }

  if (status === 'NOT_FOUND' || status === 'REMOVED') {
    return 'danger';
  }

  if (status === 'DUPLICATE') {
    return 'warning';
  }

  return 'neutral';
}

export function OperationalSessionDetailScreen({
  route,
  navigation,
}: RootStackScreenProps<'OperationalSessionDetail'>) {
  const { token, handleUnauthorized } = useSession();
  const [session, setSession] = useState<OperationalSession | null>(null);
  const [assignedAssets, setAssignedAssets] = useState<OperationalSessionAssignedAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAssetsLoading, setIsAssetsLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<LifecycleAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    try {
      setError(null);
      setAssetError(null);
      setIsLoading(true);
      setIsAssetsLoading(true);

      const nextSession = await api.getOperationalSession(token, route.params.sessionId);
      setSession(nextSession);

      try {
        setAssignedAssets(await api.getSessionAssets(token, route.params.sessionId));
      } catch (assetLoadError) {
        if (assetLoadError instanceof ApiError && assetLoadError.status === 401) {
          await handleUnauthorized(assetLoadError);
          return;
        }

        setAssetError(
          assetLoadError instanceof Error
            ? assetLoadError.message
            : 'Unable to load assigned assets.',
        );
        setAssignedAssets([]);
      }
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
      setIsAssetsLoading(false);
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
        try {
          setIsAssetsLoading(true);
          setAssetError(null);
          setAssignedAssets(await api.getSessionAssets(token, session.id));
        } catch (assetLoadError) {
          if (assetLoadError instanceof ApiError && assetLoadError.status === 401) {
            await handleUnauthorized(assetLoadError);
            return;
          }

          setAssetError(
            assetLoadError instanceof Error
              ? assetLoadError.message
              : 'Unable to load assigned assets.',
          );
        } finally {
          setIsAssetsLoading(false);
        }
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

  function handleViewAssignedAsset(asset: OperationalSessionAssignedAsset) {
    navigation.navigate('AssetDetail', {
      assetId: asset.id,
      operationalSessionId: session?.id,
    });
  }

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

          <AssignedAssetsCard
            session={session}
            assets={assignedAssets}
            isLoading={isAssetsLoading}
            error={assetError}
            onViewAsset={handleViewAssignedAsset}
          />

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
        <KeyValueRow label="Inspected Assets" value={String(progress.inspectedAssets)} />
      </View>
    </Card>
  );
}

function AssignedAssetsCard({
  session,
  assets,
  isLoading,
  error,
  onViewAsset,
}: {
  session: OperationalSession;
  assets: OperationalSessionAssignedAsset[];
  isLoading: boolean;
  error: string | null;
  onViewAsset: (asset: OperationalSessionAssignedAsset) => void;
}) {
  const progress = getOperationalSessionProgress(session);

  return (
    <Card>
      <View style={styles.actionHeader}>
        <SectionTitle>Assigned Assets</SectionTitle>
        <StatusChip label={`${progress.completionPercentage}%`} tone="info" />
      </View>

      <View style={styles.assetProgressGrid}>
        <View style={styles.assetProgressItem}>
          <Text style={styles.metricLabel}>Total Assigned</Text>
          <Text style={styles.metricValue}>{progress.totalAssets}</Text>
        </View>
        <View style={styles.assetProgressItem}>
          <Text style={styles.metricLabel}>Inspected</Text>
          <Text style={styles.metricValue}>{progress.inspectedAssets}</Text>
        </View>
        <View style={styles.assetProgressItem}>
          <Text style={styles.metricLabel}>Completion</Text>
          <Text style={styles.metricValue}>{progress.completionPercentage}%</Text>
        </View>
      </View>

      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.min(Math.max(progress.completionPercentage, 0), 100)}%` },
          ]}
        />
      </View>

      {error ? (
        <View style={styles.assetErrorBox}>
          <Text style={styles.assetErrorText}>{error}</Text>
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.assetLoadingRow}>
          <ActivityIndicator color={uiTheme.colors.primary} />
          <Text style={styles.assetLoadingText}>Loading assigned assets...</Text>
        </View>
      ) : null}

      {!isLoading && !error && assets.length === 0 ? (
        <BodyText muted>No assets assigned to this session yet.</BodyText>
      ) : null}

      {!isLoading && assets.length > 0 ? (
        <View style={styles.assetList}>
          {assets.map((asset) => (
            <AssignedAssetCard
              key={asset.assignment.id}
              asset={asset}
              onViewAsset={() => onViewAsset(asset)}
            />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function AssignedAssetCard({
  asset,
  onViewAsset,
}: {
  asset: OperationalSessionAssignedAsset;
  onViewAsset: () => void;
}) {
  const coordinates = formatCoordinates(asset.latitude, asset.longitude);
  const notes = asset.assignment.notes?.trim();

  return (
    <View style={styles.assignedAssetCard}>
      <View style={styles.assignedAssetHeader}>
        <View style={styles.assignedAssetTitleWrap}>
          <Text style={styles.assignedAssetCode} numberOfLines={1}>
            {asset.assetCode}
          </Text>
          <Text style={styles.assignedAssetName} numberOfLines={2}>
            {asset.name?.trim() || 'Not recorded'}
          </Text>
        </View>
        <StatusChip label={formatCompactEnum(asset.status)} tone={assetStatusTone(asset.status)} />
      </View>

      <View style={styles.detailRows}>
        <KeyValueRow label="Asset Type" value={formatAssetType(asset)} />
        <KeyValueRow label="Inspection" value={asset.inspected ? 'Inspected' : 'Pending'} />
        {asset.latestInspectionStatus ? (
          <KeyValueRow
            label="Latest Status"
            value={formatCompactEnum(asset.latestInspectionStatus)}
          />
        ) : null}
        {coordinates ? <KeyValueRow label="Coordinates" value={coordinates} /> : null}
        {notes ? <KeyValueRow label="Notes" value={notes} /> : null}
      </View>

      <AppButton label="View Asset / Inspect" variant="secondary" onPress={onViewAsset} />
    </View>
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
  assetProgressGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  assetProgressItem: {
    flex: 1,
    minHeight: 62,
    borderRadius: uiTheme.radius.control,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.surfaceMuted,
    paddingHorizontal: 10,
    paddingVertical: 9,
    justifyContent: 'center',
    gap: 2,
  },
  metricLabel: {
    color: uiTheme.colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  metricValue: {
    color: uiTheme.colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  assetErrorBox: {
    borderWidth: 1,
    borderColor: uiTheme.colors.dangerBorder,
    borderRadius: uiTheme.radius.control,
    backgroundColor: uiTheme.colors.dangerSoft,
    padding: 10,
  },
  assetErrorText: {
    color: uiTheme.colors.danger,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  assetLoadingRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  assetLoadingText: {
    color: uiTheme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  assetList: {
    gap: 10,
  },
  assignedAssetCard: {
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    borderRadius: uiTheme.radius.card,
    backgroundColor: uiTheme.colors.surfaceMuted,
    padding: 12,
    gap: 10,
  },
  assignedAssetHeader: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  assignedAssetTitleWrap: {
    flex: 1,
    gap: 3,
  },
  assignedAssetCode: {
    color: uiTheme.colors.textPrimary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  assignedAssetName: {
    color: uiTheme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
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
