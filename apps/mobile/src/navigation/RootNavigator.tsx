import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { AddAssetScreen } from '../screens/AddAssetScreen';
import { AssetDetailScreen } from '../screens/AssetDetailScreen';
import { AssetInspectionHistoryScreen } from '../screens/AssetInspectionHistoryScreen';
import { CheckInScreen } from '../screens/CheckInScreen';
import { DefectDetailScreen } from '../screens/DefectDetailScreen';
import { ImagePreviewScreen } from '../screens/ImagePreviewScreen';
import { InspectionDetailScreen } from '../screens/InspectionDetailScreen';
import { InspectionFormScreen } from '../screens/InspectionFormScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { VisitDetailScreen } from '../screens/VisitDetailScreen';
import { AppDrawer } from './AppDrawer';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { token } = useAuth();

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {token === null ? (
        <Stack.Screen name="Login" component={LoginScreen} />
      ) : (
        <Stack.Group>
          <Stack.Screen name="AppDrawer" component={AppDrawer} />
          <Stack.Screen name="CheckIn" component={CheckInScreen} />
          <Stack.Screen name="VisitDetail" component={VisitDetailScreen} />
          <Stack.Screen name="AssetDetail" component={AssetDetailScreen} />
          <Stack.Screen name="AddAsset" component={AddAssetScreen} />
          <Stack.Screen name="InspectionForm" component={InspectionFormScreen} />
          <Stack.Screen name="InspectionDetail" component={InspectionDetailScreen} />
          <Stack.Screen
            name="AssetInspectionHistory"
            component={AssetInspectionHistoryScreen}
          />
          <Stack.Screen name="DefectDetail" component={DefectDetailScreen} />
          <Stack.Screen
            name="ImagePreview"
            component={ImagePreviewScreen}
            options={{ animation: 'fade' }}
          />
        </Stack.Group>
      )}
    </Stack.Navigator>
  );
}
