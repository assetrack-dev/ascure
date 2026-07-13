import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { DrawerContentComponentProps } from '@react-navigation/drawer';
import { api, ApiError } from '../api';
import { getActiveQueueCount } from '../syncQueue';
import { useSession } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { Theme, useTheme, useThemeControls } from '../theme';
import type { Team } from '../types';
import type { AppDrawerParamList } from './types';

type DrawerRouteName = keyof AppDrawerParamList;
type FeatherName = keyof typeof Feather.glyphMap;

const NAV_ITEMS: { label: string; route: DrawerRouteName; icon: FeatherName }[] = [
  { label: 'Visits', route: 'Home', icon: 'clipboard' },
  { label: 'Dashboard', route: 'Dashboard', icon: 'bar-chart-2' },
  { label: 'Map', route: 'AssetMap', icon: 'map' },
  { label: 'Defects', route: 'DefectList', icon: 'alert-triangle' },
  { label: 'Sync Queue', route: 'SyncQueue', icon: 'upload-cloud' },
];

/** First initials from a name — for the identity avatar. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AppDrawerContent({ navigation, state }: DrawerContentComponentProps) {
  const { token, user, handleUnauthorized, signOut } = useSession();
  const { snapshot, forceOffline, setWorkOffline } = useSync();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { mode, toggle } = useThemeControls();
  const [teams, setTeams] = useState<Team[]>([]);
  const activeRouteName = state.routeNames[state.index] as DrawerRouteName;
  const activeSyncCount = getActiveQueueCount(snapshot);

  useEffect(() => {
    let isMounted = true;

    async function loadTeams() {
      try {
        const teamList = await api.getTeams(token);

        if (isMounted) {
          setTeams(teamList);
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await handleUnauthorized(error);
        }
      }
    }

    loadTeams();

    return () => {
      isMounted = false;
    };
  }, [handleUnauthorized, token]);

  return (
    <View style={styles.drawerPanel}>
      <ScrollView contentContainerStyle={styles.drawerContent}>
        <View style={styles.drawerHeader}>
          <Text style={styles.drawerTitle}>Menu</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close menu"
            onPress={() => navigation.closeDrawer()}
            style={({ pressed }) => [styles.drawerCloseButton, pressed && styles.drawerItemPressed]}
          >
            <Feather name="x" size={18} color={theme.colors.onChrome} />
          </Pressable>
        </View>

        {/* Identity card: avatar (solid fill) + name + email + team code. */}
        <View style={styles.identityCard}>
          <View style={styles.identityRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initialsOf(user.name)}</Text>
            </View>
            <View style={styles.identityText}>
              <Text style={styles.identityName} numberOfLines={1}>
                {user.name}
              </Text>
              <Text style={styles.identityEmail} numberOfLines={1}>
                {user.email}
              </Text>
            </View>
          </View>

          <View style={styles.teamList}>
            {teams.length > 0 ? (
              teams.map((team) => (
                <View key={team.id} style={styles.teamRow}>
                  <Feather
                    name="users"
                    size={13}
                    color={theme.colors.onChromeMuted}
                  />
                  <Text style={styles.teamName} numberOfLines={1}>
                    {team.name}
                  </Text>
                  <Text style={styles.teamCode}>{team.code}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.teamEmpty}>No team available</Text>
            )}
          </View>
        </View>

        <View style={styles.drawerNav}>
          {NAV_ITEMS.map((item) => (
            <DrawerItem
              key={item.route}
              label={item.label}
              icon={item.icon}
              active={activeRouteName === item.route}
              badge={item.route === 'SyncQueue' && activeSyncCount > 0 ? activeSyncCount : undefined}
              onPress={() => navigation.navigate(item.route)}
            />
          ))}
        </View>

        <View style={styles.footerGroup}>
          {/* Manual "Work Offline" — hard-blocks network attempts so the app
              never hangs on a weak trickle of signal in a no-coverage area. */}
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: forceOffline }}
            accessibilityLabel="Work offline"
            onPress={() => setWorkOffline(!forceOffline)}
            style={({ pressed }) => [styles.appearanceRow, pressed && styles.drawerItemPressed]}
          >
            <Feather
              name="cloud-off"
              size={18}
              color={forceOffline ? theme.colors.chromeAccent : theme.colors.onChrome}
            />
            <Text style={styles.appearanceText}>Work offline</Text>
            <View style={[styles.appearanceToggle, forceOffline && styles.appearanceToggleOn]}>
              <View style={[styles.appearanceKnob, forceOffline && styles.appearanceKnobOn]} />
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Switch to ${mode === 'dark' ? 'light' : 'dark'} appearance`}
            onPress={toggle}
            style={({ pressed }) => [styles.appearanceRow, pressed && styles.drawerItemPressed]}
          >
            <Feather
              name={mode === 'dark' ? 'sun' : 'moon'}
              size={18}
              color={theme.colors.onChrome}
            />
            <Text style={styles.appearanceText}>
              {mode === 'dark' ? 'Light appearance' : 'Dark appearance'}
            </Text>
            <View style={[styles.appearanceToggle, mode === 'dark' && styles.appearanceToggleOn]}>
              <View
                style={[styles.appearanceKnob, mode === 'dark' && styles.appearanceKnobOn]}
              />
            </View>
          </Pressable>

          <DrawerItem
            label="Logout"
            icon="log-out"
            tone="danger"
            onPress={() => {
              void signOut();
            }}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function DrawerItem({
  label,
  onPress,
  icon,
  tone = 'default',
  active = false,
  badge,
}: {
  label: string;
  onPress: () => void;
  icon: FeatherName;
  tone?: 'default' | 'danger';
  active?: boolean;
  badge?: number;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const iconColor =
    tone === 'danger'
      ? theme.colors.chromeDanger
      : active
        ? theme.colors.chromeAccent
        : theme.colors.onChromeMuted;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.drawerItem,
        active && styles.drawerItemActive,
        pressed && styles.drawerItemPressed,
      ]}
    >
      <Feather name={icon} size={18} color={iconColor} style={styles.drawerItemIcon} />
      <Text
        style={[
          styles.drawerItemText,
          active && styles.drawerItemTextActive,
          tone === 'danger' && styles.drawerItemTextDanger,
        ]}
      >
        {label}
      </Text>
      {badge !== undefined ? (
        <View style={styles.syncBadge}>
          <Text style={styles.syncBadgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const createStyles = (t: Theme) => {
  const c = t.colors;
  return StyleSheet.create({
    drawerPanel: {
      flex: 1,
      backgroundColor: c.chrome,
    },
    drawerContent: {
      paddingTop: 34,
      paddingHorizontal: 16,
      paddingBottom: 28,
      gap: 16,
    },
    drawerHeader: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    drawerTitle: {
      color: c.onChrome,
      fontSize: 24,
      fontFamily: t.fonts.display,
      fontWeight: '700',
      letterSpacing: -0.4,
    },
    drawerCloseButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.chromePanel,
      borderWidth: 1,
      borderColor: c.chromeBorderStrong,
    },
    identityCard: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.chromeBorderStrong,
      backgroundColor: c.chromePanel,
      padding: 16,
      gap: 12,
    },
    identityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    avatar: {
      width: 46,
      height: 46,
      borderRadius: 14,
      backgroundColor: c.solidFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      color: c.onSolidFill,
      fontSize: 16,
      fontFamily: t.fonts.display,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    identityText: {
      flex: 1,
      gap: 3,
    },
    identityName: {
      color: c.onChrome,
      fontSize: 17,
      lineHeight: 22,
      fontFamily: t.fonts.display,
      fontWeight: '700',
    },
    identityEmail: {
      color: c.onChromeMuted,
      fontSize: 12.5,
      lineHeight: 17,
      fontFamily: t.fonts.mono,
    },
    teamList: {
      gap: 8,
    },
    teamRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: 10,
      backgroundColor: c.chrome,
      borderWidth: 1,
      borderColor: c.chromeBorderStrong,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    teamName: {
      flex: 1,
      color: c.onChrome,
      fontSize: 14,
      lineHeight: 19,
      fontFamily: t.fonts.bodySemibold,
      fontWeight: '600',
    },
    teamCode: {
      color: c.onChromeMuted,
      fontSize: 12,
      lineHeight: 17,
      fontFamily: t.fonts.monoMedium,
      letterSpacing: 0.4,
    },
    teamEmpty: {
      color: c.onChromeMuted,
      fontSize: 13,
      lineHeight: 18,
      fontFamily: t.fonts.body,
    },
    drawerNav: {
      gap: 6,
    },
    drawerItem: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: 'transparent',
      backgroundColor: 'transparent',
      paddingHorizontal: 14,
    },
    drawerItemActive: {
      borderColor: c.chromeBorderStrong,
      backgroundColor: c.chromeActive,
    },
    drawerItemPressed: {
      opacity: 0.82,
    },
    drawerItemIcon: {
      width: 20,
      textAlign: 'center',
    },
    drawerItemText: {
      flex: 1,
      color: c.onChromeMuted,
      fontSize: 15.5,
      fontFamily: t.fonts.bodySemibold,
      fontWeight: '600',
    },
    drawerItemTextActive: {
      color: c.onChrome,
    },
    drawerItemTextDanger: {
      color: c.chromeDanger,
    },
    syncBadge: {
      minWidth: 24,
      height: 24,
      borderRadius: 12,
      paddingHorizontal: 7,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.warningSoft,
      borderWidth: 1,
      borderColor: c.warningBorder,
    },
    syncBadgeText: {
      color: c.warningText,
      fontSize: 12,
      fontFamily: t.fonts.bodyBold,
      fontWeight: '700',
    },
    footerGroup: {
      marginTop: 4,
      gap: 8,
      borderTopWidth: 1,
      borderTopColor: c.chromeBorder,
      paddingTop: 16,
    },
    appearanceRow: {
      minHeight: 52,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.chromeBorderStrong,
      backgroundColor: c.chromePanel,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 14,
    },
    appearanceText: {
      flex: 1,
      color: c.onChrome,
      fontSize: 15.5,
      fontFamily: t.fonts.bodySemibold,
      fontWeight: '600',
    },
    appearanceToggle: {
      width: 42,
      height: 24,
      borderRadius: 12,
      backgroundColor: c.chromeActive,
      borderWidth: 1,
      borderColor: c.chromeBorderStrong,
      padding: 2,
      justifyContent: 'center',
    },
    appearanceToggleOn: {
      backgroundColor: c.chromeAccent,
      borderColor: c.chromeAccent,
    },
    appearanceKnob: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: c.onChromeMuted,
      alignSelf: 'flex-start',
    },
    appearanceKnobOn: {
      backgroundColor: '#FFFFFF',
      alignSelf: 'flex-end',
    },
  });
};
