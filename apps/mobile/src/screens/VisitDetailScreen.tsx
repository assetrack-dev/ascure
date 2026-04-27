import { useCallback, useEffect, useMemo, useState } from 'react';
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
  onUnauthorized,
}: {
  token: string;
  visitId: string;
  substationId: string;
  successMessage?: string;
  onBack: () => void;
  onOpenInspection: (inspectionId: string) => void;
  onUnauthorized: (error?: unknown) => Promise<void>;
}) {
  const [visit, setVisit] = useState<SiteVisit | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workingAssetId, setWorkingAssetId] = useState<string | null>(null);

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
            {assets.length === 0 ? (
              <EmptyState
                title="No assets found"
                description="The selected substation does not currently have any assets returned by the backend."
              />
            ) : (
              assets.map((asset) => {
                const latestSubmittedInspection = getLatestSubmittedInspection(visit, asset.id);
                const inspectionCount = inspectionCounts.get(asset.id) ?? 0;
                const nextCycle = getNextInspectionCycle(visit, asset.id);

                return (
                  <Card key={asset.id}>
                    <KeyValueRow label="Asset" value={`${asset.code} - ${asset.name}`} />
                    <KeyValueRow label="Type" value={asset.assetType.name} />
                    <KeyValueRow label="Serial" value={asset.serialNumber || 'Not set'} />
                    <KeyValueRow label="Completed Inspections" value={String(inspectionCount)} />
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
                      label="Start Inspection"
                      onPress={() => handleOpenAssetInspection(asset)}
                      loading={workingAssetId === asset.id}
                      disabled={workingAssetId !== null && workingAssetId !== asset.id}
                    />
                  </Card>
                );
              })
            )}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
