import { Children, type ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSync } from '../context/SyncContext';
import type { AppDrawerScreenProps } from '../navigation/types';
import {
  AppButton,
  Card,
  EmptyState,
  ErrorBanner,
  KeyValueRow,
  Screen,
  SectionTitle,
  SuccessBanner,
  WarningBanner,
  uiTheme,
} from '../ui';
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

  return (
    <Screen
      title="Sync Queue"
      subtitle="Offline inspection submissions and visit completion waiting for upload."
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

      <View style={styles.statusCard}>
        <View style={styles.summaryHeader}>
          <SectionTitle>Queue Status</SectionTitle>
          <StatusBadge status={summaryStatus} />
        </View>
        <View style={styles.statsGrid}>
          <QueueStat label="Pending" value={getPendingQueueCount(snapshot)} />
          <QueueStat label="Syncing" value={getSyncingQueueCount(snapshot)} />
          <QueueStat label="Failed" value={getFailedQueueCount(snapshot)} />
          <QueueStat label="Completed" value={getCompletedQueueCount(snapshot)} />
        </View>
        <View style={styles.retryActionWrap}>
          <AppButton
            label={isSyncing ? 'Syncing...' : 'Retry Sync'}
            onPress={handleRetry}
            loading={isSyncing}
            disabled={isSyncing || activeCount === 0 || isOffline}
          />
        </View>
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
  const hasChildren = Children.count(children) > 0;

  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      {hasChildren ? <View style={styles.queueList}>{children}</View> : (
        <EmptyState title={title} description={emptyText} />
      )}
    </Card>
  );
}

function QueueItemCard({ item }: { item: OfflineInspectionQueueItem }) {
  return (
    <View style={styles.queueCard}>
      <View style={styles.itemHeader}>
        <View style={styles.itemTitleWrap}>
          <Text style={styles.assetCode}>{item.summary.assetCode}</Text>
          <Text style={styles.assetName} numberOfLines={2}>
            {item.summary.assetName ?? 'Unnamed asset'}
          </Text>
        </View>
        <StatusBadge status={item.status} />
      </View>
      <KeyValueRow label="Pencawang" value={item.summary.substationName} />
      <KeyValueRow label="Template" value={`${item.summary.templateName} v${item.summary.templateVersion}`} />
      <KeyValueRow label="Cycle" value={String(item.summary.inspectionCycle)} />
      <KeyValueRow label="Photos" value={String(item.photos.length)} />
      <KeyValueRow label="Queued" value={formatDateTime(item.createdAt)} />
      <KeyValueRow label="Attempts" value={String(item.attemptCount)} />
      {item.errorMessage ? (
        <View style={styles.inlineError}>
          <Text style={styles.inlineErrorText}>{item.errorMessage}</Text>
        </View>
      ) : null}
    </View>
  );
}

function VisitCompletionQueueCard({ item }: { item: OfflineVisitCompletionQueueItem }) {
  return (
    <View style={styles.queueCard}>
      <View style={styles.itemHeader}>
        <View style={styles.itemTitleWrap}>
          <Text style={styles.assetCode}>Complete Visit</Text>
          <Text style={styles.assetName} numberOfLines={2}>
            {item.summary.substationName}
          </Text>
        </View>
        <StatusBadge status={item.status} />
      </View>
      <KeyValueRow label="Team" value={item.summary.teamName} />
      <KeyValueRow
        label="Progress"
        value={`${item.summary.inspectedAssets}/${item.summary.totalAssets} assets`}
      />
      <KeyValueRow label="Queued" value={formatDateTime(item.createdAt)} />
      <KeyValueRow label="Attempts" value={String(item.attemptCount)} />
      {item.errorMessage ? (
        <View style={styles.inlineError}>
          <Text style={styles.inlineErrorText}>{item.errorMessage}</Text>
        </View>
      ) : null}
    </View>
  );
}

function CompletedQueueCard({ record }: { record: CompletedInspectionSyncRecord }) {
  return (
    <View style={styles.queueCard}>
      <View style={styles.itemHeader}>
        <View style={styles.itemTitleWrap}>
          <Text style={styles.assetCode}>{record.summary.assetCode}</Text>
          <Text style={styles.assetName} numberOfLines={2}>
            {record.summary.assetName ?? 'Unnamed asset'}
          </Text>
        </View>
        <StatusBadge status={record.status} />
      </View>
      <KeyValueRow label="Pencawang" value={record.summary.substationName} />
      <KeyValueRow label="Photos" value={String(record.photoCount)} />
      <KeyValueRow label="Completed" value={formatDateTime(record.completedAt)} />
    </View>
  );
}

function CompletedVisitCompletionCard({
  record,
}: {
  record: CompletedVisitCompletionSyncRecord;
}) {
  return (
    <View style={styles.queueCard}>
      <View style={styles.itemHeader}>
        <View style={styles.itemTitleWrap}>
          <Text style={styles.assetCode}>Visit Completed</Text>
          <Text style={styles.assetName} numberOfLines={2}>
            {record.summary.substationName}
          </Text>
        </View>
        <StatusBadge status={record.status} />
      </View>
      <KeyValueRow label="Team" value={record.summary.teamName} />
      <KeyValueRow label="Completed" value={formatDateTime(record.completedAt)} />
    </View>
  );
}

function QueueStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: SyncQueueDisplayStatus }) {
  return (
    <View
      style={[
        styles.statusBadge,
        status === 'COMPLETED' && styles.statusCompleted,
        status === 'SYNCING' && styles.statusSyncing,
        status === 'FAILED' && styles.statusFailed,
      ]}
    >
      <Text
        style={[
          styles.statusText,
          status === 'COMPLETED' && styles.statusTextCompleted,
          status === 'SYNCING' && styles.statusTextSyncing,
          status === 'FAILED' && styles.statusTextFailed,
        ]}
      >
        {formatStatus(status)}
      </Text>
    </View>
  );
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

const styles = StyleSheet.create({
  statusCard: {
    backgroundColor: uiTheme.colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    padding: 20,
    paddingBottom: 22,
  },
  summaryHeader: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 20,
    alignItems: 'stretch',
  },
  retryActionWrap: {
    minHeight: 52,
    marginTop: 20,
    width: '100%',
  },
  statBox: {
    width: '47%',
    minHeight: 96,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.surfaceMuted,
    padding: 12,
    justifyContent: 'center',
    gap: 3,
  },
  statValue: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    color: uiTheme.colors.textPrimary,
  },
  statLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: uiTheme.colors.textSecondary,
    textTransform: 'uppercase',
  },
  queueList: {
    gap: 10,
  },
  queueCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.card,
    padding: 12,
    gap: 10,
  },
  itemHeader: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  itemTitleWrap: {
    flex: 1,
    gap: 3,
  },
  assetCode: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: uiTheme.colors.textPrimary,
  },
  assetName: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: uiTheme.colors.textSecondary,
  },
  inlineError: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: uiTheme.colors.dangerSoft,
    padding: 10,
  },
  inlineErrorText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#991B1B',
  },
  statusBadge: {
    borderRadius: uiTheme.radius.pill,
    borderWidth: 1,
    borderColor: '#FDE68A',
    backgroundColor: uiTheme.colors.warningSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusCompleted: {
    borderColor: '#BBF7D0',
    backgroundColor: uiTheme.colors.successSoft,
  },
  statusSyncing: {
    borderColor: '#C7D2FE',
    backgroundColor: '#EEF2FF',
  },
  statusFailed: {
    borderColor: '#FECACA',
    backgroundColor: uiTheme.colors.dangerSoft,
  },
  statusText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: uiTheme.colors.warning,
  },
  statusTextCompleted: {
    color: uiTheme.colors.success,
  },
  statusTextSyncing: {
    color: '#3730A3',
  },
  statusTextFailed: {
    color: uiTheme.colors.danger,
  },
});
