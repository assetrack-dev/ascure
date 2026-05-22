import { Image, Platform, Pressable, StatusBar, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { API_BASE_URL } from '../api';
import type { RootStackScreenProps } from '../navigation/types';

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');

export function ImagePreviewScreen() {
  const navigation = useNavigation<RootStackScreenProps<'ImagePreview'>['navigation']>();
  const route = useRoute<RootStackScreenProps<'ImagePreview'>['route']>();
  const { uri, title } = route.params;
  const imageUri = getImageSourceUri(uri.trim());

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#020617',
        paddingTop: Platform.OS === 'android' ? 24 : 16,
      }}
    >
      <StatusBar barStyle="light-content" backgroundColor="#020617" />
      <View
        style={{
          minHeight: 56,
          paddingHorizontal: 20,
          paddingBottom: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          style={({ pressed }) => ({
            paddingVertical: 8,
            paddingRight: 10,
            opacity: pressed ? 0.72 : 1,
          })}
        >
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#ffffff' }}>Back</Text>
        </Pressable>
        {title ? (
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontSize: 16,
              fontWeight: '700',
              color: '#e5e7eb',
            }}
          >
            {title}
          </Text>
        ) : null}
      </View>

      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 12,
          paddingBottom: 24,
        }}
      >
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={{
              width: '100%',
              height: '100%',
            }}
            resizeMode="contain"
          />
        ) : (
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#e5e7eb' }}>
            Image not available
          </Text>
        )}
      </View>
    </View>
  );
}

function getImageSourceUri(source: string) {
  if (!source) {
    return '';
  }

  if (/^[a-z][a-z\d+\-.]*:/i.test(source)) {
    return source;
  }

  if (source.startsWith('/')) {
    return `${API_ORIGIN}${source}`;
  }

  return source;
}
