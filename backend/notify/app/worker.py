"""The worker process: everything that happens after a 202.

    python -m app.worker

Five loops in one process, supervised together:

    dispatcher   outbox rows            -> broker
    fan-out      notification.created   -> deliveries rows + delivery.{channel}
    delivery     delivery.{channel}     -> the channel adapter
    scheduler    retry:{topic}          -> the stream, when due
    reclaimer    abandoned pending      -> back to a live consumer

## One process, not five containers

Because they are all IO-bound, and asyncio runs them concurrently in one event
loop for a fraction of the memory of five containers. Scaling is by replica: run
this image twice and every loop in it is safe to run twice — the dispatcher uses
SKIP LOCKED, the consumers use a consumer group, the scheduler's promotion is
atomic inside Redis, and the reclaimer only takes what has been idle for minutes.

The cost is that one crashed loop must not take the others down silently, which
is what the supervision below is for: if any task exits, the process exits, and
the orchestrator restarts it. A worker with three of its five loops running looks
healthy and delivers nothing, which is a far worse failure than a restart.

## Shutdown

SIGTERM sets the stop event. Each loop finishes the message it is on, then
returns. A message read but not acknowledged when the process dies is not lost —
it stays pending, and the reclaimer on another replica picks it up. That is the
same mechanism as a hard kill, so the graceful path and the violent path converge
on the same guarantee rather than each having their own.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import signal
import socket
import uuid

import httpx
import structlog

from app import retry
from app.broker import create_broker
from app.channels import create_channels
from app.config import get_settings
from app.db import dispose_engine, get_session_factory
from app.delivery import DeliveryWorker
from app.dispatcher import OutboxDispatcher
from app.fanout import FanoutWorker
from app.logging_config import configure_logging
from app.maintenance import Handler, Reclaimer, RetryScheduler
from app.recipients import RecipientDirectory

logger = structlog.get_logger(__name__)


def consumer_name() -> str:
    """A name unique to this process, stable for its lifetime.

    It ends up in Redis' pending-entries list, so it is what identifies the
    holder of an unacknowledged message. The hostname alone is not enough — two
    replicas on one host would share it, and reclaiming would then be ambiguous.
    """
    return f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:6]}"


async def main() -> None:
    settings = get_settings()
    configure_logging(settings)

    name = consumer_name()
    stop = asyncio.Event()

    broker = create_broker(settings)
    sessions = get_session_factory()
    http = httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0))
    directory = RecipientDirectory(settings, http)
    channels = create_channels(settings)

    dispatcher = OutboxDispatcher(settings, broker, sessions)
    fanout = FanoutWorker(settings, broker, sessions, directory, name)

    delivery_workers = [
        DeliveryWorker(settings, broker, sessions, adapter, directory, name)
        for adapter in channels.values()
    ]

    # Every topic a consumer group reads, mapped to the handler that owns it.
    # The reclaimer needs this so that a reclaimed message goes back through
    # exactly the same code as a fresh one.
    handlers: dict[str, Handler] = {fanout.topic: fanout.handle}
    for worker in delivery_workers:
        handlers[worker.topic] = worker.handle

    scheduler = RetryScheduler(settings, broker, [w.topic for w in delivery_workers])
    reclaimer = Reclaimer(settings, broker, handlers, name)

    logger.info(
        "worker_starting",
        consumer=name,
        channels=sorted(channels),
        topics=sorted(handlers),
        retry_ladder_seconds=retry.describe_ladder(settings),
        email_provider=settings.email_provider,
    )

    loop = asyncio.get_running_loop()
    for received in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(received, stop.set)

    tasks = [
        asyncio.create_task(dispatcher.run(stop), name="dispatcher"),
        asyncio.create_task(fanout.run(stop), name="fanout"),
        asyncio.create_task(scheduler.run(stop), name="scheduler"),
        asyncio.create_task(reclaimer.run(stop), name="reclaimer"),
        *(
            asyncio.create_task(worker.run(stop), name=f"delivery:{worker.channel}")
            for worker in delivery_workers
        ),
    ]

    # FIRST_COMPLETED, not gather. Every one of these runs until told to stop, so
    # any of them returning early is news — and a worker still holding four of its
    # five loops open would keep passing a liveness check while silently
    # delivering nothing.
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)

    if not stop.is_set():
        for task in done:
            logger.error("worker_loop_exited_unexpectedly", task=task.get_name())
        stop.set()

    for task in pending:
        task.cancel()
    for task in pending:
        with contextlib.suppress(asyncio.CancelledError):
            await task

    # Surface a crash rather than exiting 0 on it. An orchestrator restarts a
    # non-zero exit and leaves a zero one alone.
    failure: BaseException | None = None
    for task in done:
        if not task.cancelled() and task.exception() is not None:
            failure = task.exception()
            logger.error("worker_loop_failed", task=task.get_name(), error=str(failure))

    for adapter in channels.values():
        await adapter.close()
    await http.aclose()
    await broker.close()
    await dispose_engine()

    logger.info("worker_stopped", consumer=name)
    if failure is not None:
        raise failure


def run() -> None:
    # KeyboardInterrupt is a clean stop, not a crash: the signal handler above has
    # already set the stop event and the loops have already drained.
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(main())


if __name__ == "__main__":
    run()
