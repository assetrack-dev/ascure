import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';

// App-wide navigation ref so non-screen components (e.g. the emergency
// watcher overlay mounted alongside the navigator) can drive navigation.
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateToDefect(defectId: string) {
  if (navigationRef.isReady()) {
    navigationRef.navigate('DefectDetail', { defectId });
  }
}
