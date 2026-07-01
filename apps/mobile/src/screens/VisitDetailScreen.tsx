import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import type { Region } from 'react-native-maps';
import { API_BASE_URL, api, ApiError, isEndpointUnavailableError } from '../api';
import { cachedFetch } from '../offlineCache';
import {
  AppButton,
  Card,
  EmptyState,
  ErrorBanner,
  KeyValueRow,
  LoadingBlock,
  Screen,
  SectionTitle,
  StatusChip,
  SuccessBanner,
  TextField,
  WarningBanner,
} from '../ui';
import { Theme, useTheme } from '../theme';
import {
  enqueueVisitCompletion,
  hasQueuedVisitCompletion,
  isRetryableSyncError,
  SyncQueueSnapshot,
} from '../syncQueue';
import {
  getAssetRowLabels,
  getSubmittedInspectionAssetIds,
} from '../assetDisplay';
import { Asset, SiteVisit, SiteVisitSummary, UserRole } from '../types';
import { formatDateTime, normalizeOperationalPayloadText } from '../utils';
import { useSession } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import * as Location from 'expo-location';
import { getPositionWithTimeout } from '../location';
import type { RootStackScreenProps } from '../navigation/types';

type Coordinate = {
  latitude: number;
  longitude: number;
};

type ThumbnailImage = {
  uri?: string | null;
  url?: string | null;
  path?: string | null;
};

type AssetWithOptionalDisplayData = Asset & {
  images?: ThumbnailImage[];
  inspectionImages?: ThumbnailImage[];
  latestInspection?: {
    images?: ThumbnailImage[];
  } | null;
  noTiangRondaan?: unknown;
  no_tiang_rondaan?: unknown;
};

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');
// Keep the Visit Detail asset list compact; the full list (with search and
// filters) lives on the dedicated VisitAssets screen via "View All Assets".
const VISIBLE_ASSET_LIMIT = 5;
const DEFAULT_REGION: Region = {
  latitude: 3.139,
  longitude: 101.6869,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

export function VisitDetailScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'VisitDetail'>['navigation']>();
  const route = useRoute<RootStackScreenProps<'VisitDetail'>['route']>();
  const { visitId, substationId, successMessage } = route.params;
  const { token, user, handleUnauthorized } = useSession();
  const { isOffline, snapshot: syncQueueSnapshot } = useSync();

  const [visit, setVisit] = useState<SiteVisit | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [availableAssets, setAvailableAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCompleting, setIsCompleting] = useState(false);
  const [linkingAssetId, setLinkingAssetId] = useState<string | null>(null);
  const [completionNotes, setCompletionNotes] = useState('');
  const [completionNotice, setCompletionNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isCompletionQueued = hasQueuedVisitCompletion(syncQueueSnapshot, visitId);

  const hasLoadedRef = useRef(false);

  const loadVisitData = useCallback(
    async (options?: { silent?: boolean }) => {
      try {
        setError(null);
        if (!options?.silent) {
          setIsLoading(true);
        }

        // Offline-first: serve the cached visit when the server is unreachable.
        const { value: visitResponse } = await cachedFetch('site-visit', visitId, () =>
          api.getSiteVisit(token, visitId),
        );

        // Load the asset register INDEPENDENTLY — a cold register cache (e.g.
        // only Home was opened online, not this visit) must not blank the whole
        // visit; show it with whatever assets are available.
        let substationAssetList: Asset[] = [];
        try {
          const { value } = await cachedFetch('assets', substationId, () =>
            api.getAssets(token, substationId),
          );
          substationAssetList = value;
        } catch (assetError) {
          if (assetError instanceof ApiError && assetError.status === 401) {
            throw assetError;
          }
          // Offline + no cached register → empty; the visit still opens.
        }

        const visitAssetList = await loadVisitScopedAssets(token, visitId, substationAssetList);

        setVisit(visitResponse);
        setAssets(visitAssetList);
        setAvailableAssets(createAvailableAssetList(substationAssetList, visitAssetList));
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          await handleUnauthorized(loadError);
          return;
        }

        setError(loadError instanceof Error ? loadError.message : 'Unable to load visit details.');
      } finally {
        setIsLoading(false);
      }
    },
    [handleUnauthorized, substationId, token, visitId],
  );

  // Refetch whenever the screen regains focus so visit progress, linked assets
  // and defect rollups reflect inspections submitted (online) or replayed from
  // the offline sync queue since we left. The first focus shows the full-screen
  // loader; subsequent focuses refresh silently to avoid spinner flicker.
  useFocusEffect(
    useCallback(() => {
      loadVisitData({ silent: hasLoadedRef.current });
      hasLoadedRef.current = true;
    }, [loadVisitData]),
  );

  async function handleCompleteVisit() {
    if (!visit) {
      return;
    }

    const payload = {
      completedAt: new Date().toISOString(),
      completionNotes: normalizeOperationalPayloadText(completionNotes),
    };

    if (isOffline) {
      await queueVisitCompletion(visit, payload, 'Queued while offline.');
      return;
    }

    try {
      setIsCompleting(true);
      setError(null);
      setCompletionNotice(null);

      const completedVisit = await api.completeSiteVisit(token, visit.id, payload);

      setVisit(completedVisit);
      setCompletionNotice('Visit completed successfully.');
    } catch (completeError) {
      if (completeError instanceof ApiError && completeError.status === 401) {
        await handleUnauthorized(completeError);
        return;
      }

      if (isEndpointUnavailableError(completeError)) {
        setError('Visit completion is not available on this backend version.');
        return;
      }

      if (isRetryableSyncError(completeError)) {
        const message =
          completeError instanceof Error
            ? completeError.message
            : 'Connection unavailable during visit completion.';

        await queueVisitCompletion(visit, payload, message);
        return;
      }

      setError(completeError instanceof Error ? completeError.message : 'Unable to complete visit.');
    } finally {
      setIsCompleting(false);
    }
  }

  async function queueVisitCompletion(
    currentVisit: SiteVisit,
    payload: { completedAt: string; completionNotes?: string },
    errorMessage: string,
  ) {
    try {
      setError(null);
      setCompletionNotice(null);

      await enqueueVisitCompletion({
        visit: currentVisit,
        assets,
        payload,
        errorMessage,
      });

      setCompletionNotice('Visit completion saved to Sync Queue.');
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : 'Unable to queue visit completion.');
    }
  }

  function handleConfirmCompleteVisit() {
    if (!visit || isVisitTerminal(visit.status) || isCompletionQueued) {
      return;
    }

    const rollup = createVisitRollup(visit, assets);
    const queuedInspectionCount = getQueuedInspectionCount(syncQueueSnapshot, visit.id);

    if (rollup.totalAssets === 0) {
      setError('Link at least one asset to this visit before completing it.');
      return;
    }

    if (queuedInspectionCount > 0 && !isOffline) {
      setError(
        `${queuedInspectionCount} inspection submission${queuedInspectionCount === 1 ? '' : 's'} still need to sync before this visit can be completed.`,
      );
      return;
    }

    const message =
      queuedInspectionCount > 0
        ? `${queuedInspectionCount} inspection submission${queuedInspectionCount === 1 ? '' : 's'} will sync before visit completion.`
        : rollup.pendingAssets > 0
        ? `${rollup.pendingAssets} asset${rollup.pendingAssets === 1 ? '' : 's'} still have no submitted inspection. Complete this visit anyway?`
        : 'This will close the shared site visit for the team.';

    Alert.alert('Complete visit?', message, [
      {
        text: 'Cancel',
        style: 'cancel',
      },
      {
        text: isOffline ? 'Queue Completion' : 'Complete Visit',
        onPress: () => {
          void handleCompleteVisit();
        },
      },
    ]);
  }

  async function handleLinkAsset(asset: Asset) {
    try {
      setError(null);
      setCompletionNotice(null);
      setLinkingAssetId(asset.id);

      const link = await api.linkSiteVisitAsset(token, visitId, asset.id);
      const linkedAsset = link.asset ?? asset;

      setAssets((currentAssets) => appendUniqueAsset(currentAssets, linkedAsset));
      setAvailableAssets((currentAssets) =>
        currentAssets.filter((currentAsset) => currentAsset.id !== asset.id),
      );
      setCompletionNotice(`${asset.assetCode} linked to this visit.`);
    } catch (linkError) {
      if (linkError instanceof ApiError && linkError.status === 401) {
        await handleUnauthorized(linkError);
        return;
      }

      if (isEndpointUnavailableError(linkError)) {
        setAssets((currentAssets) => appendUniqueAsset(currentAssets, asset));
        setAvailableAssets((currentAssets) =>
          currentAssets.filter((currentAsset) => currentAsset.id !== asset.id),
        );
        setCompletionNotice(`${asset.assetCode} added locally for this visit.`);
        return;
      }

      setError(linkError instanceof Error ? linkError.message : 'Unable to link asset to visit.');
    } finally {
      setLinkingAssetId(null);
    }
  }

  function handleOpenAssetDetail(asset: Asset) {
    navigation.navigate('AssetDetail', {
      visitId,
      substationId,
      assetId: asset.id,
      assetSnapshot: asset,
    });
  }

  return (
    <Screen
      title="Visit Detail"
      leftAction={{
        icon: 'back',
        onPress: () => navigation.goBack(),
        accessibilityLabel: 'Back',
      }}
      rightAction={{
        icon: 'refresh',
        onPress: () => loadVisitData(),
        accessibilityLabel: 'Refresh',
        disabled: isLoading,
      }}
    >
      <ErrorBanner message={error} />
      <WarningBanner
        message={
          isOffline
            ? 'Offline: inspections and completion stay in Sync Queue.'
            : null
        }
      />
      <SuccessBanner message={successMessage} />
      <SuccessBanner message={completionNotice} />
      {isLoading ? <LoadingBlock label="Loading visit and assets..." /> : null}

      {!isLoading && visit ? (
        <>
          <VisitProgressCard rollup={createVisitRollup(visit, assets)} />

          <Card>
            <SectionTitle>Visit</SectionTitle>
            <KeyValueRow
              label="Pencawang"
              value={`${visit.pencawangCode ?? visit.substation.code} - ${visit.pencawangName ?? visit.substation.name}`}
            />
            {visit.functionalLocation ? (
              <KeyValueRow label="Functional Location" value={visit.functionalLocation} />
            ) : null}
            {visit.mainhead ? <KeyValueRow label="MAINHEAD" value={visit.mainhead} /> : null}
            {visit.visitType ? <KeyValueRow label="Visit Type" value={formatVisitType(visit.visitType)} /> : null}
            <KeyValueRow label="Team" value={`${visit.team.code} - ${visit.team.name}`} />
            <KeyValueRow label="Started" value={formatDateTime(visit.startedAt)} />
            {visit.completedAt ? <KeyValueRow label="Completed" value={formatDateTime(visit.completedAt)} /> : null}
            {hasCheckInCoordinate(visit) ? <VisitGpsReadout visit={visit} /> : null}
            <StatusChip label={formatStatusLabel(visit.status)} tone={getVisitStatusTone(visit.status)} />
          </Card>

          <VisitAssetMap
            assets={assets}
            onOpenAsset={handleOpenAssetDetail}
            onOpenFullScreen={() =>
              navigation.navigate('VisitAssetMap', { visitId, substationId })
            }
          />

          <Card>
            <View style={styles.assetHeader}>
              <SectionTitle>Visit Assets</SectionTitle>
              <Pressable
                accessibilityRole="button"
                disabled={isVisitTerminal(visit.status)}
                onPress={() => navigation.navigate('AddAsset', { visitId, substationId })}
                style={({ pressed }) => [
                  styles.addAssetButton,
                  isVisitTerminal(visit.status) && styles.disabledButton,
                  pressed && !isVisitTerminal(visit.status) && styles.buttonPressed,
                ]}
              >
                <Text style={styles.addAssetButtonText}>+ Add</Text>
              </Pressable>
            </View>

            {assets.length === 0 ? (
              <EmptyState
                title="No assets found"
                description="Add or inspect an asset."
              />
            ) : (
              <>
                <View style={styles.assetList}>
                  {assets.slice(0, VISIBLE_ASSET_LIMIT).map((asset) => (
                    <AssetListRow
                      key={asset.id}
                      asset={asset}
                      visit={visit}
                      onPress={() => handleOpenAssetDetail(asset)}
                    />
                  ))}
                </View>
                {assets.length > VISIBLE_ASSET_LIMIT ? (
                  <View style={styles.viewAllAssetsWrap}>
                    <AppButton
                      label={`View All Assets (${assets.length})`}
                      variant="secondary"
                      onPress={() =>
                        navigation.navigate('VisitAssets', { visitId, substationId })
                      }
                    />
                  </View>
                ) : null}
              </>
            )}
          </Card>

          {availableAssets.length > 0 && !isVisitTerminal(visit.status) ? (
            <Card>
              <View style={styles.assetHeader}>
                <SectionTitle>Available Assets</SectionTitle>
                <Text style={styles.countText}>{availableAssets.length}</Text>
              </View>
              <View style={styles.assetList}>
                {availableAssets.map((asset) => (
                  <AssetListRow
                    key={asset.id}
                    asset={asset}
                    visit={visit}
                    rightLabel={linkingAssetId === asset.id ? 'Linking' : 'Link'}
                    disabled={linkingAssetId === asset.id}
                    onPress={() => {
                      void handleLinkAsset(asset);
                    }}
                  />
                ))}
              </View>
            </Card>
          ) : null}

          <ReassignTeamCard
            visit={visit}
            token={token}
            userRole={user?.role}
            onReassigned={loadVisitData}
          />

          <Card>
            <SectionTitle>Complete Visit</SectionTitle>
            <TextField
              label="Completion Notes"
              value={completionNotes}
              onChangeText={setCompletionNotes}
              placeholder="Add final notes for this visit"
              editable={!isVisitTerminal(visit.status) && !isCompletionQueued && !isCompleting}
              multiline
              autoCapitalize="characters"
            />
            <AppButton
              label={
                isCompletionQueued
                  ? 'Completion Queued'
                  : isVisitTerminal(visit.status)
                    ? 'Visit Completed'
                    : isCompleting
                      ? 'Completing Visit...'
                      : isOffline
                        ? 'Queue Visit Completion'
                        : 'Complete Visit'
              }
              variant={isVisitTerminal(visit.status) ? 'secondary' : 'primary'}
              onPress={handleConfirmCompleteVisit}
              loading={isCompleting}
              disabled={isVisitTerminal(visit.status) || isCompletionQueued || isCompleting}
            />
          </Card>

          <EditVisitDetailsCard
            visit={visit}
            token={token}
            userRole={user?.role}
            onUpdated={loadVisitData}
          />

          <DeleteVisitCard
            visit={visit}
            substationId={substationId}
            token={token}
            userRole={user?.role}
            onDeleted={() => navigation.goBack()}
          />
        </>
      ) : null}
    </Screen>
  );
}

function ReassignTeamCard({
  visit,
  token,
  userRole,
  onReassigned,
}: {
  visit: SiteVisit;
  token: string;
  userRole?: UserRole;
  onReassigned: () => void | Promise<void>;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [open, setOpen] = useState(false);
  const [teams, setTeams] = useState<
    Array<{
      id: string;
      name?: string | null;
      code?: string | null;
      organizationId?: string | null;
    }>
  >([]);
  const [teamsLoaded, setTeamsLoaded] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canReassign =
    userRole === 'ADMIN' || userRole === 'MANAGER' || userRole === 'SUPERVISOR';

  if (!canReassign || isVisitTerminal(visit.status)) {
    return null;
  }

  const currentTeamId = visit.team?.id ?? null;
  const currentLabel = visit.team?.name || visit.team?.code || 'Unassigned';
  // Only same-company teams are valid targets — derive the company from the
  // current team (the /teams list includes it) and filter to it.
  const currentTeam = teams.find((team) => team.id === currentTeamId);
  const options = teams.filter(
    (team) =>
      team.id !== currentTeamId &&
      (!currentTeam ||
        (team.organizationId ?? null) === (currentTeam.organizationId ?? null)),
  );
  const canSubmit = Boolean(selectedTeamId) && reason.trim().length > 0 && !submitting;

  const openForm = async () => {
    setOpen(true);
    setError(null);
    if (teamsLoaded) {
      return;
    }
    try {
      setTeams(await api.getAllTeams(token));
      setTeamsLoaded(true);
    } catch {
      setError('Unable to load the team list.');
    }
  };

  const submit = async () => {
    if (!selectedTeamId || reason.trim().length === 0 || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.reassignSiteVisit(token, visit.id, selectedTeamId, reason.trim());
      setOpen(false);
      setSelectedTeamId(null);
      setReason('');
      await onReassigned();
    } catch (reassignError) {
      if (reassignError instanceof ApiError && reassignError.status === 401) {
        setError('Your session expired — sign in again.');
      } else {
        setError(
          reassignError instanceof Error
            ? reassignError.message
            : 'Unable to reassign this visit.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <SectionTitle>Team Assignment</SectionTitle>
      <KeyValueRow label="Current team" value={currentLabel} />
      {error ? <ErrorBanner message={error} /> : null}
      {!open ? (
        <AppButton
          label="Reassign Team"
          variant="secondary"
          onPress={() => void openForm()}
        />
      ) : (
        <View style={styles.reassignForm}>
          <Text style={styles.reassignHint}>
            Hand this in-progress survey to another team — every inspection, photo and
            defect transfers.
          </Text>
          {!teamsLoaded ? (
            <Text style={styles.reassignHint}>Loading teams…</Text>
          ) : options.length === 0 ? (
            <Text style={styles.reassignHint}>No other team is available.</Text>
          ) : (
            options.map((team) => {
              const selected = team.id === selectedTeamId;
              return (
                <Pressable
                  key={team.id}
                  onPress={() => setSelectedTeamId(team.id)}
                  style={[styles.teamRow, selected && styles.teamRowSelected]}
                >
                  <Text style={[styles.teamRowText, selected && styles.teamRowTextSelected]}>
                    {team.name || team.code || team.id}
                  </Text>
                </Pressable>
              );
            })
          )}
          <TextField
            label="Reason"
            value={reason}
            onChangeText={setReason}
            placeholder="Why is this being reassigned?"
            multiline
          />
          <AppButton
            label={submitting ? 'Reassigning…' : 'Reassign'}
            onPress={() => void submit()}
            loading={submitting}
            disabled={!canSubmit}
          />
          <AppButton
            label="Cancel"
            variant="secondary"
            onPress={() => {
              setOpen(false);
              setError(null);
            }}
          />
        </View>
      )}
    </Card>
  );
}

/**
 * Inline "Edit Details" for a started visit — fix a wrong Pencawang label,
 * mainhead, functional location, notes, or GPS instead of recreating it. The
 * crew may edit while the visit is still open; a manager/admin may edit even
 * after it's submitted (the API enforces the precise lifecycle rule). GPS can be
 * re-captured live or corrected manually.
 */
function EditVisitDetailsCard({
  visit,
  token,
  userRole,
  onUpdated,
}: {
  visit: SiteVisit;
  token: string;
  userRole?: UserRole;
  onUpdated: () => void | Promise<void>;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mainhead, setMainhead] = useState(visit.mainhead ?? '');
  const [pencawangName, setPencawangName] = useState(visit.pencawangName ?? '');
  const [functionalLocation, setFunctionalLocation] = useState(
    visit.functionalLocation ?? '',
  );
  const [notes, setNotes] = useState(visit.notes ?? '');
  const [latitude, setLatitude] = useState(
    visit.checkInLatitude != null ? String(visit.checkInLatitude) : '',
  );
  const [longitude, setLongitude] = useState(
    visit.checkInLongitude != null ? String(visit.checkInLongitude) : '',
  );
  const [accuracy, setAccuracy] = useState<number | null>(
    visit.checkInAccuracyMeters ?? null,
  );
  const [locationChanged, setLocationChanged] = useState(false);

  const isManagerial = userRole === 'ADMIN' || userRole === 'MANAGER';
  const isCrew = userRole === 'TECHNICIAN' || userRole === 'SUPERVISOR';
  const canEdit = isManagerial || (isCrew && !isVisitTerminal(visit.status));
  if (!canEdit) {
    return null;
  }

  const recaptureLocation = async () => {
    setError(null);
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setError('Location permission is needed to capture GPS.');
        return;
      }
      const position = await getPositionWithTimeout({
        accuracy: Location.Accuracy.High,
      });
      if (!position) {
        setError('Could not get a GPS fix — try again or enter coordinates manually.');
        return;
      }
      setLatitude(String(position.coords.latitude));
      setLongitude(String(position.coords.longitude));
      setAccuracy(
        typeof position.coords.accuracy === 'number' &&
          Number.isFinite(position.coords.accuracy)
          ? position.coords.accuracy
          : null,
      );
      setLocationChanged(true);
    } finally {
      setLocating(false);
    }
  };

  const save = async () => {
    setError(null);

    const input: Parameters<typeof api.updateSiteVisit>[2] = {
      mainhead: mainhead.trim(),
      pencawangName: pencawangName.trim(),
      functionalLocation: functionalLocation.trim(),
      notes: notes.trim(),
    };

    if (locationChanged) {
      const lat = Number(latitude);
      const lng = Number(longitude);
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        setError('Enter a valid latitude (-90..90) and longitude (-180..180).');
        return;
      }
      input.checkInLatitude = lat;
      input.checkInLongitude = lng;
      input.checkInAccuracyMeters = accuracy;
      input.checkInCapturedAt = new Date().toISOString();
    }

    setSaving(true);
    try {
      await api.updateSiteVisit(token, visit.id, input);
      setOpen(false);
      setLocationChanged(false);
      await onUpdated();
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 401) {
        setError('Your session expired — sign in again.');
      } else {
        setError(
          saveError instanceof Error ? saveError.message : 'Unable to save changes.',
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <SectionTitle>Edit Details</SectionTitle>
      {!open ? (
        <>
          <Text style={styles.reassignHint}>
            Fix a wrong Pencawang name, mainhead, location, or notes without recreating
            the visit.
          </Text>
          <AppButton
            label="Edit Visit Details"
            variant="secondary"
            onPress={() => setOpen(true)}
          />
        </>
      ) : (
        <View style={styles.reassignForm}>
          {error ? <ErrorBanner message={error} /> : null}
          <TextField
            label="Mainhead"
            value={mainhead}
            onChangeText={setMainhead}
            autoCapitalize="characters"
          />
          <TextField
            label="Pencawang Name"
            value={pencawangName}
            onChangeText={setPencawangName}
            autoCapitalize="characters"
          />
          <TextField
            label="Functional Location"
            value={functionalLocation}
            onChangeText={setFunctionalLocation}
            autoCapitalize="characters"
          />
          <TextField label="Notes" value={notes} onChangeText={setNotes} multiline />
          <Text style={styles.reassignHint}>
            Location{accuracy != null ? ` (±${Math.round(accuracy)}m)` : ''} — re-capture
            live or correct manually.
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <TextField
                label="Latitude"
                value={latitude}
                onChangeText={(value) => {
                  setLatitude(value);
                  setLocationChanged(true);
                }}
                keyboardType="numbers-and-punctuation"
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextField
                label="Longitude"
                value={longitude}
                onChangeText={(value) => {
                  setLongitude(value);
                  setLocationChanged(true);
                }}
                keyboardType="numbers-and-punctuation"
              />
            </View>
          </View>
          <AppButton
            label={locating ? 'Locating…' : 'Use My Current Location'}
            variant="secondary"
            onPress={() => void recaptureLocation()}
            loading={locating}
            disabled={locating || saving}
          />
          <AppButton
            label={saving ? 'Saving…' : 'Save Changes'}
            onPress={() => void save()}
            loading={saving}
            disabled={saving}
          />
          <AppButton
            label="Cancel"
            variant="secondary"
            onPress={() => {
              setOpen(false);
              setError(null);
            }}
          />
        </View>
      )}
    </Card>
  );
}

/**
 * Manager/Admin "Danger Zone": irreversibly hard-delete demo / mistaken data —
 * this Site Visit (cascading its inspections + the poles it created), or the
 * whole Pencawang (every visit + pole + feeder under it). Both preview first and
 * require an explicit destructive confirm; the server scopes a MANAGER to their
 * own company and logs every delete.
 */
function DeleteVisitCard({
  visit,
  substationId,
  token,
  userRole,
  onDeleted,
}: {
  visit: SiteVisit;
  substationId?: string;
  token: string;
  userRole?: UserRole;
  onDeleted: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = userRole === 'ADMIN' || userRole === 'MANAGER';
  if (!canDelete) {
    return null;
  }

  const pencawangId = substationId ?? visit.substation?.id ?? null;

  const runDeleteVisit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteSiteVisit(token, visit.id);
      onDeleted();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Unable to delete this visit.');
    }
  };

  const confirmDeleteVisit = async () => {
    setError(null);
    setBusy(true);
    try {
      const preview = await api.previewDeleteSiteVisit(token, visit.id);
      setBusy(false);
      Alert.alert(
        'Delete this visit?',
        'This permanently removes the survey and everything captured in it:\n\n' +
          `• ${preview.inspections} inspection(s)\n` +
          `• ${preview.assetsToDelete} pole(s) created here` +
          (preview.sharedAssetsKept > 0
            ? `\n\n${preview.sharedAssetsKept} pole(s) shared with another survey are kept.`
            : '') +
          '\n\nThis cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => void runDeleteVisit() },
        ],
      );
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Unable to preview the delete.');
    }
  };

  const runDeletePencawang = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.deletePencawangCascade(token, id);
      onDeleted();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Unable to delete this Pencawang.');
    }
  };

  const confirmDeletePencawang = async () => {
    if (!pencawangId) {
      setError('This visit has no linked Pencawang to delete.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const preview = await api.previewDeletePencawang(token, pencawangId);
      setBusy(false);
      if (preview.blocked) {
        Alert.alert('Cannot delete this Pencawang', preview.blocked);
        return;
      }
      Alert.alert(
        `Delete the whole Pencawang "${preview.pencawang ?? ''}"?`,
        'This permanently removes EVERYTHING under this Pencawang:\n\n' +
          `• ${preview.siteVisits} site visit(s)\n` +
          `• ${preview.assets} pole(s)\n` +
          `• ${preview.feeders} feeder(s)\n\n` +
          'This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete Everything',
            style: 'destructive',
            onPress: () => void runDeletePencawang(pencawangId),
          },
        ],
      );
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Unable to preview the delete.');
    }
  };

  return (
    <Card>
      <SectionTitle>Danger Zone</SectionTitle>
      <Text style={styles.reassignHint}>
        Permanently remove demo or mistaken data. Irreversible, and every delete is logged.
      </Text>
      {error ? <ErrorBanner message={error} /> : null}
      <AppButton
        label={busy ? 'Working…' : 'Delete This Visit'}
        variant="danger"
        onPress={() => void confirmDeleteVisit()}
        loading={busy}
        disabled={busy}
      />
      {pencawangId ? (
        <AppButton
          label="Delete Entire Pencawang…"
          variant="danger"
          onPress={() => void confirmDeletePencawang()}
          disabled={busy}
        />
      ) : null}
    </Card>
  );
}

function VisitProgressCard({ rollup }: { rollup: SiteVisitSummary }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Card>
      <View style={styles.progressHeader}>
        <View style={styles.progressTitleWrap}>
          <SectionTitle>Visit Progress</SectionTitle>
          <Text style={styles.progressSubtitle}>
            {rollup.inspectedAssets}/{rollup.totalAssets} inspected
          </Text>
        </View>
        <Text style={styles.progressPercent}>{rollup.completionPercentage}%</Text>
      </View>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.min(Math.max(rollup.completionPercentage, 0), 100)}%` },
          ]}
        />
      </View>
      <View style={styles.progressStats}>
        <ProgressStat label="Pending" value={rollup.pendingAssets} />
        <ProgressStat label="Done" value={rollup.inspectedAssets} />
        <ProgressStat label="Defects" value={rollup.defectsFound} />
      </View>
    </Card>
  );
}

function ProgressStat({ label, value }: { label: string; value: number }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.progressStat}>
      <Text style={styles.progressStatValue}>{value}</Text>
      <Text style={styles.progressStatLabel}>{label}</Text>
    </View>
  );
}

function VisitAssetMap({
  assets,
  onOpenAsset,
  onOpenFullScreen,
}: {
  assets: Asset[];
  onOpenAsset: (asset: Asset) => void;
  onOpenFullScreen: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const mappedAssets = assets
    .map((asset) => {
      const coordinate = getAssetCoordinate(asset);

      return coordinate ? { asset, coordinate } : null;
    })
    .filter(isMappedAsset);
  const region = createRegion(mappedAssets.map((item) => item.coordinate));

  return (
    <Card>
      <View style={styles.mapHeader}>
        <SectionTitle>Map</SectionTitle>
        <Pressable
          accessibilityRole="button"
          onPress={onOpenFullScreen}
          style={({ pressed }) => [styles.fullScreenButton, pressed && styles.buttonPressed]}
        >
          <Text style={styles.fullScreenButtonText}>Full Map</Text>
        </Pressable>
      </View>

      {mappedAssets.length === 0 ? (
        <EmptyState
          title="No mapped assets"
          description="GPS assets appear here."
        />
      ) : (
        <View style={styles.mapFrame}>
          <MapView
            provider={PROVIDER_GOOGLE}
            mapType="satellite"
            style={styles.map}
            initialRegion={region}
            region={region}
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            toolbarEnabled={false}
          >
            {mappedAssets.map(({ asset, coordinate }) => (
              <Marker
                key={asset.id}
                coordinate={coordinate}
                title={asset.assetCode}
                description={asset.name ?? asset.assetType.name}
                pinColor={theme.colors.primary}
                onPress={() => onOpenAsset(asset)}
              />
            ))}
          </MapView>
        </View>
      )}
    </Card>
  );
}

function AssetListRow({
  asset,
  visit,
  rightLabel = '>',
  disabled = false,
  onPress,
}: {
  asset: Asset;
  visit: SiteVisit;
  rightLabel?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const thumbnailUri = getAssetThumbnailUri(asset, visit);
  const { title, subtitle } = getAssetRowLabels(asset);

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.assetRow,
        asset.status === 'NOT_FOUND' && styles.assetRowMuted,
        disabled && styles.assetRowDisabled,
        pressed && !disabled && styles.assetRowPressed,
      ]}
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

      <View style={styles.assetTextWrap}>
        <Text style={styles.assetName} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.assetMeta} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <Text style={rightLabel === '>' ? styles.rowArrow : styles.rowActionLabel}>
        {rightLabel}
      </Text>
    </Pressable>
  );
}

function VisitGpsReadout({ visit }: { visit: SiteVisit }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.gpsPanel}>
      <Text style={styles.gpsValue} numberOfLines={1}>
        Lat {formatOptionalCoordinate(visit.checkInLatitude)} · Lng {formatOptionalCoordinate(visit.checkInLongitude)}
      </Text>
      {visit.checkInAccuracyMeters !== null && visit.checkInAccuracyMeters !== undefined ? (
        <Text style={styles.gpsAccuracy}>GPS ±{Math.round(visit.checkInAccuracyMeters)}m</Text>
      ) : null}
    </View>
  );
}

async function loadVisitScopedAssets(
  token: string,
  visitId: string,
  fallbackAssets: Asset[],
) {
  try {
    const { value } = await cachedFetch('site-visit-assets', visitId, () =>
      api.getSiteVisitAssets(token, visitId),
    );

    return value;
  } catch (error) {
    // Missing endpoint OR unreachable server (offline, status 0) with no cache:
    // fall back to the substation asset list (itself cached upstream).
    if (isEndpointUnavailableError(error) || (error instanceof ApiError && error.status === 0)) {
      return fallbackAssets;
    }

    throw error;
  }
}

function createAvailableAssetList(substationAssets: Asset[], visitAssets: Asset[]) {
  const visitAssetIds = new Set(visitAssets.map((asset) => asset.id));

  return substationAssets.filter((asset) => !visitAssetIds.has(asset.id));
}

function appendUniqueAsset(assets: Asset[], asset: Asset) {
  if (assets.some((currentAsset) => currentAsset.id === asset.id)) {
    return assets;
  }

  return [...assets, asset];
}

function getQueuedInspectionCount(snapshot: SyncQueueSnapshot, siteVisitId: string) {
  return snapshot.items.filter((item) => item.summary.siteVisitId === siteVisitId).length;
}

function getAssetThumbnailUri(asset: Asset, visit: SiteVisit) {
  const image = getFirstAssetImage(asset, visit);

  return image ? getImageSourceUri(image) : null;
}

function getFirstAssetImage(asset: Asset, visit: SiteVisit): ThumbnailImage | null {
  const flexibleAsset = asset as AssetWithOptionalDisplayData;
  const assetImage =
    flexibleAsset.images?.[0] ??
    flexibleAsset.latestInspection?.images?.[0] ??
    flexibleAsset.inspectionImages?.[0];

  if (assetImage) {
    return assetImage;
  }

  for (const inspection of visit.inspections ?? []) {
    if (inspection.assetId !== asset.id) {
      continue;
    }

    const inspectionImage = inspection.inspectionImages?.[0] ?? inspection.images?.[0];

    if (inspectionImage) {
      return inspectionImage;
    }
  }

  return null;
}

function getImageSourceUri(image: ThumbnailImage) {
  const source = image.uri || image.url || image.path;

  if (!source) {
    return null;
  }

  if (/^[a-z][a-z\d+\-.]*:/i.test(source)) {
    return source;
  }

  return source.startsWith('/') ? `${API_ORIGIN}${source}` : `${API_ORIGIN}/${source}`;
}

function createVisitRollup(visit: SiteVisit, assets: Asset[]): SiteVisitSummary {
  const totalAssets =
    getNumericRollupValue(visit.summary?.totalAssets, visit.totalAssets) ?? assets.length;
  const inspectedAssets =
    getNumericRollupValue(visit.summary?.inspectedAssets, visit.inspectedAssets) ??
    getSubmittedInspectionAssetIds(visit).size;
  const pendingAssets =
    getNumericRollupValue(visit.summary?.pendingAssets, visit.pendingAssets) ??
    Math.max(totalAssets - inspectedAssets, 0);
  const defectsFound = getNumericRollupValue(visit.summary?.defectsFound, visit.defectsFound) ?? 0;
  const completionPercentage =
    getNumericRollupValue(visit.summary?.completionPercentage, visit.completionPercentage) ??
    (totalAssets === 0 ? 0 : Math.round((inspectedAssets / totalAssets) * 100));

  return {
    totalAssets,
    inspectedAssets,
    pendingAssets,
    defectsFound,
    completionPercentage,
  };
}

function getNumericRollupValue(...values: Array<number | undefined>) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

function formatStatusLabel(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatVisitType(value: string) {
  if (value === 'SPECIAL') {
    return 'Emergency';
  }

  return formatStatusLabel(value);
}

function hasCheckInCoordinate(visit: SiteVisit) {
  return (
    typeof visit.checkInLatitude === 'number' &&
    typeof visit.checkInLongitude === 'number' &&
    Number.isFinite(visit.checkInLatitude) &&
    Number.isFinite(visit.checkInLongitude)
  );
}

function formatOptionalCoordinate(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(6) : 'Not available';
}

function getVisitStatusTone(status: string) {
  if (status === 'COMPLETED') {
    return 'success';
  }

  if (status === 'CANCELLED') {
    return 'warning';
  }

  return 'success';
}

function isVisitTerminal(status: string) {
  return status === 'COMPLETED' || status === 'CANCELLED';
}

function getAssetCoordinate(asset: Asset) {
  return createCoordinate(asset.latitude, asset.longitude);
}

function createCoordinate(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
) {
  if (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
  ) {
    return {
      latitude,
      longitude,
    };
  }

  return null;
}

function createRegion(coordinates: Coordinate[]): Region {
  if (coordinates.length === 0) {
    return DEFAULT_REGION;
  }

  if (coordinates.length === 1) {
    return {
      latitude: coordinates[0].latitude,
      longitude: coordinates[0].longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }

  const latitudes = coordinates.map((coordinate) => coordinate.latitude);
  const longitudes = coordinates.map((coordinate) => coordinate.longitude);
  const minimumLatitude = Math.min(...latitudes);
  const maximumLatitude = Math.max(...latitudes);
  const minimumLongitude = Math.min(...longitudes);
  const maximumLongitude = Math.max(...longitudes);

  return {
    latitude: (minimumLatitude + maximumLatitude) / 2,
    longitude: (minimumLongitude + maximumLongitude) / 2,
    latitudeDelta: Math.max((maximumLatitude - minimumLatitude) * 1.6, 0.01),
    longitudeDelta: Math.max((maximumLongitude - minimumLongitude) * 1.6, 0.01),
  };
}

function isMappedAsset(
  value: { asset: Asset; coordinate: Coordinate } | null,
): value is { asset: Asset; coordinate: Coordinate } {
  return value !== null;
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    progressHeader: {
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
    },
    progressTitleWrap: {
      flex: 1,
      gap: 3,
    },
    progressSubtitle: {
      color: t.colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
    },
    progressPercent: {
      minWidth: 52,
      color: t.colors.textPrimary,
      fontSize: 22,
      lineHeight: 28,
      fontWeight: '800',
      textAlign: 'right',
    },
    progressTrack: {
      height: 8,
      borderRadius: 4,
      overflow: 'hidden',
      backgroundColor: t.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    progressFill: {
      height: '100%',
      borderRadius: 5,
      backgroundColor: t.colors.success,
    },
    progressStats: {
      flexDirection: 'row',
      gap: 8,
    },
    progressStat: {
      flex: 1,
      minHeight: 52,
      borderRadius: t.radius.card,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surfaceMuted,
      justifyContent: 'center',
      paddingHorizontal: 10,
      gap: 2,
    },
    progressStatValue: {
      color: t.colors.textPrimary,
      fontSize: 16,
      lineHeight: 21,
      fontWeight: '800',
    },
    progressStatLabel: {
      color: t.colors.textSecondary,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: '700',
      textTransform: 'uppercase',
    },
    mapHeader: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    fullScreenButton: {
      minHeight: 38,
      borderRadius: t.radius.card,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.colors.card,
      borderWidth: 1,
      borderColor: t.colors.border,
      paddingHorizontal: 12,
    },
    fullScreenButtonText: {
      color: t.colors.textPrimary,
      fontSize: 13,
      fontWeight: '700',
    },
    mapFrame: {
      height: 180,
      borderRadius: t.radius.card,
      overflow: 'hidden',
      backgroundColor: t.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    map: {
      flex: 1,
    },
    assetHeader: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
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
    addAssetButton: {
      minHeight: 38,
      borderRadius: t.radius.card,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.colors.primary,
      paddingHorizontal: 14,
    },
    addAssetButtonText: {
      color: t.colors.textOnPrimary,
      fontSize: 14,
      fontWeight: '700',
    },
    assetList: {
      gap: 8,
    },
    viewAllAssetsWrap: {
      marginTop: t.spacing.section,
    },
    assetRow: {
      minHeight: 66,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: t.radius.card,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
      padding: 8,
    },
    assetRowMuted: {
      opacity: 0.56,
    },
    assetRowDisabled: {
      opacity: 0.68,
    },
    assetRowPressed: {
      backgroundColor: t.colors.surfacePressed,
      transform: [{ scale: 0.995 }],
    },
    thumbnailFrame: {
      width: 48,
      height: 48,
      borderRadius: t.radius.card,
      overflow: 'hidden',
      backgroundColor: t.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: t.colors.border,
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
      color: t.colors.textSecondary,
      fontSize: 11,
      lineHeight: 14,
      fontWeight: '600',
      textAlign: 'center',
    },
    assetTextWrap: {
      flex: 1,
      gap: 2,
    },
    assetName: {
      color: t.colors.textPrimary,
      fontSize: 14,
      lineHeight: 19,
      fontWeight: '700',
    },
    assetMeta: {
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '500',
    },
    gpsPanel: {
      borderRadius: t.radius.card,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surfaceMuted,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 2,
    },
    gpsValue: {
      color: t.colors.textPrimary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
    },
    gpsAccuracy: {
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '600',
    },
    rowArrow: {
      width: 18,
      color: t.colors.textMuted,
      fontSize: 20,
      fontWeight: '700',
      textAlign: 'right',
    },
    rowActionLabel: {
      minWidth: 54,
      color: t.colors.textPrimary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '800',
      textAlign: 'right',
    },
    disabledButton: {
      opacity: 0.54,
    },
    buttonPressed: {
      opacity: 0.82,
    },
    reassignForm: {
      gap: 10,
    },
    reassignHint: {
      color: t.colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
    },
    teamRow: {
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    teamRowSelected: {
      borderColor: t.colors.primary,
      backgroundColor: t.colors.primarySoft,
    },
    teamRowText: {
      color: t.colors.textPrimary,
      fontSize: 14,
      fontWeight: '700',
    },
    teamRowTextSelected: {
      color: t.colors.primaryStrong,
    },
  });
