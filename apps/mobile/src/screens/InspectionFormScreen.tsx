import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
import { DraftValues, InspectionFormResponse, InspectionTemplateItem } from '../types';

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
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSubmitted = form?.inspection.completionStatus === 'SUBMITTED';
  const isBusy = isLoading || isSubmitting;

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
            <KeyValueRow label="Asset" value={`${form.inspection.asset.code} - ${form.inspection.asset.name}`} />
            <KeyValueRow label="Asset Type" value={form.inspection.asset.assetType.name} />
            <KeyValueRow label="Substation" value={form.inspection.asset.substation.name} />
            <KeyValueRow label="Template" value={`${form.template.name} (v${form.template.version})`} />
            <KeyValueRow label="Cycle" value={String(form.inspection.inspectionCycle)} />
            <KeyValueRow label="Started" value={formatDateTime(form.inspection.createdAt)} />
            {form.inspection.asset.serialNumber ? (
              <KeyValueRow label="Serial Number" value={form.inspection.asset.serialNumber} />
            ) : null}
            <StatusChip
              label={isSubmitted ? 'Completed' : 'In Progress'}
              tone={isSubmitted ? 'success' : 'warning'}
            />
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
