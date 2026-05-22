import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api, ApiError } from '../api';
import { useSession } from '../context/AuthContext';
import type { AppDrawerScreenProps } from '../navigation/types';
import { DefectListItem } from '../types';
import { formatDateTime } from '../utils';
import {
  AppButton,
  BodyText,
  Card,
  ErrorBanner,
  KeyValueRow,
  LoadingBlock,
  Screen,
  SectionTitle,
  StatusChip,
  TextField,
  uiTheme,
} from '../ui';

export function DefectListScreen() {
  const navigation = useNavigation<AppDrawerScreenProps<'DefectList'>['navigation']>();
  const { token, handleUnauthorized } = useSession();
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
        await handleUnauthorized(loadError);
        return;
      }

      setDefects([]);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load defects.');
    } finally {
      setIsLoading(false);
    }
  }, [handleUnauthorized, token]);

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
      leftAction={{
        icon: 'menu',
        onPress: () => navigation.openDrawer(),
        accessibilityLabel: 'Menu',
      }}
      rightAction={{
        icon: 'refresh',
        onPress: loadDefects,
        accessibilityLabel: 'Refresh',
        disabled: isLoading,
      }}
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
                  onOpenDefect={() =>
                    navigation.navigate('DefectDetail', { defectId: defect.id })
                  }
                  onOpenInspection={() =>
                    navigation.navigate('InspectionDetail', {
                      inspectionId: defect.inspectionId,
                      assetCode: defect.assetCode,
                    })
                  }
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
      style={({ pressed }) => [styles.defectCard, pressed && styles.defectCardPressed]}
    >
      <View style={styles.defectHeader}>
        <View style={styles.defectTitleWrap}>
          <Text style={styles.defectAssetCode}>
            {defect.assetCode || 'Unknown Asset'}
          </Text>
          {defect.assetType ? (
            <Text style={styles.defectAssetType}>
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
      <View style={styles.detailGroup}>
        <Text style={styles.detailLabel}>Defect</Text>
        <Text style={styles.detailValue}>
          {defect.label}
        </Text>
      </View>
      <View style={styles.detailGroup}>
        <Text style={styles.detailLabel}>Remark</Text>
        <Text
          style={[styles.remarkText, !defect.remark && styles.remarkTextMuted]}
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
        style={({ pressed }) => [styles.inspectionButton, pressed && styles.inspectionButtonPressed]}
      >
        <Text style={styles.inspectionButtonText}>View Inspection</Text>
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

const styles = StyleSheet.create({
  defectCard: {
    backgroundColor: uiTheme.colors.card,
    borderRadius: uiTheme.radius.card,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: uiTheme.colors.border,
  },
  defectCardPressed: {
    backgroundColor: uiTheme.colors.surfacePressed,
  },
  defectHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  defectTitleWrap: {
    flex: 1,
    gap: 3,
  },
  defectAssetCode: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    color: uiTheme.colors.textPrimary,
  },
  defectAssetType: {
    fontSize: 13,
    lineHeight: 18,
    color: uiTheme.colors.textSecondary,
  },
  detailGroup: {
    gap: 5,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: uiTheme.colors.textSecondary,
  },
  detailValue: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: uiTheme.colors.textPrimary,
  },
  remarkText: {
    fontSize: 14,
    lineHeight: 21,
    color: uiTheme.colors.textSecondary,
  },
  remarkTextMuted: {
    color: uiTheme.colors.textMuted,
  },
  inspectionButton: {
    minHeight: 48,
    borderRadius: uiTheme.radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uiTheme.colors.primary,
  },
  inspectionButtonPressed: {
    opacity: 0.9,
  },
  inspectionButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
});
