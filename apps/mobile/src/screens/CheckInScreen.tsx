import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { captureWithCamera } from '../camera/captureWithCamera';
import * as Location from 'expo-location';
import {
  Alert,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Mapbox from '@rnmapbox/maps';
import { SATELLITE_STYLE } from '../mapbox';
import { useNavigation } from '@react-navigation/native';
import { api, ApiError, isEndpointUnavailableError } from '../api';
import { cachedFetch, prependToCachedArray, writeCache } from '../offlineCache';
import {
  enqueueMutation,
  isTempId,
  mintTempId,
  persistOfflineSiteVisitPhoto,
} from '../syncQueue';
import { MapCrosshair } from '../components/MapCrosshair';
import { getPositionWithTimeout } from '../location';
import { useSession } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { useCapabilities } from '../useCapabilities';
import type { RootStackScreenProps } from '../navigation/types';
import {
  AppButton,
  BodyText,
  BottomCTA,
  Card,
  Dropdown,
  EmptyState,
  ErrorBanner,
  InlineButton,
  LoadingBlock,
  Mono,
  Screen,
  SectionTitle,
  SelectCard,
  TextField,
} from '../ui';
import { Theme, useTheme } from '../theme';
import { Mainhead, SiteVisit, SiteVisitType, Substation, Team } from '../types';
import { normalizeOperationalPayloadText, normalizeOperationalText } from '../utils';

type CapturedSitePhoto = {
  id: string;
  uri: string;
  timestamp: string;
};

type PencawangMode = 'EXISTING' | 'NEW';

type Coordinate = {
  latitude: number;
  longitude: number;
};

type MapPickerState = {
  coordinate: Coordinate;
  accuracyMeters: number | null;
};

type CreateSiteVisitInput = Parameters<typeof api.createSiteVisit>[1];

type VisitTypeOption = {
  label: string;
  value: SiteVisitType;
  description: string;
};

const VISIT_TYPE_OPTIONS: VisitTypeOption[] = [
  {
    label: 'Discovery',
    value: 'DISCOVERY',
    description: 'First visit or new site verification.',
  },
  {
    label: 'Reinspection',
    value: 'REINSPECTION',
    description: 'Follow-up visit after previous findings.',
  },
  {
    label: 'Audit',
    value: 'AUDIT',
    description: 'Quality or compliance check.',
  },
  {
    label: 'Emergency',
    value: 'SPECIAL',
    description: 'Urgent field response using the existing backend visit type.',
  },
];

const DEFAULT_MAP_PICKER_COORDINATE: Coordinate = {
  latitude: 3.139,
  longitude: 101.6869,
};

const MAP_PICKER_ZOOM = 15;

export function CheckInScreen() {
  const navigation = useNavigation<RootStackScreenProps<'CheckIn'>['navigation']>();
  const { token, user, handleUnauthorized } = useSession();
  const { isOffline } = useSync();
  // Starting a site visit is an inspection-scope action; block maintenance-only
  // accounts even if some navigation path reaches this screen (defense in depth —
  // the Home "+" entry is already hidden for them).
  const { canInspect, loading: capabilitiesLoading } = useCapabilities();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  function goToVisit(visit: SiteVisit) {
    navigation.replace('VisitDetail', {
      visitId: visit.id,
      substationId: visit.substationId,
    });
  }

  const [teams, setTeams] = useState<Team[]>([]);
  // True only after the options (teams etc.) actually loaded from the server, so
  // an offline/failed load isn't mistaken for "you have no team".
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [substations, setSubstations] = useState<Substation[]>([]);
  const [mainheads, setMainheads] = useState<Mainhead[]>([]);
  const [activeVisits, setActiveVisits] = useState<SiteVisit[]>([]);
  const [pencawangMode, setPencawangMode] = useState<PencawangMode>('NEW');
  // SAVT = a high-voltage line surveyed as a ROUTE from one Pencawang to another.
  // SAVR (the default) is the pole-centric single-Pencawang survey.
  const [operationalScope, setOperationalScope] = useState<'SAVR' | 'SAVT'>('SAVR');
  const isSavt = operationalScope === 'SAVT';
  const [toPencawangId, setToPencawangId] = useState<string>('');
  // The route's destination Pencawang can be picked from master data (EXISTING)
  // or entered fresh (NEW) when it isn't in the system yet — mirrors the From.
  const [toPencawangMode, setToPencawangMode] = useState<PencawangMode>('EXISTING');
  const [toPencawangName, setToPencawangName] = useState('');
  const [toPencawangCode, setToPencawangCode] = useState('');
  const [routeCode, setRouteCode] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [selectedSubstationId, setSelectedSubstationId] = useState<string>('');
  const [visitType, setVisitType] = useState<SiteVisitType>('DISCOVERY');
  const [pencawangName, setPencawangName] = useState('');
  const [functionalLocation, setFunctionalLocation] = useState('');
  const [pencawangCode, setPencawangCode] = useState('');
  const [selectedMainheadId, setSelectedMainheadId] = useState('');
  const [checkInLatitude, setCheckInLatitude] = useState('');
  const [checkInLongitude, setCheckInLongitude] = useState('');
  const [gpsAccuracyMeters, setGpsAccuracyMeters] = useState<number | null>(null);
  const [checkInCapturedAt, setCheckInCapturedAt] = useState<string | null>(null);
  const [mapPickerState, setMapPickerState] = useState<MapPickerState | null>(null);
  const [sitePhotos, setSitePhotos] = useState<CapturedSitePhoto[]>([]);
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isOpeningMapPicker, setIsOpeningMapPicker] = useState(false);
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const [hasLocationPermission, setHasLocationPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mirror the live check-in coordinate so the background GPS prefill can read
  // the CURRENT value (not a stale closure) and skip overwriting a coordinate
  // the user typed/picked while GPS was still resolving.
  const checkInCoordRef = useRef({ lat: '', lng: '' });
  useEffect(() => {
    checkInCoordRef.current = { lat: checkInLatitude, lng: checkInLongitude };
  }, [checkInLatitude, checkInLongitude]);

  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) ?? null,
    [selectedTeamId, teams],
  );

  const selectedMainhead = useMemo(
    () => mainheads.find((mainhead) => mainhead.id === selectedMainheadId) ?? null,
    [mainheads, selectedMainheadId],
  );

  const selectedSubstation = useMemo(
    () =>
      pencawangMode === 'EXISTING'
        ? substations.find((substation) => substation.id === selectedSubstationId) ?? null
        : null,
    [pencawangMode, selectedSubstationId, substations],
  );

  const selectedActiveVisit = useMemo(
    () =>
      pencawangMode === 'EXISTING'
        ? activeVisits.find(
            (visit) =>
              visit.substationId === selectedSubstationId && isActiveVisitStatus(visit.status),
          ) ?? null
        : null,
    [activeVisits, pencawangMode, selectedSubstationId],
  );

  useEffect(() => {
    setSelectedMainheadId((currentValue) => {
      if (mainheads.some((mainhead) => mainhead.id === currentValue)) {
        return currentValue;
      }

      const teamMainhead = selectedTeam?.mainheadId
        ? mainheads.find((mainhead) => mainhead.id === selectedTeam.mainheadId)
        : null;
      const teamBranchMainhead = selectedTeam?.branchId
        ? mainheads.find((mainhead) => mainhead.branchId === selectedTeam.branchId)
        : null;

      return teamMainhead?.id ?? teamBranchMainhead?.id ?? mainheads[0]?.id ?? '';
    });
  }, [mainheads, selectedTeam]);

  const canCreateCheckIn =
    Boolean(selectedTeamId) &&
    Boolean(selectedMainheadId) &&
    !isLoading &&
    (pencawangMode === 'EXISTING'
      ? Boolean(selectedSubstationId)
      : Boolean(
          pencawangName.trim() &&
            functionalLocation.trim() &&
            pencawangCode.trim() &&
            checkInLatitude.trim() &&
            checkInLongitude.trim(),
        ) && gpsAccuracyMeters !== null);

  // Offline, only an EXISTING Pencawang can be started (a new one needs the
  // server to mint it — see startVisitOffline). Proactively block + hint in NEW
  // mode when clearly offline; the weak-signal case is caught in createVisit.
  const offlineNewPencawangBlocked = isOffline && pencawangMode === 'NEW';

  const loadOptions = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);
      setOptionsLoaded(false);

      // Cache the reference data so the Check-In pickers populate OFFLINE (a crew
      // that opened the app online at the depot has these warmed). optionsLoaded
      // becomes true whether the data is fresh or from cache, so an offline load
      // that DOES have cache shows the pickers, while offline-with-no-cache throws
      // (below) and shows the "you appear to be offline" cards.
      const [teamList, substationList, mainheadList, activeVisitList] = await Promise.all([
        cachedFetch('teams', undefined, () => api.getTeams(token)).then((r) => r.value),
        cachedFetch('substations', undefined, () => api.getSubstations(token)).then((r) => r.value),
        cachedFetch('mainheads', undefined, () => api.getMainheads(token)).then((r) => r.value),
        loadActiveVisitsForWarning(token),
      ]);

      setTeams(teamList);
      setSubstations(substationList);
      setMainheads(mainheadList);
      setActiveVisits(activeVisitList);
      setOptionsLoaded(true);

      if (teamList.length > 0) {
        setSelectedTeamId((currentValue) =>
          teamList.some((team) => team.id === currentValue) ? currentValue : teamList[0].id,
        );
      } else {
        setSelectedTeamId('');
      }

      if (pencawangMode === 'EXISTING' && substationList.length > 0) {
        setSelectedSubstationId((currentValue) =>
          substationList.some((substation) => substation.id === currentValue)
            ? currentValue
            : substationList[0].id,
        );
      } else if (pencawangMode === 'NEW' || substationList.length === 0) {
        setSelectedSubstationId('');
      }

      // GPS must NOT block the screen load — a cold/indoor Android fix can take
      // tens of seconds and previously left this stuck on "Loading teams,
      // MAINHEADs, pencawang, and GPS...". Fire it in the background; the lists
      // and form become usable immediately and isLoading clears now.
      void prefillCurrentLocation();
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        await handleUnauthorized(loadError);
        return;
      }

      setError(loadError instanceof Error ? loadError.message : 'Unable to load check-in options.');
    } finally {
      setIsLoading(false);
    }
  }, [handleUnauthorized, pencawangMode, token]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    if (!selectedSubstation) {
      return;
    }

    setPencawangName(normalizeOperationalText(selectedSubstation.name));
    setPencawangCode(normalizeOperationalText(selectedSubstation.code));
    setFunctionalLocation(normalizeOperationalText(selectedSubstation.location ?? selectedSubstation.code));
  }, [selectedSubstation]);

  function handleSelectPencawangMode(nextMode: PencawangMode) {
    setPencawangMode(nextMode);
    setError(null);

    if (nextMode === 'NEW') {
      setSelectedSubstationId('');
      setPencawangName('');
      setPencawangCode('');
      setFunctionalLocation('');
      return;
    }

    const nextSubstation = substations[0];

    if (nextSubstation) {
      applyExistingSubstation(nextSubstation);
    }
  }

  function applyExistingSubstation(substation: Substation) {
    setSelectedSubstationId(substation.id);
    setPencawangName(normalizeOperationalText(substation.name));
    setPencawangCode(normalizeOperationalText(substation.code));
    setFunctionalLocation(normalizeOperationalText(substation.location ?? substation.code));
  }

  async function prefillCurrentLocation() {
    try {
      const permission = await Location.getForegroundPermissionsAsync();

      setHasLocationPermission(permission.granted);

      if (!permission.granted) {
        return;
      }

      setIsLocating(true);
      const position = await getPositionWithTimeout({
        accuracy: Location.Accuracy.Balanced,
      });

      // Skip if GPS timed out, or the user already typed/picked a coordinate
      // while this background fix was resolving (read live value via the ref).
      if (
        !position ||
        checkInCoordRef.current.lat.trim() ||
        checkInCoordRef.current.lng.trim()
      ) {
        return;
      }

      applyCheckInLocation(position);
    } catch {
      // Passive check-in GPS should not block field users from starting a visit.
    } finally {
      setIsLocating(false);
    }
  }

  async function handleUseCurrentGps() {
    try {
      setError(null);
      setIsLocating(true);

      const permission = await Location.requestForegroundPermissionsAsync();
      setHasLocationPermission(permission.granted);

      if (!permission.granted) {
        setError('Location permission was not granted. You can still enter GPS coordinates manually.');
        return;
      }

      const position = await getPositionWithTimeout({
        accuracy: Location.Accuracy.Balanced,
      });

      if (!position) {
        setError('Could not get a GPS fix. Move to open sky or enter the coordinates manually.');
        return;
      }

      applyCheckInLocation(position);
    } catch (locationError) {
      setError(locationError instanceof Error ? locationError.message : 'Unable to read the current GPS location.');
    } finally {
      setIsLocating(false);
    }
  }

  async function handleOpenMapPicker() {
    try {
      setError(null);
      setIsOpeningMapPicker(true);

      const currentLocation = await getCurrentLocationForMapPicker();
      const formCoordinate = parseFormCoordinate(checkInLatitude, checkInLongitude);
      const coordinate = currentLocation?.coordinate ?? formCoordinate ?? DEFAULT_MAP_PICKER_COORDINATE;

      setMapPickerState({
        coordinate,
        accuracyMeters: currentLocation?.accuracyMeters ?? null,
      });
    } catch (mapError) {
      setError(mapError instanceof Error ? mapError.message : 'Unable to open the map picker.');
    } finally {
      setIsOpeningMapPicker(false);
    }
  }

  function handleConfirmMapCoordinate(params: {
    coordinate: Coordinate;
    accuracyMeters: number | null;
  }) {
    setCheckInLatitude(formatCoordinate(params.coordinate.latitude));
    setCheckInLongitude(formatCoordinate(params.coordinate.longitude));
    setGpsAccuracyMeters(params.accuracyMeters);
    setCheckInCapturedAt(new Date().toISOString());
    setMapPickerState(null);
  }

  async function getCurrentLocationForMapPicker() {
    const permission = await Location.requestForegroundPermissionsAsync();

    setHasLocationPermission(permission.granted);

    if (!permission.granted) {
      return null;
    }

    const position = await getPositionWithTimeout({
      accuracy: Location.Accuracy.High,
    });

    if (!position) {
      return null;
    }

    return {
      coordinate: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      },
      accuracyMeters:
        typeof position.coords.accuracy === 'number' && Number.isFinite(position.coords.accuracy)
          ? position.coords.accuracy
          : null,
    };
  }

  async function handleTakeSitePhoto() {
    try {
      setError(null);
      setIsCapturingPhoto(true);

      const capturedAsset = await captureWithCamera({ mode: 'photo' });

      if (!capturedAsset) {
        return;
      }

      const timestamp = new Date().toISOString();

      setSitePhotos((currentPhotos) => [
        ...currentPhotos,
        {
          id: `${timestamp}-${currentPhotos.length + 1}`,
          uri: capturedAsset.uri,
          timestamp,
        },
      ]);
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : 'Unable to capture site photo.');
    } finally {
      setIsCapturingPhoto(false);
    }
  }

  function handleCreateVisit() {
    const payload = buildCreateVisitPayload();

    if (!payload) {
      return;
    }

    if (selectedActiveVisit) {
      Alert.alert(
        'Active visit exists',
        `${formatVisitPencawang(selectedActiveVisit)} already has an active visit. Open it or continue with a separate new check-in.`,
        [
          {
            text: 'Open Existing Visit',
            onPress: () => {
              void handleOpenExistingVisit(selectedActiveVisit);
            },
          },
          {
            text: 'Continue New Check-In',
            onPress: () => {
              void createVisit(payload);
            },
          },
        ],
      );
      return;
    }

    void createVisit(payload);
  }

  async function handleOpenExistingVisit(visit: SiteVisit) {
    // A temp (offline-created) visit exists only locally — open it straight from
    // cache; never call join with its non-UUID id (the server would 400).
    if (isTempId(visit.id)) {
      goToVisit(visit);
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const joinedVisit = await api.joinSiteVisit(token, visit.id);
      goToVisit(joinedVisit);
    } catch (openError) {
      if (openError instanceof ApiError && openError.status === 401) {
        await handleUnauthorized(openError);
        return;
      }

      if (isEndpointUnavailableError(openError)) {
        goToVisit(visit);
        return;
      }

      setError(openError instanceof Error ? openError.message : 'Unable to open this active visit.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function buildCreateVisitPayload(): CreateSiteVisitInput | null {
    const normalizedPencawangName = normalizeOperationalPayloadText(pencawangName);
    const normalizedPencawangCode = normalizeOperationalPayloadText(pencawangCode);
    const normalizedFunctionalLocation = normalizeOperationalPayloadText(functionalLocation);
    const normalizedNotes = normalizeOperationalPayloadText(notes);
    const parsedLatitude = parseCoordinate(checkInLatitude, -90, 90);

    if (parsedLatitude === 'invalid') {
      setError('GPS latitude must be a valid number between -90 and 90.');
      return null;
    }

    const parsedLongitude = parseCoordinate(checkInLongitude, -180, 180);

    if (parsedLongitude === 'invalid') {
      setError('GPS longitude must be a valid number between -180 and 180.');
      return null;
    }

    if ((parsedLatitude === undefined) !== (parsedLongitude === undefined)) {
      setError('GPS location must include both latitude and longitude.');
      return null;
    }

    if (pencawangMode === 'EXISTING' && !selectedSubstationId) {
      setError('Please select an existing Pencawang.');
      return null;
    }

    if (mainheads.length === 0) {
      setError('No MAINHEAD available. Please contact admin.');
      return null;
    }

    if (!selectedMainheadId || !selectedMainhead) {
      setError('Please select a MAINHEAD.');
      return null;
    }

    if (isSavt) {
      if (toPencawangMode === 'EXISTING' && !toPencawangId) {
        setError("Please select the route's To Pencawang for a SAVT survey.");
        return null;
      }

      if (
        toPencawangMode === 'NEW' &&
        (!toPencawangName.trim() || !toPencawangCode.trim())
      ) {
        setError("Enter the new To Pencawang's name and code for a SAVT survey.");
        return null;
      }

      if (!routeCode.trim()) {
        setError('KOD TIANG (route line code) is required for a SAVT survey.');
        return null;
      }
    }

    if (pencawangMode === 'NEW') {
      if (!normalizedPencawangName) {
        setError('Nama Pencawang is required for a new Pencawang.');
        return null;
      }

      if (!normalizedFunctionalLocation) {
        setError('Functional Location is required for a new Pencawang.');
        return null;
      }

      if (!normalizedPencawangCode) {
        setError('Kod Pencawang is required for a new Pencawang.');
        return null;
      }

      if (parsedLatitude === undefined || parsedLongitude === undefined) {
        setError('GPS latitude and longitude are required for a new Pencawang.');
        return null;
      }

      if (gpsAccuracyMeters === null) {
        setError('Capture GPS accuracy with Use GPS or Map for a new Pencawang.');
        return null;
      }
    }

    return {
      teamId: selectedTeamId,
      substationId: pencawangMode === 'EXISTING' ? selectedSubstationId : undefined,
      visitType,
      pencawangName: normalizedPencawangName,
      pencawangCode: normalizedPencawangCode,
      functionalLocation: normalizedFunctionalLocation,
      mainheadId: selectedMainheadId,
      checkInLatitude: parsedLatitude,
      checkInLongitude: parsedLongitude,
      checkInAccuracyMeters: gpsAccuracyMeters ?? undefined,
      checkInCapturedAt: checkInCapturedAt ?? undefined,
      notes: normalizedNotes,
      // SAVT route: scope, the From (= this visit's Pencawang when chosen from
      // master data), the To Pencawang, and the KOD TIANG route line code that
      // every pole on the route inherits.
      ...(isSavt
        ? {
            operationalScope: 'SAVT' as const,
            fromPencawangId:
              pencawangMode === 'EXISTING' ? selectedSubstationId : undefined,
            // Existing To → its id; New To → name + code so the server creates
            // (or reuses) the destination Pencawang.
            ...(toPencawangMode === 'EXISTING'
              ? { toPencawangId: toPencawangId || undefined }
              : {
                  toPencawangName: toPencawangName.trim() || undefined,
                  toPencawangCode: toPencawangCode.trim() || undefined,
                }),
            routeCode: routeCode.trim() || undefined,
          }
        : {}),
    };
  }

  /**
   * Start a site visit with ZERO signal: mint a temp visit id, queue the create
   * (reconciled to a real id on sync), synthesize the visit into the offline
   * cache and open it so field work continues. EXISTING-Pencawang only in v1 — a
   * NEW Pencawang has no substationId to reconcile offline-created poles against.
   */
  async function startVisitOffline(payload: CreateSiteVisitInput) {
    if (
      pencawangMode !== 'EXISTING' ||
      !selectedSubstation ||
      !selectedSubstationId ||
      !selectedTeam
    ) {
      setError(
        'A new Pencawang needs a connection to create. Pick an existing Pencawang, or start this visit at the depot when you have signal.',
      );
      return;
    }

    const tempVisitId = mintTempId('visit');

    // Persist arrival photos to a durable dir + attach to the queued create so
    // they upload once the visit reconciles (raw camera-cache URIs can be
    // OS-evicted before then).
    const persistedPhotos = await Promise.all(
      sitePhotos.map(async (photo) => ({
        id: photo.id,
        uri: await persistOfflineSiteVisitPhoto(photo.uri, photo.id),
        timestamp: photo.timestamp,
      })),
    );

    await enqueueMutation({
      type: 'CREATE_VISIT',
      payload: payload as unknown as Record<string, unknown>,
      tempId: tempVisitId,
      ownerUserId: user.id,
      sitePhotos: persistedPhotos,
      label: `${selectedSubstation.code} - ${selectedSubstation.name}`,
      sublabel: `${selectedTeam.code} - ${selectedTeam.name}`,
    });

    const now = new Date().toISOString();
    // Enumerate the full shape — a missing team{}/substation{} sub-object would
    // hard-crash VisitDetail render + the completion summary.
    const syntheticVisit: SiteVisit = {
      id: tempVisitId,
      teamId: selectedTeam.id,
      substationId: selectedSubstation.id,
      status: 'ACTIVE',
      lifecycleStatus: 'DALAM_RONDAAN',
      visitType: payload.visitType ?? visitType,
      operationalScope: isSavt ? 'SAVT' : 'SAVR',
      routeCode: payload.routeCode ?? null,
      mainhead: selectedMainhead?.name ?? null,
      pencawangCode: payload.pencawangCode ?? selectedSubstation.code,
      pencawangName: payload.pencawangName ?? selectedSubstation.name,
      functionalLocation: payload.functionalLocation ?? selectedSubstation.location ?? null,
      checkInLatitude: payload.checkInLatitude ?? null,
      checkInLongitude: payload.checkInLongitude ?? null,
      checkInAccuracyMeters: payload.checkInAccuracyMeters ?? null,
      checkInCapturedAt: payload.checkInCapturedAt ?? null,
      startedAt: now,
      endedAt: null,
      notes: payload.notes ?? null,
      team: { id: selectedTeam.id, code: selectedTeam.code, name: selectedTeam.name },
      substation: {
        id: selectedSubstation.id,
        code: selectedSubstation.code,
        name: selectedSubstation.name,
        location: selectedSubstation.location ?? null,
      },
      inspections: [],
      totalAssets: 0,
      inspectedAssets: 0,
      pendingAssets: 0,
      defectsFound: 0,
      completionPercentage: 0,
    };

    await Promise.all([
      writeCache('site-visit', tempVisitId, syntheticVisit),
      prependToCachedArray<SiteVisit>(
        'site-visits-active',
        undefined,
        syntheticVisit,
        (v) => v.id,
      ),
    ]);

    goToVisit(syntheticVisit);
  }

  async function createVisit(payload: CreateSiteVisitInput) {
    // Defense in depth: starting a site visit is inspection-scope. The screen
    // guard already blocks maintenance accounts, but re-assert here to close the
    // brief capability-loading render race.
    if (capabilitiesLoading || !canInspect) {
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const visit = await api.createSiteVisit(token, payload);

      try {
        await uploadSitePhotos(visit.id);
      } catch (uploadError) {
        if (uploadError instanceof ApiError && uploadError.status === 401) {
          await handleUnauthorized(uploadError);
          return;
        }

        if (!isEndpointUnavailableError(uploadError)) {
          Alert.alert(
            'Check-in created',
            'The site visit was created, but one or more site photos could not be uploaded. You can continue the visit and retry photos later if needed.',
          );
        }
      }

      goToVisit(visit);
    } catch (createError) {
      if (createError instanceof ApiError && createError.status === 401) {
        await handleUnauthorized(createError);
        return;
      }

      // Server unreachable (offline / forced Work Offline): queue the visit and
      // open it optimistically so the crew can start work with zero signal; it
      // reconciles to a real id on sync.
      if (createError instanceof ApiError && createError.status === 0) {
        try {
          await startVisitOffline(payload);
        } catch (offlineError) {
          setError(
            offlineError instanceof Error
              ? offlineError.message
              : 'Unable to start the site visit offline.',
          );
        }
        return;
      }

      setError(createError instanceof Error ? createError.message : 'Unable to create site visit.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function applyCheckInLocation(position: Location.LocationObject) {
    setCheckInLatitude(formatCoordinate(position.coords.latitude));
    setCheckInLongitude(formatCoordinate(position.coords.longitude));
    setGpsAccuracyMeters(
      typeof position.coords.accuracy === 'number' && Number.isFinite(position.coords.accuracy)
        ? position.coords.accuracy
        : null,
    );
    setCheckInCapturedAt(new Date(position.timestamp).toISOString());
  }

  async function uploadSitePhotos(siteVisitId: string) {
    for (const photo of sitePhotos) {
      await api.uploadSiteVisitImage(token, siteVisitId, {
        uri: photo.uri,
        timestamp: photo.timestamp,
      });
    }
  }

  function handleManualLatitude(nextValue: string) {
    setCheckInLatitude(nextValue);
    setCheckInCapturedAt(null);
  }

  function handleManualLongitude(nextValue: string) {
    setCheckInLongitude(nextValue);
    setCheckInCapturedAt(null);
  }

  if (mapPickerState) {
    return (
      <MapCoordinatePicker
        initialCoordinate={mapPickerState.coordinate}
        accuracyMeters={mapPickerState.accuracyMeters}
        onCancel={() => setMapPickerState(null)}
        onConfirm={handleConfirmMapCoordinate}
      />
    );
  }

  if (!capabilitiesLoading && !canInspect) {
    return (
      <Screen
        title="Pencawang Check-In"
        actions={<InlineButton label="Back" onPress={() => navigation.goBack()} />}
      >
        <Card>
          <EmptyState
            title="Inspection access required"
            description="Starting a site visit is an inspection task, and your account doesn't have inspection access."
          />
        </Card>
      </Screen>
    );
  }

  const hasGpsFix = checkInLatitude.trim().length > 0 && checkInLongitude.trim().length > 0;

  return (
    <Screen
      title="Pencawang Check-In"
      subtitle="Start a shared site visit for the team."
      actions={
        <>
          <InlineButton label="Back" onPress={() => navigation.goBack()} disabled={isSubmitting} />
          <InlineButton label="Refresh" onPress={loadOptions} disabled={isSubmitting} />
        </>
      }
      keyboardAware
      bottomBar={
        !isLoading ? (
          <BottomCTA
            label={
              isSubmitting
                ? sitePhotos.length > 0
                  ? 'Creating & uploading photos...'
                  : 'Creating check-in...'
                : 'Start Site Visit'
            }
            onPress={handleCreateVisit}
            loading={isSubmitting}
            disabled={!canCreateCheckIn || offlineNewPencawangBlocked}
            hint={
              offlineNewPencawangBlocked
                ? 'Offline · a new Pencawang needs signal — pick an existing one or start at the depot'
                : !canCreateCheckIn
                  ? 'Start Site Visit · complete the required fields'
                  : null
            }
          />
        ) : null
      }
    >
      <ErrorBanner message={error} />
      {isLoading ? <LoadingBlock label="Loading teams, MAINHEADs, pencawang, and GPS..." /> : null}

      {!isLoading ? (
        <>
          {/* Survey-type as a big visual toggle (handoff 2c). */}
          <Card>
            <EyebrowLabel>Survey Type</EyebrowLabel>
            <View style={styles.toggleStack}>
              <SelectCard
                label="SAVR — Pencawang pole survey"
                description="Inspect poles at one Pencawang."
                selected={operationalScope === 'SAVR'}
                onPress={() => setOperationalScope('SAVR')}
              />
              <SelectCard
                label="SAVT — Route A → B (HV line)"
                description="High-voltage line between two Pencawang."
                selected={operationalScope === 'SAVT'}
                onPress={() => setOperationalScope('SAVT')}
              />
            </View>
          </Card>

          <Card>
            <SectionTitle>Team and PIC</SectionTitle>
            {!optionsLoaded ? (
              <EmptyState
                icon="wifi-off"
                title="Couldn't load your team"
                description="You appear to be offline. Starting a new site visit needs a connection — turn off Work Offline (menu) or get signal, then tap Refresh."
              />
            ) : teams.length === 0 ? (
              <EmptyState
                icon="users"
                title="No active teams"
                description="This user must belong to a team before a site visit can be created."
              />
            ) : (
              <>
                {/*
                  Governance Fix Package G3 — Item 4. The team is inferred
                  from the user's team assignment(s) returned by api.getTeams.
                  The picker UI is removed; the team is displayed read-only and
                  used directly by the create call.
                */}
                <View style={styles.readOnlyPanel}>
                  <FieldSummary label="Team" value={formatTeam(selectedTeam)} mono />
                  <View style={styles.summaryDivider} />
                  <FieldSummary label="PIC Name" value={user.name || user.email} />
                </View>
              </>
            )}
          </Card>

          <Card>
            <SectionTitle>{isSavt ? 'Route Details (SAVT)' : 'Pencawang Details'}</SectionTitle>

            <View style={styles.fieldGroup}>
              <EyebrowLabel>{isSavt ? 'From Pencawang Source' : 'Pencawang Source'}</EyebrowLabel>
              <Dropdown
                value={pencawangMode}
                options={[
                  {
                    label: 'New Pencawang',
                    value: 'NEW',
                    description: 'Enter site details manually',
                  },
                  {
                    label: 'Existing Pencawang',
                    value: 'EXISTING',
                    description: 'Select from master data',
                  },
                ]}
                onSelect={(nextValue) => handleSelectPencawangMode(nextValue as PencawangMode)}
              />
            </View>

            {pencawangMode === 'EXISTING' && substations.length === 0 ? (
              <EmptyState
                icon="database"
                title="No substations"
                description="The backend did not return any active substations for this tenant."
              />
            ) : null}

            {pencawangMode === 'EXISTING' && substations.length > 0 ? (
              <View style={styles.fieldGroup}>
                <EyebrowLabel>Select Pencawang</EyebrowLabel>
                <Dropdown
                  value={selectedSubstationId}
                  placeholder="Choose an existing Pencawang"
                  options={substations.map((substation) => ({
                    label: `${substation.code} - ${substation.name}`,
                    value: substation.id,
                    description: substation.location || null,
                  }))}
                  onSelect={(nextValue) => {
                    const nextSubstation = substations.find(
                      (substation) => substation.id === nextValue,
                    );

                    if (nextSubstation) {
                      applyExistingSubstation(nextSubstation);
                    }
                  }}
                />
              </View>
            ) : null}

            <TextField
              label={pencawangMode === 'NEW' ? 'Nama Pencawang *' : 'Nama Pencawang'}
              value={pencawangName}
              onChangeText={(nextValue) => setPencawangName(normalizeOperationalText(nextValue))}
              placeholder="Nama pencawang di lokasi"
              autoCapitalize="characters"
            />
            <TextField
              label={pencawangMode === 'NEW' ? 'Functional Location *' : 'Functional Location'}
              value={functionalLocation}
              onChangeText={(nextValue) => setFunctionalLocation(normalizeOperationalText(nextValue))}
              placeholder="Functional location / alamat operasi"
              autoCapitalize="characters"
            />
            <TextField
              label={pencawangMode === 'NEW' ? 'Kod Pencawang *' : 'Kod Pencawang'}
              value={pencawangCode}
              onChangeText={(nextValue) => setPencawangCode(normalizeOperationalText(nextValue))}
              placeholder="Kod pencawang"
              autoCapitalize="characters"
            />
            <View style={styles.fieldGroup}>
              <EyebrowLabel>MAINHEAD *</EyebrowLabel>
              {!optionsLoaded ? (
                // Same offline-aware guard as the Team card: MAINHEADs load from
                // the same online fetch, so an offline/failed load must NOT read
                // as "no MAINHEAD exists — contact admin".
                <EmptyState
                  icon="wifi-off"
                  title="Couldn't load MAINHEADs"
                  description="You appear to be offline. Starting a new site visit needs a connection — turn off Work Offline (menu) or get signal, then tap Refresh."
                />
              ) : mainheads.length === 0 ? (
                <EmptyState
                  icon="database"
                  title="No MAINHEAD available"
                  description="No MAINHEAD available. Please contact admin."
                />
              ) : (
                <Dropdown
                  value={selectedMainheadId}
                  placeholder="Choose MAINHEAD"
                  options={mainheads.map((mainhead) => ({
                    label: formatMainheadLabel(mainhead),
                    value: mainhead.id,
                    description: formatMainheadDescription(mainhead),
                  }))}
                  onSelect={setSelectedMainheadId}
                />
              )}
            </View>

            {isSavt ? (
              <View style={styles.savtGroup}>
                <View style={styles.fieldGroup}>
                  <EyebrowLabel>To Pencawang Source</EyebrowLabel>
                  <Dropdown
                    value={toPencawangMode}
                    options={[
                      {
                        label: 'Existing Pencawang',
                        value: 'EXISTING',
                        description: 'Select from master data',
                      },
                      {
                        label: 'New Pencawang',
                        value: 'NEW',
                        description: 'Enter the destination name + code',
                      },
                    ]}
                    onSelect={(nextValue) =>
                      setToPencawangMode(nextValue as PencawangMode)
                    }
                  />
                </View>

                {toPencawangMode === 'EXISTING' ? (
                  substations.length > 0 ? (
                    <View style={styles.fieldGroup}>
                      <EyebrowLabel>To Pencawang *</EyebrowLabel>
                      <Dropdown
                        value={toPencawangId}
                        placeholder="Choose the route's end Pencawang"
                        options={substations.map((substation) => ({
                          label: `${substation.code} - ${substation.name}`,
                          value: substation.id,
                          description: substation.location || null,
                        }))}
                        onSelect={setToPencawangId}
                      />
                    </View>
                  ) : (
                    <EmptyState
                      icon="database"
                      title="No substations"
                      description="No active Pencawang to choose from. Switch to New Pencawang to enter the destination."
                    />
                  )
                ) : (
                  <>
                    <TextField
                      label="To Pencawang Name *"
                      value={toPencawangName}
                      onChangeText={(nextValue) =>
                        setToPencawangName(normalizeOperationalText(nextValue))
                      }
                      placeholder="Nama pencawang hujung laluan"
                      autoCapitalize="characters"
                    />
                    <TextField
                      label="To Pencawang Code *"
                      value={toPencawangCode}
                      onChangeText={(nextValue) =>
                        setToPencawangCode(normalizeOperationalText(nextValue))
                      }
                      placeholder="Kod pencawang hujung"
                      autoCapitalize="characters"
                    />
                  </>
                )}

                <TextField
                  label="KOD TIANG *"
                  value={routeCode}
                  onChangeText={(nextValue) => setRouteCode(normalizeOperationalText(nextValue))}
                  placeholder="Route line code, e.g. MI - KUK"
                  autoCapitalize="characters"
                />
              </View>
            ) : null}
          </Card>

          <Card>
            <SectionTitle>Visit Type</SectionTitle>
            <Dropdown
              value={visitType}
              options={VISIT_TYPE_OPTIONS.map((option) => ({
                label: option.label,
                value: option.value,
                description: option.description,
              }))}
              onSelect={(nextValue) => setVisitType(nextValue as SiteVisitType)}
            />
          </Card>

          <Card>
            <SectionTitle>GPS Location</SectionTitle>
            {/* Confirmed GPS reads as a green card; coords + accuracy in mono. */}
            <View style={[styles.gpsCard, hasGpsFix ? styles.gpsCardConfirmed : styles.gpsCardPending]}>
              <View style={styles.gpsCardHeader}>
                <Feather
                  name={hasGpsFix ? 'check-circle' : 'map-pin'}
                  size={16}
                  color={hasGpsFix ? theme.colors.successText : theme.colors.textSecondary}
                />
                <Text
                  style={[
                    styles.gpsCardStatus,
                    { color: hasGpsFix ? theme.colors.successText : theme.colors.textSecondary },
                  ]}
                >
                  {hasGpsFix ? 'GPS captured' : isLocating ? 'Reading GPS...' : 'No GPS fix yet'}
                </Text>
                <Mono
                  size={12}
                  color={hasGpsFix ? theme.colors.successText : theme.colors.textMuted}
                >
                  {formatGpsAccuracy(gpsAccuracyMeters)}
                </Mono>
              </View>
              <Mono
                size={15}
                color={hasGpsFix ? theme.colors.textPrimary : theme.colors.textMuted}
              >
                {formatCoordinateSummary(checkInLatitude, checkInLongitude)}
              </Mono>
            </View>
            <View style={styles.coordinateInputRow}>
              <View style={styles.coordinateInputCell}>
                <TextField
                  label="Lat"
                  value={checkInLatitude}
                  onChangeText={handleManualLatitude}
                  placeholder="2.925900"
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              <View style={styles.coordinateInputCell}>
                <TextField
                  label="Lng"
                  value={checkInLongitude}
                  onChangeText={handleManualLongitude}
                  placeholder="101.690000"
                  keyboardType="numbers-and-punctuation"
                />
              </View>
            </View>
            <View style={styles.coordinateActionRow}>
              <View style={styles.coordinateActionCell}>
                <AppButton
                  label={isLocating ? 'Reading GPS...' : 'Use GPS'}
                  onPress={handleUseCurrentGps}
                  variant="secondary"
                  loading={isLocating}
                  disabled={isSubmitting}
                />
              </View>
              <View style={styles.coordinateActionCell}>
                <AppButton
                  label={isOpeningMapPicker ? 'Opening...' : 'Pick on map'}
                  onPress={handleOpenMapPicker}
                  variant="secondary"
                  loading={isOpeningMapPicker}
                  disabled={isSubmitting}
                />
              </View>
            </View>
            {hasLocationPermission === false ? (
              <Text style={styles.coordinateSourceText}>
                Location permission off. Manual entry works.
              </Text>
            ) : null}
          </Card>

          <Card>
            <SectionTitle>Site Photos</SectionTitle>
            <BodyText muted>Capture arrival photos for the shared visit record.</BodyText>
            {sitePhotos.length > 0 ? (
              <View style={styles.photoGrid}>
                {sitePhotos.map((photo, index) => (
                  <View key={photo.id} style={styles.photoTile}>
                    <Image source={{ uri: photo.uri }} style={styles.photoPreview} resizeMode="cover" />
                    <View style={styles.photoFooter}>
                      <Text style={styles.photoLabel}>Photo {index + 1}</Text>
                      <Pressable
                        accessibilityRole="button"
                        disabled={isSubmitting}
                        onPress={() =>
                          setSitePhotos((currentPhotos) =>
                            currentPhotos.filter((currentPhoto) => currentPhoto.id !== photo.id),
                          )
                        }
                        style={({ pressed }) => [styles.removePhotoButton, pressed && styles.pressedButton]}
                      >
                        <Text style={styles.removePhotoText}>Remove</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <EmptyState
                icon="camera"
                title="No site photos yet"
                description="Take at least one photo when site condition needs visual context."
              />
            )}
            <AppButton
              label={isCapturingPhoto ? 'Opening Camera...' : 'Take Site Photo'}
              onPress={handleTakeSitePhoto}
              variant="secondary"
              loading={isCapturingPhoto}
              disabled={isSubmitting}
            />
          </Card>

          <Card>
            <SectionTitle>Visit Notes</SectionTitle>
            <TextField
              label="Optional Notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Add arrival notes or job context"
              multiline
              autoCapitalize="characters"
            />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

/** Mono uppercase eyebrow label above a grouped field (handoff 2c). */
function EyebrowLabel({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <Text style={styles.eyebrow}>{children}</Text>;
}

function MapCoordinatePicker({
  initialCoordinate,
  accuracyMeters,
  onCancel,
  onConfirm,
}: {
  initialCoordinate: Coordinate;
  accuracyMeters: number | null;
  onCancel: () => void;
  onConfirm: (params: { coordinate: Coordinate; accuracyMeters: number | null }) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // Uncontrolled camera (seed defaultSettings + track the live centre) so the
  // map doesn't re-snap and fight gestures; the chosen location is the centre
  // crosshair.
  const [center, setCenter] = useState<Coordinate>(initialCoordinate);

  return (
    <SafeAreaView style={styles.mapPickerSafeArea}>
      <View style={styles.mapPickerScreen}>
        <View style={styles.mapPickerHeader}>
          <Pressable
            accessibilityRole="button"
            onPress={onCancel}
            style={({ pressed }) => [styles.mapPickerHeaderButton, pressed && styles.pressedButton]}
          >
            <Text style={styles.mapPickerHeaderButtonText}>Back</Text>
          </Pressable>
          <View style={styles.mapPickerHeaderTitleWrap}>
            <Text style={styles.mapPickerTitle}>Select Coordinates</Text>
            <Text style={styles.mapPickerSubtitle}>Pan so the crosshair marks the spot</Text>
          </View>
          <View style={styles.mapPickerHeaderSide} />
        </View>

        <View style={styles.mapPickerMapShell}>
          <Mapbox.MapView
            style={StyleSheet.absoluteFillObject}
            styleURL={SATELLITE_STYLE}
            scaleBarEnabled={false}
            compassEnabled={false}
            onCameraChanged={(state) => {
              const [longitude, latitude] = state.properties.center as [number, number];
              setCenter({ latitude, longitude });
            }}
          >
            <Mapbox.Camera
              animationMode="none"
              defaultSettings={{
                centerCoordinate: [initialCoordinate.longitude, initialCoordinate.latitude],
                zoomLevel: MAP_PICKER_ZOOM,
              }}
            />
            <Mapbox.LocationPuck visible />
          </Mapbox.MapView>
          <MapCrosshair color={theme.colors.primary} />
        </View>

        <View style={styles.mapPickerFooter}>
          <View style={styles.mapPickerCoordinatePanel}>
            <Text style={styles.mapPickerCoordinateLabel}>Centre location</Text>
            <Mono size={14} color={theme.colors.textPrimary}>
              Lat {center.latitude.toFixed(6)} · Lng {center.longitude.toFixed(6)}
            </Mono>
            <Mono size={13} muted>
              {formatGpsAccuracy(accuracyMeters)}
            </Mono>
          </View>
          <AppButton
            label="Confirm Coordinates"
            onPress={() =>
              onConfirm({
                coordinate: { latitude: center.latitude, longitude: center.longitude },
                accuracyMeters,
              })
            }
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

function FieldSummary({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.fieldSummaryRow}>
      <Text style={styles.fieldSummaryLabel}>{label}</Text>
      {mono ? (
        <View style={styles.fieldSummaryValueWrap}>
          <Mono size={13.5} color={theme.colors.textPrimary}>
            {value}
          </Mono>
        </View>
      ) : (
        <Text style={styles.fieldSummaryValue}>{value}</Text>
      )}
    </View>
  );
}

function formatTeam(team: Team | null) {
  return team ? `${team.code} - ${team.name}` : 'No team selected';
}

function formatMainheadLabel(mainhead: Mainhead) {
  return mainhead.code ? `${mainhead.code} - ${mainhead.name}` : mainhead.name;
}

function formatMainheadDescription(mainhead: Mainhead) {
  const branchLabel = mainhead.branch
    ? mainhead.branch.code
      ? `${mainhead.branch.code} - ${mainhead.branch.name}`
      : mainhead.branch.name
    : null;
  const organizationLabel = mainhead.branch?.organization
    ? mainhead.branch.organization.code
      ? `${mainhead.branch.organization.code} - ${mainhead.branch.organization.name}`
      : mainhead.branch.organization.name
    : null;

  return [branchLabel, organizationLabel].filter(Boolean).join(' / ') || null;
}

async function loadActiveVisitsForWarning(token: string) {
  try {
    const { value } = await cachedFetch('site-visits-active', undefined, () =>
      api.getActiveSiteVisits(token),
    );
    return value;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw error;
    }

    // Offline with no cached active-visit list (or any non-auth failure): return
    // empty so the remaining Check-In options still load from cache. The
    // active-visit warning is best-effort; a missed warning at worst lets the
    // crew start a second visit (server + admin remain the source of truth).
    return [];
  }
}

function formatVisitPencawang(visit: SiteVisit) {
  const code = visit.pencawangCode ?? visit.substation.code;
  const name = visit.pencawangName ?? visit.substation.name;

  return code ? `${code} - ${name}` : name;
}

function isActiveVisitStatus(status: string) {
  return status === 'ACTIVE' || status === 'OPEN' || status === 'IN_PROGRESS';
}

function formatCoordinate(value: number) {
  return value.toFixed(6);
}

function formatCoordinateSummary(latitude: string, longitude: string) {
  const latitudeLabel = latitude.trim() || 'N/A';
  const longitudeLabel = longitude.trim() || 'N/A';

  return `${latitudeLabel}, ${longitudeLabel}`;
}

function formatGpsAccuracy(value: number | null) {
  return value === null ? 'GPS --' : `±${Math.round(value)}m`;
}

function parseCoordinate(
  rawValue: string,
  minimum: number,
  maximum: number,
) {
  const normalizedValue = rawValue.trim();

  if (!normalizedValue) {
    return undefined;
  }

  const parsedValue = Number(normalizedValue);

  if (!Number.isFinite(parsedValue) || parsedValue < minimum || parsedValue > maximum) {
    return 'invalid' as const;
  }

  return parsedValue;
}

function parseFormCoordinate(latitude: string, longitude: string): Coordinate | null {
  const parsedLatitude = parseCoordinate(latitude, -90, 90);
  const parsedLongitude = parseCoordinate(longitude, -180, 180);

  if (typeof parsedLatitude === 'number' && typeof parsedLongitude === 'number') {
    return {
      latitude: parsedLatitude,
      longitude: parsedLongitude,
    };
  }

  return null;
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    eyebrow: {
      fontSize: 11,
      lineHeight: 15,
      fontFamily: t.fonts.monoMedium,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: t.colors.textMuted,
    },
    toggleStack: {
      gap: 10,
    },
    fieldGroup: {
      gap: 6,
    },
    savtGroup: {
      gap: 10,
      marginTop: 2,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: t.colors.border,
    },
    readOnlyPanel: {
      borderRadius: t.radius.card,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surfaceMuted,
      padding: 12,
      gap: 10,
    },
    summaryDivider: {
      height: 1,
      backgroundColor: t.colors.border,
    },
    fieldSummaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 16,
    },
    fieldSummaryLabel: {
      flex: 1,
      color: t.colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
      fontFamily: t.fonts.bodySemibold,
    },
    fieldSummaryValue: {
      flex: 1.25,
      color: t.colors.textPrimary,
      fontSize: 14,
      lineHeight: 19,
      fontWeight: '700',
      fontFamily: t.fonts.bodyBold,
      textAlign: 'right',
    },
    fieldSummaryValueWrap: {
      flex: 1.25,
      alignItems: 'flex-end',
    },
    // Confirmed GPS card (handoff 2c) — green when a fix is captured.
    gpsCard: {
      borderRadius: t.radius.card,
      borderWidth: 1,
      padding: 12,
      gap: 8,
    },
    gpsCardConfirmed: {
      borderColor: t.colors.successBorder,
      backgroundColor: t.colors.successSoft,
    },
    gpsCardPending: {
      borderColor: t.colors.border,
      backgroundColor: t.colors.surfaceMuted,
    },
    gpsCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    gpsCardStatus: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
      fontFamily: t.fonts.bodyBold,
    },
    coordinateSourceText: {
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '600',
      fontFamily: t.fonts.bodySemibold,
    },
    coordinateInputRow: {
      flexDirection: 'row',
      gap: 10,
    },
    coordinateInputCell: {
      flex: 1,
    },
    coordinateActionRow: {
      flexDirection: 'row',
      gap: 10,
    },
    coordinateActionCell: {
      flex: 1,
    },
    photoGrid: {
      gap: 12,
    },
    photoTile: {
      borderRadius: t.radius.card,
      borderWidth: 1,
      borderColor: t.colors.border,
      overflow: 'hidden',
      backgroundColor: t.colors.card,
    },
    photoPreview: {
      width: '100%',
      height: 180,
      backgroundColor: t.colors.surfaceMuted,
    },
    photoFooter: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    photoLabel: {
      color: t.colors.textPrimary,
      fontSize: 14,
      lineHeight: 19,
      fontWeight: '700',
      fontFamily: t.fonts.bodyBold,
    },
    removePhotoButton: {
      minHeight: 36,
      borderRadius: t.radius.control,
      borderWidth: 1,
      borderColor: t.colors.dangerBorder,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
      backgroundColor: t.colors.dangerSoft,
    },
    removePhotoText: {
      color: t.colors.dangerText,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
      fontFamily: t.fonts.bodyBold,
    },
    pressedButton: {
      opacity: 0.82,
    },
    mapPickerSafeArea: {
      flex: 1,
      backgroundColor: t.colors.background,
      paddingTop: Platform.OS === 'android' ? NativeStatusBar.currentHeight ?? 0 : 0,
    },
    mapPickerScreen: {
      flex: 1,
      backgroundColor: t.colors.background,
    },
    mapPickerHeader: {
      minHeight: 54,
      paddingHorizontal: t.spacing.screen,
      paddingBottom: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    mapPickerHeaderButton: {
      minWidth: 72,
      minHeight: 40,
      borderRadius: t.radius.control,
      borderWidth: 1,
      borderColor: t.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.colors.card,
      paddingHorizontal: 12,
    },
    mapPickerHeaderButtonText: {
      color: t.colors.textPrimary,
      fontSize: 14,
      lineHeight: 19,
      fontWeight: '700',
      fontFamily: t.fonts.bodyBold,
    },
    mapPickerHeaderTitleWrap: {
      flex: 1,
      alignItems: 'center',
      gap: 2,
    },
    mapPickerTitle: {
      color: t.colors.textPrimary,
      fontSize: 18,
      lineHeight: 24,
      fontWeight: '700',
      fontFamily: t.fonts.display,
      textAlign: 'center',
    },
    mapPickerSubtitle: {
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '600',
      fontFamily: t.fonts.bodySemibold,
      textAlign: 'center',
    },
    mapPickerHeaderSide: {
      width: 72,
    },
    mapPickerMapShell: {
      flex: 1,
      backgroundColor: t.colors.border,
    },
    mapPickerFooter: {
      borderTopWidth: 1,
      borderTopColor: t.colors.border,
      backgroundColor: t.colors.background,
      paddingHorizontal: t.spacing.screen,
      paddingVertical: 14,
      gap: 12,
    },
    mapPickerCoordinatePanel: {
      borderRadius: t.radius.card,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.card,
      padding: 12,
      gap: 4,
    },
    mapPickerCoordinateLabel: {
      color: t.colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '600',
      fontFamily: t.fonts.bodySemibold,
    },
  });
