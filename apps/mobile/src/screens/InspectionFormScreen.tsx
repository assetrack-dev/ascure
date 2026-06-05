import { useCallback, useEffect, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { captureRef } from 'react-native-view-shot';
import { Image, Modal, PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api, ApiError } from '../api';
import { useSession } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import type { RootStackScreenProps } from '../navigation/types';
import {
  cleanupLocalInspectionPhotos,
  enqueueInspectionSubmission,
  isRetryableSyncError,
  persistCapturedInspectionPhoto,
} from '../syncQueue';
import {
  buildChecklistItemsPayloadFromDraft,
  buildResultsPayload,
  createInitialDraftValues,
  formatDateTime,
  getBooleanDefectValue,
  getVisibleInspectionSections,
  hasAnyInspectionDraftValue,
  isOperationalTemplateTextItem,
  normalizeInspectionInputType,
  normalizeOperationalText,
  normalizeSelectOptions,
  validateInspectionDraft,
  validateInspectionDraftForSave,
} from '../utils';
import {
  AppButton,
  EmptyState,
  ErrorBanner,
  InlineButton,
  LoadingBlock,
  Screen,
  StatusChip,
  SuccessBanner,
  TextField,
  WarningBanner,
} from '../ui';
import {
  DraftValues,
  InspectionFormResponse,
  InspectionImageUploadInput,
  InspectionTemplateSection,
  InspectionTemplateItem,
} from '../types';

type PhotoUploadState = 'uploading' | 'uploaded' | 'error';

type CapturedInspectionPhoto = InspectionImageUploadInput & {
  id: string;
  uploadedImageId?: string;
  uploadedUrl?: string;
  url?: string;
  uploadState: PhotoUploadState;
  uploadError?: string;
};

type PendingOverlayPhoto = Omit<InspectionImageUploadInput, 'uri'> & {
  timestampLabel: string;
  originalUri: string;
  captureWidth: number;
  captureHeight: number;
  layoutWidth: number;
  layoutHeight: number;
};

const PRIORITY_SECTION_TITLES = ['TIANG', 'PENGALIR', 'AKSESORI', 'PERALATAN'];

export function InspectionFormScreen() {
  const navigation = useNavigation<RootStackScreenProps<'InspectionForm'>['navigation']>();
  const route = useRoute<RootStackScreenProps<'InspectionForm'>['route']>();
  const { inspectionId, visitId, substationId } = route.params;
  const { token, handleUnauthorized } = useSession();
  const { isOffline } = useSync();

  function goBackToVisit(successMessage: string) {
    navigation.popTo('VisitDetail', { visitId, substationId, successMessage });
  }

  const [form, setForm] = useState<InspectionFormResponse | null>(null);
  const [draftValues, setDraftValues] = useState<DraftValues>({});
  const [photos, setPhotos] = useState<CapturedInspectionPhoto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const [pendingOverlayPhoto, setPendingOverlayPhoto] = useState<PendingOverlayPhoto | null>(null);
  const [selectedPhotoUri, setSelectedPhotoUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [photoUploadNotice, setPhotoUploadNotice] = useState<string | null>(null);
  const overlayCaptureRef = useRef<View>(null);
  const photosRef = useRef<CapturedInspectionPhoto[]>([]);
  const photoUploadPromisesRef = useRef<Record<string, Promise<void>>>({});
  const overlayPromiseHandlersRef = useRef<{
    resolve: (uri: string) => void;
    reject: (error: Error) => void;
  } | null>(null);

  const isSubmitted = form?.inspection.completionStatus === 'SUBMITTED';
  const checklistSections = form ? getVisibleInspectionSections(form, draftValues) : [];
  const checklistItemCount = checklistSections.reduce(
    (total, section) => total + section.items.length,
    0,
  );
  const isTemplateEmpty = !isLoading && Boolean(form) && checklistItemCount === 0;
  const isBusy = isLoading || isSavingDraft || isSubmitting || isCapturingPhoto;

  const loadForm = useCallback(async () => {
    try {
      setError(null);
      setSaveNotice(null);
      setIsLoading(true);

      const formResponse = await api.getInspectionForm(token, inspectionId);
      setForm(formResponse);
      setDraftValues(createInitialDraftValues(formResponse));
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        await handleUnauthorized(loadError);
        return;
      }

      setError(loadError instanceof Error ? loadError.message : 'Unable to load inspection form.');
    } finally {
      setIsLoading(false);
    }
  }, [inspectionId, handleUnauthorized, token]);

  useEffect(() => {
    loadForm();
  }, [loadForm]);

  useEffect(() => {
    setPhotoList(() => []);
    setPhotoUploadNotice(null);
  }, [inspectionId]);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    setSelectedPhotoUri(null);
  }, [inspectionId]);

  useEffect(() => {
    if (!pendingOverlayPhoto) {
      return;
    }

    let isCancelled = false;

    const renderOverlayPhoto = async () => {
      try {
        await waitForNextPaint();
        await delay(400);

        if (!overlayCaptureRef.current) {
          throw new Error('Unable to prepare the overlaid photo.');
        }

        const overlayUri = await captureRef(overlayCaptureRef, {
          format: 'jpg',
          quality: 0.9,
          result: 'tmpfile',
          width: pendingOverlayPhoto.captureWidth,
          height: pendingOverlayPhoto.captureHeight,
        });

        if (isCancelled) {
          return;
        }

        overlayPromiseHandlersRef.current?.resolve(overlayUri);
      } catch (overlayError) {
        if (isCancelled) {
          return;
        }

        overlayPromiseHandlersRef.current?.reject(
          overlayError instanceof Error
            ? overlayError
            : new Error('Unable to create the overlaid photo.'),
        );
      } finally {
        if (!isCancelled) {
          overlayPromiseHandlersRef.current = null;
          setPendingOverlayPhoto(null);
        }
      }
    };

    renderOverlayPhoto();

    return () => {
      isCancelled = true;
    };
  }, [pendingOverlayPhoto]);

  function updateDraftValue(itemId: string, value: DraftValues[string]) {
    setSaveNotice(null);
    setDraftValues((current) => ({
      ...current,
      [itemId]: value,
    }));
  }

  function updatePhoto(photoId: string, changes: Partial<CapturedInspectionPhoto>) {
    setPhotoList((current) =>
      current.map((photo) => (photo.id === photoId ? { ...photo, ...changes } : photo)),
    );
  }

  function setPhotoList(updater: (current: CapturedInspectionPhoto[]) => CapturedInspectionPhoto[]) {
    setPhotos((current) => {
      const nextPhotos = updater(current);
      photosRef.current = nextPhotos;

      return nextPhotos;
    });
  }

  async function uploadPhotoToServer(photo: CapturedInspectionPhoto) {
    updatePhoto(photo.id, {
      uploadState: 'uploading',
      uploadError: undefined,
    });

    const uploadedPhoto = await api.uploadInspectionImage(token, inspectionId, photo);
    setPhotoUploadNotice(null);

    updatePhoto(photo.id, {
      uploadedImageId: uploadedPhoto.id,
      uploadedUrl: uploadedPhoto.url,
      url: uploadedPhoto.url,
      uploadState: 'uploaded',
      uploadError: undefined,
    });
  }

  async function uploadPhotoWithTracking(photo: CapturedInspectionPhoto) {
    const uploadPromise = uploadPhotoToServer(photo);

    photoUploadPromisesRef.current[photo.id] = uploadPromise;

    try {
      await uploadPromise;
    } finally {
      delete photoUploadPromisesRef.current[photo.id];
    }
  }

  async function uploadPhotoInBackground(photo: CapturedInspectionPhoto) {
    try {
      await uploadPhotoWithTracking(photo);
    } catch (uploadError) {
      if (uploadError instanceof ApiError && uploadError.status === 401) {
        updatePhoto(photo.id, {
          uploadState: 'error',
          uploadError: uploadError.message,
        });
        await handleUnauthorized(uploadError);
        return;
      }

      const message =
        uploadError instanceof Error ? uploadError.message : 'Unable to upload inspection photo.';

      updatePhoto(photo.id, {
        uploadState: 'error',
        uploadError: message,
      });

      if (isRetryableSyncError(uploadError)) {
        setPhotoUploadNotice(
          'Photo upload paused. The photo is kept locally and will sync when the inspection syncs.',
        );
        return;
      }

      setError(message);
    }
  }

  async function uploadPhotosForSubmission(photoSnapshot: CapturedInspectionPhoto[]) {
    for (const photo of photoSnapshot) {
      if (photo.uploadedImageId || photo.uploadedUrl || photo.uploadState === 'uploaded') {
        continue;
      }

      const existingUpload = photoUploadPromisesRef.current[photo.id];

      try {
        if (existingUpload) {
          await existingUpload;
        } else {
          await uploadPhotoWithTracking(photo);
        }
      } catch (uploadError) {
        updatePhoto(photo.id, {
          uploadState: 'error',
          uploadError:
            uploadError instanceof Error ? uploadError.message : 'Unable to upload inspection photo.',
        });
        throw uploadError;
      }
    }
  }

  async function captureInspectionPhoto() {
    if (isSubmitted) {
      return null;
    }

    const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();

    if (!cameraPermission.granted) {
      throw new Error('Camera permission is required to capture inspection photos.');
    }

    const isLocationEnabled = await Location.hasServicesEnabledAsync();

    if (!isLocationEnabled) {
      throw new Error('Location services must be enabled to attach GPS to the photo.');
    }

    const locationPermission = await Location.requestForegroundPermissionsAsync();

    if (!locationPermission.granted) {
      throw new Error('Location permission is required to attach GPS to the photo.');
    }

    const captureResult = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.7,
    });

    if (captureResult.canceled) {
      return null;
    }

    const capturedAsset = captureResult.assets[0];

    if (!capturedAsset?.uri) {
      throw new Error('Unable to read the captured photo.');
    }

    const capturedAt = new Date();
    const photoTimestamp = capturedAt.toISOString();
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const photoId = createLocalPhotoId(photoTimestamp);
    const overlayImageUri = await createOverlayPhoto({
      originalUri: capturedAsset.uri,
      timestamp: photoTimestamp,
      timestampLabel: formatPhotoTimestampLabel(capturedAt),
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      ...(await getOverlayCaptureSize(
        capturedAsset.uri,
        capturedAsset.width,
        capturedAsset.height,
      )),
    });
    const persistedPhoto = await persistCapturedInspectionPhoto({
      id: photoId,
      uri: overlayImageUri,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      timestamp: photoTimestamp,
    });

    return {
      id: photoId,
      uri: persistedPhoto.uri,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      timestamp: photoTimestamp,
      uploadState: 'uploading',
    } satisfies CapturedInspectionPhoto;
  }

  async function handleTakePhoto() {
    try {
      setIsCapturingPhoto(true);
      setError(null);

      const nextPhoto = await captureInspectionPhoto();

      if (!nextPhoto) {
        return;
      }

      setPhotoList((current) => [...current, nextPhoto]);
      void uploadPhotoInBackground(nextPhoto);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : 'Unable to capture inspection photo.');
    } finally {
      setIsCapturingPhoto(false);
    }
  }

  async function handleRetakePhoto(photoId: string) {
    try {
      setIsCapturingPhoto(true);
      setError(null);

      const nextPhoto = await captureInspectionPhoto();

      if (!nextPhoto) {
        return;
      }

      setPhotoList((current) => current.map((photo) => (photo.id === photoId ? nextPhoto : photo)));
      void uploadPhotoInBackground(nextPhoto);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : 'Unable to capture inspection photo.');
    } finally {
      setIsCapturingPhoto(false);
    }
  }

  function handleRemovePhoto(photoId: string) {
    setPhotoList((current) => current.filter((photo) => photo.id !== photoId));
  }

  async function createOverlayPhoto(photo: PendingOverlayPhoto) {
    return new Promise<string>((resolve, reject) => {
      overlayPromiseHandlersRef.current = {
        resolve,
        reject,
      };
      setPendingOverlayPhoto(photo);
    });
  }

  async function handleSubmitInspection() {
    if (!form || isSubmitted) {
      return;
    }

    if (checklistItemCount === 0) {
      setError('No active checklist template items are available for this inspection.');
      return;
    }

    const validationMessage = validateInspectionDraft(form, draftValues);

    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    const { supportedResults, unsupportedLabels } = buildResultsPayload(form, draftValues);

    if (unsupportedLabels.length > 0) {
      setError(`This mobile form does not support: ${unsupportedLabels.join(', ')}`);
      return;
    }

    if (supportedResults.length === 0) {
      setError('This form does not contain any supported checklist items for submission.');
      return;
    }

    const checklistItems = buildChecklistItemsPayloadFromDraft(form, draftValues, {
      includeEmpty: true,
    });
    const submissionPayload = {
      results: supportedResults,
      items: checklistItems,
    };

    try {
      setIsSubmitting(true);
      setError(null);
      setSaveNotice(null);

      await api.saveInspectionResults(token, inspectionId, submissionPayload);

      await uploadPhotosForSubmission(photosRef.current);

      await api.submitInspection(token, inspectionId);
      await cleanupLocalInspectionPhotos(photosRef.current);

      goBackToVisit('Inspection submitted successfully.');
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 401) {
        await handleUnauthorized(submitError);
        return;
      }

      if (isRetryableSyncError(submitError)) {
        const message =
          submitError instanceof Error ? submitError.message : 'Connection unavailable during submit.';

        await enqueueInspectionSubmission({
          form,
          payload: submissionPayload,
          photos: photosRef.current,
          errorMessage: message,
        });

        goBackToVisit('Inspection saved to Sync Queue. It will retry when connection returns.');
        return;
      }

      setError(submitError instanceof Error ? submitError.message : 'Unable to submit inspection.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSaveDraft() {
    if (!form || isSubmitted) {
      return;
    }

    if (checklistItemCount === 0) {
      setError('No active checklist template items are available for this inspection.');
      setSaveNotice(null);
      return;
    }

    const validationMessage = validateInspectionDraftForSave(form, draftValues);

    if (validationMessage) {
      setError(validationMessage);
      setSaveNotice(null);
      return;
    }

    const { supportedResults, unsupportedLabels } = buildResultsPayload(form, draftValues);

    if (unsupportedLabels.length > 0) {
      setError(`This mobile form does not support: ${unsupportedLabels.join(', ')}`);
      setSaveNotice(null);
      return;
    }

    if (supportedResults.length === 0 || !hasAnyInspectionDraftValue(form, draftValues)) {
      setError('Complete at least one checklist field before saving.');
      setSaveNotice(null);
      return;
    }

    const checklistItems = buildChecklistItemsPayloadFromDraft(form, draftValues);

    try {
      setIsSavingDraft(true);
      setError(null);
      setSaveNotice(null);

      const savedForm = await api.saveInspectionResults(token, inspectionId, {
        results: supportedResults,
        ...(checklistItems.length > 0 ? { items: checklistItems } : {}),
      });

      setForm(savedForm);
      setDraftValues(createInitialDraftValues(savedForm));
      setSaveNotice(`Draft saved ${formatDraftSavedTime(new Date())}.`);
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 401) {
        await handleUnauthorized(saveError);
        return;
      }

      setError(saveError instanceof Error ? saveError.message : 'Unable to save inspection draft.');
    } finally {
      setIsSavingDraft(false);
    }
  }

  return (
    <Screen
      title="Inspection"
      subtitle={
        form
          ? `${form.inspection.asset.assetType.name} · ${form.inspection.asset.assetCode}`
          : 'Checklist'
      }
      keyboardAware
      actions={
        <>
          <InlineButton
            label="Back"
            onPress={() => navigation.goBack()}
            disabled={isSavingDraft || isSubmitting}
          />
          <InlineButton label="Refresh" onPress={loadForm} disabled={isBusy} />
        </>
      }
      footer={
        <View style={styles.stickyActionArea}>
          <ErrorBanner message={error} />
          <WarningBanner
            message={
              isOffline
                ? 'Offline mode: captured photos and submitted inspections will stay on this device until connection returns.'
                : photoUploadNotice
            }
          />
          {isSubmitted ? <SuccessBanner message="This inspection has already been submitted." /> : null}
          {!isSubmitted ? <SuccessBanner message={saveNotice} /> : null}
          <View style={styles.footerActions}>
            <View style={styles.footerActionSecondary}>
              <AppButton
                label={isSavingDraft ? 'Saving...' : 'Save Draft'}
                onPress={handleSaveDraft}
                variant="secondary"
                loading={isSavingDraft}
                disabled={isBusy || isSubmitted || isTemplateEmpty}
              />
            </View>
            <View style={styles.footerActionPrimary}>
              <AppButton
                label={isSubmitting ? 'Submitting...' : 'Submit'}
                onPress={handleSubmitInspection}
                loading={isSubmitting}
                disabled={isBusy || isSubmitted || isTemplateEmpty}
              />
            </View>
          </View>
        </View>
      }
    >
      {isLoading ? <LoadingBlock label="Loading inspection form..." /> : null}

      {!isLoading && form ? (
        <>
          <View style={styles.inspectionHeaderCard}>
            <View style={styles.summaryHeader}>
              <View style={styles.summaryTitleWrap}>
                <Text style={styles.kickerLabel}>Asset Code</Text>
                <Text style={styles.summaryAsset} numberOfLines={2}>
                  {form.inspection.asset.assetCode}
                </Text>
              </View>
              <StatusChip
                label={isSubmitted ? 'Completed' : 'In Progress'}
                tone={isSubmitted ? 'success' : 'warning'}
              />
            </View>
            <View style={styles.contextChipRow}>
              <Text style={styles.contextChip} numberOfLines={1}>
                {form.inspection.asset.assetType.name}
              </Text>
              <Text style={styles.contextChip} numberOfLines={1}>
                {form.template.name} v{form.template.version}
              </Text>
              <Text style={styles.contextChip} numberOfLines={1}>
                Cycle {form.inspection.inspectionCycle}
              </Text>
            </View>
            <Text style={styles.summaryMetaText} numberOfLines={1}>
              {form.inspection.asset.name || 'Unnamed asset'} · {form.inspection.asset.substation.name} · {form.inspection.siteVisit.team.name}
            </Text>
          </View>

          <InspectionPhotoSection
            photos={photos}
            isBusy={isBusy}
            isCapturingPhoto={isCapturingPhoto}
            isSubmitted={Boolean(isSubmitted)}
            onTakePhoto={handleTakePhoto}
            onOpenPhoto={setSelectedPhotoUri}
            onRetakePhoto={handleRetakePhoto}
            onRemovePhoto={handleRemovePhoto}
          />

          {checklistItemCount === 0 ? (
            <EmptyState
              title="No active checklist items"
              description="Activate a checklist template before submitting."
            />
          ) : (
            <View style={styles.checklistStack}>
              {checklistSections.map((section, sectionIndex) => (
                <ChecklistSectionCard
                  key={section.id}
                  section={section}
                  sectionIndex={sectionIndex}
                  draftValues={draftValues}
                  isSubmitted={Boolean(isSubmitted)}
                  onUpdateDraftValue={updateDraftValue}
                />
              ))}
            </View>
          )}

          {pendingOverlayPhoto ? (
            <View pointerEvents="none" style={styles.overlayCaptureRoot}>
              <View
                ref={overlayCaptureRef}
                collapsable={false}
                style={[
                  styles.overlayCaptureCanvas,
                  {
                    width: pendingOverlayPhoto.layoutWidth,
                    height: pendingOverlayPhoto.layoutHeight,
                  },
                ]}
              >
                <Image
                  source={{ uri: pendingOverlayPhoto.originalUri }}
                  style={styles.overlayCaptureImage}
                  resizeMode="cover"
                />
                <View style={styles.overlayBadge}>
                  <Text style={styles.overlayText}>{pendingOverlayPhoto.timestampLabel}</Text>
                  <Text style={styles.overlayText}>
                    Lat: {formatOverlayCoordinate(pendingOverlayPhoto.latitude)}, Lng:{' '}
                    {formatOverlayCoordinate(pendingOverlayPhoto.longitude)}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          <Modal
            visible={selectedPhotoUri !== null}
            transparent
            animationType="fade"
            onRequestClose={() => setSelectedPhotoUri(null)}
          >
            <Pressable style={styles.previewModalBackdrop} onPress={() => setSelectedPhotoUri(null)}>
              {selectedPhotoUri ? (
                <Image source={{ uri: selectedPhotoUri }} style={styles.previewModalImage} resizeMode="contain" />
              ) : null}
            </Pressable>
          </Modal>
        </>
      ) : null}
    </Screen>
  );
}

function InspectionPhotoSection({
  photos,
  isBusy,
  isCapturingPhoto,
  isSubmitted,
  onTakePhoto,
  onOpenPhoto,
  onRetakePhoto,
  onRemovePhoto,
}: {
  photos: CapturedInspectionPhoto[];
  isBusy: boolean;
  isCapturingPhoto: boolean;
  isSubmitted: boolean;
  onTakePhoto: () => void;
  onOpenPhoto: (uri: string) => void;
  onRetakePhoto: (photoId: string) => void;
  onRemovePhoto: (photoId: string) => void;
}) {
  return (
    <View style={styles.photoSection}>
      <View style={styles.photoSectionHeader}>
        <View style={styles.photoTitleWrap}>
          <Text style={styles.kickerLabel}>Images</Text>
          <Text style={styles.sectionHeading}>Photos</Text>
        </View>
        <Text style={styles.photoCount}>{photos.length}</Text>
      </View>
      <AppButton
        label={isCapturingPhoto ? 'Opening Camera...' : 'Take Photo'}
        onPress={onTakePhoto}
        variant="secondary"
        loading={isCapturingPhoto}
        disabled={isBusy || isSubmitted}
      />
      {photos.length === 0 ? (
        <View style={styles.emptyPhotoPanel}>
          <Text style={styles.emptyPhotoTitle}>No photos</Text>
        </View>
      ) : null}
      {photos.length > 0 ? (
        <View style={styles.photoGrid}>
          {photos.map((photo, index) => (
            <View key={photo.id} style={styles.photoCard}>
              <Pressable
                accessibilityRole="button"
                onPress={() => onOpenPhoto(photo.uri)}
                style={({ pressed }) => [styles.photoPreviewButton, pressed && styles.photoPreviewPressed]}
              >
                <Image source={{ uri: photo.uri }} style={styles.photoPreview} resizeMode="cover" />
                <View style={styles.photoPreviewBadge}>
                  <Text style={styles.photoPreviewBadgeText}>{index + 1}</Text>
                </View>
              </Pressable>
              <View style={styles.photoTileBody}>
                <View style={styles.photoCardHeader}>
                  <Text style={styles.photoTitle} numberOfLines={1}>
                    {formatDateTime(photo.timestamp)}
                  </Text>
                  <PhotoStatusPill state={photo.uploadState} />
                </View>
                <Text style={styles.photoCoordLine} numberOfLines={1}>
                  Lat {formatCoordinate(photo.latitude)} · Lng {formatCoordinate(photo.longitude)}
                </Text>
                {photo.uploadState === 'error' ? (
                  <Text style={styles.photoUploadError} numberOfLines={2}>
                    {photo.uploadError ?? 'Upload failed. Local copy kept.'}
                  </Text>
                ) : null}
                {!isSubmitted ? (
                  <View style={styles.photoActionRow}>
                    <PhotoActionButton
                      label="Retake"
                      onPress={() => onRetakePhoto(photo.id)}
                      disabled={isBusy}
                    />
                    <PhotoActionButton
                      label="Remove"
                      onPress={() => onRemovePhoto(photo.id)}
                      disabled={isBusy}
                      danger
                    />
                  </View>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ChecklistSectionCard({
  section,
  sectionIndex,
  draftValues,
  isSubmitted,
  onUpdateDraftValue,
}: {
  section: InspectionTemplateSection;
  sectionIndex: number;
  draftValues: DraftValues;
  isSubmitted: boolean;
  onUpdateDraftValue: (
    itemId: string,
    value: DraftValues[string],
  ) => void;
}) {
  const normalizedTitle = section.title.trim().toUpperCase();
  const sectionTitle = PRIORITY_SECTION_TITLES.includes(normalizedTitle)
    ? normalizedTitle
    : section.title;
  const sectionTone = getSectionTone(sectionTitle);

  return (
    <View style={[styles.sectionCard, { borderColor: sectionTone.border }]}>
      <View style={[styles.sectionTopRail, { backgroundColor: sectionTone.accent }]} />
      <View style={styles.sectionHeader}>
        <View
          style={[
            styles.sectionIndexBadge,
            {
              backgroundColor: sectionTone.surface,
              borderColor: sectionTone.border,
            },
          ]}
        >
          <Text style={[styles.sectionIndexText, { color: sectionTone.accent }]}>
            {String(sectionIndex + 1).padStart(2, '0')}
          </Text>
        </View>
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionHeading}>{sectionTitle}</Text>
          <Text style={styles.sectionMeta}>{section.items.length} checks</Text>
        </View>
      </View>
      <View style={styles.sectionItems}>
        {section.items.map((item) => (
          <ChecklistItemCard
            key={item.id}
            item={item}
            value={draftValues[item.id]}
            disabled={isSubmitted}
            onChange={(nextValue) => onUpdateDraftValue(item.id, nextValue)}
          />
        ))}
      </View>
    </View>
  );
}

function ChecklistItemCard({
  item,
  value,
  disabled,
  onChange,
}: {
  item: InspectionTemplateItem;
  value: DraftValues[string] | undefined;
  disabled: boolean;
  onChange: (value: DraftValues[string]) => void;
}) {
  const inputType = normalizeInspectionInputType(item.inputType);
  const shouldUppercaseText = inputType === 'TEXT' && isOperationalTemplateTextItem(item);

  return (
    <View style={styles.itemCard}>
      <View style={styles.itemHeader}>
        <View style={styles.itemTextWrap}>
          <Text style={styles.itemLabel}>{item.label}</Text>
        </View>
        {item.isRequired ? <Text style={styles.requiredLabel}>Req</Text> : null}
      </View>
      {item.helperText ? (
        <Text style={styles.helperText} numberOfLines={1}>
          {item.helperText}
        </Text>
      ) : null}
      {inputType === 'TEXT' ? (
        <TextField
          label="Response"
          value={typeof value === 'string' ? value : ''}
          onChangeText={(nextValue) =>
            onChange(shouldUppercaseText ? normalizeOperationalText(nextValue) : nextValue)
          }
          placeholder="Enter response"
          editable={!disabled}
          multiline
          autoCapitalize={shouldUppercaseText ? 'characters' : 'none'}
        />
      ) : null}
      {inputType === 'NUMBER' ? (
        <TextField
          label="Number"
          value={typeof value === 'string' ? value : ''}
          onChangeText={onChange}
          placeholder="Enter number"
          keyboardType="decimal-pad"
          editable={!disabled}
        />
      ) : null}
      {inputType === 'READING' ? (
        <TextField
          label="Reading"
          value={typeof value === 'string' ? value : ''}
          onChangeText={onChange}
          placeholder="Enter reading"
          keyboardType="decimal-pad"
          editable={!disabled}
        />
      ) : null}
      {inputType === 'DATE' ? (
        <TextField
          label="Date"
          value={typeof value === 'string' ? value : ''}
          onChangeText={onChange}
          placeholder="YYYY-MM-DD"
          editable={!disabled}
        />
      ) : null}
      {inputType === 'DATETIME' ? (
        <TextField
          label="Date Time"
          value={typeof value === 'string' ? value : ''}
          onChangeText={onChange}
          placeholder="YYYY-MM-DDTHH:mm"
          editable={!disabled}
        />
      ) : null}
      {inputType === 'GPS' ? (
        <TextField
          label="GPS"
          value={typeof value === 'string' ? value : ''}
          onChangeText={onChange}
          placeholder="Latitude, longitude"
          editable={!disabled}
        />
      ) : null}
      {inputType === 'BOOLEAN' ? (
        <BooleanField
          value={typeof value === 'boolean' ? value : null}
          disabled={disabled}
          isRequired={item.isRequired}
          isDefectTrigger={item.isDefectTrigger !== false}
          defectValue={getBooleanDefectValue(item)}
          onChange={onChange}
        />
      ) : null}
      {inputType === 'SELECT' ? (
        <DropdownField
          item={item}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={onChange}
        />
      ) : null}
      {inputType === 'MULTI_SELECT' ? (
        <MultiSelectField
          item={item}
          value={Array.isArray(value) ? value : []}
          disabled={disabled}
          onChange={onChange}
        />
      ) : null}
      {inputType === 'IMAGE' ? <ImageFieldPlaceholder /> : null}
      {!inputType ? (
        <View style={styles.unsupportedFieldPanel}>
          <Text style={styles.unsupportedFieldText}>
            Unsupported field type: {formatFieldType(item.inputType)}.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function BooleanField({
  value,
  disabled,
  isRequired,
  isDefectTrigger,
  defectValue,
  onChange,
}: {
  value: boolean | null;
  disabled: boolean;
  isRequired: boolean;
  isDefectTrigger: boolean;
  defectValue: boolean;
  onChange: (value: boolean | null) => void;
}) {
  // For defect-trigger items the inspector answers whether the defect exists, so
  // the defect answer is coloured as the alarming (danger) choice and the clear
  // answer as success. Non-defect items keep the conventional YES=good colouring.
  const yesTone = isDefectTrigger ? (defectValue ? 'danger' : 'success') : 'success';
  const noTone = isDefectTrigger ? (defectValue ? 'success' : 'danger') : 'danger';

  return (
    <View style={styles.resultControl}>
      <Text style={styles.controlLabel}>{isDefectTrigger ? 'Defect present?' : 'Response'}</Text>
      <View style={styles.resultButtonRow}>
        <ChoiceButton
          label="YES"
          selected={value === true}
          disabled={disabled}
          tone={yesTone}
          onPress={() => onChange(true)}
        />
        <ChoiceButton
          label="NO"
          selected={value === false}
          disabled={disabled}
          tone={noTone}
          onPress={() => onChange(false)}
        />
        {!isRequired ? (
          <ChoiceButton
            label="N/A"
            selected={value === null}
            disabled={disabled}
            tone="neutral"
            onPress={() => onChange(null)}
          />
        ) : null}
      </View>
      {isDefectTrigger ? (
        <Text style={styles.helperText}>
          {defectValue ? 'YES = defect found · NO = no defect' : 'NO = defect found · YES = no defect'}
        </Text>
      ) : null}
    </View>
  );
}

function DropdownField({
  item,
  value,
  disabled,
  onChange,
}: {
  item: InspectionTemplateItem;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const options = normalizeSelectOptions(item.optionsJson);

  if (options.length === 0) {
    return (
      <View style={styles.unsupportedFieldPanel}>
        <Text style={styles.unsupportedFieldText}>No dropdown options configured.</Text>
      </View>
    );
  }

  return (
    <View style={styles.resultControl}>
      <Text style={styles.controlLabel}>Response</Text>
      <View style={styles.optionStack}>
        {options.map((option) => (
          <DropdownOptionButton
            key={option.value}
            label={option.label}
            selected={value === option.value}
            disabled={disabled}
            onPress={() => onChange(option.value)}
          />
        ))}
        {!item.isRequired ? (
          <DropdownOptionButton
            label="N/A"
            selected={value === ''}
            disabled={disabled}
            onPress={() => onChange('')}
          />
        ) : null}
      </View>
    </View>
  );
}

function MultiSelectField({
  item,
  value,
  disabled,
  onChange,
}: {
  item: InspectionTemplateItem;
  value: string[];
  disabled: boolean;
  onChange: (value: string[]) => void;
}) {
  const options = normalizeSelectOptions(item.optionsJson);
  const selectedValues = new Set(value);

  if (options.length === 0) {
    return (
      <View style={styles.unsupportedFieldPanel}>
        <Text style={styles.unsupportedFieldText}>No multi select options configured.</Text>
      </View>
    );
  }

  return (
    <View style={styles.resultControl}>
      <Text style={styles.controlLabel}>Response</Text>
      <View style={styles.optionStack}>
        {options.map((option) => {
          const selected = selectedValues.has(option.value);

          return (
            <DropdownOptionButton
              key={option.value}
              label={option.label}
              selected={selected}
              disabled={disabled}
              onPress={() => {
                const nextValues = selected
                  ? value.filter((entry) => entry !== option.value)
                  : [...value, option.value];

                onChange(nextValues);
              }}
            />
          );
        })}
        {!item.isRequired ? (
          <DropdownOptionButton
            label="Clear"
            selected={value.length === 0}
            disabled={disabled}
            onPress={() => onChange([])}
          />
        ) : null}
      </View>
    </View>
  );
}

function ImageFieldPlaceholder() {
  return (
    <View style={styles.imageFieldPlaceholder}>
      <Text style={styles.imageFieldTitle}>Image capture</Text>
      <Text style={styles.imageFieldText}>
        Attach photos from the inspection photos section.
      </Text>
    </View>
  );
}

function ChoiceButton({
  label,
  selected,
  disabled,
  tone,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  tone: 'success' | 'danger' | 'neutral';
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choiceButton,
        selected && styles.choiceButtonSelected,
        tone === 'success' && selected && styles.choiceButtonPassSelected,
        tone === 'danger' && styles.choiceButtonFail,
        tone === 'danger' && selected && styles.choiceButtonFailSelected,
        tone === 'neutral' && selected && styles.choiceButtonNaSelected,
        disabled && styles.choiceButtonDisabled,
        pressed && !disabled && styles.choiceButtonPressed,
      ]}
    >
      <Text
        style={[
          styles.choiceButtonText,
          selected && styles.choiceButtonTextSelected,
          tone === 'success' && selected && styles.choiceButtonPassTextSelected,
          tone === 'danger' && styles.choiceButtonFailText,
          tone === 'danger' && selected && styles.choiceButtonFailTextSelected,
          tone === 'neutral' && selected && styles.choiceButtonNaTextSelected,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function DropdownOptionButton({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionButton,
        selected && styles.optionButtonSelected,
        disabled && styles.choiceButtonDisabled,
        pressed && !disabled && styles.choiceButtonPressed,
      ]}
    >
      <View style={[styles.optionIndicator, selected && styles.optionIndicatorSelected]}>
        {selected ? <View style={styles.optionIndicatorInner} /> : null}
      </View>
      <Text style={[styles.optionButtonText, selected && styles.optionButtonTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

function PhotoStatusPill({ state }: { state: PhotoUploadState }) {
  return (
    <View
      style={[
        styles.photoStatusPill,
        state === 'uploaded' && styles.photoStatusUploaded,
        state === 'error' && styles.photoStatusError,
      ]}
    >
      <Text
        style={[
          styles.photoStatusText,
          state === 'uploaded' && styles.photoStatusTextUploaded,
          state === 'error' && styles.photoStatusTextError,
        ]}
      >
        {getPhotoStatusLabel(state)}
      </Text>
    </View>
  );
}

function PhotoActionButton({
  label,
  onPress,
  disabled = false,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.photoActionButton,
        danger && styles.photoActionButtonDanger,
        disabled && styles.photoActionButtonDisabled,
        pressed && !disabled && styles.photoActionButtonPressed,
      ]}
    >
      <Text style={[styles.photoActionText, danger && styles.photoActionTextDanger]}>{label}</Text>
    </Pressable>
  );
}

function formatDraftSavedTime(value: Date) {
  return `${padNumber(value.getHours())}:${padNumber(value.getMinutes())}`;
}

function formatFieldType(value: string) {
  const normalized = value.trim().toUpperCase();

  if (normalized === 'BOOLEAN') {
    return 'YES / NO';
  }

  if (normalized === 'SELECT') {
    return 'DROPDOWN';
  }

  if (normalized === 'MULTI_SELECT') {
    return 'MULTI SELECT';
  }

  if (normalized === 'DATETIME' || normalized === 'DATE_TIME') {
    return 'DATE TIME';
  }

  if (normalized === 'READING') {
    return 'READING / MEASUREMENT';
  }

  return normalized || 'UNKNOWN';
}

function getSectionTone(sectionTitle: string) {
  const normalizedTitle = sectionTitle.trim().toUpperCase();

  if (normalizedTitle === 'TIANG') {
    return {
      accent: '#334155',
      surface: '#f1f5f9',
      border: '#cbd5e1',
    };
  }

  if (normalizedTitle === 'PENGALIR') {
    return {
      accent: '#0f766e',
      surface: '#ecfdf5',
      border: '#99f6e4',
    };
  }

  if (normalizedTitle === 'AKSESORI') {
    return {
      accent: '#92400e',
      surface: '#fffbeb',
      border: '#fde68a',
    };
  }

  if (normalizedTitle === 'PERALATAN') {
    return {
      accent: '#475569',
      surface: '#f8fafc',
      border: '#cbd5e1',
    };
  }

  return {
    accent: '#111827',
    surface: '#f8fafc',
    border: '#d9e1ea',
  };
}

function getPhotoStatusLabel(state: PhotoUploadState) {
  if (state === 'uploaded') {
    return 'Uploaded';
  }

  if (state === 'error') {
    return 'Needs retry';
  }

  return 'Uploading';
}

function createLocalPhotoId(timestamp: string) {
  return `photo-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatPhotoTimestampLabel(value: Date) {
  return `${value.getFullYear()}-${padNumber(value.getMonth() + 1)}-${padNumber(value.getDate())} ${padNumber(value.getHours())}:${padNumber(value.getMinutes())}:${padNumber(value.getSeconds())}`;
}

function formatCoordinate(value: number) {
  return value.toFixed(6);
}

function formatOverlayCoordinate(value: number) {
  return value.toFixed(5);
}

function padNumber(value: number) {
  return String(value).padStart(2, '0');
}

async function getOverlayCaptureSize(
  uri: string,
  width?: number,
  height?: number,
) {
  const imageSize = width && height ? { width, height } : await loadImageSize(uri);
  const longestEdge = Math.max(imageSize.width, imageSize.height);
  const scale = longestEdge > 1600 ? 1600 / longestEdge : 1;
  const captureWidth = Math.max(1, Math.round(imageSize.width * scale));
  const captureHeight = Math.max(1, Math.round(imageSize.height * scale));
  const pixelRatio = PixelRatio.get() || 1;

  return {
    captureWidth,
    captureHeight,
    layoutWidth: captureWidth / pixelRatio,
    layoutHeight: captureHeight / pixelRatio,
  };
}

async function loadImageSize(uri: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => reject(new Error('Unable to measure the captured photo.')),
    );
  });
}

async function waitForNextPaint() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function delay(durationMs: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
}

const styles = StyleSheet.create({
  stickyActionArea: {
    gap: 12,
  },
  footerActions: {
    minHeight: 52,
    flexDirection: 'row',
    gap: 10,
  },
  footerActionSecondary: {
    flex: 0.92,
  },
  footerActionPrimary: {
    flex: 1.08,
    minHeight: 52,
  },
  inspectionHeaderCard: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: '#d9e1ea',
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  summaryTitleWrap: {
    flex: 1,
    gap: 4,
  },
  kickerLabel: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0,
    color: '#6b7280',
    textTransform: 'uppercase',
  },
  summaryAsset: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    color: '#111827',
  },
  contextChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  contextChip: {
    maxWidth: '100%',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d9e1ea',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 9,
    paddingVertical: 4,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#334155',
  },
  summaryMetaText: {
    fontSize: 12,
    lineHeight: 17,
    color: '#64748b',
  },
  photoSection: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  photoSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  photoTitleWrap: {
    flex: 1,
    gap: 4,
  },
  sectionHeading: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: '#111827',
  },
  photoCount: {
    minWidth: 34,
    minHeight: 28,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#eef2f7',
    color: '#111827',
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 13,
    lineHeight: 28,
    fontWeight: '600',
  },
  emptyPhotoPanel: {
    minHeight: 56,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  emptyPhotoTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
    color: '#111827',
  },
  emptyPhotoText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#6b7280',
    textAlign: 'center',
  },
  itemCard: {
    padding: 10,
    gap: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
  },
  checklistStack: {
    gap: 14,
  },
  sectionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d9e1ea',
    overflow: 'hidden',
  },
  sectionTopRail: {
    height: 3,
  },
  sectionHeader: {
    minHeight: 54,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  sectionIndexBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#111827',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionIndexText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  sectionHeaderText: {
    flex: 1,
    gap: 2,
  },
  sectionMeta: {
    fontSize: 13,
    lineHeight: 18,
    color: '#6b7280',
  },
  sectionDescription: {
    paddingHorizontal: 16,
    paddingTop: 14,
    fontSize: 14,
    lineHeight: 20,
    color: '#6b7280',
  },
  sectionItems: {
    padding: 10,
    gap: 8,
    backgroundColor: '#f8fafc',
  },
  photoCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  photoCard: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 144,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoMetaTitleWrap: {
    flex: 1,
    gap: 2,
  },
  photoTitle: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#111827',
  },
  photoPreviewButton: {
    overflow: 'hidden',
    backgroundColor: '#e5edf8',
  },
  photoPreviewPressed: {
    opacity: 0.92,
  },
  photoPreview: {
    width: '100%',
    height: 124,
    backgroundColor: '#e5edf8',
  },
  photoPreviewBadge: {
    position: 'absolute',
    left: 8,
    top: 8,
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(17, 24, 39, 0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  photoPreviewBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  photoTileBody: {
    padding: 9,
    gap: 7,
  },
  photoCoordLine: {
    fontSize: 11,
    lineHeight: 15,
    color: '#64748b',
    fontWeight: '600',
  },
  photoDetailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  photoMetaItem: {
    flex: 1,
    minWidth: 120,
    minHeight: 58,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
    justifyContent: 'center',
  },
  photoMetaLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
  },
  photoMetaValue: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    color: '#111827',
  },
  photoStatusPill: {
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  photoStatusUploaded: {
    backgroundColor: '#ecfdf5',
    borderColor: '#bbf7d0',
  },
  photoStatusError: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  photoStatusText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
    color: '#3730a3',
  },
  photoStatusTextUploaded: {
    color: '#166534',
  },
  photoStatusTextError: {
    color: '#b91c1c',
  },
  photoUploadError: {
    fontSize: 11,
    lineHeight: 15,
    color: '#b91c1c',
  },
  photoActionRow: {
    flexDirection: 'row',
    gap: 6,
  },
  photoActionButton: {
    flex: 1,
    minHeight: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 12,
  },
  photoActionButtonDanger: {
    borderColor: '#fecaca',
    backgroundColor: '#fff7f7',
  },
  photoActionButtonDisabled: {
    opacity: 0.5,
  },
  photoActionButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  photoActionText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: '#111827',
  },
  photoActionTextDanger: {
    color: '#b91c1c',
  },
  overlayCaptureRoot: {
    position: 'absolute',
    left: -10000,
    top: 0,
  },
  overlayCaptureCanvas: {
    position: 'relative',
    backgroundColor: '#000000',
  },
  overlayCaptureImage: {
    ...StyleSheet.absoluteFillObject,
  },
  overlayBadge: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    maxWidth: '78%',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  overlayText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
  previewModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  previewModalImage: {
    width: '100%',
    height: '100%',
  },
  itemTextWrap: {
    flex: 1,
    gap: 4,
  },
  itemLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: '#111827',
  },
  requiredLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#92400e',
    backgroundColor: '#fffbeb',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  helperText: {
    fontSize: 12,
    lineHeight: 17,
    color: '#6b7280',
  },
  resultControl: {
    gap: 8,
  },
  controlLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
  },
  resultButtonRow: {
    flexDirection: 'row',
    gap: 6,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
    padding: 5,
  },
  optionStack: {
    gap: 6,
  },
  optionButton: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  optionButtonSelected: {
    borderColor: '#111827',
    backgroundColor: '#f8fafc',
  },
  optionButtonText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
    color: '#111827',
  },
  optionButtonTextSelected: {
    color: '#111827',
  },
  optionIndicator: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIndicatorSelected: {
    borderColor: '#111827',
  },
  optionIndicatorInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#111827',
  },
  unsupportedFieldPanel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
    padding: 12,
  },
  unsupportedFieldText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    color: '#991b1b',
  },
  imageFieldPlaceholder: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    padding: 12,
    gap: 3,
  },
  imageFieldTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    color: '#111827',
  },
  imageFieldText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#64748b',
  },
  choiceButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceButtonSelected: {
    borderColor: '#111827',
    backgroundColor: '#111827',
  },
  choiceButtonPassSelected: {
    borderColor: '#15803d',
    backgroundColor: '#15803d',
  },
  choiceButtonFail: {
    borderColor: 'transparent',
  },
  choiceButtonFailSelected: {
    borderColor: '#b91c1c',
    backgroundColor: '#b91c1c',
  },
  choiceButtonNaSelected: {
    borderColor: '#475569',
    backgroundColor: '#475569',
  },
  choiceButtonDisabled: {
    opacity: 0.55,
  },
  choiceButtonPressed: {
    opacity: 0.92,
  },
  choiceButtonText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    color: '#374151',
  },
  choiceButtonTextSelected: {
    color: '#ffffff',
  },
  choiceButtonPassTextSelected: {
    color: '#ffffff',
  },
  choiceButtonFailText: {
    color: '#374151',
  },
  choiceButtonFailTextSelected: {
    color: '#ffffff',
  },
  choiceButtonNaTextSelected: {
    color: '#ffffff',
  },
});
