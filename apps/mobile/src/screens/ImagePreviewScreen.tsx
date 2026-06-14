import { useMemo } from 'react';
import { Image, Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { API_BASE_URL } from '../api';
import { Theme, useTheme } from '../theme';
import type { RootStackScreenProps } from '../navigation/types';

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');

export function ImagePreviewScreen() {
  const navigation = useNavigation<RootStackScreenProps<'ImagePreview'>['navigation']>();
  const route = useRoute<RootStackScreenProps<'ImagePreview'>['route']>();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { uri, title } = route.params;
  const imageUri = getImageSourceUri(uri.trim());

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.chrome} />
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={({ pressed }) => ({
            paddingVertical: 8,
            paddingRight: 10,
            opacity: pressed ? 0.72 : 1,
          })}
        >
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        {title ? (
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>
        ) : null}
      </View>

      <View style={styles.imageWrap}>
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
          <Text style={styles.emptyText}>Image not available</Text>
        )}
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.colors.chrome,
      paddingTop: Platform.OS === 'android' ? 24 : 16,
    },
    header: {
      minHeight: 56,
      paddingHorizontal: 20,
      paddingBottom: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    backText: {
      fontSize: 16,
      fontWeight: '700',
      color: t.colors.onChrome,
    },
    title: {
      flex: 1,
      fontSize: 16,
      fontWeight: '700',
      color: t.colors.onChromeMuted,
    },
    imageWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
      paddingBottom: 24,
    },
    emptyText: {
      fontSize: 16,
      fontWeight: '600',
      color: t.colors.onChromeMuted,
    },
  });

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
