import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../api';
import { setItemWithRecovery } from '../deviceStorage';
import type {
  MaintenanceCategory,
  RepairStage,
  WorkKejanggalan,
  WorkPackageDetail,
  WorkPhoto,
  WorkState,
} from './types';

/**
 * The crew's own, not-yet-confirmed repair work, kept on the device so a pole
 * shows what was done even with no signal (docs/PLAN-maintenance-flow.md §7.1).
 *
 * The server work pack (cached by cachedFetch) is the truth; this store only
 * OVERLAYS it: repair photos taken here (queued or uploaded but not yet in a
 * fresh pack) and a queued "done / cannot repair". Entries drop away once a
 * fresh pack shows the server has them.
 *
 * Plus new Kejanggalan the crew added on site (plan §13) until the server pack
 * carries them: shown as normal Kejanggalan, keyed by a temp defect id that is
 * swapped for the real one when the queued add syncs.
 */

const STORAGE_KEY = '@ascure/mobile/maintenance-local/v1';

export type LocalRepairPhoto = {
  id: string;
  defectId: string;
  stage: RepairStage;
  /** Durable local file (stamped). */
  uri: string;
  takenAt: string;
  latitude: number | null;
  longitude: number | null;
  /** Set once the queued upload succeeded (server evidence id). */
  uploadedEvidenceId?: string;
  /** Set when the server permanently refused the upload. */
  rejectedReason?: string;
};

export type LocalCompletion = {
  defectId: string;
  resolutionOutcome: string;
  notes: string | null;
  queuedAt: string;
  rejectedReason?: string;
};

export type LocalFinding = {
  /** Temp defect id minted on the phone (`temp_defect_…`). */
  tempId: string;
  /** The server's defect id once the queued add synced. */
  realId?: string;
  siteVisitId: string;
  assetId: string;
  label: string;
  remark: string | null;
  severity: string;
  category: MaintenanceCategory;
  addedAt: string;
  /** Set when the server refused the add (e.g. the pole went to another team). */
  rejectedReason?: string;
};

export type Store = {
  photos: LocalRepairPhoto[];
  completions: LocalCompletion[];
  findings: LocalFinding[];
};

const EMPTY_STORE: Store = { photos: [], completions: [], findings: [] };

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');

/** Server photo paths are origin-relative (`/uploads/...`). */
export function toAbsoluteUrl(url: string) {
  if (/^[a-z][a-z\d+\-.]*:/i.test(url)) return url;
  return `${API_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
}

let chain: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

async function load(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STORE;
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      photos: Array.isArray(parsed.photos) ? parsed.photos : [],
      completions: Array.isArray(parsed.completions) ? parsed.completions : [],
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    };
  } catch {
    return EMPTY_STORE;
  }
}

/** Serialized read-modify-write so concurrent sync + UI writes can't clobber. */
function update(mutator: (store: Store) => Store): Promise<Store> {
  const next = chain.then(async () => {
    const store = mutator(await load());
    await setItemWithRecovery(STORAGE_KEY, JSON.stringify(store));
    listeners.forEach((listener) => listener());
    return store;
  });
  chain = next.catch(() => undefined);
  return next;
}

export function subscribeMaintenanceLocal(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function loadMaintenanceLocal() {
  return load();
}

export function addLocalPhoto(photo: LocalRepairPhoto) {
  return update((store) => ({ ...store, photos: [...store.photos, photo] }));
}

export function markLocalPhotoUploaded(photoId: string, evidenceId: string) {
  return update((store) => ({
    ...store,
    photos: store.photos.map((photo) =>
      photo.id === photoId ? { ...photo, uploadedEvidenceId: evidenceId } : photo,
    ),
  }));
}

export function markLocalPhotoRejected(photoId: string, reason: string) {
  return update((store) => ({
    ...store,
    photos: store.photos.map((photo) =>
      photo.id === photoId ? { ...photo, rejectedReason: reason } : photo,
    ),
  }));
}

export function addLocalFinding(finding: LocalFinding) {
  return update((store) => ({ ...store, findings: [...store.findings, finding] }));
}

/**
 * The queued add synced: point the finding — and the photos / completion the
 * crew already recorded against its temp id — at the server's defect id.
 */
export function markLocalFindingSynced(tempId: string, realId: string) {
  const swap = (id: string) => (id === tempId ? realId : id);
  return update((store) => ({
    photos: store.photos.map((photo) => ({ ...photo, defectId: swap(photo.defectId) })),
    completions: store.completions.map((item) => ({ ...item, defectId: swap(item.defectId) })),
    findings: store.findings.map((finding) =>
      finding.tempId === tempId ? { ...finding, realId } : finding,
    ),
  }));
}

export function markLocalFindingRejected(tempId: string, reason: string) {
  return update((store) => ({
    ...store,
    findings: store.findings.map((finding) =>
      finding.tempId === tempId ? { ...finding, rejectedReason: reason } : finding,
    ),
  }));
}

/** Drop a refused finding and everything recorded on it. Returns its photo files. */
export async function removeLocalFinding(tempId: string): Promise<string[]> {
  const files: string[] = [];
  await update((store) => ({
    photos: store.photos.filter((photo) => {
      if (photo.defectId !== tempId) return true;
      files.push(photo.uri);
      return false;
    }),
    completions: store.completions.filter((item) => item.defectId !== tempId),
    findings: store.findings.filter((finding) => finding.tempId !== tempId),
  }));
  return files;
}

/**
 * The crew's added Kejanggalan on one pole that the cached pack does not carry
 * yet, shaped like server ones so the pole screen treats them the same.
 */
export function pendingFindingItems(
  store: Store,
  pack: WorkPackageDetail,
  assetId: string,
): Array<WorkKejanggalan & { localFinding: LocalFinding }> {
  const inPack = new Set(pack.poles.flatMap((pole) => pole.kejanggalan.map((item) => item.id)));
  return store.findings
    .filter(
      (finding) =>
        finding.siteVisitId === pack.siteVisitId &&
        finding.assetId === assetId &&
        !(finding.realId && inPack.has(finding.realId)),
    )
    .map((finding) => ({
      id: finding.realId ?? finding.tempId,
      label: finding.label,
      remark: finding.remark,
      severity: finding.severity,
      isEmergency: false,
      category: finding.category,
      state: 'TODO' as const,
      lifecycleStatus: null,
      resolutionOutcome: null,
      cannotRepair: false,
      maintenanceNotes: null,
      submittedAt: null,
      team: null,
      sentBackReason: null,
      dueDate: null,
      surveyedAt: null,
      surveyPhotos: [],
      photos: { BEFORE: [], DURING: [], AFTER: [] },
      isNewFinding: true,
      addedBy: null,
      addedAt: finding.addedAt,
      localFinding: finding,
    }));
}

export function removeLocalPhoto(photoId: string) {
  return update((store) => ({
    ...store,
    photos: store.photos.filter((photo) => photo.id !== photoId),
  }));
}

export function addLocalCompletion(completion: LocalCompletion) {
  return update((store) => ({
    ...store,
    completions: [
      ...store.completions.filter((item) => item.defectId !== completion.defectId),
      completion,
    ],
  }));
}

export function markLocalCompletionRejected(defectId: string, reason: string) {
  return update((store) => ({
    ...store,
    completions: store.completions.map((item) =>
      item.defectId === defectId ? { ...item, rejectedReason: reason } : item,
    ),
  }));
}

export function dismissLocalCompletion(defectId: string) {
  return update((store) => ({
    ...store,
    completions: store.completions.filter((item) => item.defectId !== defectId),
  }));
}

/**
 * Drop overlay entries a fresh server pack already reflects: uploaded photos the
 * server now lists, and completions the server shows as submitted / closed.
 * Returns the local files that are safe to delete.
 */
export async function reconcileWithPack(pack: WorkPackageDetail): Promise<string[]> {
  const serverEvidence = new Set<string>();
  const doneOnServer = new Set<string>();
  const inPack = new Set<string>();
  for (const pole of pack.poles) {
    for (const item of pole.kejanggalan) {
      inPack.add(item.id);
      (['BEFORE', 'DURING', 'AFTER'] as RepairStage[]).forEach((stage) =>
        item.photos[stage].forEach((photo) => serverEvidence.add(photo.id)),
      );
      if (item.state === 'SUBMITTED' || item.state === 'CLOSED') {
        doneOnServer.add(item.id);
      }
    }
  }

  const removable: string[] = [];
  await update((store) => ({
    // A synced finding the server pack now carries needs no local copy.
    findings: store.findings.filter(
      (finding) => !(finding.realId && inPack.has(finding.realId) && !finding.rejectedReason),
    ),
    photos: store.photos.filter((photo) => {
      const confirmed =
        inPack.has(photo.defectId) &&
        photo.uploadedEvidenceId !== undefined &&
        serverEvidence.has(photo.uploadedEvidenceId);
      if (confirmed) removable.push(photo.uri);
      return !confirmed;
    }),
    completions: store.completions.filter(
      (item) => !(doneOnServer.has(item.defectId) && !item.rejectedReason),
    ),
  }));
  return removable;
}

export type OverlaidKejanggalan = WorkKejanggalan & {
  /** Server + local photos per stage; local ones carry `local: true`. */
  allPhotos: Record<RepairStage, Array<WorkPhoto & { local?: boolean; pending?: boolean; rejectedReason?: string }>>;
  pendingCompletion: LocalCompletion | null;
  displayState: WorkState;
};

/** One Kejanggalan as the crew should see it: server state + their local work. */
export function overlayKejanggalan(item: WorkKejanggalan, store: Store): OverlaidKejanggalan {
  const serverIds = new Set<string>();
  const allPhotos = { BEFORE: [], DURING: [], AFTER: [] } as OverlaidKejanggalan['allPhotos'];
  (['BEFORE', 'DURING', 'AFTER'] as RepairStage[]).forEach((stage) => {
    item.photos[stage].forEach((photo) => {
      serverIds.add(photo.id);
      allPhotos[stage].push({ ...photo, url: toAbsoluteUrl(photo.url) });
    });
  });
  for (const photo of store.photos) {
    if (photo.defectId !== item.id) continue;
    if (photo.uploadedEvidenceId && serverIds.has(photo.uploadedEvidenceId)) continue;
    allPhotos[photo.stage].push({
      id: photo.id,
      url: photo.uri,
      takenAt: photo.takenAt,
      local: true,
      pending: !photo.uploadedEvidenceId,
      rejectedReason: photo.rejectedReason,
    });
  }

  const pendingCompletion = store.completions.find((entry) => entry.defectId === item.id) ?? null;
  const hasStarted = allPhotos.BEFORE.length + allPhotos.DURING.length + allPhotos.AFTER.length > 0;
  const displayState: WorkState =
    pendingCompletion && !pendingCompletion.rejectedReason && item.state !== 'CLOSED'
      ? 'SUBMITTED'
      : item.state === 'TODO' && hasStarted
        ? 'IN_PROGRESS'
        : item.state;

  return { ...item, allPhotos, pendingCompletion, displayState };
}
