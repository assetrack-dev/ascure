import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { API_BASE_URL, api, ApiError, isEndpointUnavailableError } from '../api';
import { useSession } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import type { AppDrawerScreenProps } from '../navigation/types';
import {
  getActiveQueueCount,
  getFailedQueueCount,
  getPendingQueueCount,
  getSyncingQueueCount,
  SyncQueueSnapshot,
} from '../syncQueue';
import {
  Card,
  EmptyState,
  ErrorBanner,
  Screen,
  SectionTitle,
  SkeletonCard,
  WarningBanner,
  uiTheme,
} from '../ui';
import { SiteVisit } from '../types';
import { formatDateTime } from '../utils';

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');

type VisitThumbnailImage = {
  uri?: string | null;
  url?: string | null;
  path?: string | null;
};

export function HomeScreen() {
  const navigation = useNavigation<AppDrawerScreenProps<'Home'>['navigation']>();
  const { token, setUser, handleUnauthorized } = useSession();
  const { snapshot: syncQueueSnapshot, isSyncing: isSyncingQueue, isOffline } = useSync();
  const [activeVisits, setActiveVisits] = useState<SiteVisit[]>([]);
  const [completedVisits, setCompletedVisits] = useState<SiteVisit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [joiningVisitId, setJoiningVisitId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadHomeData = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      const [me, activeVisitList, completedVisitList] = await Promise.all([
        api.getMe(token),
        api.getActiveSiteVisits(token),
        api.getCompletedSiteVisits(token),
      ]);
      const activeVisitsWithImageData = await loadVisitDetails(token, activeVisitList);

      setUser(me);
      setActiveVisits(activeVisitsWithImageData);
      setCompletedVisits(completedVisitList);
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        await handleUnauthorized(loadError);
        return;
      }

      setError(loadError instanceof Error ? loadError.message : 'Unable to load visits.');
    } finally {
      setIsLoading(false);
    }
  }, [handleUnauthorized, setUser, token]);

  useEffect(() => {
    loadHomeData();
  }, [loadHomeData]);

  const handleOpenVisit = useCallback(
    async (visit: SiteVisit) => {
      try {
        setError(null);
        setJoiningVisitId(visit.id);

        if (isCompletedVisit(visit)) {
          navigation.navigate('VisitDetail', {
            visitId: visit.id,
            substationId: visit.substationId,
          });
          return;
        }

        const joinedVisit = await api.joinSiteVisit(token, visit.id);
        navigation.navigate('VisitDetail', {
          visitId: joinedVisit.id,
          substationId: joinedVisit.substationId,
        });
      } catch (joinError) {
        if (joinError instanceof ApiError && joinError.status === 401) {
          await handleUnauthorized(joinError);
          return;
        }

        if (isEndpointUnavailableError(joinError)) {
          navigation.navigate('VisitDetail', {
            visitId: visit.id,
            substationId: visit.substationId,
          });
          return;
        }

        setError(joinError instanceof Error ? joinError.message : 'Unable to join this site visit.');
      } finally {
        setJoiningVisitId(null);
      }
    },
    [handleUnauthorized, navigation, token],
  );

  return (
    <Screen
      title="Visits"
      leftAction={{
        icon: 'menu',
        onPress: () => navigation.openDrawer(),
        accessibilityLabel: 'Menu',
      }}
      rightActions={[
        {
          icon: 'refresh',
          onPress: loadHomeData,
          accessibilityLabel: 'Refresh',
          disabled: isLoading,
        },
        {
          icon: 'add',
          onPress: () => navigation.navigate('CheckIn'),
          accessibilityLabel: 'Create Check In',
        },
      ]}
    >
      <ErrorBanner message={error} />
      <WarningBanner
        message={
          isOffline
            ? 'Offline mode: inspections and visit completion can be queued until connection returns.'
            : null
        }
      />
      {isLoading ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : null}
      <SyncQueueSummaryCard
        snapshot={syncQueueSnapshot}
        isSyncing={isSyncingQueue}
        onOpen={() => navigation.navigate('SyncQueue')}
      />

      {!isLoading ? (
        <Card>
          <View style={styles.listHeader}>
            <SectionTitle>Active Visits</SectionTitle>
            <Text style={styles.countText}>{activeVisits.length}</Text>
          </View>

          {activeVisits.length === 0 ? (
            <EmptyState
              icon="inbox"
              title="No active visits"
              description="Create a new check-in to start work at a substation."
            />
          ) : (
            <View style={styles.visitList}>
              {activeVisits.map((visit) => (
                <VisitRow
                  key={visit.id}
                  visit={visit}
                  isJoining={joiningVisitId === visit.id}
                  onPress={() => {
                    void handleOpenVisit(visit);
                  }}
                />
              ))}
            </View>
          )}
        </Card>
      ) : null}

      {!isLoading ? (
        <Card>
          <View style={styles.listHeader}>
            <SectionTitle>Completed Visits</SectionTitle>
            <Text style={styles.countText}>{completedVisits.length}</Text>
          </View>

          {completedVisits.length === 0 ? (
            <EmptyState
              icon="check-circle"
              title="No completed visits"
              description="Completed site visits will stay available here for recheck or correction."
            />
          ) : (
            <View style={styles.visitList}>
              {completedVisits.map((visit) => (
                <VisitRow
                  key={visit.id}
                  visit={visit}
                  isJoining={false}
                  metaLabel={{
                    label: 'Completed',
                    value: formatDateTime(visit.completedAt ?? visit.endedAt ?? visit.startedAt),
                  }}
                  onPress={() => {
                    void handleOpenVisit(visit);
                  }}
                />
              ))}
            </View>
          )}
        </Card>
      ) : null}
    </Screen>
  );
}

async function loadVisitDetails(token: string, visits: SiteVisit[]) {
  return Promise.all(
    visits.map(async (visit) => {
      try {
        return await api.getSiteVisit(token, visit.id);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          throw error;
        }

        return visit;
      }
    }),
  );
}

function VisitRow({
  visit,
  isJoining,
  metaLabel,
  onPress,
}: {
  visit: SiteVisit;
  isJoining: boolean;
  metaLabel?: {
    label: string;
    value: string;
  };
  onPress: () => void;
}) {
  const thumbnailUri = getVisitThumbnailUri(visit);

  return (
    <Pressable
      onPress={onPress}
      disabled={isJoining}
      style={({ pressed }) => [styles.visitRow, pressed && styles.visitRowPressed]}
    >
      <View style={styles.thumbnailFrame}>
        {thumbnailUri ? (
          <Image source={{ uri: thumbnailUri }} style={styles.thumbnail} resizeMode="cover" />
        ) : (
          <View style={styles.thumbnailPlaceholder}>
            <Text style={styles.thumbnailPlaceholderText}>No image</Text>
          </View>
        )}
      </View>

      <View style={styles.visitTextWrap}>
        <Text style={styles.rowLabel}>Nama Pencawang</Text>
        <Text style={styles.visitName}>{visit.pencawangName ?? visit.substation.name}</Text>
        <Text style={styles.rowLabel}>Functional Location</Text>
        <Text style={styles.functionalLocation}>
          {visit.functionalLocation ?? visit.substation.location ?? visit.substation.code ?? 'Not available'}
        </Text>
        {metaLabel ? (
          <>
            <Text style={styles.rowLabel}>{metaLabel.label}</Text>
            <Text style={styles.functionalLocation}>{metaLabel.value}</Text>
          </>
        ) : null}
      </View>

      {isJoining ? (
        <Text style={styles.joiningText}>Joining</Text>
      ) : (
        <Feather name="chevron-right" size={20} color={uiTheme.colors.textMuted} />
      )}
    </Pressable>
  );
}

function isCompletedVisit(visit: SiteVisit) {
  return visit.status === 'COMPLETED';
}

function SyncQueueSummaryCard({
  snapshot,
  isSyncing,
  onOpen,
}: {
  snapshot: SyncQueueSnapshot;
  isSyncing: boolean;
  onOpen: () => void;
}) {
  const activeCount = getActiveQueueCount(snapshot);

  if (activeCount === 0) {
    return null;
  }

  const pendingCount = getPendingQueueCount(snapshot);
  const syncingCount = getSyncingQueueCount(snapshot);
  const failedCount = getFailedQueueCount(snapshot);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [styles.syncSummaryCard, pressed && styles.visitRowPressed]}
    >
      <View style={styles.syncSummaryTextWrap}>
        <Text style={styles.syncSummaryTitle}>
          {failedCount > 0 ? 'Sync needs attention' : isSyncing || syncingCount > 0 ? 'Syncing offline work' : 'Pending sync'}
        </Text>
        <Text style={styles.syncSummaryMeta}>
          {pendingCount} pending, {syncingCount} syncing, {failedCount} failed
        </Text>
      </View>
      <Feather name="chevron-right" size={20} color={uiTheme.colors.textMuted} />
    </Pressable>
  );
}

function getVisitThumbnailUri(visit: SiteVisit) {
  const image = getFirstVisitImage(visit);

  return image ? getImageSourceUri(image) : null;
}

function getFirstVisitImage(visit: SiteVisit): VisitThumbnailImage | null {
  const siteVisitImage = visit.images?.[0];

  if (siteVisitImage) {
    return siteVisitImage;
  }

  for (const inspection of visit.inspections ?? []) {
    const inspectionImage = inspection.inspectionImages?.[0] ?? inspection.images?.[0];

    if (inspectionImage) {
      return inspectionImage;
    }
  }

  return null;
}

function getImageSourceUri(image: VisitThumbnailImage) {
  const source = image.uri || image.url || image.path;

  if (!source) {
    return null;
  }

  if (/^[a-z][a-z\d+\-.]*:/i.test(source)) {
    return source;
  }

  return source.startsWith('/') ? `${API_ORIGIN}${source}` : `${API_ORIGIN}/${source}`;
}

const styles = StyleSheet.create({
  listHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  syncSummaryCard: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FDE68A',
    backgroundColor: uiTheme.colors.warningSoft,
    padding: 14,
  },
  syncSummaryTextWrap: {
    flex: 1,
    gap: 4,
  },
  syncSummaryTitle: {
    color: uiTheme.colors.textPrimary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  syncSummaryMeta: {
    color: uiTheme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  countText: {
    minWidth: 36,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: uiTheme.colors.surfaceMuted,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    color: uiTheme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  visitList: {
    gap: 10,
  },
  visitRow: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.card,
    padding: 10,
  },
  visitRowPressed: {
    backgroundColor: uiTheme.colors.surfacePressed,
    transform: [{ scale: 0.995 }],
  },
  thumbnailFrame: {
    width: 56,
    height: 56,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: uiTheme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  thumbnailPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  thumbnailPlaceholderText: {
    color: uiTheme.colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  visitTextWrap: {
    flex: 1,
    gap: 4,
  },
  rowLabel: {
    color: uiTheme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  visitName: {
    color: uiTheme.colors.textPrimary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  functionalLocation: {
    color: uiTheme.colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  joiningText: {
    minWidth: 58,
    color: uiTheme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
});
