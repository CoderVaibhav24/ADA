"""Augmentation.

The augmentations are chosen against one specific problem, not from a default
recipe. ADA compares a satellite epoch with a drone epoch: different sensor,
different sun angle, different season, and on one epoch colour-infrared rather
than true colour. The training sets are all single-sensor French or African
aerial imagery. So the job of augmentation here is to stop the network keying
on absolute colour and brightness, because those are exactly what will not
survive the move to Agra.

That is also why the geometric set is mild. Buildings and roads have real
orientation statistics, and 90-degree rotations plus flips cover the honest
symmetries of a nadir view; free rotation mostly manufactures interpolation
artefacts and black corners.
"""

from __future__ import annotations


def train_transform(crop: int, in_channels: int = 3):
    import albumentations as A

    return A.Compose([
        # Random crop first so every later op runs on the small array.
        A.RandomCrop(height=crop, width=crop) if crop else A.NoOp(),
        A.HorizontalFlip(p=0.5),
        A.VerticalFlip(p=0.5),
        A.RandomRotate90(p=0.75),

        # The colour block. This is the part that matters for the domain gap.
        A.RandomBrightnessContrast(
            brightness_limit=0.25, contrast_limit=0.25, p=0.8),
        A.HueSaturationValue(
            hue_shift_limit=12, sat_shift_limit=25, val_shift_limit=15, p=0.5),
        # Per-channel gamma drift stands in for a different sensor response
        # curve, which is the actual difference between the two ADA epochs.
        A.RandomGamma(gamma_limit=(70, 140), p=0.4),

        # Sensor and altitude differences: the drone epoch is sharper than the
        # satellite epoch, so train across both.
        A.OneOf([
            A.GaussianBlur(blur_limit=(3, 5)),
            A.Sharpen(alpha=(0.1, 0.35)),
            A.GaussNoise(std_range=(0.02, 0.12)),
        ], p=0.3),

        # Shadow and occlusion. Shadowed roofs are the documented failure of
        # the current segmenters, and the reason SAM 2.1 has to repair outlines.
        A.CoarseDropout(
            num_holes_range=(1, 4),
            hole_height_range=(crop // 24, crop // 12),
            hole_width_range=(crop // 24, crop // 12),
            # fill_mask=None leaves the label untouched: the dropout is an
            # occlusion in the image, not a change to the ground truth.
            fill=0, fill_mask=None, p=0.2),
    ])


def val_transform(crop: int, in_channels: int = 3):
    """Validation is deterministic. A centre crop, nothing else.

    No augmentation and no random crop: a validation number that moves between
    epochs because the crop moved is useless for deciding when to stop.
    """
    import albumentations as A

    return A.Compose([
        A.CenterCrop(height=crop, width=crop) if crop else A.NoOp(),
    ])
