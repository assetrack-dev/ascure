import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { captureWithCamera, type CaptureGuide } from '../camera/captureWithCamera';
import { TimestampStamp } from '../camera/TimestampStamp';
import { TiltOverlay } from '../camera/TiltOverlay';
import * as Location from 'expo-location';
import { captureRef } from 'react-native-view-shot';
import {
  ActivityIndicator,
  Alert,
  Image,
  LayoutChangeEvent,
  Modal,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CommonActions, useNavigation, useRoute } from '@react-navigation/native';
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
import { isNetworkOffline } from '../networkStatus';
import {
  buildChecklistItemsPayloadFromDraft,
  buildResultsPayload,
  createInitialDraftValues,
  formatDateTime,
  getBooleanDefectValue,
  getInspectionItemResultValue,
  getVisibleInspectionSections,
  hasAnyInspectionDraftValue,
  isOperationalTemplateTextItem,
  normalizeInspectionInputType,
  normalizeOperationalText,
  normalizeSelectOptions,
  readImageConfig,
  OTHER_VALUE_PREFIX,
  readMultiSelectAllowOther,
  countAnsweredInspectionItems,
  validateInspectionDraft,
  validateInspectionDraftForSave,
  validateInspectionSectionItems,
} from '../utils';
import {
  AppButton,
  BottomCTA,
  EmptyState,
  ErrorBanner,
  InlineButton,
  LoadingBlock,
  Mono,
  Screen,
  StatusChip,
  SuccessBanner,
  TextField,
  WarningBanner,
} from '../ui';
import { Theme, useTheme } from '../theme';
import { getPositionWithTimeout } from '../location';
import {
  scanReadingFromImage,
  READING_AIM_BOX,
  type ReadingScan,
  type ReadingCandidate,
} from '../ocr';
import { READING_SENTINEL_LO, isReadingSentinel } from '@ascure/shared-utils';
import {
  DraftValues,
  InspectionFormResponse,
  InspectionImageUploadInput,
  InspectionTemplateSection,
  InspectionTemplateItem,
} from '../types';
import {
  DeclareEmergencySheet,
  EmergencyMedia,
} from '../components/DeclareEmergencySheet';

// 'pending' = kept locally, not uploaded yet — used while the inspection is an
// offline temp id, so it uploads with the queued submission after reconcile.
type PhotoUploadState = 'pending' | 'uploading' | 'uploaded' | 'error';

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
  tiltLineAngle?: number | null;
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

  // After a submit we land the crew on the substation Map (not the visit
  // summary) so they can tap the next pole and keep inspecting — cutting the
  // extra "open Map" tap. Rebuild the stack so the map sits directly on top of
  // the visit it belongs to (VisitDetail → VisitAssetMap), regardless of how the
  // form was reached (visit list, map, or Add-Asset), so Back from the map
  // returns to the visit rather than the just-submitted form. When no
  // VisitDetail is in the stack (legacy operational-session flow) the map is
  // pushed on top — still lands on the map without injecting an invalid visit.
  function goToMapAfterSubmit(successMessage: string) {
    navigation.dispatch((state) => {
      const visitDetailIndex = state.routes.findIndex(
        (route) => route.name === 'VisitDetail',
      );
      const baseRoutes =
        visitDetailIndex >= 0
          ? state.routes.slice(0, visitDetailIndex + 1)
          : state.routes;
      // Rebuild as a partial (keyless) state so we can append the new map route
      // without minting a route key by hand; React Navigation rehydrates it.
      const routes = [
        ...baseRoutes.map((route) => ({
          name: route.name,
          params: route.params,
          // Carry each base route's nested navigator state forward. Without it
          // the reset rebuilds keyless routes with no inner state, so the
          // AppDrawer snaps back to its initial tab (Home) if the crew backs all
          // the way out past the visit. `route.state` is a resolved
          // NavigationState, which isn't structurally a PartialState, hence the
          // cast (the value round-trips fine — React Navigation rehydrates it).
          state: route.state as never,
        })),
        {
          name: 'VisitAssetMap',
          // focusAssetId zooms the map onto the pole just inspected (the map
          // resolves its coordinate from the loaded list) so the crew continues
          // from where they were rather than the whole-substation overview.
          params: { visitId, substationId, successMessage, focusAssetId: form?.inspection.assetId },
        },
      ];

      return CommonActions.reset({ index: routes.length - 1, routes });
    });
  }

  const [form, setForm] = useState<InspectionFormResponse | null>(null);
  const [draftValues, setDraftValues] = useState<DraftValues>({});
  const [emergencySheetVisible, setEmergencySheetVisible] = useState(false);
  const [isDeclaringEmergency, setIsDeclaringEmergency] = useState(false);
  const [scanningItemId, setScanningItemId] = useState<string | null>(null);
  // Latest Smart Sensor scan result per item — drives the "did you mean…"
  // correction chips and the raw-OCR diagnostic line under the reading field.
  const [scanByItem, setScanByItem] = useState<Record<string, ReadingScan>>({});
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
  // Per-group state for the grouped checklist flow (ephemeral; not persisted).
  // completedSections = groups the crew explicitly marked done; expandedSections
  // = which group cards are open.
  const [completedSections, setCompletedSections] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const overlayCaptureRef = useRef<View>(null);
  const photosRef = useRef<CapturedInspectionPhoto[]>([]);
  // Per-group scroll anchoring: checklistStackY = the stack's top within the
  // ScrollView; sectionTops[id] = each group header's top within the stack.
  // After "Mark group done" collapses a group we scroll its header back to the
  // top, so the crew lands at the header level instead of stranded at the bottom
  // of a long checklist.
  const scrollRef = useRef<ScrollView>(null);
  const checklistStackY = useRef(0);
  const sectionTops = useRef<Record<string, number>>({});
  const removingPhotoIdsRef = useRef<Set<string>>(new Set());
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

  // IMAGE answers live as captured photos (tagged by templateItemId), not in
  // draftValues — the per-group validators need this to check required photos.
  const photoItemIds = useMemo(
    () =>
      new Set(
        photos
          .map((photo) => photo.templateItemId)
          .filter((id): id is string => Boolean(id)),
      ),
    [photos],
  );
  // The grouped (one-card-per-group) flow only applies to genuinely multi-group
  // templates while editing. A single-group or read-only checklist renders as one
  // open list, exactly as before.
  const isGroupedChecklist = !isReadOnly && checklistSections.length > 1;
  const isSectionComplete = useCallback(
    (section: InspectionTemplateSection) =>
      completedSections.has(section.id) &&
      validateInspectionSectionItems(section.items, draftValues, photoItemIds) === null,
    [completedSections, draftValues, photoItemIds],
  );
  const allSectionsComplete =
    !isGroupedChecklist || checklistSections.every((section) => isSectionComplete(section));
  // Group-progress readout for the top bar ("N/M groups" + fill). Counts only
  // apply to the grouped flow; a single-group / read-only list has no accordion.
  const totalGroupCount = checklistSections.length;
  const doneGroupCount = isGroupedChecklist
    ? checklistSections.filter((section) => isSectionComplete(section)).length
    : totalGroupCount;
  const groupProgress = totalGroupCount > 0 ? doneGroupCount / totalGroupCount : 0;

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

  function toggleSection(sectionId: string) {
    // Accordion: opening a group collapses any other open group, so only one
    // group card is expanded at a time (prevents confusion across a long list).
    setExpandedSections((current) =>
      current.has(sectionId) ? new Set() : new Set([sectionId]),
    );
  }

  function handleMarkSectionDone(section: InspectionTemplateSection) {
    const message = validateInspectionSectionItems(section.items, draftValues, photoItemIds);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    setCompletedSections((current) => new Set(current).add(section.id));
    setExpandedSections((current) => {
      const next = new Set(current);
      next.delete(section.id);
      return next;
    });
    // Bring the just-completed group's header to the top of the viewport. Its
    // top doesn't move when the group collapses (everything above it is static),
    // so the captured offset stays valid; rAF lets the collapse re-render first.
    const targetY = Math.max(
      0,
      checklistStackY.current + (sectionTops.current[section.id] ?? 0) - 12,
    );
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: targetY, animated: true });
    });
  }

  async function handleDeclareEmergency(payload: {
    note: string;
    media: EmergencyMedia | null;
  }) {
    // Instant declare needs the server (Option 1). An offline-created pole has no
    // server id yet — tell the inspector to sync first rather than silently fail.
    if (isTempId(inspectionId)) {
      setEmergencySheetVisible(false);
      setError(
        'Sync this pole first — an emergency report needs a connection to send immediately.',
      );
      return;
    }

    setIsDeclaringEmergency(true);
    setError(null);
    setSaveNotice(null);

    try {
      const { defectId } = await api.declareEmergency(token, inspectionId, {
        note: payload.note,
      });

      if (payload.media) {
        try {
          await api.uploadDefectEvidenceMedia(token, defectId, {
            uri: payload.media.uri,
            contentType: payload.media.contentType,
            evidenceType: 'EMERGENCY',
            note: payload.note,
          });
        } catch {
          // The alert is already out — a media-upload failure must not block it.
          setEmergencySheetVisible(false);
          setSaveNotice(
            'Emergency reported. The photo/clip did not upload — you can add it from the defect later.',
          );
          return;
        }
      }

      setEmergencySheetVisible(false);
      setSaveNotice('Emergency reported. The response team has been alerted.');
    } catch (declareError) {
      if (declareError instanceof ApiError && declareError.status === 401) {
        await handleUnauthorized(declareError);
        return;
      }

      setError(
        declareError instanceof Error
          ? declareError.message
          : 'Unable to report the emergency.',
      );
    } finally {
      setIsDeclaringEmergency(false);
    }
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
    // Offline-created inspection: there's no real server id yet, so we can't
    // upload now — POSTing to /inspections/temp_.../images fails the API's UUID
    // check ("inspectionId must be a UUID"). Keep the photo local and let it
    // upload with the queued submission once the inspection is reconciled to a
    // real id (see the isTempId branch in handleSubmit / enqueueInspectionSubmission).
    if (isTempId(inspectionId)) {
      updatePhoto(photo.id, {
        uploadState: 'pending',
        uploadError: undefined,
      });
      return;
    }

    // No coverage (or the crew chose Work Offline): don't attempt an eager upload
    // that would hang on a dead/weak connection ("image stuck after capture").
    // Mark it pending — it uploads with the queued submission on reconnect.
    if (isNetworkOffline()) {
      updatePhoto(photo.id, {
        uploadState: 'pending',
        uploadError: undefined,
      });
      return;
    }

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

  async function captureInspectionPhoto(options?: { guide?: CaptureGuide }) {
    if (isReadOnly) {
      return null;
    }

    // Location is still gated before opening the camera so we fail fast without
    // a GPS fix (the photo overlay needs coordinates).
    const isLocationEnabled = await Location.hasServicesEnabledAsync();

    if (!isLocationEnabled) {
      throw new Error('Location services must be enabled to attach GPS to the photo.');
    }

    const locationPermission = await Location.requestForegroundPermissionsAsync();

    if (!locationPermission.granted) {
      throw new Error('Location permission is required to attach GPS to the photo.');
    }

    const capturedAsset = await captureWithCamera({ mode: 'photo', guide: options?.guide });

    if (!capturedAsset) {
      return null;
    }

    const capturedAt = new Date();
    const photoTimestamp = capturedAt.toISOString();
    // Evidence-grade fix: HIGH accuracy, and reject a last-known fallback older
    // than 60 s so a cold/no-signal fix can't stamp a stale coordinate from far
    // away (the defect that mislocated clearance photos without the crew moving).
    const position = await getPositionWithTimeout({
      accuracy: Location.Accuracy.High,
      maxLastKnownAgeMs: 60_000,
    });

    if (!position) {
      throw new Error(
        'Could not get a fresh GPS fix for the photo. Move to open sky and try again.',
      );
    }

    // Fix-quality provenance carried with the photo (see InspectionImageUploadInput).
    const accuracyMeters =
      typeof position.coords.accuracy === 'number' ? position.coords.accuracy : null;
    const capturedFixAt =
      typeof position.timestamp === 'number'
        ? new Date(position.timestamp).toISOString()
        : null;
    const mocked = position.mocked === true;

    // A faked-location app is a fraud signal the crew shouldn't be able to pass
    // off silently — surface it at capture (still recorded either way).
    if (mocked) {
      Alert.alert(
        'Mock location detected',
        'This device is reporting a simulated GPS location. Turn off any mock-location app and recapture.',
      );
    }

    const photoId = createLocalPhotoId(photoTimestamp);
    const overlayImageUri = await createOverlayPhoto({
      originalUri: capturedAsset.uri,
      timestamp: photoTimestamp,
      timestampLabel: formatPhotoTimestampLabel(capturedAt),
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      tiltLineAngle: capturedAsset.tiltLineAngle ?? null,
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
      accuracyMeters,
      capturedFixAt,
      mocked,
    });

    return {
      photo: {
        id: photoId,
        uri: persistedPhoto.uri,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        timestamp: photoTimestamp,
        accuracyMeters,
        capturedFixAt,
        mocked,
        uploadState: 'uploading',
      } satisfies CapturedInspectionPhoto,
      // The original (pre-overlay) capture is the clean source for OCR — the
      // timestamp/GPS badge would otherwise feed stray digits to the parser.
      originalUri: capturedAsset.uri,
      // Pixel dims of the original capture — used to crop the aim-box region for
      // OCR without a fragile Image.getSize on the file URI.
      originalWidth: capturedAsset.width,
      originalHeight: capturedAsset.height,
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

      // Open the camera with the reading aim box so the crew frames just the big
      // LCD number — we then crop to that box for OCR (isolating it from the
      // temperature + buttons that full-frame OCR keeps grabbing).
      const captured = await captureInspectionPhoto({ guide: 'reading' });

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

      // Target the reading spatially + validate against a plausible clearance
      // band (see ocr.ts). Only auto-fill a confident value — never silently
      // write the on-screen temperature or a stray glyph. Surface the raw OCR
      // text on a miss so field validation shows us exactly what ML Kit saw.
      const scan = await scanReadingFromImage(captured.originalUri, {
        region: READING_AIM_BOX,
        imageWidth: captured.originalWidth,
        imageHeight: captured.originalHeight,
      });
      // Keep the full scan for this item so the field can render correction
      // chips + the raw-OCR diagnostic line (see ChecklistItemCard).
      setScanByItem((current) => ({ ...current, [itemId]: scan }));

      const hasChoices = scan.candidates.some((candidate) => candidate.inRange);

      if (!scan.lowConfidence && scan.best) {
        // Confident — a single clean read, or both passes agreed. Auto-fill.
        updateDraftValue(itemId, scan.best);
      } else if (hasChoices) {
        // Ambiguous seven-segment digits (the two passes disagreed, or the read
        // was unsure): don't silently guess. The correction chips + the photo
        // render inline under the field so the crew taps the right value — the
        // inline prompt replaces a global error here.
      } else {
        const saw = scan.rawText.trim();
        setError(
          saw
            ? `Couldn't read a clear number (Smart Sensor saw "${saw}"). Enter the reading manually.`
            : 'No number detected in the photo — enter the reading manually.',
        );
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

  async function handleRemovePhoto(photoId: string) {
    if (removingPhotoIdsRef.current.has(photoId)) {
      return;
    }
    const photo = photosRef.current.find((entry) => entry.id === photoId);

    // A freshly-captured local photo (no server id) is just dropped from state.
    // An already-uploaded image (seeded when amending) must ALSO be deleted
    // server-side — otherwise it silently reappears the next time the inspection
    // is amended (the form re-seeds from the persisted rows).
    if (photo?.uploadedImageId && !isTempId(inspectionId)) {
      removingPhotoIdsRef.current.add(photoId);
      setError(null);
      try {
        await api.deleteInspectionImage(token, inspectionId, photo.uploadedImageId);
      } catch (deleteError) {
        if (deleteError instanceof ApiError && deleteError.status === 401) {
          await handleUnauthorized(deleteError);
          return;
        }
        setError(
          deleteError instanceof Error
            ? deleteError.message
            : 'Unable to delete the photo — check your connection and try again.',
        );
        return; // keep the thumbnail so it's clear the photo was not removed
      } finally {
        removingPhotoIdsRef.current.delete(photoId);
      }
    }

    setPhotoList((current) => current.filter((entry) => entry.id !== photoId));
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

    if (isGroupedChecklist && !allSectionsComplete) {
      setError('Please complete and mark every group done before submitting.');
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
      goToMapAfterSubmit('Inspection saved to Sync Queue. It will sync when connection returns.');
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

      goToMapAfterSubmit('Inspection submitted successfully.');
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

        goToMapAfterSubmit('Inspection saved to Sync Queue. It will retry when connection returns.');
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

    const checklistItems = buildChecklistItemsPayloadFromDraft(form, draftValues);

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

  // Submit gating for the docked CTA: block until the grouped checklist has every
  // group marked done (same rule handleSubmitInspection enforces), and surface the
  // reason as the button's hint. The handler itself is unchanged.
  const submitBlocked = isBusy || isTemplateEmpty || (isGroupedChecklist && !allSectionsComplete);
  const submitHint = isTemplateEmpty
    ? 'Submit · no checklist items'
    : isGroupedChecklist && !allSectionsComplete
      ? `Submit · finish all groups (${doneGroupCount}/${totalGroupCount})`
      : undefined;

  const bottomBar =
    !isLoading && form && !isVisitClosed ? (
      isSubmitted ? (
        <BottomCTA
          label={isAmending ? 'Re-opening…' : 'Amend / Edit'}
          onPress={handleAmendInspection}
          loading={isAmending}
          disabled={isBusy}
        />
      ) : (
        <BottomCTA
          label={isSubmitting ? 'Submitting…' : 'Submit Inspection'}
          onPress={handleSubmitInspection}
          loading={isSubmitting}
          disabled={submitBlocked}
          hint={submitHint}
        />
      )
    ) : null;

  return (
    <Screen
      title="Inspection"
      subtitle={
        form
          ? `${form.inspection.asset.assetType.name} · ${form.inspection.asset.assetCode}`
          : 'Checklist'
      }
      keyboardAware
      scrollRef={scrollRef}
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
      bottomBar={bottomBar}
    >
      {isLoading ? <LoadingBlock label="Loading inspection form..." /> : null}

      {!isLoading && form ? (
        <>
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

          <View style={styles.inspectionHeaderCard}>
            <View style={styles.summaryHeader}>
              <View style={styles.summaryTitleWrap}>
                <Text style={styles.kickerLabel}>Asset Code</Text>
                <Mono size={20} color={theme.colors.textPrimary}>
                  {form.inspection.asset.assetCode}
                </Mono>
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

          {isGroupedChecklist ? (
            <View style={styles.progressCard}>
              <View style={styles.progressHeaderRow}>
                <Text style={styles.progressLabel}>Checklist progress</Text>
                <Mono size={13} color={theme.colors.textSecondary}>
                  {doneGroupCount}/{totalGroupCount} groups
                </Mono>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.round(groupProgress * 100)}%`,
                      backgroundColor: allSectionsComplete
                        ? theme.colors.success
                        : theme.colors.primary,
                    },
                  ]}
                />
              </View>
            </View>
          ) : null}

          {!isReadOnly ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Report emergency"
              onPress={() => setEmergencySheetVisible(true)}
              disabled={isDeclaringEmergency}
              style={({ pressed }) => [
                styles.declareEmergencyButton,
                (pressed || isDeclaringEmergency) && styles.declareEmergencyButtonPressed,
              ]}
            >
              <Text style={styles.declareEmergencyEmoji}>🚨</Text>
              <Text style={styles.declareEmergencyButtonText}>Declare Emergency</Text>
            </Pressable>
          ) : null}

          <DeclareEmergencySheet
            visible={emergencySheetVisible}
            isSending={isDeclaringEmergency}
            onCancel={() => setEmergencySheetVisible(false)}
            onSend={handleDeclareEmergency}
          />

          {checklistItemCount === 0 ? (
            <EmptyState
              title="No active checklist items"
              description="Activate a checklist template before submitting."
            />
          ) : (
            <View
              style={styles.checklistStack}
              onLayout={(event) => {
                checklistStackY.current = event.nativeEvent.layout.y;
              }}
            >
              {checklistSections.map((section, sectionIndex) => (
                <ChecklistSectionCard
                  key={section.id}
                  section={section}
                  sectionIndex={sectionIndex}
                  onLayout={(event) => {
                    sectionTops.current[section.id] = event.nativeEvent.layout.y;
                  }}
                  draftValues={draftValues}
                  isSubmitted={Boolean(isReadOnly)}
                  collapsible={isGroupedChecklist}
                  expanded={!isGroupedChecklist || expandedSections.has(section.id)}
                  complete={isSectionComplete(section)}
                  answeredCount={countAnsweredInspectionItems(
                    section.items,
                    draftValues,
                    photoItemIds,
                  )}
                  onToggleSection={() => toggleSection(section.id)}
                  onMarkSectionDone={() => handleMarkSectionDone(section)}
                  onUpdateDraftValue={updateDraftValue}
                  onScanReading={handleScanReading}
                  scanningItemId={scanningItemId}
                  scanByItem={scanByItem}
                  onCaptureItemPhoto={handleCaptureItemPhoto}
                  capturingItemId={capturingItemId}
                  onRemoveItemPhoto={handleRemovePhoto}
                  photos={photos}
                  onPreviewPhoto={(uri) => setSelectedPhotoUri(uri)}
                />
              ))}
            </View>
          )}

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

          {/* Save Draft is a secondary action (the primary Submit lives in the
              docked CTA); hidden once read-only/submitted. */}
          {!isReadOnly ? (
            <View style={styles.saveDraftRow}>
              <AppButton
                label={isSavingDraft ? 'Saving...' : 'Save Draft'}
                onPress={handleSaveDraft}
                variant="secondary"
                loading={isSavingDraft}
                disabled={isBusy || isTemplateEmpty}
              />
            </View>
          ) : null}

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
                {pendingOverlayPhoto.tiltLineAngle != null ? (
                  <TiltOverlay angleDeg={pendingOverlayPhoto.tiltLineAngle} />
                ) : null}
                <View style={styles.overlayStampWrap}>
                  <TimestampStamp
                    date={new Date(pendingOverlayPhoto.timestamp)}
                    latitude={pendingOverlayPhoto.latitude ?? null}
                    longitude={pendingOverlayPhoto.longitude ?? null}
                  />
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
  onLayout,
  draftValues,
  isSubmitted,
  collapsible,
  expanded,
  complete,
  answeredCount,
  onToggleSection,
  onMarkSectionDone,
  onUpdateDraftValue,
  onScanReading,
  scanningItemId,
  scanByItem,
  onCaptureItemPhoto,
  capturingItemId,
  onRemoveItemPhoto,
  photos,
  onPreviewPhoto,
}: {
  section: InspectionTemplateSection;
  sectionIndex: number;
  onLayout: (event: LayoutChangeEvent) => void;
  draftValues: DraftValues;
  isSubmitted: boolean;
  collapsible: boolean;
  expanded: boolean;
  complete: boolean;
  answeredCount: number;
  onToggleSection: () => void;
  onMarkSectionDone: () => void;
  onUpdateDraftValue: (
    itemId: string,
    value: DraftValues[string],
  ) => void;
  onScanReading: (itemId: string) => void;
  scanningItemId: string | null;
  scanByItem: Record<string, ReadingScan>;
  onCaptureItemPhoto: (itemId: string) => void;
  capturingItemId: string | null;
  onRemoveItemPhoto: (photoId: string) => void;
  photos: CapturedInspectionPhoto[];
  onPreviewPhoto: (uri: string) => void;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const styles = useMemo(() => createStyles(theme), [theme]);
  const normalizedTitle = section.title.trim().toUpperCase();
  const sectionTitle = PRIORITY_SECTION_TITLES.includes(normalizedTitle)
    ? normalizedTitle
    : section.title;
  const totalCount = section.items.length;
  // Chip: explicitly-done wins, else in-progress if any answers, else not started.
  // Done = soft-success; in-progress = soft-warning; untouched = muted neutral.
  const chip = complete
    ? { bg: c.successSoft, fg: c.successText, label: 'Done' }
    : answeredCount > 0
      ? { bg: c.warningSoft, fg: c.warningText, label: `${answeredCount}/${totalCount}` }
      : { bg: c.surfaceMuted, fg: c.textMuted, label: 'Not started' };
  const showItems = !collapsible || expanded;
  // Number/check badge: a completed group flips to a soft-success check; an open
  // group carries the blue spine accent, so it reads like the rest of the app.
  const badgeBg = complete ? c.successSoft : c.primarySoft;
  const badgeBorder = complete ? c.successBorder : c.primary;
  const badgeText = complete ? c.successText : c.primary;

  const header = (
    <View
      style={[
        styles.sectionHeader,
        complete && { backgroundColor: c.successSoft, borderBottomColor: c.successBorder },
      ]}
    >
      <View
        style={[
          styles.sectionIndexBadge,
          { backgroundColor: badgeBg, borderColor: badgeBorder },
        ]}
      >
        {complete ? (
          <Feather name="check" size={18} color={badgeText} />
        ) : (
          <Mono size={13} color={badgeText}>
            {String(sectionIndex + 1).padStart(2, '0')}
          </Mono>
        )}
      </View>
      <View style={styles.sectionHeaderText}>
        <Text style={[styles.sectionHeading, complete && { color: c.successText }]}>
          {sectionTitle}
        </Text>
        <Text style={[styles.sectionMeta, complete && { color: c.successText }]}>
          {answeredCount} of {totalCount} answered
        </Text>
      </View>
      {collapsible ? (
        <View style={styles.sectionHeaderStatus}>
          <View style={[styles.sectionChip, { backgroundColor: chip.bg }]}>
            <Text style={[styles.sectionChipText, { color: chip.fg }]}>{chip.label}</Text>
          </View>
          <Feather
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={complete ? c.successText : c.textMuted}
          />
        </View>
      ) : null}
    </View>
  );

  return (
    <View
      onLayout={onLayout}
      style={[
        styles.sectionCard,
        complete && { borderColor: c.successBorder },
      ]}
    >
      <View
        style={[
          styles.sectionTopRail,
          { backgroundColor: complete ? c.success : c.primary },
        ]}
      />
      {collapsible ? (
        <Pressable onPress={onToggleSection} accessibilityRole="button">
          {header}
        </Pressable>
      ) : (
        header
      )}
      {collapsible && !showItems ? (
        <Pressable onPress={onToggleSection} style={styles.sectionShowChecklist}>
          <Text style={styles.sectionShowChecklistText}>Show Checklist</Text>
        </Pressable>
      ) : null}
      {showItems ? (
        <>
          <View style={styles.sectionItems}>
            {section.items.map((item) => (
              <ChecklistItemCard
                key={item.id}
                item={item}
                value={draftValues[item.id]}
                disabled={isSubmitted}
                onChange={(nextValue) => onUpdateDraftValue(item.id, nextValue)}
                onScanReading={() => onScanReading(item.id)}
                scanning={scanningItemId === item.id}
                scanInfo={scanByItem[item.id]}
                scanPhotoUri={photos.find((photo) => photo.templateItemId === item.id)?.uri}
                itemPhotos={photos.filter((photo) => photo.templateItemId === item.id)}
                capturing={capturingItemId === item.id}
                onCapturePhoto={() => onCaptureItemPhoto(item.id)}
                onRemovePhoto={onRemoveItemPhoto}
                onPreviewPhoto={onPreviewPhoto}
              />
            ))}
          </View>
          {collapsible && !isSubmitted ? (
            <View style={styles.sectionDoneRow}>
              <AppButton
                label={complete ? 'Group done ✓' : 'Mark group done'}
                onPress={onMarkSectionDone}
                variant={complete ? 'secondary' : 'success'}
              />
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function ChecklistItemCard({
  item,
  value,
  disabled,
  onChange,
  onScanReading,
  scanning,
  scanInfo,
  scanPhotoUri,
  itemPhotos,
  capturing,
  onCapturePhoto,
  onRemovePhoto,
  onPreviewPhoto,
}: {
  item: InspectionTemplateItem;
  value: DraftValues[string] | undefined;
  disabled: boolean;
  onChange: (value: DraftValues[string]) => void;
  onScanReading: () => void;
  scanning: boolean;
  scanInfo?: ReadingScan;
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
  // A Smart Sensor reading may hold the device sentinel "LO" (the meter shows it
  // instead of a number when the cable is below its ~3 m minimum range) rather
  // than a value. The numeric keypad can't type letters, so it's set by tapping.
  const readingText = typeof value === 'string' ? value : '';
  const isBelowRange = inputType === 'OCR' && isReadingSentinel(readingText);
  // "Did you mean…" correction chips: the in-range candidates from the last
  // scan. Shown when the read was unsure / the two passes disagreed, or when
  // there's more than one plausible value to choose between.
  const readingChips: ReadingCandidate[] =
    inputType === 'OCR' && scanInfo
      ? scanInfo.candidates.filter((candidate) => candidate.inRange).slice(0, 4)
      : [];
  const showReadingChips =
    !disabled &&
    !!scanInfo &&
    readingChips.length >= 1 &&
    (scanInfo.lowConfidence || scanInfo.disagreement === true || readingChips.length >= 2);
  // Raw OCR text (whitespace-collapsed) — an on-screen diagnostic so a field
  // screenshot reveals exactly what the scanner read on a miss.
  const scannerSaw = scanInfo?.rawText.replace(/\s+/g, ' ').trim() ?? '';
  const scannerSawZoom = scanInfo?.rawTextCrop?.replace(/\s+/g, ' ').trim() ?? '';
  const scannerCropError = scanInfo?.cropError?.replace(/\s+/g, ' ').trim() ?? '';
  const readerTrace = scanInfo?.decoderText?.replace(/\s+/g, ' ').trim() ?? '';

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
        <ReadingBox
          label="Number"
          value={typeof value === 'string' ? value : ''}
          onChangeText={onChange}
          placeholder="0"
          disabled={disabled}
        />
      ) : null}
      {inputType === 'READING' ? (
        <ReadingBox
          label="Reading"
          value={typeof value === 'string' ? value : ''}
          onChangeText={onChange}
          placeholder="0"
          disabled={disabled}
        />
      ) : null}
      {inputType === 'OCR' ? (
        <>
          <ReadingBox
            label="Reading"
            value={readingText}
            onChangeText={onChange}
            placeholder="Scan or enter"
            disabled={disabled}
          />
          {isBelowRange ? (
            <Text style={styles.sentinelHint}>
              Below the meter&apos;s range — cable clearance under 3 m.
            </Text>
          ) : null}
          {showReadingChips ? (
            <View style={styles.readingChipsWrap}>
              <Text style={styles.readingChipsLabel}>
                {scanInfo?.disagreement
                  ? 'Two reads differed — tap the correct value'
                  : 'Not sure — tap the value on the meter'}
              </Text>
              <View style={styles.readingChipsRow}>
                {readingChips.map((candidate) => {
                  const selected = candidate.value === readingText;
                  return (
                    <Pressable
                      key={candidate.value}
                      accessibilityRole="button"
                      accessibilityLabel={`Use reading ${candidate.value}`}
                      onPress={() => onChange(candidate.value)}
                      style={({ pressed }) => [
                        styles.readingChip,
                        selected && styles.readingChipSelected,
                        pressed && styles.scanButtonPressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.readingChipText,
                          selected && styles.readingChipTextSelected,
                        ]}
                      >
                        {candidate.value}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
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
              <ActivityIndicator size="small" color={theme.colors.onSolidFill} />
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
          {/* The reading keypad is numeric, so "LO" can never be typed. When the
              meter reads -LO- (cable under ~3 m) the crew taps this instead. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isBelowRange
                ? 'Clear the below-range reading'
                : "Mark the reading as below the meter's range"
            }
            disabled={disabled || scanning}
            onPress={() => onChange(isBelowRange ? '' : READING_SENTINEL_LO)}
            style={({ pressed }) => [
              styles.sentinelButton,
              isBelowRange && styles.sentinelButtonActive,
              (disabled || scanning) && styles.scanButtonDisabled,
              pressed && !disabled && !scanning && styles.scanButtonPressed,
            ]}
          >
            <Text
              style={[
                styles.sentinelButtonText,
                isBelowRange && styles.sentinelButtonTextActive,
              ]}
            >
              {isBelowRange ? 'Clear “LO” — enter a number' : 'Cable below range — mark “LO”'}
            </Text>
          </Pressable>
          {readerTrace || scannerSawZoom || scannerSaw || scannerCropError ? (
            <View style={styles.scanDiagnosticWrap}>
              {readerTrace ? (
                <Text style={styles.scanDiagnostic} numberOfLines={1}>
                  Reader: {readerTrace}
                </Text>
              ) : null}
              <Text style={styles.scanDiagnostic} numberOfLines={1}>
                {scannerSawZoom ? `zoom: “${scannerSawZoom}”` : `saw: “${scannerSaw || '—'}”`}
                {scannerCropError ? `  · crop failed: ${scannerCropError}` : ''}
              </Text>
            </View>
          ) : null}
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
          allowMultiple={readImageConfig(item.optionsJson).allowMultiplePhotos}
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
  const allowOther = readMultiSelectAllowOther(item.optionsJson);
  const otherEntry = value.find((entry) => entry.startsWith(OTHER_VALUE_PREFIX));
  const otherText = otherEntry ? otherEntry.slice(OTHER_VALUE_PREFIX.length) : '';

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
      {allowOther ? (
        <View style={{ marginTop: 10 }}>
          <TextField
            label="Other (specify)"
            value={otherText}
            onChangeText={(nextText) => {
              const withoutOther = value.filter(
                (entry) => !entry.startsWith(OTHER_VALUE_PREFIX),
              );
              onChange(
                nextText.length > 0
                  ? [...withoutOther, `${OTHER_VALUE_PREFIX}${nextText}`]
                  : withoutOther,
              );
            }}
            placeholder="Type an answer not in the list"
            editable={!disabled}
            autoCapitalize="characters"
          />
        </View>
      ) : null}
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
  allowMultiple = true,
  onCapture,
  onRemove,
  onPreview,
}: {
  photos: CapturedInspectionPhoto[];
  capturing: boolean;
  disabled: boolean;
  // When false, only ONE photo is allowed — the add affordance disappears once a
  // photo exists (per-field allowMultiplePhotos from the template).
  allowMultiple?: boolean;
  onCapture: () => void;
  onRemove: (photoId: string) => void;
  onPreview: (uri: string) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const hasPhotos = photos.length > 0;

  // Empty + editable → a single dashed capture tile is the whole affordance
  // (handoff 2a). Once at least one photo exists, show GPS-stamped thumbnails and
  // an "Add Photo" button below.
  if (!hasPhotos && !disabled) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Take photo"
        disabled={capturing}
        onPress={onCapture}
        style={({ pressed }) => [
          styles.imageDashedTile,
          pressed && !capturing && styles.imageDashedTilePressed,
          capturing && styles.scanButtonDisabled,
        ]}
      >
        {capturing ? (
          <ActivityIndicator size="small" color={theme.colors.primary} />
        ) : (
          <Feather name="camera" size={22} color={theme.colors.textMuted} />
        )}
        <Text style={styles.imageDashedTileText}>
          {capturing ? 'Opening Camera…' : 'Take Photo'}
        </Text>
        <Text style={styles.imageCaptureHint}>Timestamp &amp; GPS added automatically</Text>
      </Pressable>
    );
  }

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
              <View style={[styles.imageThumbGps, { backgroundColor: theme.colors.success }]}>
                <Feather name="map-pin" size={9} color="#ffffff" />
                <Text style={styles.imageThumbGpsText}>GPS ✓</Text>
              </View>
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
      {/* Hide the add affordance once a photo exists when the field is
          single-photo only; the empty state still captures the first one. */}
      {!disabled && (allowMultiple || !hasPhotos) ? (
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
            <ActivityIndicator size="small" color={theme.colors.onSolidFill} />
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

// Large mono value box for numeric readings (NUMBER / READING / OCR). Purely a
// visual treatment of a single-line input — same onChange contract as before,
// styled as a "field instrument" value box (handoff 2a). `unit` is optional and
// only rendered when the caller passes one.
function ReadingBox({
  label,
  value,
  onChangeText,
  placeholder,
  disabled,
  unit,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  disabled: boolean;
  unit?: string | null;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.readingWrap}>
      <Text style={styles.controlLabel}>{label}</Text>
      <View style={[styles.readingBox, disabled && styles.readingBoxDisabled]}>
        <TextInput
          style={styles.readingInput}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textMuted}
          keyboardType="decimal-pad"
          editable={!disabled}
        />
        {unit ? <Text style={styles.readingUnit}>{unit}</Text> : null}
      </View>
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

function getPhotoStatusLabel(state: PhotoUploadState) {
  if (state === 'uploaded') {
    return 'Uploaded';
  }

  if (state === 'error') {
    return 'Needs retry';
  }

  if (state === 'pending') {
    return 'Will sync';
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
  saveDraftRow: {
    marginTop: 2,
  },
  // Top-of-form group progress (handoff 2a): "N/M groups" + a token-filled track.
  progressCard: {
    backgroundColor: t.colors.card,
    borderRadius: t.radius.card,
    borderWidth: 1,
    borderColor: t.colors.border,
    padding: 14,
    gap: 10,
    ...t.shadow.card,
  },
  progressHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressLabel: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: t.fonts.bodySemibold,
    color: t.colors.textSecondary,
  },
  progressTrack: {
    height: 8,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surfaceMuted,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.primary,
  },
  // Mono "value box" for numeric readings.
  readingWrap: {
    gap: 8,
  },
  readingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 56,
    borderRadius: t.radius.control,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    backgroundColor: t.colors.surfaceMuted,
    paddingHorizontal: 14,
  },
  readingBoxDisabled: {
    opacity: 0.6,
  },
  readingInput: {
    flex: 1,
    fontFamily: t.fonts.monoMedium,
    fontSize: 22,
    letterSpacing: 0.4,
    color: t.colors.textPrimary,
    paddingVertical: 8,
  },
  readingUnit: {
    fontFamily: t.fonts.monoMedium,
    fontSize: 14,
    color: t.colors.textMuted,
  },
  inspectionHeaderCard: {
    backgroundColor: t.colors.card,
    borderRadius: t.radius.card,
    padding: t.spacing.card,
    gap: 10,
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.shadow.card,
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
    fontSize: 11,
    lineHeight: 15,
    fontFamily: t.fonts.mono,
    letterSpacing: 1.2,
    color: t.colors.textMuted,
    textTransform: 'uppercase',
  },
  contextChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  contextChip: {
    maxWidth: '100%',
    borderRadius: t.radius.pill,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceMuted,
    paddingHorizontal: 9,
    paddingVertical: 4,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    fontFamily: t.fonts.bodySemibold,
    color: t.colors.textSecondary,
  },
  summaryMetaText: {
    fontSize: 12,
    lineHeight: 17,
    color: t.colors.textSecondary,
  },
  photoSection: {
    backgroundColor: t.colors.card,
    borderRadius: t.radius.card,
    padding: t.spacing.card,
    gap: 12,
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.shadow.card,
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
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    fontFamily: t.fonts.display,
    letterSpacing: 0.2,
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
    fontFamily: t.fonts.monoMedium,
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
    padding: 12,
    gap: 10,
    borderRadius: t.radius.control,
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
    borderRadius: t.radius.card,
    borderWidth: 1,
    borderColor: t.colors.border,
    overflow: 'hidden',
    ...t.shadow.card,
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
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.colors.primarySoft,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
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
  sectionHeaderStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionChip: {
    borderRadius: t.radius.chip,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  sectionChipText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: t.fonts.bodyBold,
    letterSpacing: 0.2,
  },
  sectionShowChecklist: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: t.colors.card,
  },
  sectionShowChecklistText: {
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.primary,
  },
  sectionDoneRow: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 12,
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
    fontFamily: t.fonts.mono,
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
  overlayStampWrap: {
    position: 'absolute',
    right: 8,
    bottom: 8,
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
  // Dark "SCAN"/capture button = solidFill (ink in light, neutral-dark in dark),
  // per the handoff's field-instrument treatment (handoff 2a + PART B gotcha).
  scanButton: {
    marginTop: 8,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: t.radius.control,
    paddingHorizontal: 14,
    backgroundColor: t.colors.solidFill,
  },
  scanButtonDisabled: {
    opacity: 0.55,
  },
  scanButtonPressed: {
    opacity: 0.85,
  },
  scanButtonIcon: {
    color: t.colors.onSolidFill,
    fontSize: 16,
    fontWeight: '700',
  },
  scanButtonText: {
    color: t.colors.onSolidFill,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: t.fonts.bodyBold,
    letterSpacing: 0.2,
  },
  // "LO" = the meter's below-range sentinel (cable under ~3 m). Warning-tinted
  // because it records a HAZARD, not a value — and filled solid once it's set.
  sentinelHint: {
    marginTop: 6,
    color: t.colors.warningText,
    fontSize: 12,
    fontWeight: '600',
    fontFamily: t.fonts.bodyBold,
  },
  sentinelButton: {
    marginTop: 8,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radius.control,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: t.colors.warningBorder,
    backgroundColor: t.colors.warningSoft,
  },
  sentinelButtonActive: {
    borderColor: t.colors.warning,
    backgroundColor: t.colors.warning,
  },
  sentinelButtonText: {
    color: t.colors.warningText,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: t.fonts.bodyBold,
  },
  sentinelButtonTextActive: {
    color: t.colors.onStatus,
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
  // "Did you mean…" correction chips under a Smart Sensor reading. Blue-tinted
  // (primary), distinct from the warning-tinted LO control, with mono numerals
  // so 6 vs 5 etc. read clearly. Selected chip fills solid.
  readingChipsWrap: {
    marginTop: 10,
  },
  readingChipsLabel: {
    marginBottom: 6,
    color: t.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    fontFamily: t.fonts.bodyBold,
  },
  readingChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  readingChip: {
    minWidth: 60,
    minHeight: 40,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radius.control,
    borderWidth: 1,
    borderColor: t.colors.primary,
    backgroundColor: t.colors.primarySoft,
  },
  readingChipSelected: {
    backgroundColor: t.colors.primary,
  },
  readingChipText: {
    color: t.colors.primary,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: t.fonts.mono,
    letterSpacing: 0.5,
  },
  readingChipTextSelected: {
    color: t.colors.onSolidFill,
  },
  // On-screen diagnostic: the raw text ML Kit returned, so a field screenshot
  // reveals what the scanner actually read on a miss (feeds OCR tuning).
  scanDiagnosticWrap: {
    marginTop: 8,
    gap: 2,
  },
  scanDiagnostic: {
    color: t.colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: t.fonts.mono,
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
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: t.fonts.bodySemibold,
    color: t.colors.textPrimary,
  },
  requiredLabel: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: t.fonts.bodyBold,
    color: t.colors.warningText,
    backgroundColor: t.colors.warningSoft,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: t.radius.chip,
    borderWidth: 1,
    borderColor: t.colors.warningBorder,
  },
  helperText: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: t.fonts.body,
    color: t.colors.textSecondary,
  },
  resultControl: {
    gap: 8,
  },
  controlLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: t.fonts.mono,
    letterSpacing: 1.2,
    color: t.colors.textMuted,
    textTransform: 'uppercase',
  },
  resultButtonRow: {
    flexDirection: 'row',
    gap: 8,
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
  // Always-visible "Declare Emergency" — soft-danger (redSoft) so it reads as a
  // present-but-not-accidental action (handoff 2a). Same handler + isTempId guard.
  declareEmergencyButton: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: t.colors.dangerSoft,
    borderRadius: t.radius.control,
    borderWidth: 1,
    borderColor: t.colors.dangerBorder,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declareEmergencyButtonPressed: {
    opacity: 0.85,
  },
  declareEmergencyEmoji: {
    fontSize: 15,
  },
  declareEmergencyButtonText: {
    fontSize: 15,
    fontWeight: '800',
    fontFamily: t.fonts.bodyBold,
    letterSpacing: 0.2,
    color: t.colors.dangerText,
  },
  imageCaptureField: {
    gap: 8,
  },
  imageDashedTile: {
    minHeight: 120,
    borderRadius: t.radius.card,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: t.colors.borderStrong,
    backgroundColor: t.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
    paddingHorizontal: 12,
  },
  imageDashedTilePressed: {
    backgroundColor: t.colors.surfacePressed,
    borderColor: t.colors.primary,
  },
  imageDashedTileText: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: t.fonts.bodyBold,
    color: t.colors.textPrimary,
  },
  imageThumbRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  imageThumbGps: {
    position: 'absolute',
    left: 4,
    top: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: t.radius.chip,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  imageThumbGpsText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '700',
    fontFamily: t.fonts.bodyBold,
    letterSpacing: 0.2,
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
    fontSize: 12,
    lineHeight: 17,
    color: t.colors.textMuted,
    textAlign: 'center',
  },
  // Pass / Fail / N-A — three big (~50px) tappable buttons on a card surface.
  // Selected = soft status fill + colored border + colored text (handoff 2a),
  // so the choice is unmistakable outdoors without a heavy solid block.
  choiceButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: t.radius.control,
    borderWidth: 1.5,
    borderColor: t.colors.border,
    backgroundColor: t.colors.card,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceButtonSelected: {
    borderColor: t.colors.primary,
    backgroundColor: t.colors.primarySoft,
  },
  choiceButtonPassSelected: {
    borderColor: t.colors.success,
    backgroundColor: t.colors.successSoft,
  },
  choiceButtonFail: {
    borderColor: t.colors.border,
  },
  choiceButtonFailSelected: {
    borderColor: t.colors.danger,
    backgroundColor: t.colors.dangerSoft,
  },
  choiceButtonNaSelected: {
    borderColor: t.colors.borderStrong,
    backgroundColor: t.colors.surfaceMuted,
  },
  choiceButtonDisabled: {
    opacity: 0.55,
  },
  choiceButtonPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  choiceButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    fontFamily: t.fonts.bodyBold,
    letterSpacing: 0.3,
    color: t.colors.textSecondary,
  },
  choiceButtonTextSelected: {
    color: t.colors.primary,
  },
  choiceButtonPassTextSelected: {
    color: t.colors.successText,
  },
  choiceButtonFailText: {
    color: t.colors.textSecondary,
  },
  choiceButtonFailTextSelected: {
    color: t.colors.dangerText,
  },
  choiceButtonNaTextSelected: {
    color: t.colors.textPrimary,
  },
  });
