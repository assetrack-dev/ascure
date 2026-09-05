const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

export default {
  expo: {
    name: 'ASCURE',
    slug: 'ascure',
    scheme: 'ascure',
    // NOTE: the native build does NOT run expo prebuild — the REAL versionCode /
    // versionName live in android/app/build.gradle. Kept in sync here for docs.
    version: '2.0.13',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    icon: './assets/brand/monogram.png',

    extra: {
      eas: {
        projectId: '67539625-8d92-4574-b3b4-e8d17f171661',
      },
    },

    splash: {
      image: './assets/brand/monogram.png',
      imageWidth: 160,
      resizeMode: 'contain',
      backgroundColor: '#E9ECEF',
      dark: {
        image: './assets/brand/monogram.png',
        imageWidth: 160,
        resizeMode: 'contain',
        backgroundColor: '#0E1116',
      },
    },

    assetBundlePatterns: ['**/*'],

    plugins: [
      [
        'expo-camera',
        {
          cameraPermission:
            'Allow ASCURE Field to use your camera to capture inspection photos and video.',
          microphonePermission:
            'Allow ASCURE Field to use your microphone when recording emergency video.',
          recordAudioAndroid: true,
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
      // Offline satellite (Phase 2). NOTE: native is hand-maintained (we don't run
      // expo prebuild), so the real build wiring lives in android/build.gradle (the
      // Mapbox maven repo). This entry documents intent + covers a future prebuild.
      // The download token is read from env at build time, never committed.
      [
        '@rnmapbox/maps',
        {
          RNMapboxMapsDownloadToken: process.env.MAPBOX_DOWNLOADS_TOKEN,
        },
      ],
    ],

    android: {
      package: 'local.ascure.field',
      versionCode: 38, // mirror of build.gradle (source of truth)
      usesCleartextTraffic: true,
      adaptiveIcon: {
        foregroundImage: './assets/brand/adaptive-foreground.png',
        backgroundColor: '#2563EB',
      },
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