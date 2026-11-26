"""The channel plan: its names and limits, how it is read and the tree it makes"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from yaml.constructor import ConstructorError

# ATAK's team colours and roles. They are self-asserted in ATAK, so their channels are open to every user.
TEAM_COLOURS = (
    "White",
    "Yellow",
    "Orange",
    "Magenta",
    "Red",
    "Maroon",
    "Purple",
    "Dark Blue",
    "Blue",
    "Cyan",
    "Teal",
    "Green",
    "Dark Green",
    "Brown",
)
ROLES = ("Team Member", "Team Lead", "HQ", "Sniper", "Medic", "Forward Observer", "RTO", "K9")

# The emergency net among the mission nets: always there and open to every user, so anyone can call for help.
# A TAK mission of the same name is ignored rather than allowed to gate it.
GUARD = "Guard"

# Murmur checks a name only when a client makes or renames a channel, never over Ice, so this is the only gate on
# a net's name: Murmur's default channelname pattern with its dash taken literally (in Murmur's " -=" it is a
# range that lets most punctuation through), capped at 100 characters. Use fullmatch: match() lets "$" pass a
# trailing newline.
NAME_RE = re.compile(r"^[ \-=\w#\[\]{}()@|]{1,100}$")

# Murmur holds 1000 channels by default. The cap also stops YAML aliases from expanding a small plan without end.
MAX_NETS = 1000
# Members across a plan, a members list aliased into many nets counted in each: about what a 1 MiB plan holds
# written out in full, so aliases cannot multiply them past that.
MAX_MEMBERS = 100_000
# Murmur's channelnestinglimit, which the deployment leaves at its default. Server::canNest refuses a channel
# under a parent this many levels below the root, over Ice too. The root is level 0 and Units/ level 1, so a net
# d deep is at level d + 1.
MURMUR_NESTING_LIMIT = 10
# Keeps the last level free for the temporary channels members may make in the deepest net. It also stops a net
# whose channels alias a list above it before Python's recursion limit does.
MAX_DEPTH = MURMUR_NESTING_LIMIT - 2
MAX_DESCRIPTION = 1000  # as long as the admin API lets a description be


# Who may use a Units/ net: everyone, only its members (and those of invite-only nets above it), or the same
# as the net above it. A top-level net has nothing above it, so "inherit" there means open.
ACCESS = ("open", "invite", "inherit")


class ChannelPlanError(ValueError):
    """The channel plan is malformed"""


@dataclass(frozen=True)
class ChannelSpec:
    """A channel and its children; access is one of ACCESS, or "" for the default. members are callsigns, so
    an exported plan restores who was invited."""

    name: str
    description: str = ""
    children: tuple[ChannelSpec, ...] = ()
    access: str = ""
    members: tuple[str, ...] = ()


@dataclass
class _Room:
    """What the rest of a plan may still hold"""

    nets: int = MAX_NETS
    members: int = MAX_MEMBERS


def _parse_list(items: object, where: str, room: _Room, depth: int = 1) -> tuple[ChannelSpec, ...]:
    """depth is how many levels down these nets are"""
    if not isinstance(items, list):
        raise ChannelPlanError(f"{where}: expected a list")
    specs: list[ChannelSpec] = []
    seen: set[str] = set()
    for index, item in enumerate(items):
        at = f"{where}[{index}]"
        room.nets -= 1
        if room.nets < 0:
            raise ChannelPlanError(f"{at}: a plan holds at most {MAX_NETS} nets")
        if depth > MAX_DEPTH:
            raise ChannelPlanError(f"{at}: nets nest at most {MAX_DEPTH} deep")
        if not isinstance(item, dict):
            raise ChannelPlanError(f"{at}: expected a mapping")
        name, description = item.get("name"), item.get("description", "")
        if not isinstance(name, str) or not NAME_RE.fullmatch(name):
            # A list or mapping shows as its type: it may be an alias bomb that repr would expand without end
            shown = repr(name) if isinstance(name, str | None) else f"of type {type(name).__name__}"
            raise ChannelPlanError(f"{at}: invalid name {shown}")
        if name in seen:
            raise ChannelPlanError(f"{at}: duplicate name {name!r}")
        if not isinstance(description, str) or len(description) > MAX_DESCRIPTION or "\x00" in description:
            raise ChannelPlanError(f"{at}: description must be text of at most {MAX_DESCRIPTION} characters, no NUL")
        access = item.get("access", "")
        if access not in ("", *ACCESS):
            raise ChannelPlanError(f"{at}: access must be one of {', '.join(ACCESS)}")
        members = item.get("members", [])
        if not isinstance(members, list):
            raise ChannelPlanError(f"{at}: members must be a list of callsigns")
        # Counted before the callsigns are read, or one list aliased into every net would be read in each
        room.members -= len(members)
        if room.members < 0:
            raise ChannelPlanError(f"{at}: a plan holds at most {MAX_MEMBERS} members across its nets")
        if not all(isinstance(m, str) and 0 < len(m) <= 64 and m.isprintable() for m in members):
            raise ChannelPlanError(f"{at}: members must be a list of callsigns")
        seen.add(name)
        children = _parse_list(item["channels"], f"{at}.channels", room, depth + 1) if "channels" in item else ()
        specs.append(
            ChannelSpec(name=name, description=description, children=children, access=access, members=tuple(members))
        )
    return tuple(specs)


def parse_plan(data: object) -> tuple[ChannelSpec, ...]:
    """Parse the channel plan schema used since 2022: channels: [{name, description, channels}]"""
    if not isinstance(data, dict) or "channels" not in data:
        raise ChannelPlanError("channel plan needs a top-level 'channels' list")
    return _parse_list(data["channels"], "channels", _Room())


# What a plan is made of: text, lists and mappings
_PLAN_TAGS = ("tag:yaml.org,2002:str", "tag:yaml.org,2002:seq", "tag:yaml.org,2002:map")
_MERGE_TAG = "tag:yaml.org,2002:merge"


class _PlanLoader(yaml.SafeLoader):
    """yaml.safe_load cut down to what a plan holds. It runs before the budgets above count anything, so it
    must cost no more than reading the plan does.

    Every plain scalar is text, as names, descriptions and callsigns are. YAML 1.1 would read 07 as 7, and
    PyYAML builds a base-60 number such as 1:59:59:... by big-int multiplication, in time quadratic in its
    length. Other tags (!!int, !!binary and the like) are refused, and so are merge keys: PyYAML copies each
    merged mapping into the one that merges it, so a few hundred bytes of merges of merges grow exponentially."""

    def construct_object(self, node: yaml.Node, deep: bool = False) -> Any:
        if node.tag not in _PLAN_TAGS:
            raise ConstructorError(None, None, f"a channel plan cannot use the tag {node.tag}", node.start_mark)
        return super().construct_object(node, deep)

    def flatten_mapping(self, node: yaml.MappingNode) -> None:
        for key, _ in node.value:
            if key.tag == _MERGE_TAG:
                raise ConstructorError(None, None, "a channel plan cannot use merge keys (<<)", key.start_mark)
        super().flatten_mapping(node)


# Replaces SafeLoader's implicit resolvers: every plain scalar is text but "<<", so that a merge key is refused
# as one rather than read as text
_PlanLoader.yaml_implicit_resolvers = {"<": [(_MERGE_TAG, re.compile(r"^<<$"))]}


def load_yaml(text: str | bytes) -> Any:
    """Read a channel plan or template, every plain scalar as text, refusing other tags and merge keys"""
    loader = _PlanLoader(text)
    try:
        return loader.get_single_data()
    finally:
        loader.dispose()


def load_plan(path: Path) -> tuple[ChannelSpec, ...]:
    """Read a channel plan YAML file"""
    return parse_plan(load_yaml(path.read_text(encoding="utf-8")))


def desired_tree(units: tuple[ChannelSpec, ...], missions: tuple[ChannelSpec, ...] = ()) -> tuple[ChannelSpec, ...]:
    """Units/ from the plan and Missions/ from TAK, plus the fixed Teams/ and Roles/ branches"""
    return (
        ChannelSpec("Units", "Organisation nets", units),
        ChannelSpec("Missions", "TAK missions, for their subscribers, and the open Guard net", missions),
        ChannelSpec("Teams", "ATAK team colours", tuple(ChannelSpec(colour) for colour in TEAM_COLOURS)),
        ChannelSpec("Roles", "ATAK roles", tuple(ChannelSpec(role) for role in ROLES)),
    )
