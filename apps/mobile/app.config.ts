const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

export default {
  expo: {
    name: 'ASCURE',
    slug: 'ascure',
    scheme: 'ascure',
    version: '1.1.0',
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
    ],

    android: {
      package: 'local.ascure.field',
      versionCode: 4,
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