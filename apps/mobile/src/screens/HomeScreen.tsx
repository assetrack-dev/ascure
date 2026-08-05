import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { api, ApiError, isEndpointUnavailableError } from '../api';
import { cachedFetch, readCache } from '../offlineCache';
import { warmVisitOfflineCache } from '../offlineWarm';
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
  isTempId,
  SyncQueueSnapshot,
} from '../syncQueue';
import {
  BottomCTA,
  Card,
  EmptyState,
  ErrorBanner,
  Mono,
  NetworkPill,
  Screen,
  SkeletonCard,
  StatusSpineTile,
  WarningBanner,
  type SpineTone,
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

// Status group → spine colour: in-progress reads blue (active), a rejected item
// reads red (needs attention), completed reads green (handoff C2).
const QUEUE_SPINE: Record<InspectionQueueStatusGroup, SpineTone> = {
  IN_PROGRESS: 'blue',
  COMPLETED: 'green',
  NEEDS_ATTENTION: 'red',
};

const QUEUE_CHIP_TONE: Record<
  InspectionQueueStatusGroup,
  'info' | 'success' | 'danger'
> = {
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  NEEDS_ATTENTION: 'danger',
};

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
  // Which Mainhead sections the crew has EXPANDED. Default = none: a multi-
  // Mainhead account first sees just the Mainhead headers (owner feedback — the
  // fully-expanded list was too long to scan) and opens the one it needs. Held
  // here (not inside InspectionWorkspaceView) so it survives a refresh — the
  // parent unmounts that child while isLoading, which would otherwise reset
  // the crew's choice.
  const [expandedMainheads, setExpandedMainheads] = useState<Set<string>>(
    () => new Set(),
  );
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
  const scopeCounts = useMemo(
    () => countVisitsByScope(activeVisits, completedVisits, availableScopes),
    [activeVisits, completedVisits, availableScopes],
  );
  const queueItems = useMemo(
    () => buildInspectionQueueItems(activeVisits, completedVisits, selectedScope),
    [activeVisits, completedVisits, selectedScope],
  );

  const loadHomeData = useCallback(async () => {
    try {
      setError(null);

      // CACHE-FIRST PAINT (owner feedback 2026-08-05: "every time I open the
      // app it takes time to load"): when the three Home lists are cached from
      // a previous open, render them IMMEDIATELY and let the network refresh
      // update the screen when it lands. cachedFetch is network-first (it only
      // serves cache when UNREACHABLE), so without this the skeleton held for
      // 3 round-trips + a detail fetch per visit on every single app open.
      const [cachedActive, cachedCompleted, cachedCapabilities] = await Promise.all([
        readCache<SiteVisit[]>('site-visits-active'),
        readCache<SiteVisit[]>('site-visits-completed'),
        readCache<EffectiveCapability[]>('my-capabilities'),
      ]);
      const paintedFromCache = Boolean(
        cachedActive && cachedCompleted && cachedCapabilities,
      );
      if (paintedFromCache) {
        setActiveVisits(cachedActive!.value);
        setCompletedVisits(cachedCompleted!.value);
        setCapabilities(cachedCapabilities!.value);
        setIsLoading(false);
      } else {
        setIsLoading(true);
      }

      // Identity refresh runs concurrently with the list fetches (it used to be
      // serialized after them, adding a full round-trip to the skeleton time).
      // Best-effort — the session user is already cached by AuthContext, so it
      // must not fail the screen offline; a 401 still signs the crew out below.
      const mePromise = api.getMe(token).then(
        (me) => ({ ok: true as const, me }),
        (meError) => ({ ok: false as const, meError }),
      );

      // Offline-first: each read serves its last cached value when the server is
      // unreachable (cachedFetch), so the Home queue still renders offline and an
      // In-Progress visit can be re-opened from the field.
      const [activeResult, completedResult, capabilitiesResult] = await Promise.all([
        cachedFetch('site-visits-active', undefined, () => api.getActiveSiteVisits(token)),
        cachedFetch('site-visits-completed', undefined, () => api.getCompletedSiteVisits(token)),
        cachedFetch('my-capabilities', undefined, () => api.getMyCapabilities(token)),
      ]);
      // Offline warming is for FIELD accounts only. An admin/manager account is
      // tenant-scoped — its "active visits" are EVERY crew's visits, and warming
      // them all (full registers + templates, concurrently) is what crashed the
      // admin phone on v2.0.2 (OOM-kill loop, millions of packets per session).
      // Office roles review online; they don't inspect offline.
      const warmCount =
        user?.role === 'TECHNICIAN' || user?.role === 'SUPERVISOR'
          ? WARM_VISIT_LIMIT
          : 0;
      // Per-visit DETAIL fetches exist to cache visits for offline re-open —
      // a FIELD need. Office roles skip them (a wide account's active list is
      // every crew's visits = dozens of awaited round-trips for nothing).
      const activeVisitsWithImageData =
        warmCount > 0
          ? await loadVisitDetails(token, activeResult.value, warmCount)
          : activeResult.value;

      setActiveVisits(activeVisitsWithImageData);
      setCompletedVisits(completedResult.value);
      setCapabilities(capabilitiesResult.value);

      // Warm the Check-In reference data (best-effort, fire-and-forget) so a crew
      // that opened the app online at the depot can START a new visit offline —
      // the Check-In pickers populate from these caches.
      void Promise.all([
        cachedFetch('teams', undefined, () => api.getTeams(token)),
        cachedFetch('substations', undefined, () => api.getSubstations(token)),
        cachedFetch('mainheads', undefined, () => api.getMainheads(token)),
      ]).catch(() => undefined);

      const meResult = await mePromise;
      if (meResult.ok) {
        setUser(meResult.me);
      } else if (
        meResult.meError instanceof ApiError &&
        meResult.meError.status === 401
      ) {
        throw meResult.meError;
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
  }, [handleUnauthorized, setUser, token, user?.role]);

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

        // A temp (offline-created) visit exists only locally — open it straight
        // (VisitDetail reads it from cache); never call join with its non-UUID id.
        if (isTempId(visit.id) || isCompletedVisit(visit)) {
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

  const toggleMainhead = useCallback((key: string) => {
    setExpandedMainheads((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Persistent offline / sync signal for the identity-row pill (handoff 1b /
  // C4). Counts come straight from the live useSync() snapshot — never faked.
  const queuedCount = getActiveQueueCount(syncQueueSnapshot);
  const networkLabel = isOffline
    ? queuedCount > 0
      ? `Offline · ${queuedCount} queued`
      : 'Offline'
    : isSyncingQueue || queuedCount > 0
      ? `Syncing · ${queuedCount}`
      : 'Synced';

  return (
    <Screen
      title="Workspace"
      leftAction={{
        icon: 'menu',
        onPress: () => navigation.openDrawer(),
        accessibilityLabel: 'Menu',
      }}
      rightAction={{
        icon: 'refresh',
        onPress: loadHomeData,
        accessibilityLabel: 'Refresh',
        disabled: isLoading,
      }}
      bottomBar={
        // Primary Check-In action moves off the header "+" into a thumb-reach
        // docked CTA (handoff 1b / C5). Inspection-scope only.
        canInspect ? (
          <BottomCTA
            label="Start Check-In"
            onPress={() => navigation.navigate('CheckIn')}
          />
        ) : undefined
      }
    >
      {/* Identity row + persistent offline/sync pill (handoff 1b). */}
      <View style={styles.identityRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{getInitials(user.name)}</Text>
        </View>
        <View style={styles.identityText}>
          <Text style={styles.identityName} numberOfLines={1}>
            {user.name}
          </Text>
          <Text style={styles.identityRole} numberOfLines={1}>
            {formatRole(user.role)}
          </Text>
        </View>
        <NetworkPill online={!isOffline} label={networkLabel} />
      </View>

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
          scopeCounts={scopeCounts}
          queueItems={queueItems}
          onSelectScope={setSelectedScope}
          onOpenQueueItem={handleOpenQueueItem}
          expandedMainheads={expandedMainheads}
          onToggleMainhead={toggleMainhead}
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

  // Segmented control (handoff 1b): one track, the active workspace reads as a
  // solid raised segment. Immediate swap, no animation (gloved use).
  return (
    <View style={styles.segmented}>
      {workspaces.map((workspace) => {
        const selected = workspace.id === selectedWorkspaceId;
        const iconName = workspace.id === 'INSPECTION' ? 'clipboard' : 'tool';

        return (
          <Pressable
            key={workspace.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onSelectWorkspace(workspace.id)}
            style={[styles.segment, selected && styles.segmentActive]}
          >
            <Feather
              name={iconName}
              size={15}
              color={selected ? theme.colors.textPrimary : theme.colors.textMuted}
            />
            <Text
              style={[styles.segmentText, selected && styles.segmentTextActive]}
              numberOfLines={1}
            >
              {workspace.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function InspectionWorkspaceView({
  availableScopes,
  selectedScope,
  scopeCounts,
  queueItems,
  onSelectScope,
  onOpenQueueItem,
  expandedMainheads,
  onToggleMainhead,
}: {
  availableScopes: OperationalScope[];
  selectedScope: OperationalScope;
  scopeCounts: Record<string, number>;
  queueItems: InspectionQueueItem[];
  onSelectScope: (scope: OperationalScope) => void;
  onOpenQueueItem: (item: InspectionQueueItem) => void;
  expandedMainheads: Set<string>;
  onToggleMainhead: (key: string) => void;
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
  // When the queue spans several Mainheads, each section header can be tapped to
  // collapse it — keeping a multi-Mainhead home view scannable. Collapse state is
  // owned by the parent (survives refresh); default expanded so no queued work is
  // ever hidden without the crew choosing to hide it.
  const showMainheadHeaders = mainheadGroups.length > 1;

  // One labelled status group ("In Progress" / "Needs attention" / "Completed"),
  // its rows rendered as spine tiles whose spine encodes the status (handoff 1b).
  const renderStatusGroup = (
    entry: MainheadQueueGroup['statusGroups'][number],
  ) => (
    <View key={entry.group} style={styles.statusGroup}>
      <View style={styles.groupHeader}>
        <Text style={styles.groupTitle}>{entry.label}</Text>
        <Mono size={12} muted>
          {entry.items.length}
        </Mono>
      </View>
      {entry.items.map((item) => (
        <StatusSpineTile
          key={item.id}
          code={item.title}
          spine={QUEUE_SPINE[item.group]}
          chip={{ label: entry.label, tone: QUEUE_CHIP_TONE[item.group] }}
          secondary={item.subtitle}
          onPress={() => onOpenQueueItem(item)}
        />
      ))}
    </View>
  );

  return (
    <>
      {/* Count-badged scope chips (handoff 1b): active chip = solid ink fill. */}
      <View style={styles.scopeRow}>
        {availableScopes.map((scope) => (
          <ScopeChip
            key={scope}
            scope={scope}
            count={scopeCounts[scope] ?? 0}
            selected={scope === selectedScope}
            onPress={() => onSelectScope(scope)}
          />
        ))}
      </View>

      {/* Spine-tile queue grouped by status; when the queue spans more than one
          Mainhead, those status groups nest under a per-Mainhead section header. */}
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
        (mainheadGroups[0]?.statusGroups ?? []).map(renderStatusGroup)
      ) : (
        // Multiple Mainheads: a collapsible labelled section per Mainhead, with
        // its status groups nested within.
        mainheadGroups.map((group) => {
          const collapsed = !expandedMainheads.has(group.key);

          return (
            <View key={group.key} style={styles.mainheadSection}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: !collapsed }}
                accessibilityLabel={`${group.label}, ${group.total} in queue`}
                onPress={() => onToggleMainhead(group.key)}
                style={({ pressed }) => [
                  styles.mainheadHeader,
                  pressed && styles.mainheadHeaderPressed,
                ]}
              >
                <Feather name="map-pin" size={13} color={theme.colors.primary} />
                <Text style={styles.mainheadTitle} numberOfLines={1}>
                  {group.label}
                </Text>
                <Mono size={12} muted>
                  {group.total}
                </Mono>
                <Feather
                  name={collapsed ? 'chevron-down' : 'chevron-up'}
                  size={18}
                  color={theme.colors.textMuted}
                />
              </Pressable>
              {collapsed ? null : group.statusGroups.map(renderStatusGroup)}
            </View>
          );
        })
      )}
    </>
  );
}

function ScopeChip({
  scope,
  count,
  selected,
  onPress,
}: {
  scope: OperationalScope;
  count: number;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.scopeChip, selected && styles.scopeChipActive]}
    >
      <Text
        style={[styles.scopeChipLabel, selected && styles.scopeChipLabelActive]}
      >
        {SCOPE_LABELS[scope]}
      </Text>
      <Text
        style={[styles.scopeChipCount, selected && styles.scopeChipCountActive]}
      >
        {count}
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
  spine: SpineTone;
}> = [
  { key: 'EMERGENCY', label: 'Emergency', spine: 'red' },
  { key: 'READY', label: 'Ready to Claim', spine: 'amber' },
  { key: 'ACTIVE', label: 'In Progress', spine: 'blue' },
  { key: 'AWAITING_CLOSURE', label: 'Awaiting Closure', spine: 'green' },
  { key: 'DONE', label: 'Recently Closed', spine: 'neutral' },
];

const SEVERITY_RANK: Record<DefectSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

const DONE_GROUP_LIMIT = 10;
// Hard cap on CARDS RENDERED per maintenance group. The workspace lives in a
// plain ScrollView (no virtualization) — mounting a tenant-scoped account's
// full defect list as native views is what OOM-crashed the admin phone
// (confirmed by logcat: OutOfMemoryError in ReactTextViewManager.createViewInstance).
const GROUP_RENDER_LIMIT = 30;

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

          const visible = items.slice(0, GROUP_RENDER_LIMIT);
          const hiddenCount = items.length - visible.length;

          return (
            <View key={group.key} style={styles.statusGroup}>
              <View style={styles.groupHeader}>
                {group.key === 'EMERGENCY' ? (
                  <Feather name="alert-triangle" size={14} color={theme.colors.danger} />
                ) : null}
                <Text
                  style={[
                    styles.groupTitle,
                    group.key === 'EMERGENCY' && styles.groupTitleDanger,
                  ]}
                >
                  {group.label}
                </Text>
                <Mono size={12} muted>
                  {items.length}
                </Mono>
              </View>
              {visible.map((item) => (
                <MaintenanceTaskCard
                  key={item.id}
                  item={item}
                  spine={group.spine}
                  claimable={isClaimableDefect(item)}
                  claiming={claimingId === item.id}
                  onOpen={() => onOpenDefect(item.id)}
                  onClaim={() => handleClaim(item.id)}
                />
              ))}
              {hiddenCount > 0 ? (
                <Text style={styles.groupOverflowNote}>
                  + {hiddenCount} more not shown — use the Defects screen or the
                  admin console to browse the full list.
                </Text>
              ) : null}
            </View>
          );
        })
      )}
    </>
  );
}

function MaintenanceTaskCard({
  item,
  spine,
  claimable,
  claiming,
  onOpen,
  onClaim,
}: {
  item: DefectListItem;
  spine: SpineTone;
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

  // Emergency severity should still lead with red regardless of the group spine.
  const rowSpine: SpineTone =
    item.severity === 'CRITICAL' || item.severity === 'HIGH' ? 'red' : spine;

  return (
    <View style={styles.maintenanceItem}>
      <StatusSpineTile
        code={item.assetCode || 'Unknown asset'}
        spine={rowSpine}
        chip={{ label: item.severity ?? 'MEDIUM', tone: severityTone(item.severity) }}
        secondary={item.label}
        meta={[
          metaParts.length > 0 ? metaParts.join(' · ') : null,
          item.isOverdue ? 'OVERDUE' : null,
        ]}
        onPress={onOpen}
      />
      {claimable ? (
        <Pressable
          accessibilityRole="button"
          disabled={claiming}
          onPress={onClaim}
          style={({ pressed }) => [
            styles.claimButton,
            claiming && styles.claimButtonDisabled,
            pressed && !claiming && styles.claimButtonPressed,
          ]}
        >
          <Text style={styles.claimButtonText}>
            {claiming ? 'Claiming…' : 'Claim & Start'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function severityTone(
  severity?: DefectSeverity | null,
): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (severity === 'CRITICAL') {
    return 'danger';
  }
  if (severity === 'HIGH') {
    return 'warning';
  }
  if (severity === 'LOW') {
    return 'neutral';
  }
  return 'info';
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

function getInitials(name?: string | null) {
  const trimmed = (name ?? '').trim();

  if (!trimmed) {
    return '—';
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';

  return (first + last).toUpperCase() || '—';
}

function formatRole(role?: string | null) {
  const trimmed = (role ?? '').trim();

  if (!trimmed) {
    return 'Field crew';
  }

  return trimmed
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// How many visits a FIELD account warms per Home load. A crew realistically
// works one or two visits; three covers a handover day without ever fanning
// out to a whole tenant's worth of registers.
const WARM_VISIT_LIMIT = 3;

async function loadVisitDetails(token: string, visits: SiteVisit[], warmCount: number) {
  const detailed = await Promise.all(
    visits.map(async (visit) => {
      // A temp (offline-created) visit is already fully in cache (synthesized by
      // Check-In, poles prepended by Add Asset) — never send its non-UUID id to
      // the server (getSiteVisit / warm would 400 the moment signal returns).
      if (isTempId(visit.id)) {
        return visit;
      }

      try {
        // Cache each detailed visit so VisitDetail can be re-opened offline; on
        // an unreachable server cachedFetch serves the cached copy, and if even
        // that is missing we fall back to the list-level visit.
        const { value } = await cachedFetch('site-visit', visit.id, () =>
          api.getSiteVisit(token, visit.id),
        );
        return value;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          throw error;
        }
        return visit;
      }
    }),
  );

  // Warm asset registers + per-type inspection templates while online, so an
  // In-Progress visit can be opened AND inspected offline after just loading
  // Home online. Fire-and-forget (the warm is by far the heaviest part of the
  // Home load — it must not hold the skeleton) but STRICTLY SEQUENTIAL and
  // capped: warming every visit concurrently is a memory spike that Android
  // answers by killing the app when the visit list is large.
  const toWarm = detailed.filter((visit) => !isTempId(visit.id)).slice(0, warmCount);
  if (toWarm.length > 0) {
    void (async () => {
      for (const visit of toWarm) {
        await warmVisitOfflineCache(token, visit);
      }
    })().catch(() => undefined);
  }

  return detailed;
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

function countVisitsByScope(
  activeVisits: SiteVisit[],
  completedVisits: SiteVisit[],
  scopes: OperationalScope[],
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const scope of scopes) {
    counts[scope] = [...activeVisits, ...completedVisits].filter((visit) =>
      isVisitInScope(visit, scope),
    ).length;
  }

  return counts;
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
      style={({ pressed }) => [styles.syncSummaryCard, pressed && styles.pressed]}
    >
      <View style={styles.syncSummaryIcon}>
        <Feather
          name={failedCount > 0 ? 'alert-triangle' : 'upload-cloud'}
          size={18}
          color={failedCount > 0 ? theme.colors.danger : theme.colors.warningText}
        />
      </View>
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
    // --- Identity row + persistent offline pill (handoff 1b) -----------------
    identityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: t.radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.colors.solidFill,
    },
    avatarText: {
      color: t.colors.onSolidFill,
      fontSize: 15,
      fontFamily: t.fonts.monoMedium,
      letterSpacing: 0.5,
    },
    identityText: {
      flex: 1,
      gap: 2,
    },
    identityName: {
      color: t.colors.textPrimary,
      fontSize: 16,
      fontFamily: t.fonts.display,
    },
    identityRole: {
      color: t.colors.textMuted,
      fontSize: 12,
      fontFamily: t.fonts.bodySemibold,
    },

    // --- Segmented workspace control (handoff 1b) ----------------------------
    segmented: {
      flexDirection: 'row',
      gap: 4,
      padding: 4,
      borderRadius: t.radius.control,
      backgroundColor: t.colors.surfaceMuted,
    },
    segment: {
      flex: 1,
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: t.radius.chip + 2,
    },
    segmentActive: {
      backgroundColor: t.colors.card,
      ...t.shadow.card,
    },
    segmentText: {
      color: t.colors.textMuted,
      fontSize: 14,
      fontFamily: t.fonts.bodySemibold,
    },
    segmentTextActive: {
      color: t.colors.textPrimary,
      fontFamily: t.fonts.display,
    },

    // --- Count-badged scope chips (handoff 1b) -------------------------------
    scopeRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    scopeChip: {
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
      paddingLeft: 14,
      paddingRight: 8,
    },
    scopeChipActive: {
      backgroundColor: t.colors.solidFill,
      borderColor: t.colors.solidFill,
    },
    scopeChipLabel: {
      color: t.colors.textSecondary,
      fontSize: 13,
      fontFamily: t.fonts.monoMedium,
      letterSpacing: 0.3,
    },
    scopeChipLabelActive: {
      color: t.colors.onSolidFill,
    },
    scopeChipCount: {
      minWidth: 22,
      textAlign: 'center',
      overflow: 'hidden',
      borderRadius: t.radius.pill,
      paddingHorizontal: 7,
      paddingVertical: 2,
      backgroundColor: t.colors.surfaceMuted,
      color: t.colors.textSecondary,
      fontSize: 12,
      fontFamily: t.fonts.monoMedium,
    },
    scopeChipCountActive: {
      backgroundColor: 'rgba(255,255,255,0.16)',
      color: t.colors.onSolidFill,
    },

    // --- Status groups + tiles ----------------------------------------------
    statusGroup: {
      gap: 10,
    },
    groupHeader: {
      minHeight: 24,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 2,
    },
    groupTitle: {
      flex: 1,
      color: t.colors.textSecondary,
      fontSize: 11,
      fontFamily: t.fonts.monoMedium,
      letterSpacing: 1.4,
      textTransform: 'uppercase',
    },
    groupTitleDanger: {
      color: t.colors.danger,
    },
    groupOverflowNote: {
      fontSize: 12,
      color: t.colors.textMuted,
      paddingHorizontal: 4,
      paddingTop: 2,
    },
    mainheadSection: {
      gap: 12,
    },
    mainheadHeader: {
      minHeight: 36,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 4,
      paddingVertical: 4,
      borderRadius: t.radius.chip,
    },
    mainheadHeaderPressed: {
      backgroundColor: t.colors.surfacePressed,
    },
    mainheadTitle: {
      flex: 1,
      color: t.colors.textSecondary,
      fontSize: 12.5,
      lineHeight: 16,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      fontFamily: t.fonts.display,
    },

    // --- Maintenance task (spine tile + claim button) ------------------------
    maintenanceItem: {
      gap: 8,
    },
    claimButton: {
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: t.radius.control,
      backgroundColor: t.colors.primary,
      paddingHorizontal: 16,
    },
    claimButtonDisabled: {
      opacity: 0.6,
    },
    claimButtonPressed: {
      backgroundColor: t.colors.primaryStrong,
    },
    claimButtonText: {
      color: t.colors.textOnPrimary,
      fontSize: 15,
      fontFamily: t.fonts.display,
    },

    // --- Pending-sync summary card ------------------------------------------
    syncSummaryCard: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderRadius: t.radius.card,
      borderWidth: 1,
      borderColor: t.colors.warningBorder,
      backgroundColor: t.colors.warningSoft,
      padding: t.spacing.card,
    },
    syncSummaryIcon: {
      width: 40,
      height: 40,
      borderRadius: t.radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.colors.card,
    },
    syncSummaryTextWrap: {
      flex: 1,
      gap: 4,
    },
    syncSummaryTitle: {
      color: t.colors.textPrimary,
      fontSize: 15,
      lineHeight: 20,
      fontFamily: t.fonts.display,
    },
    syncSummaryMeta: {
      color: t.colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontFamily: t.fonts.bodySemibold,
    },

    pressed: {
      backgroundColor: t.colors.surfacePressed,
      transform: [{ scale: 0.995 }],
    },
  });
