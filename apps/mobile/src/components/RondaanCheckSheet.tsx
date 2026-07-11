import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { RondaanCheckIssue, RondaanCheckResult } from '@ascure/shared-utils';

interface RondaanCheckSheetProps {
  visible: boolean;
  result: RondaanCheckResult | null;
  isCompleting: boolean;
  /** Jump to the offending pole's edit screen (errors only). */
  onEditPole: (assetId: string) => void;
  onClose: () => void;
  /** Complete despite the gaps, carrying the inspector's reason to DC. */
  onAcknowledgeComplete: (note: string) => void;
}

/** The pole an ERROR anchors to (single, or the first of a duplicate pair). */
function errorAssetId(issue: RondaanCheckIssue): string | undefined {
  return issue.assetId ?? issue.assetIds?.[0];
}

/**
 * Pre-completion NO TIANG RONDAAN review. Errors (bad format / duplicate / extra
 * spaces) block completion and each links to the pole to fix; gaps (skipped or
 * missing poles) are shown as warnings the inspector confirms with a short
 * reason that travels to DC. Keeps the inspector from shipping the most common
 * sequencing mistakes to DC in the first place.
 */
export function RondaanCheckSheet({
  visible,
  result,
  isCompleting,
  onEditPole,
  onClose,
  onAcknowledgeComplete,
}: RondaanCheckSheetProps) {
  const [note, setNote] = useState('');

  useEffect(() => {
    if (visible) {
      setNote('');
    }
  }, [visible]);

  if (!result) {
    return null;
  }

  const { errors, warnings, hasErrors } = result;
  const canComplete = !hasErrors && note.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title}>Rondaan check</Text>
            <View style={[styles.pill, hasErrors ? styles.pillError : styles.pillWarn]}>
              <Text style={[styles.pillText, hasErrors ? styles.pillTextError : styles.pillTextWarn]}>
                {hasErrors
                  ? `${errors.length} to fix`
                  : `${warnings.length} to confirm`}
              </Text>
            </View>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            {hasErrors ? (
              <>
                <Text style={styles.lead}>
                  Fix these NO TIANG RONDAAN errors before completing:
                </Text>
                {errors.map((issue, index) => {
                  const assetId = errorAssetId(issue);
                  return (
                    <View key={`e-${index}`} style={[styles.row, styles.rowError]}>
                      <View style={styles.rowMain}>
                        {issue.code ? <Text style={styles.code}>{issue.code}</Text> : null}
                        <Text style={styles.msg}>{issue.message}</Text>
                      </View>
                      {assetId ? (
                        <Pressable onPress={() => onEditPole(assetId)} hitSlop={8}>
                          <Text style={styles.editLink}>Edit ›</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </>
            ) : null}

            {warnings.length > 0 ? (
              <>
                <Text style={[styles.lead, hasErrors && styles.leadSpaced]}>
                  {hasErrors ? 'Also check these gaps:' : 'Check these gaps before you finish:'}
                </Text>
                {warnings.map((issue, index) => (
                  <View key={`w-${index}`} style={[styles.row, styles.rowWarn]}>
                    <View style={styles.rowMain}>
                      <Text style={styles.msg}>{issue.message}</Text>
                    </View>
                  </View>
                ))}
              </>
            ) : null}

            {!hasErrors && warnings.length > 0 ? (
              <View style={styles.ackWrap}>
                <Text style={styles.ackLabel}>Why is there a gap? (sent to DC)</Text>
                <TextInput
                  style={styles.noteInput}
                  value={note}
                  onChangeText={setNote}
                  placeholder="e.g. pole removed / does not exist"
                  placeholderTextColor="#94A3B8"
                  multiline
                />
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            {hasErrors ? (
              <Pressable style={styles.primaryBtn} onPress={onClose} disabled={isCompleting}>
                <Text style={styles.primaryBtnText}>OK, I&rsquo;ll fix them</Text>
              </Pressable>
            ) : (
              <>
                <Pressable style={styles.cancelButton} onPress={onClose} disabled={isCompleting}>
                  <Text style={styles.cancelButtonText}>Back</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryBtn, styles.grow2, !canComplete && styles.btnDisabled]}
                  onPress={() => onAcknowledgeComplete(note.trim())}
                  disabled={!canComplete || isCompleting}
                >
                  <Text style={styles.primaryBtnText}>Complete anyway</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 20,
    maxHeight: '88%',
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#CBD5E1',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#0F172A' },
  pill: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3 },
  pillError: { backgroundColor: '#FEF2F2' },
  pillWarn: { backgroundColor: '#FFFBEB' },
  pillText: { fontSize: 11, fontWeight: '700' },
  pillTextError: { color: '#B91C1C' },
  pillTextWarn: { color: '#B45309' },
  body: { flexGrow: 0 },
  lead: { fontSize: 13.5, color: '#334155', fontWeight: '600', marginBottom: 10 },
  leadSpaced: { marginTop: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: 10,
    borderLeftWidth: 3,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  rowError: { backgroundColor: '#FEF2F2', borderLeftColor: '#DC2626' },
  rowWarn: { backgroundColor: '#FFFBEB', borderLeftColor: '#D97706' },
  rowMain: { flex: 1 },
  code: { fontSize: 14, fontWeight: '700', color: '#0F172A', marginBottom: 2 },
  msg: { fontSize: 13, color: '#334155', lineHeight: 18 },
  editLink: { fontSize: 14, fontWeight: '700', color: '#2563EB' },
  ackWrap: { marginTop: 14 },
  ackLabel: { fontSize: 13, color: '#475569', fontWeight: '600', marginBottom: 8 },
  noteInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 60,
    fontSize: 14,
    color: '#0F172A',
    textAlignVertical: 'top',
  },
  footer: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  cancelButtonText: { fontSize: 15, color: '#334155', fontWeight: '600' },
  primaryBtn: {
    flex: 1,
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow2: { flex: 2 },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontSize: 15, color: '#FFFFFF', fontWeight: '700' },
});
