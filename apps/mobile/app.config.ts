const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

export default {
  expo: {
    name: 'ASCURE',
    slug: 'ascure',
    scheme: 'ascure',
    version: '1.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',

    extra: {
      eas: {
        projectId: '67539625-8d92-4574-b3b4-e8d17f171661',
      },
    },

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
      versionCode: 2,
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