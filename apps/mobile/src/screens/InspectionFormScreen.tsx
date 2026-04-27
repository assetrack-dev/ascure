import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { captureRef } from 'react-native-view-shot';
import { Alert, Image, Modal, PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from '../api';
import {
  buildResultsPayload,
  createInitialDraftValues,
  formatDateTime,
  normalizeSelectOptions,
  validateInspectionDraft,
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
  TextField,
} from '../ui';
import {
  DraftValues,
  InspectionFormResponse,
  InspectionImageUploadInput,
  InspectionTemplateItem,
} from '../types';

type PhotoUploadState = 'uploading' | 'uploaded' | 'error';

type CapturedInspectionPhoto = InspectionImageUploadInput & {
  id: string;
  uploadedUrl?: string;
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

export function InspectionFormScreen({
  token,
  inspectionId,
  onBack,
  onSubmitted,
  onUnauthorized,
}: {
  token: string;
  inspectionId: string;
  onBack: () => void;
  onSubmitted: (successMessage: string) => void;
  onUnauthorized: (error?: unknown) => Promise<void>;
}) {
  const [form, setForm] = useState<InspectionFormResponse | null>(null);
  const [draftValues, setDraftValues] = useState<DraftValues>({});
  const [photos, setPhotos] = useState<CapturedInspectionPhoto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const [pendingOverlayPhoto, setPendingOverlayPhoto] = useState<PendingOverlayPhoto | null>(null);
  const [selectedPhotoUri, setSelectedPhotoUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const overlayCaptureRef = useRef<View>(null);
  const overlayPromiseHandlersRef = useRef<{
    resolve: (uri: string) => void;
    reject: (error: Error) => void;
  } | null>(null);

  const isSubmitted = form?.inspection.completionStatus === 'SUBMITTED';
  const isBusy = isLoading || isSubmitting || isCapturingPhoto;

  const loadForm = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      const formResponse = await api.getInspectionForm(token, inspectionId);
      setForm(formResponse);
      setDraftValues(createInitialDraftValues(formResponse));
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        await onUnauthorized(loadError);
        return;
      }

      setError(loadError instanceof Error ? loadError.message : 'Unable to load inspection form.');
    } finally {
      setIsLoading(false);
    }
  }, [inspectionId, onUnauthorized, token]);

  useEffect(() => {
    loadForm();
  }, [loadForm]);

  useEffect(() => {
    setPhotos([]);
  }, [inspectionId]);

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

  const unsupportedItems = useMemo(() => {
    if (!form) {
      return [];
    }

    return form.template.sections.flatMap((section) =>
      section.items.filter(
        (item) =>
          item.inputType !== 'TEXT' &&
          item.inputType !== 'BOOLEAN' &&
          item.inputType !== 'NUMBER' &&
          item.inputType !== 'SELECT',
      ),
    );
  }, [form]);

  function updateDraftValue(itemId: string, value: DraftValues[string]) {
    setDraftValues((current) => ({
      ...current,
      [itemId]: value,
    }));
  }

  function updatePhoto(photoId: string, changes: Partial<CapturedInspectionPhoto>) {
    setPhotos((current) =>
      current.map((photo) => (photo.id === photoId ? { ...photo, ...changes } : photo)),
    );
  }

  async function uploadPhotoInBackground(photo: CapturedInspectionPhoto) {
    try {
      const uploadedPhoto = await api.uploadInspectionImage(token, inspectionId, photo);

      updatePhoto(photo.id, {
        uploadedUrl: uploadedPhoto.url,
        uploadState: 'uploaded',
        uploadError: undefined,
      });
    } catch (uploadError) {
      if (uploadError instanceof ApiError && uploadError.status === 401) {
        updatePhoto(photo.id, {
          uploadState: 'error',
          uploadError: uploadError.message,
        });
        await onUnauthorized(uploadError);
        return;
      }

      const message =
        uploadError instanceof Error ? uploadError.message : 'Unable to upload inspection photo.';

      updatePhoto(photo.id, {
        uploadState: 'error',
        uploadError: message,
      });
      Alert.alert(
        'Photo upload failed',
        `${message}\n\nYou can continue the inspection. The local preview will stay available.`,
      );
    }
  }

  async function handleTakePhoto() {
    if (isSubmitted) {
      return;
    }

    try {
      setIsCapturingPhoto(true);
      setError(null);

      const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();

      if (!cameraPermission.granted) {
        setError('Camera permission is required to capture inspection photos.');
        return;
      }

      const isLocationEnabled = await Location.hasServicesEnabledAsync();

      if (!isLocationEnabled) {
        setError('Location services must be enabled to attach GPS to the photo.');
        return;
      }

      const locationPermission = await Location.requestForegroundPermissionsAsync();

      if (!locationPermission.granted) {
        setError('Location permission is required to attach GPS to the photo.');
        return;
      }

      const captureResult = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.7,
      });

      if (captureResult.canceled) {
        return;
      }

      const capturedAsset = captureResult.assets[0];

      if (!capturedAsset?.uri) {
        setError('Unable to read the captured photo.');
        return;
      }

      const capturedAt = new Date();
      const photoTimestamp = capturedAt.toISOString();
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
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

      const nextPhoto: CapturedInspectionPhoto = {
        id: createLocalPhotoId(photoTimestamp),
        uri: overlayImageUri,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        timestamp: photoTimestamp,
        uploadState: 'uploading',
      };

      setPhotos((current) => [...current, nextPhoto]);
      void uploadPhotoInBackground(nextPhoto);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : 'Unable to capture inspection photo.');
    } finally {
      setIsCapturingPhoto(false);
    }
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

    const validationMessage = validateInspectionDraft(form, draftValues);

    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    const { supportedResults } = buildResultsPayload(form, draftValues);

    if (supportedResults.length === 0) {
      setError('This form does not contain any supported input fields for submission.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      await api.saveInspectionResults(token, inspectionId, {
        results: supportedResults,
      });

      await api.submitInspection(token, inspectionId);

      onSubmitted('Inspection submitted successfully.');
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 401) {
        await onUnauthorized(submitError);
        return;
      }

      setError(submitError instanceof Error ? submitError.message : 'Unable to submit inspection.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen
      title="Inspection Form"
      subtitle="Complete the checklist and submit the inspection when every required item is ready."
      actions={
        <>
          <InlineButton label="Back" onPress={onBack} disabled={isSubmitting} />
          <InlineButton label="Refresh" onPress={loadForm} disabled={isBusy} />
        </>
      }
      footer={
        <>
          <ErrorBanner message={error} />
          {isSubmitted ? <SuccessBanner message="This inspection has already been submitted." /> : null}
          <AppButton
            label={isSubmitting ? 'Submitting Inspection...' : 'Submit Inspection'}
            onPress={handleSubmitInspection}
            loading={isSubmitting}
            disabled={isBusy || isSubmitted}
          />
        </>
      }
    >
      {isLoading ? <LoadingBlock label="Loading inspection form..." /> : null}

      {!isLoading && form ? (
        <>
          <Card>
            <SectionTitle>Inspection Summary</SectionTitle>
            <KeyValueRow
              label="Asset"
              value={
                form.inspection.asset.name
                  ? `${form.inspection.asset.assetCode} - ${form.inspection.asset.name}`
                  : `${form.inspection.asset.assetCode} - Unnamed asset`
              }
            />
            <KeyValueRow label="Asset Type" value={form.inspection.asset.assetType.name} />
            <KeyValueRow label="Substation" value={form.inspection.asset.substation.name} />
            <KeyValueRow label="Template" value={`${form.template.name} (v${form.template.version})`} />
            <KeyValueRow label="Cycle" value={String(form.inspection.inspectionCycle)} />
            <KeyValueRow label="Started" value={formatDateTime(form.inspection.createdAt)} />
            <StatusChip
              label={isSubmitted ? 'Completed' : 'In Progress'}
              tone={isSubmitted ? 'success' : 'warning'}
            />
          </Card>

          <Card>
            <SectionTitle>Inspection Photos</SectionTitle>
            <BodyText muted>
              Capture photos with local GPS coordinates and timestamps. Photos upload in the background after the overlay is created.
            </BodyText>
            <AppButton
              label={isCapturingPhoto ? 'Opening Camera...' : 'Take Photo'}
              onPress={handleTakePhoto}
              variant="secondary"
              loading={isCapturingPhoto}
              disabled={isBusy || isSubmitted}
            />
            {photos.length === 0 ? <BodyText muted>No photos captured yet.</BodyText> : null}
            {photos.map((photo, index) => (
              <View key={photo.id} style={styles.photoCard}>
                <Text style={styles.photoTitle}>Photo {index + 1}</Text>
                <Pressable onPress={() => setSelectedPhotoUri(photo.uri)}>
                  <Image source={{ uri: photo.uri }} style={styles.photoPreview} />
                </Pressable>
                <KeyValueRow label="Timestamp" value={formatDateTime(photo.timestamp)} />
                <KeyValueRow label="Latitude" value={formatCoordinate(photo.latitude)} />
                <KeyValueRow label="Longitude" value={formatCoordinate(photo.longitude)} />
                {photo.uploadState === 'uploading' ? <BodyText muted>Uploading to server...</BodyText> : null}
                {photo.uploadState === 'uploaded' ? <BodyText muted>Uploaded to server.</BodyText> : null}
                {photo.uploadState === 'error' ? (
                  <Text style={styles.photoUploadError}>
                    {photo.uploadError ?? 'Upload failed. The local photo preview is still available.'}
                  </Text>
                ) : null}
              </View>
            ))}
          </Card>

          {unsupportedItems.length > 0 ? (
            <Card>
              <SectionTitle>Unsupported Items</SectionTitle>
              <BodyText muted>
                The current mobile MVP only edits TEXT, BOOLEAN, NUMBER, and SELECT fields.
              </BodyText>
              {unsupportedItems.map((item) => (
                <BodyText key={item.id} muted>
                  {item.label} ({item.inputType})
                </BodyText>
              ))}
            </Card>
          ) : null}

          {form.template.sections.length === 0 ? (
            <EmptyState
              title="No checklist items"
              description="This inspection template does not contain any sections or checklist items."
            />
          ) : (
            form.template.sections.map((section) => (
              <Card key={section.id}>
                <SectionTitle>{section.title}</SectionTitle>
                {section.description ? <BodyText muted>{section.description}</BodyText> : null}
                {section.items.map((item) => (
                  <ChecklistItemCard
                    key={item.id}
                    item={item}
                    value={draftValues[item.id]}
                    disabled={Boolean(isSubmitted)}
                    onChange={(nextValue) => updateDraftValue(item.id, nextValue)}
                  />
                ))}
              </Card>
            ))
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

function ChecklistItemCard({
  item,
  value,
  disabled,
  onChange,
}: {
  item: InspectionTemplateItem;
  value: DraftValues[string];
  disabled: boolean;
  onChange: (nextValue: DraftValues[string]) => void;
}) {
  return (
    <View style={styles.itemCard}>
      <View style={styles.itemHeader}>
        <Text style={styles.itemLabel}>{item.label}</Text>
        {item.isRequired ? <Text style={styles.requiredLabel}>Required</Text> : null}
      </View>
      {item.helperText ? <Text style={styles.helperText}>{item.helperText}</Text> : null}
      {renderInput({ item, value, disabled, onChange })}
    </View>
  );
}

function renderInput({
  item,
  value,
  disabled,
  onChange,
}: {
  item: InspectionTemplateItem;
  value: DraftValues[string];
  disabled: boolean;
  onChange: (nextValue: DraftValues[string]) => void;
}) {
  if (item.inputType === 'TEXT') {
    return (
      <TextField
        label="Answer"
        value={typeof value === 'string' ? value : ''}
        onChangeText={onChange}
        placeholder="Enter text"
        editable={!disabled}
        multiline
      />
    );
  }

  if (item.inputType === 'NUMBER') {
    return (
      <TextField
        label="Answer"
        value={typeof value === 'string' ? value : ''}
        onChangeText={onChange}
        placeholder="Enter number"
        keyboardType="numeric"
        editable={!disabled}
      />
    );
  }

  if (item.inputType === 'BOOLEAN') {
    return (
      <View style={styles.booleanRow}>
        <BooleanButton
          label="Yes"
          selected={value === true}
          disabled={disabled}
          onPress={() => onChange(true)}
        />
        <BooleanButton
          label="No"
          selected={value === false}
          disabled={disabled}
          onPress={() => onChange(false)}
        />
        <BooleanButton
          label="Clear"
          selected={value === null}
          disabled={disabled}
          onPress={() => onChange(null)}
        />
      </View>
    );
  }

  if (item.inputType === 'SELECT') {
    const options = normalizeSelectOptions(item.optionsJson);

    if (options.length === 0) {
      return <BodyText muted>Select options are not configured for this item.</BodyText>;
    }

    return (
      <View style={styles.selectOptionsWrap}>
        {options.map((option) => (
          <BooleanButton
            key={option.value}
            label={option.label}
            selected={value === option.value}
            disabled={disabled}
            onPress={() => onChange(option.value)}
          />
        ))}
        <BooleanButton
          label="Clear"
          selected={value === '' || value === null}
          disabled={disabled}
          onPress={() => onChange('')}
        />
      </View>
    );
  }

  return <BodyText muted>This field type is not editable in the current mobile MVP.</BodyText>;
}

function BooleanButton({
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
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choiceButton,
        selected && styles.choiceButtonSelected,
        disabled && styles.choiceButtonDisabled,
        pressed && !disabled && styles.choiceButtonPressed,
      ]}
    >
      <Text style={[styles.choiceButtonText, selected && styles.choiceButtonTextSelected]}>{label}</Text>
    </Pressable>
  );
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
  itemCard: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#dce5f1',
    gap: 10,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
  },
  photoCard: {
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#dce5f1',
    paddingTop: 12,
  },
  photoTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  photoPreview: {
    width: '100%',
    height: 220,
    borderRadius: 14,
    backgroundColor: '#e5edf8',
  },
  photoUploadError: {
    fontSize: 13,
    lineHeight: 19,
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
  itemLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  requiredLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#b45309',
    backgroundColor: '#fef3c7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  helperText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#607086',
  },
  booleanRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  selectOptionsWrap: {
    gap: 10,
  },
  choiceButton: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#c7d5e8',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceButtonSelected: {
    borderColor: '#0f5cd8',
    backgroundColor: '#eef4ff',
  },
  choiceButtonDisabled: {
    opacity: 0.55,
  },
  choiceButtonPressed: {
    opacity: 0.92,
  },
  choiceButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#10233d',
  },
  choiceButtonTextSelected: {
    color: '#0f5cd8',
  },
});
