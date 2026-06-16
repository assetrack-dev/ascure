import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { captureRef } from 'react-native-view-shot';
import {
  ActivityIndicator,
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
import { useSession } from '../context/AuthContext';
import type { RootStackScreenProps } from '../navigation/types';
import {
  DefectDetail,
  DefectEvidenceImage,
  DefectResolutionOutcome,
  DefectStatus,
  InspectionImage,
} from '../types';
import { formatDateTime, normalizeOperationalPayloadText } from '../utils';
import { Screen } from '../ui';
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
  const overlayCaptureRef = useRef<View>(null);
  const overlayPromiseHandlersRef = useRef<{
    resolve: (uri: string) => void;
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

  useEffect(() => {
    setProofPhotos([]);
    setPendingOverlayPhoto(null);
    overlayPromiseHandlersRef.current = null;
  }, [defectId]);

  useEffect(() => {
    if (!pendingOverlayPhoto) {
      return;
    }

    let isCancelled = false;

    const renderOverlayPhoto = async () => {
      try {
        await waitForNextPaint();
        await delay(400);

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

      const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();

      if (!cameraPermission.granted) {
        throw new Error('Camera permission is required to capture repair proof.');
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
        throw new Error('Unable to read the captured proof photo.');
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

  return (
    <Screen
      title="Defect Detail"
      subtitle={defect?.assetCode}
      leftAction={{
        icon: 'back',
        onPress: () => navigation.goBack(),
        accessibilityLabel: 'Back',
      }}
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
            <View style={styles.card}>
              <View style={styles.summaryHeader}>
                <View style={styles.summaryTitleWrap}>
                  <Text style={styles.assetCodeText}>{defect.assetCode || 'Unknown Asset'}</Text>
                  <Text style={styles.mutedText} numberOfLines={1}>
                    {defect.assetType || 'No asset type'} · {defect.cycleNumber ? `Cycle ${defect.cycleNumber}` : 'No cycle'}
                  </Text>
                </View>
                <StatusBadge status={defect.status} />
              </View>
              <View style={styles.statusGrid}>
                <CompactFact label="Lifecycle" value={formatEnumLabel(getDisplayLifecycleStatus(defect.lifecycleStatus))} />
                <CompactFact label="Outcome" value={formatEnumLabel(defect.resolutionOutcome)} />
                <CompactFact label="Assigned" value={defect.assignedTo || 'Unassigned'} />
                <CompactFact label="Submitted" value={formatDateTime(defect.submittedAt)} />
              </View>
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
                                uri: photo.uri,
                                title: `Proof ${index + 1}`,
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
                  />
                  <View style={styles.overlayBadge}>
                    <Text style={styles.overlayText}>{pendingOverlayPhoto.timestampLabel}</Text>
                    {hasCoordinatePair(pendingOverlayPhoto.latitude, pendingOverlayPhoto.longitude) ? (
                      <Text style={styles.overlayText}>
                        Lat: {formatOverlayCoordinate(pendingOverlayPhoto.latitude)}, Lng:{' '}
                        {formatOverlayCoordinate(pendingOverlayPhoto.longitude)}
                      </Text>
                    ) : null}
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

function CompactFact({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.compactFact}>
      <Text style={styles.compactFactLabel}>{label}</Text>
      <Text style={styles.compactFactValue} numberOfLines={1}>
        {value}
      </Text>
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
  onOpenImagePreview: (params: { uri: string; title?: string }) => void;
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
                        uri: imageUri,
                        title: `${titlePrefix} ${index + 1}`,
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

function StatusBadge({ status }: { status: DefectStatus }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const style = getStatusStyle(status);

  return (
    <View
      style={[
        styles.statusBadge,
        {
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
        },
      ]}
    >
      <Text style={[styles.statusBadgeText, { color: style.color }]}>
        {formatStatus(status)}
      </Text>
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

    return await Location.getCurrentPositionAsync({
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
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  summaryTitleWrap: {
    flex: 1,
    gap: 3,
  },
  assetCodeText: {
    color: t.colors.textPrimary,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
  },
  mutedText: {
    color: t.colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  sectionTitle: {
    color: t.colors.textPrimary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  compactFact: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 136,
    borderRadius: t.radius.card,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceMuted,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  compactFactLabel: {
    color: t.colors.textSecondary,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  compactFactValue: {
    color: t.colors.textPrimary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
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
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 11,
    lineHeight: 15,
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
