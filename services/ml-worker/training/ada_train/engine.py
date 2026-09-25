"""The training loop.

Written for one specific machine: a Lenovo LOQ with an RTX 4050 Laptop (6 GB
VRAM), 24 GB of system RAM, Windows, and both the dataset and the checkpoints
on an external USB SSD. Three consequences shape the whole file:

1. CHECKPOINT AND RESUME IS LOAD-BEARING, NOT A CONVENIENCE. A run takes one
   to four days. On a Windows laptop the things that end a run are a forced
   update reboot, a closed lid, a bumped USB cable and an unplugged charger --
   not anything numerical. Everything needed to continue mid-epoch is saved
   every `save_every_steps`: model, optimiser, scheduler, scaler, step, epoch,
   best metric, and the RNG states of torch, numpy and CUDA. Resuming lands on
   the same sample order it would have had.

2. THE EFFECTIVE BATCH IS DECOUPLED FROM VRAM. 6 GB holds batch 4 at 512 px in
   bf16; segmentation wants more than that for stable BatchNorm. Gradient
   accumulation gives an effective 16 without the memory.

3. GRADIENTS ARE NEVER SYNCHRONISED WITH THE HOST INSIDE A STEP. Metrics
   accumulate on the device (see metrics.ConfusionMatrix) and the loss is
   summed on the device, because a `.item()` per batch on a laptop GPU costs
   real throughput at these batch sizes.

Thermals are worth stating plainly and are not handled in code: sustained load
puts the GPU at 80-87C and the CPU at 85-95C, and the clocks will drop 15-30%
after the first twenty minutes. That is throttling, not failure -- it is priced
into the wall-clock estimates in the README.
"""

from __future__ import annotations

import json
import logging
import math
import time
from pathlib import Path

import numpy as np

from . import device as dev
from . import losses as losses_mod
from . import metrics as metrics_mod
from . import models as models_mod

log = logging.getLogger("ada.train")


def _seed_everything(seed: int) -> None:
    import random

    import torch
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def _loader(dataset, cfg, *, train: bool):
    from torch.utils.data import DataLoader

    workers = cfg.data.workers if len(dataset) else 0
    kwargs = dict(
        batch_size=cfg.train.batch_size,
        shuffle=train,
        num_workers=workers,
        pin_memory=cfg.data.pin_memory and cfg.device != "cpu",
        drop_last=train,
    )
    if workers > 0:
        # On Windows every worker is a fresh process (spawn, not fork), so
        # re-creating them each epoch costs seconds of startup per epoch and
        # re-warms nothing. persistent_workers is what makes six affordable.
        kwargs["persistent_workers"] = cfg.data.persistent_workers
        kwargs["prefetch_factor"] = cfg.data.prefetch_factor
    return DataLoader(dataset, **kwargs)


def _lr_lambda(cfg, total_steps: int):
    warmup = max(1, cfg.train.warmup_steps)

    def fn(step: int) -> float:
        if step < warmup:
            return step / warmup
        progress = (step - warmup) / max(1, total_steps - warmup)
        progress = min(1.0, max(0.0, progress))
        # Cosine to a floor of 1% rather than to zero: the last epochs at a
        # dead-zero learning rate are wall-clock spent for nothing.
        return 0.01 + 0.99 * 0.5 * (1 + math.cos(math.pi * progress))

    return fn


class Trainer:
    def __init__(self, cfg, train_ds, val_ds, info) -> None:
        import torch

        self.cfg = cfg
        self.info = info
        self.device = dev.detect(cfg.device)
        dev.require(self.device)
        dev.tune(self.device, cfg.train.cudnn_benchmark)
        log.info("device -> %s", dev.describe(self.device))

        _seed_everything(cfg.train.seed)

        self.torch = torch
        self.train_ds, self.val_ds = train_ds, val_ds
        self.train_loader = _loader(train_ds, cfg, train=True)
        self.val_loader = _loader(val_ds, cfg, train=False)

        self.model = models_mod.build_model(cfg).to(self.device)
        if cfg.train.channels_last and self.device == "cuda":
            self.model = self.model.to(memory_format=torch.channels_last)

        self.amp_dtype = dev.amp_dtype(cfg.train.precision, self.device)
        # A GradScaler is only needed for fp16. bf16 has fp32's exponent range,
        # so there is nothing to rescale, and on Ada it is the better choice.
        self.scaler = torch.amp.GradScaler(
            self.device, enabled=(self.amp_dtype is torch.float16))

        weights = self._class_weights()
        self.loss_fn = losses_mod.build_loss(cfg, weights)

        self.optimizer = torch.optim.AdamW(
            models_mod.param_groups(
                self.model, cfg.train.lr, cfg.train.encoder_lr_scale,
                cfg.train.weight_decay),
            betas=(0.9, 0.999),
        )

        self.steps_per_epoch = max(1, len(self.train_loader) // cfg.train.grad_accum)
        self.total_steps = self.steps_per_epoch * cfg.train.epochs
        self.scheduler = torch.optim.lr_scheduler.LambdaLR(
            self.optimizer, _lr_lambda(cfg, self.total_steps))

        self.run_dir = cfg.run_dir
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.epoch = 0
        self.global_step = 0
        self.best = -1.0
        self.since_best = 0

        self._save_config()
        if cfg.resume:
            self._maybe_resume()

    # --- setup helpers -------------------------------------------------------

    def _class_weights(self):
        cfg = self.cfg
        if cfg.task != "multiclass" or cfg.loss.class_weights == "none":
            return None
        cache = cfg.run_dir / "class_weights.json"
        if cache.is_file():
            with cache.open("r", encoding="utf-8") as fh:
                values = json.load(fh)
            log.info("loaded cached class weights from %s", cache)
            return self.torch.tensor(values, dtype=self.torch.float32,
                                     device=self.device)
        if cfg.loss.class_weights != "auto":
            values = [float(x) for x in str(cfg.loss.class_weights).split(",")]
            return self.torch.tensor(values, dtype=self.torch.float32,
                                     device=self.device)
        log.info("estimating class weights from a sample of the training set")
        weights = losses_mod.estimate_class_weights(
            self.train_ds, cfg.model.classes, cfg.loss.ignore_index,
            seed=cfg.train.seed)
        cfg.run_dir.mkdir(parents=True, exist_ok=True)
        with cache.open("w", encoding="utf-8") as fh:
            json.dump(weights.tolist(), fh)
        return weights.to(self.device)

    def _save_config(self) -> None:
        import yaml
        with (self.run_dir / "config.yaml").open("w", encoding="utf-8") as fh:
            yaml.safe_dump(self.cfg.raw, fh, sort_keys=False)

    # --- checkpointing -------------------------------------------------------

    def _state(self) -> dict:
        return {
            "model": self.model.state_dict(),
            "optimizer": self.optimizer.state_dict(),
            "scheduler": self.scheduler.state_dict(),
            "scaler": self.scaler.state_dict(),
            "epoch": self.epoch,
            "global_step": self.global_step,
            "best": self.best,
            "since_best": self.since_best,
            "config": self.cfg.raw,
            "info": {k: v for k, v in self.info.items() if k != "labels"},
            "labels": {str(k): v for k, v in self.info["labels"].items()},
            "rng": {
                "torch": self.torch.get_rng_state(),
                "cuda": (self.torch.cuda.get_rng_state_all()
                         if self.device == "cuda" else None),
                "numpy": np.random.get_state(),
            },
        }

    def _save(self, name: str) -> Path:
        path = self.run_dir / name
        tmp = path.with_suffix(".tmp")
        # Write to a temporary file and replace. A power cut or a yanked USB
        # cable during the write would otherwise leave a truncated last.pt and
        # cost the whole run rather than one interval.
        self.torch.save(self._state(), tmp)
        tmp.replace(path)
        return path

    def _maybe_resume(self) -> None:
        path = self.run_dir / "last.pt"
        if not path.is_file():
            log.info("no checkpoint at %s -- starting from scratch", path)
            return
        state = self.torch.load(path, map_location=self.device, weights_only=False)
        self.model.load_state_dict(state["model"])
        self.optimizer.load_state_dict(state["optimizer"])
        self.scheduler.load_state_dict(state["scheduler"])
        self.scaler.load_state_dict(state["scaler"])
        self.epoch = state["epoch"]
        self.global_step = state["global_step"]
        self.best = state["best"]
        self.since_best = state.get("since_best", 0)
        rng = state.get("rng") or {}
        if rng.get("torch") is not None:
            torch_rng = rng["torch"]
            self.torch.set_rng_state(torch_rng.cpu() if hasattr(torch_rng, "cpu") else torch_rng)
        if rng.get("numpy") is not None:
            np.random.set_state(rng["numpy"])
        if self.device == "cuda" and rng.get("cuda") is not None:
            self.torch.cuda.set_rng_state_all(rng["cuda"])
        log.info("resumed from %s at epoch %d, step %d (best %.4f)",
                 path, self.epoch, self.global_step, self.best)

    # --- logging -------------------------------------------------------------

    def _log_jsonl(self, record: dict) -> None:
        with (self.run_dir / "metrics.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")

    # --- the loop ------------------------------------------------------------

    def fit(self) -> dict:
        torch = self.torch
        cfg = self.cfg
        from tqdm import tqdm

        log.info("training %d epochs, %d optimiser steps per epoch, "
                 "effective batch %d (%d x %d accumulation)",
                 cfg.train.epochs, self.steps_per_epoch,
                 cfg.train.batch_size * cfg.train.grad_accum,
                 cfg.train.batch_size, cfg.train.grad_accum)

        while self.epoch < cfg.train.epochs:
            self.model.train()
            started = time.time()
            running = torch.zeros((), device=self.device)
            seen = 0
            self.optimizer.zero_grad(set_to_none=True)

            bar = tqdm(self.train_loader, desc=f"epoch {self.epoch + 1}/{cfg.train.epochs}",
                       unit="batch", dynamic_ncols=True)
            for i, (images, targets) in enumerate(bar):
                try:
                    loss = self._train_batch(images, targets, i)
                except torch.cuda.OutOfMemoryError as exc:
                    log.error("%s", dev.oom_advice(cfg))
                    raise RuntimeError(dev.oom_advice(cfg)) from exc

                running += loss.detach()
                seen += 1

                if (i + 1) % cfg.train.grad_accum == 0:
                    self._optimiser_step()
                    if self.global_step % cfg.train.save_every_steps == 0:
                        self._save("last.pt")
                    if seen and self.global_step % 50 == 0:
                        bar.set_postfix(loss=f"{(running / seen).item():.4f}",
                                        lr=f"{self.scheduler.get_last_lr()[0]:.2e}")

            # Any tail batches that did not complete an accumulation cycle.
            if seen % cfg.train.grad_accum:
                self._optimiser_step()

            train_loss = float((running / max(1, seen)).item())
            self.epoch += 1
            elapsed = time.time() - started

            record = {"epoch": self.epoch, "step": self.global_step,
                      "train_loss": train_loss, "epoch_seconds": round(elapsed, 1),
                      "lr": self.scheduler.get_last_lr()[0]}

            if self.epoch % cfg.train.val_every_epochs == 0:
                val = self.validate()
                record["val"] = val
                headline = val["headline"]
                log.info("epoch %d: loss %.4f  %s  [%.1f min]",
                         self.epoch, train_loss,
                         metrics_mod.format_summary(val, cfg.task), elapsed / 60)
                if headline > self.best:
                    self.best = headline
                    self.since_best = 0
                    self._save("best.pt")
                    log.info("new best %.4f -> best.pt", headline)
                else:
                    self.since_best += 1
                    if self.since_best >= cfg.train.early_stop_patience:
                        log.info("no improvement in %d validations -- stopping",
                                 self.since_best)
                        self._log_jsonl(record)
                        self._save("last.pt")
                        break
            else:
                log.info("epoch %d: loss %.4f [%.1f min]",
                         self.epoch, train_loss, elapsed / 60)

            self._log_jsonl(record)
            self._save("last.pt")

        log.info("done. best headline metric %.4f, checkpoints in %s",
                 self.best, self.run_dir)
        return {"best": self.best, "run_dir": str(self.run_dir)}

    def _train_batch(self, images, targets, i: int):
        torch = self.torch
        cfg = self.cfg

        images = images.to(self.device, non_blocking=True)
        if cfg.train.channels_last and self.device == "cuda":
            images = images.contiguous(memory_format=torch.channels_last)
        targets = targets.to(self.device, non_blocking=True)

        with torch.autocast(self.device, dtype=self.amp_dtype,
                            enabled=self.amp_dtype is not None):
            # Normalisation lives here rather than in the dataset so the
            # dataloader ships uint8 across the process boundary -- a quarter
            # of the bytes, which matters with spawned workers on Windows.
            x = images.float() / 255.0
            logits = self.model(x)
            loss = self.loss_fn(logits, targets)
            # Scale by the accumulation factor so the accumulated gradient is
            # the mean over the effective batch, not the sum.
            loss = loss / cfg.train.grad_accum

        self.scaler.scale(loss).backward()
        return loss * cfg.train.grad_accum

    def _optimiser_step(self) -> None:
        cfg = self.cfg
        if cfg.train.clip_grad_norm:
            self.scaler.unscale_(self.optimizer)
            self.torch.nn.utils.clip_grad_norm_(
                self.model.parameters(), cfg.train.clip_grad_norm)
        self.scaler.step(self.optimizer)
        self.scaler.update()
        self.optimizer.zero_grad(set_to_none=True)
        self.scheduler.step()
        self.global_step += 1

    @property
    def _metric_classes(self) -> int:
        return self.cfg.model.classes if self.cfg.task == "multiclass" else 2

    def validate(self) -> dict:
        torch = self.torch
        cfg = self.cfg
        from tqdm import tqdm

        self.model.eval()
        cm = metrics_mod.ConfusionMatrix(
            self._metric_classes, self.device, cfg.loss.ignore_index)

        with torch.inference_mode():
            for images, targets in tqdm(self.val_loader, desc="validating",
                                        unit="batch", leave=False,
                                        dynamic_ncols=True):
                images = images.to(self.device, non_blocking=True)
                if cfg.train.channels_last and self.device == "cuda":
                    images = images.contiguous(memory_format=torch.channels_last)
                targets = targets.to(self.device, non_blocking=True)
                with torch.autocast(self.device, dtype=self.amp_dtype,
                                    enabled=self.amp_dtype is not None):
                    logits = self.model(images.float() / 255.0)
                if cfg.task == "multiclass":
                    pred = logits.float().argmax(dim=1)
                else:
                    pred = (torch.sigmoid(logits.float().squeeze(1)) > 0.5).long()
                cm.update(pred, targets)

        labels = (self.info["labels"] if cfg.task == "multiclass"
                  else {0: "background", 1: "building"})
        return metrics_mod.summarise(
            cm.numpy(), labels, cfg.task, self.info.get("built_classes"))
