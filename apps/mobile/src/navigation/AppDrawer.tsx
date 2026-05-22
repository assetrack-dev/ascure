import { createDrawerNavigator } from '@react-navigation/drawer';
import { DashboardScreen } from '../screens/DashboardScreen';
import { DefectListScreen } from '../screens/DefectListScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { MapScreen } from '../screens/MapScreen';
import { SyncQueueScreen } from '../screens/SyncQueueScreen';
import { AppDrawerContent } from './AppDrawerContent';
import type { AppDrawerParamList } from './types';

const Drawer = createDrawerNavigator<AppDrawerParamList>();

export function AppDrawer() {
  return (
    <Drawer.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerShown: false,
        drawerType: 'front',
        drawerStyle: { width: '82%', maxWidth: 340 },
      }}
      drawerContent={(props) => <AppDrawerContent {...props} />}
    >
      <Drawer.Screen name="Home" component={HomeScreen} />
      <Drawer.Screen name="Dashboard" component={DashboardScreen} />
      <Drawer.Screen name="AssetMap" component={MapScreen} />
      <Drawer.Screen name="DefectList" component={DefectListScreen} />
      <Drawer.Screen name="SyncQueue" component={SyncQueueScreen} />
    </Drawer.Navigator>
  );
}
