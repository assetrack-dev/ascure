import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { api, ApiError } from '../api';
import { useSession } from '../context/AuthContext';
import { cachedFetch } from '../offlineCache';
import { AssignLaneSheet } from '../components/AssignLaneSheet';
import { PencawangProgressMap } from '../components/PencawangProgressMap';
import type { RootStackScreenProps } from '../navigation/types';
import {
  AppButton,
  Card,
  Dropdown,
  EmptyState,
  ErrorBanner,
  SkeletonCard,
  StatusChip,
  SuccessBanner,
  WarningBanner,
  Screen,
  type DropdownOption,
} from '../ui';
import { Theme, useTheme } from '../theme';
import { CATEGORY_LABEL, type MaintenanceCategory } from '../maintenance/types';
import {
  BOARD_CACHE_NAMESPACE,
  STATUS_COLOR,
  STATUS_LABEL,
  WORK_TYPES,
  addProgress,
  formatDate,
  holdsWork,
  pencawangLabel,
  progressTotal,
  summarize,
  teamStats,
  type BoardPencawang,
  type CompanyStats,
  type TeamStats,
  type BoardProgress,
  type LaneInfo,
  type MaintenanceBoard,
  type PeStatus,
  type PeSummary,
} from '../maintenance/board';

/**
 * Pencawang progress — the contractor Manager / Supervisor view of every
 * Pencawang given to them (docs/PLAN-maintenance-flow.md §18): who has each
 * work type and how far it is, without opening each Pencawang. A subcontractor
 * sees its own teams; a Main Contractor its own teams and its subcontractors'.
 */

type StatusFilter = 'ALL' | PeStatus | 'OVERDUE' | 'NO_TEAM';
type WorkTypeFilter = 'ALL' | MaintenanceCategory;
type ViewMode = 'LIST' | 'MAP' | 'TEAMS';

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'NOT_STARTED', label: 'Not started' },
  { value: 'WAITING', label: 'Waiting TNB' },
  { value: 'DONE', label: 'Done' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'NO_TEAM', label: 'No team' },
  { value: 'NO_COMPANY', label: 'Not given out' },
];

/** Grey part of a bar = still to do. */
const TODO_COLOR = '#cbd5e1';
const BAR_PARTS: Array<{ key: keyof BoardProgress; color: string }> = [
  { key: 'closed', color: STATUS_COLOR.DONE },
  { key: 'awaiting', color: STATUS_COLOR.WAITING },
  { key: 'inProgress', color: STATUS_COLOR.IN_PROGRESS },
  { key: 'todo', color: TODO_COLOR },
];

const EMPTY: BoardProgress = { todo: 0, inProgress: 0, awaiting: 0, closed: 0 };

export function MaintenanceProgressScreen() {
  const navigation = useNavigation<RootStackScreenProps<'MaintenanceProgress'>['navigation']>();
  const { token, handleUnauthorized } = useSession();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [board, setBoard] = useState<MaintenanceBoard | null>(null);
  const [fromCache, setFromCache] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workType, setWorkType] = useState<WorkTypeFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [owner, setOwner] = useState('ALL');
  const [search, setSearch] = useState('');
  // Plan §18 step 2: the work type tapped on a tile → assign sheet.
  const [assignTarget, setAssignTarget] = useState<{ row: BoardPencawang; category: MaintenanceCategory | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>('LIST');
  const loadedRef = useRef(false);

  const load = useCallback(
    async (showLoading: boolean) => {
      try {
        if (showLoading) setIsLoading(true);
        setError(null);
        const result = await cachedFetch(BOARD_CACHE_NAMESPACE, 'board', () => api.getMaintenanceBoard(token));
        setBoard(result.value);
        setFromCache(result.fromCache ? result.cachedAt : null);
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          await handleUnauthorized(loadError);
          return;
        }
        setError(loadError instanceof Error ? loadError.message : 'Unable to load the Pencawang progress.');
      } finally {
        setIsLoading(false);
      }
    },
    [handleUnauthorized, token],
  );

  useFocusEffect(
    useCallback(() => {
      void load(!loadedRef.current);
      loadedRef.current = true;
    }, [load]),
  );

  const isMainContractor = board?.actorKind === 'MAIN_CONTRACTOR';
  const workTypes = useMemo(() => (workType === 'ALL' ? WORK_TYPES : [workType]), [workType]);

  // Every PE narrowed to the shown work types (PEs without them drop out).
  const summaries = useMemo(() => {
    if (!board) return [];
    return board.pencawangs
      .map((row) => summarize(row, board, workTypes))
      .filter((summary): summary is PeSummary => summary !== null);
  }, [board, workTypes]);

  // Team (SUB) or company / team (MC) picker.
  const ownerOptions: DropdownOption[] = useMemo(() => {
    if (!board) return [];
    const options: DropdownOption[] = [{ label: isMainContractor ? 'All companies and teams' : 'All teams', value: 'ALL' }];
    for (const company of board.companies) {
      if (isMainContractor) {
        options.push({ label: company.name, value: `org:${company.id}`, description: 'Whole company' });
      }
      for (const team of board.teams.filter((candidate) => candidate.organizationId === company.id)) {
        options.push({
          label: team.name,
          value: `team:${team.id}`,
          description: isMainContractor ? company.name : null,
        });
      }
    }
    return options;
  }, [board, isMainContractor]);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const ownerFilter = owner.startsWith('team:')
      ? { teamId: owner.slice(5) }
      : owner.startsWith('org:')
        ? { companyId: owner.slice(4) }
        : {};
    return summaries
      .filter((summary) => {
        if (statusFilter === 'OVERDUE' && !summary.overdue) return false;
        if (statusFilter === 'NO_TEAM' && summary.noTeam === 0) return false;
        if (
          statusFilter !== 'ALL' &&
          statusFilter !== 'OVERDUE' &&
          statusFilter !== 'NO_TEAM' &&
          summary.status !== statusFilter
        ) {
          return false;
        }
        if (owner !== 'ALL' && !holdsWork(summary, ownerFilter)) return false;
        if (query) {
          const haystack = [summary.row.pencawangName, summary.row.pencawangCode, summary.row.mainhead?.name]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      })
      .sort(
        (left, right) =>
          Number(right.overdue) - Number(left.overdue) ||
          closedShare(left) - closedShare(right) ||
          pencawangLabel(left.row).localeCompare(pencawangLabel(right.row)),
      );
  }, [owner, search, statusFilter, summaries]);

  const kpis = useMemo(() => {
    const progress = summaries.map((summary) => summary.progress).reduce(addProgress, EMPTY);
    const total = progressTotal(progress);
    return {
      progress,
      total,
      closedPct: total === 0 ? 0 : Math.round((progress.closed / total) * 100),
      overdue: summaries.filter((summary) => summary.overdue).length,
      noTeam: summaries.reduce((sum, summary) => sum + summary.noTeam, 0),
      // Always every work type: the bars double as the work-type filter.
      byType: board
        ? WORK_TYPES.map((category) => {
            const typeProgress = board.pencawangs
              .map((row) => summarize(row, board, [category]))
              .filter((summary): summary is PeSummary => summary !== null)
              .map((summary) => summary.progress)
              .reduce(addProgress, EMPTY);
            return { category, progress: typeProgress, total: progressTotal(typeProgress) };
          })
        : [],
    };
  }, [board, summaries]);

  const statusFilters = STATUS_FILTERS.filter((option) => option.value !== 'NO_COMPANY' || isMainContractor);

  // Shared by List and Map (the map shows the same Pencawang as the list).
  const statusChips = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
      style={styles.chipScroll}
    >
      {workType !== 'ALL' && mode === 'MAP' ? (
        <Pressable
          onPress={() => setWorkType('ALL')}
          style={[styles.filterChip, styles.filterChipActive]}
          accessibilityRole="button"
          accessibilityLabel="Show every work type"
        >
          <Text style={[styles.filterChipText, styles.filterChipTextActive]}>{CATEGORY_LABEL[workType]} ✕</Text>
        </Pressable>
      ) : null}
      {search.trim() && mode === 'MAP' ? (
        <Pressable
          onPress={() => setSearch('')}
          style={[styles.filterChip, styles.filterChipActive]}
          accessibilityRole="button"
          accessibilityLabel="Clear the search"
        >
          <Text style={[styles.filterChipText, styles.filterChipTextActive]}>“{search.trim()}” ✕</Text>
        </Pressable>
      ) : null}
      {statusFilters.map((option) => {
        const active = statusFilter === option.value;
        return (
          <Pressable
            key={option.value}
            onPress={() => setStatusFilter(option.value)}
            style={[styles.filterChip, active && styles.filterChipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  // Teams tab: per team (and per company for a Main Contractor), over the shown
  // work types; status chips + search do not apply here.
  const teams = useMemo(() => (board ? teamStats(summaries, board) : null), [board, summaries]);
  const showTeamWork = (key: string) => {
    if (key === 'nocompany') {
      setOwner('ALL');
      setStatusFilter('NO_COMPANY');
    } else if (key.startsWith('noteam:')) {
      setOwner(isMainContractor ? `org:${key.slice(7)}` : 'ALL');
      setStatusFilter('NO_TEAM');
    } else {
      setOwner(key);
      setStatusFilter('ALL');
    }
    setSearch('');
    setMode('LIST');
  };

  const openPencawang = (summary: PeSummary) =>
    summary.lanes.some((lane) => lane.ownerTone !== 'noCompany')
      ? () =>
          navigation.navigate('MaintenancePackage', {
            siteVisitId: summary.row.siteVisitId,
            title: pencawangLabel(summary.row),
          })
      : undefined;
  const assignFor = (summary: PeSummary) =>
    board?.canAssign
      ? (category: MaintenanceCategory) => {
          setNotice(null);
          setAssignTarget({ row: summary.row, category });
        }
      : undefined;

  const header = board ? (
    <View style={styles.headerStack}>
      {fromCache ? <WarningBanner message={`Offline — showing the list saved ${formatDate(fromCache)}.`} /> : null}
      <ErrorBanner message={error} />
      <SuccessBanner message={notice} />

      <Card>
        <View style={styles.kpiRow}>
          <View style={styles.kpiMain}>
            <Text style={styles.kpiBig}>{kpis.closedPct}%</Text>
            <Text style={styles.kpiLabel}>
              closed · {kpis.progress.closed}/{kpis.total} Kejanggalan
            </Text>
          </View>
          <View style={styles.kpiSide}>
            <Kpi label="Waiting TNB" value={kpis.progress.awaiting} tone="info" styles={styles} />
            <Kpi
              label="To repair"
              value={kpis.progress.todo + kpis.progress.inProgress}
              tone="neutral"
              styles={styles}
            />
          </View>
        </View>
        <View style={styles.kpiFlags}>
          <Pressable onPress={() => setStatusFilter('OVERDUE')} accessibilityRole="button">
            <StatusChip label={`${kpis.overdue} overdue Pencawang`} tone={kpis.overdue > 0 ? 'danger' : 'neutral'} />
          </Pressable>
          <Pressable onPress={() => setStatusFilter('NO_TEAM')} accessibilityRole="button">
            <StatusChip label={`${kpis.noTeam} with no team`} tone={kpis.noTeam > 0 ? 'warning' : 'neutral'} />
          </Pressable>
        </View>

        <View style={styles.typeBars}>
          {kpis.byType.map((type) => {
            const active = workType === type.category;
            return (
              <Pressable
                key={type.category}
                disabled={type.total === 0 && !active}
                onPress={() => setWorkType(active ? 'ALL' : type.category)}
                style={[styles.typeBar, active && styles.typeBarActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${CATEGORY_LABEL[type.category]}: ${type.progress.closed} of ${type.total} closed`}
              >
                <View style={styles.typeBarTop}>
                  <Text style={styles.typeBarName}>{CATEGORY_LABEL[type.category]}</Text>
                  <Text style={styles.typeBarCount}>
                    {type.total === 0 ? 'None' : `${type.progress.closed}/${type.total}`}
                  </Text>
                </View>
                <ProgressBar progress={type.progress} styles={styles} />
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.legend}>
          <Text style={{ color: STATUS_COLOR.DONE }}>■</Text> closed{'  '}
          <Text style={{ color: STATUS_COLOR.WAITING }}>■</Text> waiting TNB{'  '}
          <Text style={{ color: STATUS_COLOR.IN_PROGRESS }}>■</Text> in progress{'  '}
          <Text style={{ color: TODO_COLOR }}>■</Text> to do
          {workType !== 'ALL' ? `   ·   showing ${CATEGORY_LABEL[workType]} only` : ''}
        </Text>
      </Card>

      {statusChips}

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Feather name="search" size={16} color={theme.colors.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search Pencawang"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.searchInput}
            autoCapitalize="characters"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} accessibilityLabel="Clear search" hitSlop={8}>
              <Feather name="x" size={16} color={theme.colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {ownerOptions.length > 1 ? (
        <Dropdown value={owner} options={ownerOptions} onSelect={setOwner} placeholder="All teams" />
      ) : null}

      <Text style={styles.countLine}>
        {rows.length} of {summaries.length} Pencawang
        {board.canAssign ? '' : ' · view only'}
      </Text>
    </View>
  ) : null;

  return (
    <Screen
      title="Pencawang progress"
      scroll={false}
      actions={
        board ? (
          <View style={styles.segment}>
            {(['LIST', 'MAP', 'TEAMS'] as ViewMode[]).map((option) => (
              <Pressable
                key={option}
                onPress={() => setMode(option)}
                style={[styles.segmentItem, mode === option && styles.segmentItemActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: mode === option }}
              >
                <Text style={[styles.segmentText, mode === option && styles.segmentTextActive]}>
                  {option === 'LIST' ? 'List' : option === 'MAP' ? 'Map' : isMainContractor ? 'Companies' : 'Teams'}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : undefined
      }
      leftAction={{ icon: 'back', onPress: () => navigation.goBack(), accessibilityLabel: 'Back' }}
      rightAction={{ icon: 'refresh', onPress: () => void load(true), accessibilityLabel: 'Refresh', disabled: isLoading }}
    >
      {isLoading && !board ? (
        <View style={styles.headerStack}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : null}

      {!board && error ? (
        <View style={styles.headerStack}>
          <ErrorBanner message={error} />
          <Card>
            <AppButton label="Try again" variant="secondary" onPress={() => void load(true)} />
          </Card>
        </View>
      ) : null}

      {board && mode === 'MAP' ? (
        <View style={styles.mapStack}>
          <SuccessBanner message={notice} />
          {statusChips}
          <PencawangProgressMap
            rows={rows}
            showNoCompany={isMainContractor}
            renderCard={(summary, onClose) => (
              <PencawangTile
                summary={summary}
                styles={styles}
                onOpen={openPencawang(summary)}
                onAssign={assignFor(summary)}
                onClose={onClose}
              />
            )}
          />
        </View>
      ) : null}

      {board && teams && mode === 'TEAMS' ? (
        <TeamsView
          teams={teams}
          isMainContractor={isMainContractor}
          workType={workType}
          onClearWorkType={() => setWorkType('ALL')}
          onPick={showTeamWork}
          styles={styles}
        />
      ) : null}

      {board && mode === 'LIST' ? (
        <FlatList
          data={rows}
          keyExtractor={(summary) => summary.row.siteVisitId}
          ListHeaderComponent={header}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={8}
          windowSize={7}
          renderItem={({ item }) => (
            <PencawangTile
              summary={item}
              styles={styles}
              onAssign={assignFor(item)}
              onOpen={openPencawang(item)}
            />
          )}
          ListEmptyComponent={
            <Card>
              <EmptyState
                icon="package"
                title={summaries.length === 0 ? 'No Pencawang yet' : 'Nothing matches'}
                description={
                  summaries.length === 0
                    ? 'Pencawang given to your company will appear here with each team’s progress.'
                    : 'Try another filter or clear the search.'
                }
              />
            </Card>
          }
        />
      ) : null}

      {board ? (
        <AssignLaneSheet
          board={board}
          row={assignTarget?.row ?? null}
          initialCategory={assignTarget?.category ?? null}
          token={token}
          onClose={() => setAssignTarget(null)}
          onUnauthorized={handleUnauthorized}
          onSaved={(message) => {
            setAssignTarget(null);
            setNotice(message);
            void load(false);
          }}
        />
      ) : null}
    </Screen>
  );
}

function TeamsView({
  teams,
  isMainContractor,
  workType,
  onClearWorkType,
  onPick,
  styles,
}: {
  teams: { companies: CompanyStats[]; notGivenOut: TeamStats | null };
  isMainContractor: boolean;
  workType: WorkTypeFilter;
  onClearWorkType: () => void;
  onPick: (key: string) => void;
  styles: Styles;
}) {
  // A Main Contractor's own company opens expanded; subcontractors start folded.
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(teams.companies.slice(0, 1).map((company) => company.companyId)),
  );
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ScrollView contentContainerStyle={styles.teamsContent}>
      {workType !== 'ALL' ? (
        <Pressable
          onPress={onClearWorkType}
          style={[styles.filterChip, styles.filterChipActive, styles.selfStart]}
          accessibilityRole="button"
          accessibilityLabel="Show every work type"
        >
          <Text style={[styles.filterChipText, styles.filterChipTextActive]}>{CATEGORY_LABEL[workType]} only ✕</Text>
        </Pressable>
      ) : null}

      {isMainContractor ? (
        <>
          {teams.notGivenOut ? (
            <Card>
              <StatsRow stats={teams.notGivenOut} onPress={() => onPick('nocompany')} styles={styles} warn />
            </Card>
          ) : null}
          {teams.companies.map((company) => {
            const expanded = open.has(company.companyId);
            return (
              <Card key={company.companyId}>
                <StatsRow
                  stats={company}
                  onPress={() => onPick(company.key)}
                  styles={styles}
                  heading
                  trailing={
                    company.teams.length > 0 ? (
                      <Pressable
                        onPress={() => toggle(company.companyId)}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={expanded ? 'Hide teams' : 'Show teams'}
                      >
                        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={20} style={styles.closeIcon} />
                      </Pressable>
                    ) : null
                  }
                />
                {expanded
                  ? company.teams.map((team) => (
                      <View key={team.key} style={styles.teamIndent}>
                        <StatsRow
                          stats={team}
                          onPress={() => onPick(team.key)}
                          styles={styles}
                          warn={team.key.startsWith('noteam:')}
                        />
                      </View>
                    ))
                  : null}
              </Card>
            );
          })}
        </>
      ) : (
        <Card>
          {teams.companies.flatMap((company) => company.teams).length === 0 ? (
            <EmptyState icon="users" title="No teams yet" description="Create teams on the web, then give them work here." />
          ) : (
            teams.companies
              .flatMap((company) => company.teams)
              .map((team, index) => (
                <View key={team.key} style={index > 0 ? styles.teamDivider : undefined}>
                  <StatsRow
                    stats={team}
                    onPress={() => onPick(team.key)}
                    styles={styles}
                    warn={team.key.startsWith('noteam:')}
                  />
                </View>
              ))
          )}
        </Card>
      )}

      <Text style={styles.footnote}>
        Tap a row to see its Pencawang. Each work type counts for the team that holds it; poles split off
        to another team are counted under the work type&apos;s team.
      </Text>
    </ScrollView>
  );
}

function StatsRow({
  stats,
  onPress,
  styles,
  heading = false,
  warn = false,
  trailing,
}: {
  stats: TeamStats;
  onPress: () => void;
  styles: Styles;
  heading?: boolean;
  warn?: boolean;
  trailing?: ReactNode;
}) {
  const toRepair = stats.progress.todo + stats.progress.inProgress;
  const pct = stats.total === 0 ? 0 : Math.round((stats.progress.closed / stats.total) * 100);
  const idle = stats.total === 0;
  return (
    <View style={styles.statsRow}>
      <Pressable
        onPress={onPress}
        disabled={idle && stats.splitOnly === 0}
        style={({ pressed }) => [styles.statsMain, pressed && styles.lanePressed]}
        accessibilityRole="button"
        accessibilityLabel={`${stats.label}: ${stats.pencawang} Pencawang, ${toRepair} to repair, ${stats.progress.awaiting} waiting TNB, ${stats.progress.closed} closed`}
      >
        <View style={styles.statsTop}>
          <Text
            style={[heading ? styles.statsHeading : styles.statsName, warn && styles.laneOwnerWarn]}
            numberOfLines={1}
          >
            {warn ? '⚠ ' : ''}
            {stats.label}
          </Text>
          <Text style={[styles.statsPct, pct === 100 && !idle && { color: STATUS_COLOR.DONE }]}>
            {idle ? '—' : `${pct}%`}
          </Text>
        </View>
        {idle ? (
          <Text style={styles.statsLine}>
            {stats.splitOnly > 0
              ? `Split poles on ${stats.splitOnly} Pencawang`
              : 'No work right now'}
          </Text>
        ) : (
          <>
            <View style={styles.tileBar}>
              <ProgressBar progress={stats.progress} styles={styles} />
            </View>
            <Text style={styles.statsLine}>
              {stats.pencawang} Pencawang · <Text style={styles.strong}>{toRepair}</Text> to repair
              {stats.progress.awaiting > 0 ? ` · ${stats.progress.awaiting} waiting TNB` : ''} ·{' '}
              {stats.progress.closed}/{stats.total} closed
              {stats.splitOnly > 0 ? ` · + split poles on ${stats.splitOnly}` : ''}
            </Text>
          </>
        )}
      </Pressable>
      {trailing}
    </View>
  );
}

function closedShare(summary: PeSummary) {
  return summary.total === 0 ? 1 : summary.progress.closed / summary.total;
}

type Styles = ReturnType<typeof createStyles>;

function Kpi({
  label,
  value,
  tone,
  styles,
}: {
  label: string;
  value: number;
  tone: 'info' | 'neutral';
  styles: Styles;
}) {
  return (
    <View style={styles.kpiSmall}>
      <Text style={[styles.kpiSmallValue, tone === 'info' && { color: STATUS_COLOR.WAITING }]}>{value}</Text>
      <Text style={styles.kpiSmallLabel}>{label}</Text>
    </View>
  );
}

/** Closed · waiting TNB · in progress · to do. Only closed counts to 100%. */
function ProgressBar({ progress, styles }: { progress: BoardProgress; styles: Styles }) {
  const total = progressTotal(progress);
  return (
    <View style={styles.bar}>
      {total > 0
        ? BAR_PARTS.map((part) =>
            progress[part.key] > 0 ? (
              <View key={part.key} style={{ flex: progress[part.key], backgroundColor: part.color }} />
            ) : null,
          )
        : null}
    </View>
  );
}

const STATUS_TONE: Record<PeStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  NO_COMPANY: 'neutral',
  NOT_STARTED: 'danger',
  IN_PROGRESS: 'warning',
  WAITING: 'info',
  DONE: 'success',
};

function PencawangTile({
  summary,
  styles,
  onOpen,
  onAssign,
  onClose,
}: {
  summary: PeSummary;
  styles: Styles;
  onOpen?: () => void;
  /** Managers only: tap a work-type line to give it to a team. */
  onAssign?: (category: MaintenanceCategory) => void;
  /** Map card: close it. */
  onClose?: () => void;
}) {
  const { row, progress } = summary;
  return (
    <Pressable
      onPress={onOpen}
      disabled={!onOpen}
      style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
      accessibilityRole={onOpen ? 'button' : undefined}
      accessibilityLabel={`${pencawangLabel(row)}, ${STATUS_LABEL[summary.status]}, ${progress.closed} of ${summary.total} closed`}
    >
      <View style={[styles.spine, { backgroundColor: summary.overdue ? STATUS_COLOR.NOT_STARTED : STATUS_COLOR[summary.status] }]} />
      <View style={styles.tileBody}>
        <View style={styles.tileTop}>
          <Text style={styles.tileName} numberOfLines={1}>
            {pencawangLabel(row)}
          </Text>
          <StatusChip label={STATUS_LABEL[summary.status]} tone={STATUS_TONE[summary.status]} />
          {onClose ? (
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Feather name="x" size={18} style={styles.closeIcon} />
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.tileMeta} numberOfLines={1}>
          {row.mainhead?.name ?? 'No Mainhead'} · {row.poleCount} pole{row.poleCount === 1 ? '' : 's'}
        </Text>

        <View style={styles.tileBar}>
          <ProgressBar progress={progress} styles={styles} />
        </View>
        <Text style={styles.tileCounts}>
          <Text style={styles.strong}>{progress.closed}</Text>/{summary.total} closed
          {progress.awaiting > 0 ? ` · ${progress.awaiting} waiting TNB` : ''}
          {progress.inProgress > 0 ? ` · ${progress.inProgress} in progress` : ''}
        </Text>

        <View style={styles.lanes}>
          {summary.lanes.map((lane) => (
            <LaneRow
              key={lane.category}
              lane={lane}
              styles={styles}
              onAssign={onAssign && lane.canAssign ? () => onAssign(lane.category) : undefined}
            />
          ))}
        </View>

        {summary.dueDate ? (
          <Text style={[styles.tileDue, summary.overdue && styles.tileDueOverdue]}>
            {summary.overdue ? 'OVERDUE · ' : ''}Target {formatDate(summary.dueDate)}
          </Text>
        ) : null}
      </View>
      {onOpen ? <Feather name="chevron-right" size={18} style={styles.chevron} /> : null}
    </Pressable>
  );
}

function LaneRow({ lane, styles, onAssign }: { lane: LaneInfo; styles: Styles; onAssign?: () => void }) {
  const done = lane.progress.closed === lane.total;
  const content = (
    <>
      <Text style={styles.laneType} numberOfLines={1}>
        {CATEGORY_LABEL[lane.category]}
      </Text>
      <Text
        style={[
          styles.laneOwner,
          lane.ownerTone === 'noTeam' && styles.laneOwnerWarn,
          lane.ownerTone === 'noCompany' && styles.laneOwnerMuted,
        ]}
        numberOfLines={1}
      >
        {lane.ownerTone === 'noTeam' ? '⚠ ' : ''}
        {lane.owner}
        {lane.splits.length > 0 ? ` + ${lane.splits.join(', ')}` : ''}
      </Text>
      <Text style={[styles.laneCount, done && { color: STATUS_COLOR.DONE }, lane.overdue && styles.laneOverdue]}>
        {lane.progress.closed}/{lane.total}
      </Text>
      {onAssign ? <Feather name="edit-2" size={13} style={styles.laneEdit} /> : null}
    </>
  );
  if (!onAssign) return <View style={styles.lane}>{content}</View>;
  return (
    <Pressable
      onPress={onAssign}
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => [styles.lane, styles.laneTappable, pressed && styles.lanePressed]}
      accessibilityRole="button"
      accessibilityLabel={`${CATEGORY_LABEL[lane.category]}: ${lane.owner}. Change team`}
    >
      {content}
    </Pressable>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    listContent: { paddingBottom: 32, gap: 10 },
    segment: {
      flexDirection: 'row',
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: theme.radius.chip,
      padding: 3,
    },
    segmentItem: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 6 },
    segmentItemActive: { backgroundColor: theme.colors.primary },
    segmentText: { fontFamily: theme.fonts.bodySemibold, fontSize: 13, color: theme.colors.textSecondary },
    segmentTextActive: { color: theme.colors.textOnPrimary },
    mapStack: { flex: 1, gap: 10 },
    chipScroll: { flexGrow: 0 },
    closeIcon: { color: theme.colors.textMuted },
    teamsContent: { paddingTop: 4, paddingBottom: 32, gap: 12 },
    selfStart: { alignSelf: 'flex-start' },
    teamIndent: {
      marginTop: 8,
      paddingTop: 8,
      paddingLeft: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    teamDivider: {
      marginTop: 10,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    statsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    statsMain: { flex: 1, borderRadius: 8 },
    statsTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    statsHeading: { flex: 1, fontFamily: theme.fonts.display, fontSize: 16, color: theme.colors.textPrimary },
    statsName: { flex: 1, fontFamily: theme.fonts.bodySemibold, fontSize: 14, color: theme.colors.textPrimary },
    statsPct: { fontFamily: theme.fonts.bodySemibold, fontSize: 14, color: theme.colors.textPrimary },
    statsLine: { marginTop: 4, fontFamily: theme.fonts.body, fontSize: 12.5, color: theme.colors.textSecondary },
    footnote: { fontFamily: theme.fonts.body, fontSize: 11.5, color: theme.colors.textMuted },
    headerStack: { gap: 12, paddingTop: 12, paddingBottom: 4 },
    kpiRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    kpiMain: { flex: 1 },
    kpiBig: { fontFamily: theme.fonts.display, fontSize: 34, color: theme.colors.textPrimary },
    kpiLabel: { fontFamily: theme.fonts.body, fontSize: 12.5, color: theme.colors.textSecondary },
    kpiSide: { flexDirection: 'row', gap: 16 },
    kpiSmall: { alignItems: 'flex-end' },
    kpiSmallValue: { fontFamily: theme.fonts.display, fontSize: 22, color: theme.colors.textPrimary },
    kpiSmallLabel: { fontFamily: theme.fonts.body, fontSize: 11.5, color: theme.colors.textMuted },
    kpiFlags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
    typeBars: { gap: 8, marginTop: 14 },
    typeBar: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.control,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    typeBarActive: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft },
    typeBarTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
    typeBarName: { fontFamily: theme.fonts.bodySemibold, fontSize: 13, color: theme.colors.textPrimary },
    typeBarCount: { fontFamily: theme.fonts.body, fontSize: 12.5, color: theme.colors.textSecondary },
    legend: { marginTop: 10, fontFamily: theme.fonts.body, fontSize: 11.5, color: theme.colors.textMuted },
    bar: {
      flexDirection: 'row',
      height: 8,
      borderRadius: 4,
      overflow: 'hidden',
      backgroundColor: theme.colors.surfaceMuted,
    },
    chipRow: { gap: 8, paddingRight: 8 },
    filterChip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
      backgroundColor: theme.colors.card,
    },
    filterChipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
    filterChipText: { fontFamily: theme.fonts.bodySemibold, fontSize: 13, color: theme.colors.textSecondary },
    filterChipTextActive: { color: theme.colors.textOnPrimary },
    searchRow: { flexDirection: 'row' },
    searchBox: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
      borderRadius: theme.radius.control,
      backgroundColor: theme.colors.card,
    },
    searchInput: {
      flex: 1,
      paddingVertical: 10,
      fontFamily: theme.fonts.body,
      fontSize: 14,
      color: theme.colors.textPrimary,
    },
    countLine: { fontFamily: theme.fonts.body, fontSize: 12, color: theme.colors.textMuted },
    tile: {
      flexDirection: 'row',
      backgroundColor: theme.colors.card,
      borderRadius: theme.radius.card,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: 'hidden',
    },
    tilePressed: { backgroundColor: theme.colors.surfacePressed },
    spine: { width: 5 },
    tileBody: { flex: 1, paddingHorizontal: 12, paddingVertical: 11 },
    tileTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    tileName: { flex: 1, fontFamily: theme.fonts.bodySemibold, fontSize: 15, color: theme.colors.textPrimary },
    tileMeta: { marginTop: 2, fontFamily: theme.fonts.body, fontSize: 12, color: theme.colors.textMuted },
    tileBar: { marginTop: 9 },
    tileCounts: { marginTop: 4, fontFamily: theme.fonts.body, fontSize: 12.5, color: theme.colors.textSecondary },
    strong: { fontFamily: theme.fonts.bodySemibold, color: theme.colors.textPrimary },
    lanes: {
      marginTop: 8,
      paddingTop: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
      gap: 4,
    },
    lane: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    laneType: { width: 92, fontFamily: theme.fonts.body, fontSize: 12.5, color: theme.colors.textSecondary },
    laneOwner: { flex: 1, fontFamily: theme.fonts.bodySemibold, fontSize: 12.5, color: theme.colors.textPrimary },
    laneOwnerWarn: { color: theme.colors.warningText },
    laneOwnerMuted: { color: theme.colors.textMuted },
    laneCount: { fontFamily: theme.fonts.bodySemibold, fontSize: 12.5, color: theme.colors.textPrimary },
    laneOverdue: { color: theme.colors.dangerText },
    laneTappable: { marginHorizontal: -6, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8 },
    lanePressed: { backgroundColor: theme.colors.surfacePressed },
    laneEdit: { color: theme.colors.primary },
    tileDue: { marginTop: 6, fontFamily: theme.fonts.body, fontSize: 12, color: theme.colors.textMuted },
    tileDueOverdue: { fontFamily: theme.fonts.bodySemibold, color: theme.colors.dangerText },
    chevron: { alignSelf: 'center', marginRight: 8, color: theme.colors.textMuted },
  });
}
