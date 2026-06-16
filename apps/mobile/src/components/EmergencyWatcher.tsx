import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { navigateToDefect } from '../navigation/navigationRef';
import { getAvailableMobileWorkspaces } from '../operationalWorkspace';
import { Theme, useTheme } from '../theme';
import type { EmergencyFeedItem } from '../types';

const POLL_INTERVAL_MS = 25000;

/**
 * App-wide watcher for the maintenance team. While the app is open it polls the
 * active-emergency feed and, the moment a NEW emergency defect is flagged by an
 * inspector, buzzes the device and raises an unmissable banner. Only maintenance
 * users (MAINTENANCE capability / ADMIN) are watched. This is the in-app
 * "immediate response" channel; true background push is a planned fast-follow.
 */
export function EmergencyWatcher() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { token, user } = useAuth();
  const [activeAlert, setActiveAlert] = useState<EmergencyFeedItem | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const baselinedRef = useRef(false);
  const isMaintainerRef = useRef(false);

  // Reset and re-evaluate maintenance relevance whenever the user changes.
  useEffect(() => {
    seenIdsRef.current = new Set();
    baselinedRef.current = false;
    isMaintainerRef.current = false;
    setActiveAlert(null);

    if (!token || !user) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const capabilities = await api.getMyCapabilities(token);

        if (cancelled) {
          return;
        }

        const workspaces = getAvailableMobileWorkspaces(user, capabilities);
        isMaintainerRef.current = workspaces.some(
          (workspace) => workspace.id === 'MAINTENANCE',
        );
      } catch {
        // Best-effort — if the capability lookup fails, stay silent.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, user]);

  const poll = useCallback(async () => {
    if (!token || !isMaintainerRef.current) {
      return;
    }

    try {
      const feed = await api.getActiveEmergencies(token);

      // The first successful poll only establishes a baseline — pre-existing
      // emergencies aren't "new" and already show at the top of the workspace.
      if (!baselinedRef.current) {
        feed.emergencies.forEach((item) => seenIdsRef.current.add(item.id));
        baselinedRef.current = true;
        return;
      }

      const fresh = feed.emergencies.filter(
        (item) => !seenIdsRef.current.has(item.id),
      );
      fresh.forEach((item) => seenIdsRef.current.add(item.id));

      if (fresh.length > 0) {
        Vibration.vibrate([0, 400, 200, 400]);
        setActiveAlert(fresh[0]);
      }
    } catch {
      // Transient network / auth errors are swallowed; the next tick retries.
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void poll();
      }
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [poll, token]);

  if (!activeAlert) {
    return null;
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => setActiveAlert(null)}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.siren}>🚨</Text>
            <Text style={styles.title}>Emergency Defect</Text>
          </View>
          <Text style={styles.assetCode}>
            {activeAlert.assetCode || 'Unknown asset'}
          </Text>
          <Text style={styles.label} numberOfLines={3}>
            {activeAlert.label}
          </Text>
          {activeAlert.location ? (
            <Text style={styles.location} numberOfLines={2}>
              {activeAlert.location}
            </Text>
          ) : null}
          <Text style={styles.subtitle}>
            Flagged dangerous to public — respond immediately.
          </Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setActiveAlert(null)}
              style={({ pressed }) => [
                styles.dismissButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.dismissText}>Dismiss</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const target = activeAlert.id;
                setActiveAlert(null);
                navigateToDefect(target);
              }}
              style={({ pressed }) => [
                styles.viewButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.viewText}>View</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      width: '100%',
      maxWidth: 420,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: t.colors.danger,
      backgroundColor: t.colors.card,
      padding: 18,
      gap: 8,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    siren: {
      fontSize: 22,
    },
    title: {
      fontSize: 16,
      fontWeight: '900',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      color: t.colors.danger,
    },
    assetCode: {
      fontSize: 20,
      fontWeight: '800',
      color: t.colors.textPrimary,
    },
    label: {
      fontSize: 15,
      lineHeight: 21,
      fontWeight: '700',
      color: t.colors.textPrimary,
    },
    location: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
      color: t.colors.textSecondary,
    },
    subtitle: {
      marginTop: 2,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
      color: t.colors.danger,
    },
    actions: {
      marginTop: 10,
      flexDirection: 'row',
      gap: 10,
    },
    dismissButton: {
      flex: 1,
      minHeight: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surfaceMuted,
    },
    dismissText: {
      fontSize: 15,
      fontWeight: '800',
      color: t.colors.textPrimary,
    },
    viewButton: {
      flex: 1,
      minHeight: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.colors.danger,
    },
    viewText: {
      fontSize: 15,
      fontWeight: '800',
      color: t.colors.textOnPrimary,
    },
    pressed: {
      opacity: 0.9,
    },
  });
