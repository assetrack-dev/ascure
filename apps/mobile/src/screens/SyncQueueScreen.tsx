import { Children, type ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSync } from '../context/SyncContext';
import type { AppDrawerScreenProps } from '../navigation/types';
import {
  EmptyState,
  ErrorBanner,
  Mono,
  Screen,
  SectionTitle,
  StatusChip,
  SuccessBanner,
  WarningBanner,
} from '../ui';
import { Theme, useTheme } from '../theme';
import {
  CompletedInspectionSyncRecord,
  CompletedVisitCompletionSyncRecord,
  getCompletedQueueCount,
  getFailedQueueCount,
  getPendingQueueCount,
  getSyncingQueueCount,
  OfflineInspectionQueueItem,
  OfflineVisitCompletionQueueItem,
  SyncQueueDisplayStatus,
} from '../syncQueue';
import { formatDateTime } from '../utils';

export function SyncQueueScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<AppDrawerScreenProps<'SyncQueue'>['navigation']>();
  const { snapshot, isSyncing, isOffline, runQueueSync } = useSync();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const groupedItems = useMemo(
    () => ({
      pending: snapshot.items.filter((item) => item.status === 'PENDING_SYNC'),
      syncing: snapshot.items.filter((item) => item.status === 'SYNCING'),
      failed: snapshot.items.filter((item) => item.status === 'FAILED'),
      completed: snapshot.completed,
      pendingVisitCompletions: snapshot.visitCompletions.filter(
        (item) => item.status === 'PENDING_SYNC',
      ),
      syncingVisitCompletions: snapshot.visitCompletions.filter(
        (item) => item.status === 'SYNCING',
      ),
      failedVisitCompletions: snapshot.visitCompletions.filter(
        (item) => item.status === 'FAILED',
      ),
      completedVisitCompletions: snapshot.completedVisitCompletions,
    }),
    [snapshot],
  );
  const activeCount = snapshot.items.length + snapshot.visitCompletions.length;
  const summaryStatus = getQueueSummaryStatus({
    pendingCount: getPendingQueueCount(snapshot),
    syncingCount: getSyncingQueueCount(snapshot),
    failedCount: getFailedQueueCount(snapshot),
  });

  async function handleRetry() {
    try {
      setError(null);
      setNotice(null);

      const result = await runQueueSync();

      if (result.completed > 0) {
        setNotice(`${result.completed} item${result.completed === 1 ? '' : 's'} synced.`);
        return;
      }

      if (result.failed > 0) {
        setError('Some queued work still needs a stable connection. Local data was kept.');
        return;
      }

      setNotice('No pending work to sync.');
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : 'Unable to run sync.');
    }
  }

  const retryDisabled = isSyncing || activeCount === 0 || isOffline;
  const retryHint = isOffline
    ? 'Offline — retry when back online'
    : activeCount === 0
      ? 'Nothing to sync'
      : null;

  return (
    <Screen
      title="Sync Queue"
      subtitle="Offline work waiting to upload — nothing is lost."
      leftAction={{
        icon: 'menu',
        onPress: () => navigation.openDrawer(),
        accessibilityLabel: 'Menu',
      }}
    >
      <ErrorBanner message={error} />
      <WarningBanner
        message={
          isOffline
            ? 'Offline mode is active. Retry Sync will be available when connection returns.'
            : null
        }
      />
      <SuccessBanner message={notice} />

      {/* Dark status panel (handoff 2g) — 4-count grid + a Retry that is clearly
          disabled (not broken) while offline. */}
      <View style={styles.statusCard}>
        <View style={styles.summaryHeader}>
          <View style={styles.summaryTitleWrap}>
            <Text style={styles.summaryEyebrow}>OFFLINE SYNC</Text>
            <Text style={styles.summaryTitle}>Queue Status</Text>
          </View>
          <StatusBadge status={summaryStatus} onDark />
        </View>

        <View style={styles.statsGrid}>
          <QueueStat label="Pending" value={getPendingQueueCount(snapshot)} tone="amber" />
          <QueueStat label="Syncing" value={getSyncingQueueCount(snapshot)} tone="blue" />
          <QueueStat label="Failed" value={getFailedQueueCount(snapshot)} tone="red" />
          <QueueStat label="Completed" value={getCompletedQueueCount(snapshot)} tone="green" />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: retryDisabled }}
          disabled={retryDisabled}
          onPress={handleRetry}
          style={({ pressed }) => [
            styles.retryButton,
            retryDisabled && styles.retryButtonDisabled,
            pressed && !retryDisabled && styles.retryButtonPressed,
          ]}
        >
          {isSyncing ? (
            <ActivityIndicator color={theme.colors.textOnPrimary} size="small" />
          ) : (
            <Feather
              name="refresh-cw"
              size={17}
              color={retryDisabled ? theme.colors.onChromeFaint : theme.colors.textOnPrimary}
            />
          )}
          <Text style={[styles.retryLabel, retryDisabled && styles.retryLabelDisabled]}>
            {isSyncing ? 'Syncing...' : retryDisabled && retryHint ? retryHint : 'Retry Sync'}
          </Text>
        </Pressable>
      </View>

      <QueueSection title="Syncing" emptyText="No queued work is syncing right now.">
        {groupedItems.syncing.map((item) => (
          <QueueItemCard key={item.id} item={item} />
        ))}
        {groupedItems.syncingVisitCompletions.map((item) => (
          <VisitCompletionQueueCard key={item.id} item={item} />
        ))}
      </QueueSection>

      <QueueSection title="Pending" emptyText="No queued work is waiting to sync.">
        {groupedItems.pending.map((item) => (
          <QueueItemCard key={item.id} item={item} />
        ))}
        {groupedItems.pendingVisitCompletions.map((item) => (
          <VisitCompletionQueueCard key={item.id} item={item} />
        ))}
      </QueueSection>

      <QueueSection title="Failed" emptyText="No failed sync attempts.">
        {groupedItems.failed.map((item) => (
          <QueueItemCard key={item.id} item={item} />
        ))}
        {groupedItems.failedVisitCompletions.map((item) => (
          <VisitCompletionQueueCard key={item.id} item={item} />
        ))}
      </QueueSection>

      <QueueSection title="Completed" emptyText="No completed sync history yet.">
        {groupedItems.completed.map((record) => (
          <CompletedQueueCard key={record.id} record={record} />
        ))}
        {groupedItems.completedVisitCompletions.map((record) => (
          <CompletedVisitCompletionCard key={record.id} record={record} />
        ))}
      </QueueSection>
    </Screen>
  );
}

function QueueSection({
  title,
  emptyText,
  children,
}: {
  title: string;
  emptyText: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const hasChildren = Children.count(children) > 0;

  return (
    <View style={styles.section}>
      <SectionTitle>{title}</SectionTitle>
      {hasChildren ? (
        <View style={styles.queueList}>{children}</View>
      ) : (
        <EmptyState title={title} description={emptyText} />
      )}
    </View>
  );
}

/** Spine color for a queue card (handoff 2g) — mirrors the status grid tones. */
function spineForStatus(t: Theme, status: SyncQueueDisplayStatus): string {
  switch (status) {
    case 'SYNCING':
      return t.colors.primary;
    case 'FAILED':
      return t.colors.danger;
    case 'COMPLETED':
      return t.colors.success;
    default:
      return t.colors.warning;
  }
}

/** Shared card shell with a status spine + a live spinner while syncing. */
function QueueCardShell({
  title,
  subtitle,
  status,
  children,
  errorMessage,
}: {
  title: string;
  subtitle?: string | null;
  status: SyncQueueDisplayStatus;
  children: ReactNode;
  errorMessage?: string | null;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.queueCard}>
      <View style={[styles.queueSpine, { backgroundColor: spineForStatus(theme, status) }]} />
      <View style={styles.queueBody}>
        <View style={styles.itemHeader}>
          <View style={styles.itemTitleWrap}>
            <Text style={styles.assetCode} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={styles.assetName} numberOfLines={2}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          <View style={styles.itemHeaderRight}>
            {status === 'SYNCING' ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : null}
            <StatusBadge status={status} />
          </View>
        </View>
        <View style={styles.factRow}>{children}</View>
        {errorMessage ? (
          <View style={styles.inlineError}>
            <Text style={styles.inlineErrorText}>{errorMessage}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** One compact "chip" describing what the queued item holds (photos/assets). */
function QueueFact({ icon, label }: { icon: keyof typeof Feather.glyphMap; label: string }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.factChip}>
      <Feather name={icon} size={12} color={theme.colors.textMuted} />
      <Text style={styles.factText}>{label}</Text>
    </View>
  );
}

function QueueItemCard({ item }: { item: OfflineInspectionQueueItem }) {
  return (
    <QueueCardShell
      title={item.summary.assetCode}
      subtitle={item.summary.assetName ?? 'Unnamed asset'}
      status={item.status}
      errorMessage={item.errorMessage}
    >
      <QueueFact icon="map-pin" label={item.summary.substationName} />
      <QueueFact
        icon="file-text"
        label={`${item.summary.templateName} v${item.summary.templateVersion}`}
      />
      <QueueFact icon="repeat" label={`Cycle ${item.summary.inspectionCycle}`} />
      <QueueFact
        icon="image"
        label={`${item.photos.length} photo${item.photos.length === 1 ? '' : 's'}`}
      />
      <QueueFact icon="clock" label={formatDateTime(item.createdAt)} />
      <QueueFact
        icon="rotate-cw"
        label={`${item.attemptCount} attempt${item.attemptCount === 1 ? '' : 's'}`}
      />
    </QueueCardShell>
  );
}

function VisitCompletionQueueCard({ item }: { item: OfflineVisitCompletionQueueItem }) {
  return (
    <QueueCardShell
      title="Complete Visit"
      subtitle={item.summary.substationName}
      status={item.status}
      errorMessage={item.errorMessage}
    >
      <QueueFact icon="users" label={item.summary.teamName} />
      <QueueFact
        icon="check-square"
        label={`${item.summary.inspectedAssets}/${item.summary.totalAssets} assets`}
      />
      <QueueFact icon="clock" label={formatDateTime(item.createdAt)} />
      <QueueFact
        icon="rotate-cw"
        label={`${item.attemptCount} attempt${item.attemptCount === 1 ? '' : 's'}`}
      />
    </QueueCardShell>
  );
}

function CompletedQueueCard({ record }: { record: CompletedInspectionSyncRecord }) {
  return (
    <QueueCardShell
      title={record.summary.assetCode}
      subtitle={record.summary.assetName ?? 'Unnamed asset'}
      status={record.status}
    >
      <QueueFact icon="map-pin" label={record.summary.substationName} />
      <QueueFact
        icon="image"
        label={`${record.photoCount} photo${record.photoCount === 1 ? '' : 's'}`}
      />
      <QueueFact icon="check" label={formatDateTime(record.completedAt)} />
    </QueueCardShell>
  );
}

function CompletedVisitCompletionCard({
  record,
}: {
  record: CompletedVisitCompletionSyncRecord;
}) {
  return (
    <QueueCardShell
      title="Visit Completed"
      subtitle={record.summary.substationName}
      status={record.status}
    >
      <QueueFact icon="users" label={record.summary.teamName} />
      <QueueFact icon="check" label={formatDateTime(record.completedAt)} />
    </QueueCardShell>
  );
}

type StatTone = 'amber' | 'blue' | 'red' | 'green';

function QueueStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: StatTone;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const color =
    tone === 'amber'
      ? theme.colors.warning
      : tone === 'red'
        ? theme.colors.danger
        : tone === 'green'
          ? theme.colors.success
          : theme.colors.chromeAccent;

  return (
    <View style={styles.statBox}>
      <Mono size={30} color={value > 0 ? color : theme.colors.onChromeFaint}>
        {String(value)}
      </Mono>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function StatusBadge({
  status,
  onDark = false,
}: {
  status: SyncQueueDisplayStatus;
  onDark?: boolean;
}) {
  if (onDark) {
    // On the dark status panel, StatusChip's soft light fills read poorly; use a
    // self-contained pill in the same tone family.
    return <DarkStatusBadge status={status} />;
  }
  return <StatusChip label={formatStatus(status)} tone={statusChipTone(status)} />;
}

function DarkStatusBadge({ status }: { status: SyncQueueDisplayStatus }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const color =
    status === 'COMPLETED'
      ? theme.colors.success
      : status === 'FAILED'
        ? theme.colors.danger
        : status === 'SYNCING'
          ? theme.colors.chromeAccent
          : theme.colors.warning;
  return (
    <View style={[styles.darkBadge, { borderColor: color }]}>
      <View style={[styles.darkBadgeDot, { backgroundColor: color }]} />
      <Text style={[styles.darkBadgeText, { color }]}>{formatStatus(status)}</Text>
    </View>
  );
}

function statusChipTone(
  status: SyncQueueDisplayStatus,
): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'COMPLETED') {
    return 'success';
  }
  if (status === 'FAILED') {
    return 'danger';
  }
  if (status === 'SYNCING') {
    return 'info';
  }
  return 'warning';
}

function formatStatus(status: SyncQueueDisplayStatus) {
  return status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getQueueSummaryStatus({
  pendingCount,
  syncingCount,
  failedCount,
}: {
  pendingCount: number;
  syncingCount: number;
  failedCount: number;
}): SyncQueueDisplayStatus {
  if (failedCount > 0) {
    return 'FAILED';
  }

  if (syncingCount > 0) {
    return 'SYNCING';
  }

  if (pendingCount > 0) {
    return 'PENDING_SYNC';
  }

  return 'COMPLETED';
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    // Dark status panel (handoff 2g) — chrome tokens so it reads dark in both modes.
    statusCard: {
      backgroundColor: t.colors.solidFill,
      borderRadius: t.radius.card,
      borderWidth: 1,
      borderColor: t.colors.chromeBorderStrong,
      padding: 18,
      gap: 16,
      ...t.shadow.raised,
    },
    summaryHeader: {
      minHeight: 38,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    summaryTitleWrap: {
      flex: 1,
      gap: 2,
    },
    summaryEyebrow: {
      fontSize: 11,
      fontFamily: t.fonts.mono,
      letterSpacing: 1.5,
      color: t.colors.onSolidFill,
      opacity: 0.55,
    },
    summaryTitle: {
      fontSize: 19,
      lineHeight: 24,
      fontFamily: t.fonts.display,
      fontWeight: '700',
      letterSpacing: -0.3,
      color: t.colors.onSolidFill,
    },
    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      alignItems: 'stretch',
    },
    statBox: {
      width: '47.5%',
      flexGrow: 1,
      minHeight: 88,
      borderRadius: t.radius.control,
      borderWidth: 1,
      borderColor: t.colors.chromeBorder,
      backgroundColor: t.colors.chromeActive,
      paddingHorizontal: 14,
      paddingVertical: 12,
      justifyContent: 'center',
      gap: 4,
    },
    statLabel: {
      fontSize: 11,
      lineHeight: 15,
      fontFamily: t.fonts.mono,
      letterSpacing: 1,
      color: t.colors.onChromeMuted,
      textTransform: 'uppercase',
    },
    retryButton: {
      minHeight: 54,
      borderRadius: t.radius.control,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingHorizontal: 18,
      backgroundColor: t.colors.primary,
    },
    retryButtonDisabled: {
      backgroundColor: t.colors.chromeActive,
      borderWidth: 1,
      borderColor: t.colors.chromeBorder,
    },
    retryButtonPressed: {
      backgroundColor: t.colors.primaryStrong,
      transform: [{ scale: 0.99 }],
    },
    retryLabel: {
      fontSize: 16,
      fontFamily: t.fonts.display,
      fontWeight: '700',
      letterSpacing: 0.2,
      color: t.colors.textOnPrimary,
    },
    retryLabelDisabled: {
      color: t.colors.onChromeFaint,
    },

    section: {
      gap: 10,
    },
    queueList: {
      gap: 10,
    },

    // Queue card with a status spine (handoff 2g / consistent with StatusSpineTile).
    queueCard: {
      flexDirection: 'row',
      borderRadius: t.radius.card,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
      overflow: 'hidden',
      ...t.shadow.card,
    },
    queueSpine: {
      width: 5,
      alignSelf: 'stretch',
    },
    queueBody: {
      flex: 1,
      padding: 14,
      gap: 10,
    },
    itemHeader: {
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
    },
    itemHeaderRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    itemTitleWrap: {
      flex: 1,
      gap: 3,
    },
    assetCode: {
      fontSize: 16,
      lineHeight: 21,
      fontFamily: t.fonts.monoMedium,
      letterSpacing: 0.2,
      color: t.colors.textPrimary,
    },
    assetName: {
      fontSize: 13,
      lineHeight: 18,
      fontFamily: t.fonts.body,
      color: t.colors.textSecondary,
    },
    factRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 7,
    },
    factChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: t.radius.chip,
      backgroundColor: t.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: t.colors.border,
      paddingHorizontal: 8,
      paddingVertical: 5,
    },
    factText: {
      fontSize: 12,
      fontFamily: t.fonts.bodyMedium,
      fontWeight: '500',
      color: t.colors.textSecondary,
    },
    inlineError: {
      borderRadius: t.radius.chip,
      borderWidth: 1,
      borderColor: t.colors.dangerBorder,
      backgroundColor: t.colors.dangerSoft,
      padding: 10,
    },
    inlineErrorText: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
      fontFamily: t.fonts.bodySemibold,
      color: t.colors.dangerText,
    },

    // Self-contained badge for the dark status panel.
    darkBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    darkBadgeDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
    },
    darkBadgeText: {
      fontSize: 11,
      fontWeight: '700',
      fontFamily: t.fonts.bodyBold,
      letterSpacing: 0.3,
    },
  });
