import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import {
  AppButton,
  Card,
  EmptyState,
  ErrorBanner,
  InlineButton,
  LoadingBlock,
  Screen,
  SectionTitle,
  SelectCard,
  TextField,
} from '../ui';
import { SiteVisit, Substation, Team } from '../types';

export function CheckInScreen({
  token,
  onBack,
  onCreated,
  onUnauthorized,
}: {
  token: string;
  onBack: () => void;
  onCreated: (visit: SiteVisit) => void;
  onUnauthorized: (error?: unknown) => Promise<void>;
}) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [substations, setSubstations] = useState<Substation[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [selectedSubstationId, setSelectedSubstationId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOptions = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      const [teamList, substationList] = await Promise.all([
        api.getTeams(token),
        api.getSubstations(token),
      ]);

      setTeams(teamList);
      setSubstations(substationList);

      if (!selectedTeamId && teamList.length > 0) {
        setSelectedTeamId(teamList[0].id);
      }

      if (!selectedSubstationId && substationList.length > 0) {
        setSelectedSubstationId(substationList[0].id);
      }
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        await onUnauthorized(loadError);
        return;
      }

      setError(loadError instanceof Error ? loadError.message : 'Unable to load check-in options.');
    } finally {
      setIsLoading(false);
    }
  }, [onUnauthorized, selectedSubstationId, selectedTeamId, token]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  async function handleCreateVisit() {
    try {
      setIsSubmitting(true);
      setError(null);

      const visit = await api.createSiteVisit(token, {
        teamId: selectedTeamId,
        substationId: selectedSubstationId,
        notes: notes.trim() || undefined,
      });

      onCreated(visit);
    } catch (createError) {
      if (createError instanceof ApiError && createError.status === 401) {
        await onUnauthorized(createError);
        return;
      }

      setError(createError instanceof Error ? createError.message : 'Unable to create site visit.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen
      title="Check-In"
      subtitle="Select the team and substation for a shared field visit."
      actions={
        <>
          <InlineButton label="Back" onPress={onBack} />
          <InlineButton label="Refresh" onPress={loadOptions} />
        </>
      }
      keyboardAware
    >
      <ErrorBanner message={error} />
      {isLoading ? <LoadingBlock label="Loading teams and substations..." /> : null}

      {!isLoading ? (
        <>
          <Card>
            <SectionTitle>Select Team</SectionTitle>
            {teams.length === 0 ? (
              <EmptyState
                title="No active teams"
                description="This user must belong to a team before a site visit can be created."
              />
            ) : (
              teams.map((team) => (
                <SelectCard
                  key={team.id}
                  label={`${team.code} - ${team.name}`}
                  selected={selectedTeamId === team.id}
                  onPress={() => setSelectedTeamId(team.id)}
                />
              ))
            )}
          </Card>

          <Card>
            <SectionTitle>Select Substation</SectionTitle>
            {substations.length === 0 ? (
              <EmptyState
                title="No substations"
                description="The backend did not return any active substations for this tenant."
              />
            ) : (
              substations.map((substation) => (
                <SelectCard
                  key={substation.id}
                  label={`${substation.code} - ${substation.name}`}
                  description={substation.location || null}
                  selected={selectedSubstationId === substation.id}
                  onPress={() => setSelectedSubstationId(substation.id)}
                />
              ))
            )}
          </Card>

          <Card>
            <SectionTitle>Visit Notes</SectionTitle>
            <TextField
              label="Optional Notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Add arrival notes or job context"
              multiline
            />
          </Card>
        </>
      ) : null}

      <AppButton
        label={isSubmitting ? 'Creating Site Visit...' : 'Create Site Visit'}
        onPress={handleCreateVisit}
        loading={isSubmitting}
        disabled={!selectedTeamId || !selectedSubstationId || isLoading}
      />
    </Screen>
  );
}
