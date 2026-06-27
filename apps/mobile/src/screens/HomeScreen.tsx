import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { api, ApiError, isEndpointUnavailableError } from '../api';
import { cachedFetch } from '../offlineCache';
import { useSession } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import type { AppDrawerScreenProps } from '../navigation/types';
import {
  getAutoOpenWorkspace,
  getAvailableMobileWorkspaces,
  getInspectionQueueStatusGroup,
  hasInspectionAuthority,
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
  Card,
  EmptyState,
  ErrorBanner,
  Screen,
  SectionTitle,
  SkeletonCard,
  StatusChip,
  WarningBanner,
} from '../ui';
import { Theme, useTheme } from '../theme';
import {
  Asset,
  DefectListItem,
  DefectSeverity,
  EffectiveCapability,
  InspectionSummary,
  OperationalScope,
  SiteVisit,
} from '../types';

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
  { group: 'NEEDS_ATTENTION', label: 'Rejected', tone: 'danger' },
];

type MainheadQueueGroup = {
  key: string;
  label: string;
  total: number;
  statusGroups: Array<
    (typeof QUEUE_GROUPS)[number] & { items: InspectionQueueItem[] }
  >;
};

const UNSPECIFIED_MAINHEAD_KEY = '__UNSPECIFIED__';
const UNSPECIFIED_MAINHEAD_LABEL = 'Other / Unspecified';

export function HomeScreen() {
  const navigation = useNavigation<AppDrawerScreenProps<'Home'>['navigation']>();
  const { token, user, setUser, handleUnauthorized } = useSession();
  const { snapshot: syncQueueSnapshot, isSyncing: isSyncingQueue, isOffline } = useSync();
  const [activeVisits, setActiveVisits] = useState<SiteVisit[]>([]);
  const [completedVisits, setCompletedVisits] = useState<SiteVisit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] =
    useState<MobileWorkspaceId | null>(null);
  const [selectedScope, setSelectedScope] = useState<OperationalScope>('SAVR');
  const [capabilities, setCapabilities] = useState<EffectiveCapability[]>([]);
  const workspaces = useMemo(
    () => getAvailableMobileWorkspaces(user, capabilities),
    [user, capabilities],
  );
  // Check-In (starting a site visit) is an inspection-scope action — hide the
  // header "+" from maintenance-only accounts.
  const canInspect = useMemo(
    () => hasInspectionAuthority(user, capabilities),
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

  const loadHomeData = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      // Offline-first: each read serves its last cached value when the server is
      // unreachable (cachedFetch), so the Home queue still renders offline and an
      // In-Progress visit can be re-opened from the field.
      const [activeResult, completedResult, capabilitiesResult] = await Promise.all([
        cachedFetch('site-visits-active', undefined, () => api.getActiveSiteVisits(token)),
        cachedFetch('site-visits-completed', undefined, () => api.getCompletedSiteVisits(token)),
        cachedFetch('my-capabilities', undefined, () => api.getMyCapabilities(token)),
      ]);
      const activeVisitsWithImageData = await loadVisitDetails(token, activeResult.value);

      setActiveVisits(activeVisitsWithImageData);
      setCompletedVisits(completedResult.value);
      setCapabilities(capabilitiesResult.value);

      // Identity refresh is best-effort — the session user is already cached by
      // AuthContext, so this must not fail the screen offline; a 401 still
      // bubbles to sign the crew out.
      try {
        const me = await api.getMe(token);
        setUser(me);
      } catch (meError) {
        if (meError instanceof ApiError && meError.status === 401) {
          throw meError;
        }
      }
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

        // Join is a best-effort membership refresh — the visit is already in the
        // user's queue, so they can SEE it. Open it (read-only) rather than
        // blocking when join is unavailable (endpoint missing / offline, status 0)
        // OR not permitted for this viewer — e.g. a Main Contractor manager
        // overseeing a subcontractor's visit they aren't a member of (403/404).
        if (
          isEndpointUnavailableError(joinError) ||
          (joinError instanceof ApiError &&
            (joinError.status === 0 ||
              joinError.status === 403 ||
              joinError.status === 404))
        ) {
          navigation.navigate('VisitDetail', {
            visitId: visit.id,
            substationId: visit.substationId,
          });
          return;
        }

        setError(joinError instanceof Error ? joinError.message : 'Unable to join this site visit.');
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
        ...(canInspect
          ? [
              {
                icon: 'add' as const,
                onPress: () => navigation.navigate('CheckIn'),
                accessibilityLabel: 'Create Check In',
              },
            ]
          : []),
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
          availableScopes={availableScopes}
          selectedScope={selectedScope}
          queueItems={queueItems}
          onSelectScope={setSelectedScope}
          onOpenQueueItem={handleOpenQueueItem}
        />
      ) : null}

      {!isLoading && selectedWorkspaceId === 'MAINTENANCE' ? (
        <MaintenanceWorkspaceView
          userId={user.id}
          onOpenDefect={(defectId) =>
            navigation.navigate('DefectDetail', { defectId })
          }
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
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

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
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
        <Feather name={iconName} size={17} color={theme.colors.primary} />
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
  availableScopes,
  selectedScope,
  queueItems,
  onSelectScope,
  onOpenQueueItem,
}: {
  availableScopes: OperationalScope[];
  selectedScope: OperationalScope;
  queueItems: InspectionQueueItem[];
  onSelectScope: (scope: OperationalScope) => void;
  onOpenQueueItem: (item: InspectionQueueItem) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Group the queue by Mainhead (outer) then status (inner). A Main Contractor
  // running teams + subcontractors across several MAINHEADs gets one labelled
  // section per Mainhead; a crew working a single Mainhead keeps the flat
  // status-only layout (no redundant header).
  const mainheadGroups = useMemo(
    () => buildMainheadQueueGroups(queueItems),
    [queueItems],
  );
  const showMainheadHeaders = mainheadGroups.length > 1;

  const renderStatusCard = (
    entry: MainheadQueueGroup['statusGroups'][number],
  ) => (
    <Card key={entry.group}>
      <View style={styles.listHeader}>
        <StatusChip label={entry.label} tone={entry.tone} />
        <Text style={styles.countText}>{entry.items.length}</Text>
      </View>
      <View style={styles.queueGrid}>
        {entry.items.map((item) => (
          <InspectionQueueCard
            key={item.id}
            item={item}
            onOpenItem={onOpenQueueItem}
          />
        ))}
      </View>
    </Card>
  );

  return (
    <>
      {/* Scope selector — a compact pill row at the top instead of a full card. */}
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

      {/* One card per status group (no "Inspection Queue" wrapper, no per-item
          status pill — the card header carries the single status chip). When the
          queue spans more than one Mainhead, those status cards are nested under a
          per-Mainhead section header. */}
      {queueItems.length === 0 ? (
        <Card>
          <EmptyState
            icon="clipboard"
            title="No inspection queue"
            description="Create or join a site visit to begin SAVR inspection work."
          />
        </Card>
      ) : !showMainheadHeaders ? (
        // Single Mainhead (or none): keep the original flat per-status layout.
        (mainheadGroups[0]?.statusGroups ?? []).map(renderStatusCard)
      ) : (
        // Multiple Mainheads: a labelled section per Mainhead, status cards within.
        mainheadGroups.map((group) => (
          <View key={group.key} style={styles.mainheadSection}>
            <View style={styles.mainheadHeader}>
              <Feather name="map-pin" size={13} color={theme.colors.primary} />
              <Text style={styles.mainheadTitle} numberOfLines={1}>
                {group.label}
              </Text>
              <Text style={styles.mainheadCount}>{group.total}</Text>
            </View>
            {group.statusGroups.map(renderStatusCard)}
          </View>
        ))
      )}
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
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

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
  onOpenItem,
}: {
  item: InspectionQueueItem;
  onOpenItem: (item: InspectionQueueItem) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

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
        <Text style={[styles.queueTitle, { flex: 1 }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Feather name="chevron-right" size={18} color={theme.colors.textMuted} />
      </View>
      <Text style={styles.queueSubtitle} numberOfLines={2}>
        {item.subtitle}
      </Text>
    </Pressable>
  );
}

type MaintenanceGroupKey =
  | 'EMERGENCY'
  | 'READY'
  | 'ACTIVE'
  | 'AWAITING_CLOSURE'
  | 'DONE';

type MaintenanceGroups = Record<MaintenanceGroupKey, DefectListItem[]>;

const MAINTENANCE_GROUPS: Array<{
  key: MaintenanceGroupKey;
  label: string;
  tone: 'info' | 'success' | 'warning' | 'neutral' | 'danger';
}> = [
  { key: 'EMERGENCY', label: '🚨 Emergency', tone: 'danger' },
  { key: 'READY', label: 'Ready to Claim', tone: 'warning' },
  { key: 'ACTIVE', label: 'In Progress', tone: 'info' },
  { key: 'AWAITING_CLOSURE', label: 'Awaiting Closure', tone: 'success' },
  { key: 'DONE', label: 'Recently Closed', tone: 'neutral' },
];

const SEVERITY_RANK: Record<DefectSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

const DONE_GROUP_LIMIT = 10;

function MaintenanceWorkspaceView({
  userId,
  onOpenDefect,
}: {
  userId: string;
  onOpenDefect: (defectId: string) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { token, handleUnauthorized } = useSession();
  const [defects, setDefects] = useState<DefectListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const loadDefects = useCallback(
    async (showLoading: boolean) => {
      try {
        if (showLoading) {
          setIsLoading(true);
        }
        setError(null);

        const response = await api.getDefects(token);
        setDefects(response);
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          await handleUnauthorized(loadError);
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load maintenance tasks.',
        );
      } finally {
        setIsLoading(false);
      }
    },
    [handleUnauthorized, token],
  );

  // Reload when the workspace regains focus (e.g. returning from a defect the
  // maintainer just completed) — but only show the skeleton on first entry.
  useFocusEffect(
    useCallback(() => {
      void loadDefects(!hasLoadedRef.current);
      hasLoadedRef.current = true;
    }, [loadDefects]),
  );

  const grouped = useMemo(
    () => groupMaintenanceDefects(defects, userId),
    [defects, userId],
  );

  const handleClaim = useCallback(
    async (defectId: string) => {
      try {
        setClaimingId(defectId);
        setError(null);

        await api.claimDefect(token, defectId);
        onOpenDefect(defectId);
        await loadDefects(false);
      } catch (claimError) {
        if (claimError instanceof ApiError && claimError.status === 401) {
          await handleUnauthorized(claimError);
          return;
        }

        setError(
          claimError instanceof Error
            ? claimError.message
            : 'Unable to claim this defect.',
        );
      } finally {
        setClaimingId(null);
      }
    },
    [handleUnauthorized, loadDefects, onOpenDefect, token],
  );

  if (isLoading) {
    return (
      <>
        <SkeletonCard />
        <SkeletonCard />
      </>
    );
  }

  const hasAnyTask = MAINTENANCE_GROUPS.some(
    (group) => grouped[group.key].length > 0,
  );

  return (
    <>
      <ErrorBanner message={error} />
      {!hasAnyTask ? (
        <Card>
          <EmptyState
            icon="tool"
            title="No maintenance tasks"
            description="Verified defects in your scope will appear here to claim and repair."
          />
        </Card>
      ) : (
        MAINTENANCE_GROUPS.map((group) => {
          const items = grouped[group.key];

          if (items.length === 0) {
            return null;
          }

          return (
            <Card key={group.key}>
              <View style={styles.listHeader}>
                <StatusChip label={group.label} tone={group.tone} />
                <Text style={styles.countText}>{items.length}</Text>
              </View>
              <View style={styles.queueGrid}>
                {items.map((item) => (
                  <MaintenanceTaskCard
                    key={item.id}
                    item={item}
                    claimable={isClaimableDefect(item)}
                    claiming={claimingId === item.id}
                    onOpen={() => onOpenDefect(item.id)}
                    onClaim={() => handleClaim(item.id)}
                  />
                ))}
              </View>
            </Card>
          );
        })
      )}
    </>
  );
}

function MaintenanceTaskCard({
  item,
  claimable,
  claiming,
  onOpen,
  onClaim,
}: {
  item: DefectListItem;
  claimable: boolean;
  claiming: boolean;
  onOpen: () => void;
  onClaim: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const metaParts = [item.assetType, item.location]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  return (
    <View style={styles.maintenanceCard}>
      <Pressable
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [
          styles.maintenanceCardBody,
          pressed && styles.visitRowPressed,
        ]}
      >
        <View style={styles.queueCardHeader}>
          <Text
            style={[styles.queueTitle, { flex: 1, fontFamily: theme.fonts.monoMedium }]}
            numberOfLines={1}
          >
            {item.assetCode || 'Unknown asset'}
          </Text>
          <SeverityChip severity={item.severity} />
        </View>
        <Text style={styles.queueSubtitle} numberOfLines={2}>
          {item.label}
        </Text>
        {metaParts.length > 0 ? (
          <Text style={styles.maintenanceMeta} numberOfLines={1}>
            {metaParts.join(' · ')}
          </Text>
        ) : null}
        {item.isOverdue ? <Text style={styles.overdueText}>Overdue</Text> : null}
      </Pressable>
      {claimable ? (
        <AppButton
          label={claiming ? 'Claiming…' : 'Claim & Start'}
          variant="primary"
          loading={claiming}
          onPress={onClaim}
        />
      ) : null}
    </View>
  );
}

function SeverityChip({ severity }: { severity?: DefectSeverity | null }) {
  const tone =
    severity === 'CRITICAL'
      ? 'danger'
      : severity === 'HIGH'
        ? 'warning'
        : severity === 'LOW'
          ? 'neutral'
          : 'info';

  return <StatusChip label={severity ?? 'MEDIUM'} tone={tone} />;
}

function groupMaintenanceDefects(
  defects: DefectListItem[],
  userId: string,
): MaintenanceGroups {
  const groups: MaintenanceGroups = {
    EMERGENCY: [],
    READY: [],
    ACTIVE: [],
    AWAITING_CLOSURE: [],
    DONE: [],
  };

  for (const defect of defects) {
    const group = getMaintenanceGroup(defect, userId);

    if (group) {
      groups[group].push(defect);
    }
  }

  groups.EMERGENCY.sort(compareMaintenanceTasks);
  groups.READY.sort(compareMaintenanceTasks);
  groups.ACTIVE.sort(compareMaintenanceTasks);
  groups.AWAITING_CLOSURE.sort(compareMaintenanceTasks);
  groups.DONE.sort(compareDoneTasks).splice(DONE_GROUP_LIMIT);

  return groups;
}

// A defect can be claimed when it's verified and nobody owns it yet.
function isClaimableDefect(item: DefectListItem) {
  const lifecycle = (item.lifecycleStatus ?? '').toUpperCase();
  const hasAssignee = Boolean(
    item.assignedToUserId ||
      item.assignedUserId ||
      item.assignedToTeamId ||
      item.assignedTeamId,
  );

  return lifecycle === 'VERIFIED' && !hasAssignee && item.status !== 'CLOSED';
}

function getMaintenanceGroup(
  item: DefectListItem,
  userId: string,
): MaintenanceGroupKey | null {
  const lifecycle = (item.lifecycleStatus ?? '').toUpperCase();
  const assignedToMe =
    item.assignedToUserId === userId || item.assignedUserId === userId;
  const hasAssignee = Boolean(
    item.assignedToUserId ||
      item.assignedUserId ||
      item.assignedToTeamId ||
      item.assignedTeamId,
  );

  // Active emergencies float to the top for ALL in-scope maintainers (broad
  // awareness matters more than personal ownership here), regardless of who
  // claimed them — until they're closed.
  if (item.isEmergency && item.status !== 'CLOSED' && lifecycle !== 'CLOSED') {
    return 'EMERGENCY';
  }

  // Closure authority is the assigned maintainer, so the personal groups
  // (active / awaiting-closure / done) are scoped to my own work. "Ready to
  // claim" stays the shared pool of unassigned, verified defects.
  if (item.status === 'CLOSED' || lifecycle === 'CLOSED') {
    return assignedToMe ? 'DONE' : null;
  }

  if (lifecycle === 'COMPLETED' || lifecycle === 'VERIFICATION_PENDING') {
    return assignedToMe ? 'AWAITING_CLOSURE' : null;
  }

  if (
    assignedToMe &&
    (lifecycle === 'ASSIGNED' ||
      lifecycle === 'IN_PROGRESS' ||
      item.status === 'IN_PROGRESS')
  ) {
    return 'ACTIVE';
  }

  if (lifecycle === 'VERIFIED' && !hasAssignee) {
    return 'READY';
  }

  // Assigned to someone else, rejected, or a QA exception — not actionable here.
  return null;
}

function compareMaintenanceTasks(a: DefectListItem, b: DefectListItem) {
  const severityDelta = getSeverityRank(a.severity) - getSeverityRank(b.severity);

  if (severityDelta !== 0) {
    return severityDelta;
  }

  if (Boolean(a.isOverdue) !== Boolean(b.isOverdue)) {
    return a.isOverdue ? -1 : 1;
  }

  // Oldest first — the longest-waiting defect rises to the top.
  return toTimestamp(a.createdAt) - toTimestamp(b.createdAt);
}

function compareDoneTasks(a: DefectListItem, b: DefectListItem) {
  // Most recently closed first.
  return (
    toTimestamp(b.closedAt ?? b.createdAt) - toTimestamp(a.closedAt ?? a.createdAt)
  );
}

function getSeverityRank(severity?: DefectSeverity | null) {
  return severity ? SEVERITY_RANK[severity] : SEVERITY_RANK.MEDIUM;
}

function toTimestamp(value?: string | null) {
  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();

  return Number.isNaN(time) ? 0 : time;
}

async function loadVisitDetails(token: string, visits: SiteVisit[]) {
  return Promise.all(
    visits.map(async (visit) => {
      let detailed: SiteVisit = visit;

      try {
        // Cache each detailed visit so VisitDetail can be re-opened offline; on
        // an unreachable server cachedFetch serves the cached copy, and if even
        // that is missing we fall back to the list-level visit.
        const { value } = await cachedFetch('site-visit', visit.id, () =>
          api.getSiteVisit(token, visit.id),
        );
        detailed = value;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          throw error;
        }
      }

      // Warm the visit's asset register + per-type inspection templates while
      // online, so an In-Progress visit can be opened AND inspected offline
      // after just loading Home online (not only after opening it online).
      await warmVisitOfflineCache(token, detailed);

      return detailed;
    }),
  );
}

async function warmVisitOfflineCache(token: string, visit: SiteVisit) {
  try {
    const assets = await cachedFetch('site-visit-assets', visit.id, () =>
      api.getSiteVisitAssets(token, visit.id),
    )
      .then((result) => result.value)
      .catch(() => [] as Asset[]);

    if (visit.substationId) {
      await cachedFetch('assets', visit.substationId, () =>
        api.getAssets(token, visit.substationId as string),
      ).catch(() => undefined);
    }

    // One inspection template per distinct asset type — keyed exactly like
    // AssetDetailScreen.handleStartInspection (`visitId:session:assetTypeId`,
    // session 'none' for SAVR) so offline Start Inspection resolves from cache.
    const seenTypes = new Set<string>();
    await Promise.all(
      assets.map((asset) => {
        if (!asset.assetTypeId || seenTypes.has(asset.assetTypeId)) {
          return Promise.resolve(undefined);
        }

        seenTypes.add(asset.assetTypeId);

        return cachedFetch('inspection-template', `${visit.id}:none:${asset.assetTypeId}`, () =>
          api.resolveInspectionTemplate(token, {
            assetId: asset.id,
            assetTypeId: asset.assetTypeId,
            assetType: asset.assetType?.name,
            siteVisitId: visit.id,
          }),
        ).catch(() => undefined);
      }),
    );
  } catch {
    // Best-effort warm — never block or fail Home's load.
  }
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

function buildMainheadQueueGroups(
  queueItems: InspectionQueueItem[],
): MainheadQueueGroup[] {
  const byKey = new Map<
    string,
    { label: string; items: InspectionQueueItem[] }
  >();

  for (const item of queueItems) {
    const trimmed = item.visit.mainhead?.trim();
    const key = trimmed ? trimmed.toUpperCase() : UNSPECIFIED_MAINHEAD_KEY;
    const label = trimmed ? trimmed : UNSPECIFIED_MAINHEAD_LABEL;
    const existing = byKey.get(key);

    if (existing) {
      existing.items.push(item);
    } else {
      byKey.set(key, { label, items: [item] });
    }
  }

  const groups: MainheadQueueGroup[] = [];

  for (const [key, { label, items }] of byKey) {
    const statusGroups = QUEUE_GROUPS.map((entry) => ({
      ...entry,
      items: items.filter((item) => item.group === entry.group),
    })).filter((entry) => entry.items.length > 0);

    groups.push({ key, label, total: items.length, statusGroups });
  }

  // Real MAINHEADs alphabetically; the catch-all "Unspecified" bucket always last.
  groups.sort((a, b) => {
    if (a.key === UNSPECIFIED_MAINHEAD_KEY) {
      return 1;
    }
    if (b.key === UNSPECIFIED_MAINHEAD_KEY) {
      return -1;
    }
    return a.label.localeCompare(b.label);
  });

  return groups;
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
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
      <Feather name="chevron-right" size={20} color={theme.colors.textMuted} />
    </Pressable>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
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
      borderColor: t.colors.warningBorder,
      backgroundColor: t.colors.warningSoft,
      padding: 14,
    },
    syncSummaryTextWrap: {
      flex: 1,
      gap: 4,
    },
    syncSummaryTitle: {
      color: t.colors.textPrimary,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '700',
    },
    syncSummaryMeta: {
      color: t.colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
    },
    countText: {
      minWidth: 36,
      borderRadius: 18,
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
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
      padding: 12,
    },
    workspaceCardSelected: {
      borderColor: t.colors.primary,
      backgroundColor: t.colors.primarySoft,
    },
    workspaceIcon: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.colors.card,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    workspaceTextWrap: {
      flex: 1,
      gap: 3,
    },
    workspaceTitle: {
      color: t.colors.textPrimary,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '700',
    },
    workspaceMeta: {
      color: t.colors.textSecondary,
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
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
      paddingHorizontal: 12,
    },
    scopeCardSelected: {
      borderColor: t.colors.primary,
      backgroundColor: t.colors.primarySoft,
    },
    scopeTitle: {
      color: t.colors.textPrimary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
      textAlign: 'center',
    },
    scopeTitleSelected: {
      color: t.colors.primaryStrong,
    },
    queueGrid: {
      gap: 10,
    },
    mainheadSection: {
      gap: 10,
    },
    mainheadHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 4,
      paddingTop: 2,
    },
    mainheadTitle: {
      flex: 1,
      color: t.colors.textSecondary,
      fontSize: 12.5,
      lineHeight: 16,
      fontWeight: '800',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      fontFamily: t.fonts.display,
    },
    mainheadCount: {
      color: t.colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
      fontFamily: t.fonts.bodySemibold,
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
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
      padding: 12,
      gap: 8,
    },
    maintenanceCard: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
      padding: 12,
      gap: 10,
    },
    maintenanceCardBody: {
      gap: 6,
      borderRadius: 6,
    },
    maintenanceMeta: {
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '600',
      fontFamily: t.fonts.bodySemibold,
    },
    overdueText: {
      color: t.colors.danger,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '800',
      textTransform: 'uppercase',
    },
    queueCardHeader: {
      minHeight: 30,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    queueTitle: {
      color: t.colors.textPrimary,
      fontSize: 14,
      lineHeight: 19,
      fontWeight: '700',
      fontFamily: t.fonts.display,
    },
    queueSubtitle: {
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '500',
      fontFamily: t.fonts.body,
    },
    visitRowPressed: {
      backgroundColor: t.colors.surfacePressed,
      transform: [{ scale: 0.995 }],
    },
  });
