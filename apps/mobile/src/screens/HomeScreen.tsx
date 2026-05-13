import { useCallback, useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { API_BASE_URL, api, ApiError, isEndpointUnavailableError } from '../api';
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
  LoadingBlock,
  Screen,
  SectionTitle,
  WarningBanner,
  uiTheme,
} from '../ui';
import { SessionUser, SiteVisit, Team } from '../types';

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');

type VisitThumbnailImage = {
  uri?: string | null;
  url?: string | null;
  path?: string | null;
};

export function HomeScreen({
  token,
  initialUser,
  onUserRefreshed,
  onOpenCheckIn,
  onOpenDashboard,
  onOpenAssetMap,
  onOpenDefects,
  onOpenSyncQueue,
  onOpenVisit,
  onLogout,
  onUnauthorized,
  syncQueueSnapshot,
  isSyncingQueue,
  isOffline,
}: {
  token: string;
  initialUser: SessionUser;
  onUserRefreshed: (user: SessionUser) => void;
  onOpenCheckIn: () => void;
  onOpenDashboard: () => void;
  onOpenAssetMap: () => void;
  onOpenDefects: () => void;
  onOpenSyncQueue: () => void;
  onOpenVisit: (visit: SiteVisit) => void;
  onLogout: () => Promise<void>;
  onUnauthorized: (error?: unknown) => Promise<void>;
  syncQueueSnapshot: SyncQueueSnapshot;
  isSyncingQueue: boolean;
  isOffline: boolean;
}) {
  const [user, setUser] = useState(initialUser);
  const [teams, setTeams] = useState<Team[]>([]);
  const [activeVisits, setActiveVisits] = useState<SiteVisit[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [joiningVisitId, setJoiningVisitId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadHomeData = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      const [me, teamList, visitList] = await Promise.all([
        api.getMe(token),
        api.getTeams(token),
        api.getActiveSiteVisits(token),
      ]);
      const visitsWithImageData = await loadVisitDetails(token, visitList);

      setUser(me);
      setTeams(teamList);
      setActiveVisits(visitsWithImageData);
      onUserRefreshed(me);
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        await onUnauthorized(loadError);
        return;
      }

      setError(loadError instanceof Error ? loadError.message : 'Unable to load active sites.');
    } finally {
      setIsLoading(false);
    }
  }, [onUnauthorized, onUserRefreshed, token]);

  useEffect(() => {
    loadHomeData();
  }, [loadHomeData]);

  const handleOpenVisit = useCallback(
    async (visit: SiteVisit) => {
      try {
        setError(null);
        setJoiningVisitId(visit.id);

        const joinedVisit = await api.joinSiteVisit(token, visit.id);
        onOpenVisit(joinedVisit);
      } catch (joinError) {
        if (joinError instanceof ApiError && joinError.status === 401) {
          await onUnauthorized(joinError);
          return;
        }

        if (isEndpointUnavailableError(joinError)) {
          onOpenVisit(visit);
          return;
        }

        setError(joinError instanceof Error ? joinError.message : 'Unable to join this site visit.');
      } finally {
        setJoiningVisitId(null);
      }
    },
    [onOpenVisit, onUnauthorized, token],
  );

  return (
    <View style={styles.root}>
      <Screen
        title="Active Sites"
        leftAction={{
          icon: 'menu',
          onPress: () => setIsDrawerOpen(true),
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
            onPress: onOpenCheckIn,
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
        {isLoading ? <LoadingBlock label="Loading active sites..." /> : null}
        <SyncQueueSummaryCard
          snapshot={syncQueueSnapshot}
          isSyncing={isSyncingQueue}
          onOpen={onOpenSyncQueue}
        />

        {!isLoading ? (
          <Card>
            <View style={styles.listHeader}>
              <SectionTitle>Active Sites</SectionTitle>
              <Text style={styles.countText}>{activeVisits.length}</Text>
            </View>

            {activeVisits.length === 0 ? (
              <EmptyState
                title="No active visits"
                description="Create a new check-in to start work at a substation."
              />
            ) : (
              <View style={styles.visitList}>
                {activeVisits.map((visit) => (
                  <ActiveVisitRow
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
      </Screen>

      <HomeDrawer
        visible={isDrawerOpen}
        user={user}
        teams={teams}
        onClose={() => setIsDrawerOpen(false)}
        onOpenDashboard={onOpenDashboard}
        onOpenAssetMap={onOpenAssetMap}
        onOpenDefects={onOpenDefects}
        onOpenSyncQueue={onOpenSyncQueue}
        onLogout={onLogout}
        syncQueueSnapshot={syncQueueSnapshot}
      />
    </View>
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

function ActiveVisitRow({
  visit,
  isJoining,
  onPress,
}: {
  visit: SiteVisit;
  isJoining: boolean;
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
        <Text style={styles.visitName}>{visit.substation.name}</Text>
        <Text style={styles.rowLabel}>Functional Location</Text>
        <Text style={styles.functionalLocation}>{visit.substation.code || 'Not available'}</Text>
      </View>

      <Text style={isJoining ? styles.joiningText : styles.rowArrow}>
        {isJoining ? 'Joining' : '>'}
      </Text>
    </Pressable>
  );
}

function HomeDrawer({
  visible,
  user,
  teams,
  onClose,
  onOpenDashboard,
  onOpenAssetMap,
  onOpenDefects,
  onOpenSyncQueue,
  onLogout,
  syncQueueSnapshot,
}: {
  visible: boolean;
  user: SessionUser;
  teams: Team[];
  onClose: () => void;
  onOpenDashboard: () => void;
  onOpenAssetMap: () => void;
  onOpenDefects: () => void;
  onOpenSyncQueue: () => void;
  onLogout: () => Promise<void>;
  syncQueueSnapshot: SyncQueueSnapshot;
}) {
  const activeSyncCount = getActiveQueueCount(syncQueueSnapshot);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.drawerRoot}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={styles.drawerPanel}>
          <ScrollView contentContainerStyle={styles.drawerContent}>
            <View style={styles.drawerHeader}>
              <Text style={styles.drawerTitle}>Menu</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close menu"
                onPress={onClose}
                style={({ pressed }) => [styles.drawerCloseButton, pressed && styles.drawerItemPressed]}
              >
                <Text style={styles.drawerCloseText}>X</Text>
              </Pressable>
            </View>

            <View style={styles.identityCard}>
              <Text style={styles.identityLabel}>User Info / Team Info</Text>
              <Text style={styles.identityName}>{user.name}</Text>
              <Text style={styles.identityEmail}>{user.email}</Text>
              <View style={styles.teamList}>
                {teams.length > 0 ? (
                  teams.map((team) => (
                    <View key={team.id} style={styles.teamRow}>
                      <Text style={styles.teamName}>{team.name}</Text>
                      <Text style={styles.teamCode}>{team.code}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.teamEmpty}>No team available</Text>
                )}
              </View>
            </View>

            <View style={styles.drawerNav}>
              <DrawerItem label="Active Sites" active onPress={onClose} />
              <DrawerItem
                label="Dashboard"
                onPress={() => {
                  onClose();
                  onOpenDashboard();
                }}
              />
              <DrawerItem
                label="Map"
                onPress={() => {
                  onClose();
                  onOpenAssetMap();
                }}
              />
              <DrawerItem
                label="Defects"
                onPress={() => {
                  onClose();
                  onOpenDefects();
                }}
              />
              <DrawerItem
                label={activeSyncCount > 0 ? `Sync Queue (${activeSyncCount})` : 'Sync Queue'}
                onPress={() => {
                  onClose();
                  onOpenSyncQueue();
                }}
              />
            </View>

            <DrawerItem
              label="Logout"
              tone="danger"
              onPress={() => {
                onClose();
                void onLogout();
              }}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
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
      <Text style={styles.rowArrow}>{'>'}</Text>
    </Pressable>
  );
}

function DrawerItem({
  label,
  onPress,
  tone = 'default',
  active = false,
}: {
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.drawerItem,
        active && styles.drawerItemActive,
        pressed && styles.drawerItemPressed,
      ]}
    >
      <Text
        style={[
          styles.drawerItemText,
          active && styles.drawerItemTextActive,
          tone === 'danger' && styles.drawerItemTextDanger,
        ]}
      >
        {label}
      </Text>
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
  root: {
    flex: 1,
  },
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
  rowArrow: {
    width: 18,
    color: uiTheme.colors.textMuted,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'right',
  },
  joiningText: {
    minWidth: 58,
    color: uiTheme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  drawerRoot: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.42)',
  },
  drawerPanel: {
    width: '82%',
    maxWidth: 340,
    height: '100%',
    backgroundColor: uiTheme.colors.primary,
    borderRightWidth: 1,
    borderRightColor: '#1F2937',
    shadowColor: '#000000',
    shadowOffset: {
      width: 8,
      height: 0,
    },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 12,
  },
  drawerContent: {
    paddingTop: 34,
    paddingHorizontal: 16,
    paddingBottom: 28,
    gap: 16,
  },
  drawerHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  drawerTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },
  drawerCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
  },
  drawerCloseText: {
    color: '#E5E7EB',
    fontSize: 16,
    fontWeight: '900',
  },
  identityCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#1F2937',
    padding: 16,
    gap: 9,
  },
  identityLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  identityName: {
    color: '#FFFFFF',
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '700',
  },
  identityEmail: {
    color: '#D1D5DB',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  teamList: {
    gap: 8,
    paddingTop: 6,
  },
  teamRow: {
    borderRadius: 8,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#374151',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3,
  },
  teamName: {
    color: '#F9FAFB',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  teamCode: {
    color: '#9CA3AF',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  teamEmpty: {
    color: '#9CA3AF',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  drawerNav: {
    gap: 8,
  },
  drawerItem: {
    minHeight: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  drawerItemActive: {
    borderColor: '#374151',
    backgroundColor: '#1F2937',
  },
  drawerItemPressed: {
    opacity: 0.82,
  },
  drawerItemText: {
    color: '#D1D5DB',
    fontSize: 16,
    fontWeight: '600',
  },
  drawerItemTextActive: {
    color: '#FFFFFF',
  },
  drawerItemTextDanger: {
    color: '#FCA5A5',
  },
});
