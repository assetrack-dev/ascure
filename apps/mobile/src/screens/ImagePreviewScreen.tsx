import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { API_BASE_URL } from '../api';
import { Theme, useTheme } from '../theme';
import type { ImagePreviewImage, RootStackScreenProps } from '../navigation/types';

const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');
const AnimatedImage = Animated.createAnimatedComponent(Image);

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

export function ImagePreviewScreen() {
  const navigation = useNavigation<RootStackScreenProps<'ImagePreview'>['navigation']>();
  const route = useRoute<RootStackScreenProps<'ImagePreview'>['route']>();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { uri, title, images, index } = route.params;

  // Normalize the params into a single list so swiping works whether the caller
  // passed a set (images + index) or a one-off (uri + title).
  const items = useMemo<ImagePreviewImage[]>(() => {
    if (images && images.length > 0) {
      return images;
    }
    return uri ? [{ uri, title }] : [];
  }, [images, uri, title]);

  const initialIndex = Math.min(Math.max(index ?? 0, 0), Math.max(items.length - 1, 0));
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  // Paging is disabled while the current image is zoomed in, so a one-finger
  // drag pans the image instead of flipping to the next one.
  const [zoomed, setZoomed] = useState(false);
  // Measure the available area (excluding the header) so each page is sized
  // exactly to the viewport — required for paging + scroll-to-index.
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const onListLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewport((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  }, []);

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!viewport.width) {
        return;
      }
      const nextIndex = Math.round(event.nativeEvent.contentOffset.x / viewport.width);
      setActiveIndex((current) => (current === nextIndex ? current : nextIndex));
    },
    [viewport.width],
  );

  const activeTitle = items[activeIndex]?.title ?? title;
  const ready = viewport.width > 0 && viewport.height > 0;

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
        {activeTitle ? (
          <Text numberOfLines={1} style={styles.title}>
            {activeTitle}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {items.length > 1 ? (
          <Text style={styles.counter}>
            {activeIndex + 1} / {items.length}
          </Text>
        ) : null}
      </View>

      <View style={styles.listArea} onLayout={onListLayout}>
        {items.length === 0 ? (
          <View style={styles.imageWrap}>
            <Text style={styles.emptyText}>Image not available</Text>
          </View>
        ) : ready ? (
          <FlatList
            data={items}
            keyExtractor={(item, itemIndex) => `${item.uri}-${itemIndex}`}
            horizontal
            pagingEnabled
            scrollEnabled={!zoomed}
            initialScrollIndex={initialIndex}
            getItemLayout={(_, layoutIndex) => ({
              length: viewport.width,
              offset: viewport.width * layoutIndex,
              index: layoutIndex,
            })}
            onScrollToIndexFailed={() => {}}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onMomentumScrollEnd}
            renderItem={({ item }) => (
              <ZoomableImage
                uri={getImageSourceUri(item.uri.trim())}
                width={viewport.width}
                height={viewport.height}
                onZoomChange={setZoomed}
              />
            )}
          />
        ) : null}
      </View>
    </View>
  );
}

function ZoomableImage({
  uri,
  width,
  height,
  onZoomChange,
}: {
  uri: string;
  width: number;
  height: number;
  onZoomChange: (zoomed: boolean) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const [isZoomed, setIsZoomed] = useState(false);

  // Local zoom state gates the pan gesture (so it doesn't swallow swipes at 1x);
  // the parent uses it to toggle paging.
  const handleZoomChange = useCallback(
    (nextZoomed: boolean) => {
      setIsZoomed(nextZoomed);
      onZoomChange(nextZoomed);
    },
    [onZoomChange],
  );

  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .onUpdate((event) => {
        scale.value = Math.min(Math.max(savedScale.value * event.scale, MIN_SCALE), MAX_SCALE);
      })
      .onEnd(() => {
        if (scale.value <= MIN_SCALE) {
          scale.value = withTiming(MIN_SCALE);
          savedScale.value = MIN_SCALE;
          translateX.value = withTiming(0);
          translateY.value = withTiming(0);
          savedTranslateX.value = 0;
          savedTranslateY.value = 0;
          runOnJS(handleZoomChange)(false);
          return;
        }
        savedScale.value = scale.value;
        const maxX = ((scale.value - 1) * width) / 2;
        const maxY = ((scale.value - 1) * height) / 2;
        translateX.value = Math.min(Math.max(translateX.value, -maxX), maxX);
        translateY.value = Math.min(Math.max(translateY.value, -maxY), maxY);
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
        runOnJS(handleZoomChange)(true);
      });

    // Enabled only while zoomed; at 1x the FlatList keeps the horizontal swipe.
    const pan = Gesture.Pan()
      .enabled(isZoomed)
      .onUpdate((event) => {
        translateX.value = savedTranslateX.value + event.translationX;
        translateY.value = savedTranslateY.value + event.translationY;
      })
      .onEnd(() => {
        const maxX = ((scale.value - 1) * width) / 2;
        const maxY = ((scale.value - 1) * height) / 2;
        translateX.value = Math.min(Math.max(translateX.value, -maxX), maxX);
        translateY.value = Math.min(Math.max(translateY.value, -maxY), maxY);
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(250)
      .onEnd(() => {
        if (scale.value > MIN_SCALE) {
          scale.value = withTiming(MIN_SCALE);
          savedScale.value = MIN_SCALE;
          translateX.value = withTiming(0);
          translateY.value = withTiming(0);
          savedTranslateX.value = 0;
          savedTranslateY.value = 0;
          runOnJS(handleZoomChange)(false);
        } else {
          scale.value = withTiming(DOUBLE_TAP_SCALE);
          savedScale.value = DOUBLE_TAP_SCALE;
          runOnJS(handleZoomChange)(true);
        }
      });

    return Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));
  }, [
    isZoomed,
    width,
    height,
    handleZoomChange,
    scale,
    savedScale,
    translateX,
    translateY,
    savedTranslateX,
    savedTranslateY,
  ]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View style={[styles.page, { width, height }]}>
      {uri ? (
        <GestureDetector gesture={gesture}>
          <AnimatedImage source={{ uri }} resizeMode="contain" style={[{ width, height }, animatedStyle]} />
        </GestureDetector>
      ) : (
        <Text style={styles.emptyText}>Image not available</Text>
      )}
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
    counter: {
      fontSize: 14,
      fontWeight: '700',
      color: t.colors.onChromeMuted,
    },
    listArea: {
      flex: 1,
    },
    page: {
      alignItems: 'center',
      justifyContent: 'center',
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
