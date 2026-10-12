import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from '../api';
import { isNetworkOffline } from '../networkStatus';
import { AppButton, ErrorBanner, SelectCard, WarningBanner } from '../ui';
import { Theme, useTheme } from '../theme';
import { CATEGORY_LABEL, type MaintenanceCategory } from '../maintenance/types';
import {
  WORK_TYPES,
  formatDate,
  keptPackageFields,
  laneInfo,
  pencawangLabel,
  routingMessage,
  type BoardPencawang,
  type MaintenanceBoard,
} from '../maintenance/board';

/**
 * Give one work type of a Pencawang — or the whole Pencawang — to a team, from
 * the phone (docs/PLAN-maintenance-flow.md §18, M45). A subcontractor Manager
 * picks one of its own teams; a Main Contractor Manager also a subcontractor
 * (whose Manager then picks the team) or one of its teams. Online only. The
 * target date and notes are sent back unchanged.
 */

/** null = the whole Pencawang. */
type Scope = MaintenanceCategory | null;

export function AssignLaneSheet({
  board,
  row,
  initialCategory,
  token,
  onClose,
  onSaved,
  onUnauthorized,
}: {
  board: MaintenanceBoard;
  /** null = closed. */
  row: BoardPencawang | null;
  initialCategory: Scope;
  token: string;
  onClose: () => void;
  onSaved: (message: string) => void;
  onUnauthorized: (error: ApiError) => Promise<void> | void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [scope, setScope] = useState<Scope>(initialCategory);
  const [destination, setDestination] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCompany = board.actorKind === 'COMPANY';

  // Work types the viewer may (re)assign on this Pencawang.
  const lanes = useMemo(
    () =>
      row
        ? WORK_TYPES.map((category) => laneInfo(row, category, board)).filter(
            (lane): lane is NonNullable<typeof lane> => lane !== null && lane.canAssign,
          )
        : [],
    [board, row],
  );
  const scopes: Scope[] = useMemo(
    () => [...lanes.map((lane) => lane.category), ...(row?.canAssign && lanes.length > 1 ? [null] : [])],
    [lanes, row?.canAssign],
  );

  /** The current owner of the scope, as a destination value. */
  const currentDestination = (target: Scope) => {
    if (!row) return '';
    if (target) {
      const lane = row.lanes.find((candidate) => candidate.category === target);
      if (lane?.team) return `team:${lane.team.id}`;
      return lane?.organization ? `org:${lane.organization.id}` : '';
    }
    const whole = row.packages.find((pkg) => pkg.category === null);
    if (whole) return whole.team ? `team:${whole.team.id}` : `org:${whole.organization.id}`;
    return '';
  };

  // Reset whenever the sheet opens on a Pencawang / work type.
  useEffect(() => {
    if (!row) return;
    const first = initialCategory !== null && scopes.includes(initialCategory) ? initialCategory : scopes[0] ?? null;
    setScope(first);
    setDestination(currentDestination(first));
    setError(null);
    setIsSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.siteVisitId, initialCategory]);

  const pickScope = (next: Scope) => {
    setScope(next);
    setDestination(currentDestination(next));
    setError(null);
  };

  // Destinations, grouped by company. A subcontractor only re-teams its own work.
  const groups = useMemo(
    () =>
      board.companies.map((company) => ({
        company,
        options: [
          {
            value: `org:${company.id}`,
            label: isCompany ? 'No team (unassigned)' : `${company.name} — its manager picks the team`,
            description: isCompany ? 'Takes the work off the team that has it now' : null,
          },
          ...board.teams
            .filter((team) => team.organizationId === company.id)
            .map((team) => ({ value: `team:${team.id}`, label: team.name, description: null })),
        ],
      })),
    [board.companies, board.teams, isCompany],
  );

  const kept = row ? keptPackageFields(row, scope) : { dueDate: null, notes: null };
  const unchanged = destination === currentDestination(scope);
  const offline = isNetworkOffline();

  async function save() {
    if (!row || !destination) return;
    const [kind, id] = destination.split(':') as ['org' | 'team', string];
    const team = kind === 'team' ? board.teams.find((candidate) => candidate.id === id) : null;
    const organizationId = team ? team.organizationId : id;
    setIsSaving(true);
    setError(null);
    try {
      const result = await api.assignMaintenancePackage(token, {
        siteVisitId: row.siteVisitId,
        category: scope,
        maintenanceOrganizationId: organizationId,
        assignedTeamId: team?.id ?? null,
        dueDate: kept.dueDate,
        notes: kept.notes,
      });
      onSaved(routingMessage(result.routing));
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 401) {
        await onUnauthorized(saveError);
        return;
      }
      setError(
        saveError instanceof ApiError && saveError.status === 0
          ? 'No connection — connect to assign.'
          : saveError instanceof Error
            ? saveError.message
            : 'Could not save.',
      );
    } finally {
      setIsSaving(false);
    }
  }

  const scopeLane = scope ? lanes.find((lane) => lane.category === scope) : null;

  return (
    <Modal visible={row !== null} transparent animationType="slide" onRequestClose={isSaving ? undefined : onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={isSaving ? undefined : onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.eyebrow}>{isCompany ? 'Give to a team' : 'Give to a company or team'}</Text>
          <Text style={styles.title} numberOfLines={1}>
            {row ? pencawangLabel(row) : ''}
          </Text>

          {scopes.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scopeRow}>
              {scopes.map((option) => {
                const active = scope === option;
                return (
                  <Pressable
                    key={option ?? 'WHOLE'}
                    onPress={() => pickScope(option)}
                    style={[styles.scopeChip, active && styles.scopeChipActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.scopeChipText, active && styles.scopeChipTextActive]}>
                      {option ? CATEGORY_LABEL[option] : 'All work types'}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          <Text style={styles.now}>
            {scopeLane
              ? `${CATEGORY_LABEL[scopeLane.category]} now: ${scopeLane.owner} · ${scopeLane.progress.closed}/${scopeLane.total} closed`
              : 'Every work type of this Pencawang goes to one team.'}
          </Text>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            {groups.map((group) => (
              <View key={group.company.id} style={styles.group}>
                {!isCompany ? <Text style={styles.groupTitle}>{group.company.name}</Text> : null}
                {group.options.map((option) => (
                  <SelectCard
                    key={option.value}
                    label={option.label}
                    description={option.description}
                    selected={destination === option.value}
                    onPress={() => setDestination(option.value)}
                  />
                ))}
              </View>
            ))}
            {kept.dueDate ? (
              <Text style={styles.helper}>Target date stays {formatDate(kept.dueDate)}.</Text>
            ) : null}
            <Text style={styles.helper}>
              Work a crew has already started (photos taken) stays with that crew.
            </Text>
          </ScrollView>

          {offline ? <WarningBanner message="Offline — connect to assign." /> : null}
          <ErrorBanner message={error} />

          <View style={styles.footer}>
            <View style={styles.footerButton}>
              <AppButton label="Cancel" variant="secondary" onPress={onClose} disabled={isSaving} />
            </View>
            <View style={styles.footerButton}>
              <AppButton
                label="Save"
                loading={isSaving}
                onPress={() => void save()}
                disabled={!destination || unchanged || offline || scopes.length === 0}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'flex-end' },
    backdropTap: { flex: 1 },
    sheet: {
      backgroundColor: theme.colors.card,
      borderTopLeftRadius: theme.radius.sheet,
      borderTopRightRadius: theme.radius.sheet,
      paddingHorizontal: 18,
      paddingTop: 10,
      paddingBottom: 20,
      maxHeight: '88%',
      gap: 10,
    },
    grabber: {
      alignSelf: 'center',
      width: 38,
      height: 4,
      borderRadius: 999,
      backgroundColor: theme.colors.borderStrong,
    },
    eyebrow: {
      fontFamily: theme.fonts.bodySemibold,
      fontSize: 11.5,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: theme.colors.textMuted,
    },
    title: { fontFamily: theme.fonts.display, fontSize: 19, color: theme.colors.textPrimary, marginTop: -4 },
    scopeRow: { gap: 8, paddingRight: 8 },
    scopeChip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
      backgroundColor: theme.colors.card,
    },
    scopeChipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
    scopeChipText: { fontFamily: theme.fonts.bodySemibold, fontSize: 13, color: theme.colors.textSecondary },
    scopeChipTextActive: { color: theme.colors.textOnPrimary },
    now: { fontFamily: theme.fonts.body, fontSize: 13, color: theme.colors.textSecondary },
    body: { flexGrow: 0 },
    group: { gap: 8, marginBottom: 12 },
    groupTitle: { fontFamily: theme.fonts.bodySemibold, fontSize: 13, color: theme.colors.textPrimary },
    helper: { fontFamily: theme.fonts.body, fontSize: 12, color: theme.colors.textMuted, marginTop: 4 },
    footer: { flexDirection: 'row', gap: 10 },
    footerButton: { flex: 1, justifyContent: 'center' },
  });
}
