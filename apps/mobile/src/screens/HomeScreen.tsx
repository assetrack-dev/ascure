import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { formatDateTime, formatRole } from '../utils';
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
} from '../ui';
import { SessionUser, SiteVisit, Team } from '../types';

export function HomeScreen({
  token,
  initialUser,
  onUserRefreshed,
  onOpenCheckIn,
  onOpenDashboard,
  onOpenAssetMap,
  onOpenDefects,
  onOpenChecklistTemplates,
  onOpenVisit,
  onLogout,
  onUnauthorized,
}: {
  token: string;
  initialUser: SessionUser;
  onUserRefreshed: (user: SessionUser) => void;
  onOpenCheckIn: () => void;
  onOpenDashboard: () => void;
  onOpenAssetMap: () => void;
  onOpenDefects: () => void;
  onOpenChecklistTemplates: () => void;
  onOpenVisit: (visit: SiteVisit) => void;
  onLogout: () => Promise<void>;
  onUnauthorized: (error?: unknown) => Promise<void>;
}) {
  const [user, setUser] = useState(initialUser);
  const [teams, setTeams] = useState<Team[]>([]);
  const [activeVisits, setActiveVisits] = useState<SiteVisit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHomeData = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      const [me, teamList, visitList] = await Promise.all([
        api.getMe(token),
        api.getTeams(token),
        api.getActiveSiteVisits(token),
      ]);

      setUser(me);
      setTeams(teamList);
      setActiveVisits(visitList);
      onUserRefreshed(me);
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        await onUnauthorized(loadError);
        return;
      }

      setError(loadError instanceof Error ? loadError.message : 'Unable to load home data.');
    } finally {
      setIsLoading(false);
    }
  }, [onUnauthorized, onUserRefreshed, token]);

  useEffect(() => {
    loadHomeData();
  }, [loadHomeData]);

  return (
    <Screen
      title="Home"
      subtitle="Technician overview for your teams, shared visits, and next actions."
      actions={
        <>
          <InlineButton label="Refresh" onPress={loadHomeData} />
          <InlineButton label="Logout" onPress={onLogout} />
        </>
      }
    >
      <ErrorBanner message={error} />
      {isLoading ? <LoadingBlock label="Loading user, teams, and active site visits..." /> : null}

      {!isLoading ? (
        <>
          <Card>
            <SectionTitle>User Info</SectionTitle>
            <KeyValueRow label="Name" value={user.name} />
            <KeyValueRow label="Email" value={user.email} />
            <KeyValueRow label="Role" value={formatRole(user.role)} />
          </Card>

          <Card>
            <SectionTitle>Your Teams</SectionTitle>
            {teams.length === 0 ? (
              <EmptyState
                title="No team membership"
                description="This user is not attached to any active team yet."
              />
            ) : (
              teams.map((team) => (
                <Card key={team.id}>
                  <KeyValueRow label="Team" value={team.name} />
                  <KeyValueRow label="Code" value={team.code} />
                </Card>
              ))
            )}
          </Card>

          <Card>
            <SectionTitle>Active Site Visits</SectionTitle>
            {activeVisits.length === 0 ? (
              <EmptyState
                title="No active visits"
                description="Create a new check-in to start work at a substation."
              />
            ) : (
              activeVisits.map((visit) => (
                <Card key={visit.id}>
                  <ViewVisitSummary visit={visit} />
                  <AppButton label="Open Visit" onPress={() => onOpenVisit(visit)} />
                </Card>
              ))
            )}
          </Card>

          <Card>
            <SectionTitle>Next Step</SectionTitle>
            <BodyText>Start a new shared site visit when your team arrives at a substation.</BodyText>
            <AppButton label="Create Check-In" onPress={onOpenCheckIn} />
            <AppButton label="View Dashboard" variant="secondary" onPress={onOpenDashboard} />
            <AppButton label="Asset Map" variant="secondary" onPress={onOpenAssetMap} />
            <AppButton label="View Defects" variant="secondary" onPress={onOpenDefects} />
            <AppButton
              label="Manage Checklist Templates"
              variant="secondary"
              onPress={onOpenChecklistTemplates}
            />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function ViewVisitSummary({ visit }: { visit: SiteVisit }) {
  return (
    <>
      <KeyValueRow label="Substation" value={`${visit.substation.code} - ${visit.substation.name}`} />
      <KeyValueRow label="Team" value={`${visit.team.code} - ${visit.team.name}`} />
      <KeyValueRow label="Started" value={formatDateTime(visit.startedAt)} />
      <KeyValueRow label="Members" value={String(visit.users?.length ?? 0)} />
      {visit.substation.location ? <KeyValueRow label="Location" value={visit.substation.location} /> : null}
      <StatusChip label={visit.status} tone="success" />
    </>
  );
}
