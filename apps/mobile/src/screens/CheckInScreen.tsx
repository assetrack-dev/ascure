import { useCallback, useEffect, useMemo, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, ApiError, isEndpointUnavailableError } from '../api';
import {
  AppButton,
  BodyText,
  Card,
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
import { SessionUser, SiteVisit, SiteVisitType, Substation, Team } from '../types';

type CapturedSitePhoto = {
  id: string;
  uri: string;
  timestamp: string;
};

type PencawangMode = 'EXISTING' | 'NEW';

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

export function CheckInScreen({
  token,
  user,
  onBack,
  onCreated,
  onOpenExistingVisit,
  onUnauthorized,
}: {
  token: string;
  user: SessionUser;
  onBack: () => void;
  onCreated: (visit: SiteVisit) => void;
  onOpenExistingVisit: (visit: SiteVisit) => void;
  onUnauthorized: (error?: unknown) => Promise<void>;
}) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [substations, setSubstations] = useState<Substation[]>([]);
  const [activeVisits, setActiveVisits] = useState<SiteVisit[]>([]);
  const [pencawangMode, setPencawangMode] = useState<PencawangMode>('EXISTING');
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [selectedSubstationId, setSelectedSubstationId] = useState<string>('');
  const [visitType, setVisitType] = useState<SiteVisitType>('DISCOVERY');
  const [pencawangName, setPencawangName] = useState('');
  const [functionalLocation, setFunctionalLocation] = useState('');
  const [pencawangCode, setPencawangCode] = useState('');
  const [mainhead, setMainhead] = useState('');
  const [checkInLatitude, setCheckInLatitude] = useState('');
  const [checkInLongitude, setCheckInLongitude] = useState('');
  const [checkInAccuracyMeters, setCheckInAccuracyMeters] = useState('');
  const [checkInCapturedAt, setCheckInCapturedAt] = useState<string | null>(null);
  const [sitePhotos, setSitePhotos] = useState<CapturedSitePhoto[]>([]);
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const [isTeamPickerOpen, setIsTeamPickerOpen] = useState(false);
  const [hasLocationPermission, setHasLocationPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) ?? null,
    [selectedTeamId, teams],
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

  const canCreateCheckIn =
    Boolean(selectedTeamId) &&
    !isLoading &&
    (pencawangMode === 'EXISTING'
      ? Boolean(selectedSubstationId)
      : Boolean(
          pencawangName.trim() &&
            functionalLocation.trim() &&
            pencawangCode.trim() &&
            mainhead.trim() &&
            checkInLatitude.trim() &&
            checkInLongitude.trim() &&
            checkInAccuracyMeters.trim(),
        ));

  const loadOptions = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      const [teamList, substationList, activeVisitList] = await Promise.all([
        api.getTeams(token),
        api.getSubstations(token),
        loadActiveVisitsForWarning(token),
      ]);

      setTeams(teamList);
      setSubstations(substationList);
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
        await onUnauthorized(loadError);
        return;
      }

      setError(loadError instanceof Error ? loadError.message : 'Unable to load check-in options.');
    } finally {
      setIsLoading(false);
    }
  }, [onUnauthorized, pencawangMode, token]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    if (!selectedSubstation) {
      return;
    }

    setPencawangName(selectedSubstation.name);
    setPencawangCode(selectedSubstation.code);
    setFunctionalLocation(selectedSubstation.location ?? selectedSubstation.code);
  }, [selectedSubstation]);

  function handleSelectPencawangMode(nextMode: PencawangMode) {
    setPencawangMode(nextMode);
    setError(null);

    if (nextMode === 'NEW') {
      setSelectedSubstationId('');
      setPencawangName('');
      setPencawangCode('');
      setFunctionalLocation('');
      setMainhead('');
      return;
    }

    const nextSubstation = substations[0];

    if (nextSubstation) {
      applyExistingSubstation(nextSubstation);
    }
  }

  function applyExistingSubstation(substation: Substation) {
    setSelectedSubstationId(substation.id);
    setPencawangName(substation.name);
    setPencawangCode(substation.code);
    setFunctionalLocation(substation.location ?? substation.code);
    setMainhead('');
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
      onOpenExistingVisit(joinedVisit);
    } catch (openError) {
      if (openError instanceof ApiError && openError.status === 401) {
        await onUnauthorized(openError);
        return;
      }

      if (isEndpointUnavailableError(openError)) {
        onOpenExistingVisit(visit);
        return;
      }

      setError(openError instanceof Error ? openError.message : 'Unable to open this active visit.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function buildCreateVisitPayload(): CreateSiteVisitInput | null {
    const normalizedPencawangName = pencawangName.trim();
    const normalizedPencawangCode = pencawangCode.trim();
    const normalizedFunctionalLocation = functionalLocation.trim();
    const normalizedMainhead = mainhead.trim();
    const parsedLatitude = parseCoordinate(checkInLatitude, -90, 90);
    const parsedAccuracy = parseNonNegativeNumber(checkInAccuracyMeters);

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

    if (parsedAccuracy === 'invalid') {
      setError('GPS accuracy must be a valid number greater than or equal to 0.');
      return null;
    }

    if (pencawangMode === 'EXISTING' && !selectedSubstationId) {
      setError('Please select an existing Pencawang.');
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

      if (!normalizedMainhead) {
        setError('MAINHEAD is required for a new Pencawang.');
        return null;
      }

      if (parsedLatitude === undefined || parsedLongitude === undefined) {
        setError('GPS latitude and longitude are required for a new Pencawang.');
        return null;
      }

      if (parsedAccuracy === undefined) {
        setError('GPS accuracy is required for a new Pencawang.');
        return null;
      }
    }

    return {
      teamId: selectedTeamId,
      substationId: pencawangMode === 'EXISTING' ? selectedSubstationId : undefined,
      visitType,
      pencawangName: normalizedPencawangName || undefined,
      pencawangCode: normalizedPencawangCode || undefined,
      functionalLocation: normalizedFunctionalLocation || undefined,
      mainhead: normalizedMainhead || undefined,
      checkInLatitude: parsedLatitude,
      checkInLongitude: parsedLongitude,
      checkInAccuracyMeters: parsedAccuracy,
      checkInCapturedAt: checkInCapturedAt ?? undefined,
      notes: notes.trim() || undefined,
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
          await onUnauthorized(uploadError);
          return;
        }

        if (!isEndpointUnavailableError(uploadError)) {
          Alert.alert(
            'Check-in created',
            'The site visit was created, but one or more site photos could not be uploaded. You can continue the visit and retry photos later if needed.',
          );
        }
      }

      onCreated(visit);
    } catch (createError) {
      if (createError instanceof ApiError && createError.status === 401) {
        await onUnauthorized(createError);
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
    setCheckInAccuracyMeters(
      typeof position.coords.accuracy === 'number' && Number.isFinite(position.coords.accuracy)
        ? formatAccuracyMeters(position.coords.accuracy)
        : '',
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

  return (
    <Screen
      title="Pencawang Check-In"
      subtitle="Start a shared site visit with the field details needed for SAVR work."
      actions={
        <>
          <InlineButton label="Back" onPress={onBack} disabled={isSubmitting} />
          <InlineButton label="Refresh" onPress={loadOptions} disabled={isSubmitting} />
        </>
      }
      keyboardAware
    >
      <ErrorBanner message={error} />
      {isLoading ? <LoadingBlock label="Loading teams, pencawang, and GPS..." /> : null}

      {!isLoading ? (
        <>
          <Card>
            <SectionTitle>Team and PIC</SectionTitle>
            {teams.length === 0 ? (
              <EmptyState
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
            <View style={styles.modeChoiceList}>
              <SelectCard
                label="Existing Pencawang"
                description="Select from master data"
                selected={pencawangMode === 'EXISTING'}
                onPress={() => handleSelectPencawangMode('EXISTING')}
              />
              <SelectCard
                label="New Pencawang"
                description="Enter site details manually"
                selected={pencawangMode === 'NEW'}
                onPress={() => handleSelectPencawangMode('NEW')}
              />
            </View>

            {pencawangMode === 'EXISTING' && substations.length === 0 ? (
              <EmptyState
                title="No substations"
                description="The backend did not return any active substations for this tenant."
              />
            ) : null}

            {pencawangMode === 'EXISTING' && substations.length > 0 ? (
              <View style={styles.selectList}>
                {substations.map((substation) => (
                  <SelectCard
                    key={substation.id}
                    label={`${substation.code} - ${substation.name}`}
                    description={substation.location || null}
                    selected={selectedSubstationId === substation.id}
                    onPress={() => applyExistingSubstation(substation)}
                  />
                ))}
              </View>
            ) : null}
            <TextField
              label={pencawangMode === 'NEW' ? 'Nama Pencawang *' : 'Nama Pencawang'}
              value={pencawangName}
              onChangeText={setPencawangName}
              placeholder="Nama pencawang di lokasi"
            />
            <TextField
              label={pencawangMode === 'NEW' ? 'Functional Location *' : 'Functional Location'}
              value={functionalLocation}
              onChangeText={setFunctionalLocation}
              placeholder="Functional location / alamat operasi"
            />
            <TextField
              label={pencawangMode === 'NEW' ? 'Kod Pencawang *' : 'Kod Pencawang'}
              value={pencawangCode}
              onChangeText={setPencawangCode}
              placeholder="Kod pencawang"
            />
            <TextField
              label={pencawangMode === 'NEW' ? 'MAINHEAD *' : 'MAINHEAD'}
              value={mainhead}
              onChangeText={setMainhead}
              placeholder="Masukkan MAINHEAD jika ada"
            />
          </Card>

          <Card>
            <SectionTitle>Visit Type</SectionTitle>
            <View style={styles.selectList}>
              {VISIT_TYPE_OPTIONS.map((option) => (
                <SelectCard
                  key={option.label}
                  label={option.label}
                  description={option.description}
                  selected={visitType === option.value}
                  onPress={() => setVisitType(option.value)}
                />
              ))}
            </View>
          </Card>

          <Card>
            <SectionTitle>GPS Location</SectionTitle>
            <BodyText muted>
              Capture device GPS at check-in. Manual coordinates are accepted when site GPS is weak.
            </BodyText>
            <TextField
              label="Latitude"
              value={checkInLatitude}
              onChangeText={handleManualLatitude}
              placeholder="e.g. 2.925900"
              keyboardType="numbers-and-punctuation"
            />
            <TextField
              label="Longitude"
              value={checkInLongitude}
              onChangeText={handleManualLongitude}
              placeholder="e.g. 101.690000"
              keyboardType="numbers-and-punctuation"
            />
            <TextField
              label={pencawangMode === 'NEW' ? 'GPS Accuracy (m) *' : 'GPS Accuracy (m)'}
              value={checkInAccuracyMeters}
              onChangeText={setCheckInAccuracyMeters}
              placeholder="e.g. 8"
              keyboardType="numbers-and-punctuation"
            />
            <AppButton
              label={isLocating ? 'Reading Current GPS...' : 'Use Current GPS'}
              onPress={handleUseCurrentGps}
              variant="secondary"
              loading={isLocating}
              disabled={isSubmitting}
            />
            {hasLocationPermission === false ? (
              <BodyText muted>Location permission is off right now. Manual GPS coordinates still work.</BodyText>
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

function formatAccuracyMeters(value: number) {
  return value.toFixed(1).replace(/\.0$/, '');
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

function parseNonNegativeNumber(rawValue: string) {
  const normalizedValue = rawValue.trim();

  if (!normalizedValue) {
    return undefined;
  }

  const parsedValue = Number(normalizedValue);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return 'invalid' as const;
  }

  return parsedValue;
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
  modeChoiceList: {
    gap: 10,
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
});
