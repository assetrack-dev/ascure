import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { api, ApiError } from './src/api';
import { loadStoredToken, removeStoredToken, storeToken } from './src/storage';
import { AddAssetScreen } from './src/screens/AddAssetScreen';
import { AssetDetailScreen } from './src/screens/AssetDetailScreen';
import { AssetInspectionHistoryScreen } from './src/screens/AssetInspectionHistoryScreen';
import { CheckInScreen } from './src/screens/CheckInScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { DefectDetailScreen } from './src/screens/DefectDetailScreen';
import { DefectListScreen } from './src/screens/DefectListScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ImagePreviewScreen } from './src/screens/ImagePreviewScreen';
import { InspectionDetailScreen } from './src/screens/InspectionDetailScreen';
import { InspectionFormScreen } from './src/screens/InspectionFormScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { MapScreen } from './src/screens/MapScreen';
import { VisitDetailScreen } from './src/screens/VisitDetailScreen';
import { LoadingScreen } from './src/ui';
import { Asset, SessionUser } from './src/types';

type InspectionDetailRoute =
  | {
      name: 'InspectionDetail';
      source: 'history';
      visitId: string;
      substationId: string;
      assetId: string;
      inspectionId: string;
      assetCode?: string;
    }
  | {
      name: 'InspectionDetail';
      source: 'defects';
      inspectionId: string;
      assetId: string;
      assetCode?: string;
    };

type AssetDetailRoute = {
  name: 'asset-detail';
  visitId?: string;
  substationId: string;
  assetId: string;
  assetSnapshot?: Asset;
  returnTo?: 'asset-map';
  mapVisitId?: string;
  mapSubstationId?: string;
};

type DefectDetailRoute = {
  name: 'DefectDetail';
  defectId: string;
  returnTo?: 'Dashboard' | 'DefectList' | 'AssetMap';
  mapVisitId?: string;
  mapSubstationId?: string;
};

type ImagePreviewReturnRoute =
  | AssetDetailRoute
  | DefectDetailRoute
  | {
      name: 'AssetInspectionHistory';
      visitId: string;
      substationId: string;
      assetId: string;
      assetCode?: string;
    }
  | InspectionDetailRoute;

type Route =
  | { name: 'login' }
  | { name: 'home' }
  | { name: 'Dashboard' }
  | { name: 'DefectList' }
  | DefectDetailRoute
  | { name: 'check-in' }
  | { name: 'visit-detail'; visitId: string; substationId: string; successMessage?: string }
  | AssetDetailRoute
  | { name: 'asset-map'; visitId?: string; substationId?: string }
  | {
      name: 'AssetInspectionHistory';
      visitId: string;
      substationId: string;
      assetId: string;
      assetCode?: string;
    }
  | InspectionDetailRoute
  | {
      name: 'add-asset';
      visitId?: string;
      substationId?: string;
      assetToEdit?: Asset;
      initialLatitude?: number;
      initialLongitude?: number;
      returnTo?: 'asset-map';
    }
  | { name: 'inspection-form'; inspectionId: string; visitId: string; substationId: string }
  | { name: 'ImagePreview'; uri: string; title?: string; returnTo: ImagePreviewReturnRoute };

export default function App() {
  const [isBooting, setIsBooting] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [route, setRoute] = useState<Route>({ name: 'login' });

  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        const storedToken = await loadStoredToken();

        if (!storedToken) {
          return;
        }

        const currentUser = await api.getMe(storedToken);

        if (!isMounted) {
          return;
        }

        setToken(storedToken);
        setUser(currentUser);
        setRoute({ name: 'home' });
      } catch (error) {
        await removeStoredToken();
      } finally {
        if (isMounted) {
          setIsBooting(false);
        }
      }
    }

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleLogin = useCallback(async (accessToken: string, sessionUser: SessionUser) => {
    await storeToken(accessToken);
    setToken(accessToken);
    setUser(sessionUser);
    setRoute({ name: 'home' });
  }, []);

  const handleLogout = useCallback(async () => {
    await removeStoredToken();
    setToken(null);
    setUser(null);
    setRoute({ name: 'login' });
  }, []);

  const handleUnauthorized = useCallback(
    async (error?: unknown) => {
      if (error instanceof ApiError && error.status !== 401) {
        throw error;
      }

      await handleLogout();
      Alert.alert('Session expired', 'Please sign in again.');
    },
    [handleLogout],
  );

  if (isBooting) {
    return <LoadingScreen label="Loading ASCURE mobile..." />;
  }

  if (!token || !user || route.name === 'login') {
    return (
      <LoginScreen
        onAuthenticated={handleLogin}
      />
    );
  }

  if (route.name === 'check-in') {
    return (
      <CheckInScreen
        token={token}
        onBack={() => setRoute({ name: 'home' })}
        onCreated={(visit) =>
          setRoute({
            name: 'visit-detail',
            visitId: visit.id,
            substationId: visit.substationId,
          })
        }
        onUnauthorized={handleUnauthorized}
      />
    );
  }

  if (route.name === 'visit-detail') {
    return (
      <VisitDetailScreen
        token={token}
        visitId={route.visitId}
        substationId={route.substationId}
        successMessage={route.successMessage}
        onBack={() => setRoute({ name: 'home' })}
        onOpenAddAsset={() =>
          setRoute({
            name: 'add-asset',
            visitId: route.visitId,
            substationId: route.substationId,
          })
        }
        onOpenAssetMap={() =>
          setRoute({
            name: 'asset-map',
            visitId: route.visitId,
            substationId: route.substationId,
          })
        }
        onOpenAssetDetail={(asset) =>
          setRoute({
            name: 'asset-detail',
            visitId: route.visitId,
            substationId: route.substationId,
            assetId: asset.id,
            assetSnapshot: asset,
          })
        }
        onUnauthorized={handleUnauthorized}
      />
    );
  }

  if (route.name === 'asset-detail') {
    return (
      <AssetDetailScreen
        token={token}
        visitId={route.visitId}
        substationId={route.substationId}
        assetId={route.assetId}
        assetSnapshot={route.assetSnapshot}
        onBack={() =>
          route.returnTo === 'asset-map'
            ? setRoute({
                name: 'asset-map',
                visitId: route.mapVisitId,
                substationId: route.mapSubstationId,
              })
            : route.visitId
              ? setRoute({
                  name: 'visit-detail',
                  visitId: route.visitId,
                  substationId: route.substationId,
                })
              : setRoute({ name: 'home' })
        }
        onOpenInspection={(inspectionId) => {
          if (!route.visitId) {
            return;
          }

          setRoute({
            name: 'inspection-form',
            inspectionId,
            visitId: route.visitId,
            substationId: route.substationId,
          });
        }}
        onOpenInspectionHistory={(params) => {
          if (!route.visitId) {
            return;
          }

          setRoute({
            name: 'AssetInspectionHistory',
            visitId: route.visitId,
            substationId: route.substationId,
            assetId: params.assetId,
            assetCode: params.assetCode,
          });
        }}
        onOpenEditAsset={(asset) =>
          setRoute({
            name: 'add-asset',
            visitId: route.visitId,
            substationId: route.substationId,
            assetToEdit: asset,
          })
        }
        onOpenImagePreview={(params) =>
          setRoute({
            name: 'ImagePreview',
            uri: params.uri,
            title: params.title,
            returnTo: route,
          })
        }
        onUnauthorized={handleUnauthorized}
      />
    );
  }

  if (route.name === 'ImagePreview') {
    return (
      <ImagePreviewScreen
        uri={route.uri}
        title={route.title}
        onBack={() => setRoute(route.returnTo)}
      />
    );
  }

  if (route.name === 'InspectionDetail') {
    return (
      <InspectionDetailScreen
        token={token}
        inspectionId={route.inspectionId}
        assetCode={route.assetCode}
        onBack={() =>
          route.source === 'history'
            ? setRoute({
                name: 'AssetInspectionHistory',
                visitId: route.visitId,
                substationId: route.substationId,
                assetId: route.assetId,
                assetCode: route.assetCode,
              })
            : setRoute({ name: 'DefectList' })
        }
        onOpenImagePreview={(params) =>
          setRoute({
            name: 'ImagePreview',
            uri: params.uri,
            title: params.title,
            returnTo: route,
          })
        }
        onUnauthorized={handleUnauthorized}
      />
    );
  }

  if (route.name === 'DefectList') {
    return (
      <DefectListScreen
        token={token}
        onBack={() => setRoute({ name: 'home' })}
        onOpenDefect={(item) =>
          setRoute({
            name: 'DefectDetail',
            defectId: item.id,
            returnTo: 'DefectList',
          })
        }
        onOpenInspection={(item) =>
          setRoute({
            name: 'InspectionDetail',
            source: 'defects',
            inspectionId: item.inspectionId,
            assetId: item.assetId,
            assetCode: item.assetCode,
          })
        }
        onUnauthorized={handleUnauthorized}
      />
    );
  }

  if (route.name === 'Dashboard') {
    return (
      <DashboardScreen
        token={token}
        onBack={() => setRoute({ name: 'home' })}
        onOpenDefect={(defectId) =>
          setRoute({
            name: 'DefectDetail',
            defectId,
            returnTo: 'Dashboard',
          })
        }
        onUnauthorized={handleUnauthorized}
      />
    );
  }

  if (route.name === 'DefectDetail') {
    return (
      <DefectDetailScreen
        token={token}
        defectId={route.defectId}
        onBack={() =>
          route.returnTo === 'Dashboard'
            ? setRoute({ name: 'Dashboard' })
            : route.returnTo === 'AssetMap'
              ? setRoute({
                  name: 'asset-map',
                  visitId: route.mapVisitId,
                  substationId: route.mapSubstationId,
                })
              : setRoute({ name: 'DefectList' })
        }
        onOpenImagePreview={(params) =>
          setRoute({
            name: 'ImagePreview',
            uri: params.uri,
            title: params.title,
            returnTo: route,
          })
        }
        onUnauthorized={handleUnauthorized}
      />
    );
  }

  if (route.name === 'AssetInspectionHistory') {
    return (
      <AssetInspectionHistoryScreen
        token={token}
        assetId={route.assetId}
        assetCode={route.assetCode}
        onBack={() =>
          setRoute({
            name: 'asset-detail',
            visitId: route.visitId,
            substationId: route.substationId,
            assetId: route.assetId,
          })
        }
        onOpenImagePreview={(params) =>
          setRoute({
            name: 'ImagePreview',
            uri: params.uri,
            title: params.title,
            returnTo: {
              name: 'AssetInspectionHistory',
              visitId: route.visitId,
              substationId: route.substationId,
              assetId: route.assetId,
              assetCode: route.assetCode,
            },
          })
        }
        onOpenInspectionDetail={(params) =>
          setRoute({
            name: 'InspectionDetail',
            source: 'history',
            visitId: route.visitId,
            substationId: route.substationId,
            assetId: route.assetId,
            inspectionId: params.inspectionId,
            assetCode: params.assetCode,
          })
        }
        onUnauthorized={handleUnauthorized}
      />
    );
  }

  if (route.name === 'asset-map') {
    return (
      <MapScreen
        token={token}
        visitId={route.visitId}
        substationId={route.substationId}
        onBack={() =>
          route.visitId && route.substationId
            ? setRoute({
                name: 'visit-detail',
                visitId: route.visitId,
                substationId: route.substationId,
              })
            : setRoute({ name: 'home' })
        }
        onAddAssetHere={(params) =>
          setRoute({
            name: 'add-asset',
            visitId: params.visitId,
            substationId: params.substationId,
            initialLatitude: params.latitude,
            initialLongitude: params.longitude,
            returnTo: 'asset-map',
          })
        }
        onOpenAssetDetail={(asset) =>
          setRoute({
            name: 'asset-detail',
            visitId: route.visitId,
            substationId: asset.substationId,
            assetId: asset.id,
            assetSnapshot: asset,
            returnTo: 'asset-map',
            mapVisitId: route.visitId,
            mapSubstationId: route.substationId,
          })
        }
        onOpenDefectDetail={(defectId) =>
          setRoute({
            name: 'DefectDetail',
            defectId,
            returnTo: 'AssetMap',
            mapVisitId: route.visitId,
            mapSubstationId: route.substationId,
          })
        }
        onUnauthorized={handleUnauthorized}
      />
    );
  }

  if (route.name === 'add-asset') {
    return (
      <AddAssetScreen
        token={token}
        siteVisitId={route.visitId}
        substationId={route.substationId}
        assetToEdit={route.assetToEdit}
        initialLatitude={route.initialLatitude}
        initialLongitude={route.initialLongitude}
        onBack={() =>
          route.returnTo === 'asset-map'
            ? setRoute({
                name: 'asset-map',
                visitId: route.visitId,
                substationId: route.substationId,
              })
            : route.visitId && route.substationId
              ? setRoute({
                  name: 'visit-detail',
                  visitId: route.visitId,
                  substationId: route.substationId,
                })
              : setRoute({ name: 'home' })
        }
        onSaved={(successMessage) =>
          route.visitId && route.substationId
            ? setRoute({
                name: 'visit-detail',
                visitId: route.visitId,
                substationId: route.substationId,
                successMessage,
              })
            : setRoute({ name: 'home' })
        }
        onUnauthorized={handleUnauthorized}
      />
    );
  }

  if (route.name === 'inspection-form') {
    return (
      <InspectionFormScreen
        token={token}
        inspectionId={route.inspectionId}
        onBack={() =>
          setRoute({
            name: 'visit-detail',
            visitId: route.visitId,
            substationId: route.substationId,
          })
        }
        onSubmitted={(successMessage) =>
          setRoute({
            name: 'visit-detail',
            visitId: route.visitId,
            substationId: route.substationId,
            successMessage,
          })
        }
        onUnauthorized={handleUnauthorized}
      />
    );
  }

  return (
    <HomeScreen
      token={token}
      initialUser={user}
      onUserRefreshed={setUser}
      onOpenCheckIn={() => setRoute({ name: 'check-in' })}
      onOpenDashboard={() => setRoute({ name: 'Dashboard' })}
      onOpenAssetMap={() => setRoute({ name: 'asset-map' })}
      onOpenDefects={() => setRoute({ name: 'DefectList' })}
      onOpenVisit={(visit) =>
        setRoute({
          name: 'visit-detail',
          visitId: visit.id,
          substationId: visit.substationId,
        })
      }
      onLogout={handleLogout}
      onUnauthorized={handleUnauthorized}
    />
  );
}
