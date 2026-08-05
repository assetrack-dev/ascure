import { Alert, Linking } from 'react-native';

/**
 * Open Google Street View at a coordinate.
 *
 * Street View is Google imagery, and the in-app map is Mapbox (that is what
 * keeps it fast and offline-capable), so there is no panorama we can render
 * ourselves — the pegman hands off to the Google Maps app instead, the same way
 * the admin-web map's pegman opens one. The api=1 universal link opens the
 * installed Google Maps app on Android (browser otherwise): no API key, no
 * package dependency, callable from any screen state.
 */
export function openStreetViewAt(latitude: number, longitude: number) {
  const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${latitude},${longitude}`;
  void Linking.openURL(url).catch(() => {
    Alert.alert(
      'Unable to open Street View',
      'Install or enable Google Maps to view street imagery.',
    );
  });
}
