"""Channel plan parsing and reconciliation"""

from __future__ import annotations

import time
from pathlib import Path

import pytest
import yaml

from mumblermapi.channels import (
    MAX_DEPTH,
    MAX_MEMBERS,
    MAX_NETS,
    ROLES,
    TEAM_COLOURS,
    ChannelPlanError,
    ChannelSpec,
    ExistingChannel,
    desired_tree,
    load_plan,
    load_yaml,
    parse_plan,
    prune,
    reconcile,
)

PLAN = """
channels:
  - name: 00A TIKE
    description: "Tilannepäivystys"
  - name: 10
    description: "Alfa-joukkue"
    channels:
      - name: 101
        description: "Alfa-Ryhmä1"
      - name: 102
"""


def test_load_plan(tmp_path: Path) -> None:
    """The 2022 schema loads, numeric names included"""
    plan = tmp_path / "channels.yaml"
    plan.write_text(PLAN, encoding="utf-8")
    assert load_plan(plan) == (
        ChannelSpec("00A TIKE", "Tilannepäivystys"),
        ChannelSpec("10", "Alfa-joukkue", (ChannelSpec("101", "Alfa-Ryhmä1"), ChannelSpec("102"))),
    )


@pytest.mark.parametrize(
    ("data", "match"),
    [
        (None, "top-level"),
        ({"nets": []}, "top-level"),
        ({"channels": {}}, "expected a list"),
        ({"channels": ["101"]}, "expected a mapping"),
        ({"channels": [{"description": "x"}]}, "invalid name"),
        ({"channels": [{"name": 10}]}, "invalid name of type int"),  # the plan loader reads names as text
        ({"channels": [{"name": "a/b"}]}, "invalid name"),
        ({"channels": [{"name": "x" * 101}]}, "invalid name"),
        ({"channels": [{"name": "Alpha\n"}]}, "invalid name"),
        ({"channels": [{"name": "a", "description": 3}]}, "description"),
        ({"channels": [{"name": "a", "description": "x" * 1001}]}, "at most 1000 characters"),
        ({"channels": [{"name": "a"}, {"name": "a"}]}, "duplicate"),
        ({"channels": [{"name": "a", "access": "secret"}]}, "access must be"),
        ({"channels": [{"name": "a", "channels": [{"name": True}]}]}, r"channels\[0\]\.channels\[0\]"),
    ],
)
def test_parse_plan_rejects(data: object, match: str) -> None:
    """Malformed plans are refused with a pointer to the problem"""
    with pytest.raises(ChannelPlanError, match=match):
        parse_plan(data)


def test_desired_tree() -> None:
    """Units/ carries the plan and Missions/ TAK's missions; Teams/ and Roles/ are fixed"""
    units, missions, teams, roles = desired_tree((ChannelSpec("10"),), (ChannelSpec("RECON"),))
    assert units == ChannelSpec("Units", "Organisation nets", (ChannelSpec("10"),))
    assert missions.name == "Missions" and missions.children == (ChannelSpec("RECON"),)
    assert desired_tree(())[1].children == ()
    assert [c.name for c in teams.children] == list(TEAM_COLOURS)
    assert len(TEAM_COLOURS) == 14
    assert [c.name for c in roles.children] == list(ROLES)


class FakeServer:
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
    server = FakeServer()
    desired = desired_tree(
        parse_plan({"channels": [{"name": "10", "description": "A", "channels": [{"name": "101"}]}]})
    )
    created = reconcile(server, desired)
    assert created[:3] == ["/Units", "/Units/10", "/Units/10/101"]
    assert "/Teams/Dark Blue" in created and "/Roles/Medic" in created
    platoon = next(c for c in server.existing if c.name == "10")
    squad = next(c for c in server.existing if c.name == "101")
    assert squad.parent == platoon.id
    assert server.descriptions[platoon.id] == "A"
    assert reconcile(server, desired) == []


def test_reconcile_fills_gaps_only() -> None:
    """Existing channels are kept, and missing children land under them"""
    server = FakeServer([ExistingChannel(7, 0, "Units")])
    created = reconcile(server, (ChannelSpec("Units", children=(ChannelSpec("20"),)),))
    assert created == ["/Units/20"]
    assert server.existing[-1] == ExistingChannel(2, 7, "20")


def test_prune_removes_what_the_plan_dropped() -> None:
    """Dropped permanent channels go with their subtrees; kept ones and users' temporary channels stay"""
    server = FakeServer(
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


def test_reconcile_corrects_descriptions() -> None:
    """An edited description reaches Murmur once; an unchanged one is left alone"""
    server = FakeServer([ExistingChannel(1, 0, "Units"), ExistingChannel(2, 1, "10", description="old")])
    plan = (ChannelSpec("Units", children=(ChannelSpec("10", "Alfa-joukkue"),)),)
    assert reconcile(server, plan) == []
    assert server.descriptions == {2: "Alfa-joukkue"}
    server.descriptions.clear()
    reconcile(server, plan)
    assert server.descriptions == {}


def test_parse_plan_access() -> None:
    """A plan may say who gets into each net; leaving it out keeps the default"""
    plan = parse_plan(
        {
            "channels": [
                {"name": "10", "access": "invite", "channels": [{"name": "101", "access": "inherit"}]},
                {"name": "20"},
            ]
        }
    )
    assert plan == (
        ChannelSpec("10", children=(ChannelSpec("101", access="inherit"),), access="invite"),
        ChannelSpec("20"),
    )


def test_parse_plan_members() -> None:
    """An exported plan carries members; anything but a list of callsigns is refused"""
    plan = parse_plan({"channels": [{"name": "10", "access": "invite", "members": ["VOICE1", "ALPHA 1"]}]})
    assert plan == (ChannelSpec("10", access="invite", members=("VOICE1", "ALPHA 1")),)
    for bad in ("VOICE1", [1], [""], ["a\nb"], ["x" * 65]):
        with pytest.raises(ChannelPlanError, match="members"):
            parse_plan({"channels": [{"name": "10", "members": bad}]})


def test_parse_plan_holds_at_most_max_nets() -> None:
    """A small plan of nested aliases would expand to 2^40 nets; parsing stops at MAX_NETS"""
    levels = ["l0: &l0 [{name: x}]"] + [
        f"l{k}: &l{k} [{{name: a, channels: *l{k - 1}}}, {{name: b, channels: *l{k - 1}}}]" for k in range(1, 41)
    ]
    with pytest.raises(ChannelPlanError, match=f"at most {MAX_NETS} nets"):
        parse_plan(yaml.safe_load("\n".join([*levels, "channels: *l40"])))
    assert len(parse_plan({"channels": [{"name": f"n{i}"} for i in range(MAX_NETS)]})) == MAX_NETS
    with pytest.raises(ChannelPlanError, match="at most"):
        parse_plan({"channels": [{"name": f"n{i}"} for i in range(MAX_NETS + 1)]})


def test_parse_plan_holds_at_most_max_members() -> None:
    """A members list aliased into every net counts in each. This half-megabyte plan would be 50 million
    members to read; parsing refuses it at the third net, before reading that net's callsigns"""
    callsigns = ", ".join(["ALPHA 1"] * (MAX_MEMBERS // 2))
    nets = ", ".join(f"{{name: n{i}, members: *m}}" for i in range(MAX_NETS))
    data = yaml.safe_load(f"m: &m [{callsigns}]\nchannels: [{nets}]")
    started = time.perf_counter()
    with pytest.raises(ChannelPlanError, match=rf"^channels\[2\]: a plan holds at most {MAX_MEMBERS} members"):
        parse_plan(data)
    assert time.perf_counter() - started < 1
    assert len(parse_plan({"channels": [{"name": "n", "members": ["A"] * MAX_MEMBERS}]})[0].members) == MAX_MEMBERS
    with pytest.raises(ChannelPlanError, match="members across its nets"):
        parse_plan({"channels": [{"name": "n", "members": ["A"] * (MAX_MEMBERS + 1)}]})


def test_parse_plan_nests_at_most_max_depth() -> None:
    """A net whose channels alias the list it is in nests without end; parsing stops at MAX_DEPTH"""
    with pytest.raises(ChannelPlanError, match=f"at most {MAX_DEPTH} deep"):
        parse_plan(yaml.safe_load("channels: &c [{name: x, channels: *c}]"))
    net: dict[str, object] = {"name": "x"}
    for _ in range(MAX_DEPTH - 1):
        net = {"name": "x", "channels": [net]}
    assert parse_plan({"channels": [net]})
    with pytest.raises(ChannelPlanError, match=f"at most {MAX_DEPTH} deep"):
        parse_plan({"channels": [{"name": "x", "channels": [net]}]})


def test_parse_plan_shows_a_bad_name_by_its_type() -> None:
    """A name aliasing nested lists is refused by its type: its repr would hold 2^40 items"""
    levels = ["l0: &l0 [x, x]"] + [f"l{k}: &l{k} [*l{k - 1}, *l{k - 1}]" for k in range(1, 40)]
    with pytest.raises(ChannelPlanError, match=r"^channels\[0\]: invalid name of type list$"):
        parse_plan(yaml.safe_load("\n".join([*levels, "channels: [{name: *l39}]"])))


def test_load_yaml_refuses_merge_keys() -> None:
    """PyYAML copies merged mappings while it loads, so merges of merges would copy 2^40 keys before any
    budget counts them; a plan may not merge at all"""
    levels = ["m0: &m0 {name: x}"] + [f"m{k}: &m{k} {{<<: [*m{k - 1}, *m{k - 1}]}}" for k in range(1, 41)]
    with pytest.raises(yaml.YAMLError, match="merge keys"):
        load_yaml("\n".join(levels))


@pytest.mark.parametrize(
    "number",
    [
        "1" + ":59" * 100_000,  # YAML 1.1 base 60, which PyYAML multiplies out in quadratic time: seconds
        "9" * 300_000,  # int() refuses more than 4300 digits, with a ValueError rather than a YAML error
        "0x" + "f" * 300_000,  # read fast, but str() refuses the 1.2-million-bit int in the same way
    ],
    ids=["base-60", "decimal", "hex"],
)
def test_load_yaml_keeps_numbers_as_text(number: str) -> None:
    """Loading runs before any budget counts, so a number in a plan stays text, read at scan speed, and a
    net named with it is refused"""
    started = time.perf_counter()
    data = load_yaml(f"channels: [{{name: {number}}}]")
    assert time.perf_counter() - started < 1
    assert data == {"channels": [{"name": number}]}
    with pytest.raises(ChannelPlanError, match="invalid name"):
        parse_plan(data)


@pytest.mark.parametrize("tagged", ["!!int 1:59:59", "!!int x", "!!float x", "!!timestamp x", "!!binary eA==", "!x x"])
def test_load_yaml_refuses_other_tags(tagged: str) -> None:
    """A tag would build what plain scalars no longer do, and !!int x fails with a ValueError no caller expects"""
    with pytest.raises(yaml.YAMLError, match="cannot use the tag"):
        load_yaml(f"channels: [{{name: {tagged}}}]")


def test_load_yaml_reads_scalars_as_written() -> None:
    """Names, descriptions and callsigns are text as written, where YAML 1.1 would read 07 as 7, 1_000 as
    1000, 1:30 as 90, yes and No as booleans and an empty value as null"""
    plan = """
channels:
  - name: 07
    description: 1.10
    members: [101, yes, 1:30]
  - name: 1_000
    description: 2022-10-11
  - name: No
    description:
"""
    assert parse_plan(load_yaml(plan)) == (
        ChannelSpec("07", "1.10", members=("101", "yes", "1:30")),
        ChannelSpec("1_000", "2022-10-11"),
        ChannelSpec("No"),
    )


def test_load_yaml_reads_an_exported_plan_back() -> None:
    """The export writes a plan with yaml.safe_dump, which quotes the text YAML 1.1 would read otherwise"""
    plan = {
        "channels": [
            {
                "name": "07",
                "description": "",
                "access": "invite",
                "members": ["101", "ALPHA 1", "yes"],
                "channels": [{"name": "1_000", "description": "1:30", "access": "inherit"}],
            },
            {"name": "General", "description": "Yleiskanava, avoin kaikille", "access": "open"},
        ]
    }
    assert load_yaml(yaml.safe_dump(plan, allow_unicode=True, sort_keys=False)) == plan
