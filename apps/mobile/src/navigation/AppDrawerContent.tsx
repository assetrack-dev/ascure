import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { DrawerContentComponentProps } from '@react-navigation/drawer';
import { api, ApiError } from '../api';
import { getActiveQueueCount } from '../syncQueue';
import { useSession } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import type { Team } from '../types';
import type { AppDrawerParamList } from './types';

type DrawerRouteName = keyof AppDrawerParamList;

const NAV_ITEMS: { label: string; route: DrawerRouteName }[] = [
  { label: 'Visits', route: 'Home' },
  { label: 'Dashboard', route: 'Dashboard' },
  { label: 'Map', route: 'AssetMap' },
  { label: 'Defects', route: 'DefectList' },
  { label: 'Sync Queue', route: 'SyncQueue' },
];

export function AppDrawerContent({ navigation, state }: DrawerContentComponentProps) {
  const { token, user, handleUnauthorized, signOut } = useSession();
  const { snapshot } = useSync();
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
            <Feather name="x" size={18} color="#E5E7EB" />
          </Pressable>
        </View>

        <View style={styles.identityCard}>
          <Text style={styles.identityLabel}>User Info / Team Info</Text>
          <Text style={styles.identityName}>{user.name}</Text>
          <Text style={styles.identityEmail}>{user.email}</Text>
          <View style={styles.teamList}>
            {teams.length > 0 ? (
              teams.map((team) => (
                <View key={team.id} style={styles.teamRow}>
                  <Text style={styles.teamName}>{team.name}</Text>
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
              label={
                item.route === 'SyncQueue' && activeSyncCount > 0
                  ? `Sync Queue (${activeSyncCount})`
                  : item.label
              }
              active={activeRouteName === item.route}
              onPress={() => navigation.navigate(item.route)}
            />
          ))}
        </View>

        <DrawerItem
          label="Logout"
          tone="danger"
          onPress={() => {
            void signOut();
          }}
        />
      </ScrollView>
    </View>
  );
}

function DrawerItem({
  label,
  onPress,
  tone = 'default',
  active = false,
}: {
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
  active?: boolean;
}) {
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
      <Text
        style={[
          styles.drawerItemText,
          active && styles.drawerItemTextActive,
          tone === 'danger' && styles.drawerItemTextDanger,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  drawerPanel: {
    flex: 1,
    backgroundColor: '#111827',
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
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },
  drawerCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
  },
  identityCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#1F2937',
    padding: 16,
    gap: 9,
  },
  identityLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  identityName: {
    color: '#FFFFFF',
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '700',
  },
  identityEmail: {
    color: '#D1D5DB',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  teamList: {
    gap: 8,
    paddingTop: 6,
  },
  teamRow: {
    borderRadius: 8,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#374151',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3,
  },
  teamName: {
    color: '#F9FAFB',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  teamCode: {
    color: '#9CA3AF',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  teamEmpty: {
    color: '#9CA3AF',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  drawerNav: {
    gap: 8,
  },
  drawerItem: {
    minHeight: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  drawerItemActive: {
    borderColor: '#374151',
    backgroundColor: '#1F2937',
  },
  drawerItemPressed: {
    opacity: 0.82,
  },
  drawerItemText: {
    color: '#D1D5DB',
    fontSize: 16,
    fontWeight: '600',
  },
  drawerItemTextActive: {
    color: '#FFFFFF',
  },
  drawerItemTextDanger: {
    color: '#FCA5A5',
  },
});
