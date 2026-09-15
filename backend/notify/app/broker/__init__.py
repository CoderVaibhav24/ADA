"""Message transport. Everything Redis-specific lives in redis_streams.py.

Import from here, not from the adapter:

    from app.broker import Broker, BrokerError, Message, create_broker
"""

from app.broker.base import Broker, BrokerError, Message
from app.broker.factory import create_broker

__all__ = ["Broker", "BrokerError", "Message", "create_broker"]
