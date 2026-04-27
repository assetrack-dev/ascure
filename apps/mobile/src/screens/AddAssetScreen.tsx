import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Location from 'expo-location';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from '../api';
import {
  AppButton,
  BodyText,
  Card,
  EmptyState,
  ErrorBanner,
  InlineButton,
  LoadingBlock,
  Screen,
  SectionTitle,
  SelectCard,
  TextField,
} from '../ui';
import { Asset, AssetType } from '../types';

export function AddAssetScreen({
  token,
  substationId,
  siteVisitId,
  assetToEdit,
  onBack,
  onSaved,
  onUnauthorized,
}: {
  token: string;
  substationId: string;
  siteVisitId: string;
  assetToEdit?: Asset;
  onBack: () => void;
  onSaved: (successMessage: string) => void;
  onUnauthorized: (error?: unknown) => Promise<void>;
}) {
  const isEditMode = Boolean(assetToEdit);
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([]);
  const [selectedAssetTypeId, setSelectedAssetTypeId] = useState('');
  const [assetCode, setAssetCode] = useState('');
  const [assetName, setAssetName] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isAssetTypeMenuOpen, setIsAssetTypeMenuOpen] = useState(false);
  const [hasLocationPermission, setHasLocationPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedAssetType = useMemo(
    () => assetTypes.find((assetType) => assetType.id === selectedAssetTypeId) ?? null,
    [assetTypes, selectedAssetTypeId],
  );

  useEffect(() => {
    setSelectedAssetTypeId(assetToEdit?.assetTypeId ?? '');
    setAssetCode(assetToEdit?.assetCode ?? '');
    setAssetName(assetToEdit?.name ?? '');
    setLatitude(
      assetToEdit?.latitude !== null && assetToEdit?.latitude !== undefined
        ? formatCoordinate(assetToEdit.latitude)
        : '',
    );
    setLongitude(
      assetToEdit?.longitude !== null && assetToEdit?.longitude !== undefined
        ? formatCoordinate(assetToEdit.longitude)
        : '',
    );
    setIsAssetTypeMenuOpen(false);
    setError(null);
  }, [assetToEdit]);

  const prefillCurrentLocation = useCallback(async () => {
    try {
      const permission = await Location.getForegroundPermissionsAsync();

      setHasLocationPermission(permission.granted);

      if (!permission.granted) {
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setLatitude(formatCoordinate(position.coords.latitude));
      setLongitude(formatCoordinate(position.coords.longitude));
    } catch {
      // Ignore passive GPS lookup failures so the form still loads cleanly.
    }
  }, []);

  const loadOptions = useCallback(async () => {
    try {
      setError(null);
      setIsLoading(true);

      const assetTypeList = await api.getAssetTypes(token);
      setAssetTypes(assetTypeList);

      if (assetTypeList.length > 0) {
        setSelectedAssetTypeId((currentValue) =>
          assetTypeList.some((assetType) => assetType.id === currentValue)
            ? currentValue
            : assetTypeList[0].id,
        );
      }

      if (!isEditMode) {
        await prefillCurrentLocation();
      }
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        await onUnauthorized(loadError);
        return;
      }

      setError(loadError instanceof Error ? loadError.message : 'Unable to load asset options.');
    } finally {
      setIsLoading(false);
    }
  }, [isEditMode, onUnauthorized, prefillCurrentLocation, token]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  async function handleUseCurrentLocation() {
    try {
      setError(null);
      setIsLocating(true);

      const permission = await Location.requestForegroundPermissionsAsync();
      setHasLocationPermission(permission.granted);

      if (!permission.granted) {
        setError('Location permission was not granted. You can still enter coordinates manually.');
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setLatitude(formatCoordinate(position.coords.latitude));
      setLongitude(formatCoordinate(position.coords.longitude));
    } catch (locationError) {
      setError(locationError instanceof Error ? locationError.message : 'Unable to read the current GPS location.');
    } finally {
      setIsLocating(false);
    }
  }

  async function handleSubmit() {
    const normalizedAssetCode = assetCode.trim();
    const normalizedAssetName = assetName.trim();

    if (!selectedAssetTypeId) {
      setError('Please select an asset type.');
      return;
    }

    if (!normalizedAssetCode) {
      setError('Please enter an asset code.');
      return;
    }

    const parsedLatitude = parseCoordinate(latitude, -90, 90);

    if (parsedLatitude === 'invalid') {
      setError('Latitude must be a valid number between -90 and 90.');
      return;
    }

    const parsedLongitude = parseCoordinate(longitude, -180, 180);

    if (parsedLongitude === 'invalid') {
      setError('Longitude must be a valid number between -180 and 180.');
      return;
    }

    const latitudeValue =
      parsedLatitude === undefined
        ? isEditMode
          ? null
          : undefined
        : parsedLatitude;
    const longitudeValue =
      parsedLongitude === undefined
        ? isEditMode
          ? null
          : undefined
        : parsedLongitude;

    try {
      setError(null);
      setIsSubmitting(true);

      if (assetToEdit) {
        await api.updateAsset(token, assetToEdit.id, {
          assetTypeId: selectedAssetTypeId,
          assetCode: normalizedAssetCode,
          name: normalizedAssetName,
          latitude: latitudeValue,
          longitude: longitudeValue,
        });

        onSaved(`Asset ${normalizedAssetCode} updated successfully.`);
        return;
      }

      await api.createAsset(token, {
        substationId,
        assetTypeId: selectedAssetTypeId,
        assetCode: normalizedAssetCode,
        name: normalizedAssetName || undefined,
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        createdDuringVisitId: siteVisitId,
      });

      onSaved(`Asset ${normalizedAssetCode} added successfully.`);
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 401) {
        await onUnauthorized(submitError);
        return;
      }

      setError(
        submitError instanceof Error
          ? submitError.message
          : isEditMode
            ? 'Unable to update asset.'
            : 'Unable to add asset.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen
      title={isEditMode ? 'Edit Asset' : 'Add Asset'}
      subtitle={
        isEditMode
          ? 'Update the selected asset details for this shared site visit.'
          : 'Register a new asset for this shared site visit before starting an inspection.'
      }
      actions={
        <>
          <InlineButton label="Back" onPress={onBack} disabled={isSubmitting} />
          <InlineButton label="Refresh" onPress={loadOptions} disabled={isSubmitting || isLocating} />
        </>
      }
      keyboardAware
      footer={
        <AppButton
          label={
            isSubmitting
              ? isEditMode
                ? 'Updating Asset...'
                : 'Saving Asset...'
              : isEditMode
                ? 'Update Asset'
                : 'Save Asset'
          }
          onPress={handleSubmit}
          loading={isSubmitting}
          disabled={isLoading || isSubmitting || assetTypes.length === 0}
        />
      }
    >
      <ErrorBanner message={error} />
      {isLoading ? (
        <LoadingBlock label={isEditMode ? 'Loading asset types...' : 'Loading asset types and GPS...'} />
      ) : null}

      {!isLoading ? (
        <>
          <Card>
            <SectionTitle>Asset Type</SectionTitle>
            {assetTypes.length === 0 ? (
              <EmptyState
                title="No asset types available"
                description="The backend did not return any active asset types for this tenant."
              />
            ) : (
              <>
                <Pressable
                  onPress={() => setIsAssetTypeMenuOpen((currentValue) => !currentValue)}
                  style={({ pressed }) => [
                    styles.dropdownField,
                    isAssetTypeMenuOpen && styles.dropdownFieldOpen,
                    pressed && styles.dropdownFieldPressed,
                  ]}
                >
                  <View style={styles.dropdownLabelWrap}>
                    <Text style={styles.dropdownLabel}>Selected Asset Type</Text>
                    <Text style={styles.dropdownValue}>
                      {selectedAssetType
                        ? `${selectedAssetType.code} - ${selectedAssetType.name}`
                        : 'Choose an asset type'}
                    </Text>
                  </View>
                  <Text style={styles.dropdownCaret}>{isAssetTypeMenuOpen ? 'Hide' : 'Choose'}</Text>
                </Pressable>

                {isAssetTypeMenuOpen ? (
                  <View style={styles.dropdownOptions}>
                    {assetTypes.map((assetType) => (
                      <SelectCard
                        key={assetType.id}
                        label={`${assetType.code} - ${assetType.name}`}
                        selected={selectedAssetTypeId === assetType.id}
                        onPress={() => {
                          setSelectedAssetTypeId(assetType.id);
                          setIsAssetTypeMenuOpen(false);
                        }}
                      />
                    ))}
                  </View>
                ) : null}
              </>
            )}
          </Card>

          <Card>
            <SectionTitle>Asset Details</SectionTitle>
            <TextField
              label="Asset Code"
              value={assetCode}
              onChangeText={setAssetCode}
              placeholder="Enter the field asset code"
            />
            <TextField
              label="Asset Name (Optional)"
              value={assetName}
              onChangeText={setAssetName}
              placeholder="Enter a readable asset name"
            />
          </Card>

          <Card>
            <SectionTitle>Coordinates</SectionTitle>
            <BodyText muted>Use the current device GPS if it is available, or enter coordinates manually.</BodyText>
            <TextField
              label="Latitude"
              value={latitude}
              onChangeText={setLatitude}
              placeholder="e.g. 2.925900"
              keyboardType="numbers-and-punctuation"
            />
            <TextField
              label="Longitude"
              value={longitude}
              onChangeText={setLongitude}
              placeholder="e.g. 101.690000"
              keyboardType="numbers-and-punctuation"
            />
            <AppButton
              label={isLocating ? 'Reading Current GPS...' : 'Use Current GPS'}
              onPress={handleUseCurrentLocation}
              variant="secondary"
              loading={isLocating}
              disabled={isSubmitting}
            />
            {hasLocationPermission === false ? (
              <BodyText muted>Location permission is off right now. Manual coordinates still work.</BodyText>
            ) : null}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function formatCoordinate(value: number) {
  return value.toFixed(6);
}

function parseCoordinate(
  rawValue: string,
  minimum: number,
  maximum: number,
) {
  const normalizedValue = rawValue.trim();

  if (!normalizedValue) {
    return undefined;
  }

  const parsedValue = Number(normalizedValue);

  if (!Number.isFinite(parsedValue) || parsedValue < minimum || parsedValue > maximum) {
    return 'invalid' as const;
  }

  return parsedValue;
}

const styles = StyleSheet.create({
  dropdownField: {
    minHeight: 64,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#c7d5e8',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    alignItems: 'center',
  },
  dropdownFieldOpen: {
    borderColor: '#0f5cd8',
    backgroundColor: '#eef4ff',
  },
  dropdownFieldPressed: {
    opacity: 0.94,
  },
  dropdownLabelWrap: {
    flex: 1,
    gap: 6,
  },
  dropdownLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#607086',
  },
  dropdownValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  dropdownCaret: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f5cd8',
  },
  dropdownOptions: {
    paddingTop: 12,
    gap: 10,
  },
});
