import { Image } from 'expo-image';
import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { PixelRatio, Platform, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { type StampLines } from '@/services/inspection/stamp';

import { wizardColors } from '../tokens/wizard';

export type StampJob = {
  readonly uri: string;
  /** Output size in pixels; the source is already upright at this size. */
  readonly width: number;
  readonly height: number;
  readonly quality: number;
  readonly lines: StampLines;
};

export type PhotoStamperHandle = {
  /** Resolves with a temporary JPEG: the photo with the location bar burned in. */
  stamp: (job: StampJob) => Promise<string>;
};

type Pending = { job: StampJob; resolve: (uri: string) => void; reject: (cause: unknown) => void };

// iOS: renderInContext (the screen-bound default snapshots an off-screen canvas blank), sizes in points; Android: pixels.
function captureOptions(job: StampJob, pointsW: number, pointsH: number) {
  const common = { format: 'jpg', quality: job.quality, result: 'tmpfile' } as const;
  return Platform.OS === 'ios'
    ? { ...common, width: pointsW, height: pointsH, useRenderInContext: true }
    : { ...common, width: job.width, height: job.height };
}

// Renders one photo plus its location bar behind the camera UI and snapshots it to a JPEG.
export function PhotoStamper({ ref }: { ref: Ref<PhotoStamperHandle> }) {
  const view = useRef<View>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      stamp: (job) => new Promise<string>((resolve, reject) => setPending({ job, resolve, reject })),
    }),
    [],
  );

  if (pending === null) return null;
  const { job } = pending;
  const ratio = PixelRatio.get();
  const width = job.width / ratio;
  const height = job.height / ratio;
  const font = Math.max(7, Math.min(width, height) / 26);

  // Two frames after load so the decoded bitmap is drawn before the snapshot.
  const onLoad = () =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        captureRef(view, captureOptions(job, width, height))
          .then(pending.resolve, pending.reject)
          .finally(() => setPending(null));
      }),
    );

  return (
    <View ref={view} collapsable={false} pointerEvents="none" style={[styles.canvas, { width, height }]}>
      <Image
        source={{ uri: job.uri }}
        contentFit="cover"
        transition={0}
        style={StyleSheet.absoluteFill}
        onLoad={onLoad}
        onError={() => {
          pending.reject(new Error('stamp: photo did not load'));
          setPending(null);
        }}
      />
      <View style={[styles.bar, { padding: font * 0.6, gap: font * 0.2 }]}>
        <View style={styles.row}>
          <Text style={[styles.text, styles.bold, styles.flex, { fontSize: font }]} numberOfLines={1}>
            {job.lines.title}
          </Text>
          <Text style={[styles.text, styles.bold, { fontSize: font }]} numberOfLines={1}>
            {job.lines.time}
          </Text>
        </View>
        <Text style={[styles.text, { fontSize: font }]} numberOfLines={1}>
          {job.lines.coords}
        </Text>
        <Text style={[styles.text, { fontSize: font * 0.85 }]} numberOfLines={2}>
          {job.lines.address}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { position: 'absolute', left: 0, top: 0, overflow: 'hidden', backgroundColor: wizardColors.tileInner },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: wizardColors.scrim },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  text: { color: wizardColors.white },
  bold: { fontWeight: '700' },
});
