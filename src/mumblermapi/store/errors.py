"""What the store refuses"""


class StoreError(ValueError):
    """The change is not possible"""


class NoSuchChannel(StoreError):
    """The channel does not exist"""


class ChannelExists(StoreError):
    """A channel of that name is already there"""


class TooDeep(StoreError):
    """The channel would nest deeper than Murmur takes"""
