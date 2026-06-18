import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { api, ApiError } from './api';
import { getInspectionQueueStatusGroup } from './operationalWorkspace';
import {
  Asset,
  InspectionFormResponse,
  InspectionImageUploadInput,
  SaveInspectionItemResultInput,
  SaveInspectionResultItemInput,
  SiteVisit,
} from './types';

const QUEUE_STORAGE_KEY = '@ascure/mobile/offline-inspection-queue/v1';
const OFFLINE_PHOTO_DIRECTORY = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}ascure-offline-inspection-images/`
  : null;
const COMPLETED_HISTORY_LIMIT = 20;

export type SyncQueueStatus = 'PENDING_SYNC' | 'SYNCING' | 'FAILED';

export type CompletedSyncStatus = 'COMPLETED';

export type SyncQueueDisplayStatus = SyncQueueStatus | CompletedSyncStatus;

// === Generic offline mutation queue (offline CREATEs) ============================
// A second, generic queue that sits ALONGSIDE the inspection-submission and
// visit-completion queues (which are untouched). It records create operations
// performed while offline (a new asset, a new inspection) and replays them in
// dependency order when connectivity returns, mapping the temporary local id
// each create minted to the real server id. Downstream queued work (e.g. an
// inspection-submission keyed on a temp inspectionId) resolves through the same
// `tempIdMap`.

export type OfflineMutationType = 'CREATE_ASSET' | 'CREATE_INSPECTION';

export type OfflineMutation = {
  id: string;
  type: OfflineMutationType;
  status: SyncQueueStatus;
  // Body for the api.* create call. String fields equal to a temp id are
  // rewritten to the real id (via tempIdMap) at sync time.
  payload: Record<string, unknown>;
  // Temp ids this op's payload references and that must be resolved before it
  // can run (e.g. a CREATE_INSPECTION on an offline-created asset depends on
  // that asset's temp id).
  dependsOn: string[];
  // The temp entity id this create MINTED — mapped to the real server id on
  // success so dependents can resolve it.
  tempId: string;
  label: string;
  sublabel?: string;
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  errorMessage?: string;
};

const TEMP_ID_PREFIX = 'temp_';
let localIdCounter = 0;

function nextLocalSuffix() {
  localIdCounter += 1;
  return `${Date.now().toString(36)}_${localIdCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Mint a temp id for an entity created offline. Recognizable via isTempId(). */
export function mintTempId(entity: 'asset' | 'inspection') {
  return `${TEMP_ID_PREFIX}${entity}_${nextLocalSuffix()}`;
}

/** True for an id that was minted offline and not yet reconciled to a real id. */
export function isTempId(id: string | null | undefined): id is string {
  return typeof id === 'string' && id.startsWith(TEMP_ID_PREFIX);
}

/** Resolve a (possibly temp) id to its real server id once reconciled. */
export function resolveTempId(tempIdMap: Record<string, string>, id: string): string {
  return isTempId(id) && tempIdMap[id] ? tempIdMap[id] : id;
}

export type QueueableInspectionPhoto = InspectionImageUploadInput & {
  id: string;
  uploadedImageId?: string;
  uploadedUrl?: string;
  url?: string;
  uploadError?: string;
};

export type QueuedInspectionPhoto = InspectionImageUploadInput & {
  id: string;
  originalUri?: string;
  uploadedImageId?: string;
  uploadedUrl?: string;
  uploadError?: string;
  queuedAt: string;
  uploadedAt?: string;
};

export type OfflineInspectionPayload = {
  results: SaveInspectionResultItemInput[];
  items: SaveInspectionItemResultInput[];
};

export type VisitCompletionPayload = {
  completedAt: string;
  completionNotes?: string;
};

export type QueuedInspectionSummary = {
  inspectionId: string;
  siteVisitId: string;
  assetId: string;
  operationalSessionId?: string | null;
  templateId: string;
  inspectionCycle: number;
  assetCode: string;
  assetName: string | null;
  assetTypeName: string;
  substationName: string;
  teamName: string;
  templateName: string;
  templateVersion: number;
};

export type OfflineInspectionQueueItem = {
  id: string;
  status: SyncQueueStatus;
  summary: QueuedInspectionSummary;
  payload: OfflineInspectionPayload;
  photos: QueuedInspectionPhoto[];
  createdAt: string;
  updatedAt: string;
  lastAttemptAt?: string;
  attemptCount: number;
  errorMessage?: string;
};

export type CompletedInspectionSyncRecord = {
  id: string;
  status: CompletedSyncStatus;
  summary: QueuedInspectionSummary;
  queuedAt: string;
  completedAt: string;
  attemptCount: number;
  photoCount: number;
};

export type QueuedVisitCompletionSummary = {
  siteVisitId: string;
  substationCode: string;
  substationName: string;
  teamName: string;
  startedAt: string;
  totalAssets: number;
  inspectedAssets: number;
  pendingAssets: number;
  defectsFound: number;
  completionPercentage: number;
};

export type OfflineVisitCompletionQueueItem = {
  id: string;
  status: SyncQueueStatus;
  summary: QueuedVisitCompletionSummary;
  payload: VisitCompletionPayload;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt?: string;
  attemptCount: number;
  errorMessage?: string;
};

export type CompletedVisitCompletionSyncRecord = {
  id: string;
  status: CompletedSyncStatus;
  summary: QueuedVisitCompletionSummary;
  queuedAt: string;
  completedAt: string;
  attemptCount: number;
};

export type SyncQueueSnapshot = {
  items: OfflineInspectionQueueItem[];
  completed: CompletedInspectionSyncRecord[];
  visitCompletions: OfflineVisitCompletionQueueItem[];
  completedVisitCompletions: CompletedVisitCompletionSyncRecord[];
  // Generic offline create queue + the temp-id -> real-id reconciliation table.
  mutations: OfflineMutation[];
  tempIdMap: Record<string, string>;
};

export type SyncQueueRunResult = {
  completed: number;
  failed: number;
  skipped: number;
};

type StoredQueue = SyncQueueSnapshot & {
  schemaVersion: 1;
};

type SyncQueueListener = (snapshot: SyncQueueSnapshot) => void;

const listeners = new Set<SyncQueueListener>();
let storageUpdateChain: Promise<SyncQueueSnapshot> = Promise.resolve({
  items: [],
  completed: [],
  visitCompletions: [],
  completedVisitCompletions: [],
  mutations: [],
  tempIdMap: {},
});
let activeSyncPromise: Promise<SyncQueueRunResult> | null = null;

export function subscribeSyncQueue(listener: SyncQueueListener) {
  listeners.add(listener);
  void loadSyncQueueSnapshot().then(listener).catch(() => listener(createEmptySnapshot()));

  return () => {
    listeners.delete(listener);
  };
}

export async function loadSyncQueueSnapshot(): Promise<SyncQueueSnapshot> {
  await storageUpdateChain.catch(() => createEmptyStoredQueue());

  const storedQueue = await loadStoredQueue();

  return {
    items: storedQueue.items,
    completed: storedQueue.completed,
    visitCompletions: storedQueue.visitCompletions,
    completedVisitCompletions: storedQueue.completedVisitCompletions,
    mutations: storedQueue.mutations,
    tempIdMap: storedQueue.tempIdMap,
  };
}

export function getActiveQueueCount(snapshot: SyncQueueSnapshot) {
  return snapshot.items.length + snapshot.visitCompletions.length + snapshot.mutations.length;
}

export function getFailedQueueCount(snapshot: SyncQueueSnapshot) {
  return (
    snapshot.items.filter((item) => item.status === 'FAILED').length +
    snapshot.visitCompletions.filter((item) => item.status === 'FAILED').length +
    snapshot.mutations.filter((item) => item.status === 'FAILED').length
  );
}

export function getPendingQueueCount(snapshot: SyncQueueSnapshot) {
  return (
    snapshot.items.filter((item) => item.status === 'PENDING_SYNC').length +
    snapshot.visitCompletions.filter((item) => item.status === 'PENDING_SYNC').length +
    snapshot.mutations.filter((item) => item.status === 'PENDING_SYNC').length
  );
}

export function getSyncingQueueCount(snapshot: SyncQueueSnapshot) {
  return (
    snapshot.items.filter((item) => item.status === 'SYNCING').length +
    snapshot.visitCompletions.filter((item) => item.status === 'SYNCING').length +
    snapshot.mutations.filter((item) => item.status === 'SYNCING').length
  );
}

export function getCompletedQueueCount(snapshot: SyncQueueSnapshot) {
  return snapshot.completed.length + snapshot.completedVisitCompletions.length;
}

export function hasQueuedVisitCompletion(snapshot: SyncQueueSnapshot, siteVisitId: string) {
  return snapshot.visitCompletions.some((item) => item.summary.siteVisitId === siteVisitId);
}

export function isRetryableSyncError(error: unknown) {
  if (error instanceof ApiError) {
    // status 0 = couldn't reach the server (network failure / request timeout,
    // thrown by api.ts request()) — retryable, like a true offline error.
    return (
      error.status === 0 ||
      error.status === 408 ||
      error.status === 429 ||
      error.status >= 500
    );
  }

  return true;
}

export async function persistCapturedInspectionPhoto(photo: QueueableInspectionPhoto) {
  return {
    ...photo,
    uri: await persistPhotoUri(photo.uri, photo.id),
  };
}

export async function enqueueInspectionSubmission({
  form,
  payload,
  photos,
  errorMessage,
}: {
  form: InspectionFormResponse;
  payload: OfflineInspectionPayload;
  photos: QueueableInspectionPhoto[];
  errorMessage?: string;
}) {
  const now = new Date().toISOString();
  const queuedPhotos = await Promise.all(photos.map((photo) => createQueuedPhoto(photo, now)));
  const summary = createInspectionSummary(form);

  return updateStoredQueue((queue) => {
    const existingIndex = queue.items.findIndex((item) => item.id === form.inspection.id);
    const existing = existingIndex >= 0 ? queue.items[existingIndex] : null;
    const nextItem: OfflineInspectionQueueItem = {
      id: form.inspection.id,
      status: 'PENDING_SYNC',
      summary,
      payload,
      photos: mergeQueuedPhotos(existing?.photos ?? [], queuedPhotos),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastAttemptAt: existing?.lastAttemptAt,
      attemptCount: existing?.attemptCount ?? 0,
      errorMessage,
    };

    const items =
      existingIndex >= 0
        ? queue.items.map((item, index) => (index === existingIndex ? nextItem : item))
        : [nextItem, ...queue.items];

    return {
      ...queue,
      items,
      completed: queue.completed.filter((record) => record.id !== nextItem.id),
    };
  });
}

export async function enqueueVisitCompletion({
  visit,
  assets,
  payload,
  errorMessage,
}: {
  visit: SiteVisit;
  assets: Asset[];
  payload: VisitCompletionPayload;
  errorMessage?: string;
}) {
  const now = new Date().toISOString();
  const summary = createVisitCompletionSummary(visit, assets);

  return updateStoredQueue((queue) => {
    const existingIndex = queue.visitCompletions.findIndex(
      (item) => item.summary.siteVisitId === visit.id,
    );
    const existing = existingIndex >= 0 ? queue.visitCompletions[existingIndex] : null;
    const nextItem: OfflineVisitCompletionQueueItem = {
      id: visit.id,
      status: 'PENDING_SYNC',
      summary,
      payload,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastAttemptAt: existing?.lastAttemptAt,
      attemptCount: existing?.attemptCount ?? 0,
      errorMessage,
    };

    const visitCompletions =
      existingIndex >= 0
        ? queue.visitCompletions.map((item, index) =>
            index === existingIndex ? nextItem : item,
          )
        : [nextItem, ...queue.visitCompletions];

    return {
      ...queue,
      visitCompletions,
      completedVisitCompletions: queue.completedVisitCompletions.filter(
        (record) => record.id !== nextItem.id,
      ),
    };
  });
}

export async function enqueueMutation(input: {
  type: OfflineMutationType;
  payload: Record<string, unknown>;
  tempId: string;
  dependsOn?: string[];
  label: string;
  sublabel?: string;
}): Promise<OfflineMutation> {
  const now = new Date().toISOString();
  const mutation: OfflineMutation = {
    id: `op_${nextLocalSuffix()}`,
    type: input.type,
    status: 'PENDING_SYNC',
    payload: input.payload,
    dependsOn: input.dependsOn ?? [],
    tempId: input.tempId,
    label: input.label,
    sublabel: input.sublabel,
    createdAt: now,
    updatedAt: now,
    attemptCount: 0,
  };

  await updateStoredQueue((queue) => ({
    ...queue,
    mutations: [...queue.mutations, mutation],
  }));

  return mutation;
}

async function getMutationItem(mutationId: string) {
  const queue = await loadSyncQueueSnapshot();

  return queue.mutations.find((mutation) => mutation.id === mutationId) ?? null;
}

async function markMutationSyncing(mutationId: string) {
  const now = new Date().toISOString();

  await updateStoredQueue((queue) => ({
    ...queue,
    mutations: queue.mutations.map((mutation) =>
      mutation.id === mutationId
        ? {
            ...mutation,
            status: 'SYNCING',
            updatedAt: now,
            attemptCount: mutation.attemptCount + 1,
            errorMessage: undefined,
          }
        : mutation,
    ),
  }));
}

async function markMutationFailed(mutationId: string, errorMessage: string) {
  const now = new Date().toISOString();

  await updateStoredQueue((queue) => ({
    ...queue,
    mutations: queue.mutations.map((mutation) =>
      mutation.id === mutationId
        ? { ...mutation, status: 'FAILED', updatedAt: now, errorMessage }
        : mutation,
    ),
  }));
}

async function completeMutation(mutationId: string, tempId: string, realId: string) {
  await updateStoredQueue((queue) => ({
    ...queue,
    mutations: queue.mutations.filter((mutation) => mutation.id !== mutationId),
    tempIdMap: { ...queue.tempIdMap, [tempId]: realId },
  }));
}

function resolveTempIdsInPayload(
  payload: Record<string, unknown>,
  tempIdMap: Record<string, string>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    resolved[key] = typeof value === 'string' ? resolveTempId(tempIdMap, value) : value;
  }

  return resolved;
}

function mutationDependenciesResolved(
  mutation: OfflineMutation,
  tempIdMap: Record<string, string>,
) {
  return mutation.dependsOn.every((tempId) => Boolean(tempIdMap[tempId]));
}

async function syncMutationItem(token: string, mutation: OfflineMutation) {
  await markMutationSyncing(mutation.id);

  try {
    const tempIdMap = (await loadSyncQueueSnapshot()).tempIdMap;

    // Idempotency: if a prior pass already reconciled this temp id (e.g. the
    // success write raced / partially applied), adopt the mapping instead of
    // recreating a duplicate on the server.
    const alreadyMapped = tempIdMap[mutation.tempId];
    if (alreadyMapped) {
      await completeMutation(mutation.id, mutation.tempId, alreadyMapped);
      return;
    }

    const payload = resolveTempIdsInPayload(mutation.payload, tempIdMap);
    let realId: string | undefined;

    if (mutation.type === 'CREATE_ASSET') {
      try {
        const created = await api.createAsset(
          token,
          payload as unknown as Parameters<typeof api.createAsset>[1],
        );
        realId = created.id;
      } catch (error) {
        // At-least-once recovery: a prior attempt may have actually created the
        // asset before its response was lost (timeout). On a duplicate/conflict,
        // adopt the existing server row so the dependent inspection + its field
        // data can reconcile instead of being stranded in the queue forever.
        if (isAlreadyExistsError(error)) {
          realId = (await findExistingAssetId(token, payload)) ?? undefined;
        }

        if (!realId) {
          throw error;
        }
      }
    } else {
      const created = await api.createInspection(
        token,
        payload as unknown as Parameters<typeof api.createInspection>[1],
      );
      realId = created.id;
    }

    if (!realId) {
      throw new ApiError('Offline create returned no id.', 0, null);
    }

    await completeMutation(mutation.id, mutation.tempId, realId);
  } catch (error) {
    await markMutationFailed(mutation.id, getErrorMessage(error));
    throw error;
  }
}

function isAlreadyExistsError(error: unknown) {
  if (!(error instanceof ApiError)) {
    return false;
  }

  if (error.status === 409) {
    return true;
  }

  const message = (error.message ?? '').toLowerCase();

  return message.includes('already exists') || message.includes('duplicate');
}

async function findExistingAssetId(
  token: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const substationId = payload.substationId;
  const assetCode = payload.assetCode;

  if (typeof substationId !== 'string' || typeof assetCode !== 'string') {
    return null;
  }

  try {
    const assets = await api.getAssets(token, substationId);

    return assets.find((asset) => asset.assetCode === assetCode)?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Drop an unsynced offline asset's queued create (and any queued inspection that
 * depends on it) — used when the crew deletes a pole that only exists locally.
 */
export async function dropOfflineAssetCreate(tempAssetId: string) {
  await updateStoredQueue((queue) => ({
    ...queue,
    mutations: queue.mutations.filter(
      (mutation) => mutation.tempId !== tempAssetId && !mutation.dependsOn.includes(tempAssetId),
    ),
    items: queue.items.filter((item) => item.summary.assetId !== tempAssetId),
  }));
}

export async function syncQueuedInspections(token: string): Promise<SyncQueueRunResult> {
  if (activeSyncPromise) {
    return activeSyncPromise;
  }

  activeSyncPromise = runSyncQueue(token).finally(() => {
    activeSyncPromise = null;
  });

  return activeSyncPromise;
}

export async function cleanupLocalInspectionPhotos(photos: QueueableInspectionPhoto[]) {
  await Promise.all(
    photos.map((photo) =>
      deleteOfflinePhoto(photo.uri).catch(() => {
        return undefined;
      }),
    ),
  );
}

async function runSyncQueue(token: string): Promise<SyncQueueRunResult> {
  const snapshot = await loadSyncQueueSnapshot();
  const mutationCandidateIds = snapshot.mutations.map((mutation) => mutation.id);
  const candidateIds = snapshot.items.map((item) => item.id);
  const visitCompletionCandidateIds = snapshot.visitCompletions.map((item) => item.id);
  const result: SyncQueueRunResult = {
    completed: 0,
    failed: 0,
    skipped: 0,
  };

  // 1) Offline creates first, in insertion (dependency) order, so the temp -> real
  //    id map is populated before any dependent op or inspection submission runs.
  for (const mutationId of mutationCandidateIds) {
    const mutation = await getMutationItem(mutationId);

    if (!mutation) {
      result.skipped += 1;
      continue;
    }

    const tempIdMap = (await loadSyncQueueSnapshot()).tempIdMap;

    if (!mutationDependenciesResolved(mutation, tempIdMap)) {
      // A producer this op depends on hasn't synced yet — leave it pending so it
      // retries on the next pass once its dependency resolves.
      result.skipped += 1;
      continue;
    }

    try {
      await syncMutationItem(token, mutation);
      result.completed += 1;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw error;
      }

      result.failed += 1;
    }
  }

  // 2) Inspection submissions. An offline-created inspection carries a temp
  //    inspectionId — resolve it to the real id; if its CREATE_INSPECTION hasn't
  //    synced yet, skip (it retries next pass).
  for (const itemId of candidateIds) {
    const item = await getQueueItem(itemId);

    if (!item) {
      result.skipped += 1;
      continue;
    }

    const tempIdMap = (await loadSyncQueueSnapshot()).tempIdMap;
    const inspectionId = resolveTempId(tempIdMap, item.summary.inspectionId);

    if (isTempId(inspectionId)) {
      result.skipped += 1;
      continue;
    }

    try {
      await syncQueueItem(token, item, inspectionId);
      result.completed += 1;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw error;
      }

      result.failed += 1;
    }
  }

  for (const itemId of visitCompletionCandidateIds) {
    const item = await getVisitCompletionQueueItem(itemId);

    if (!item) {
      result.skipped += 1;
      continue;
    }

    if (await hasBlockingInspectionQueueItem(item.summary.siteVisitId)) {
      result.skipped += 1;
      continue;
    }

    try {
      await syncVisitCompletionQueueItem(token, item);
      result.completed += 1;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw error;
      }

      result.failed += 1;
    }
  }

  return result;
}

async function syncQueueItem(
  token: string,
  item: OfflineInspectionQueueItem,
  inspectionId: string,
) {
  await markItemSyncing(item.id);

  try {
    await api.saveInspectionResults(token, inspectionId, item.payload);

    let currentItem = (await getQueueItem(item.id)) ?? item;

    for (const photo of currentItem.photos) {
      if (photo.uploadedImageId || photo.uploadedUrl) {
        continue;
      }

      const uploadedImage = await api.uploadInspectionImage(token, inspectionId, photo);

      await updateQueuedPhoto(currentItem.id, photo.id, {
        uploadedImageId: uploadedImage.id,
        uploadedUrl: uploadedImage.url,
        uploadError: undefined,
        uploadedAt: new Date().toISOString(),
      });
      currentItem = (await getQueueItem(item.id)) ?? currentItem;
    }

    await api.submitInspection(token, inspectionId);
    await completeQueueItem(item.id);
  } catch (error) {
    if (isAlreadySubmittedError(error)) {
      await completeQueueItem(item.id);
      return;
    }

    // Visit closed before this queued edit could sync — it can never apply, so
    // drop it rather than retry forever (see isVisitClosedError).
    if (isVisitClosedError(error)) {
      await completeQueueItem(item.id);
      return;
    }

    await markItemFailed(item.id, getErrorMessage(error));
    throw error;
  }
}

async function syncVisitCompletionQueueItem(
  token: string,
  item: OfflineVisitCompletionQueueItem,
) {
  await markVisitCompletionItemSyncing(item.id);

  try {
    await api.completeSiteVisit(token, item.summary.siteVisitId, item.payload);
    await completeVisitCompletionQueueItem(item.id);
  } catch (error) {
    if (await isVisitAlreadyCompleted(token, item, error)) {
      await completeVisitCompletionQueueItem(item.id);
      return;
    }

    await markVisitCompletionItemFailed(item.id, getErrorMessage(error));
    throw error;
  }
}

async function markItemSyncing(itemId: string) {
  const now = new Date().toISOString();

  await updateStoredQueue((queue) => ({
    ...queue,
    items: queue.items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            status: 'SYNCING',
            updatedAt: now,
            lastAttemptAt: now,
            attemptCount: item.attemptCount + 1,
            errorMessage: undefined,
          }
        : item,
    ),
  }));
}

async function markVisitCompletionItemSyncing(itemId: string) {
  const now = new Date().toISOString();

  await updateStoredQueue((queue) => ({
    ...queue,
    visitCompletions: queue.visitCompletions.map((item) =>
      item.id === itemId
        ? {
            ...item,
            status: 'SYNCING',
            updatedAt: now,
            lastAttemptAt: now,
            attemptCount: item.attemptCount + 1,
            errorMessage: undefined,
          }
        : item,
    ),
  }));
}

async function markItemFailed(itemId: string, errorMessage: string) {
  const now = new Date().toISOString();

  await updateStoredQueue((queue) => ({
    ...queue,
    items: queue.items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            status: 'FAILED',
            updatedAt: now,
            errorMessage,
          }
        : item,
    ),
  }));
}

async function markVisitCompletionItemFailed(itemId: string, errorMessage: string) {
  const now = new Date().toISOString();

  await updateStoredQueue((queue) => ({
    ...queue,
    visitCompletions: queue.visitCompletions.map((item) =>
      item.id === itemId
        ? {
            ...item,
            status: 'FAILED',
            updatedAt: now,
            errorMessage,
          }
        : item,
    ),
  }));
}

async function updateQueuedPhoto(
  itemId: string,
  photoId: string,
  changes: Partial<QueuedInspectionPhoto>,
) {
  const now = new Date().toISOString();

  await updateStoredQueue((queue) => ({
    ...queue,
    items: queue.items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            updatedAt: now,
            photos: item.photos.map((photo) =>
              photo.id === photoId ? { ...photo, ...changes } : photo,
            ),
          }
        : item,
    ),
  }));
}

async function completeQueueItem(itemId: string) {
  let completedItem: OfflineInspectionQueueItem | null = null;
  let photosToClean: QueuedInspectionPhoto[] = [];

  await updateStoredQueue((queue) => {
    completedItem = queue.items.find((item) => item.id === itemId) ?? null;

    if (!completedItem) {
      return queue;
    }

    photosToClean = completedItem.photos;

    const completedRecord: CompletedInspectionSyncRecord = {
      id: completedItem.id,
      status: 'COMPLETED',
      summary: completedItem.summary,
      queuedAt: completedItem.createdAt,
      completedAt: new Date().toISOString(),
      attemptCount: completedItem.attemptCount,
      photoCount: completedItem.photos.length,
    };

    return {
      ...queue,
      items: queue.items.filter((item) => item.id !== itemId),
      completed: [completedRecord, ...queue.completed.filter((record) => record.id !== itemId)].slice(
        0,
        COMPLETED_HISTORY_LIMIT,
      ),
    };
  });

  if (photosToClean.length > 0) {
    await cleanupQueuedPhotoFiles(photosToClean);
  }
}

async function completeVisitCompletionQueueItem(itemId: string) {
  await updateStoredQueue((queue) => {
    const completedItem = queue.visitCompletions.find((item) => item.id === itemId) ?? null;

    if (!completedItem) {
      return queue;
    }

    const completedRecord: CompletedVisitCompletionSyncRecord = {
      id: completedItem.id,
      status: 'COMPLETED',
      summary: completedItem.summary,
      queuedAt: completedItem.createdAt,
      completedAt: new Date().toISOString(),
      attemptCount: completedItem.attemptCount,
    };

    return {
      ...queue,
      visitCompletions: queue.visitCompletions.filter((item) => item.id !== itemId),
      completedVisitCompletions: [
        completedRecord,
        ...queue.completedVisitCompletions.filter((record) => record.id !== itemId),
      ].slice(0, COMPLETED_HISTORY_LIMIT),
    };
  });
}

async function getQueueItem(itemId: string) {
  const queue = await loadSyncQueueSnapshot();

  return queue.items.find((item) => item.id === itemId) ?? null;
}

async function getVisitCompletionQueueItem(itemId: string) {
  const queue = await loadSyncQueueSnapshot();

  return queue.visitCompletions.find((item) => item.id === itemId) ?? null;
}

async function hasBlockingInspectionQueueItem(siteVisitId: string) {
  const queue = await loadSyncQueueSnapshot();

  return queue.items.some((item) => item.summary.siteVisitId === siteVisitId);
}

async function createQueuedPhoto(photo: QueueableInspectionPhoto, queuedAt: string) {
  const persistedUri = await persistPhotoUri(photo.uri, photo.id);

  return {
    id: photo.id,
    uri: persistedUri,
    originalUri: photo.uri,
    latitude: photo.latitude,
    longitude: photo.longitude,
    timestamp: photo.timestamp,
    type: photo.type,
    templateItemId: photo.templateItemId,
    uploadedImageId: photo.uploadedImageId,
    uploadedUrl: photo.uploadedUrl ?? photo.url,
    uploadError: photo.uploadError,
    queuedAt,
  } satisfies QueuedInspectionPhoto;
}

async function persistPhotoUri(uri: string, photoId: string) {
  if (!OFFLINE_PHOTO_DIRECTORY || uri.startsWith(OFFLINE_PHOTO_DIRECTORY)) {
    return uri;
  }

  const targetUri = `${OFFLINE_PHOTO_DIRECTORY}${sanitizeFilename(photoId)}.jpg`;

  try {
    await FileSystem.makeDirectoryAsync(OFFLINE_PHOTO_DIRECTORY, { intermediates: true });
    await FileSystem.copyAsync({
      from: uri,
      to: targetUri,
    });

    return targetUri;
  } catch {
    return uri;
  }
}

async function cleanupQueuedPhotoFiles(photos: QueuedInspectionPhoto[]) {
  await Promise.all(
    photos.map((photo) =>
      deleteOfflinePhoto(photo.uri).catch(() => {
        return undefined;
      }),
    ),
  );
}

async function deleteOfflinePhoto(uri: string) {
  if (!OFFLINE_PHOTO_DIRECTORY || !uri.startsWith(OFFLINE_PHOTO_DIRECTORY)) {
    return;
  }

  await FileSystem.deleteAsync(uri, { idempotent: true });
}

function mergeQueuedPhotos(
  existingPhotos: QueuedInspectionPhoto[],
  nextPhotos: QueuedInspectionPhoto[],
) {
  const byId = new Map(existingPhotos.map((photo) => [photo.id, photo]));

  for (const photo of nextPhotos) {
    const existing = byId.get(photo.id);

    byId.set(photo.id, existing ? { ...existing, ...photo } : photo);
  }

  return Array.from(byId.values());
}

function createInspectionSummary(form: InspectionFormResponse): QueuedInspectionSummary {
  return {
    inspectionId: form.inspection.id,
    siteVisitId: form.inspection.siteVisitId,
    assetId: form.inspection.assetId,
    operationalSessionId: form.inspection.operationalSessionId ?? null,
    templateId: form.inspection.templateId,
    inspectionCycle: form.inspection.inspectionCycle,
    assetCode: form.inspection.asset.assetCode,
    assetName: form.inspection.asset.name,
    assetTypeName: form.inspection.asset.assetType.name,
    substationName: form.inspection.asset.substation.name,
    teamName: form.inspection.siteVisit.team.name,
    templateName: form.template.name,
    templateVersion: form.template.version,
  };
}

function createVisitCompletionSummary(
  visit: SiteVisit,
  assets: Asset[],
): QueuedVisitCompletionSummary {
  const rollup = createVisitRollup(visit, assets);

  return {
    siteVisitId: visit.id,
    substationCode: visit.substation.code,
    substationName: visit.substation.name,
    teamName: visit.team.name,
    startedAt: visit.startedAt,
    totalAssets: rollup.totalAssets,
    inspectedAssets: rollup.inspectedAssets,
    pendingAssets: rollup.pendingAssets,
    defectsFound: rollup.defectsFound,
    completionPercentage: rollup.completionPercentage,
  };
}

function createVisitRollup(visit: SiteVisit, assets: Asset[]) {
  const totalAssets = getNumericRollupValue(visit.summary?.totalAssets, visit.totalAssets) ?? assets.length;
  const inspectedAssets =
    getNumericRollupValue(visit.summary?.inspectedAssets, visit.inspectedAssets) ??
    getSubmittedInspectionAssetIds(visit).size;
  const pendingAssets =
    getNumericRollupValue(visit.summary?.pendingAssets, visit.pendingAssets) ??
    Math.max(totalAssets - inspectedAssets, 0);
  const defectsFound = getNumericRollupValue(visit.summary?.defectsFound, visit.defectsFound) ?? 0;
  const completionPercentage =
    getNumericRollupValue(visit.summary?.completionPercentage, visit.completionPercentage) ??
    (totalAssets === 0 ? 0 : Math.round((inspectedAssets / totalAssets) * 100));

  return {
    totalAssets,
    inspectedAssets,
    pendingAssets,
    defectsFound,
    completionPercentage,
  };
}

function getSubmittedInspectionAssetIds(visit: SiteVisit) {
  const assetIds = new Set<string>();

  for (const inspection of visit.inspections ?? []) {
    if (
      getInspectionQueueStatusGroup(inspection.completionStatus) === 'COMPLETED' ||
      inspection.submittedAt
    ) {
      assetIds.add(inspection.assetId);
    }
  }

  return assetIds;
}

function getNumericRollupValue(...values: Array<number | undefined>) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

async function loadStoredQueue(): Promise<StoredQueue> {
  const rawValue = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);

  if (!rawValue) {
    return createEmptyStoredQueue();
  }

  try {
    const parsedValue = JSON.parse(rawValue) as Partial<StoredQueue>;

    return {
      schemaVersion: 1,
      items: Array.isArray(parsedValue.items)
        ? parsedValue.items.filter(isOfflineInspectionQueueItem)
        : [],
      completed: Array.isArray(parsedValue.completed)
        ? parsedValue.completed.filter(isCompletedInspectionSyncRecord)
        : [],
      visitCompletions: Array.isArray(parsedValue.visitCompletions)
        ? parsedValue.visitCompletions.filter(isOfflineVisitCompletionQueueItem)
        : [],
      completedVisitCompletions: Array.isArray(parsedValue.completedVisitCompletions)
        ? parsedValue.completedVisitCompletions.filter(isCompletedVisitCompletionSyncRecord)
        : [],
      mutations: Array.isArray(parsedValue.mutations)
        ? parsedValue.mutations.filter(isOfflineMutation)
        : [],
      tempIdMap:
        parsedValue.tempIdMap && typeof parsedValue.tempIdMap === 'object'
          ? (parsedValue.tempIdMap as Record<string, string>)
          : {},
    };
  } catch {
    return createEmptyStoredQueue();
  }
}

function updateStoredQueue(updater: (queue: StoredQueue) => StoredQueue | SyncQueueSnapshot) {
  storageUpdateChain = storageUpdateChain.catch(() => createEmptyStoredQueue()).then(async () => {
    const currentQueue = await loadStoredQueue();
    const updatedSnapshot = updater(currentQueue);
    const updatedQueue: StoredQueue = {
      schemaVersion: 1,
      items: updatedSnapshot.items,
      completed: updatedSnapshot.completed,
      visitCompletions: updatedSnapshot.visitCompletions,
      completedVisitCompletions: updatedSnapshot.completedVisitCompletions,
      mutations: updatedSnapshot.mutations,
      tempIdMap: updatedSnapshot.tempIdMap,
    };

    await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(updatedQueue));
    notifySyncQueueListeners(updatedQueue);

    return {
      items: updatedQueue.items,
      completed: updatedQueue.completed,
      visitCompletions: updatedQueue.visitCompletions,
      completedVisitCompletions: updatedQueue.completedVisitCompletions,
      mutations: updatedQueue.mutations,
      tempIdMap: updatedQueue.tempIdMap,
    };
  });

  return storageUpdateChain;
}

function notifySyncQueueListeners(snapshot: SyncQueueSnapshot) {
  for (const listener of listeners) {
    listener({
      items: snapshot.items,
      completed: snapshot.completed,
      visitCompletions: snapshot.visitCompletions,
      completedVisitCompletions: snapshot.completedVisitCompletions,
      mutations: snapshot.mutations,
      tempIdMap: snapshot.tempIdMap,
    });
  }
}

function createEmptyStoredQueue(): StoredQueue {
  return {
    schemaVersion: 1,
    items: [],
    completed: [],
    visitCompletions: [],
    completedVisitCompletions: [],
    mutations: [],
    tempIdMap: {},
  };
}

function createEmptySnapshot(): SyncQueueSnapshot {
  return {
    items: [],
    completed: [],
    visitCompletions: [],
    completedVisitCompletions: [],
    mutations: [],
    tempIdMap: {},
  };
}

function isOfflineInspectionQueueItem(value: unknown): value is OfflineInspectionQueueItem {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Partial<OfflineInspectionQueueItem>;

  return (
    typeof item.id === 'string' &&
    isSyncQueueStatus(item.status) &&
    Boolean(item.summary) &&
    Boolean(item.payload) &&
    Array.isArray(item.photos)
  );
}

function isCompletedInspectionSyncRecord(
  value: unknown,
): value is CompletedInspectionSyncRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Partial<CompletedInspectionSyncRecord>;

  return (
    typeof record.id === 'string' &&
    record.status === 'COMPLETED' &&
    Boolean(record.summary) &&
    typeof record.completedAt === 'string'
  );
}

function isOfflineVisitCompletionQueueItem(
  value: unknown,
): value is OfflineVisitCompletionQueueItem {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Partial<OfflineVisitCompletionQueueItem>;

  return (
    typeof item.id === 'string' &&
    isSyncQueueStatus(item.status) &&
    Boolean(item.summary) &&
    Boolean(item.payload)
  );
}

function isCompletedVisitCompletionSyncRecord(
  value: unknown,
): value is CompletedVisitCompletionSyncRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Partial<CompletedVisitCompletionSyncRecord>;

  return (
    typeof record.id === 'string' &&
    record.status === 'COMPLETED' &&
    Boolean(record.summary) &&
    typeof record.completedAt === 'string'
  );
}

function isSyncQueueStatus(value: unknown): value is SyncQueueStatus {
  return value === 'PENDING_SYNC' || value === 'SYNCING' || value === 'FAILED';
}

function isOfflineMutation(value: unknown): value is OfflineMutation {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const mutation = value as Partial<OfflineMutation>;

  return (
    typeof mutation.id === 'string' &&
    (mutation.type === 'CREATE_ASSET' || mutation.type === 'CREATE_INSPECTION') &&
    isSyncQueueStatus(mutation.status) &&
    typeof mutation.tempId === 'string' &&
    Boolean(mutation.payload) &&
    Array.isArray(mutation.dependsOn)
  );
}

async function isVisitAlreadyCompleted(
  token: string,
  item: OfflineVisitCompletionQueueItem,
  error: unknown,
) {
  if (!(error instanceof ApiError) || error.status !== 400) {
    return false;
  }

  const message = error.message.toLowerCase();

  if (!message.includes('completed')) {
    return false;
  }

  try {
    const visit = await api.getSiteVisit(token, item.summary.siteVisitId);

    return visit.status === 'COMPLETED';
  } catch {
    return false;
  }
}

function isAlreadySubmittedError(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 400) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes('already been submitted') ||
    message.includes('submitted inspections cannot be modified')
  );
}

// The owning Pencawang/site visit was Completed or Cancelled before this
// offline edit could sync, so the server (assertVisitEditable) permanently
// rejects it — it can never apply. Recognise it as terminal so the queue drops
// it instead of retrying every pass and inflating the failed badge. Keep this
// substring in sync with the API message in inspections.service.ts.
function isVisitClosedError(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 400) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes('site visit has been completed') ||
    message.includes('no longer be edited')
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Unable to sync inspection. Please retry when the connection is stable.';
}

function sanitizeFilename(value: string) {
  return value.replace(/[^0-9A-Za-z_-]/g, '-').slice(0, 90) || String(Date.now());
}
