import { useCallback, useEffect, useMemo, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
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
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import type { MapPressEvent, MarkerDragStartEndEvent, Region } from 'react-native-maps';
import { useNavigation } from '@react-navigation/native';
import { api, ApiError, isEndpointUnavailableError } from '../api';
import { useSession } from '../context/AuthContext';
import type { RootStackScreenProps } from '../navigation/types';
import {
  AppButton,
  BodyText,
  Card,
  Dropdown,
  EmptyState,
  ErrorBanner,
  InlineButton,
  LoadingBlock,
  Screen,
  SectionTitle,
  SelectCard,
  TextField,
  uiTheme,
} from '../ui';
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

const MAP_PICKER_DELTA = 0.004;

export function CheckInScreen() {
  const navigation = useNavigation<RootStackScreenProps<'CheckIn'>['navigation']>();
  const { token, user, handleUnauthorized } = useSession();

  function goToVisit(visit: SiteVisit) {
    navigation.replace('VisitDetail', {
      visitId: visit.id,
      substationId: visit.substationId,
    });
  }

  const [teams, setTeams] = useState<Team[]>([]);
  const [substations, setSubstations] = useState<Substation[]>([]);
  const [mainheads, setMainheads] = useState<Mainhead[]>([]);
  const [activeVisits, setActiveVisits] = useState<SiteVisit[]>([]);
  const [pencawangMode, setPencawangMode] = useState<PencawangMode>('NEW');
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
  const [isTeamPickerOpen, setIsTeamPickerOpen] = useState(false);
  const [hasLocationPermission, setHasLocationPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const loadOptions = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      const [teamList, substationList, mainheadList, activeVisitList] = await Promise.all([
        api.getTeams(token),
        api.getSubstations(token),
        api.getMainheads(token),
        loadActiveVisitsForWarning(token),
      ]);

      setTeams(teamList);
      setSubstations(substationList);
      setMainheads(mainheadList);
      setActiveVisits(activeVisitList);

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

      await prefillCurrentLocation();
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

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      applyCheckInLocation(position);
    } catch {
      // Passive check-in GPS should not block field users from starting a visit.
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

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

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

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

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

      const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();

      if (!cameraPermission.granted) {
        setError('Camera permission is required to capture site photos.');
        return;
      }

      const captureResult = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.7,
      });

      if (captureResult.canceled) {
        return;
      }

      const capturedAsset = captureResult.assets[0];

      if (!capturedAsset?.uri) {
        setError('Unable to read the captured site photo.');
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
    };
  }

  async function createVisit(payload: CreateSiteVisitInput) {
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

  return (
    <Screen
      title="Pencawang Check-In"
      subtitle="Start a shared site visit with the field details needed for SAVR work."
      actions={
        <>
          <InlineButton label="Back" onPress={() => navigation.goBack()} disabled={isSubmitting} />
          <InlineButton label="Refresh" onPress={loadOptions} disabled={isSubmitting} />
        </>
      }
      keyboardAware
    >
      <ErrorBanner message={error} />
      {isLoading ? <LoadingBlock label="Loading teams, MAINHEADs, pencawang, and GPS..." /> : null}

      {!isLoading ? (
        <>
          <Card>
            <SectionTitle>Team and PIC</SectionTitle>
            {teams.length === 0 ? (
              <EmptyState
                icon="users"
                title="No active teams"
                description="This user must belong to a team before a site visit can be created."
              />
            ) : (
              <>
                <View style={styles.readOnlyPanel}>
                  <FieldSummary label="Team (Auto)" value={formatTeam(selectedTeam)} />
                  <FieldSummary label="PIC Name (Auto)" value={user.name || user.email} />
                </View>
                {teams.length > 1 ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setIsTeamPickerOpen((currentValue) => !currentValue)}
                      style={({ pressed }) => [styles.inlinePickerButton, pressed && styles.pressedButton]}
                    >
                      <Text style={styles.inlinePickerText}>
                        {isTeamPickerOpen ? 'Hide Team Choices' : 'Change Assigned Team'}
                      </Text>
                    </Pressable>
                    {isTeamPickerOpen ? (
                      <View style={styles.selectList}>
                        {teams.map((team) => (
                          <SelectCard
                            key={team.id}
                            label={`${team.code} - ${team.name}`}
                            selected={selectedTeamId === team.id}
                            onPress={() => {
                              setSelectedTeamId(team.id);
                              setIsTeamPickerOpen(false);
                            }}
                          />
                        ))}
                      </View>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </Card>

          <Card>
            <SectionTitle>Pencawang Details</SectionTitle>
            <Dropdown
              label="Pencawang Source"
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

            {pencawangMode === 'EXISTING' && substations.length === 0 ? (
              <EmptyState
                icon="database"
                title="No substations"
                description="The backend did not return any active substations for this tenant."
              />
            ) : null}

            {pencawangMode === 'EXISTING' && substations.length > 0 ? (
              <Dropdown
                label="Select Pencawang"
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
            {mainheads.length === 0 ? (
              <EmptyState
                icon="database"
                title="No MAINHEAD available"
                description="No MAINHEAD available. Please contact admin."
              />
            ) : (
              <Dropdown
                label="MAINHEAD *"
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
            <View style={styles.coordinateSummaryRow}>
              <Text style={styles.coordinateSummaryText} numberOfLines={1}>
                {formatCoordinateSummary(checkInLatitude, checkInLongitude)}
              </Text>
              <Text style={styles.coordinateAccuracyText}>{formatGpsAccuracy(gpsAccuracyMeters)}</Text>
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
                  label={isOpeningMapPicker ? 'Opening...' : 'Map'}
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

      <AppButton
        label={
          isSubmitting
            ? sitePhotos.length > 0
              ? 'Creating Check-In and Uploading Photos...'
              : 'Creating Check-In...'
            : 'Create Check-In'
        }
        onPress={handleCreateVisit}
        loading={isSubmitting}
        disabled={!canCreateCheckIn}
      />
    </Screen>
  );
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
  const [coordinate, setCoordinate] = useState(initialCoordinate);
  const [region, setRegion] = useState<Region>(() => createMapPickerRegion(initialCoordinate));

  function handleMapPress(event: MapPressEvent) {
    const nextCoordinate = event.nativeEvent.coordinate;

    setCoordinate(nextCoordinate);
    setRegion((currentRegion) => ({
      ...currentRegion,
      latitude: nextCoordinate.latitude,
      longitude: nextCoordinate.longitude,
    }));
  }

  function handleMarkerDragEnd(event: MarkerDragStartEndEvent) {
    const nextCoordinate = event.nativeEvent.coordinate;

    setCoordinate(nextCoordinate);
    setRegion((currentRegion) => ({
      ...currentRegion,
      latitude: nextCoordinate.latitude,
      longitude: nextCoordinate.longitude,
    }));
  }

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
            <Text style={styles.mapPickerSubtitle}>Satellite view</Text>
          </View>
          <View style={styles.mapPickerHeaderSide} />
        </View>

        <View style={styles.mapPickerMapShell}>
          <MapView
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFillObject}
            initialRegion={region}
            region={region}
            mapType="satellite"
            showsUserLocation
            showsMyLocationButton
            onPress={handleMapPress}
            onRegionChangeComplete={setRegion}
          >
            <Marker
              coordinate={coordinate}
              draggable
              title="Selected check-in location"
              pinColor={uiTheme.colors.primary}
              onDragEnd={handleMarkerDragEnd}
            />
          </MapView>
        </View>

        <View style={styles.mapPickerFooter}>
          <View style={styles.mapPickerCoordinatePanel}>
            <Text style={styles.mapPickerCoordinateLabel}>Selected GPS</Text>
            <Text style={styles.mapPickerCoordinateValue}>
              Lat {coordinate.latitude.toFixed(6)} · Lng {coordinate.longitude.toFixed(6)}
            </Text>
            <Text style={styles.mapPickerAccuracyText}>{formatGpsAccuracy(accuracyMeters)}</Text>
          </View>
          <AppButton
            label="Confirm Coordinates"
            onPress={() => onConfirm({ coordinate, accuracyMeters })}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

function FieldSummary({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fieldSummaryRow}>
      <Text style={styles.fieldSummaryLabel}>{label}</Text>
      <Text style={styles.fieldSummaryValue}>{value}</Text>
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
    return await api.getActiveSiteVisits(token);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw error;
    }

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

  return `Lat ${latitudeLabel} · Lng ${longitudeLabel}`;
}

function formatGpsAccuracy(value: number | null) {
  return value === null ? 'GPS --' : `GPS ±${Math.round(value)}m`;
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

function createMapPickerRegion(coordinate: Coordinate): Region {
  return {
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    latitudeDelta: MAP_PICKER_DELTA,
    longitudeDelta: MAP_PICKER_DELTA,
  };
}

const styles = StyleSheet.create({
  readOnlyPanel: {
    borderRadius: uiTheme.radius.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.surfaceMuted,
    padding: 12,
    gap: 10,
  },
  fieldSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  fieldSummaryLabel: {
    flex: 1,
    color: uiTheme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  fieldSummaryValue: {
    flex: 1.25,
    color: uiTheme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    textAlign: 'right',
  },
  inlinePickerButton: {
    minHeight: 44,
    borderRadius: uiTheme.radius.control,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    backgroundColor: uiTheme.colors.card,
  },
  inlinePickerText: {
    color: uiTheme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
  },
  selectList: {
    gap: 10,
  },
  coordinateSummaryRow: {
    minHeight: 38,
    borderRadius: uiTheme.radius.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.surfaceMuted,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  coordinateSummaryText: {
    flex: 1,
    color: uiTheme.colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  coordinateAccuracyText: {
    color: uiTheme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  coordinateSourceText: {
    color: uiTheme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
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
    borderRadius: uiTheme.radius.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    overflow: 'hidden',
    backgroundColor: uiTheme.colors.card,
  },
  photoPreview: {
    width: '100%',
    height: 180,
    backgroundColor: uiTheme.colors.surfaceMuted,
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
    color: uiTheme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
  },
  removePhotoButton: {
    minHeight: 36,
    borderRadius: uiTheme.radius.card,
    borderWidth: 1,
    borderColor: '#FECACA',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: uiTheme.colors.dangerSoft,
  },
  removePhotoText: {
    color: uiTheme.colors.danger,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  pressedButton: {
    opacity: 0.82,
  },
  mapPickerSafeArea: {
    flex: 1,
    backgroundColor: uiTheme.colors.background,
    paddingTop: Platform.OS === 'android' ? NativeStatusBar.currentHeight ?? 0 : 0,
  },
  mapPickerScreen: {
    flex: 1,
    backgroundColor: uiTheme.colors.background,
  },
  mapPickerHeader: {
    minHeight: 54,
    paddingHorizontal: uiTheme.spacing.screen,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mapPickerHeaderButton: {
    minWidth: 72,
    minHeight: 40,
    borderRadius: uiTheme.radius.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiTheme.colors.card,
    paddingHorizontal: 12,
  },
  mapPickerHeaderButtonText: {
    color: uiTheme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
  },
  mapPickerHeaderTitleWrap: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  mapPickerTitle: {
    color: uiTheme.colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  mapPickerSubtitle: {
    color: uiTheme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  mapPickerHeaderSide: {
    width: 72,
  },
  mapPickerMapShell: {
    flex: 1,
    backgroundColor: '#e5e7eb',
  },
  mapPickerFooter: {
    borderTopWidth: 1,
    borderTopColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.background,
    paddingHorizontal: uiTheme.spacing.screen,
    paddingVertical: 14,
    gap: 12,
  },
  mapPickerCoordinatePanel: {
    borderRadius: uiTheme.radius.card,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
    backgroundColor: uiTheme.colors.card,
    padding: 12,
    gap: 4,
  },
  mapPickerCoordinateLabel: {
    color: uiTheme.colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  mapPickerCoordinateValue: {
    color: uiTheme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  mapPickerAccuracyText: {
    color: uiTheme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
});
