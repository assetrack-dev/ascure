import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api, ApiError } from '../api';
import {
  AssetType,
  ChecklistTemplate,
  ChecklistTemplateItemInput,
} from '../types';

type DraftItem = {
  localId: string;
  id?: string;
  label: string;
  isRequired: boolean;
  isActive: boolean;
};

type TemplateDraft = {
  templateId?: string;
  assetType: string;
  name: string;
  isActive: boolean;
  items: DraftItem[];
};

export function ChecklistTemplateAdminScreen({
  token,
  onBack,
  onUnauthorized,
}: {
  token: string;
  onBack: () => void;
  onUnauthorized: (error?: unknown) => Promise<void>;
}) {
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([]);
  const [draft, setDraft] = useState<TemplateDraft>(() => createEmptyDraft());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const groupedTemplates = useMemo(() => {
    const groups: Record<string, ChecklistTemplate[]> = {};

    for (const template of templates) {
      const key = template.assetTypeName || template.assetTypeCode || template.assetType;
      groups[key] = [...(groups[key] ?? []), template];
    }

    return Object.entries(groups).sort(([left], [right]) => left.localeCompare(right));
  }, [templates]);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      const [templateList, assetTypeList] = await Promise.all([
        api.getChecklistTemplates(token),
        api.getAssetTypes(token),
      ]);

      setTemplates(templateList);
      setAssetTypes(assetTypeList);
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        await onUnauthorized(loadError);
        return;
      }

      setError(loadError instanceof Error ? loadError.message : 'Unable to load checklist templates.');
    } finally {
      setIsLoading(false);
    }
  }, [onUnauthorized, token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function startNewTemplate(assetTypeCode?: string) {
    setError(null);
    setSuccessMessage(null);
    setDraft(createEmptyDraft(assetTypeCode));
  }

  function editTemplate(template: ChecklistTemplate) {
    setError(null);
    setSuccessMessage(null);
    setDraft({
      templateId: template.id,
      assetType: template.assetTypeCode || template.assetType,
      name: template.name,
      isActive: template.isActive,
      items:
        template.items.length > 0
          ? template.items
              .slice()
              .sort((left, right) => left.sortOrder - right.sortOrder)
              .map((item) => ({
                localId: item.id,
                id: item.id,
                label: item.label,
                isRequired: item.isRequired,
                isActive: item.isActive,
              }))
          : [createDraftItem()],
    });
  }

  function updateDraftItem(localId: string, changes: Partial<DraftItem>) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.localId === localId ? { ...item, ...changes } : item,
      ),
    }));
  }

  function addDraftItem() {
    setDraft((current) => ({
      ...current,
      items: [...current.items, createDraftItem()],
    }));
  }

  function deactivateOrRemoveItem(localId: string) {
    setDraft((current) => {
      const targetItem = current.items.find((item) => item.localId === localId);

      if (!targetItem) {
        return current;
      }

      if (!targetItem.id) {
        return {
          ...current,
          items: current.items.filter((item) => item.localId !== localId),
        };
      }

      return {
        ...current,
        items: current.items.map((item) =>
          item.localId === localId ? { ...item, isActive: !item.isActive } : item,
        ),
      };
    });
  }

  async function saveTemplate() {
    const assetType = draft.assetType.trim();
    const name = draft.name.trim();
    const items = buildPayloadItems(draft.items);

    if (!assetType) {
      setError('Asset type is required.');
      return;
    }

    if (!name) {
      setError('Template name is required.');
      return;
    }

    if (items.some((item) => !item.label.trim())) {
      setError('Every checklist item needs a label before saving.');
      return;
    }

    if (items.filter((item) => item.isActive !== false).length === 0) {
      setError('At least one checklist item must be active.');
      return;
    }

    try {
      setIsSaving(true);
      setError(null);
      setSuccessMessage(null);

      const savedTemplate = draft.templateId
        ? await api.updateChecklistTemplate(token, draft.templateId, {
            name,
            isActive: draft.isActive,
            items,
          })
        : await api.createChecklistTemplate(token, {
            assetType,
            name,
            items,
          });

      const savedMessage =
        draft.templateId
          ? 'Checklist template saved. A new version is created when an active template changes.'
          : 'Checklist template created.';

      await loadData();
      editTemplate(savedTemplate);
      setSuccessMessage(savedMessage);
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 401) {
        await onUnauthorized(saveError);
        return;
      }

      setError(saveError instanceof Error ? saveError.message : 'Unable to save checklist template.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f4f7fb', paddingTop: 24 }}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 12, gap: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 28, fontWeight: '800', color: '#0f172a' }}>
              Checklist Templates
            </Text>
            <Text style={{ fontSize: 14, lineHeight: 20, color: '#526277' }}>
              Manage checklist rows by asset type.
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <HeaderButton label="Back" onPress={onBack} disabled={isSaving} />
            <HeaderButton label="Refresh" onPress={loadData} disabled={isSaving || isLoading} />
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {error ? (
          <View style={{ backgroundColor: '#fee2e2', borderColor: '#fecaca', borderWidth: 1, borderRadius: 14, padding: 14 }}>
            <Text style={{ color: '#991b1b', fontSize: 14, fontWeight: '700', lineHeight: 20 }}>{error}</Text>
          </View>
        ) : null}

        {successMessage ? (
          <View style={{ backgroundColor: '#dcfce7', borderColor: '#bbf7d0', borderWidth: 1, borderRadius: 14, padding: 14 }}>
            <Text style={{ color: '#166534', fontSize: 14, fontWeight: '700', lineHeight: 20 }}>
              {successMessage}
            </Text>
          </View>
        ) : null}

        {isLoading ? (
          <View style={{ paddingVertical: 32, alignItems: 'center', gap: 12 }}>
            <ActivityIndicator size="large" color="#0f5cd8" />
            <Text style={{ color: '#526277', fontSize: 15 }}>Loading checklist templates...</Text>
          </View>
        ) : null}

        {!isLoading ? (
          <>
            <View style={{ backgroundColor: '#ffffff', borderColor: '#dce5f1', borderWidth: 1, borderRadius: 16, padding: 16, gap: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <Text style={{ color: '#0f172a', fontSize: 19, fontWeight: '800' }}>
                  {draft.templateId ? 'Edit Template' : 'Add New Template'}
                </Text>
                <Pressable onPress={() => startNewTemplate()} disabled={isSaving}>
                  <Text style={{ color: '#0f5cd8', fontSize: 14, fontWeight: '800' }}>New</Text>
                </Pressable>
              </View>

              <Text style={{ color: '#10233d', fontSize: 14, fontWeight: '700' }}>Asset Type</Text>
              <TextInput
                value={draft.assetType}
                onChangeText={(assetType) => setDraft((current) => ({ ...current, assetType }))}
                placeholder="Example: SAVR"
                placeholderTextColor="#7b8aa3"
                autoCapitalize="characters"
                editable={!draft.templateId && !isSaving}
                style={{
                  minHeight: 52,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: '#c7d5e8',
                  backgroundColor: draft.templateId ? '#edf2f8' : '#ffffff',
                  paddingHorizontal: 14,
                  fontSize: 16,
                  color: '#0f172a',
                }}
              />

              {assetTypes.length > 0 && !draft.templateId ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {assetTypes.map((assetType) => (
                    <Pressable
                      key={assetType.id}
                      onPress={() => setDraft((current) => ({ ...current, assetType: assetType.code }))}
                      style={{
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: draft.assetType === assetType.code ? '#0f5cd8' : '#c7d5e8',
                        backgroundColor: draft.assetType === assetType.code ? '#eef4ff' : '#ffffff',
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                      }}
                    >
                      <Text style={{ color: '#10233d', fontSize: 13, fontWeight: '700' }}>
                        {assetType.code}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <Text style={{ color: '#10233d', fontSize: 14, fontWeight: '700' }}>Template Name</Text>
              <TextInput
                value={draft.name}
                onChangeText={(name) => setDraft((current) => ({ ...current, name }))}
                placeholder="Example: SAVR Inspection Checklist"
                placeholderTextColor="#7b8aa3"
                editable={!isSaving}
                style={{
                  minHeight: 52,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: '#c7d5e8',
                  backgroundColor: '#ffffff',
                  paddingHorizontal: 14,
                  fontSize: 16,
                  color: '#0f172a',
                }}
              />

              <View style={{ gap: 10 }}>
                <Text style={{ color: '#0f172a', fontSize: 16, fontWeight: '800' }}>Items</Text>
                {draft.items.map((item, index) => (
                  <View
                    key={item.localId}
                    style={{
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: '#dce5f1',
                      paddingTop: index === 0 ? 0 : 12,
                      gap: 10,
                    }}
                  >
                    <TextInput
                      value={item.label}
                      onChangeText={(label) => updateDraftItem(item.localId, { label })}
                      placeholder={`Item ${index + 1} label`}
                      placeholderTextColor="#7b8aa3"
                      editable={!isSaving}
                      style={{
                        minHeight: 52,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: item.isActive ? '#c7d5e8' : '#e5e7eb',
                        backgroundColor: item.isActive ? '#ffffff' : '#f8fafc',
                        paddingHorizontal: 14,
                        fontSize: 16,
                        color: item.isActive ? '#0f172a' : '#64748b',
                      }}
                    />
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      <SmallButton
                        label={item.isRequired ? 'Required' : 'Optional'}
                        onPress={() => updateDraftItem(item.localId, { isRequired: !item.isRequired })}
                        disabled={isSaving}
                      />
                      <SmallButton
                        label={item.id ? (item.isActive ? 'Deactivate' : 'Restore') : 'Remove'}
                        onPress={() => deactivateOrRemoveItem(item.localId)}
                        disabled={isSaving || draft.items.length === 1}
                      />
                    </View>
                  </View>
                ))}
              </View>

              <Pressable
                onPress={addDraftItem}
                disabled={isSaving}
                style={{
                  minHeight: 48,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: '#c8d6e8',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#ffffff',
                  opacity: isSaving ? 0.6 : 1,
                }}
              >
                <Text style={{ color: '#0f172a', fontSize: 15, fontWeight: '800' }}>Add Item</Text>
              </Pressable>

              <Pressable
                onPress={saveTemplate}
                disabled={isSaving}
                style={{
                  minHeight: 54,
                  borderRadius: 14,
                  backgroundColor: '#0f5cd8',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: isSaving ? 0.65 : 1,
                }}
              >
                {isSaving ? <ActivityIndicator color="#ffffff" /> : null}
                <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '800' }}>
                  {isSaving ? 'Saving...' : 'Save Template'}
                </Text>
              </Pressable>
            </View>

            {groupedTemplates.length === 0 ? (
              <View style={{ backgroundColor: '#eef4fb', borderColor: '#d9e4f2', borderWidth: 1, borderRadius: 16, padding: 18, gap: 8 }}>
                <Text style={{ color: '#0f172a', fontSize: 17, fontWeight: '800' }}>
                  No templates yet
                </Text>
                <Text style={{ color: '#526277', fontSize: 14, lineHeight: 21 }}>
                  Create the first checklist template for an asset type.
                </Text>
              </View>
            ) : null}

            {groupedTemplates.map(([assetType, groupTemplates]) => (
              <View key={assetType} style={{ gap: 10 }}>
                <Text style={{ color: '#0f172a', fontSize: 20, fontWeight: '800' }}>{assetType}</Text>
                {groupTemplates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    isSelected={draft.templateId === template.id}
                    onEdit={() => editTemplate(template)}
                  />
                ))}
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function TemplateCard({
  template,
  isSelected,
  onEdit,
}: {
  template: ChecklistTemplate;
  isSelected: boolean;
  onEdit: () => void;
}) {
  const activeItems = template.items
    .filter((item) => item.isActive)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const preview = activeItems.slice(0, 4).map((item) => item.label).join(', ');

  return (
    <View
      style={{
        backgroundColor: '#ffffff',
        borderColor: isSelected ? '#0f5cd8' : '#dce5f1',
        borderWidth: 1,
        borderRadius: 16,
        padding: 16,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: '#0f172a', fontSize: 17, fontWeight: '800' }}>
            {template.assetTypeCode || template.assetType}
          </Text>
          <Text style={{ color: '#10233d', fontSize: 15, fontWeight: '700' }}>
            {template.name} v{template.version}
          </Text>
        </View>
        <View
          style={{
            alignSelf: 'flex-start',
            borderRadius: 999,
            backgroundColor: template.isActive ? '#dcfce7' : '#e5edf8',
            paddingHorizontal: 10,
            paddingVertical: 6,
          }}
        >
          <Text
            style={{
              color: template.isActive ? '#166534' : '#1e293b',
              fontSize: 12,
              fontWeight: '800',
            }}
          >
            {template.isActive ? 'Active' : 'Inactive'}
          </Text>
        </View>
      </View>
      <Text style={{ color: '#607086', fontSize: 14, lineHeight: 20 }}>
        {activeItems.length} active item{activeItems.length === 1 ? '' : 's'}
      </Text>
      <Text style={{ color: '#10233d', fontSize: 14, lineHeight: 21 }}>
        {preview || 'No active items'}
      </Text>
      <Pressable
        onPress={onEdit}
        style={{
          minHeight: 46,
          borderRadius: 12,
          backgroundColor: '#e5edf8',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: '#10233d', fontSize: 15, fontWeight: '800' }}>Edit</Text>
      </Pressable>
    </View>
  );
}

function HeaderButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled}>
      <Text style={{ color: disabled ? '#94a3b8' : '#0f5cd8', fontSize: 15, fontWeight: '800' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function SmallButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#c7d5e8',
        backgroundColor: '#ffffff',
        paddingHorizontal: 12,
        paddingVertical: 8,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Text style={{ color: '#10233d', fontSize: 13, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  );
}

function buildPayloadItems(items: DraftItem[]): ChecklistTemplateItemInput[] {
  return items.map((item, index) => ({
    id: item.id,
    label: item.label.trim(),
    sortOrder: index + 1,
    isRequired: item.isRequired,
    isActive: item.isActive,
  }));
}

function createEmptyDraft(assetType = ''): TemplateDraft {
  return {
    assetType,
    name: '',
    isActive: true,
    items: [createDraftItem()],
  };
}

function createDraftItem(): DraftItem {
  return {
    localId: `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: '',
    isRequired: true,
    isActive: true,
  };
}
