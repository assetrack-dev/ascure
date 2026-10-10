"use client";

import { useMemo, useState } from "react";
import { PackageOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import {
  WHOLE_UNITS,
  fetchMaterialCatalog,
  formatQuantity,
  saveDefectMaterials,
  type DefectMaterialLine,
  type MaterialCatalogItem,
} from "@/lib/maintenance-materials";

type Draft = { key: number; materialId: string; quantity: string };

/**
 * "Bahan digunakan" on a Kejanggalan (TNB feedback #1): the TNB materials used
 * for the repair. Optional; the crew records them in the app and the office may
 * correct them here at any time (the API checks who may).
 */
export function DefectMaterialsCard({
  token,
  defectId,
  materials,
  canEdit,
  onSaved,
  onUnauthorized,
}: {
  token: string | null;
  defectId: string;
  materials: DefectMaterialLine[];
  canEdit: boolean;
  onSaved: (materials: DefectMaterialLine[]) => void;
  onUnauthorized: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [catalog, setCatalog] = useState<MaterialCatalogItem[] | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const byId = useMemo(() => new Map((catalog ?? []).map((item) => [item.id, item])), [catalog]);
  const unused = useMemo(() => {
    const taken = new Set(drafts.map((draft) => draft.materialId));
    const query = search.trim().toLowerCase();
    return (catalog ?? []).filter(
      (item) =>
        !taken.has(item.id) &&
        (!query || `${item.description} ${item.catalogueNo}`.toLowerCase().includes(query)),
    );
  }, [catalog, drafts, search]);

  const fail = (failure: unknown, fallback: string) => {
    if (failure instanceof ApiError && failure.status === 401) {
      onUnauthorized();
      return;
    }
    setError(failure instanceof Error ? failure.message : fallback);
  };

  const startEditing = async () => {
    if (!token) return;
    setError("");
    setDrafts(materials.map((line, index) => ({ key: index, materialId: line.materialId, quantity: String(line.quantity) })));
    setEditing(true);
    if (!catalog) {
      try {
        setCatalog(await fetchMaterialCatalog(token));
      } catch (failure) {
        fail(failure, "Could not load the TNB material list.");
      }
    }
  };

  const save = async () => {
    if (!token) return;
    const items: Array<{ materialId: string; quantity: number }> = [];
    for (const draft of drafts) {
      const material = byId.get(draft.materialId) ?? materials.find((line) => line.materialId === draft.materialId);
      const quantity = Number(draft.quantity);
      if (!(quantity > 0)) {
        setError(`Enter a quantity for ${material?.description ?? "each material"}.`);
        return;
      }
      if (material && WHOLE_UNITS.has(material.unit.toUpperCase()) && !Number.isInteger(quantity)) {
        setError(`${material.description} is counted in ${material.unit} — use a whole number.`);
        return;
      }
      items.push({ materialId: draft.materialId, quantity });
    }
    setIsSaving(true);
    setError("");
    try {
      const result = await saveDefectMaterials(token, defectId, items);
      onSaved(result.materials);
      setEditing(false);
    } catch (failure) {
      fail(failure, "Could not save the materials.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--foreground)]">
            <PackageOpen size={18} className="text-[var(--brand)]" />
            Bahan digunakan
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            TNB materials used for this repair — printed on the repair report and the claim summary.
          </p>
        </div>
        {canEdit && !editing ? (
          <button
            type="button"
            onClick={() => void startEditing()}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--line)] px-3 py-1.5 text-sm font-semibold text-[var(--foreground-soft)] hover:bg-[var(--panel-muted)]"
          >
            <Pencil size={14} />
            {materials.length > 0 ? "Edit" : "Add materials"}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 rounded-[var(--radius-control)] border border-[var(--critical-border)] bg-[var(--critical-bg)] px-3 py-2 text-sm text-[var(--critical-text)]">
          {error}
        </p>
      ) : null}

      {!editing ? (
        materials.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--muted)]">No materials recorded.</p>
        ) : (
          <table className="mt-4 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--muted)]">
                <th className="py-2 pr-3">No katalog</th>
                <th className="py-2 pr-3">Keterangan</th>
                <th className="py-2 pr-3">Unit</th>
                <th className="py-2 text-right">Kuantiti</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((line) => (
                <tr key={line.materialId} className="border-b border-[var(--line2)]">
                  <td className="py-2 pr-3 font-mono text-[12.5px]">{line.catalogueNo}</td>
                  <td className="py-2 pr-3">{line.description}</td>
                  <td className="py-2 pr-3">{line.unit}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">{formatQuantity(line.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : (
        <div className="mt-4 space-y-3">
          {drafts.length === 0 ? <p className="text-sm text-[var(--muted)]">No materials — add one below, or save to clear.</p> : null}
          {drafts.map((draft) => {
            const material = byId.get(draft.materialId) ?? materials.find((line) => line.materialId === draft.materialId);
            const whole = material ? WHOLE_UNITS.has(material.unit.toUpperCase()) : true;
            return (
              <div key={draft.key} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-mono text-[12px] text-[var(--muted)]">{material?.catalogueNo}</span>{" "}
                  {material?.description ?? "Material"}
                </span>
                <input
                  type="number"
                  min={whole ? 1 : 0.001}
                  step={whole ? 1 : 0.001}
                  value={draft.quantity}
                  onChange={(event) =>
                    setDrafts((current) =>
                      current.map((row) => (row.key === draft.key ? { ...row, quantity: event.target.value } : row)),
                    )
                  }
                  aria-label={`Quantity of ${material?.description ?? "material"}`}
                  className="w-24 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-right text-sm tabular-nums"
                />
                <span className="w-10 text-sm text-[var(--muted)]">{material?.unit}</span>
                <button
                  type="button"
                  aria-label="Remove material"
                  onClick={() => setDrafts((current) => current.filter((row) => row.key !== draft.key))}
                  className="rounded p-1.5 text-[var(--muted)] hover:bg-[var(--panel-muted)] hover:text-[var(--critical-text)]"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}

          <div className="rounded-[var(--radius-control)] border border-dashed border-[var(--line)] p-3">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={catalog ? `Search ${catalog.length} TNB materials…` : "Loading the TNB list…"}
              disabled={!catalog}
              className="w-full rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1.5 text-sm"
            />
            {search.trim() ? (
              <ul className="mt-2 max-h-48 overflow-y-auto">
                {unused.slice(0, 30).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setDrafts((current) => [
                          ...current,
                          { key: Date.now(), materialId: item.id, quantity: "1" },
                        ]);
                        setSearch("");
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--panel-muted)]"
                    >
                      <Plus size={13} className="text-[var(--brand)]" />
                      <span className="font-mono text-[12px] text-[var(--muted)]">{item.catalogueNo}</span>
                      <span className="flex-1">{item.description}</span>
                      <span className="text-[var(--muted)]">{item.unit}</span>
                    </button>
                  </li>
                ))}
                {unused.length === 0 ? <li className="px-2 py-1.5 text-sm text-[var(--muted)]">No match.</li> : null}
              </ul>
            ) : null}
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={isSaving}
              className="rounded-[var(--radius-control)] px-3 py-1.5 text-sm font-semibold text-[var(--foreground-soft)] hover:bg-[var(--panel-muted)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={isSaving}
              className="rounded-[var(--radius-control)] bg-[var(--brand)] px-3 py-1.5 text-sm font-semibold text-[var(--on-brand)] disabled:opacity-60"
            >
              {isSaving ? "Saving…" : "Save materials"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
