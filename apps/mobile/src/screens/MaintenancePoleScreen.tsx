import { useMemo, useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RootStackScreenProps } from '../navigation/types';
import { useSession } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { useStampedPhoto } from '../camera/useStampedPhoto';
import {
  deleteRepairPhotoFile,
  enqueueMutation,
  enqueueRepairCompletion,
  isTempId,
  mintTempId,
  persistRepairPhoto,
  withdrawQueuedRepairPhoto,
} from '../syncQueue';
import {
  addLocalCompletion,
  addLocalFinding,
  addLocalPhoto,
  dismissLocalCompletion,
  overlayKejanggalan,
  pendingFindingItems,
  removeLocalFinding,
  removeLocalPhoto,
  toAbsoluteUrl,
  type LocalFinding,
  type OverlaidKejanggalan,
} from '../maintenance/maintenanceLocal';
import { useWorkPack } from '../maintenance/useWorkPack';
import {
  CATEGORY_LABEL,
  STAGE_LABEL,
  STATE_LABEL,
  type FindingItem,
  type RepairStage,
  type WorkPole,
} from '../maintenance/types';
import { AppButton, Card, EmptyState, ErrorBanner, LoadingBlock, Screen, StatusChip, WarningBanner } from '../ui';
import { Theme, useTheme } from '../theme';
import { severityToMarkCategory } from '../utils';
import { openStreetViewAt } from '../utils/streetView';

const STAGES: RepairStage[] = ['BEFORE', 'DURING', 'AFTER'];

/** What the crew reports when they could not fix it (TNB then decides). */
const CANNOT_REPAIR_OUTCOMES: Array<{ value: string; label: string }> = [
  { value: 'EXTERNAL_CONSTRAINT', label: 'Needs outage / access / landowner' },
  { value: 'ESCALATED', label: 'Needs TNB (e.g. pole replacement)' },
  { value: 'DEFERRED', label: 'Deferred — cannot do now' },
];

type Completing = { defectId: string; kind: 'DONE' | 'CANNOT' } | null;

type PoleItem = OverlaidKejanggalan & { localFinding?: LocalFinding };

/**
 * One pole in maintenance mode (docs/PLAN-maintenance-flow.md §7.1 / §6): its
 * Kejanggalan with the survey photo, stamped BEFORE / DURING / AFTER photos, and
 * "done" / "cannot repair". Everything works offline — photos and the decision
 * queue and sync when the signal returns.
 */
export function MaintenancePoleScreen() {
  const navigation = useNavigation<RootStackScreenProps<'MaintenancePole'>['navigation']>();
  const route = useRoute<RootStackScreenProps<'MaintenancePole'>['route']>();
  const { siteVisitId, assetId } = route.params;
  const { user } = useSession();
  const { isOffline, runQueueSync } = useSync();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { pack, local, fromCache, isLoading, error, reload } = useWorkPack(siteVisitId);
  const { takeStampedPhoto, overlay, isStamping } = useStampedPhoto();
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [completing, setCompleting] = useState<Completing>(null);
  const [outcome, setOutcome] = useState<string>(CANNOT_REPAIR_OUTCOMES[0].value);
  const [notes, setNotes] = useState('');
  // Plan §13 — adding a Kejanggalan that was not in the survey.
  const [adding, setAdding] = useState(false);
  const [findingItemId, setFindingItemId] = useState<string | null>(null);
  const [findingOption, setFindingOption] = useState<string | null>(null);
  const [findingNote, setFindingNote] = useState('');
  const [isAddingFinding, setIsAddingFinding] = useState(false);

  const surveyedPole = pack?.surveyedPoles?.find((candidate) => candidate.assetId === assetId) ?? null;
  // A pole with no Kejanggalan yet is still openable to add one.
  const pole: WorkPole | null =
    pack?.poles.find((candidate) => candidate.assetId === assetId) ??
    (surveyedPole
      ? {
          assetId: surveyedPole.assetId,
          assetCode: surveyedPole.assetCode,
          refCode: surveyedPole.refCode,
          noTiangLama: surveyedPole.noTiangLama,
          latitude: surveyedPole.latitude,
          longitude: surveyedPole.longitude,
          counts: { TODO: 0, IN_PROGRESS: 0, SUBMITTED: 0, CLOSED: 0 },
          kejanggalan: [],
        }
      : null);
  const items: PoleItem[] = useMemo(() => {
    if (!pole || !pack) return [];
    const server = pole.kejanggalan.map((item) => overlayKejanggalan(item, local));
    const added = pendingFindingItems(local, pack, pole.assetId).map((item) => ({
      ...overlayKejanggalan(item, local),
      localFinding: item.localFinding,
    }));
    return [...server, ...added];
  }, [local, pack, pole]);
  const poleCode = pole ? pole.refCode || pole.assetCode : 'Pole';

  /** Checklist items the crew may raise on this pole (its template, its work types). */
  const findingItems: FindingItem[] = useMemo(() => {
    if (!surveyedPole || !pack?.findingTemplates) return [];
    const template = pack.findingTemplates.find((row) => row.templateId === surveyedPole.templateId);
    return (template?.items ?? []).filter((item) => surveyedPole.categories.includes(item.category));
  }, [pack, surveyedPole]);
  const chosenFinding = findingItems.find((item) => item.templateItemId === findingItemId) ?? null;

  const kickSync = () => {
    if (!isOffline) void runQueueSync().catch(() => undefined);
  };

  const takePhoto = async (item: OverlaidKejanggalan, stage: RepairStage) => {
    setActionError(null);
    setBusyStage(`${item.id}:${stage}`);
    try {
      const photo = await takeStampedPhoto({ markCategory: severityToMarkCategory(item.severity) });
      if (!photo) return;
      const localId = `repair_${item.id}_${Date.now().toString(36)}`;
      const durableUri = await persistRepairPhoto(photo.uri, localId);
      await addLocalPhoto({
        id: localId,
        defectId: item.id,
        stage,
        uri: durableUri,
        takenAt: photo.takenAt,
        latitude: photo.latitude,
        longitude: photo.longitude,
      });
      await enqueueMutation({
        type: 'UPLOAD_DEFECT_EVIDENCE',
        tempId: mintTempId('evidence'),
        // A Kejanggalan added on site must reach the server first.
        dependsOn: isTempId(item.id) ? [item.id] : undefined,
        payload: {
          localPhotoId: localId,
          defectId: item.id,
          evidenceType: stage,
          uri: durableUri,
          latitude: photo.latitude,
          longitude: photo.longitude,
          timestamp: photo.takenAt,
        },
        label: `${STAGE_LABEL[stage]} photo · ${poleCode}`,
        sublabel: item.remark || item.label,
        ownerUserId: user.id,
      });
      if (photo.mocked) {
        Alert.alert(
          'Mock location detected',
          'This phone is reporting a simulated GPS location. The photo is flagged for review — turn off any mock-location app.',
        );
      }
      kickSync();
    } catch (captureError) {
      setActionError(captureError instanceof Error ? captureError.message : 'Unable to take the photo.');
    } finally {
      setBusyStage(null);
    }
  };

  const confirmRemoveLocal = (photoId: string, uri: string) =>
    Alert.alert('Remove this photo?', 'Only photos that have not synced yet can be removed.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            if (!(await withdrawQueuedRepairPhoto(photoId))) {
              Alert.alert('Already uploading', 'This photo is being sent right now and can no longer be removed.');
              return;
            }
            await removeLocalPhoto(photoId);
            await deleteRepairPhotoFile(uri).catch(() => undefined);
          })(),
      },
    ]);

  const submitCompletion = async (item: OverlaidKejanggalan) => {
    if (!completing) return;
    const isCannot = completing.kind === 'CANNOT';
    const resolutionOutcome = isCannot ? outcome : 'REPAIRED';
    const trimmed = notes.trim() || null;
    if (isCannot && !trimmed) {
      setActionError('Say why it cannot be repaired — TNB decides from this note.');
      return;
    }
    setActionError(null);
    await addLocalCompletion({
      defectId: item.id,
      resolutionOutcome,
      notes: trimmed,
      queuedAt: new Date().toISOString(),
    });
    await enqueueRepairCompletion({
      defectId: item.id,
      resolutionOutcome,
      maintenanceNotes: trimmed,
      label: `${isCannot ? 'Cannot repair' : 'Repair done'} · ${poleCode}`,
      sublabel: item.remark || item.label,
      ownerUserId: user.id,
    });
    setCompleting(null);
    setNotes('');
    kickSync();
  };

  const resetFinding = () => {
    setAdding(false);
    setFindingItemId(null);
    setFindingOption(null);
    setFindingNote('');
  };

  /**
   * Add a Kejanggalan found on site (plan §13): the stamped BEFORE photo IS the
   * proof, so it is taken first; nothing is queued if the camera is cancelled.
   * Works offline — the add and the photo sync in order.
   */
  const addFinding = async () => {
    if (!pole || !pack || !chosenFinding) return;
    const option = chosenFinding.options.find((candidate) => candidate.value === findingOption) ?? null;
    if (chosenFinding.options.length > 0 && !option) {
      setActionError('Pick which defect it is.');
      return;
    }
    const alreadyOpen = items.some(
      (item) =>
        item.label === chosenFinding.label &&
        item.displayState !== 'CLOSED' &&
        !item.localFinding?.rejectedReason,
    );
    if (alreadyOpen) {
      setActionError('This pole already has an open Kejanggalan for that item — use it below.');
      return;
    }
    setActionError(null);
    setIsAddingFinding(true);
    try {
      const severity = option?.severity ?? chosenFinding.severity;
      const photo = await takeStampedPhoto({ markCategory: severityToMarkCategory(severity) });
      if (!photo) return;

      const tempId = mintTempId('defect');
      const note = findingNote.trim() || null;
      const remark = [option?.label, note].filter(Boolean).join(' — ') || null;
      const localId = `repair_${tempId}_${Date.now().toString(36)}`;
      const durableUri = await persistRepairPhoto(photo.uri, localId);

      await addLocalFinding({
        tempId,
        siteVisitId,
        assetId: pole.assetId,
        label: chosenFinding.label,
        remark,
        severity,
        category: chosenFinding.category,
        addedAt: new Date().toISOString(),
      });
      await enqueueMutation({
        type: 'CREATE_DEFECT_FINDING',
        tempId,
        payload: {
          siteVisitId,
          assetId: pole.assetId,
          templateItemId: chosenFinding.templateItemId,
          optionValue: option?.value ?? null,
          note,
          clientRef: tempId,
        },
        label: `New Kejanggalan · ${poleCode}`,
        sublabel: remark ?? chosenFinding.label,
        ownerUserId: user.id,
      });
      await addLocalPhoto({
        id: localId,
        defectId: tempId,
        stage: 'BEFORE',
        uri: durableUri,
        takenAt: photo.takenAt,
        latitude: photo.latitude,
        longitude: photo.longitude,
      });
      await enqueueMutation({
        type: 'UPLOAD_DEFECT_EVIDENCE',
        tempId: mintTempId('evidence'),
        dependsOn: [tempId],
        payload: {
          localPhotoId: localId,
          defectId: tempId,
          evidenceType: 'BEFORE',
          uri: durableUri,
          latitude: photo.latitude,
          longitude: photo.longitude,
          timestamp: photo.takenAt,
        },
        label: `Before photo · ${poleCode}`,
        sublabel: remark ?? chosenFinding.label,
        ownerUserId: user.id,
      });
      if (photo.mocked) {
        Alert.alert(
          'Mock location detected',
          'This phone is reporting a simulated GPS location. The photo is flagged for review — turn off any mock-location app.',
        );
      }
      resetFinding();
      kickSync();
    } catch (addError) {
      setActionError(addError instanceof Error ? addError.message : 'Unable to add the Kejanggalan.');
    } finally {
      setIsAddingFinding(false);
    }
  };

  const dismissFinding = async (finding: LocalFinding) => {
    const files = await removeLocalFinding(finding.tempId);
    await Promise.all(files.map((uri) => deleteRepairPhotoFile(uri).catch(() => undefined)));
  };

  const openDirections = () => {
    if (!pole || pole.latitude === null || pole.longitude === null) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${pole.latitude},${pole.longitude}`;
    void Linking.openURL(url).catch(() =>
      Alert.alert('Unable to open directions', 'Install or enable Google Maps.'),
    );
  };

  const openPhotos = (urls: string[], index: number, title: string) =>
    navigation.navigate('ImagePreview', {
      images: urls.map((uri) => ({ uri, title })),
      index,
    });

  return (
    <Screen
      title={poleCode}
      subtitle={pole ? [pole.refCode ? pole.assetCode : null, pole.noTiangLama ? `Lama ${pole.noTiangLama}` : null].filter(Boolean).join(' · ') || undefined : undefined}
      keyboardAware
      leftAction={{ icon: 'back', onPress: () => navigation.goBack(), accessibilityLabel: 'Back' }}
      rightAction={{ icon: 'refresh', onPress: () => void reload(), accessibilityLabel: 'Refresh', disabled: isLoading }}
    >
      {overlay}
      <ErrorBanner message={error ?? actionError} />
      {fromCache || isOffline ? (
        <WarningBanner message="Offline — photos and decisions are saved on this phone and sync when you have signal." />
      ) : null}
      {isLoading && !pack ? <LoadingBlock label="Loading pole…" /> : null}

      {pack && !pole ? (
        <Card>
          <EmptyState icon="alert-circle" title="Pole not in this package" description="It may have been moved to another team. Refresh the package." />
        </Card>
      ) : null}

      {pole ? (
        <View style={styles.navRow}>
          <View style={styles.navButton}>
            <AppButton
              label="Navigate to pole"
              onPress={openDirections}
              disabled={pole.latitude === null || pole.longitude === null}
            />
          </View>
          {pole.latitude !== null && pole.longitude !== null ? (
            <View style={styles.navButton}>
              <AppButton
                label="Street View"
                variant="secondary"
                onPress={() => openStreetViewAt(pole.latitude as number, pole.longitude as number)}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {pole && findingItems.length > 0 && !adding ? (
        <View style={styles.addRow}>
          <AppButton
            label="+ Add Kejanggalan (not in survey)"
            variant="secondary"
            onPress={() => {
              resetFinding();
              setAdding(true);
            }}
          />
        </View>
      ) : null}
      {pole && pack && !pack.surveyedPoles ? (
        <Text style={styles.hint}>
          To add a new Kejanggalan here, refresh this package once while you have signal.
        </Text>
      ) : null}

      {adding ? (
        <Card>
          <Text style={styles.title}>New Kejanggalan on {poleCode}</Text>
          <Text style={styles.muted}>
            Found after the survey (e.g. Rentis now needed). Take the BEFORE photo to add it, then repair it as usual.
          </Text>
          <Text style={styles.section}>Checklist item</Text>
          {findingItems.map((candidate) => {
            const active = findingItemId === candidate.templateItemId;
            return (
              <Pressable
                key={candidate.templateItemId}
                onPress={() => {
                  setFindingItemId(candidate.templateItemId);
                  setFindingOption(candidate.options.length === 1 ? candidate.options[0].value : null);
                }}
                style={[styles.option, active && styles.optionActive]}
              >
                <Feather
                  name={active ? 'check-circle' : 'circle'}
                  size={16}
                  color={active ? theme.colors.primary : theme.colors.textMuted}
                />
                <Text style={styles.optionText}>
                  {candidate.label}
                  <Text style={styles.optionMeta}>{`  ·  ${CATEGORY_LABEL[candidate.category]}`}</Text>
                </Text>
              </Pressable>
            );
          })}
          {chosenFinding && chosenFinding.options.length > 1 ? (
            <>
              <Text style={styles.section}>Which defect</Text>
              {chosenFinding.options.map((option) => {
                const active = findingOption === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setFindingOption(option.value)}
                    style={[styles.option, active && styles.optionActive]}
                  >
                    <Feather
                      name={active ? 'check-circle' : 'circle'}
                      size={16}
                      color={active ? theme.colors.primary : theme.colors.textMuted}
                    />
                    <Text style={styles.optionText}>
                      {option.label}
                      <Text style={styles.optionMeta}>{`  ·  ${option.severity}`}</Text>
                    </Text>
                  </Pressable>
                );
              })}
            </>
          ) : null}
          <Text style={styles.section}>Note (optional)</Text>
          <TextInput
            value={findingNote}
            onChangeText={setFindingNote}
            placeholder="What you found"
            placeholderTextColor={theme.colors.textMuted}
            multiline
            style={styles.input}
          />
          <View style={styles.actionRow}>
            <View style={styles.navButton}>
              <AppButton label="Cancel" variant="ghost" onPress={resetFinding} />
            </View>
            <View style={styles.navButton}>
              <AppButton
                label={isAddingFinding || isStamping ? 'Saving…' : 'Take BEFORE photo & add'}
                onPress={() => void addFinding()}
                disabled={
                  !chosenFinding ||
                  (chosenFinding.options.length > 0 && !findingOption) ||
                  isAddingFinding ||
                  isStamping
                }
              />
            </View>
          </View>
        </Card>
      ) : null}

      {items.map((item) => {
        const workable =
          (item.displayState === 'TODO' || item.displayState === 'IN_PROGRESS') &&
          !item.pendingCompletion &&
          !item.localFinding?.rejectedReason;
        const hasBefore = item.allPhotos.BEFORE.length > 0;
        const hasAfter = item.allPhotos.AFTER.length > 0;
        const surveyUrls = item.surveyPhotos.map((photo) => toAbsoluteUrl(photo.url));
        const isThisCompleting = completing?.defectId === item.id;

        return (
          <Card key={item.id}>
            <View style={styles.chipRow}>
              {item.isEmergency ? <StatusChip label="EMERGENCY" tone="danger" /> : null}
              {item.isNewFinding ? <StatusChip label="NEW FINDING" tone="info" /> : null}
              <StatusChip label={item.severity} tone={item.severity === 'CRITICAL' || item.severity === 'HIGH' ? 'danger' : 'warning'} />
              <StatusChip label={CATEGORY_LABEL[item.category]} />
              <StatusChip
                label={item.pendingCompletion && !item.pendingCompletion.rejectedReason ? 'Submitted · waiting to sync' : STATE_LABEL[item.displayState]}
                tone={item.displayState === 'CLOSED' ? 'success' : item.displayState === 'SUBMITTED' ? 'info' : item.displayState === 'IN_PROGRESS' ? 'warning' : 'neutral'}
              />
            </View>
            <Text style={styles.title}>{item.remark || item.label}</Text>
            {item.remark ? <Text style={styles.muted}>{item.label}</Text> : null}
            <Text style={styles.muted}>
              {[item.team ? `Team ${item.team.name}` : 'Not assigned to a team yet', item.dueDate ? `Target ${formatDate(item.dueDate)}` : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>

            {item.displayState === 'IN_PROGRESS' && item.sentBackReason ? (
              <View style={styles.sentBack}>
                <Feather name="corner-up-left" size={14} color={theme.colors.warningText} />
                <Text style={styles.sentBackText}>{item.sentBackReason}</Text>
              </View>
            ) : null}
            {item.localFinding && !item.localFinding.realId && !item.localFinding.rejectedReason ? (
              <Text style={styles.hint}>Added on this phone — waiting to sync.</Text>
            ) : null}
            {item.localFinding?.rejectedReason ? (
              <View style={styles.rejected}>
                <Text style={styles.rejectedText}>Not accepted: {item.localFinding.rejectedReason}</Text>
                <Pressable onPress={() => void dismissFinding(item.localFinding as LocalFinding)}>
                  <Text style={styles.link}>Dismiss</Text>
                </Pressable>
              </View>
            ) : null}
            {item.pendingCompletion?.rejectedReason ? (
              <View style={styles.rejected}>
                <Text style={styles.rejectedText}>Not accepted: {item.pendingCompletion.rejectedReason}</Text>
                <Pressable onPress={() => void dismissLocalCompletion(item.id)}>
                  <Text style={styles.link}>Dismiss</Text>
                </Pressable>
              </View>
            ) : null}

            <Text style={styles.section}>Survey photo</Text>
            {surveyUrls.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbRow}>
                {surveyUrls.map((uri, index) => (
                  <Pressable key={uri} onPress={() => openPhotos(surveyUrls, index, 'Survey photo')}>
                    <Image source={{ uri }} style={styles.thumb} />
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.muted}>
                {item.isNewFinding ? 'New finding — not in the survey.' : 'No survey photo for this Kejanggalan.'}
              </Text>
            )}

            {STAGES.map((stage) => {
              const photos = item.allPhotos[stage];
              const busy = busyStage === `${item.id}:${stage}`;
              return (
                <View key={stage}>
                  <Text style={styles.section}>
                    {STAGE_LABEL[stage]}
                    {stage === 'DURING' ? ' (optional)' : ' *'}
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbRow}>
                    {photos.map((photo, index) => (
                      <Pressable
                        key={photo.id}
                        onPress={() => openPhotos(photos.map((entry) => entry.url), index, `${STAGE_LABEL[stage]} photo`)}
                        onLongPress={photo.pending ? () => confirmRemoveLocal(photo.id, photo.url) : undefined}
                      >
                        <Image source={{ uri: photo.url }} style={styles.thumb} />
                        {photo.rejectedReason ? (
                          <View style={[styles.badge, styles.badgeDanger]}>
                            <Text style={styles.badgeText}>Rejected</Text>
                          </View>
                        ) : photo.pending ? (
                          <View style={styles.badge}>
                            <Feather name="upload-cloud" size={11} color="#ffffff" />
                          </View>
                        ) : null}
                      </Pressable>
                    ))}
                    {workable ? (
                      <Pressable
                        onPress={() => void takePhoto(item, stage)}
                        disabled={busyStage !== null || isStamping}
                        style={({ pressed }) => [styles.addThumb, pressed && styles.pressed, (busyStage !== null || isStamping) && styles.disabled]}
                      >
                        <Feather name={busy ? 'loader' : 'camera'} size={20} color={theme.colors.primary} />
                        <Text style={styles.addThumbText}>{busy ? 'Saving…' : 'Take'}</Text>
                      </Pressable>
                    ) : null}
                  </ScrollView>
                </View>
              );
            })}

            {workable && !isThisCompleting ? (
              <View style={styles.actionRow}>
                <View style={styles.navButton}>
                  <AppButton
                    label="Mark done"
                    variant="success"
                    disabled={!hasBefore || !hasAfter || (!item.team && !item.localFinding)}
                    onPress={() => {
                      setNotes('');
                      setCompleting({ defectId: item.id, kind: 'DONE' });
                    }}
                  />
                </View>
                <View style={styles.navButton}>
                  <AppButton
                    label="Cannot repair"
                    variant="secondary"
                    disabled={!hasBefore || (!item.team && !item.localFinding)}
                    onPress={() => {
                      setNotes('');
                      setOutcome(CANNOT_REPAIR_OUTCOMES[0].value);
                      setCompleting({ defectId: item.id, kind: 'CANNOT' });
                    }}
                  />
                </View>
              </View>
            ) : null}
            {workable && !isThisCompleting && (!hasBefore || !hasAfter) ? (
              <Text style={styles.hint}>
                {!hasBefore ? 'Take a BEFORE photo first.' : 'Take an AFTER photo to mark it done (or report cannot repair).'}
              </Text>
            ) : null}

            {isThisCompleting ? (
              <View style={styles.completeBox}>
                <Text style={styles.section}>
                  {completing?.kind === 'CANNOT' ? 'Why can it not be repaired?' : 'Repair notes (optional)'}
                </Text>
                {completing?.kind === 'CANNOT'
                  ? CANNOT_REPAIR_OUTCOMES.map((option) => (
                      <Pressable
                        key={option.value}
                        onPress={() => setOutcome(option.value)}
                        style={[styles.option, outcome === option.value && styles.optionActive]}
                      >
                        <Feather
                          name={outcome === option.value ? 'check-circle' : 'circle'}
                          size={16}
                          color={outcome === option.value ? theme.colors.primary : theme.colors.textMuted}
                        />
                        <Text style={styles.optionText}>{option.label}</Text>
                      </Pressable>
                    ))
                  : null}
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder={completing?.kind === 'CANNOT' ? 'Explain for TNB (required)' : 'What was done'}
                  placeholderTextColor={theme.colors.textMuted}
                  multiline
                  style={styles.input}
                />
                <View style={styles.actionRow}>
                  <View style={styles.navButton}>
                    <AppButton label="Cancel" variant="ghost" onPress={() => setCompleting(null)} />
                  </View>
                  <View style={styles.navButton}>
                    <AppButton
                      label={completing?.kind === 'CANNOT' ? 'Send to TNB' : 'Submit repair'}
                      variant={completing?.kind === 'CANNOT' ? 'primary' : 'success'}
                      onPress={() => void submitCompletion(item)}
                    />
                  </View>
                </View>
              </View>
            ) : null}
          </Card>
        );
      })}
      <View style={styles.bottomSpace} />
    </Screen>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    navRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
    addRow: { marginBottom: 12 },
    optionMeta: { fontFamily: theme.fonts.body, fontSize: 12, color: theme.colors.textMuted },
    navButton: { flex: 1 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
    title: { fontFamily: theme.fonts.bodySemibold, fontSize: 16, color: theme.colors.textPrimary },
    muted: { fontFamily: theme.fonts.body, fontSize: 13, color: theme.colors.textSecondary, marginTop: 2 },
    section: {
      fontFamily: theme.fonts.bodySemibold,
      fontSize: 12,
      color: theme.colors.textSecondary,
      marginTop: 14,
      marginBottom: 6,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    thumbRow: { gap: 8 },
    thumb: { width: 84, height: 84, borderRadius: 8, backgroundColor: theme.colors.surfaceMuted },
    addThumb: {
      width: 84,
      height: 84,
      borderRadius: 8,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    },
    addThumbText: { fontFamily: theme.fonts.bodySemibold, fontSize: 12, color: theme.colors.primary },
    badge: {
      position: 'absolute',
      right: 4,
      top: 4,
      backgroundColor: 'rgba(15, 23, 42, 0.8)',
      borderRadius: 6,
      paddingHorizontal: 4,
      paddingVertical: 2,
    },
    badgeDanger: { backgroundColor: theme.colors.danger },
    badgeText: { color: '#ffffff', fontSize: 10, fontFamily: theme.fonts.bodySemibold },
    actionRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
    hint: { fontFamily: theme.fonts.body, fontSize: 12, color: theme.colors.textMuted, marginTop: 6 },
    sentBack: {
      flexDirection: 'row',
      gap: 6,
      marginTop: 10,
      padding: 10,
      borderRadius: 8,
      backgroundColor: theme.colors.warningSoft,
    },
    sentBackText: { flex: 1, fontFamily: theme.fonts.body, fontSize: 13, color: theme.colors.warningText },
    rejected: {
      marginTop: 10,
      padding: 10,
      borderRadius: 8,
      backgroundColor: theme.colors.dangerSoft,
      gap: 6,
    },
    rejectedText: { fontFamily: theme.fonts.body, fontSize: 13, color: theme.colors.dangerText },
    link: { fontFamily: theme.fonts.bodySemibold, fontSize: 13, color: theme.colors.primary },
    completeBox: { marginTop: 14, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 4 },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginBottom: 6,
    },
    optionActive: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft },
    optionText: { flex: 1, fontFamily: theme.fonts.body, fontSize: 14, color: theme.colors.textPrimary },
    input: {
      minHeight: 72,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
      borderRadius: theme.radius.control,
      padding: 10,
      fontFamily: theme.fonts.body,
      fontSize: 14,
      color: theme.colors.textPrimary,
      textAlignVertical: 'top',
      marginTop: 4,
    },
    pressed: { opacity: 0.7 },
    disabled: { opacity: 0.5 },
    bottomSpace: { height: 32 },
  });
}
