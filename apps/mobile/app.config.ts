const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

export default {
  expo: {
    name: 'ASCURE',
    slug: 'ascure',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    splash: {
      resizeMode: 'contain',
      backgroundColor: '#f4f7fb',
    },
    assetBundlePatterns: ['**/*'],
    plugins: [
      [
        'expo-image-picker',
        {
          cameraPermission:
            'Allow ASCURE Field to use your camera to capture inspection photos.',
        },
      ],
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'Allow ASCURE Field to use your location while capturing inspection photos and adding assets.',
        },
      ],
      [
        'react-native-maps',
        {
          androidGoogleMapsApiKey: googleMapsApiKey,
        },
      ],
    ],
    android: {
      package: 'local.ascure.field',
      usesCleartextTraffic: true,
      permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
      config: {
        googleMaps: {
          apiKey: googleMapsApiKey,
        },
      },
    },
    ios: {
      bundleIdentifier: 'local.ascure.field',
    },
  },
};
