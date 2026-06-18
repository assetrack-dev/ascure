import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { captureRef } from 'react-native-view-shot';
import {
  ActivityIndicator,
  Image,
  Modal,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api, ApiError, API_BASE_URL } from '../api';
import { useSession } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import type { RootStackScreenProps } from '../navigation/types';
import {
  cleanupLocalInspectionPhotos,
  enqueueInspectionSubmission,
  isRetryableSyncError,
  isTempId,
  persistCapturedInspectionPhoto,
} from '../syncQueue';
import { cachedFetch, readCache } from '../offlineCache';
import {
  buildChecklistItemsPayloadFromDraft,
  buildResultsPayload,
  createInitialDraftValues,
  createInitialEmergencyMap,
  formatDateTime,
  getBooleanDefectValue,
  getInspectionItemResultValue,
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
import { Theme, useTheme } from '../theme';
import { getPositionWithTimeout } from '../location';
import { recognizeReadingFromImage } from '../ocr';
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

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');

function resolveServerImageUri(source: string | null | undefined) {
  if (!source) {
    return '';
  }
  if (/^[a-z][a-z\d+\-.]*:/i.test(source)) {
    return source;
  }
  return source.startsWith('/') ? `${API_ORIGIN}${source}` : `${API_ORIGIN}/${source}`;
}

// Rehydrate already-uploaded photos from the form response as "uploaded"
// captures so they (a) satisfy required IMAGE items without forcing a retake on
// re-open/amend and (b) render as existing thumbnails. The uploaded markers make
// uploadPhotosForSubmission skip them, so they are never re-uploaded.
function buildSeededPhotosFromForm(form: InspectionFormResponse): CapturedInspectionPhoto[] {
  return (form.images ?? [])
    .filter((image) => Boolean(image.url || image.path))
    .map((image) => ({
      id: image.id,
      uri: resolveServerImageUri(image.url ?? image.path),
      url: image.url,
      uploadedImageId: image.id,
      uploadedUrl: image.url,
      uploadState: 'uploaded' as const,
      templateItemId: image.templateItemId ?? undefined,
      latitude: image.latitude ?? 0,
      longitude: image.longitude ?? 0,
      timestamp: image.timestamp ?? image.createdAt ?? '',
    }));
}

export function InspectionFormScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
  const [emergencyItemIds, setEmergencyItemIds] = useState<Record<string, boolean>>({});
  const [scanningItemId, setScanningItemId] = useState<string | null>(null);
  const [capturingItemId, setCapturingItemId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<CapturedInspectionPhoto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAmending, setIsAmending] = useState(false);
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
  // The inspection (its answers, photos and defects) is read-only once it is
  // submitted OR once the owning Pencawang/site visit has been Completed or
  // Cancelled. The server enforces the same rule; editing is only possible
  // while the visit is still open (Amend re-opens a submitted inspection).
  const visitStatus = form?.inspection.siteVisit.status;
  const isVisitClosed = visitStatus === 'COMPLETED' || visitStatus === 'CANCELLED';
  const isReadOnly = isSubmitted || isVisitClosed;
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

      let formResponse: InspectionFormResponse;

      if (isTempId(inspectionId)) {
        // Offline-created inspection: no server form — read the form synthesized
        // and cached when it was started offline.
        const cached = await readCache<InspectionFormResponse>('inspection-form', inspectionId);

        if (!cached) {
          throw new ApiError('This inspection has not synced to the server yet.', 0, null);
        }

        formResponse = cached.value;
      } else {
        // Cache the form so an inspection opened online can be filled offline.
        const { value } = await cachedFetch('inspection-form', inspectionId, () =>
          api.getInspectionForm(token, inspectionId),
        );
        formResponse = value;
      }

      setForm(formResponse);
      setDraftValues(createInitialDraftValues(formResponse));
      setEmergencyItemIds(createInitialEmergencyMap(formResponse));
      setPhotoList(() => buildSeededPhotosFromForm(formResponse));
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

  function toggleEmergency(itemId: string, nextValue: boolean) {
    setSaveNotice(null);
    setEmergencyItemIds((current) => {
      if (Boolean(current[itemId]) === nextValue) {
        return current;
      }

      const next = { ...current };

      if (nextValue) {
        next[itemId] = true;
      } else {
        delete next[itemId];
      }

      return next;
    });
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
    if (isReadOnly) {
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
    // Bounded GPS (falls back to last-known) so a cold fix can't hang the photo
    // capture forever; the overlay needs coordinates, so fail clearly if none.
    const position = await getPositionWithTimeout({
      accuracy: Location.Accuracy.Balanced,
    });

    if (!position) {
      throw new Error('Could not get a GPS fix for the photo. Move to open sky and try again.');
    }

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
      photo: {
        id: photoId,
        uri: persistedPhoto.uri,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        timestamp: photoTimestamp,
        uploadState: 'uploading',
      } satisfies CapturedInspectionPhoto,
      // The original (pre-overlay) capture is the clean source for OCR — the
      // timestamp/GPS badge would otherwise feed stray digits to the parser.
      originalUri: capturedAsset.uri,
    };
  }

  async function handleTakePhoto() {
    try {
      setIsCapturingPhoto(true);
      setError(null);

      const captured = await captureInspectionPhoto();

      if (!captured) {
        return;
      }

      setPhotoList((current) => [...current, captured.photo]);
      void uploadPhotoInBackground(captured.photo);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : 'Unable to capture inspection photo.');
    } finally {
      setIsCapturingPhoto(false);
    }
  }

  // Capture a photo bound to a specific IMAGE checklist item (e.g. GAMBAR PENUH
  // TIANG). Reuses the same camera + timestamp/GPS overlay pipeline as the
  // global photos section, but tags the photo with templateItemId so the API
  // links it to this item's result (the same linkage the OCR field uses).
  // Multiple photos per item are appended; remove uses handleRemovePhoto.
  async function handleCaptureItemPhoto(itemId: string) {
    try {
      setCapturingItemId(itemId);
      setError(null);

      const captured = await captureInspectionPhoto();

      if (!captured) {
        return;
      }

      const itemPhoto = { ...captured.photo, templateItemId: itemId };
      setPhotoList((current) => [...current, itemPhoto]);
      void uploadPhotoInBackground(itemPhoto);
    } catch (captureError) {
      setError(
        captureError instanceof Error
          ? captureError.message
          : 'Unable to capture inspection photo.',
      );
    } finally {
      setCapturingItemId(null);
    }
  }

  async function handleRetakePhoto(photoId: string) {
    try {
      setIsCapturingPhoto(true);
      setError(null);

      const captured = await captureInspectionPhoto();

      if (!captured) {
        return;
      }

      setPhotoList((current) =>
        current.map((photo) => (photo.id === photoId ? captured.photo : photo)),
      );
      void uploadPhotoInBackground(captured.photo);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : 'Unable to capture inspection photo.');
    } finally {
      setIsCapturingPhoto(false);
    }
  }

  // Capture a Smart Sensor photo, save it as inspection evidence, then OCR the
  // reading on-device and pre-fill the (editable) NUMBER/READING field (#4).
  async function handleScanReading(itemId: string) {
    try {
      setScanningItemId(itemId);
      setError(null);

      const captured = await captureInspectionPhoto();

      if (!captured) {
        return;
      }

      // Tag the photo with its checklist item so the API links it to this
      // reading's result for the visual report. Replace any previous scan for
      // the same item (a retake) so the inline thumbnail shows the latest.
      const itemPhoto = { ...captured.photo, templateItemId: itemId };
      setPhotoList((current) => [
        ...current.filter((photo) => photo.templateItemId !== itemId),
        itemPhoto,
      ]);
      void uploadPhotoInBackground(itemPhoto);

      const reading = await recognizeReadingFromImage(captured.originalUri);

      if (reading) {
        updateDraftValue(itemId, reading);
      } else {
        setError('No number detected in the photo — enter the reading manually.');
      }
    } catch (scanError) {
      setError(
        scanError instanceof Error
          ? scanError.message
          : 'Unable to scan the Smart Sensor reading.',
      );
    } finally {
      setScanningItemId(null);
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

  // Re-open a submitted inspection for correction (tweak B): the API reverts it
  // to DRAFT and the form becomes editable again so the user can fix + re-submit.
  async function handleAmendInspection() {
    if (!form || !isSubmitted || isVisitClosed) {
      return;
    }

    try {
      setIsAmending(true);
      setError(null);

      const updatedForm = await api.amendInspection(token, inspectionId);
      setForm(updatedForm);
      setDraftValues(createInitialDraftValues(updatedForm));
      setEmergencyItemIds(createInitialEmergencyMap(updatedForm));
      setPhotoList(() => buildSeededPhotosFromForm(updatedForm));
      setSaveNotice('Inspection re-opened. Fix the entries, then submit again.');
    } catch (amendError) {
      if (amendError instanceof ApiError && amendError.status === 401) {
        await handleUnauthorized(amendError);
        return;
      }

      setError(
        amendError instanceof Error
          ? amendError.message
          : 'Unable to amend this inspection.',
      );
    } finally {
      setIsAmending(false);
    }
  }

  async function handleSubmitInspection() {
    if (!form || isReadOnly) {
      return;
    }

    if (checklistItemCount === 0) {
      setError('No active checklist template items are available for this inspection.');
      return;
    }

    const photoItemIds = new Set(
      photosRef.current
        .map((photo) => photo.templateItemId)
        .filter((id): id is string => Boolean(id)),
    );
    const validationMessage = validateInspectionDraft(form, draftValues, photoItemIds);

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
      emergencyByItemId: emergencyItemIds,
    });
    const submissionPayload = {
      results: supportedResults,
      items: checklistItems,
    };

    if (isTempId(inspectionId)) {
      // Offline-created inspection — never call the server with a temp id. Queue
      // the full submission; the reconciler creates the inspection on sync, then
      // replays the results + photos + submit against the real id.
      await enqueueInspectionSubmission({
        form,
        payload: submissionPayload,
        photos: photosRef.current,
      });
      goBackToVisit('Inspection saved to Sync Queue. It will sync when connection returns.');
      return;
    }

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
    if (!form || isReadOnly) {
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

    const checklistItems = buildChecklistItemsPayloadFromDraft(form, draftValues, {
      emergencyByItemId: emergencyItemIds,
    });

    if (isTempId(inspectionId)) {
      // No server draft for an offline-created inspection — keep editing in-form
      // and submit to queue when ready.
      setSaveNotice('Draft kept on device. Submit to queue it for sync.');
      return;
    }

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
      setEmergencyItemIds(createInitialEmergencyMap(savedForm));
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
          {isVisitClosed ? (
            <WarningBanner message="This site visit is complete — the inspection is now read-only." />
          ) : isSubmitted ? (
            <SuccessBanner message="This inspection has already been submitted." />
          ) : (
            <SuccessBanner message={saveNotice} />
          )}
          {isVisitClosed ? null : (
            <View style={styles.footerActions}>
              {isSubmitted ? (
                <View style={styles.footerActionPrimary}>
                  <AppButton
                    label={isAmending ? 'Re-opening...' : 'Amend / Edit'}
                    onPress={handleAmendInspection}
                    variant="secondary"
                    loading={isAmending}
                    disabled={isBusy}
                  />
                </View>
              ) : (
                <>
                  <View style={styles.footerActionSecondary}>
                    <AppButton
                      label={isSavingDraft ? 'Saving...' : 'Save Draft'}
                      onPress={handleSaveDraft}
                      variant="secondary"
                      loading={isSavingDraft}
                      disabled={isBusy || isTemplateEmpty}
                    />
                  </View>
                  <View style={styles.footerActionPrimary}>
                    <AppButton
                      label={isSubmitting ? 'Submitting...' : 'Submit'}
                      onPress={handleSubmitInspection}
                      loading={isSubmitting}
                      disabled={isBusy || isTemplateEmpty}
                    />
                  </View>
                </>
              )}
            </View>
          )}
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
            isSubmitted={Boolean(isReadOnly)}
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
                  emergencyItemIds={emergencyItemIds}
                  isSubmitted={Boolean(isReadOnly)}
                  onUpdateDraftValue={updateDraftValue}
                  onToggleEmergency={toggleEmergency}
                  onScanReading={handleScanReading}
                  scanningItemId={scanningItemId}
                  onCaptureItemPhoto={handleCaptureItemPhoto}
                  capturingItemId={capturingItemId}
                  onRemoveItemPhoto={handleRemovePhoto}
                  photos={photos}
                  onPreviewPhoto={(uri) => setSelectedPhotoUri(uri)}
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
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
  emergencyItemIds,
  isSubmitted,
  onUpdateDraftValue,
  onToggleEmergency,
  onScanReading,
  scanningItemId,
  onCaptureItemPhoto,
  capturingItemId,
  onRemoveItemPhoto,
  photos,
  onPreviewPhoto,
}: {
  section: InspectionTemplateSection;
  sectionIndex: number;
  draftValues: DraftValues;
  emergencyItemIds: Record<string, boolean>;
  isSubmitted: boolean;
  onUpdateDraftValue: (
    itemId: string,
    value: DraftValues[string],
  ) => void;
  onToggleEmergency: (itemId: string, nextValue: boolean) => void;
  onScanReading: (itemId: string) => void;
  scanningItemId: string | null;
  onCaptureItemPhoto: (itemId: string) => void;
  capturingItemId: string | null;
  onRemoveItemPhoto: (photoId: string) => void;
  photos: CapturedInspectionPhoto[];
  onPreviewPhoto: (uri: string) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
            isEmergency={Boolean(emergencyItemIds[item.id])}
            disabled={isSubmitted}
            onChange={(nextValue) => onUpdateDraftValue(item.id, nextValue)}
            onToggleEmergency={(nextValue) => onToggleEmergency(item.id, nextValue)}
            onScanReading={() => onScanReading(item.id)}
            scanning={scanningItemId === item.id}
            scanPhotoUri={photos.find((photo) => photo.templateItemId === item.id)?.uri}
            itemPhotos={photos.filter((photo) => photo.templateItemId === item.id)}
            capturing={capturingItemId === item.id}
            onCapturePhoto={() => onCaptureItemPhoto(item.id)}
            onRemovePhoto={onRemoveItemPhoto}
            onPreviewPhoto={onPreviewPhoto}
          />
        ))}
      </View>
    </View>
  );
}

function ChecklistItemCard({
  item,
  value,
  isEmergency,
  disabled,
  onChange,
  onToggleEmergency,
  onScanReading,
  scanning,
  scanPhotoUri,
  itemPhotos,
  capturing,
  onCapturePhoto,
  onRemovePhoto,
  onPreviewPhoto,
}: {
  item: InspectionTemplateItem;
  value: DraftValues[string] | undefined;
  isEmergency: boolean;
  disabled: boolean;
  onChange: (value: DraftValues[string]) => void;
  onToggleEmergency: (nextValue: boolean) => void;
  onScanReading: () => void;
  scanning: boolean;
  scanPhotoUri?: string;
  itemPhotos: CapturedInspectionPhoto[];
  capturing: boolean;
  onCapturePhoto: () => void;
  onRemovePhoto: (photoId: string) => void;
  onPreviewPhoto: (uri: string) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const inputType = normalizeInspectionInputType(item.inputType);
  const shouldUppercaseText = inputType === 'TEXT' && isOperationalTemplateTextItem(item);
  // An emergency flag only makes sense once the item is recorded as a defect
  // (a FAIL on a defect-trigger item). Showing it elsewhere would be noise.
  const isDefectNow =
    item.isDefectTrigger !== false &&
    getInspectionItemResultValue(item, value ?? null) === 'FAIL';

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
      {inputType === 'OCR' ? (
        <>
          <TextField
            label="Reading"
            value={typeof value === 'string' ? value : ''}
            onChangeText={onChange}
            placeholder="Scan or enter reading"
            keyboardType="decimal-pad"
            editable={!disabled}
          />
          {scanPhotoUri ? (
            <Pressable
              accessibilityRole="imagebutton"
              accessibilityLabel="Smart Sensor photo — tap to enlarge"
              onPress={() => onPreviewPhoto(scanPhotoUri)}
              style={styles.scanPhotoThumbWrap}
            >
              <Image
                source={{ uri: scanPhotoUri }}
                style={styles.scanPhotoThumb}
                resizeMode="cover"
              />
              <Text style={styles.scanPhotoHint}>Tap to enlarge</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={disabled || scanning}
            onPress={onScanReading}
            style={({ pressed }) => [
              styles.scanButton,
              (disabled || scanning) && styles.scanButtonDisabled,
              pressed && !disabled && !scanning && styles.scanButtonPressed,
            ]}
          >
            {scanning ? (
              <ActivityIndicator size="small" color={theme.colors.textOnPrimary} />
            ) : (
              <Text style={styles.scanButtonIcon}>⌖</Text>
            )}
            <Text style={styles.scanButtonText}>
              {scanning
                ? 'Scanning…'
                : scanPhotoUri
                  ? 'Retake with Smart Sensor'
                  : 'Scan with Smart Sensor'}
            </Text>
          </Pressable>
        </>
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
      {inputType === 'IMAGE' ? (
        <ImageCaptureField
          photos={itemPhotos}
          capturing={capturing}
          disabled={disabled}
          onCapture={onCapturePhoto}
          onRemove={onRemovePhoto}
          onPreview={onPreviewPhoto}
        />
      ) : null}
      {!inputType ? (
        <View style={styles.unsupportedFieldPanel}>
          <Text style={styles.unsupportedFieldText}>
            Unsupported field type: {formatFieldType(item.inputType)}.
          </Text>
        </View>
      ) : null}
      {isDefectNow || isEmergency ? (
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: isEmergency, disabled }}
          disabled={disabled}
          onPress={() => onToggleEmergency(!isEmergency)}
          style={({ pressed }) => [
            styles.emergencyToggle,
            isEmergency && styles.emergencyToggleActive,
            disabled && styles.emergencyToggleDisabled,
            pressed && !disabled && styles.emergencyTogglePressed,
          ]}
        >
          <View style={styles.emergencyToggleTextWrap}>
            <Text
              style={[
                styles.emergencyToggleText,
                isEmergency && styles.emergencyToggleTextActive,
              ]}
            >
              {isEmergency
                ? '🚨 Emergency — Immediate Action'
                : '🚨 Flag Emergency'}
            </Text>
            <Text style={styles.emergencyToggleHint} numberOfLines={2}>
              {isEmergency
                ? 'Maintenance will be alerted to respond immediately.'
                : 'Dangerous to public — alert maintenance for immediate action.'}
            </Text>
          </View>
          <View style={[styles.emergencyCheck, isEmergency && styles.emergencyCheckActive]}>
            {isEmergency ? <Text style={styles.emergencyCheckMark}>✓</Text> : null}
          </View>
        </Pressable>
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
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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

// Inline per-item photo capture for IMAGE checklist fields (e.g. GAMBAR PENUH
// TIANG). Camera-only with an automatic timestamp + GPS overlay — the same
// pipeline as the global photos section — and each photo is tagged to this
// checklist item. Supports multiple photos with per-photo removal.
function ImageCaptureField({
  photos,
  capturing,
  disabled,
  onCapture,
  onRemove,
  onPreview,
}: {
  photos: CapturedInspectionPhoto[];
  capturing: boolean;
  disabled: boolean;
  onCapture: () => void;
  onRemove: (photoId: string) => void;
  onPreview: (uri: string) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const hasPhotos = photos.length > 0;

  return (
    <View style={styles.imageCaptureField}>
      {hasPhotos ? (
        <View style={styles.imageThumbRow}>
          {photos.map((photo) => (
            <View key={photo.id} style={styles.imageThumbWrap}>
              <Pressable
                accessibilityRole="imagebutton"
                accessibilityLabel="Inspection photo — tap to enlarge"
                onPress={() => onPreview(photo.uri)}
                style={styles.imageThumbPressable}
              >
                <Image
                  source={{ uri: photo.uri }}
                  style={styles.imageThumb}
                  resizeMode="cover"
                />
              </Pressable>
              <View style={styles.imageThumbPill}>
                <PhotoStatusPill state={photo.uploadState} />
              </View>
              {!disabled ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                  onPress={() => onRemove(photo.id)}
                  style={styles.imageThumbRemove}
                >
                  <Text style={styles.imageThumbRemoveText}>✕</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.imageCaptureHint}>
          Camera only · timestamp &amp; GPS added automatically.
        </Text>
      )}
      {!disabled ? (
        <Pressable
          accessibilityRole="button"
          disabled={capturing}
          onPress={onCapture}
          style={({ pressed }) => [
            styles.scanButton,
            capturing && styles.scanButtonDisabled,
            pressed && !capturing && styles.scanButtonPressed,
          ]}
        >
          {capturing ? (
            <ActivityIndicator size="small" color={theme.colors.textOnPrimary} />
          ) : (
            <Text style={styles.scanButtonIcon}>📷</Text>
          )}
          <Text style={styles.scanButtonText}>
            {capturing ? 'Opening Camera…' : hasPhotos ? 'Add Photo' : 'Take Photo'}
          </Text>
        </Pressable>
      ) : null}
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
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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

const createStyles = (t: Theme) =>
  StyleSheet.create({
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
    backgroundColor: t.colors.card,
    borderRadius: 8,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: t.colors.border,
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
    color: t.colors.textSecondary,
    textTransform: 'uppercase',
  },
  summaryAsset: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    color: t.colors.textPrimary,
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
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceMuted,
    paddingHorizontal: 9,
    paddingVertical: 4,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: t.colors.textSecondary,
  },
  summaryMetaText: {
    fontSize: 12,
    lineHeight: 17,
    color: t.colors.textSecondary,
  },
  photoSection: {
    backgroundColor: t.colors.card,
    borderRadius: 8,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: t.colors.border,
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
    color: t.colors.textPrimary,
  },
  photoCount: {
    minWidth: 34,
    minHeight: 28,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: t.colors.surfaceMuted,
    color: t.colors.textPrimary,
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
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  emptyPhotoTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
    color: t.colors.textPrimary,
  },
  emptyPhotoText: {
    fontSize: 13,
    lineHeight: 19,
    color: t.colors.textSecondary,
    textAlign: 'center',
  },
  itemCard: {
    padding: 10,
    gap: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.card,
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
    backgroundColor: t.colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.border,
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
    backgroundColor: t.colors.card,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
  },
  sectionIndexBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: t.colors.primary,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionIndexText: {
    color: t.colors.textOnPrimary,
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
    color: t.colors.textSecondary,
  },
  sectionDescription: {
    paddingHorizontal: 16,
    paddingTop: 14,
    fontSize: 14,
    lineHeight: 20,
    color: t.colors.textSecondary,
  },
  sectionItems: {
    padding: 10,
    gap: 8,
    backgroundColor: t.colors.surfaceMuted,
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
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceMuted,
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
    color: t.colors.textPrimary,
  },
  photoPreviewButton: {
    overflow: 'hidden',
    backgroundColor: t.colors.surfaceMuted,
  },
  photoPreviewPressed: {
    opacity: 0.92,
  },
  photoPreview: {
    width: '100%',
    height: 124,
    backgroundColor: t.colors.surfaceMuted,
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
    color: t.colors.textSecondary,
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
    backgroundColor: t.colors.card,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
    justifyContent: 'center',
  },
  photoMetaLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: t.colors.textSecondary,
    textTransform: 'uppercase',
  },
  photoMetaValue: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    color: t.colors.textPrimary,
  },
  photoStatusPill: {
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: t.colors.infoSoft,
    borderWidth: 1,
    borderColor: t.colors.infoBorder,
  },
  photoStatusUploaded: {
    backgroundColor: t.colors.successSoft,
    borderColor: t.colors.successBorder,
  },
  photoStatusError: {
    backgroundColor: t.colors.dangerSoft,
    borderColor: t.colors.dangerBorder,
  },
  photoStatusText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
    color: t.colors.infoText,
  },
  photoStatusTextUploaded: {
    color: t.colors.successText,
  },
  photoStatusTextError: {
    color: t.colors.dangerText,
  },
  photoUploadError: {
    fontSize: 11,
    lineHeight: 15,
    color: t.colors.dangerText,
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
    backgroundColor: t.colors.card,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingHorizontal: 12,
  },
  photoActionButtonDanger: {
    borderColor: t.colors.dangerBorder,
    backgroundColor: t.colors.dangerSoft,
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
    color: t.colors.textPrimary,
  },
  photoActionTextDanger: {
    color: t.colors.dangerText,
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
    right: 8,
    bottom: 8,
    maxWidth: '70%',
    alignItems: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 3,
    gap: 1,
  },
  overlayText: {
    fontFamily: 'monospace',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '500',
    textAlign: 'right',
    color: '#ffffff',
  },
  scanButton: {
    marginTop: 8,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 8,
    paddingHorizontal: 14,
    backgroundColor: t.colors.primary,
  },
  scanButtonDisabled: {
    opacity: 0.55,
  },
  scanButtonPressed: {
    opacity: 0.85,
  },
  scanButtonIcon: {
    color: t.colors.textOnPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  scanButtonText: {
    color: t.colors.textOnPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  scanPhotoThumbWrap: {
    marginTop: 8,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: t.colors.surfaceMuted,
  },
  scanPhotoThumb: {
    width: '100%',
    height: 170,
  },
  scanPhotoHint: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  previewModalBackdrop: {
    flex: 1,
    backgroundColor: t.colors.overlay,
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
    color: t.colors.textPrimary,
  },
  requiredLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: t.colors.warningText,
    backgroundColor: t.colors.warningSoft,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.colors.warningBorder,
  },
  helperText: {
    fontSize: 12,
    lineHeight: 17,
    color: t.colors.textSecondary,
  },
  resultControl: {
    gap: 8,
  },
  controlLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: t.colors.textSecondary,
    textTransform: 'uppercase',
  },
  resultButtonRow: {
    flexDirection: 'row',
    gap: 6,
    borderRadius: 8,
    backgroundColor: t.colors.surfaceMuted,
    padding: 5,
  },
  optionStack: {
    gap: 6,
  },
  optionButton: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  optionButtonSelected: {
    borderColor: t.colors.primary,
    backgroundColor: t.colors.surfaceMuted,
  },
  optionButtonText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
    color: t.colors.textPrimary,
  },
  optionButtonTextSelected: {
    color: t.colors.textPrimary,
  },
  optionIndicator: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: t.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIndicatorSelected: {
    borderColor: t.colors.primary,
  },
  optionIndicatorInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: t.colors.primary,
  },
  unsupportedFieldPanel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.dangerBorder,
    backgroundColor: t.colors.dangerSoft,
    padding: 12,
  },
  unsupportedFieldText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    color: t.colors.dangerText,
  },
  emergencyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.colors.dangerBorder,
    backgroundColor: t.colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 52,
  },
  emergencyToggleActive: {
    backgroundColor: t.colors.dangerSoft,
    borderColor: t.colors.danger,
  },
  emergencyToggleDisabled: {
    opacity: 0.6,
  },
  emergencyTogglePressed: {
    opacity: 0.9,
  },
  emergencyToggleTextWrap: {
    flex: 1,
    gap: 2,
  },
  emergencyToggleText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
    color: t.colors.dangerText,
  },
  emergencyToggleTextActive: {
    color: t.colors.danger,
  },
  emergencyToggleHint: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: t.colors.textSecondary,
  },
  emergencyCheck: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: t.colors.dangerBorder,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.card,
  },
  emergencyCheckActive: {
    backgroundColor: t.colors.danger,
    borderColor: t.colors.danger,
  },
  emergencyCheckMark: {
    fontSize: 14,
    fontWeight: '900',
    color: t.colors.textOnPrimary,
  },
  imageCaptureField: {
    gap: 8,
  },
  imageThumbRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  imageThumbWrap: {
    position: 'relative',
    width: 104,
    height: 104,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: t.colors.surfaceMuted,
  },
  imageThumbPressable: {
    width: '100%',
    height: '100%',
  },
  imageThumb: {
    width: '100%',
    height: '100%',
  },
  imageThumbPill: {
    position: 'absolute',
    left: 4,
    bottom: 4,
  },
  imageThumbRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  imageThumbRemoveText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },
  imageCaptureHint: {
    fontSize: 13,
    lineHeight: 18,
    color: t.colors.textSecondary,
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
    borderColor: t.colors.primary,
    backgroundColor: t.colors.primary,
  },
  choiceButtonPassSelected: {
    borderColor: t.colors.success,
    backgroundColor: t.colors.success,
  },
  choiceButtonFail: {
    borderColor: 'transparent',
  },
  choiceButtonFailSelected: {
    borderColor: t.colors.danger,
    backgroundColor: t.colors.danger,
  },
  choiceButtonNaSelected: {
    borderColor: t.colors.textSecondary,
    backgroundColor: t.colors.textSecondary,
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
    color: t.colors.textSecondary,
  },
  choiceButtonTextSelected: {
    color: t.colors.textOnPrimary,
  },
  choiceButtonPassTextSelected: {
    color: t.colors.onStatus,
  },
  choiceButtonFailText: {
    color: t.colors.textSecondary,
  },
  choiceButtonFailTextSelected: {
    color: t.colors.onStatus,
  },
  choiceButtonNaTextSelected: {
    color: t.colors.onStatus,
  },
  });
