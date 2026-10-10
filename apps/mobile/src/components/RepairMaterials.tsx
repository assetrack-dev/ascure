import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppButton } from '../ui';
import { Theme, useTheme } from '../theme';
import type { LocalMaterials } from '../maintenance/maintenanceLocal';
import { WHOLE_UNITS, type MaterialCatalogItem, type MaterialLine } from '../maintenance/types';

type Draft = { materialId: string; quantity: string };

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

/**
 * "Bahan digunakan" on one Kejanggalan (TNB feedback #1): the TNB materials
 * used for the repair, picked from the list shipped in the work pack so it
 * works offline. Optional; the whole list is saved at once and queued.
 */
export function RepairMaterials({
  lines,
  pending,
  catalog,
  canEdit,
  onSave,
  onDismissRejected,
}: {
  lines: MaterialLine[];
  pending: LocalMaterials | null;
  catalog: MaterialCatalogItem[];
  canEdit: boolean;
  onSave: (lines: MaterialLine[]) => Promise<void>;
  onDismissRejected: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const byId = useMemo(() => {
    const map = new Map<string, MaterialCatalogItem>(catalog.map((item) => [item.id, item]));
    // A retired item already on this Kejanggalan stays editable.
    lines.forEach((line) => {
      if (!map.has(line.materialId)) {
        map.set(line.materialId, {
          id: line.materialId,
          catalogueNo: line.catalogueNo,
          description: line.description,
          unit: line.unit,
        });
      }
    });
    return map;
  }, [catalog, lines]);

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    const taken = new Set(drafts.map((draft) => draft.materialId));
    return catalog
      .filter(
        (item) =>
          !taken.has(item.id) && `${item.description} ${item.catalogueNo}`.toLowerCase().includes(query),
      )
      .slice(0, 12);
  }, [catalog, drafts, search]);

  const startEditing = () => {
    setDrafts(lines.map((line) => ({ materialId: line.materialId, quantity: formatQuantity(line.quantity) })));
    setSearch('');
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const next: MaterialLine[] = [];
    for (const draft of drafts) {
      const material = byId.get(draft.materialId);
      if (!material) continue;
      const quantity = Number(draft.quantity.replace(',', '.'));
      if (!(quantity > 0)) {
        setError(`Enter a quantity for ${material.description}.`);
        return;
      }
      if (WHOLE_UNITS.has(material.unit.toUpperCase()) && !Number.isInteger(quantity)) {
        setError(`${material.description} is counted in ${material.unit} — use a whole number.`);
        return;
      }
      next.push({
        materialId: material.id,
        catalogueNo: material.catalogueNo,
        description: material.description,
        unit: material.unit,
        quantity: Number(quantity.toFixed(3)),
      });
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSave(next);
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save the materials.');
    } finally {
      setIsSaving(false);
    }
  };

  const waiting = pending && !pending.rejectedReason && !pending.syncedAt;

  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={styles.section}>Bahan digunakan (optional)</Text>
        {canEdit && !editing && catalog.length > 0 ? (
          <Pressable onPress={startEditing} hitSlop={8}>
            <Text style={[styles.link, styles.headerLink]}>{lines.length > 0 ? 'Edit' : '+ Bahan'}</Text>
          </Pressable>
        ) : null}
      </View>

      {pending?.rejectedReason ? (
        <View style={styles.rejected}>
          <Text style={styles.rejectedText}>Materials not saved: {pending.rejectedReason}</Text>
          <Pressable onPress={onDismissRejected}>
            <Text style={styles.link}>Dismiss</Text>
          </Pressable>
        </View>
      ) : null}

      {!editing ? (
        lines.length === 0 ? (
          <Text style={styles.muted}>
            {catalog.length > 0 || !canEdit
              ? 'No materials recorded.'
              : 'Refresh this package once with signal to load the TNB materials list.'}
          </Text>
        ) : (
          <View>
            {lines.map((line) => (
              <View key={line.materialId} style={styles.lineRow}>
                <Text style={styles.lineText} numberOfLines={2}>
                  {line.description}
                  <Text style={styles.meta}>{`  ${line.catalogueNo}`}</Text>
                </Text>
                <Text style={styles.qty}>
                  {formatQuantity(line.quantity)} {line.unit}
                </Text>
              </View>
            ))}
            {waiting ? <Text style={styles.hint}>Saved on this phone — waiting to sync.</Text> : null}
          </View>
        )
      ) : (
        <View>
          {drafts.length === 0 ? (
            <Text style={styles.muted}>No materials — search below to add, or save to clear.</Text>
          ) : null}
          {drafts.map((draft) => {
            const material = byId.get(draft.materialId);
            const whole = material ? WHOLE_UNITS.has(material.unit.toUpperCase()) : true;
            return (
              <View key={draft.materialId} style={styles.lineRow}>
                <Text style={styles.lineText} numberOfLines={2}>
                  {material?.description ?? 'Material'}
                </Text>
                <TextInput
                  value={draft.quantity}
                  onChangeText={(text) =>
                    setDrafts((current) =>
                      current.map((row) => (row.materialId === draft.materialId ? { ...row, quantity: text } : row)),
                    )
                  }
                  keyboardType={whole ? 'number-pad' : 'decimal-pad'}
                  selectTextOnFocus
                  style={styles.qtyInput}
                />
                <Text style={styles.unit}>{material?.unit}</Text>
                <Pressable
                  onPress={() => setDrafts((current) => current.filter((row) => row.materialId !== draft.materialId))}
                  hitSlop={8}
                  accessibilityLabel="Remove material"
                >
                  <Feather name="trash-2" size={16} color={theme.colors.dangerText} />
                </Pressable>
              </View>
            );
          })}
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={`Search ${catalog.length} TNB materials…`}
            placeholderTextColor={theme.colors.textMuted}
            style={styles.search}
          />
          {matches.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => {
                setDrafts((current) => [...current, { materialId: item.id, quantity: '1' }]);
                setSearch('');
              }}
              style={({ pressed }) => [styles.match, pressed && styles.pressed]}
            >
              <Feather name="plus" size={14} color={theme.colors.primary} />
              <Text style={styles.lineText} numberOfLines={2}>
                {item.description}
                <Text style={styles.meta}>{`  ${item.catalogueNo}`}</Text>
              </Text>
              <Text style={styles.unit}>{item.unit}</Text>
            </Pressable>
          ))}
          {search.trim() && matches.length === 0 ? <Text style={styles.muted}>No match.</Text> : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <View style={styles.actionRow}>
            <View style={styles.flex}>
              <AppButton label="Cancel" variant="ghost" onPress={() => setEditing(false)} disabled={isSaving} />
            </View>
            <View style={styles.flex}>
              <AppButton label={isSaving ? 'Saving…' : 'Save bahan'} onPress={() => void save()} disabled={isSaving} />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    section: {
      fontFamily: theme.fonts.bodySemibold,
      fontSize: 12,
      color: theme.colors.textSecondary,
      marginTop: 14,
      marginBottom: 6,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    link: { fontFamily: theme.fonts.bodySemibold, fontSize: 13, color: theme.colors.primary },
    headerLink: { marginTop: 14, marginBottom: 6 },
    muted: { fontFamily: theme.fonts.body, fontSize: 13, color: theme.colors.textMuted },
    hint: { fontFamily: theme.fonts.body, fontSize: 12, color: theme.colors.textMuted, marginTop: 6 },
    meta: { fontFamily: theme.fonts.body, fontSize: 11, color: theme.colors.textMuted },
    lineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    lineText: { flex: 1, fontFamily: theme.fonts.body, fontSize: 14, color: theme.colors.textPrimary },
    qty: { fontFamily: theme.fonts.bodySemibold, fontSize: 14, color: theme.colors.textPrimary },
    qtyInput: {
      width: 64,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
      borderRadius: theme.radius.control,
      paddingVertical: 6,
      paddingHorizontal: 8,
      textAlign: 'right',
      fontFamily: theme.fonts.body,
      fontSize: 14,
      color: theme.colors.textPrimary,
    },
    unit: { width: 34, fontFamily: theme.fonts.body, fontSize: 12, color: theme.colors.textMuted },
    search: {
      marginTop: 10,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
      borderRadius: theme.radius.control,
      paddingVertical: 8,
      paddingHorizontal: 10,
      fontFamily: theme.fonts.body,
      fontSize: 14,
      color: theme.colors.textPrimary,
    },
    match: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 4 },
    pressed: { opacity: 0.6 },
    rejected: {
      marginBottom: 6,
      padding: 10,
      borderRadius: 8,
      backgroundColor: theme.colors.dangerSoft,
      gap: 6,
    },
    rejectedText: { fontFamily: theme.fonts.body, fontSize: 13, color: theme.colors.dangerText },
    errorText: { fontFamily: theme.fonts.body, fontSize: 13, color: theme.colors.dangerText, marginTop: 8 },
    actionRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
    flex: { flex: 1 },
  });
}
