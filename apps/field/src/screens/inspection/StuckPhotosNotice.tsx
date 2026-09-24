import { Glyph, Notice, WButton, WIcon } from '@/design-system/organisms/wizard/kit';
import { useT } from '@/services/i18n';
import { retryPhoto } from '@/services/inspection/evidence';
import type { StuckPhotos } from '@/services/inspection/queries';

// A held submit waiting on a photo that will not go by itself, with the one thing to do about it.
export function StuckPhotosNotice({ stuck, onOpenPhotos }: { stuck: StuckPhotos; onOpenPhotos: () => void }) {
  const t = useT();
  if (stuck.retake.length === 0 && stuck.retry.length === 0) return null;
  const retake = stuck.retake.length > 0;
  return (
    <Notice tone="error" icon="retake" title={t('review.stuck.title')} body={t(retake ? 'review.stuck.retake' : 'review.stuck.retry')}>
      {retake ? (
        <WButton label={t('review.stuck.photos')} onPress={onOpenPhotos} leading={<Glyph name="camera" size={20} />} />
      ) : (
        <WButton
          label={t('photos.retry')}
          onPress={() => stuck.retry.forEach((record) => retryPhoto(record))}
          leading={<WIcon name="sync" size={18} />}
        />
      )}
    </Notice>
  );
}
