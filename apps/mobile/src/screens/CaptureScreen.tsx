/**
 * CaptureScreen — launches the system camera to capture a real photo,
 * then runs the FieldEdge pipeline: GPS → CLIP embed → upsert → WAL.
 *
 * Uses react-native-image-picker, which invokes Android's native camera
 * intent. The returned file is a real JPEG on disk; we read EXIF GPS,
 * run CLIP inference on the actual pixels, and persist the embedding
 * to the local shard.
 */

import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  Alert,
  ScrollView,
  Image,
} from 'react-native';
import { launchCamera, Asset } from 'react-native-image-picker';
import { processCapture } from '../services/capture';
import { DEMO_PROJECTS } from '../config';

interface Props {
  onCaptured: (photoId: string) => void;
  onCancel: () => void;
}

export function CaptureScreen({ onCaptured, onCancel }: Props) {
  const [projectId, setProjectId] = useState(DEMO_PROJECTS[0].id);
  const [busy, setBusy] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<Asset | null>(null);

  const takePhoto = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await launchCamera({
        mediaType: 'photo',
        cameraType: 'back',
        saveToPhotos: false,
        quality: 0.92,
        includeBase64: false,
      });

      if (result.didCancel) {
        setBusy(false);
        return;
      }
      if (result.errorCode) {
        Alert.alert('Camera error', result.errorMessage ?? result.errorCode);
        setBusy(false);
        return;
      }
      const asset = result.assets?.[0];
      if (!asset?.uri) {
        Alert.alert('No photo captured');
        setBusy(false);
        return;
      }

      setPreviewUri(asset.uri);
      setPreviewMeta(asset);

      const capture = await processCapture({
        photoUri: asset.uri,
        width: asset.width ?? 0,
        height: asset.height ?? 0,
        projectId,
      });

      console.log(
        `Captured ${capture.photoId} (${capture.embeddingStatus})`,
      );
      onCaptured(capture.photoId);
    } catch (e) {
      console.error('Capture failed:', e);
      Alert.alert('Capture failed', String(e));
    } finally {
      setBusy(false);
    }
  };

  const retake = () => {
    setPreviewUri(null);
    setPreviewMeta(null);
  };

  if (previewUri) {
    return (
      <View style={styles.container}>
        <Image
          source={{ uri: previewUri }}
          style={styles.preview}
          resizeMode="contain"
        />
        <View style={styles.previewOverlay}>
          <Text style={styles.previewMeta}>
            {previewMeta?.fileName ?? 'capture.jpg'} ·{' '}
            {previewMeta?.width ?? '?'}×{previewMeta?.height ?? '?'} ·{' '}
            {Math.round((previewMeta?.fileSize ?? 0) / 1024)}KB
          </Text>
          <View style={styles.previewRow}>
            <Pressable style={styles.btn} onPress={retake}>
              <Text style={styles.btnText}>Retake</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Capture a photo</Text>
      <Text style={styles.subtitle}>
        Photo runs through real CLIP inference, GPS is read from device, and
        the 512-dim embedding is persisted to the on-device shard.
      </Text>

      <Text style={styles.section}>Project</Text>
      <View style={styles.projectStrip}>
        {DEMO_PROJECTS.map((p) => (
          <Pressable
            key={p.id}
            style={[
              styles.projectChip,
              projectId === p.id && { backgroundColor: p.color },
            ]}
            onPress={() => setProjectId(p.id)}
          >
            <Text style={styles.projectChipText}>{p.name}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        style={[styles.shutter, busy && styles.shutterBusy]}
        onPress={takePhoto}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.shutterLabel}>Open camera</Text>
        )}
      </Pressable>

      <Pressable style={styles.btnSecondary} onPress={onCancel}>
        <Text style={styles.btnText}>Cancel</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#0E1116',
    padding: 24,
    paddingTop: 48,
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: '#9BA3AF',
    fontSize: 14,
    marginBottom: 24,
    lineHeight: 20,
  },
  section: {
    color: '#9BA3AF',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  projectStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 32,
  },
  projectChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#1F2937',
    borderRadius: 18,
  },
  projectChipText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
  shutter: {
    backgroundColor: '#00BFA6',
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  shutterBusy: {
    opacity: 0.5,
  },
  shutterLabel: {
    color: '#003B33',
    fontSize: 16,
    fontWeight: '700',
  },
  btn: {
    backgroundColor: '#00BFA6',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  btnSecondary: {
    paddingVertical: 14,
    backgroundColor: '#1F2937',
    borderRadius: 12,
    alignItems: 'center',
  },
  btnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  preview: {
    flex: 1,
    width: '100%',
    backgroundColor: '#000',
  },
  previewOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  previewMeta: {
    color: '#9BA3AF',
    fontSize: 12,
    marginBottom: 16,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
});
