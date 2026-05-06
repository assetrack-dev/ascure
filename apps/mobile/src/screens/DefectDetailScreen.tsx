import { useCallback, useEffect, useState } from 'react';
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
import { DefectDetail, DefectStatus, InspectionImage } from '../types';
import { formatDateTime } from '../utils';
import { Screen } from '../ui';

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');

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
  const [isLoading, setIsLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState<DefectStatus | null>(null);
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
        actionRemark.trim() ? actionRemark.trim() : null,
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

function getImageSourceUri(image: InspectionImage) {
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
