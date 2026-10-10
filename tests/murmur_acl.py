"""Murmur 1.5's channel permission evaluation (src/ACL.cpp, src/murmur/Group.cpp), reduced to what our ACLs use.

It lets tests check that the ACLs murmur-agent writes produce, in Murmur, exactly the access the policy means.
"""

from __future__ import annotations

from collections.abc import Mapping

from mumblermapi.enforce import OPEN, Acl

WRITE, ENTER, MOVE, LISTEN = 0x1, 0x4, 0x20, 0x800
DEFAULT = 0x2 | ENTER | 0x8 | 0x100 | 0x200 | LISTEN  # Traverse, Enter, Speak, Whisper, TextMessage, Listen
# ACL.cpp: Write brings Traverse, Enter, MuteDeafen, Move, MakeChannel, LinkChannel, TextMessage,
# MakeTempChannel and Listen with it
WRITE_GRANTS = 0x2 | ENTER | 0x10 | MOVE | 0x40 | 0x80 | 0x200 | 0x400 | LISTEN
# ServerDB.cpp: a new server's root ACL, which the agent leaves alone: @admin +Write, @auth +MakeTempChannel
ROOT: Acl = (
    True,
    ((True, True, -1, "admin", WRITE, 0), (True, True, -1, "auth", 0x400, 0)),
    (("admin", True, True, (), ()),),
)


def created_by(user_id: int) -> Acl:
    """What Murmur gives a temporary channel's creator (Messages.cpp): its own admin group and Write"""
    return (True, ((True, False, user_id, "", WRITE | 0x2, 0),), (("admin", True, True, (user_id,), ()),))


def _in_group(name: str, user_id: int, channel: int, parents: Mapping[int, int], acls: Mapping[int, Acl]) -> bool:
    if name == "all":
        return True
    if name == "auth":
        return user_id >= 0
    # Group.cpp: walk up from the channel being checked to the nearest one defining the group; a group with
    # inherit off stops the walk, and the members sets are combined top-down.
    stack = []
    current: int | None = channel
    while current is not None:
        group = next((g for g in _acl(current, acls)[2] if g[0] == name), None)
        if group is not None:
            _, inherit, inheritable, add, remove = group
            if current != channel and not inheritable:
                break
            stack.append((add, remove))
            if not inherit:
                break
        current = parents.get(current)
    member = False
    for add, remove in reversed(stack):
        member = (member or user_id in add) and user_id not in remove
    return member


def permissions(user_id: int, channel: int, parents: Mapping[int, int], acls: Mapping[int, Acl]) -> int:
    """The permission bits user_id gets in channel"""
    chain = [channel]
    while chain[-1] in parents:
        chain.append(parents[chain[-1]])
    granted = DEFAULT
    for current in reversed(chain):
        inherit, rules, _ = _acl(current, acls)
        if not inherit:
            granted = DEFAULT
        for here, subs, rule_user, group, allow, deny in rules:
            applies = (current == channel and here) or (current != channel and subs)
            matches = (rule_user != -1 and rule_user == user_id) or (
                group and _in_group(group, user_id, channel, parents, acls)
            )
            if applies and matches:
                granted = (granted | allow) & ~deny
    return granted | WRITE_GRANTS if granted & WRITE else granted


def may_enter(user_id: int, channel: int, parents: Mapping[int, int], acls: Mapping[int, Acl]) -> bool:
    """Murmur's check for entering a channel: Enter or Move"""
    return bool(permissions(user_id, channel, parents, acls) & (ENTER | MOVE))


def _acl(channel: int, acls: Mapping[int, Acl]) -> Acl:
    return acls.get(channel, ROOT if channel == 0 else OPEN)
