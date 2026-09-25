"""Model construction, with the encoder licence checked before any download.

The structural point from the inventory document, restated because it decides
this file: a licence attaches to WEIGHTS and to the terms of the DATA those
weights were trained on -- never to the architecture. Every architecture here
is MIT or Apache-2.0. So the only licence surface in this module is
`encoder_weights`, and the tempting options are the encumbered ones:
nvidia/mit-b* carries NVIDIA's research-only SegFormer terms, and DINOv3 is
gated under a custom Meta licence. Both are refused by name.
"""

from __future__ import annotations

import logging

from . import licences

log = logging.getLogger("ada.train")

# smp architecture name -> constructor attribute
ARCHS = {
    "unet": "Unet",
    "unetplusplus": "UnetPlusPlus",
    "deeplabv3plus": "DeepLabV3Plus",
    "fpn": "FPN",
    "pspnet": "PSPNet",
    "segformer": "Segformer",
}


def _check_encoder_licence(weights: str | None) -> None:
    if weights is None:
        return
    key = str(weights).lower()
    for name, (allowed, note) in licences.ENCODER_VERDICTS.items():
        if name is None:
            continue
        if name in key:
            if not allowed:
                raise licences.LicenceError(
                    f"encoder_weights={weights!r} is refused: {note}")
            log.info("encoder weights %s: %s", weights, note)
            return
    raise licences.LicenceError(
        f"encoder_weights={weights!r} has no verdict in "
        f"licences.ENCODER_VERDICTS. Add one. Undeclared is not permissive."
    )


def build_model(cfg):
    """Build the segmentation model described by the config.

    The output head is chosen by task:
      multiclass -> `classes` logits, argmax/softmax at inference
      binary     -> a single logit, sigmoid at inference, which is exactly the
                    contract both current building segmenters expose
                    (`(N, H, W, 3) uint8 -> (N, H, W) float32 probability`)
    """
    import segmentation_models_pytorch as smp

    _check_encoder_licence(cfg.model.encoder_weights)

    arch = cfg.model.arch.lower()
    if arch not in ARCHS:
        raise ValueError(f"unknown arch {arch!r}; available: {sorted(ARCHS)}")

    out_classes = cfg.model.classes if cfg.task == "multiclass" else 1

    model = getattr(smp, ARCHS[arch])(
        encoder_name=cfg.model.encoder,
        encoder_weights=cfg.model.encoder_weights,
        in_channels=cfg.model.in_channels,
        classes=out_classes,
    )

    if cfg.model.grad_checkpoint:
        _enable_grad_checkpoint(model)

    n_params = sum(p.numel() for p in model.parameters())
    log.info("model: %s + %s (%s weights), %d classes, %.1f M parameters",
             arch, cfg.model.encoder, cfg.model.encoder_weights,
             out_classes, n_params / 1e6)
    return model


def _enable_grad_checkpoint(model) -> None:
    """Best-effort activation checkpointing on the encoder.

    timm encoders expose set_grad_checkpointing; torchvision-derived ones do
    not, so this is a warning rather than an error -- on 6 GB the useful
    fallback is a smaller crop, and device.oom_advice says so in order.
    """
    encoder = getattr(model, "encoder", None)
    fn = getattr(encoder, "set_grad_checkpointing", None)
    if callable(fn):
        fn(True)
        log.info("gradient checkpointing enabled on the encoder")
        return
    inner = getattr(encoder, "model", None)
    fn = getattr(inner, "set_grad_checkpointing", None)
    if callable(fn):
        fn(True)
        log.info("gradient checkpointing enabled on the encoder (timm inner model)")
        return
    log.warning(
        "grad_checkpoint requested but encoder %s does not support it. Use a "
        "timm encoder (prefix the name with 'tu-', e.g. tu-convnext_tiny) or "
        "lower data.crop instead.", cfg_encoder_name(model))


def cfg_encoder_name(model) -> str:
    return type(getattr(model, "encoder", model)).__name__


def param_groups(model, lr: float, encoder_lr_scale: float, weight_decay: float):
    """Two learning rates, and no weight decay on norms or biases.

    The encoder arrives pretrained and the decoder does not, so one learning
    rate either wrecks the encoder's features or starves the decoder. Decaying
    BatchNorm weights and biases is a small but free accuracy loss.
    """
    decay, no_decay, enc_decay, enc_no_decay = [], [], [], []
    for name, param in model.named_parameters():
        if not param.requires_grad:
            continue
        is_encoder = name.startswith("encoder.")
        skip = param.ndim <= 1 or name.endswith(".bias")
        if is_encoder:
            (enc_no_decay if skip else enc_decay).append(param)
        else:
            (no_decay if skip else decay).append(param)

    enc_lr = lr * encoder_lr_scale
    groups = [
        {"params": decay, "lr": lr, "weight_decay": weight_decay},
        {"params": no_decay, "lr": lr, "weight_decay": 0.0},
        {"params": enc_decay, "lr": enc_lr, "weight_decay": weight_decay},
        {"params": enc_no_decay, "lr": enc_lr, "weight_decay": 0.0},
    ]
    return [g for g in groups if g["params"]]
