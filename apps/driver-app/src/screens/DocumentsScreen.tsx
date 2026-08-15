import type { DocumentType, DriverDocument } from '@rideshare/types';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { ApiClientError, getOwnDocuments, uploadDocument } from '../lib/apiClient';

const DOCUMENT_TYPES: { type: DocumentType; label: string }[] = [
  { type: 'DRIVER_LICENSE', label: 'Driver License' },
  { type: 'VEHICLE_REGISTRATION', label: 'Vehicle Registration' },
  { type: 'INSURANCE', label: 'Insurance' },
  { type: 'PROFILE_PHOTO', label: 'Profile Photo' },
];

const STATUS_LABEL: Record<DriverDocument['reviewStatus'], string> = {
  PENDING: 'Under review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  REPLACEMENT_REQUESTED: 'Replacement requested',
};

const STATUS_COLOR: Record<DriverDocument['reviewStatus'], string> = {
  PENDING: '#fbbf24',
  APPROVED: '#4ade80',
  REJECTED: '#f87171',
  REPLACEMENT_REQUESTED: '#fb923c',
};

/**
 * Section 15: "Implement secure document system." One card per document
 * type (not per upload) — the backend keeps every past upload
 * (documentsRepository.createDocument never supersedes an earlier row),
 * but a driver only cares about their most recent submission for each
 * type, so this screen shows the latest row per type. Uploading picks
 * an image via expo-image-picker (base64: true) and posts it straight
 * through to the API — no client-side "preview before you submit" step,
 * matching how VehicleScreen/OnboardingScreen submit-on-action rather
 * than stage-then-confirm.
 */
export function DocumentsScreen() {
  const { accessToken } = useAuth();
  const [documents, setDocuments] = useState<DriverDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadingType, setUploadingType] = useState<DocumentType | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Bumped after a successful upload to re-trigger the fetch effect
  // below — keeping the actual fetch call inline in the effect (rather
  // than referencing an externally-defined function) is what
  // react-hooks/set-state-in-effect wants here.
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string) {
      setIsLoading(true);
      try {
        const result = await getOwnDocuments(token);
        if (!cancelled) setDocuments(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof ApiClientError ? error.message : 'Could not load your documents.',
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load(accessToken);
    return () => {
      cancelled = true;
    };
  }, [accessToken, refreshCount]);

  function latestFor(type: DocumentType): DriverDocument | undefined {
    return documents
      .filter((document) => document.documentType === type)
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0];
  }

  async function handleUpload(type: DocumentType) {
    if (!accessToken) return;
    setErrorMessage(null);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setErrorMessage('Photo library access is required to upload a document.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.6,
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset?.base64) return;
    const contentBase64 = asset.base64;

    setUploadingType(type);
    try {
      await uploadDocument(accessToken, {
        documentType: type,
        contentBase64,
        contentType: asset.mimeType || 'image/jpeg',
      });
      setRefreshCount((count) => count + 1);
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'Could not upload this document.',
      );
    } finally {
      setUploadingType(null);
    }
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Documents</Text>
      <Text style={styles.subtitle}>
        Upload each document once. An admin reviews it, then it&apos;s either approved, rejected
        with a reason, or flagged for replacement.
      </Text>

      {errorMessage && (
        <Text style={styles.error} testID="documents-error">
          {errorMessage}
        </Text>
      )}

      {isLoading && documents.length === 0 ? (
        <ActivityIndicator color="#fbbf24" style={styles.loading} />
      ) : (
        DOCUMENT_TYPES.map(({ type, label }) => {
          const latest = latestFor(type);
          return (
            <View key={type} style={styles.card} testID={`document-card-${type}`}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{label}</Text>
                {latest && (
                  <View style={[styles.badge, { backgroundColor: STATUS_COLOR[latest.reviewStatus] }]}>
                    <Text style={styles.badgeText}>{STATUS_LABEL[latest.reviewStatus]}</Text>
                  </View>
                )}
              </View>

              {latest ? (
                <Text style={styles.meta}>
                  Uploaded {new Date(latest.uploadedAt).toLocaleDateString()}
                  {latest.expiresAt
                    ? ` · expires ${new Date(latest.expiresAt).toLocaleDateString()}`
                    : ''}
                </Text>
              ) : (
                <Text style={styles.meta}>Not uploaded yet</Text>
              )}

              {latest?.rejectionReason && <Text style={styles.reason}>{latest.rejectionReason}</Text>}

              <Pressable
                style={[styles.uploadButton, uploadingType === type && styles.uploadButtonDisabled]}
                onPress={() => void handleUpload(type)}
                disabled={uploadingType === type}
                testID={`upload-button-${type}`}
              >
                {uploadingType === type ? (
                  <ActivityIndicator color="#1c1917" />
                ) : (
                  <Text style={styles.uploadButtonText}>{latest ? 'Upload replacement' : 'Upload'}</Text>
                )}
              </Pressable>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#1c1917' },
  container: { flexGrow: 1, padding: 20 },
  title: { color: '#fafaf9', fontSize: 20, fontWeight: '700' },
  subtitle: { color: '#a8a29e', fontSize: 14, marginTop: 4, marginBottom: 16 },
  loading: { marginTop: 24 },
  error: { color: '#f87171', marginBottom: 12, textAlign: 'center' },
  card: {
    backgroundColor: '#292524',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: '#fafaf9', fontSize: 16, fontWeight: '600' },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: '#1c1917', fontSize: 12, fontWeight: '700' },
  meta: { color: '#a8a29e', fontSize: 13, marginTop: 6 },
  reason: { color: '#fb923c', fontSize: 13, marginTop: 6 },
  uploadButton: {
    backgroundColor: '#fbbf24',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  uploadButtonDisabled: { opacity: 0.6 },
  uploadButtonText: { color: '#1c1917', fontSize: 14, fontWeight: '700' },
});
