import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { api, ApiError, API_BASE_URL } from '../api';
import { InspectionDetail, InspectionImage, InspectionItemResult } from '../types';
import { formatDateTime } from '../utils';

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');
const IMAGE_GROUPS = ['BEFORE', 'DURING', 'AFTER', 'OTHER'] as const;

type ImageGroup = (typeof IMAGE_GROUPS)[number];

export function InspectionDetailScreen({
  token,
  inspectionId,
  assetCode,
  onBack,
  onOpenImagePreview,
  onUnauthorized,
}: {
  token: string;
  inspectionId: string;
  assetCode?: string;
  onBack: () => void;
  onOpenImagePreview: (params: { uri: string; title?: string }) => void;
  onUnauthorized: (error?: unknown) => Promise<void>;
}) {
  const [inspection, setInspection] = useState<InspectionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInspectionDetail = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await api.getInspectionDetail(token, inspectionId);
      setInspection(response);
    } catch (loadError) {
      console.error('[INSPECTION DETAIL LOAD ERROR]', loadError);

      if (loadError instanceof ApiError && loadError.status === 401) {
        await onUnauthorized(loadError);
        return;
      }

      setInspection(null);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load inspection detail.');
    } finally {
      setIsLoading(false);
    }
  }, [inspectionId, onUnauthorized, token]);

  useEffect(() => {
    loadInspectionDetail();
  }, [loadInspectionDetail]);

  const images = useMemo(() => inspection?.images ?? [], [inspection]);
  const checklistItems = useMemo(() => inspection?.items ?? [], [inspection]);
  const totalDefects = inspection?.totalDefects ?? checklistItems.filter((item) => item.isDefect).length;
  const groupedImages = useMemo(() => groupInspectionImages(images), [images]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#f4f7fb',
        paddingTop: Platform.OS === 'android' ? 24 : 16,
      }}
    >
      <View
        style={{
          paddingHorizontal: 20,
          paddingBottom: 12,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
        }}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontSize: 28, fontWeight: '800', color: '#0f172a' }}>
            Inspection Detail
          </Text>
          {assetCode ? (
            <Text style={{ fontSize: 15, lineHeight: 22, color: '#526277' }}>{assetCode}</Text>
          ) : null}
        </View>
        <Pressable onPress={onBack} style={{ paddingVertical: 6 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#0f5cd8' }}>Back</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: 140,
          gap: 16,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {isLoading ? (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 36, gap: 12 }}>
            <ActivityIndicator size="large" color="#0f5cd8" />
            <Text style={{ fontSize: 15, color: '#526277' }}>Loading inspection detail...</Text>
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
              onPress={loadInspectionDetail}
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

        {!isLoading && !error && inspection ? (
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
              <Text style={{ fontSize: 19, fontWeight: '700', color: '#0f172a' }}>Summary</Text>
              <InfoRow label="Cycle" value={`Cycle ${inspection.cycleNumber}`} />
              <InfoRow label="Status" value={formatStatus(inspection.status)} />
              <InfoRow label="Submitted" value={formatDateTime(inspection.submittedAt)} />
              <InfoRow label="Images" value={String(images.length)} />
              <InfoRow label="Total Defects" value={String(totalDefects)} />
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#607086' }}>Remarks</Text>
                <Text
                  style={{
                    fontSize: 15,
                    lineHeight: 22,
                    color: inspection.remarks ? '#10233d' : '#607086',
                  }}
                >
                  {inspection.remarks || 'No remarks recorded.'}
                </Text>
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
                Checklist Results
              </Text>

              {checklistItems.length === 0 ? (
                <Text style={{ fontSize: 14, lineHeight: 21, color: '#607086' }}>
                  No checklist results recorded.
                </Text>
              ) : (
                checklistItems.map((item) => <ChecklistResultRow key={item.id} item={item} />)
              )}
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

              {images.length === 0 ? (
                <Text style={{ fontSize: 14, lineHeight: 21, color: '#607086' }}>
                  No inspection images yet.
                </Text>
              ) : (
                IMAGE_GROUPS.map((group) => {
                  const groupImages = groupedImages[group];

                  if (groupImages.length === 0) {
                    return null;
                  }

                  return (
                    <View key={group} style={{ gap: 10 }}>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: '#607086' }}>
                        {group}
                      </Text>
                      {groupImages.map((image, index) => {
                        const imageUri = getImageSourceUri(image);

                        return (
                          <View key={`${image.id ?? imageUri ?? group}-${index}`} style={{ gap: 8 }}>
                            {imageUri ? (
                              <TouchableOpacity
                                activeOpacity={0.85}
                                onPress={() =>
                                  onOpenImagePreview({
                                    uri: imageUri,
                                    title: image.type || 'Inspection Image',
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
                      })}
                    </View>
                  );
                })
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
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

function ChecklistResultRow({ item }: { item: InspectionItemResult }) {
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: '#dce5f1',
        paddingTop: 12,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <Text style={{ flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '700', color: '#10233d' }}>
          {item.label}
        </Text>
        <ResultBadge result={item.result} />
        {item.isDefect ? <DefectBadge /> : null}
      </View>
      {item.remark ? (
        <Text style={{ fontSize: 14, lineHeight: 21, color: '#526277' }}>{item.remark}</Text>
      ) : (
        <Text style={{ fontSize: 14, lineHeight: 21, color: '#8a98aa' }}>No remark.</Text>
      )}
    </View>
  );
}

function ResultBadge({ result }: { result: InspectionItemResult['result'] }) {
  const style = getResultBadgeStyle(result);

  return (
    <View
      style={{
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
        backgroundColor: style.backgroundColor,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: '800', color: style.color }}>{result}</Text>
    </View>
  );
}

function DefectBadge() {
  return (
    <View
      style={{
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
        backgroundColor: '#fee2e2',
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: '800', color: '#b91c1c' }}>DEFECT</Text>
    </View>
  );
}

function groupInspectionImages(images: InspectionImage[]) {
  const groups: Record<ImageGroup, InspectionImage[]> = {
    BEFORE: [],
    DURING: [],
    AFTER: [],
    OTHER: [],
  };

  for (const image of images) {
    groups[getImageGroup(image)].push(image);
  }

  return groups;
}

function getResultBadgeStyle(result: InspectionItemResult['result']) {
  if (result === 'PASS') {
    return {
      backgroundColor: '#dcfce7',
      color: '#166534',
    };
  }

  if (result === 'FAIL') {
    return {
      backgroundColor: '#fee2e2',
      color: '#b91c1c',
    };
  }

  return {
    backgroundColor: '#e5e7eb',
    color: '#374151',
  };
}

function getImageGroup(image: InspectionImage): ImageGroup {
  const normalizedType = image.type?.trim().toUpperCase();

  if (normalizedType === 'BEFORE' || normalizedType === 'DURING' || normalizedType === 'AFTER') {
    return normalizedType;
  }

  return 'OTHER';
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
