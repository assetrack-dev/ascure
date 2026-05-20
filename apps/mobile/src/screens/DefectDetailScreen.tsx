import { useCallback, useEffect, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import {
  ActivityIndicator,
  Image,
  Pressable,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { api, ApiError, API_BASE_URL } from '../api';
import {
  DefectDetail,
  DefectEvidenceImage,
  DefectResolutionOutcome,
  DefectStatus,
  InspectionImage,
} from '../types';
import { formatDateTime, normalizeOperationalPayloadText } from '../utils';
import { Screen } from '../ui';

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');
const MAINTENANCE_OUTCOMES: DefectResolutionOutcome[] = [
  'RESOLVED',
  'TEMPORARY_FIX',
  'MONITORING_REQUIRED',
  'EXTERNAL_CONSTRAINT',
  'DEFERRED',
];

type CapturedMaintenanceProofPhoto = {
  uri: string;
  timestamp: string;
  latitude?: number | null;
  longitude?: number | null;
};

export function DefectDetailScreen({
  token,
  defectId,
  onBack,
  onOpenImagePreview,
  onUnauthorized,
}: {
  token: string;
  defectId: string;
  onBack: () => void;
  onOpenImagePreview: (params: { uri: string; title?: string }) => void;
  onUnauthorized: (error?: unknown) => Promise<void>;
}) {
  const [defect, setDefect] = useState<DefectDetail | null>(null);
  const [actionRemark, setActionRemark] = useState('');
  const [maintenanceNote, setMaintenanceNote] = useState('');
  const [resolutionOutcome, setResolutionOutcome] =
    useState<DefectResolutionOutcome>('RESOLVED');
  const [proofPhoto, setProofPhoto] = useState<CapturedMaintenanceProofPhoto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState<DefectStatus | null>(null);
  const [savingMaintenanceAction, setSavingMaintenanceAction] = useState<
    'start' | 'capture' | 'complete' | null
  >(null);
  const [error, setError] = useState<string | null>(null);

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
      } catch (loadError) {
        console.error('[DEFECT DETAIL LOAD ERROR]', loadError);

        if (loadError instanceof ApiError && loadError.status === 401) {
          await onUnauthorized(loadError);
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
    [defectId, onUnauthorized, token],
  );

  useEffect(() => {
    loadDefectDetail();
  }, [loadDefectDetail]);

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
        await onUnauthorized(updateError);
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
        await onUnauthorized(updateError);
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

      const timestamp = new Date().toISOString();
      const position = await getOptionalCurrentPosition();

      setProofPhoto({
        uri: capturedAsset.uri,
        timestamp,
        latitude: position?.coords.latitude ?? null,
        longitude: position?.coords.longitude ?? null,
      });
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : 'Unable to capture proof photo.');
    } finally {
      setSavingMaintenanceAction(null);
    }
  }

  async function handleMaintenanceCompleted() {
    try {
      setSavingMaintenanceAction('complete');
      setError(null);

      const normalizedNote = normalizeOperationalPayloadText(maintenanceNote) ?? null;

      if (proofPhoto) {
        await api.uploadDefectEvidenceImage(token, defectId, {
          ...proofPhoto,
          note: normalizedNote,
        });
        setProofPhoto(null);
      }

      await api.completeDefectMaintenance(token, defectId, {
        resolutionOutcome,
        maintenanceNotes: normalizedNote,
      });
      await loadDefectDetail(false);
    } catch (completionError) {
      console.error('[DEFECT MAINTENANCE COMPLETION ERROR]', completionError);

      if (completionError instanceof ApiError && completionError.status === 401) {
        await onUnauthorized(completionError);
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

  const canShowMaintenanceActions = defect
    ? ['ASSIGNED', 'IN_PROGRESS'].includes(getDisplayLifecycleStatus(defect.lifecycleStatus)) ||
      defect.status === 'IN_PROGRESS'
    : false;
  const proofImages = defect?.maintenanceProofImages?.length
    ? defect.maintenanceProofImages
    : defect?.evidenceImages ?? [];

  return (
    <Screen
      title="Defect Detail"
      subtitle={defect?.assetCode}
      leftAction={{ icon: 'back', onPress: onBack, accessibilityLabel: 'Back' }}
    >
        {isLoading ? (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 36, gap: 12 }}>
            <ActivityIndicator size="large" color="#0f5cd8" />
            <Text style={{ fontSize: 15, color: '#526277' }}>Loading defect detail...</Text>
          </View>
        ) : null}

        {!isLoading && error ? (
          <View
            style={{
              backgroundColor: '#fee2e2',
              borderRadius: 14,
              borderWidth: 1,
              borderColor: '#fecaca',
              padding: 14,
              gap: 12,
            }}
          >
            <Text style={{ fontSize: 14, lineHeight: 20, color: '#991b1b', fontWeight: '600' }}>
              {error}
            </Text>
            <Pressable
              onPress={() => loadDefectDetail()}
              style={({ pressed }) => ({
                minHeight: 46,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#ffffff',
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#991b1b' }}>Try Again</Text>
            </Pressable>
          </View>
        ) : null}

        {!isLoading && !error && !defect ? (
          <View
            style={{
              backgroundColor: '#eef4fb',
              borderRadius: 16,
              padding: 18,
              borderWidth: 1,
              borderColor: '#d9e4f2',
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#0f172a' }}>
              Defect not found.
            </Text>
          </View>
        ) : null}

        {!isLoading && defect ? (
          <>
            <View
              style={{
                backgroundColor: '#ffffff',
                borderRadius: 16,
                padding: 16,
                gap: 12,
                borderWidth: 1,
                borderColor: '#dce5f1',
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ fontSize: 19, fontWeight: '700', color: '#0f172a' }}>
                    {defect.assetCode || 'Unknown Asset'}
                  </Text>
                  <Text style={{ fontSize: 14, lineHeight: 20, color: '#607086' }}>
                    {defect.assetType || 'No asset type available'}
                  </Text>
                </View>
                <StatusBadge status={defect.status} />
              </View>
              <InfoRow label="Inspection Cycle" value={defect.cycleNumber ? `Cycle ${defect.cycleNumber}` : 'Not available'} />
              <InfoRow label="Submitted" value={formatDateTime(defect.submittedAt)} />
              {defect.closedAt ? <InfoRow label="Closed" value={formatDateTime(defect.closedAt)} /> : null}
            </View>

            <View
              style={{
                backgroundColor: '#ffffff',
                borderRadius: 16,
                padding: 16,
                gap: 12,
                borderWidth: 1,
                borderColor: '#dce5f1',
              }}
            >
              <Text style={{ fontSize: 19, fontWeight: '700', color: '#0f172a' }}>
                Operational Ownership
              </Text>
              <InfoRow label="Lifecycle Status" value={formatEnumLabel(getDisplayLifecycleStatus(defect.lifecycleStatus))} />
              <InfoRow label="Resolution Outcome" value={formatEnumLabel(defect.resolutionOutcome)} />
              <InfoRow label="Assigned" value={formatDateTime(defect.assignedAt)} />
              <InfoRow label="QA/QC Verified" value={formatDateTime(defect.verifiedAt)} />
              <InfoRow label="Maintained" value={formatDateTime(defect.maintainedAt)} />
              <InfoRow label="Closure Verified" value={formatDateTime(defect.closureVerifiedAt)} />
            </View>

            <View
              style={{
                backgroundColor: '#ffffff',
                borderRadius: 16,
                padding: 16,
                gap: 12,
                borderWidth: 1,
                borderColor: '#dce5f1',
              }}
            >
              <Text style={{ fontSize: 19, fontWeight: '700', color: '#0f172a' }}>
                Resolution Governance
              </Text>
              <Text style={{ fontSize: 14, lineHeight: 21, color: '#607086' }}>
                {getGovernanceHelper(defect)}
              </Text>
              <InfoRow label="Lifecycle Status" value={formatEnumLabel(getDisplayLifecycleStatus(defect.lifecycleStatus))} />
              <InfoRow label="Resolution Outcome" value={formatEnumLabel(defect.resolutionOutcome)} />
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
              <View
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: 16,
                  padding: 16,
                  gap: 12,
                  borderWidth: 1,
                  borderColor: '#dce5f1',
                }}
              >
                <Text style={{ fontSize: 19, fontWeight: '700', color: '#0f172a' }}>
                  Maintenance Action
                </Text>
                <InfoRow label="Assigned To" value={defect.assignedTo || 'Unassigned'} />
                <TextInput
                  value={maintenanceNote}
                  onChangeText={setMaintenanceNote}
                  placeholder="Add maintenance note"
                  placeholderTextColor="#7b8aa3"
                  multiline
                  autoCapitalize="characters"
                  textAlignVertical="top"
                  style={{
                    minHeight: 96,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: '#c7d5e8',
                    backgroundColor: '#ffffff',
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    fontSize: 16,
                    lineHeight: 22,
                    color: '#0f172a',
                  }}
                />
                <View style={{ gap: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#607086' }}>
                    Resolution Outcome
                  </Text>
                  {MAINTENANCE_OUTCOMES.map((outcome) => (
                    <OutcomeButton
                      key={outcome}
                      outcome={outcome}
                      selectedOutcome={resolutionOutcome}
                      onPress={setResolutionOutcome}
                    />
                  ))}
                </View>

                {proofPhoto ? (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() =>
                      onOpenImagePreview({
                        uri: proofPhoto.uri,
                        title: 'Repair Proof',
                      })
                    }
                  >
                    <Image
                      source={{ uri: proofPhoto.uri }}
                      style={{
                        width: '100%',
                        height: 220,
                        borderRadius: 14,
                        backgroundColor: '#e5edf8',
                      }}
                      resizeMode="cover"
                    />
                  </TouchableOpacity>
                ) : null}

                <View style={{ gap: 10 }}>
                  <Pressable
                    disabled={savingMaintenanceAction !== null}
                    onPress={handleMarkInProgress}
                    style={({ pressed }) => ({
                      minHeight: 50,
                      borderRadius: 14,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: '#dbeafe',
                      opacity: savingMaintenanceAction && savingMaintenanceAction !== 'start' ? 0.55 : pressed ? 0.9 : 1,
                    })}
                  >
                    {savingMaintenanceAction === 'start' ? <ActivityIndicator color="#1d4ed8" /> : null}
                    <Text style={{ fontSize: 15, fontWeight: '800', color: '#1d4ed8' }}>
                      {savingMaintenanceAction === 'start' ? 'Saving...' : 'Mark In Progress'}
                    </Text>
                  </Pressable>

                  <Pressable
                    disabled={savingMaintenanceAction !== null}
                    onPress={captureMaintenanceProofPhoto}
                    style={({ pressed }) => ({
                      minHeight: 50,
                      borderRadius: 14,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: '#e5edf8',
                      opacity: savingMaintenanceAction && savingMaintenanceAction !== 'capture' ? 0.55 : pressed ? 0.9 : 1,
                    })}
                  >
                    {savingMaintenanceAction === 'capture' ? <ActivityIndicator color="#10233d" /> : null}
                    <Text style={{ fontSize: 15, fontWeight: '800', color: '#10233d' }}>
                      {savingMaintenanceAction === 'capture'
                        ? 'Opening Camera...'
                        : proofPhoto
                          ? 'Retake Repair Proof'
                          : 'Capture Repair Proof'}
                    </Text>
                  </Pressable>

                  <Pressable
                    disabled={savingMaintenanceAction !== null}
                    onPress={handleMaintenanceCompleted}
                    style={({ pressed }) => ({
                      minHeight: 50,
                      borderRadius: 14,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: '#dcfce7',
                      opacity: savingMaintenanceAction && savingMaintenanceAction !== 'complete' ? 0.55 : pressed ? 0.9 : 1,
                    })}
                  >
                    {savingMaintenanceAction === 'complete' ? <ActivityIndicator color="#166534" /> : null}
                    <Text style={{ fontSize: 15, fontWeight: '800', color: '#166534' }}>
                      {savingMaintenanceAction === 'complete'
                        ? 'Completing...'
                        : 'Mark Maintenance Completed'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            <View
              style={{
                backgroundColor: '#ffffff',
                borderRadius: 16,
                padding: 16,
                gap: 12,
                borderWidth: 1,
                borderColor: '#dce5f1',
              }}
            >
              <Text style={{ fontSize: 19, fontWeight: '700', color: '#0f172a' }}>
                Operational Evidence
              </Text>
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
              {proofImages.length > 0 ? (
                <View style={{ gap: 10 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#607086' }}>
                    Maintenance Proof Images
                  </Text>
                  {proofImages.map((image, index) => {
                    const imageUri = getImageSourceUri(image);

                    return imageUri ? (
                      <TouchableOpacity
                        key={`${image.id ?? imageUri}-${index}`}
                        activeOpacity={0.85}
                        onPress={() =>
                          onOpenImagePreview({
                            uri: imageUri,
                            title: 'Maintenance Proof',
                          })
                        }
                      >
                        <Image
                          source={{ uri: imageUri }}
                          style={{
                            width: '100%',
                            height: 220,
                            borderRadius: 14,
                            backgroundColor: '#e5edf8',
                          }}
                          resizeMode="cover"
                        />
                        <Text style={{ marginTop: 6, fontSize: 12, color: '#607086' }}>
                          {formatDateTime(image.timestamp ?? image.createdAt)}
                        </Text>
                      </TouchableOpacity>
                    ) : null;
                  })}
                </View>
              ) : null}
            </View>

            <View
              style={{
                backgroundColor: '#ffffff',
                borderRadius: 16,
                padding: 16,
                gap: 12,
                borderWidth: 1,
                borderColor: '#dce5f1',
              }}
            >
              <Text style={{ fontSize: 19, fontWeight: '700', color: '#0f172a' }}>Defect</Text>
              <Text style={{ fontSize: 16, lineHeight: 23, fontWeight: '700', color: '#10233d' }}>
                {defect.label}
              </Text>
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#607086' }}>
                  Checklist Remark
                </Text>
                <Text
                  style={{
                    fontSize: 15,
                    lineHeight: 22,
                    color: defect.checklistRemark ? '#10233d' : '#607086',
                  }}
                >
                  {defect.checklistRemark || 'No remark.'}
                </Text>
              </View>
            </View>

            <View
              style={{
                backgroundColor: '#ffffff',
                borderRadius: 16,
                padding: 16,
                gap: 12,
                borderWidth: 1,
                borderColor: '#dce5f1',
              }}
            >
              <Text style={{ fontSize: 19, fontWeight: '700', color: '#0f172a' }}>
                Action Remark
              </Text>
              <TextInput
                value={actionRemark}
                onChangeText={setActionRemark}
                placeholder="Add action taken or follow-up note"
                placeholderTextColor="#7b8aa3"
                multiline
                autoCapitalize="characters"
                textAlignVertical="top"
                style={{
                  minHeight: 110,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: '#c7d5e8',
                  backgroundColor: '#ffffff',
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  fontSize: 16,
                  lineHeight: 22,
                  color: '#0f172a',
                }}
              />
              <View style={{ gap: 10 }}>
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
                <StatusButton
                  label="Mark Closed"
                  status="CLOSED"
                  currentStatus={defect.status}
                  savingStatus={savingStatus}
                  onPress={handleUpdateStatus}
                />
              </View>
            </View>

            <View
              style={{
                backgroundColor: '#ffffff',
                borderRadius: 16,
                padding: 16,
                gap: 14,
                borderWidth: 1,
                borderColor: '#dce5f1',
              }}
            >
              <Text style={{ fontSize: 19, fontWeight: '700', color: '#0f172a' }}>
                Inspection Images
              </Text>
              {defect.images.length === 0 ? (
                <Text style={{ fontSize: 14, lineHeight: 21, color: '#607086' }}>
                  No inspection images yet.
                </Text>
              ) : (
                defect.images.map((image, index) => {
                  const imageUri = getImageSourceUri(image);

                  return (
                    <View key={`${image.id ?? imageUri ?? 'image'}-${index}`} style={{ gap: 8 }}>
                      {imageUri ? (
                        <TouchableOpacity
                          activeOpacity={0.85}
                          onPress={() =>
                            onOpenImagePreview({
                              uri: imageUri,
                              title: 'Inspection Image',
                            })
                          }
                        >
                          <Image
                            source={{ uri: imageUri }}
                            style={{
                              width: '100%',
                              height: 220,
                              borderRadius: 14,
                              backgroundColor: '#e5edf8',
                            }}
                            resizeMode="cover"
                          />
                        </TouchableOpacity>
                      ) : (
                        <View
                          style={{
                            height: 120,
                            borderRadius: 14,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: '#eef4fb',
                            borderWidth: 1,
                            borderColor: '#d9e4f2',
                          }}
                        >
                          <Text style={{ fontSize: 14, lineHeight: 21, color: '#607086' }}>
                            Image unavailable.
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </View>
          </>
        ) : null}
    </Screen>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16 }}>
      <Text style={{ flex: 1, fontSize: 14, color: '#607086' }}>{label}</Text>
      <Text
        style={{
          flex: 1.2,
          fontSize: 14,
          fontWeight: '600',
          color: '#0f172a',
          textAlign: 'right',
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function NoteBlock({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: '#607086' }}>
        {label}
      </Text>
      <Text
        style={{
          fontSize: 15,
          lineHeight: 22,
          color: value?.trim() ? '#10233d' : '#607086',
        }}
      >
        {value?.trim() || 'Not recorded.'}
      </Text>
    </View>
  );
}

function StatusBadge({ status }: { status: DefectStatus }) {
  const style = getStatusStyle(status);

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: style.backgroundColor,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: '800', color: style.color }}>
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
  const isSaving = savingStatus === status;
  const isDisabled = savingStatus !== null;
  const isCurrent = currentStatus === status;
  const style = getStatusStyle(status);

  return (
    <Pressable
      disabled={isDisabled}
      onPress={() => onPress(status)}
      style={({ pressed }) => ({
        minHeight: 50,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 16,
        backgroundColor: isCurrent ? style.backgroundColor : '#e5edf8',
        borderWidth: isCurrent ? 1 : 0,
        borderColor: style.color,
        opacity: isDisabled && !isSaving ? 0.55 : pressed ? 0.9 : 1,
      })}
    >
      {isSaving ? <ActivityIndicator color={style.color} /> : null}
      <Text style={{ fontSize: 15, fontWeight: '800', color: isCurrent ? style.color : '#10233d' }}>
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
  const isSelected = selectedOutcome === outcome;

  return (
    <Pressable
      onPress={() => onPress(outcome)}
      style={({ pressed }) => ({
        minHeight: 46,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
        backgroundColor: isSelected ? '#ecfdf5' : '#e5edf8',
        borderWidth: isSelected ? 1 : 0,
        borderColor: '#0f766e',
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <Text style={{ fontSize: 14, fontWeight: '800', color: isSelected ? '#0f766e' : '#10233d' }}>
        {formatEnumLabel(outcome)}
      </Text>
    </Pressable>
  );
}

function getStatusStyle(status: DefectStatus) {
  if (status === 'CLOSED') {
    return {
      backgroundColor: '#dcfce7',
      color: '#166534',
    };
  }

  if (status === 'IN_PROGRESS') {
    return {
      backgroundColor: '#dbeafe',
      color: '#1d4ed8',
    };
  }

  return {
    backgroundColor: '#fef3c7',
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

function getGovernanceHelper(defect: DefectDetail) {
  if (getDisplayLifecycleStatus(defect.lifecycleStatus) === 'REJECTED') {
    return 'Rejected QA/QC decisions stay visible with notes and timestamps.';
  }

  if (defect.resolutionOutcome === 'EXTERNAL_CONSTRAINT') {
    return 'External constraints are operational exceptions, not deleted defects.';
  }

  if (isExceptionOutcome(defect.resolutionOutcome)) {
    return 'Outcome exceptions stay separate from the lifecycle status.';
  }

  return 'Resolution outcome is tracked separately from lifecycle status.';
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
