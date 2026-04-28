import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, ApiError } from '../api';
import { DefectListItem } from '../types';
import { formatDateTime } from '../utils';
import {
  AppButton,
  BodyText,
  Card,
  ErrorBanner,
  InlineButton,
  KeyValueRow,
  LoadingBlock,
  Screen,
  SectionTitle,
  StatusChip,
  TextField,
} from '../ui';

export function DefectListScreen({
  token,
  onBack,
  onOpenDefect,
  onOpenInspection,
  onUnauthorized,
}: {
  token: string;
  onBack: () => void;
  onOpenDefect: (item: DefectListItem) => void;
  onOpenInspection: (item: DefectListItem) => void;
  onUnauthorized: (error?: unknown) => Promise<void>;
}) {
  const [defects, setDefects] = useState<DefectListItem[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDefects = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await api.getDefects(token);
      setDefects(response);
    } catch (loadError) {
      console.error('[DEFECT LIST LOAD ERROR]', loadError);

      if (loadError instanceof ApiError && loadError.status === 401) {
        await onUnauthorized(loadError);
        return;
      }

      setDefects([]);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load defects.');
    } finally {
      setIsLoading(false);
    }
  }, [onUnauthorized, token]);

  useEffect(() => {
    loadDefects();
  }, [loadDefects]);

  const visibleDefects = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return defects;
    }

    return defects.filter((defect) => {
      const assetCode = defect.assetCode?.toLowerCase() ?? '';
      const label = defect.label.toLowerCase();

      return assetCode.includes(query) || label.includes(query);
    });
  }, [defects, search]);

  return (
    <Screen
      title="Defects"
      actions={
        <>
          <InlineButton label="Refresh" onPress={loadDefects} disabled={isLoading} />
          <InlineButton label="Back" onPress={onBack} />
        </>
      }
    >
      <ErrorBanner message={error} />
      {isLoading ? <LoadingBlock label="Loading defects..." /> : null}

      {!isLoading ? (
        <>
          <Card>
            <SectionTitle>Summary</SectionTitle>
            <KeyValueRow label="Total Defects" value={String(defects.length)} />
            <KeyValueRow label="Open" value={String(countByStatus(defects, 'OPEN'))} />
            <KeyValueRow label="In Progress" value={String(countByStatus(defects, 'IN_PROGRESS'))} />
            <KeyValueRow label="Closed" value={String(countByStatus(defects, 'CLOSED'))} />
            <TextField
              label="Search"
              value={search}
              onChangeText={setSearch}
              placeholder="Asset code or defect label"
            />
          </Card>

          {!error && defects.length === 0 ? (
            <Card>
              <BodyText>No defects found.</BodyText>
            </Card>
          ) : null}

          {!error && defects.length > 0 && visibleDefects.length === 0 ? (
            <Card>
              <BodyText>No defects found.</BodyText>
            </Card>
          ) : null}

          {!error
            ? visibleDefects.map((defect) => (
                <DefectCard
                  key={defect.id}
                  defect={defect}
                  onOpenDefect={() => onOpenDefect(defect)}
                  onOpenInspection={() => onOpenInspection(defect)}
                />
              ))
            : null}

          {error ? (
            <Card>
              <AppButton label="Try Again" variant="secondary" onPress={loadDefects} />
            </Card>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function DefectCard({
  defect,
  onOpenDefect,
  onOpenInspection,
}: {
  defect: DefectListItem;
  onOpenDefect: () => void;
  onOpenInspection: () => void;
}) {
  return (
    <Pressable
      onPress={onOpenDefect}
      style={({ pressed }) => ({
        backgroundColor: '#ffffff',
        borderRadius: 18,
        padding: 16,
        gap: 12,
        borderWidth: 1,
        borderColor: '#dce5f1',
        opacity: pressed ? 0.94 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a' }}>
            {defect.assetCode || 'Unknown Asset'}
          </Text>
          {defect.assetType ? (
            <Text style={{ fontSize: 14, lineHeight: 20, color: '#607086' }}>
              {defect.assetType}
            </Text>
          ) : null}
        </View>
        <StatusChip label={formatStatus(defect.status)} tone={getStatusTone(defect.status)} />
      </View>

      <KeyValueRow
        label="Cycle"
        value={defect.cycleNumber ? `Cycle ${defect.cycleNumber}` : 'Not available'}
      />
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: '#607086' }}>Defect</Text>
        <Text style={{ fontSize: 16, lineHeight: 23, fontWeight: '700', color: '#10233d' }}>
          {defect.label}
        </Text>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: '#607086' }}>Remark</Text>
        <Text
          style={{
            fontSize: 14,
            lineHeight: 21,
            color: defect.remark ? '#526277' : '#8a98aa',
          }}
        >
          {createRemarkPreview(defect.remark) || 'No remark.'}
        </Text>
      </View>
      <KeyValueRow label="Submitted" value={formatDateTime(defect.submittedAt)} />
      <Pressable
        onPress={(event) => {
          event.stopPropagation();
          onOpenInspection();
        }}
        style={({ pressed }) => ({
          minHeight: 54,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0f5cd8',
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#ffffff' }}>View Inspection</Text>
      </Pressable>
    </Pressable>
  );
}

function countByStatus(defects: DefectListItem[], status: DefectListItem['status']) {
  return defects.filter((defect) => defect.status === status).length;
}

function getStatusTone(status: DefectListItem['status']) {
  if (status === 'CLOSED') {
    return 'success';
  }

  if (status === 'OPEN') {
    return 'warning';
  }

  return 'neutral';
}

function formatStatus(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function createRemarkPreview(remark?: string | null) {
  const normalized = remark?.trim();

  if (!normalized) {
    return '';
  }

  return normalized.length > 120 ? `${normalized.slice(0, 117).trim()}...` : normalized;
}
