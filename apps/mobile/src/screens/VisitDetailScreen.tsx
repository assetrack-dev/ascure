import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { api, ApiError } from '../api';
import {
  formatDateTime,
  formatInspectionStatus,
  getInspectionStatusTone,
  getLatestSubmittedInspection,
  getNextInspectionCycle,
} from '../utils';
import {
  AppButton,
  BodyText,
  Card,
  EmptyState,
  ErrorBanner,
  InlineButton,
  KeyValueRow,
  LoadingBlock,
  Screen,
  SectionTitle,
  StatusChip,
  SuccessBanner,
} from '../ui';
import { Asset, SiteVisit } from '../types';

export function VisitDetailScreen({
  token,
  visitId,
  substationId,
  successMessage,
  onBack,
  onOpenInspection,
  onOpenAddAsset,
  onOpenEditAsset,
  onUnauthorized,
}: {
  token: string;
  visitId: string;
  substationId: string;
  successMessage?: string;
  onBack: () => void;
  onOpenInspection: (inspectionId: string) => void;
  onOpenAddAsset: () => void;
  onOpenEditAsset: (asset: Asset) => void;
  onUnauthorized: (error?: unknown) => Promise<void>;
}) {
  const [visit, setVisit] = useState<SiteVisit | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workingAssetId, setWorkingAssetId] = useState<string | null>(null);
  const [statusAssetId, setStatusAssetId] = useState<string | null>(null);

  const loadVisitData = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      const [visitResponse, assetList] = await Promise.all([
        api.getSiteVisit(token, visitId),
        api.getAssets(token, substationId),
      ]);

      setVisit(visitResponse);
      setAssets(assetList);
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        await onUnauthorized(loadError);
        return;
      }

      setError(loadError instanceof Error ? loadError.message : 'Unable to load visit details.');
    } finally {
      setIsLoading(false);
    }
  }, [onUnauthorized, substationId, token, visitId]);

  useEffect(() => {
    loadVisitData();
  }, [loadVisitData]);

  const inspectionCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const inspection of visit?.inspections ?? []) {
      if (inspection.completionStatus !== 'SUBMITTED') {
        continue;
      }

      counts.set(inspection.assetId, (counts.get(inspection.assetId) ?? 0) + 1);
    }

    return counts;
  }, [visit]);

  async function handleOpenAssetInspection(asset: Asset) {
    if (!visit) {
      return;
    }

    try {
      setWorkingAssetId(asset.id);
      setError(null);

      const inspection = await api.createInspection(token, {
        siteVisitId: visit.id,
        assetId: asset.id,
        inspectionCycle: getNextInspectionCycle(visit, asset.id),
      });

      onOpenInspection(inspection.id);
    } catch (actionError) {
      if (actionError instanceof ApiError && actionError.status === 401) {
        await onUnauthorized(actionError);
        return;
      }

      setError(actionError instanceof Error ? actionError.message : 'Unable to start inspection.');
    } finally {
      setWorkingAssetId(null);
    }
  }

  async function handleMarkAssetNotFound(asset: Asset) {
    try {
      setStatusAssetId(asset.id);
      setError(null);

      const updatedAsset = await api.updateAssetStatus(token, asset.id, {
        status: 'NOT_FOUND',
      });

      setAssets((currentAssets) =>
        currentAssets.map((currentAsset) => (currentAsset.id === asset.id ? updatedAsset : currentAsset)),
      );
    } catch (actionError) {
      if (actionError instanceof ApiError && actionError.status === 401) {
        await onUnauthorized(actionError);
        return;
      }

      setError(actionError instanceof Error ? actionError.message : 'Unable to update asset status.');
    } finally {
      setStatusAssetId(null);
    }
  }

  function handleConfirmMarkAssetNotFound(asset: Asset) {
    if (asset.status === 'NOT_FOUND') {
      return;
    }

    Alert.alert(
      'Mark asset as not found?',
      'The asset will stay in this visit list and be marked as Not Found.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Mark Not Found',
          style: 'destructive',
          onPress: () => {
            void handleMarkAssetNotFound(asset);
          },
        },
      ],
    );
  }

  return (
    <Screen
      title="Visit Detail"
      subtitle="Review the shared visit, available assets, and start a fresh inspection when needed."
      actions={
        <>
          <InlineButton label="Back" onPress={onBack} />
          <InlineButton label="Refresh" onPress={loadVisitData} />
        </>
      }
    >
      <ErrorBanner message={error} />
      <SuccessBanner message={successMessage} />
      {isLoading ? <LoadingBlock label="Loading visit details and assets..." /> : null}

      {!isLoading && visit ? (
        <>
          <Card>
            <SectionTitle>Visit Summary</SectionTitle>
            <KeyValueRow label="Substation" value={`${visit.substation.code} - ${visit.substation.name}`} />
            <KeyValueRow label="Team" value={`${visit.team.code} - ${visit.team.name}`} />
            <KeyValueRow label="Started" value={formatDateTime(visit.startedAt)} />
            <KeyValueRow label="Created By" value={visit.createdBy?.name ?? 'Unknown'} />
            {visit.substation.location ? <KeyValueRow label="Location" value={visit.substation.location} /> : null}
            <StatusChip label={visit.status} tone="success" />
          </Card>

          <Card>
            <SectionTitle>Team Members</SectionTitle>
            {(visit.users ?? []).length === 0 ? (
              <EmptyState
                title="No assigned users"
                description="This visit does not list any joined team members."
              />
            ) : (
              (visit.users ?? []).map((member) => (
                <Card key={member.id}>
                  <KeyValueRow label="Name" value={member.user.name} />
                  <KeyValueRow label="Role" value={member.user.role} />
                  <KeyValueRow label="Joined" value={formatDateTime(member.joinedAt)} />
                </Card>
              ))
            )}
          </Card>

          <Card>
            <SectionTitle>Assets</SectionTitle>
            <AppButton label="+ Add Asset" onPress={onOpenAddAsset} variant="secondary" />
            {assets.length === 0 ? (
              <EmptyState
                title="No assets found"
                description="No assets have been registered for this substation yet. Add the first asset to begin inspections."
              />
            ) : (
              assets.map((asset) => {
                const latestSubmittedInspection = getLatestSubmittedInspection(visit, asset.id);
                const inspectionCount = inspectionCounts.get(asset.id) ?? 0;
                const nextCycle = getNextInspectionCycle(visit, asset.id);
                const isNotFound = asset.status === 'NOT_FOUND';
                const assetStatusLabel = isNotFound ? 'Not Found' : asset.status;
                const assetLabel = asset.name
                  ? `${asset.assetCode} - ${asset.name}`
                  : `${asset.assetCode} - Unnamed asset`;
                const hasCoordinates =
                  asset.latitude !== null &&
                  asset.latitude !== undefined &&
                  asset.longitude !== null &&
                  asset.longitude !== undefined;

                return (
                  <View key={asset.id} style={isNotFound ? styles.notFoundAssetCard : undefined}>
                    <Card>
                      <KeyValueRow label="Asset" value={assetLabel} />
                      <KeyValueRow label="Type" value={asset.assetType.name} />
                      <KeyValueRow label="Status" value={assetStatusLabel} />
                      {isNotFound ? <StatusChip label="Not Found" /> : null}
                      <KeyValueRow label="Completed Inspections" value={String(inspectionCount)} />
                      {hasCoordinates ? (
                        <KeyValueRow
                          label="Coordinates"
                          value={`${asset.latitude?.toFixed(6)}, ${asset.longitude?.toFixed(6)}`}
                        />
                      ) : null}
                      {latestSubmittedInspection ? (
                        <>
                          <KeyValueRow
                            label="Last Completed Status"
                            value={formatInspectionStatus(latestSubmittedInspection.completionStatus)}
                          />
                          <KeyValueRow
                            label="Last Completed Cycle"
                            value={`Cycle ${latestSubmittedInspection.inspectionCycle}`}
                          />
                          <KeyValueRow
                            label="Completed At"
                            value={formatDateTime(latestSubmittedInspection.submittedAt)}
                          />
                          <StatusChip
                            label={`${formatInspectionStatus(latestSubmittedInspection.completionStatus)} - Cycle ${latestSubmittedInspection.inspectionCycle}`}
                            tone={getInspectionStatusTone(latestSubmittedInspection)}
                          />
                        </>
                      ) : (
                        <BodyText muted>No completed inspection has been submitted for this asset yet.</BodyText>
                      )}
                      <BodyText muted>
                        Starting a new inspection will create cycle {nextCycle} using the latest active template from the backend.
                      </BodyText>
                      <AppButton
                        label="Edit Asset"
                        onPress={() => onOpenEditAsset(asset)}
                        variant="secondary"
                        disabled={statusAssetId !== null || workingAssetId !== null}
                      />
                      <AppButton
                        label="Mark Not Found"
                        onPress={() => handleConfirmMarkAssetNotFound(asset)}
                        variant="ghost"
                        loading={statusAssetId === asset.id}
                        disabled={
                          isNotFound ||
                          workingAssetId !== null ||
                          (statusAssetId !== null && statusAssetId !== asset.id)
                        }
                      />
                      <AppButton
                        label="Start Inspection"
                        onPress={() => handleOpenAssetInspection(asset)}
                        loading={workingAssetId === asset.id}
                        disabled={
                          statusAssetId !== null ||
                          (workingAssetId !== null && workingAssetId !== asset.id)
                        }
                      />
                    </Card>
                  </View>
                );
              })
            )}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  notFoundAssetCard: {
    opacity: 0.6,
  },
});
