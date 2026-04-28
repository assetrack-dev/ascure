import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { api, ApiError, API_BASE_URL } from '../api';
import { AssetInspectionHistoryItem, InspectionImage } from '../types';
import { formatDateTime } from '../utils';

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');

export function AssetInspectionHistoryScreen({
  token,
  assetId,
  assetCode,
  onBack,
  onUnauthorized,
}: {
  token: string;
  assetId: string;
  assetCode?: string;
  onBack: () => void;
  onUnauthorized: (error?: unknown) => Promise<void>;
}) {
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
        await onUnauthorized(loadError);
        return;
      }

      setInspections([]);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load inspection history.');
    } finally {
      setIsLoading(false);
    }
  }, [assetId, onUnauthorized, token]);

  useEffect(() => {
    loadInspections();
  }, [loadInspections]);

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
            Inspection History
          </Text>
          {assetCode ? (
            <Text style={{ fontSize: 15, lineHeight: 22, color: '#526277' }}>{assetCode}</Text>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPress={loadInspections} disabled={isLoading} style={{ paddingVertical: 6 }}>
            <Text
              style={{
                fontSize: 15,
                fontWeight: '700',
                color: isLoading ? '#94a3b8' : '#0f5cd8',
              }}
            >
              Refresh
            </Text>
          </Pressable>
          <Pressable onPress={onBack} style={{ paddingVertical: 6 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#0f5cd8' }}>Back</Text>
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
            <ActivityIndicator size="large" color="#0f5cd8" />
            <Text style={{ fontSize: 15, color: '#526277' }}>Loading inspection history...</Text>
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
              onPress={loadInspections}
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

        {!isLoading && !error && inspections.length === 0 ? (
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
              No inspections submitted yet.
            </Text>
          </View>
        ) : null}

        {!isLoading && !error
          ? inspections.map((inspection) => (
              <InspectionHistoryCard key={inspection.id} inspection={inspection} />
            ))
          : null}
      </ScrollView>
    </View>
  );
}

function InspectionHistoryCard({ inspection }: { inspection: AssetInspectionHistoryItem }) {
  const firstImage = inspection.images?.find((image) => getImageSourceUri(image)) ?? null;
  const thumbnailUri = firstImage ? getImageSourceUri(firstImage) : null;
  const remarksPreview = createRemarksPreview(inspection.remarks);

  return (
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
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a' }}>
            Cycle {inspection.cycleNumber}
          </Text>
          <Text style={{ fontSize: 13, lineHeight: 19, color: '#607086' }}>
            Submitted {formatDateTime(inspection.submittedAt)}
          </Text>
        </View>
        <View
          style={{
            alignSelf: 'flex-start',
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 6,
            backgroundColor: inspection.status === 'SUBMITTED' ? '#dcfce7' : '#fef3c7',
          }}
        >
          <Text
            style={{
              fontSize: 12,
              fontWeight: '700',
              color: inspection.status === 'SUBMITTED' ? '#166534' : '#92400e',
            }}
          >
            {formatStatus(inspection.status)}
          </Text>
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: '#607086' }}>Remarks</Text>
        <Text
          style={{
            fontSize: 15,
            lineHeight: 22,
            color: remarksPreview ? '#10233d' : '#607086',
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
        <Text style={{ fontSize: 14, color: '#607086' }}>Images</Text>
        <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a' }}>
          {inspection.imageCount ?? inspection.images?.length ?? 0}
        </Text>
      </View>

      {thumbnailUri ? (
        <Image
          source={{ uri: thumbnailUri }}
          style={{
            width: '100%',
            height: 160,
            borderRadius: 14,
            backgroundColor: '#e5edf8',
          }}
          resizeMode="cover"
        />
      ) : null}
    </View>
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
