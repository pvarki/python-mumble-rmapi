"""Reconciling Murmur's channels with the plan"""

from __future__ import annotations

from mumblermapi.agent.reconcile import ChannelRefused, ExistingChannel, prune, reconcile
from mumblermapi.channels import ChannelSpec, desired_tree, parse_plan


class FakeChannels:
    """An in-memory Murmur channel list; 0 is the root"""

    def __init__(self, existing: list[ExistingChannel] | None = None) -> None:
        self.existing = existing or []
        self.descriptions: dict[int, str] = {}

    def channels(self) -> list[ExistingChannel]:
        return [ExistingChannel(0, -1, "Root"), *self.existing]

    def add_channel(self, name: str, parent: int, description: str) -> int:
        channel_id = len(self.existing) + 1
        self.existing.append(ExistingChannel(channel_id, parent, name, description=description))
        self.descriptions[channel_id] = description
        return channel_id

    def set_description(self, channel_id: int, description: str) -> None:
        self.descriptions[channel_id] = description
        self.existing = [
            ExistingChannel(c.id, c.parent, c.name, c.temporary, description) if c.id == channel_id else c
            for c in self.existing
        ]

    def remove_channel(self, channel_id: int) -> None:
        gone = {channel_id}
        while True:
            more = {c.id for c in self.existing if c.parent in gone} - gone
            if not more:
                break
            gone |= more
        self.existing = [c for c in self.existing if c.id not in gone]


def test_reconcile_creates_tree_once() -> None:
    """An empty server gets the whole tree; a second pass changes nothing"""
    server = FakeChannels()
    desired = desired_tree(
        parse_plan({"channels": [{"name": "10", "description": "A", "channels": [{"name": "101"}]}]})
    )
    created, refused = reconcile(server, desired)
    assert created[:3] == ["/Units", "/Units/10", "/Units/10/101"] and refused == []
    assert "/Teams/Dark Blue" in created and "/Roles/Medic" in created
    platoon = next(c for c in server.existing if c.name == "10")
    squad = next(c for c in server.existing if c.name == "101")
    assert squad.parent == platoon.id
    assert server.descriptions[platoon.id] == "A"
    assert reconcile(server, desired) == ([], [])


def test_reconcile_fills_gaps_only() -> None:
    """Existing channels are kept, and missing children land under them"""
    server = FakeChannels([ExistingChannel(7, 0, "Units")])
    created, _ = reconcile(server, (ChannelSpec("Units", children=(ChannelSpec("20"),)),))
    assert created == ["/Units/20"]
    assert server.existing[-1] == ExistingChannel(2, 7, "20")


def test_reconcile_skips_a_refused_channel() -> None:
    """A channel Murmur refuses is left out with what is under it; its siblings and the other branches go in"""

    class Refusing(FakeChannels):
        def add_channel(self, name: str, parent: int, description: str) -> int:
            if name == "deep":
                raise ChannelRefused(name)
            return super().add_channel(name, parent, description)

    server = Refusing()
    units = (ChannelSpec("deep", children=(ChannelSpec("under"),)), ChannelSpec("10"))
    desired = (ChannelSpec("Units", children=units), ChannelSpec("Teams", children=(ChannelSpec("Red"),)))
    assert reconcile(server, desired) == (["/Units", "/Units/10", "/Teams", "/Teams/Red"], ["/Units/deep"])
    assert reconcile(server, desired) == ([], ["/Units/deep"])


def test_reconcile_corrects_descriptions() -> None:
    """An edited description reaches Murmur once; an unchanged one is left alone"""
    server = FakeChannels([ExistingChannel(1, 0, "Units"), ExistingChannel(2, 1, "10", description="old")])
    plan = (ChannelSpec("Units", children=(ChannelSpec("10", "Alfa-joukkue"),)),)
    assert reconcile(server, plan) == ([], [])
    assert server.descriptions == {2: "Alfa-joukkue"}
    server.descriptions.clear()
    reconcile(server, plan)
    assert server.descriptions == {}


def test_prune_removes_what_the_plan_dropped() -> None:
    """Dropped permanent channels go with their subtrees; kept ones and users' temporary channels stay"""
    server = FakeChannels(
        [
            ExistingChannel(1, 0, "Units"),
            ExistingChannel(2, 1, "10"),
            ExistingChannel(3, 2, "101"),
            ExistingChannel(4, 2, "102"),
            ExistingChannel(5, 4, "102 A"),
            ExistingChannel(6, 1, "20"),
            ExistingChannel(7, 2, "huddle", temporary=True),
            ExistingChannel(8, 0, "Teams"),
        ]
    )
    removed = prune(server, (ChannelSpec("10", children=(ChannelSpec("101"),)),), root=1, prefix="/Units")
    assert removed == ["/Units/10/102", "/Units/20"]
    assert sorted(c.id for c in server.existing) == [1, 2, 3, 7, 8]
    assert prune(server, (ChannelSpec("10", children=(ChannelSpec("101"),)),), root=1) == []
