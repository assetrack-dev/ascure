import { useCallback, useEffect, useState } from 'react';
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
import type { ImagePreviewParams, RootStackScreenProps } from '../navigation/types';
import { useTheme } from '../theme';
import { AssetInspectionHistoryItem, InspectionImage } from '../types';
import { formatDateTime } from '../utils';

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');

export function AssetInspectionHistoryScreen() {
  const theme = useTheme();
  const navigation =
    useNavigation<RootStackScreenProps<'AssetInspectionHistory'>['navigation']>();
  const route = useRoute<RootStackScreenProps<'AssetInspectionHistory'>['route']>();
  const { assetId, assetCode } = route.params;
  const { token, handleUnauthorized } = useSession();
  const [inspections, setInspections] = useState<AssetInspectionHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInspections = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await api.getAssetInspections(token, assetId);
      setInspections(response);
    } catch (loadError) {
      console.error('[ASSET INSPECTION HISTORY LOAD ERROR]', loadError);

      if (loadError instanceof ApiError && loadError.status === 401) {
        await handleUnauthorized(loadError);
        return;
      }

      setInspections([]);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load inspection history.');
    } finally {
      setIsLoading(false);
    }
  }, [assetId, handleUnauthorized, token]);

  useEffect(() => {
    loadInspections();
  }, [loadInspections]);

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
            Inspection History
          </Text>
          {assetCode ? (
            <Text style={{ fontSize: 15, lineHeight: 22, color: theme.colors.textSecondary }}>{assetCode}</Text>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPress={loadInspections} disabled={isLoading} style={{ paddingVertical: 6 }}>
            <Text
              style={{
                fontSize: 15,
                fontWeight: '700',
                color: isLoading ? theme.colors.textMuted : theme.colors.info,
              }}
            >
              Refresh
            </Text>
          </Pressable>
          <Pressable onPress={() => navigation.goBack()} style={{ paddingVertical: 6 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: theme.colors.info }}>Back</Text>
          </Pressable>
        </View>
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
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 28, gap: 12 }}>
            <ActivityIndicator size="large" color={theme.colors.info} />
            <Text style={{ fontSize: 15, color: theme.colors.textSecondary }}>Loading inspection history...</Text>
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
              onPress={loadInspections}
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

        {!isLoading && !error && inspections.length === 0 ? (
          <View
            style={{
              backgroundColor: theme.colors.infoSoft,
              borderRadius: 16,
              padding: 18,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: '700', color: theme.colors.textPrimary }}>
              No inspections submitted yet.
            </Text>
          </View>
        ) : null}

        {!isLoading && !error
          ? inspections.map((inspection) => (
              <InspectionHistoryCard
                key={inspection.id}
                inspection={inspection}
                onOpenImagePreview={(params) =>
                  navigation.navigate('ImagePreview', params)
                }
                onOpenInspectionDetail={() =>
                  navigation.navigate('InspectionDetail', {
                    inspectionId: inspection.id,
                    assetCode,
                  })
                }
              />
            ))
          : null}
      </ScrollView>
    </View>
  );
}

function InspectionHistoryCard({
  inspection,
  onOpenImagePreview,
  onOpenInspectionDetail,
}: {
  inspection: AssetInspectionHistoryItem;
  onOpenImagePreview: (params: ImagePreviewParams) => void;
  onOpenInspectionDetail: () => void;
}) {
  const theme = useTheme();
  const firstImage = inspection.images?.find((image) => getImageSourceUri(image)) ?? null;
  const thumbnailUri = firstImage ? getImageSourceUri(firstImage) : null;
  const remarksPreview = createRemarksPreview(inspection.remarks);

  return (
    <Pressable
      onPress={onOpenInspectionDetail}
      style={({ pressed }) => ({
        backgroundColor: theme.colors.card,
        borderRadius: 16,
        padding: 16,
        gap: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed ? 0.94 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: theme.colors.textPrimary }}>
            Cycle {inspection.cycleNumber}
          </Text>
          <Text style={{ fontSize: 13, lineHeight: 19, color: theme.colors.textSecondary }}>
            Submitted {formatDateTime(inspection.submittedAt)}
          </Text>
        </View>
        <View
          style={{
            alignSelf: 'flex-start',
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 6,
            backgroundColor:
              inspection.status === 'SUBMITTED'
                ? theme.colors.successSoft
                : theme.colors.warningSoft,
          }}
        >
          <Text
            style={{
              fontSize: 12,
              fontWeight: '700',
              color:
                inspection.status === 'SUBMITTED'
                  ? theme.colors.successText
                  : theme.colors.warningText,
            }}
          >
            {formatStatus(inspection.status)}
          </Text>
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.textSecondary }}>Remarks</Text>
        <Text
          style={{
            fontSize: 15,
            lineHeight: 22,
            color: remarksPreview ? theme.colors.textPrimary : theme.colors.textSecondary,
          }}
        >
          {remarksPreview || 'No remarks recorded.'}
        </Text>
      </View>

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>Images</Text>
        <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary }}>
          {inspection.imageCount ?? inspection.images?.length ?? 0}
        </Text>
      </View>

      {thumbnailUri ? (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={(event) => {
            event.stopPropagation();
            const previewImages = (inspection.images ?? [])
              .map((image) => ({ uri: getImageSourceUri(image) ?? '', title: getImageTitle(image) }))
              .filter((previewImage) => previewImage.uri);
            onOpenImagePreview({ images: previewImages, index: 0 });
          }}
        >
          <Image
            source={{ uri: thumbnailUri }}
            style={{
              width: '100%',
              height: 160,
              borderRadius: 14,
              backgroundColor: theme.colors.surfaceMuted,
            }}
            resizeMode="cover"
          />
        </TouchableOpacity>
      ) : null}
    </Pressable>
  );
}

function createRemarksPreview(remarks?: string | null) {
  const normalized = remarks?.trim();

  if (!normalized) {
    return '';
  }

  return normalized.length > 140 ? `${normalized.slice(0, 137).trim()}...` : normalized;
}

function formatStatus(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getImageSourceUri(image: InspectionImage & { uri?: string }) {
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

function getImageTitle(image: ({ type?: string | null } & Partial<InspectionImage>) | null) {
  return image?.type || 'Inspection Image';
}
