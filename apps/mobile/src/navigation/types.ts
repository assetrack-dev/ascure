import type {
  CompositeScreenProps,
  NavigatorScreenParams,
} from '@react-navigation/native';
import type { DrawerScreenProps } from '@react-navigation/drawer';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Asset } from '../types';

/** Shared params for the (single) MapScreen, mounted as AssetMap + VisitAssetMap.
 *  The optional focus* fields open the map centred on a specific asset (used by
 *  the Asset Detail mini-map "tap to open"). */
export type AssetMapParams = {
  visitId?: string;
  substationId?: string;
  focusAssetId?: string;
  focusLatitude?: number;
  focusLongitude?: number;
};

export type AppDrawerParamList = {
  Home: undefined;
  Dashboard: undefined;
  AssetMap: AssetMapParams | undefined;
  DefectList: undefined;
  SyncQueue: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  ChangePassword: undefined;
  AppDrawer: NavigatorScreenParams<AppDrawerParamList> | undefined;
  CheckIn: undefined;
  VisitDetail: { visitId: string; substationId: string; successMessage?: string };
  VisitAssets: { visitId: string; substationId: string };
  // Full-screen map pushed ON TOP of VisitDetail (root stack) so "back" returns
  // to the visit, not the drawer's Workspace. Reuses MapScreen (ADR/issue #6).
  VisitAssetMap: AssetMapParams | undefined;
  AssetDetail: {
    visitId?: string;
    substationId?: string;
    assetId: string;
    operationalSessionId?: string;
    assetSnapshot?: Asset;
    // Set by Add Asset "Save & inspect" — opens the inspection form automatically
    // once the new pole loads.
    autoStartInspection?: boolean;
  };
  AddAsset: {
    visitId?: string;
    substationId?: string;
    assetToEdit?: Asset;
    initialLatitude?: number;
    initialLongitude?: number;
  };
  OperationalSessions: undefined;
  OperationalSessionDetail: { sessionId: string; sessionNo?: string };
  InspectionForm: {
    inspectionId: string;
    visitId: string;
    substationId: string;
    operationalSessionId?: string;
  };
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
