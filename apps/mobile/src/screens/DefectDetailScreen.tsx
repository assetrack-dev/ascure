import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  captureWithCamera,
  type DefectMark,
} from '../camera/captureWithCamera';
import { MarkOverlay } from '../camera/MarkOverlay';
import { TimestampStamp } from '../camera/TimestampStamp';
import { TiltOverlay } from '../camera/TiltOverlay';
import * as Location from 'expo-location';
import { captureRef } from 'react-native-view-shot';
import {
  ActivityIndicator,
  Alert,
  Image,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api, ApiError, API_BASE_URL } from '../api';
import { getPositionWithTimeout } from '../location';
import { useSession } from '../context/AuthContext';
import type { ImagePreviewParams, RootStackScreenProps } from '../navigation/types';
import {
  DefectAssignmentOption,
  DefectAssignmentOptions,
  DefectDetail,
  DefectEvidenceImage,
  DefectResolutionOutcome,
  DefectStatus,
  InspectionImage,
} from '../types';
import {
  formatDateTime,
  normalizeOperationalPayloadText,
  severityToMarkCategory,
} from '../utils';
import { BottomCTA, Screen } from '../ui';
import { Feather } from '@expo/vector-icons';
import { Theme, useTheme } from '../theme';

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');
const MAINTENANCE_OUTCOMES: DefectResolutionOutcome[] = [
  'RESOLVED',
  'TEMPORARY_FIX',
  'MONITORING_REQUIRED',
  'EXTERNAL_CONSTRAINT',
  'DEFERRED',
];

type CapturedMaintenanceProofPhoto = {
  id: string;
  uri: string;
  timestamp: string;
  latitude?: number | null;
  longitude?: number | null;
};

type PendingMaintenanceProofOverlayPhoto = Omit<CapturedMaintenanceProofPhoto, 'id' | 'uri'> & {
  timestampLabel: string;
  originalUri: string;
  captureWidth: number;
  captureHeight: number;
  layoutWidth: number;
  layoutHeight: number;
  tiltLineAngle?: number | null;
  mark?: DefectMark | null;
};

export function DefectDetailScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'DefectDetail'>['navigation']>();
  const route = useRoute<RootStackScreenProps<'DefectDetail'>['route']>();
  const { defectId } = route.params;
  const { token, user, handleUnauthorized } = useSession();
  const [defect, setDefect] = useState<DefectDetail | null>(null);
  const [actionRemark, setActionRemark] = useState('');
  const [maintenanceNote, setMaintenanceNote] = useState('');
  const [closureNote, setClosureNote] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const [resolutionOutcome, setResolutionOutcome] =
    useState<DefectResolutionOutcome>('RESOLVED');
  const [proofPhotos, setProofPhotos] = useState<CapturedMaintenanceProofPhoto[]>([]);
  const [pendingOverlayPhoto, setPendingOverlayPhoto] =
    useState<PendingMaintenanceProofOverlayPhoto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState<DefectStatus | null>(null);
  const [savingMaintenanceAction, setSavingMaintenanceAction] = useState<
    'start' | 'capture' | 'complete' | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  // Maintenance-manager dispatch (self-management): assign within the company or
  // delegate to a subcontractor. Gated to managers; the server is authoritative.
  const canDispatch = user.role === 'MANAGER' || user.role === 'ADMIN';
  const [dispatchOptions, setDispatchOptions] =
    useState<DefectAssignmentOptions | null>(null);
  const [selectedAssignTeamId, setSelectedAssignTeamId] = useState<string | null>(
    null,
  );
  const [selectedAssignUserId, setSelectedAssignUserId] = useState<string | null>(
    null,
  );
  const [selectedDelegateOrgId, setSelectedDelegateOrgId] = useState<
    string | null
  >(null);
  const [dispatchAction, setDispatchAction] = useState<
    'assign' | 'delegate' | null
  >(null);
  // Tracks the defect currently in focus so a late assignment-options response
  // for a defect we've navigated away from (EmergencyWatcher can swap defectId
  // in place) is ignored rather than clobbering the new defect's options.
  const dispatchDefectIdRef = useRef(defectId);
  const overlayCaptureRef = useRef<View>(null);
  const overlayPromiseHandlersRef = useRef<{
    resolve: (uri: string) => void;
    reject: (error: Error) => void;
  } | null>(null);
  // Resolves when the off-screen overlay <Image> has actually decoded + drawn
  // (onLoad). The burn used to wait a FIXED 400 ms instead, and any device
  // whose full-res JPEG decoded slower produced a BLANK proof photo — or, when
  // the capture landed mid Image fade-in, a uniformly DARKER one (v2.0.5 bug).
  const overlayImageLoadRef = useRef<{
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);

  const loadDefectDetail = useCallback(
    async (showLoading = true) => {
      try {
        if (showLoading) {
          setIsLoading(true);
        }
        setError(null);

        const response = await api.getDefectDetail(token, defectId);
        setDefect(response);
        setActionRemark(response.actionRemark ?? '');
        setMaintenanceNote(response.maintenanceNotes ?? response.actionRemark ?? '');
        setResolutionOutcome(
          isMaintenanceOutcome(response.resolutionOutcome)
            ? response.resolutionOutcome
            : 'RESOLVED',
        );
        setClosureNote(
          response.closureVerificationNotes ?? response.closureRemarks ?? '',
        );
      } catch (loadError) {
        console.error('[DEFECT DETAIL LOAD ERROR]', loadError);

        if (loadError instanceof ApiError && loadError.status === 401) {
          await handleUnauthorized(loadError);
          return;
        }

        setDefect(null);
        setError(loadError instanceof Error ? loadError.message : 'Unable to load defect detail.');
      } finally {
        if (showLoading) {
          setIsLoading(false);
        }
      }
    },
    [defectId, handleUnauthorized, token],
  );

  useEffect(() => {
    loadDefectDetail();
  }, [loadDefectDetail]);

  const loadDispatchOptions = useCallback(async () => {
    if (!canDispatch) {
      return;
    }
    const requestedDefectId = defectId;
    try {
      const options = await api.getDefectAssignmentOptions(token, defectId);
      if (dispatchDefectIdRef.current !== requestedDefectId) {
        return;
      }
      setDispatchOptions(options);
    } catch (optionsError) {
      if (optionsError instanceof ApiError && optionsError.status === 401) {
        await handleUnauthorized(optionsError);
        return;
      }
      if (dispatchDefectIdRef.current !== requestedDefectId) {
        return;
      }
      // ONLY a genuine 403 means "this account can't dispatch" — then hide the
      // panel. A transient/offline blip keeps whatever options we already had so
      // a network hiccup doesn't silently collapse the card (offline-prone field
      // app); the defect itself surfaces its own load error.
      if (optionsError instanceof ApiError && optionsError.status === 403) {
        setDispatchOptions(null);
      }
    }
  }, [canDispatch, defectId, handleUnauthorized, token]);

  useEffect(() => {
    loadDispatchOptions();
  }, [loadDispatchOptions]);

  useEffect(() => {
    dispatchDefectIdRef.current = defectId;
    setProofPhotos([]);
    setPendingOverlayPhoto(null);
    overlayPromiseHandlersRef.current = null;
    overlayImageLoadRef.current = null;
    setSelectedAssignTeamId(null);
    setSelectedAssignUserId(null);
    setSelectedDelegateOrgId(null);
    // Drop the previous defect's options immediately so the Dispatch card never
    // renders a stale roster while the refetch is in flight.
    setDispatchOptions(null);
  }, [defectId]);

  async function handleAssignDispatch() {
    if (!selectedAssignTeamId && !selectedAssignUserId) {
      return;
    }
    try {
      setDispatchAction('assign');
      setError(null);
      const updated = await api.assignDefect(token, defectId, {
        assignedToTeamId: selectedAssignTeamId,
        assignedToUserId: selectedAssignUserId,
      });
      setDefect(updated);
      setSelectedAssignTeamId(null);
      setSelectedAssignUserId(null);
      await loadDispatchOptions();
    } catch (assignError) {
      if (assignError instanceof ApiError && assignError.status === 401) {
        await handleUnauthorized(assignError);
        return;
      }
      const message =
        assignError instanceof Error
          ? assignError.message
          : 'Unable to assign defect.';
      setError(message);
      // The Dispatch card sits well down the scroll, so also surface the failure
      // at the point of action (the top error banner is off-screen here).
      Alert.alert('Assign failed', message);
    } finally {
      setDispatchAction(null);
    }
  }

  async function handleDelegateDispatch() {
    if (!selectedDelegateOrgId) {
      return;
    }
    try {
      setDispatchAction('delegate');
      setError(null);
      const updated = await api.delegateDefect(
        token,
        defectId,
        selectedDelegateOrgId,
      );
      setDefect(updated);
      setSelectedDelegateOrgId(null);
      await loadDispatchOptions();
    } catch (delegateError) {
      if (delegateError instanceof ApiError && delegateError.status === 401) {
        await handleUnauthorized(delegateError);
        return;
      }
      const message =
        delegateError instanceof Error
          ? delegateError.message
          : 'Unable to delegate defect.';
      setError(message);
      Alert.alert('Delegate failed', message);
    } finally {
      setDispatchAction(null);
    }
  }

  useEffect(() => {
    if (!pendingOverlayPhoto) {
      return;
    }

    let isCancelled = false;

    const renderOverlayPhoto = async () => {
      try {
        // Deterministic: wait for the photo Image to report onLoad (however
        // slow the device), then one paint for the loaded frame to draw. A
        // fixed delay here is what produced blank/darker photos in the field.
        await waitForOverlayImageLoad(overlayImageLoadRef.current);
        await waitForNextPaint();
        await delay(50);

        if (!overlayCaptureRef.current) {
          throw new Error('Unable to prepare the overlaid proof image.');
        }

        const overlayUri = await captureRef(overlayCaptureRef, {
          format: 'jpg',
          quality: 0.9,
          result: 'tmpfile',
          width: pendingOverlayPhoto.captureWidth,
          height: pendingOverlayPhoto.captureHeight,
        });

        if (isCancelled) {
          return;
        }

        overlayPromiseHandlersRef.current?.resolve(overlayUri);
      } catch (overlayError) {
        if (isCancelled) {
          return;
        }

        overlayPromiseHandlersRef.current?.reject(
          overlayError instanceof Error
            ? overlayError
            : new Error('Unable to create the overlaid proof image.'),
        );
      } finally {
        if (!isCancelled) {
          overlayPromiseHandlersRef.current = null;
          overlayImageLoadRef.current = null;
          setPendingOverlayPhoto(null);
        }
      }
    };

    renderOverlayPhoto();

    return () => {
      isCancelled = true;
    };
  }, [pendingOverlayPhoto]);

  async function handleUpdateStatus(status: DefectStatus) {
    try {
      setSavingStatus(status);
      setError(null);

      await api.updateDefectStatus(
        token,
        defectId,
        status,
        normalizeOperationalPayloadText(actionRemark) ?? null,
      );
      await loadDefectDetail(false);
    } catch (updateError) {
      console.error('[DEFECT STATUS UPDATE ERROR]', updateError);

      if (updateError instanceof ApiError && updateError.status === 401) {
        await handleUnauthorized(updateError);
        return;
      }

      setError(updateError instanceof Error ? updateError.message : 'Unable to update defect status.');
    } finally {
      setSavingStatus(null);
    }
  }

  async function handleMarkInProgress() {
    try {
      setSavingMaintenanceAction('start');
      setError(null);

      await api.updateDefectStatus(
        token,
        defectId,
        'IN_PROGRESS',
        normalizeOperationalPayloadText(maintenanceNote) ?? null,
      );
      await loadDefectDetail(false);
    } catch (updateError) {
      console.error('[DEFECT MAINTENANCE START ERROR]', updateError);

      if (updateError instanceof ApiError && updateError.status === 401) {
        await handleUnauthorized(updateError);
        return;
      }

      setError(updateError instanceof Error ? updateError.message : 'Unable to mark maintenance in progress.');
    } finally {
      setSavingMaintenanceAction(null);
    }
  }

  async function captureMaintenanceProofPhoto() {
    try {
      setSavingMaintenanceAction('capture');
      setError(null);

      const capturedAsset = await captureWithCamera({
        mode: 'photo',
        allowMark: true,
        initialMarkCategory: severityToMarkCategory(defect?.severity),
      });

      if (!capturedAsset) {
        return;
      }

      const capturedAt = new Date();
      const timestamp = capturedAt.toISOString();
      const position = await getOptionalCurrentPosition();
      const latitude = position?.coords.latitude ?? null;
      const longitude = position?.coords.longitude ?? null;
      const overlayImageUri = await createOverlayPhoto({
        originalUri: capturedAsset.uri,
        timestamp,
        timestampLabel: formatPhotoTimestampLabel(capturedAt),
        latitude,
        longitude,
        tiltLineAngle: capturedAsset.tiltLineAngle ?? null,
        mark: capturedAsset.mark ?? null,
        ...(await getOverlayCaptureSize(
          capturedAsset.uri,
          capturedAsset.width,
          capturedAsset.height,
        )),
      });

      setProofPhotos((current) => [
        ...current,
        {
          id: createLocalProofPhotoId(timestamp),
          uri: overlayImageUri,
          timestamp,
          latitude,
          longitude,
        },
      ]);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : 'Unable to capture proof photo.');
    } finally {
      setSavingMaintenanceAction(null);
    }
  }

  function createOverlayPhoto(photo: PendingMaintenanceProofOverlayPhoto) {
    return new Promise<string>((resolve, reject) => {
      overlayPromiseHandlersRef.current = {
        resolve,
        reject,
      };
      overlayImageLoadRef.current = createOverlayImageLoadSignal();
      setPendingOverlayPhoto(photo);
    });
  }

  function handleRemoveProofPhoto(photoId: string) {
    setProofPhotos((current) => current.filter((photo) => photo.id !== photoId));
  }

  async function uploadPendingProofPhotos(note: string | null) {
    const pendingPhotos = [...proofPhotos];

    for (const proofPhoto of pendingPhotos) {
      await api.uploadDefectEvidenceImage(token, defectId, {
        uri: proofPhoto.uri,
        timestamp: proofPhoto.timestamp,
        latitude: proofPhoto.latitude,
        longitude: proofPhoto.longitude,
        note,
      });
      setProofPhotos((current) => current.filter((photo) => photo.id !== proofPhoto.id));
    }
  }

  async function handleMaintenanceCompleted() {
    try {
      setSavingMaintenanceAction('complete');
      setError(null);

      const normalizedNote = normalizeOperationalPayloadText(maintenanceNote) ?? null;

      if (proofPhotos.length > 0) {
        await uploadPendingProofPhotos(normalizedNote);
        setProofPhotos([]);
      }

      await api.completeDefectMaintenance(token, defectId, {
        resolutionOutcome,
        maintenanceNotes: normalizedNote,
      });
      await loadDefectDetail(false);
    } catch (completionError) {
      console.error('[DEFECT MAINTENANCE COMPLETION ERROR]', completionError);

      if (completionError instanceof ApiError && completionError.status === 401) {
        await handleUnauthorized(completionError);
        return;
      }

      setError(
        completionError instanceof Error
          ? completionError.message
          : 'Unable to complete maintenance.',
      );
    } finally {
      setSavingMaintenanceAction(null);
    }
  }

  async function handleVerifyClosure() {
    try {
      setIsClosing(true);
      setError(null);

      await api.verifyDefectClosure(token, defectId, {
        closureRemarks: normalizeOperationalPayloadText(closureNote) ?? null,
      });
      await loadDefectDetail(false);
    } catch (closeError) {
      console.error('[DEFECT CLOSURE ERROR]', closeError);

      if (closeError instanceof ApiError && closeError.status === 401) {
        await handleUnauthorized(closeError);
        return;
      }

      setError(closeError instanceof Error ? closeError.message : 'Unable to close defect.');
    } finally {
      setIsClosing(false);
    }
  }

  const lifecycleStatus = defect
    ? getDisplayLifecycleStatus(defect.lifecycleStatus)
    : null;
  // Maintenance + closure are restricted server-side to the assigned maintainer
  // (or ADMIN). The EMERGENCY group surfaces other maintainers' defects too, so
  // gate the action buttons on ownership to avoid showing controls that 403.
  const isAssignedToMe = defect
    ? defect.assignedToUserId === user.id || defect.assignedUserId === user.id
    : false;
  const canActOnMaintenance = isAssignedToMe || user.role === 'ADMIN';
  const canShowMaintenanceActions =
    canActOnMaintenance &&
    (defect
      ? ['ASSIGNED', 'IN_PROGRESS'].includes(getDisplayLifecycleStatus(defect.lifecycleStatus)) ||
        defect.status === 'IN_PROGRESS'
      : false);
  const canVerifyClosure =
    canActOnMaintenance &&
    defect?.status !== 'CLOSED' &&
    (lifecycleStatus === 'COMPLETED' || lifecycleStatus === 'VERIFICATION_PENDING');
  const proofImages = defect?.maintenanceProofImages?.length
    ? defect.maintenanceProofImages
    : defect?.evidenceImages ?? [];

  // Severity leads the hero; a critical/high (or emergency) defect gets the deep
  // red treatment so it's unmissable outdoors (handoff 1e).
  const isEmergency = Boolean(defect?.isEmergency);
  const isCriticalSeverity =
    defect?.severity === 'CRITICAL' || defect?.severity === 'HIGH' || isEmergency;

  // The one action that matters, pinned to the bottom CTA (handoff 1e). It mirrors
  // the highest-priority *existing* maintenance handler for the current state —
  // the in-card action stacks stay authoritative; this is a thumb-reach shortcut.
  const primaryCta: {
    label: string;
    hint: string;
    onPress: () => void;
    loading: boolean;
    variant: 'primary' | 'danger';
  } | null = !defect
    ? null
    : canVerifyClosure
      ? {
          label: 'Verify & Close Defect',
          hint: 'Closing...',
          onPress: handleVerifyClosure,
          loading: isClosing,
          variant: 'primary',
        }
      : canShowMaintenanceActions
        ? {
            label: isEmergency ? 'Claim & Start Repair' : 'Mark In Progress',
            hint: 'Saving...',
            onPress: handleMarkInProgress,
            loading: savingMaintenanceAction === 'start',
            variant: isCriticalSeverity ? 'danger' : 'primary',
          }
        : null;

  return (
    <Screen
      title="Defect Detail"
      subtitle={defect?.assetCode}
      leftAction={{
        icon: 'back',
        onPress: () => navigation.goBack(),
        accessibilityLabel: 'Back',
      }}
      bottomBar={
        primaryCta ? (
          <BottomCTA
            label={primaryCta.label}
            hint={primaryCta.hint}
            onPress={primaryCta.onPress}
            variant={primaryCta.variant}
            loading={primaryCta.loading}
            disabled={savingMaintenanceAction !== null || isClosing}
          />
        ) : undefined
      }
    >
        {isLoading ? (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 36, gap: 12 }}>
            <ActivityIndicator size="large" color={theme.colors.info} />
            <Text style={{ fontSize: 15, color: theme.colors.textSecondary }}>Loading defect detail...</Text>
          </View>
        ) : null}

        {!isLoading && error ? (
          <View
            style={{
              backgroundColor: theme.colors.dangerSoft,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.colors.dangerBorder,
              padding: 14,
              gap: 12,
            }}
          >
            <Text style={{ fontSize: 14, lineHeight: 20, color: theme.colors.dangerText, fontWeight: '600' }}>
              {error}
            </Text>
            <Pressable
              onPress={() => loadDefectDetail()}
              style={({ pressed }) => ({
                minHeight: 46,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.colors.card,
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: theme.colors.dangerText }}>Try Again</Text>
            </Pressable>
          </View>
        ) : null}

        {!isLoading && !error && !defect ? (
          <View
            style={{
              backgroundColor: theme.colors.background,
              borderRadius: 16,
              padding: 18,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: '700', color: theme.colors.textPrimary }}>
              Defect not found.
            </Text>
          </View>
        ) : null}

        {!isLoading && defect ? (
          <>
            {/* Severity-led hero (handoff 1e) — full-width color header so an
                emergency reads instantly outdoors. */}
            <View style={[styles.hero, isCriticalSeverity ? styles.heroCritical : styles.heroNeutral]}>
              <View style={styles.heroTopRow}>
                <View
                  style={[
                    styles.heroSevBadge,
                    isEmergency ? styles.heroSevBadgeEmergency : styles.heroSevBadgeDefault,
                  ]}
                >
                  {isEmergency ? (
                    <Feather name="alert-triangle" size={13} color={theme.colors.dangerText} />
                  ) : null}
                  <Text
                    style={[
                      styles.heroSevBadgeText,
                      isEmergency
                        ? styles.heroSevBadgeTextEmergency
                        : styles.heroSevBadgeTextDefault,
                    ]}
                  >
                    {isEmergency ? 'EMERGENCY' : formatEnumLabel(defect.severity).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.heroCode} numberOfLines={1}>
                  {defect.assetCode || 'Unknown asset'}
                </Text>
              </View>
              <Text style={styles.heroTitle}>{defect.label}</Text>
              <View style={styles.heroLocRow}>
                <Feather name="map-pin" size={14} color="rgba(255,255,255,0.72)" />
                <Text style={styles.heroLocText} numberOfLines={2}>
                  {[defect.assetType, defect.cycleNumber ? `Cycle ${defect.cycleNumber}` : null]
                    .filter(Boolean)
                    .join(' · ') || 'No asset type'}
                </Text>
              </View>
            </View>

            {/* Photo strip — before/proof thumbnails + "+N" (handoff 1e). */}
            <PhotoStrip
              images={proofImages.length ? proofImages : defect.images}
              onOpenImagePreview={(params) => navigation.navigate('ImagePreview', params)}
            />

            {/* 3-up key facts (handoff 1e). */}
            <View style={styles.factRow}>
              <KeyFact label="Severity" value={formatEnumLabel(defect.severity)} emphasize={isCriticalSeverity} />
              <KeyFact label="Asset type" value={defect.assetType || 'Not set'} />
              <KeyFact
                label="Status"
                value={formatStatus(getDisplayLifecycleStatus(defect.lifecycleStatus))}
              />
            </View>

            {/* Vertical lifecycle timeline (handoff 1e). */}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Lifecycle</Text>
              <LifecycleTimeline defect={defect} />
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Workflow</Text>
              <InfoRow label="Lifecycle Status" value={formatEnumLabel(getDisplayLifecycleStatus(defect.lifecycleStatus))} />
              <InfoRow label="Resolution Outcome" value={formatEnumLabel(defect.resolutionOutcome)} />
              <InfoRow label="Assigned" value={formatDateTime(defect.assignedAt)} />
              <InfoRow label="QA/QC Verified" value={formatDateTime(defect.verifiedAt)} />
              <InfoRow label="Maintained" value={formatDateTime(defect.maintainedAt)} />
              <InfoRow label="Closure Verified" value={formatDateTime(defect.closureVerifiedAt)} />
              <NoteBlock
                label="Maintenance Notes"
                value={defect.maintenanceNotes}
              />
              <NoteBlock
                label="Closure Verification Notes"
                value={defect.closureVerificationNotes ?? defect.closureRemarks}
              />
              {isGovernanceException(defect) ? (
                <NoteBlock
                  label="Exception Notes"
                  value={getExceptionNotes(defect)}
                />
              ) : null}
            </View>

            {canDispatch &&
            dispatchOptions &&
            (dispatchOptions.canAssign || dispatchOptions.canDelegate) ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Dispatch</Text>

                {dispatchOptions.canAssign ? (
                  <>
                    {dispatchOptions.teams.length > 0 ? (
                      <View style={styles.outcomeWrap}>
                        <Text style={styles.controlLabel}>Assign to team</Text>
                        {dispatchOptions.teams.map((team) => (
                          <DispatchPill
                            key={team.id}
                            label={optionLabel(team)}
                            selected={selectedAssignTeamId === team.id}
                            disabled={dispatchAction !== null}
                            onPress={() => {
                              setSelectedAssignTeamId(team.id);
                              setSelectedAssignUserId(null);
                            }}
                          />
                        ))}
                      </View>
                    ) : null}

                    {dispatchOptions.users.length > 0 ? (
                      <View style={styles.outcomeWrap}>
                        <Text style={styles.controlLabel}>Or a technician</Text>
                        {dispatchOptions.users.map((member) => (
                          <DispatchPill
                            key={member.id}
                            label={optionLabel(member)}
                            selected={selectedAssignUserId === member.id}
                            disabled={dispatchAction !== null}
                            onPress={() => {
                              setSelectedAssignUserId(member.id);
                              setSelectedAssignTeamId(null);
                            }}
                          />
                        ))}
                      </View>
                    ) : null}

                    <View style={styles.actionStack}>
                      <Pressable
                        disabled={
                          dispatchAction !== null ||
                          (!selectedAssignTeamId && !selectedAssignUserId)
                        }
                        onPress={handleAssignDispatch}
                        style={({ pressed }) => [
                          styles.maintenanceButton,
                          styles.maintenanceButtonBlue,
                          (dispatchAction !== null ||
                            (!selectedAssignTeamId && !selectedAssignUserId)) &&
                            styles.disabledButton,
                          pressed && dispatchAction === null && styles.pressedButton,
                        ]}
                      >
                        {dispatchAction === 'assign' ? (
                          <ActivityIndicator color={theme.colors.info} />
                        ) : null}
                        <Text style={styles.maintenanceButtonBlueText}>
                          {dispatchAction === 'assign' ? 'Assigning...' : 'Assign'}
                        </Text>
                      </Pressable>
                    </View>
                  </>
                ) : null}

                {dispatchOptions.canDelegate ? (
                  <>
                    <View style={styles.outcomeWrap}>
                      <Text style={styles.controlLabel}>
                        Delegate to subcontractor
                      </Text>
                      {dispatchOptions.subcontractors.map((organization) => (
                        <DispatchPill
                          key={organization.id}
                          label={optionLabel(organization)}
                          selected={selectedDelegateOrgId === organization.id}
                          disabled={dispatchAction !== null}
                          onPress={() => setSelectedDelegateOrgId(organization.id)}
                        />
                      ))}
                    </View>
                    <View style={styles.actionStack}>
                      <Pressable
                        disabled={dispatchAction !== null || !selectedDelegateOrgId}
                        onPress={handleDelegateDispatch}
                        style={({ pressed }) => [
                          styles.maintenanceButton,
                          styles.maintenanceButtonNeutral,
                          (dispatchAction !== null || !selectedDelegateOrgId) &&
                            styles.disabledButton,
                          pressed && dispatchAction === null && styles.pressedButton,
                        ]}
                      >
                        {dispatchAction === 'delegate' ? (
                          <ActivityIndicator color={theme.colors.textPrimary} />
                        ) : null}
                        <Text style={styles.maintenanceButtonNeutralText}>
                          {dispatchAction === 'delegate'
                            ? 'Delegating...'
                            : 'Delegate'}
                        </Text>
                      </Pressable>
                    </View>
                  </>
                ) : null}
              </View>
            ) : null}

            {canShowMaintenanceActions ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Maintenance</Text>
                <InfoRow label="Assigned To" value={defect.assignedTo || 'Unassigned'} />
                <TextInput
                  value={maintenanceNote}
                  onChangeText={setMaintenanceNote}
                  placeholder="Add maintenance note"
                  placeholderTextColor={theme.colors.textMuted}
                  multiline
                  autoCapitalize="characters"
                  textAlignVertical="top"
                  style={styles.noteInput}
                />
                <View style={styles.outcomeWrap}>
                  <Text style={styles.controlLabel}>Outcome</Text>
                  {MAINTENANCE_OUTCOMES.map((outcome) => (
                    <OutcomeButton
                      key={outcome}
                      outcome={outcome}
                      selectedOutcome={resolutionOutcome}
                      onPress={setResolutionOutcome}
                    />
                  ))}
                </View>

                <View style={styles.proofSection}>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.controlLabel}>After Proof</Text>
                    <Text style={styles.countPill}>{proofPhotos.length}</Text>
                  </View>
                  {proofPhotos.length > 0 ? (
                    <View style={styles.evidenceGrid}>
                      {proofPhotos.map((photo, index) => (
                        <View key={photo.id} style={styles.evidenceTile}>
                          <TouchableOpacity
                            activeOpacity={0.85}
                            onPress={() =>
                              navigation.navigate('ImagePreview', {
                                images: proofPhotos.map((proofPhoto, proofIndex) => ({
                                  uri: proofPhoto.uri,
                                  title: `Proof ${proofIndex + 1}`,
                                })),
                                index,
                              })
                            }
                          >
                            <Image
                              source={{ uri: photo.uri }}
                              style={styles.evidenceImage}
                              resizeMode="cover"
                            />
                          </TouchableOpacity>
                          <View style={styles.evidenceMeta}>
                            <Text style={styles.evidenceTitle}>After {index + 1}</Text>
                            <Text style={styles.evidenceMetaText} numberOfLines={1}>
                              {formatDateTime(photo.timestamp)}
                            </Text>
                            {hasCoordinatePair(photo.latitude, photo.longitude) ? (
                              <Text style={styles.evidenceMetaText} numberOfLines={1}>
                                GPS {formatCoordinatePairCompact(photo.latitude, photo.longitude)}
                              </Text>
                            ) : null}
                            <Pressable
                              disabled={savingMaintenanceAction !== null}
                              onPress={() => handleRemoveProofPhoto(photo.id)}
                              style={({ pressed }) => [
                                styles.smallDangerButton,
                                savingMaintenanceAction !== null && styles.disabledButton,
                                pressed && savingMaintenanceAction === null && styles.pressedButton,
                              ]}
                            >
                              <Text style={styles.smallDangerButtonText}>Remove</Text>
                            </Pressable>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <View style={styles.compactEmptyPanel}>
                      <Text style={styles.mutedText}>No proof images</Text>
                    </View>
                  )}
                  {savingMaintenanceAction === 'complete' && proofPhotos.length > 0 ? (
                    <Text style={styles.uploadText}>
                      Uploading {proofPhotos.length} proof image{proofPhotos.length === 1 ? '' : 's'}...
                    </Text>
                  ) : null}
                </View>

                <View style={styles.actionStack}>
                  <Pressable
                    disabled={savingMaintenanceAction !== null}
                    onPress={handleMarkInProgress}
                    style={({ pressed }) => [
                      styles.maintenanceButton,
                      styles.maintenanceButtonBlue,
                      savingMaintenanceAction && savingMaintenanceAction !== 'start' && styles.disabledButton,
                      pressed && !savingMaintenanceAction && styles.pressedButton,
                    ]}
                  >
                    {savingMaintenanceAction === 'start' ? <ActivityIndicator color={theme.colors.info} /> : null}
                    <Text style={styles.maintenanceButtonBlueText}>
                      {savingMaintenanceAction === 'start' ? 'Saving...' : 'Mark In Progress'}
                    </Text>
                  </Pressable>

                  <Pressable
                    disabled={savingMaintenanceAction !== null}
                    onPress={captureMaintenanceProofPhoto}
                    style={({ pressed }) => [
                      styles.maintenanceButton,
                      styles.maintenanceButtonNeutral,
                      savingMaintenanceAction && savingMaintenanceAction !== 'capture' && styles.disabledButton,
                      pressed && !savingMaintenanceAction && styles.pressedButton,
                    ]}
                  >
                    {savingMaintenanceAction === 'capture' ? <ActivityIndicator color={theme.colors.textPrimary} /> : null}
                    <Text style={styles.maintenanceButtonNeutralText}>
                      {savingMaintenanceAction === 'capture'
                        ? 'Opening Camera...'
                        : proofPhotos.length > 0
                          ? 'Add Proof Image'
                          : 'Capture Repair Proof'}
                    </Text>
                  </Pressable>

                  <Pressable
                    disabled={savingMaintenanceAction !== null}
                    onPress={handleMaintenanceCompleted}
                    style={({ pressed }) => [
                      styles.maintenanceButton,
                      styles.maintenanceButtonGreen,
                      savingMaintenanceAction && savingMaintenanceAction !== 'complete' && styles.disabledButton,
                      pressed && !savingMaintenanceAction && styles.pressedButton,
                    ]}
                  >
                    {savingMaintenanceAction === 'complete' ? <ActivityIndicator color={theme.colors.success} /> : null}
                    <Text style={styles.maintenanceButtonGreenText}>
                      {savingMaintenanceAction === 'complete'
                        ? 'Completing...'
                        : 'Mark Maintenance Completed'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {canVerifyClosure ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Closure</Text>
                <Text style={styles.mutedText}>
                  Maintenance is complete. Verify the repair and close this defect.
                </Text>
                <TextInput
                  value={closureNote}
                  onChangeText={setClosureNote}
                  placeholder="Add closure note (optional)"
                  placeholderTextColor={theme.colors.textMuted}
                  multiline
                  autoCapitalize="characters"
                  textAlignVertical="top"
                  style={styles.noteInput}
                />
                <Pressable
                  disabled={isClosing}
                  onPress={handleVerifyClosure}
                  style={({ pressed }) => [
                    styles.maintenanceButton,
                    styles.maintenanceButtonGreen,
                    isClosing && styles.disabledButton,
                    pressed && !isClosing && styles.pressedButton,
                  ]}
                >
                  {isClosing ? <ActivityIndicator color={theme.colors.success} /> : null}
                  <Text style={styles.maintenanceButtonGreenText}>
                    {isClosing ? 'Closing...' : 'Verify & Close Defect'}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {pendingOverlayPhoto ? (
              <View pointerEvents="none" style={styles.overlayCaptureRoot}>
                <View
                  ref={overlayCaptureRef}
                  collapsable={false}
                  style={[
                    styles.overlayCaptureCanvas,
                    {
                      width: pendingOverlayPhoto.layoutWidth,
                      height: pendingOverlayPhoto.layoutHeight,
                    },
                  ]}
                >
                  <Image
                    source={{ uri: pendingOverlayPhoto.originalUri }}
                    style={styles.overlayCaptureImage}
                    resizeMode="cover"
                    // No fade-in: the burn snapshot must never catch the photo
                    // at partial opacity (the "darker photo" half of the bug).
                    fadeDuration={0}
                    onLoad={() => overlayImageLoadRef.current?.resolve()}
                    onError={() =>
                      overlayImageLoadRef.current?.reject(
                        new Error('Could not render the captured photo. Please retake it.'),
                      )
                    }
                  />
                  {pendingOverlayPhoto.tiltLineAngle != null ? (
                    <TiltOverlay angleDeg={pendingOverlayPhoto.tiltLineAngle} />
                  ) : null}
                  {pendingOverlayPhoto.mark ? (
                    <MarkOverlay mark={pendingOverlayPhoto.mark} />
                  ) : null}
                  <View style={styles.overlayStampWrap}>
                    <TimestampStamp
                      date={new Date(pendingOverlayPhoto.timestamp)}
                      latitude={pendingOverlayPhoto.latitude ?? null}
                      longitude={pendingOverlayPhoto.longitude ?? null}
                    />
                  </View>
                </View>
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Evidence</Text>
              <NoteBlock
                label="Verification Notes"
                value={defect.verificationNotes ?? defect.verificationRemarks}
              />
              <NoteBlock
                label="Maintenance Notes"
                value={defect.maintenanceNotes}
              />
              <NoteBlock
                label="Closure Notes"
                value={defect.closureVerificationNotes ?? defect.closureRemarks}
              />
              <EvidenceGrid
                title="After Proof"
                images={proofImages}
                emptyText="No maintenance proof"
                titlePrefix="After"
                onOpenImagePreview={(params) => navigation.navigate('ImagePreview', params)}
              />
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Defect</Text>
              <Text style={styles.defectLabel}>
                {defect.label}
              </Text>
              <View style={styles.noteBlock}>
                <Text style={styles.noteLabel}>Checklist Remark</Text>
                <Text style={[styles.noteValue, !defect.checklistRemark && styles.noteValueMuted]}>
                  {defect.checklistRemark || 'No remark.'}
                </Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Action Remark</Text>
              <TextInput
                value={actionRemark}
                onChangeText={setActionRemark}
                placeholder="Add action taken or follow-up note"
                placeholderTextColor={theme.colors.textMuted}
                multiline
                autoCapitalize="characters"
                textAlignVertical="top"
                style={styles.noteInput}
              />
              <View style={styles.actionStack}>
                <StatusButton
                  label="Mark Open"
                  status="OPEN"
                  currentStatus={defect.status}
                  savingStatus={savingStatus}
                  onPress={handleUpdateStatus}
                />
                <StatusButton
                  label="Mark In Progress"
                  status="IN_PROGRESS"
                  currentStatus={defect.status}
                  savingStatus={savingStatus}
                  onPress={handleUpdateStatus}
                />
              </View>
            </View>

            <View style={styles.card}>
              <EvidenceGrid
                title="Before / Inspection"
                images={defect.images}
                emptyText="No inspection images"
                titlePrefix="Before"
                onOpenImagePreview={(params) => navigation.navigate('ImagePreview', params)}
              />
            </View>
          </>
        ) : null}
    </Screen>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function KeyFact({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.keyFact}>
      <Text style={styles.keyFactLabel}>{label}</Text>
      <Text
        style={[styles.keyFactValue, emphasize && { color: theme.colors.danger }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

/** Photo strip — up to 2 thumbnails then a "+N" tile (handoff 1e). */
function PhotoStrip({
  images,
  onOpenImagePreview,
}: {
  images: Array<InspectionImage | DefectEvidenceImage>;
  onOpenImagePreview: (params: ImagePreviewParams) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const usable = images.filter((image) => Boolean(getImageSourceUri(image)));

  if (usable.length === 0) {
    return null;
  }

  const previewImages = usable.map((image, index) => ({
    uri: getImageSourceUri(image) ?? '',
    title: `Photo ${index + 1}`,
  }));
  const shown = usable.slice(0, 3);
  const overflow = usable.length - 3;

  return (
    <View style={styles.photoStrip}>
      {shown.map((image, index) => {
        const isLastWithOverflow = index === 2 && overflow > 0;
        return (
          <TouchableOpacity
            key={`${image.id ?? getImageSourceUri(image) ?? 'photo'}-${index}`}
            activeOpacity={0.85}
            style={styles.photoTile}
            onPress={() => onOpenImagePreview({ images: previewImages, index })}
          >
            <Image
              source={{ uri: getImageSourceUri(image) ?? undefined }}
              style={styles.photoTileImage}
              resizeMode="cover"
            />
            {isLastWithOverflow ? (
              <View style={styles.photoOverflow}>
                <Text style={styles.photoOverflowText}>+{overflow + 1}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

type TimelineNodeState = 'done' | 'now' | 'todo';

/** Vertical lifecycle timeline: raised -> verified -> ready -> repair. Node
 *  state (done/now/todo) is derived from the defect's lifecycle (handoff 1e). */
function LifecycleTimeline({ defect }: { defect: DefectDetail }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const lifecycle = getDisplayLifecycleStatus(defect.lifecycleStatus);
  const isClosed = defect.status === 'CLOSED' || lifecycle === 'CLOSED';

  const order = ['DETECTED', 'UNDER_REVIEW', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFICATION_PENDING', 'CLOSED'];
  const rank = (status: string) => {
    const idx = order.indexOf(status);
    return idx === -1 ? 0 : idx;
  };
  const currentRank = rank(lifecycle);

  const stepState = (reachedAt: number, activeAt: number): TimelineNodeState => {
    if (isClosed || currentRank > activeAt) {
      return 'done';
    }
    if (currentRank >= reachedAt) {
      return 'now';
    }
    return 'todo';
  };

  const steps: Array<{ title: string; meta?: string | null; state: TimelineNodeState }> = [
    {
      title: 'Raised in inspection',
      meta: [defect.cycleNumber ? `Cycle ${defect.cycleNumber}` : null, formatDateTime(defect.submittedAt)]
        .filter(Boolean)
        .join(' · '),
      state: 'done',
    },
    {
      title: defect.isEmergency ? 'Verified & flagged emergency' : 'Verified',
      meta: defect.verifiedAt ? formatDateTime(defect.verifiedAt) : 'Awaiting QA/QC',
      state: stepState(rank('VERIFIED'), rank('VERIFIED')),
    },
    {
      title: defect.assignedTo ? 'Assigned to maintenance' : 'Ready to claim',
      meta: defect.assignedTo
        ? [defect.assignedTo, formatDateTime(defect.assignedAt)].filter(Boolean).join(' · ')
        : 'Unassigned · awaiting maintenance',
      state: stepState(rank('ASSIGNED'), rank('IN_PROGRESS')),
    },
    {
      title: 'Repair & closure',
      meta: isClosed
        ? formatDateTime(defect.closureVerifiedAt ?? defect.closedAt)
        : lifecycle === 'IN_PROGRESS'
          ? 'In progress'
          : null,
      state: isClosed ? 'done' : lifecycle === 'IN_PROGRESS' ? 'now' : 'todo',
    },
  ];

  return (
    <View style={styles.timeline}>
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const dotStyle =
          step.state === 'done'
            ? styles.tlDotDone
            : step.state === 'now'
              ? styles.tlDotNow
              : styles.tlDotTodo;
        return (
          <View key={step.title} style={styles.tlRow}>
            <View style={styles.tlRail}>
              <View style={[styles.tlDot, dotStyle]}>
                {step.state === 'done' ? (
                  <Feather name="check" size={11} color={theme.colors.onSolidFill} />
                ) : null}
              </View>
              {!isLast ? <View style={styles.tlLine} /> : null}
            </View>
            <View style={styles.tlContent}>
              <Text style={[styles.tlTitle, step.state === 'todo' && styles.tlTitleTodo]}>
                {step.title}
              </Text>
              {step.meta ? <Text style={styles.tlMeta}>{step.meta}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function NoteBlock({ label, value }: { label: string; value?: string | null }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.noteBlock}>
      <Text style={styles.noteLabel}>{label}</Text>
      <Text style={[styles.noteValue, !value?.trim() && styles.noteValueMuted]}>
        {value?.trim() || 'Not recorded.'}
      </Text>
    </View>
  );
}

function EvidenceGrid({
  title,
  images,
  emptyText,
  titlePrefix,
  onOpenImagePreview,
}: {
  title: string;
  images: Array<InspectionImage | DefectEvidenceImage>;
  emptyText: string;
  titlePrefix: string;
  onOpenImagePreview: (params: ImagePreviewParams) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.proofSection}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.controlLabel}>{title}</Text>
        <Text style={styles.countPill}>{images.length}</Text>
      </View>
      {images.length === 0 ? (
        <View style={styles.compactEmptyPanel}>
          <Text style={styles.mutedText}>{emptyText}</Text>
        </View>
      ) : (
        <View style={styles.evidenceGrid}>
          {images.map((image, index) => {
            const imageUri = getImageSourceUri(image);
            const timestamp = getEvidenceTimestamp(image);

            return (
              <View key={`${image.id ?? imageUri ?? 'image'}-${index}`} style={styles.evidenceTile}>
                {imageUri ? (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() =>
                      onOpenImagePreview({
                        images: images.map((gridImage, gridIndex) => ({
                          uri: getImageSourceUri(gridImage) ?? '',
                          title: `${titlePrefix} ${gridIndex + 1}`,
                        })),
                        index,
                      })
                    }
                  >
                    <Image source={{ uri: imageUri }} style={styles.evidenceImage} resizeMode="cover" />
                  </TouchableOpacity>
                ) : (
                  <View style={styles.evidenceUnavailable}>
                    <Text style={styles.mutedText}>Unavailable</Text>
                  </View>
                )}
                <View style={styles.evidenceMeta}>
                  <Text style={styles.evidenceTitle}>{titlePrefix} {index + 1}</Text>
                  <Text style={styles.evidenceMetaText} numberOfLines={1}>
                    {formatDateTime(timestamp)}
                  </Text>
                  {hasCoordinatePair(image.latitude, image.longitude) ? (
                    <Text style={styles.evidenceMetaText} numberOfLines={1}>
                      GPS {formatCoordinatePairCompact(image.latitude, image.longitude)}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function StatusButton({
  label,
  status,
  currentStatus,
  savingStatus,
  onPress,
}: {
  label: string;
  status: DefectStatus;
  currentStatus: DefectStatus;
  savingStatus: DefectStatus | null;
  onPress: (status: DefectStatus) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isSaving = savingStatus === status;
  const isDisabled = savingStatus !== null;
  const isCurrent = currentStatus === status;
  const style = getStatusStyle(status);

  return (
    <Pressable
      disabled={isDisabled}
      onPress={() => onPress(status)}
      style={({ pressed }) => [
        styles.statusButton,
        {
          backgroundColor: isCurrent ? style.backgroundColor : theme.colors.surfaceMuted,
          borderColor: isCurrent ? style.borderColor : theme.colors.border,
        },
        isDisabled && !isSaving && styles.disabledButton,
        pressed && !isDisabled && styles.pressedButton,
      ]}
    >
      {isSaving ? <ActivityIndicator color={style.color} /> : null}
      <Text style={[styles.statusButtonText, { color: isCurrent ? style.color : theme.colors.textPrimary }]}>
        {isSaving ? 'Saving...' : label}
      </Text>
    </Pressable>
  );
}

function OutcomeButton({
  outcome,
  selectedOutcome,
  onPress,
}: {
  outcome: DefectResolutionOutcome;
  selectedOutcome: DefectResolutionOutcome;
  onPress: (outcome: DefectResolutionOutcome) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isSelected = selectedOutcome === outcome;

  return (
    <Pressable
      onPress={() => onPress(outcome)}
      style={({ pressed }) => [
        styles.outcomeButton,
        isSelected && styles.outcomeButtonSelected,
        pressed && styles.pressedButton,
      ]}
    >
      <Text style={[styles.outcomeButtonText, isSelected && styles.outcomeButtonTextSelected]}>
        {formatEnumLabel(outcome)}
      </Text>
    </Pressable>
  );
}

function optionLabel(option: DefectAssignmentOption): string {
  return option.name || option.email || option.code || option.id;
}

function DispatchPill({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.outcomeButton,
        selected && styles.outcomeButtonSelected,
        disabled && styles.disabledButton,
        pressed && !disabled && styles.pressedButton,
      ]}
    >
      <Text style={[styles.outcomeButtonText, selected && styles.outcomeButtonTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

function getStatusStyle(status: DefectStatus) {
  if (status === 'CLOSED') {
    return {
      backgroundColor: '#dcfce7',
      borderColor: '#bbf7d0',
      color: '#166534',
    };
  }

  if (status === 'IN_PROGRESS') {
    return {
      backgroundColor: '#dbeafe',
      borderColor: '#bfdbfe',
      color: '#1d4ed8',
    };
  }

  return {
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
    color: '#92400e',
  };
}

function formatStatus(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatEnumLabel(value?: string | null) {
  return value ? formatStatus(value) : 'Not recorded';
}

function getDisplayLifecycleStatus(status?: string | null) {
  return status || 'DETECTED';
}

function isExceptionOutcome(outcome?: string | null) {
  return (
    outcome === 'EXTERNAL_CONSTRAINT' ||
    outcome === 'DEFERRED' ||
    outcome === 'TEMPORARY_FIX' ||
    outcome === 'MONITORING_REQUIRED' ||
    outcome === 'FALSE_POSITIVE' ||
    outcome === 'DUPLICATE'
  );
}

function isGovernanceException(defect: DefectDetail) {
  return getDisplayLifecycleStatus(defect.lifecycleStatus) === 'REJECTED' || isExceptionOutcome(defect.resolutionOutcome);
}

function getExceptionNotes(defect: DefectDetail) {
  if (getDisplayLifecycleStatus(defect.lifecycleStatus) === 'REJECTED') {
    return defect.verificationNotes ?? defect.verificationRemarks ?? defect.actionRemark;
  }

  if (!isExceptionOutcome(defect.resolutionOutcome)) {
    return null;
  }

  if (defect.resolutionOutcome === 'FALSE_POSITIVE' || defect.resolutionOutcome === 'DUPLICATE') {
    return defect.verificationNotes ?? defect.verificationRemarks ?? defect.actionRemark;
  }

  return defect.maintenanceNotes ?? defect.closureVerificationNotes ?? defect.closureRemarks ?? defect.actionRemark;
}

function isMaintenanceOutcome(outcome?: string | null): outcome is DefectResolutionOutcome {
  return MAINTENANCE_OUTCOMES.includes(outcome as DefectResolutionOutcome);
}

async function getOptionalCurrentPosition() {
  try {
    const servicesEnabled = await Location.hasServicesEnabledAsync();

    if (!servicesEnabled) {
      return null;
    }

    const permission = await Location.requestForegroundPermissionsAsync();

    if (!permission.granted) {
      return null;
    }

    return await getPositionWithTimeout({
      accuracy: Location.Accuracy.Balanced,
    });
  } catch {
    return null;
  }
}

function hasCoordinatePair(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
) {
  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude)
  );
}

function formatCoordinatePairCompact(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
) {
  if (!hasCoordinatePair(latitude, longitude)) {
    return 'N/A';
  }

  return `Lat ${formatOverlayCoordinate(latitude)} · Lng ${formatOverlayCoordinate(longitude)}`;
}

function getEvidenceTimestamp(image: InspectionImage | DefectEvidenceImage) {
  const uploadedAt = 'uploadedAt' in image ? image.uploadedAt : undefined;

  return image.timestamp ?? uploadedAt ?? image.createdAt;
}

function formatOverlayCoordinate(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(5) : 'N/A';
}

function createLocalProofPhotoId(timestamp: string) {
  return `proof-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatPhotoTimestampLabel(value: Date) {
  return `${value.getFullYear()}-${padNumber(value.getMonth() + 1)}-${padNumber(value.getDate())} ${padNumber(value.getHours())}:${padNumber(value.getMinutes())}:${padNumber(value.getSeconds())}`;
}

function padNumber(value: number) {
  return String(value).padStart(2, '0');
}

async function getOverlayCaptureSize(
  uri: string,
  width?: number,
  height?: number,
) {
  const imageSize = width && height ? { width, height } : await loadImageSize(uri);
  const longestEdge = Math.max(imageSize.width, imageSize.height);
  const scale = longestEdge > 1600 ? 1600 / longestEdge : 1;
  const captureWidth = Math.max(1, Math.round(imageSize.width * scale));
  const captureHeight = Math.max(1, Math.round(imageSize.height * scale));
  const pixelRatio = PixelRatio.get() || 1;

  return {
    captureWidth,
    captureHeight,
    layoutWidth: captureWidth / pixelRatio,
    layoutHeight: captureHeight / pixelRatio,
  };
}

async function loadImageSize(uri: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => reject(new Error('Unable to measure the captured proof photo.')),
    );
  });
}

async function waitForNextPaint() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function delay(durationMs: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
}

// Ceiling for the overlay <Image> to decode the full-res capture. On timeout we
// FAIL (crew retakes) rather than snapshot a possibly-blank canvas — a silent
// blank photo is the exact field bug this replaces.
const OVERLAY_IMAGE_LOAD_TIMEOUT_MS = 8000;

function createOverlayImageLoadSignal() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Keep a handled branch so an unawaited rejection (e.g. the effect was
  // cancelled mid-flight) never surfaces as an unhandled-promise warning.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

async function waitForOverlayImageLoad(
  signal: { promise: Promise<void> } | null,
) {
  if (!signal) {
    return;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      signal.promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                'Preparing the photo stamp took too long. Please retake the photo.',
              ),
            ),
          OVERLAY_IMAGE_LOAD_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function getImageSourceUri(image: InspectionImage | DefectEvidenceImage) {
  const source = image.uri || image.url;

  if (!source) {
    return null;
  }

  if (/^[a-z][a-z\d+\-.]*:/i.test(source)) {
    return source;
  }

  if (source.startsWith('/')) {
    return `${API_ORIGIN}${source}`;
  }

  return source;
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
  card: {
    backgroundColor: t.colors.card,
    borderRadius: t.radius.card,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  mutedText: {
    color: t.colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    fontFamily: t.fonts.bodySemibold,
  },
  sectionTitle: {
    color: t.colors.textPrimary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    fontFamily: t.fonts.display,
  },

  // Severity-led hero (handoff 1e). Dark, full-width; critical = deep red.
  hero: {
    borderRadius: t.radius.card,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
    gap: 8,
    overflow: 'hidden',
  },
  heroCritical: {
    // Deep-red field alert. Built from the danger family so dark mode stays legible.
    backgroundColor: t.mode === 'dark' ? '#4A0E10' : '#5A1012',
  },
  heroNeutral: {
    backgroundColor: t.colors.solidFill,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  heroSevBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: t.radius.chip,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  heroSevBadgeDefault: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  heroSevBadgeEmergency: {
    backgroundColor: '#FFFFFF',
  },
  heroSevBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: t.fonts.bodyBold,
    letterSpacing: 0.4,
  },
  heroSevBadgeTextDefault: {
    color: '#FFFFFF',
  },
  heroSevBadgeTextEmergency: {
    color: t.colors.dangerText,
  },
  heroCode: {
    marginLeft: 'auto',
    fontSize: 13,
    fontFamily: t.fonts.monoMedium,
    letterSpacing: 0.3,
    color: 'rgba(255,255,255,0.82)',
    flexShrink: 1,
    textAlign: 'right',
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 23,
    lineHeight: 28,
    fontFamily: t.fonts.display,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  heroLocRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 2,
  },
  heroLocText: {
    flex: 1,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '500',
    fontFamily: t.fonts.bodyMedium,
  },

  // Photo strip (handoff 1e)
  photoStrip: {
    flexDirection: 'row',
    gap: 10,
  },
  photoTile: {
    flex: 1,
    height: 92,
    borderRadius: t.radius.control,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceMuted,
  },
  photoTileImage: {
    width: '100%',
    height: '100%',
  },
  photoOverflow: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(18,22,28,0.62)',
  },
  photoOverflowText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    fontFamily: t.fonts.monoMedium,
  },

  // 3-up key facts (handoff 1e)
  factRow: {
    flexDirection: 'row',
    gap: 10,
  },
  keyFact: {
    flex: 1,
    borderRadius: t.radius.control,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.card,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 4,
    ...t.shadow.card,
  },
  keyFactLabel: {
    color: t.colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    fontFamily: t.fonts.bodyBold,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  keyFactValue: {
    color: t.colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    fontFamily: t.fonts.bodyBold,
  },

  // Vertical lifecycle timeline (handoff 1e)
  timeline: {
    gap: 0,
    marginTop: 2,
  },
  tlRow: {
    flexDirection: 'row',
    gap: 12,
  },
  tlRail: {
    width: 18,
    alignItems: 'center',
  },
  tlDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  tlDotDone: {
    backgroundColor: t.colors.success,
    borderColor: t.colors.success,
  },
  tlDotNow: {
    backgroundColor: t.colors.primary,
    borderColor: t.colors.primary,
  },
  tlDotTodo: {
    backgroundColor: t.colors.card,
    borderColor: t.colors.borderStrong,
  },
  tlLine: {
    flex: 1,
    width: 2,
    minHeight: 18,
    marginVertical: 2,
    backgroundColor: t.colors.border,
  },
  tlContent: {
    flex: 1,
    paddingBottom: 16,
    gap: 2,
  },
  tlTitle: {
    color: t.colors.textPrimary,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    fontFamily: t.fonts.bodyBold,
  },
  tlTitleTodo: {
    color: t.colors.textMuted,
    fontWeight: '600',
    fontFamily: t.fonts.bodySemibold,
  },
  tlMeta: {
    color: t.colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: t.fonts.body,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  infoLabel: {
    flex: 1,
    color: t.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  infoValue: {
    flex: 1.2,
    color: t.colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    textAlign: 'right',
  },
  noteBlock: {
    gap: 4,
  },
  noteLabel: {
    color: t.colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  noteValue: {
    color: t.colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  noteValueMuted: {
    color: t.colors.textSecondary,
  },
  noteInput: {
    minHeight: 78,
    borderRadius: t.radius.card,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 21,
    color: t.colors.textPrimary,
  },
  controlLabel: {
    flex: 1,
    color: t.colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  outcomeWrap: {
    gap: 6,
  },
  outcomeButton: {
    minHeight: 40,
    borderRadius: t.radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: t.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  outcomeButtonSelected: {
    backgroundColor: t.colors.successSoft,
    borderColor: t.colors.successBorder,
  },
  outcomeButtonText: {
    color: t.colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  outcomeButtonTextSelected: {
    color: t.colors.success,
  },
  proofSection: {
    gap: 8,
  },
  sectionHeaderRow: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  countPill: {
    minWidth: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceMuted,
    paddingHorizontal: 8,
    paddingVertical: 3,
    color: t.colors.textPrimary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  evidenceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  evidenceTile: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 146,
    borderRadius: t.radius.card,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceMuted,
    overflow: 'hidden',
  },
  evidenceImage: {
    width: '100%',
    height: 126,
    backgroundColor: t.colors.surfaceMuted,
  },
  evidenceUnavailable: {
    height: 126,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.surfaceMuted,
  },
  evidenceMeta: {
    padding: 8,
    gap: 4,
  },
  evidenceTitle: {
    color: t.colors.textPrimary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  evidenceMetaText: {
    color: t.colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  compactEmptyPanel: {
    minHeight: 48,
    borderRadius: t.radius.card,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
  },
  uploadText: {
    color: t.colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  smallDangerButton: {
    minHeight: 32,
    borderRadius: t.radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.dangerSoft,
    borderWidth: 1,
    borderColor: t.colors.dangerBorder,
  },
  smallDangerButtonText: {
    color: t.colors.danger,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  actionStack: {
    gap: 8,
  },
  maintenanceButton: {
    minHeight: 44,
    borderRadius: t.radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
  },
  maintenanceButtonBlue: {
    backgroundColor: t.colors.infoSoft,
  },
  maintenanceButtonNeutral: {
    backgroundColor: t.colors.surfaceMuted,
  },
  maintenanceButtonGreen: {
    backgroundColor: t.colors.successSoft,
  },
  maintenanceButtonBlueText: {
    color: t.colors.info,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  maintenanceButtonNeutralText: {
    color: t.colors.textPrimary,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  maintenanceButtonGreenText: {
    color: t.colors.success,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  statusButton: {
    minHeight: 42,
    borderRadius: t.radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  statusButtonText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  defectLabel: {
    color: t.colors.textPrimary,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
  },
  disabledButton: {
    opacity: 0.55,
  },
  pressedButton: {
    opacity: 0.9,
  },
  overlayCaptureRoot: {
    position: 'absolute',
    left: -10000,
    top: 0,
  },
  overlayCaptureCanvas: {
    position: 'relative',
    backgroundColor: '#000000',
  },
  overlayCaptureImage: {
    ...StyleSheet.absoluteFillObject,
  },
  overlayStampWrap: {
    position: 'absolute',
    right: 8,
    bottom: 8,
  },
  overlayBadge: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    maxWidth: '78%',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  overlayText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
});
