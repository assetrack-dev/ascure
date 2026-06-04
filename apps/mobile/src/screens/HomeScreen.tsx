import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { API_BASE_URL, api, ApiError, isEndpointUnavailableError } from '../api';
import { useSession } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import type { AppDrawerScreenProps } from '../navigation/types';
import {
  getAutoOpenWorkspace,
  getAvailableMobileWorkspaces,
  getInspectionQueueStatusGroup,
  type InspectionQueueStatusGroup,
  type MobileWorkspace,
  type MobileWorkspaceId,
} from '../operationalWorkspace';
import {
  getActiveQueueCount,
  getFailedQueueCount,
  getPendingQueueCount,
  getSyncingQueueCount,
  SyncQueueSnapshot,
} from '../syncQueue';
import {
  AppButton,
  BodyText,
  Card,
  EmptyState,
  ErrorBanner,
  Screen,
  SectionTitle,
  SkeletonCard,
  StatusChip,
  WarningBanner,
  uiTheme,
} from '../ui';
import {
  EffectiveCapability,
  InspectionSummary,
  OperationalScope,
  SiteVisit,
  UserRole,
} from '../types';
import { formatDateTime } from '../utils';

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');

type VisitThumbnailImage = {
  uri?: string | null;
  url?: string | null;
  path?: string | null;
};

type InspectionQueueItem = {
  id: string;
  group: InspectionQueueStatusGroup;
  scope: OperationalScope;
  title: string;
  subtitle: string;
  visit: SiteVisit;
  inspection?: InspectionSummary;
};

const SCOPE_ORDER: OperationalScope[] = [
  'SAVR',
  'SAVT',
  'PENCAWANG',
  'FEEDER_PILLAR',
  'CABLE_BRIDGE',
  'LINK_BOX',
];

const SCOPE_LABELS: Record<OperationalScope, string> = {
  SAVR: 'SAVR',
  SAVT: 'SAVT',
  PENCAWANG: 'Pencawang',
  FEEDER_PILLAR: 'Feeder Pillar',
  CABLE_BRIDGE: 'Cable Bridge',
  LINK_BOX: 'Link Box',
};

const QUEUE_GROUPS: Array<{
  group: InspectionQueueStatusGroup;
  label: string;
  tone: 'info' | 'success' | 'danger';
}> = [
  { group: 'IN_PROGRESS', label: 'In Progress', tone: 'info' },
  { group: 'COMPLETED', label: 'Completed', tone: 'success' },
  { group: 'NEEDS_ATTENTION', label: 'Need Amendment / Rejected', tone: 'danger' },
];

export function HomeScreen() {
  const navigation = useNavigation<AppDrawerScreenProps<'Home'>['navigation']>();
  const { token, user, setUser, handleUnauthorized } = useSession();
  const { snapshot: syncQueueSnapshot, isSyncing: isSyncingQueue, isOffline } = useSync();
  const [activeVisits, setActiveVisits] = useState<SiteVisit[]>([]);
  const [completedVisits, setCompletedVisits] = useState<SiteVisit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [joiningVisitId, setJoiningVisitId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] =
    useState<MobileWorkspaceId | null>(null);
  const [selectedScope, setSelectedScope] = useState<OperationalScope>('SAVR');
  const [capabilities, setCapabilities] = useState<EffectiveCapability[]>([]);
  const workspaces = useMemo(
    () => getAvailableMobileWorkspaces(user, capabilities),
    [user, capabilities],
  );
  const autoOpenWorkspace = useMemo(
    () => getAutoOpenWorkspace(user, capabilities),
    [user, capabilities],
  );
  const availableScopes = useMemo(
    () => getAvailableInspectionScopes(activeVisits, completedVisits),
    [activeVisits, completedVisits],
  );
  const queueItems = useMemo(
    () => buildInspectionQueueItems(activeVisits, completedVisits, selectedScope),
    [activeVisits, completedVisits, selectedScope],
  );
  const showOperationalSessionsCard = canShowOperationalSessionsInWorkspace(user.role);

  const loadHomeData = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      const [me, activeVisitList, completedVisitList, myCapabilities] = await Promise.all([
        api.getMe(token),
        api.getActiveSiteVisits(token),
        api.getCompletedSiteVisits(token),
        api.getMyCapabilities(token),
      ]);
      const activeVisitsWithImageData = await loadVisitDetails(token, activeVisitList);

      setUser(me);
      setActiveVisits(activeVisitsWithImageData);
      setCompletedVisits(completedVisitList);
      setCapabilities(myCapabilities);
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

  useEffect(() => {
    // Temporary G4E diagnostic — confirms what the device actually receives
    // from /users/me/capabilities and which workspaces resolve. Remove once
    // mobile workspace visibility is verified.
    console.log(
      '[G4E] effective capabilities:',
      capabilities.map((capability) => capability.code),
    );
    console.log(
      '[G4E] resolved workspaces:',
      workspaces.map((workspace) => workspace.id),
      '| role:',
      user.role,
    );
  }, [capabilities, workspaces, user.role]);

  useEffect(() => {
    if (autoOpenWorkspace) {
      setSelectedWorkspaceId(autoOpenWorkspace.id);
      return;
    }

    setSelectedWorkspaceId((currentWorkspaceId) => {
      if (
        currentWorkspaceId &&
        workspaces.some((workspace) => workspace.id === currentWorkspaceId)
      ) {
        return currentWorkspaceId;
      }

      return null;
    });
  }, [autoOpenWorkspace, workspaces]);

  useEffect(() => {
    if (!availableScopes.includes(selectedScope)) {
      setSelectedScope(availableScopes[0] ?? 'SAVR');
    }
  }, [availableScopes, selectedScope]);

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

  const handleOpenQueueItem = useCallback(
    (item: InspectionQueueItem) => {
      void handleOpenVisit(item.visit);
    },
    [handleOpenVisit],
  );

  return (
    <Screen
      title="Workspace"
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
        <WorkspaceEntry
          workspaces={workspaces}
          selectedWorkspaceId={selectedWorkspaceId}
          onSelectWorkspace={setSelectedWorkspaceId}
        />
      ) : null}

      {!isLoading && workspaces.length === 0 ? (
        <Card>
          <EmptyState
            title="No workspace assigned"
            description="Contact your administrator to grant Inspection or Maintenance capability."
          />
        </Card>
      ) : null}

      {!isLoading && selectedWorkspaceId === 'INSPECTION' ? (
        <InspectionWorkspaceView
          activeVisits={activeVisits}
          completedVisits={completedVisits}
          availableScopes={availableScopes}
          selectedScope={selectedScope}
          queueItems={queueItems}
          joiningVisitId={joiningVisitId}
          onSelectScope={setSelectedScope}
          onOpenQueueItem={handleOpenQueueItem}
          onOpenVisit={handleOpenVisit}
          showOperationalSessions={showOperationalSessionsCard}
          onOpenSessions={() => navigation.navigate('OperationalSessions')}
          onCreateCheckIn={() => navigation.navigate('CheckIn')}
        />
      ) : null}

      {!isLoading && selectedWorkspaceId === 'MAINTENANCE' ? (
        <MaintenanceWorkspacePlaceholder
          onOpenDefects={() => navigation.navigate('DefectList')}
        />
      ) : null}
    </Screen>
  );
}

function WorkspaceEntry({
  workspaces,
  selectedWorkspaceId,
  onSelectWorkspace,
}: {
  workspaces: MobileWorkspace[];
  selectedWorkspaceId: MobileWorkspaceId | null;
  onSelectWorkspace: (workspaceId: MobileWorkspaceId) => void;
}) {
  if (workspaces.length <= 1) {
    return null;
  }

  return (
    <Card>
      <View style={styles.listHeader}>
        <SectionTitle>Workspaces</SectionTitle>
        <Text style={styles.countText}>{workspaces.length}</Text>
      </View>
      <View style={styles.workspaceGrid}>
        {workspaces.map((workspace) => (
          <WorkspaceCard
            key={workspace.id}
            workspace={workspace}
            selected={workspace.id === selectedWorkspaceId}
            onPress={() => onSelectWorkspace(workspace.id)}
          />
        ))}
      </View>
    </Card>
  );
}

function WorkspaceCard({
  workspace,
  selected,
  onPress,
}: {
  workspace: MobileWorkspace;
  selected: boolean;
  onPress: () => void;
}) {
  const iconName = workspace.id === 'INSPECTION' ? 'clipboard' : 'tool';

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.workspaceCard,
        selected && styles.workspaceCardSelected,
        pressed && styles.visitRowPressed,
      ]}
    >
      <View style={styles.workspaceIcon}>
        <Feather name={iconName} size={17} color={uiTheme.colors.primary} />
      </View>
      <View style={styles.workspaceTextWrap}>
        <Text style={styles.workspaceTitle}>{workspace.label}</Text>
        <Text style={styles.workspaceMeta}>
          {workspace.id === 'INSPECTION' ? 'Operational queue' : 'Assigned tasks'}
        </Text>
      </View>
    </Pressable>
  );
}

function InspectionWorkspaceView({
  activeVisits,
  completedVisits,
  availableScopes,
  selectedScope,
  queueItems,
  joiningVisitId,
  onSelectScope,
  onOpenQueueItem,
  onOpenVisit,
  showOperationalSessions,
  onOpenSessions,
  onCreateCheckIn,
}: {
  activeVisits: SiteVisit[];
  completedVisits: SiteVisit[];
  availableScopes: OperationalScope[];
  selectedScope: OperationalScope;
  queueItems: InspectionQueueItem[];
  joiningVisitId: string | null;
  onSelectScope: (scope: OperationalScope) => void;
  onOpenQueueItem: (item: InspectionQueueItem) => void;
  onOpenVisit: (visit: SiteVisit) => void;
  showOperationalSessions: boolean;
  onOpenSessions: () => void;
  onCreateCheckIn: () => void;
}) {
  const activeScopeVisits = activeVisits.filter((visit) =>
    isVisitInScope(visit, selectedScope),
  );
  const completedScopeVisits = completedVisits.filter((visit) =>
    isVisitInScope(visit, selectedScope),
  );

  return (
    <>
      <Card>
        <View style={styles.listHeader}>
          <SectionTitle>Inspection Scope</SectionTitle>
          <StatusChip label={SCOPE_LABELS[selectedScope]} tone="info" />
        </View>
        <View style={styles.scopeGrid}>
          {availableScopes.map((scope) => (
            <ScopeCard
              key={scope}
              scope={scope}
              selected={scope === selectedScope}
              onPress={() => onSelectScope(scope)}
            />
          ))}
        </View>
      </Card>

      {showOperationalSessions ? (
        <Card>
          <View style={styles.listHeader}>
            <SectionTitle>Operational Sessions</SectionTitle>
            <StatusChip label="Sessions" tone="info" />
          </View>
          <BodyText muted>
            Open assigned inspection sessions without changing the current visit queue.
          </BodyText>
          <AppButton label="Open Sessions" variant="secondary" onPress={onOpenSessions} />
        </Card>
      ) : null}

      <Card>
        <View style={styles.listHeader}>
          <SectionTitle>Inspection Queue</SectionTitle>
          <Text style={styles.countText}>{queueItems.length}</Text>
        </View>
        {queueItems.length === 0 ? (
          <EmptyState
            icon="clipboard"
            title="No inspection queue"
            description="Create or join a site visit to begin SAVR inspection work."
          />
        ) : (
          <View style={styles.queueGrid}>
            {QUEUE_GROUPS.map((entry) => {
              const items = queueItems.filter((item) => item.group === entry.group);

              if (items.length === 0) {
                return null;
              }

              return (
                <View key={entry.group} style={styles.queueGroup}>
                  <View style={styles.queueGroupHeader}>
                    <StatusChip label={entry.label} tone={entry.tone} />
                    <Text style={styles.countText}>{items.length}</Text>
                  </View>
                  {items.map((item) => (
                    <InspectionQueueCard
                      key={item.id}
                      item={item}
                      label={entry.label}
                      tone={entry.tone}
                      onOpenItem={onOpenQueueItem}
                    />
                  ))}
                </View>
              );
            })}
          </View>
        )}
      </Card>

      <LegacyVisitsView
        activeVisits={activeScopeVisits}
        completedVisits={completedScopeVisits}
        joiningVisitId={joiningVisitId}
        onOpenVisit={onOpenVisit}
        onCreateCheckIn={onCreateCheckIn}
      />
    </>
  );
}

function ScopeCard({
  scope,
  selected,
  onPress,
}: {
  scope: OperationalScope;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.scopeCard,
        selected && styles.scopeCardSelected,
        pressed && styles.visitRowPressed,
      ]}
    >
      <Text style={[styles.scopeTitle, selected && styles.scopeTitleSelected]}>
        {SCOPE_LABELS[scope]}
      </Text>
    </Pressable>
  );
}

function InspectionQueueCard({
  item,
  label,
  tone,
  onOpenItem,
}: {
  item: InspectionQueueItem;
  label: string;
  tone: 'info' | 'success' | 'danger';
  onOpenItem: (item: InspectionQueueItem) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        onOpenItem(item);
      }}
      style={({ pressed }) => [
        styles.queueCard,
        pressed && styles.visitRowPressed,
      ]}
    >
      <View style={styles.queueCardHeader}>
        <StatusChip label={label} tone={tone} />
        <Feather name="chevron-right" size={18} color={uiTheme.colors.textMuted} />
      </View>
      <Text style={styles.queueTitle} numberOfLines={1}>
        {item.title}
      </Text>
      <Text style={styles.queueSubtitle} numberOfLines={2}>
        {item.subtitle}
      </Text>
    </Pressable>
  );
}

function MaintenanceWorkspacePlaceholder({ onOpenDefects }: { onOpenDefects: () => void }) {
  return (
    <Card>
      <View style={styles.listHeader}>
        <SectionTitle>Maintenance</SectionTitle>
        <StatusChip label="Tasks" tone="warning" />
      </View>
      <BodyText muted>
        Maintenance assignments will appear here. Current defect work remains available.
      </BodyText>
      <AppButton label="Open Defects" variant="secondary" onPress={onOpenDefects} />
    </Card>
  );
}

function LegacyVisitsView({
  activeVisits,
  completedVisits,
  joiningVisitId,
  onOpenVisit,
  onCreateCheckIn,
}: {
  activeVisits: SiteVisit[];
  completedVisits: SiteVisit[];
  joiningVisitId: string | null;
  onOpenVisit: (visit: SiteVisit) => void;
  onCreateCheckIn?: () => void;
}) {
  return (
    <>
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
                  void onOpenVisit(visit);
                }}
              />
            ))}
          </View>
        )}
        {onCreateCheckIn && activeVisits.length === 0 ? (
          <AppButton label="Create Check In" onPress={onCreateCheckIn} />
        ) : null}
      </Card>

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
                  void onOpenVisit(visit);
                }}
              />
            ))}
          </View>
        )}
      </Card>
    </>
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

function getAvailableInspectionScopes(
  activeVisits: SiteVisit[],
  completedVisits: SiteVisit[],
): OperationalScope[] {
  const scopes = new Set<OperationalScope>();

  for (const visit of [...activeVisits, ...completedVisits]) {
    if (visit.operationMode && visit.operationMode !== 'INSPECTION') {
      continue;
    }

    if (isOperationalScope(visit.operationalScope)) {
      scopes.add(visit.operationalScope);
    }

    for (const inspection of visit.inspections ?? []) {
      if (isOperationalScope(inspection.operationalScope)) {
        scopes.add(inspection.operationalScope);
      }
    }
  }

  if (scopes.size === 0) {
    return ['SAVR'];
  }

  return SCOPE_ORDER.filter((scope) => scopes.has(scope));
}

function buildInspectionQueueItems(
  activeVisits: SiteVisit[],
  completedVisits: SiteVisit[],
  selectedScope: OperationalScope,
) {
  const queueItems: InspectionQueueItem[] = [];

  for (const visit of activeVisits) {
    if (!isVisitInScope(visit, selectedScope)) {
      continue;
    }

    queueItems.push(createVisitQueueItem(visit, getVisitQueueGroup(visit, selectedScope), selectedScope));
  }

  for (const visit of completedVisits) {
    if (!isVisitInScope(visit, selectedScope)) {
      continue;
    }

    queueItems.push(createVisitQueueItem(visit, getVisitQueueGroup(visit, selectedScope), selectedScope));
  }

  return queueItems;
}

function getVisitQueueGroup(
  visit: SiteVisit,
  selectedScope: OperationalScope,
): InspectionQueueStatusGroup {
  const inspectionGroups = (visit.inspections ?? [])
    .filter((inspection) => isInspectionInScope(inspection, visit, selectedScope))
    .map((inspection) => getInspectionQueueStatusGroup(inspection.completionStatus))
    .filter(Boolean);

  if (inspectionGroups.includes('NEEDS_ATTENTION')) {
    return 'NEEDS_ATTENTION';
  }

  if (isCompletedVisit(visit)) {
    return 'COMPLETED';
  }

  return 'IN_PROGRESS';
}

function createVisitQueueItem(
  visit: SiteVisit,
  group: InspectionQueueStatusGroup,
  scope: OperationalScope,
): InspectionQueueItem {
  return {
    id: `${group}-visit-${visit.id}`,
    group,
    scope,
    title: visit.pencawangName ?? visit.substation.name,
    subtitle: formatVisitQueueSubtitle(visit),
    visit,
  };
}

function isVisitInScope(visit: SiteVisit, scope: OperationalScope) {
  if (isOperationalScope(visit.operationalScope)) {
    return visit.operationalScope === scope;
  }

  return scope === 'SAVR';
}

function isInspectionInScope(
  inspection: InspectionSummary,
  visit: SiteVisit,
  scope: OperationalScope,
) {
  if (isOperationalScope(inspection.operationalScope)) {
    return inspection.operationalScope === scope;
  }

  return isVisitInScope(visit, scope);
}

function isOperationalScope(value?: string | null): value is OperationalScope {
  return SCOPE_ORDER.includes(value as OperationalScope);
}

function formatVisitQueueSubtitle(visit: SiteVisit) {
  const code = visit.pencawangCode ?? visit.substation.code;
  const location = visit.functionalLocation ?? visit.substation.location;
  const progress = formatVisitProgress(visit);
  const parts = [code, location, progress]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(' - ') : 'Site visit';
}

function formatVisitProgress(visit: SiteVisit) {
  const totalAssets = visit.summary?.totalAssets ?? visit.totalAssets;
  const inspectedAssets = visit.summary?.inspectedAssets ?? visit.inspectedAssets;

  if (
    typeof totalAssets !== 'number' ||
    typeof inspectedAssets !== 'number' ||
    totalAssets <= 0
  ) {
    return null;
  }

  return `${inspectedAssets} / ${totalAssets} assets inspected`;
}

function canShowOperationalSessionsInWorkspace(role: UserRole) {
  return role === 'ADMIN' || role === 'MANAGER' || role === 'SUPERVISOR';
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
  workspaceGrid: {
    gap: 10,
  },
  workspaceCard: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.card,
    padding: 12,
  },
  workspaceCardSelected: {
    borderColor: uiTheme.colors.primary,
    backgroundColor: uiTheme.colors.primarySoft,
  },
  workspaceIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiTheme.colors.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
  },
  workspaceTextWrap: {
    flex: 1,
    gap: 3,
  },
  workspaceTitle: {
    color: uiTheme.colors.textPrimary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  workspaceMeta: {
    color: uiTheme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  scopeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  scopeCard: {
    minHeight: 42,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.card,
    paddingHorizontal: 12,
  },
  scopeCardSelected: {
    borderColor: uiTheme.colors.primary,
    backgroundColor: uiTheme.colors.primarySoft,
  },
  scopeTitle: {
    color: uiTheme.colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  scopeTitleSelected: {
    color: uiTheme.colors.primaryStrong,
  },
  queueGrid: {
    gap: 10,
  },
  queueGroup: {
    gap: 8,
  },
  queueGroupHeader: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  queueCard: {
    minHeight: 104,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.card,
    padding: 12,
    gap: 8,
  },
  queueCardDisabled: {
    opacity: 0.72,
    backgroundColor: uiTheme.colors.surfaceMuted,
  },
  queueCardHeader: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  queueCount: {
    minWidth: 30,
    color: uiTheme.colors.textPrimary,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    textAlign: 'right',
  },
  queueTitle: {
    color: uiTheme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
  },
  queueSubtitle: {
    color: uiTheme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
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
