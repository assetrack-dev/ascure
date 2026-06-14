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
import { useNavigation, useRoute } from '@react-navigation/native';
import { api, ApiError, API_BASE_URL } from '../api';
import { useSession } from '../context/AuthContext';
import type { RootStackScreenProps } from '../navigation/types';
import { Theme, useTheme } from '../theme';
import { InspectionDetail, InspectionImage, InspectionItemResult } from '../types';
import { formatDateTime } from '../utils';

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');
const IMAGE_GROUPS = ['BEFORE', 'DURING', 'AFTER', 'OTHER'] as const;

type ImageGroup = (typeof IMAGE_GROUPS)[number];

export function InspectionDetailScreen() {
  const theme = useTheme();
  const navigation = useNavigation<RootStackScreenProps<'InspectionDetail'>['navigation']>();
  const route = useRoute<RootStackScreenProps<'InspectionDetail'>['route']>();
  const { inspectionId, assetCode } = route.params;
  const { token, handleUnauthorized } = useSession();
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
        await handleUnauthorized(loadError);
        return;
      }

      setInspection(null);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load inspection detail.');
    } finally {
      setIsLoading(false);
    }
  }, [inspectionId, handleUnauthorized, token]);

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
        backgroundColor: theme.colors.background,
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
          <Text style={{ fontSize: 28, fontWeight: '800', color: theme.colors.textPrimary }}>
            Inspection Detail
          </Text>
          {assetCode ? (
            <Text style={{ fontSize: 15, lineHeight: 22, color: theme.colors.textSecondary }}>{assetCode}</Text>
          ) : null}
        </View>
        <Pressable onPress={() => navigation.goBack()} style={{ paddingVertical: 6 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: theme.colors.info }}>Back</Text>
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
            <ActivityIndicator size="large" color={theme.colors.info} />
            <Text style={{ fontSize: 15, color: theme.colors.textSecondary }}>Loading inspection detail...</Text>
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
              onPress={loadInspectionDetail}
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

        {!isLoading && !error && inspection ? (
          <>
            <View
              style={{
                backgroundColor: theme.colors.card,
                borderRadius: 16,
                padding: 16,
                gap: 12,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Text style={{ fontSize: 19, fontWeight: '700', color: theme.colors.textPrimary }}>Summary</Text>
              <InfoRow label="Cycle" value={`Cycle ${inspection.cycleNumber}`} />
              <InfoRow label="Status" value={formatStatus(inspection.status)} />
              <InfoRow label="Submitted" value={formatDateTime(inspection.submittedAt)} />
              <InfoRow label="Images" value={String(images.length)} />
              <InfoRow label="Total Defects" value={String(totalDefects)} />
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.textSecondary }}>Remarks</Text>
                <Text
                  style={{
                    fontSize: 15,
                    lineHeight: 22,
                    color: inspection.remarks ? theme.colors.textPrimary : theme.colors.textSecondary,
                  }}
                >
                  {inspection.remarks || 'No remarks recorded.'}
                </Text>
              </View>
            </View>

            <View
              style={{
                backgroundColor: theme.colors.card,
                borderRadius: 16,
                padding: 16,
                gap: 14,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Text style={{ fontSize: 19, fontWeight: '700', color: theme.colors.textPrimary }}>
                Checklist Results
              </Text>

              {checklistItems.length === 0 ? (
                <Text style={{ fontSize: 14, lineHeight: 21, color: theme.colors.textSecondary }}>
                  No checklist results recorded.
                </Text>
              ) : (
                checklistItems.map((item) => <ChecklistResultRow key={item.id} item={item} />)
              )}
            </View>

            <View
              style={{
                backgroundColor: theme.colors.card,
                borderRadius: 16,
                padding: 16,
                gap: 14,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Text style={{ fontSize: 19, fontWeight: '700', color: theme.colors.textPrimary }}>
                Inspection Images
              </Text>

              {images.length === 0 ? (
                <Text style={{ fontSize: 14, lineHeight: 21, color: theme.colors.textSecondary }}>
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
                      <Text style={{ fontSize: 13, fontWeight: '800', color: theme.colors.textSecondary }}>
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
                                  navigation.navigate('ImagePreview', {
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
                                    backgroundColor: theme.colors.surfaceMuted,
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
                                  backgroundColor: theme.colors.surfaceMuted,
                                  borderWidth: 1,
                                  borderColor: theme.colors.border,
                                }}
                              >
                                <Text style={{ fontSize: 14, lineHeight: 21, color: theme.colors.textSecondary }}>
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
  const theme = useTheme();

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16 }}>
      <Text style={{ flex: 1, fontSize: 14, color: theme.colors.textSecondary }}>{label}</Text>
      <Text
        style={{
          flex: 1.2,
          fontSize: 14,
          fontWeight: '600',
          color: theme.colors.textPrimary,
          textAlign: 'right',
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function ChecklistResultRow({ item }: { item: InspectionItemResult }) {
  const theme = useTheme();

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        paddingTop: 12,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <Text style={{ flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '700', color: theme.colors.textPrimary }}>
          {item.label}
        </Text>
        <ResultBadge result={item.result} />
        {item.isDefect ? <DefectBadge /> : null}
      </View>
      {item.remark ? (
        <Text style={{ fontSize: 14, lineHeight: 21, color: theme.colors.textSecondary }}>{item.remark}</Text>
      ) : (
        <Text style={{ fontSize: 14, lineHeight: 21, color: theme.colors.textMuted }}>No remark.</Text>
      )}
    </View>
  );
}

function ResultBadge({ result }: { result: InspectionItemResult['result'] }) {
  const theme = useTheme();
  const style = getResultBadgeStyle(result, theme);

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
  const theme = useTheme();

  return (
    <View
      style={{
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
        backgroundColor: theme.colors.dangerSoft,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: '800', color: theme.colors.dangerText }}>DEFECT</Text>
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

function getResultBadgeStyle(result: InspectionItemResult['result'], t: Theme) {
  if (result === 'PASS') {
    return {
      backgroundColor: t.colors.successSoft,
      color: t.colors.successText,
    };
  }

  if (result === 'FAIL') {
    return {
      backgroundColor: t.colors.dangerSoft,
      color: t.colors.dangerText,
    };
  }

  return {
    backgroundColor: t.colors.surfaceMuted,
    color: t.colors.textSecondary,
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
