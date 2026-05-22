import type {
  CompositeScreenProps,
  NavigatorScreenParams,
} from '@react-navigation/native';
import type { DrawerScreenProps } from '@react-navigation/drawer';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Asset } from '../types';

export type AppDrawerParamList = {
  Home: undefined;
  Dashboard: undefined;
  AssetMap: { visitId?: string; substationId?: string } | undefined;
  DefectList: undefined;
  SyncQueue: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  AppDrawer: NavigatorScreenParams<AppDrawerParamList> | undefined;
  CheckIn: undefined;
  VisitDetail: { visitId: string; substationId: string; successMessage?: string };
  AssetDetail: {
    visitId?: string;
    substationId?: string;
    assetId: string;
    assetSnapshot?: Asset;
  };
  AddAsset: {
    visitId?: string;
    substationId?: string;
    assetToEdit?: Asset;
    initialLatitude?: number;
    initialLongitude?: number;
  };
  InspectionForm: { inspectionId: string; visitId: string; substationId: string };
  InspectionDetail: { inspectionId: string; assetCode?: string };
  AssetInspectionHistory: { assetId: string; assetCode?: string };
  DefectDetail: { defectId: string };
  ImagePreview: { uri: string; title?: string };
};

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

export type AppDrawerScreenProps<T extends keyof AppDrawerParamList> =
  CompositeScreenProps<
    DrawerScreenProps<AppDrawerParamList, T>,
    RootStackScreenProps<keyof RootStackParamList>
  >;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
