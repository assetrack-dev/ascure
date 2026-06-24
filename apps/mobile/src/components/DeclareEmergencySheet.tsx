import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export interface EmergencyMedia {
  uri: string;
  contentType: string;
  kind: 'photo' | 'video';
}

interface DeclareEmergencySheetProps {
  visible: boolean;
  isSending: boolean;
  onCancel: () => void;
  onSend: (payload: { note: string; media: EmergencyMedia | null }) => void;
}

// Placeholder list — to be replaced with the owner's real common critical issues.
const EMERGENCY_CHIPS = [
  'Conductor down',
  'Pole leaning',
  'Live wire exposed',
  'Burning / spark',
  'NCV: live current',
];

export function DeclareEmergencySheet({
  visible,
  isSending,
  onCancel,
  onSend,
}: DeclareEmergencySheetProps) {
  const [selectedChips, setSelectedChips] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [media, setMedia] = useState<EmergencyMedia | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  // Reset whenever the sheet is opened so a previous draft never lingers.
  useEffect(() => {
    if (visible) {
      setSelectedChips([]);
      setNote('');
      setMedia(null);
      setCaptureError(null);
    }
  }, [visible]);

  function toggleChip(chip: string) {
    setSelectedChips((current) =>
      current.includes(chip)
        ? current.filter((value) => value !== chip)
        : [...current, chip],
    );
  }

  function buildNote() {
    return [selectedChips.join(', '), note.trim()].filter(Boolean).join(' — ');
  }

  async function capture(kind: 'photo' | 'video') {
    setCaptureError(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setCaptureError('Camera permission is required.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync(
        kind === 'video'
          ? {
              mediaTypes: ImagePicker.MediaTypeOptions.Videos,
              videoMaxDuration: 30,
              quality: 0.7,
            }
          : {
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              allowsEditing: false,
              quality: 0.7,
            },
      );

      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];
      if (!asset?.uri) {
        setCaptureError('Could not read the captured file.');
        return;
      }

      const contentType =
        kind === 'video'
          ? asset.uri.toLowerCase().endsWith('.mov')
            ? 'video/quicktime'
            : 'video/mp4'
          : 'image/jpeg';

      setMedia({ uri: asset.uri, contentType, kind });
    } catch {
      setCaptureError('Capture failed. Try again.');
    }
  }

  function handleSend() {
    const finalNote = buildNote();
    if (!finalNote) {
      setCaptureError('Pick an issue or add a short note first.');
      return;
    }

    Alert.alert(
      'Report emergency?',
      'This alerts the response team immediately and cannot be undone. Only use it for a genuine, dangerous-to-public condition.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report emergency',
          style: 'destructive',
          onPress: () => onSend({ note: finalNote, media }),
        },
      ],
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title}>Report Emergency</Text>
            <View style={styles.criticalPill}>
              <Text style={styles.criticalPillText}>CRITICAL</Text>
            </View>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>What happened?</Text>
            <View style={styles.chipWrap}>
              {EMERGENCY_CHIPS.map((chip) => {
                const active = selectedChips.includes(chip);
                return (
                  <Pressable
                    key={chip}
                    onPress={() => toggleChip(chip)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {chip}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <TextInput
              style={styles.noteInput}
              value={note}
              onChangeText={setNote}
              placeholder="Add detail (optional)…"
              placeholderTextColor="#94A3B8"
              multiline
            />

            <Text style={styles.label}>Evidence</Text>
            <View style={styles.captureRow}>
              <Pressable style={styles.captureButton} onPress={() => capture('photo')}>
                <Text style={styles.captureButtonText}>
                  {media?.kind === 'photo' ? '✓ Photo' : 'Photo'}
                </Text>
              </Pressable>
              <Pressable style={styles.captureButton} onPress={() => capture('video')}>
                <Text style={styles.captureButtonText}>
                  {media?.kind === 'video' ? '✓ Video' : 'Video (30s)'}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.helper}>
              Photo or a short video (max 30s) — e.g. an NCV live-current check.
            </Text>

            {captureError ? <Text style={styles.error}>{captureError}</Text> : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable style={styles.cancelButton} onPress={onCancel} disabled={isSending}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.sendButton, isSending && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={isSending}
            >
              {isSending ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.sendButtonText}>Send emergency</Text>
              )}
            </Pressable>
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
  title: { fontSize: 18, fontWeight: '700', color: '#B91C1C' },
  criticalPill: {
    backgroundColor: '#7F1D1D',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  criticalPillText: { color: '#FEE2E2', fontSize: 11, fontWeight: '700' },
  body: { flexGrow: 0 },
  label: { fontSize: 13, color: '#475569', fontWeight: '600', marginBottom: 8, marginTop: 6 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  chipActive: { borderColor: '#B91C1C', backgroundColor: '#FEF2F2' },
  chipText: { fontSize: 13, color: '#475569' },
  chipTextActive: { color: '#B91C1C', fontWeight: '600' },
  noteInput: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 64,
    fontSize: 14,
    color: '#0F172A',
    textAlignVertical: 'top',
  },
  captureRow: { flexDirection: 'row', gap: 10 },
  captureButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  captureButtonText: { fontSize: 14, color: '#334155', fontWeight: '600' },
  helper: { fontSize: 12, color: '#64748B', marginTop: 8 },
  error: { fontSize: 13, color: '#B91C1C', marginTop: 10 },
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
  sendButton: {
    flex: 2,
    backgroundColor: '#B91C1C',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.6 },
  sendButtonText: { fontSize: 15, color: '#FFFFFF', fontWeight: '700' },
});
