"""mumblermapi's state: users from rmapi, the Units/ channel tree and its members, TAK missions and the web
voice slot each browser holds"""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field

from sqlalchemy import Engine, func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, col, delete, select, update

from ..channels import ACCESS, GUARD, MAX_DEPTH, ChannelSpec
from ..tickets import WEB_SLOTS
from .errors import ChannelExists, NoSuchChannel, StoreError, TooDeep
from .tables import ChannelRow, MemberRow, MetaRow, MissionMemberRow, UserRow, WebSlotRow

_FLAGS = ("admin", "revoked", "voice_disabled")


@dataclass(frozen=True)
class User:
    """A Deploy App user as rmapi reported it"""

    callsign: str
    uuid: str
    admin: bool
    revoked: bool
    voice_disabled: bool


@dataclass
class Channel:
    """A Units/ channel; access says whether its members restrict it (see channels.ACCESS)"""

    id: int
    name: str
    description: str
    access: str = "open"
    members: list[str] = field(default_factory=list)
    children: list[Channel] = field(default_factory=list)


def _access(access: str | None, parent: int) -> str:
    """The default, and a top-level net cannot inherit from anything: that is open"""
    if access is not None and access not in ACCESS:
        raise StoreError(f"access must be one of {', '.join(ACCESS)}")
    if parent == 0 and access in (None, "inherit"):
        return "open"
    return access or "inherit"


def _depth(parents: dict[int, int], channel_id: int) -> int:
    """How deep a channel is: 1 at the top of Units/"""
    depth = 0
    while channel_id:
        channel_id, depth = parents[channel_id], depth + 1
    return depth


def _subtree(parents: dict[int, int], channel_id: int) -> list[int]:
    """A channel and every channel under it"""
    found: list[int] = []
    todo = [channel_id]
    while todo:
        found.append(todo.pop())
        todo += [child for child, parent in parents.items() if parent == found[-1]]
    return found


class Store:
    """The state in Postgres. Every change bumps a version so murmur-agent can poll cheaply."""

    def __init__(self, engine: Engine) -> None:
        self._engine = engine
        SQLModel.metadata.create_all(engine)
        with Session(engine) as session, session.begin():
            session.exec(insert(MetaRow).values(key="version", value=1).on_conflict_do_nothing())

    @contextmanager
    def _change(self) -> Generator[Session]:
        """A transaction that bumps the version. Changes lock the version's row first and so take turns: each
        one checks what the ones before it left, not what they are halfway through."""
        with Session(self._engine) as session, session.begin():
            session.exec(select(MetaRow).where(MetaRow.key == "version").with_for_update())
            yield session
            self._bump(session)

    def _bump(self, session: Session) -> None:
        session.exec(update(MetaRow).where(col(MetaRow.key) == "version").values(value=col(MetaRow.value) + 1))

    @staticmethod
    def _parents(session: Session) -> dict[int, int]:
        """Each channel's parent"""
        return dict(session.exec(select(ChannelRow.id, ChannelRow.parent)).all())

    # ---- version
    def version(self) -> int:
        """Changes whenever anything murmur-agent cares about changes"""
        with Session(self._engine) as session:
            return session.exec(select(MetaRow.value).where(MetaRow.key == "version")).one()

    # ---- users
    def upsert_user(self, callsign: str, uuid: str) -> None:
        """A user was created or updated in rmapi"""
        with self._change() as session:
            session.exec(
                insert(UserRow)
                .values(callsign=callsign, uuid=uuid)
                .on_conflict_do_update(index_elements=["callsign"], set_={"uuid": uuid})
            )

    def set_user_flag(self, callsign: str, flag: str, value: bool, uuid: str = "") -> None:
        """Set admin, revoked or voice_disabled; creates the user if rmapi's created event was missed"""
        if flag not in _FLAGS:
            raise StoreError(f"unknown flag {flag}")
        with self._change() as session:
            session.exec(
                insert(UserRow)
                .values(callsign=callsign, uuid=uuid, **{flag: value})
                .on_conflict_do_update(index_elements=["callsign"], set_={flag: value})
            )

    def users(self) -> list[User]:
        """Every known user"""
        with Session(self._engine) as session:
            rows = session.exec(select(UserRow).order_by(col(UserRow.callsign))).all()
            return [User(**row.model_dump()) for row in rows]

    def user(self, callsign: str) -> User | None:
        """One user, if known"""
        with Session(self._engine) as session:
            row = session.get(UserRow, callsign)
            return User(**row.model_dump()) if row else None

    # ---- channels
    def add_channel(self, name: str, description: str = "", parent: int = 0, access: str | None = None) -> int:
        """Create a channel under Units/ (parent 0) or under another channel, at most MAX_DEPTH deep. By default
        a top-level net is open and a sub-net follows its parent."""
        access = _access(access, parent)
        try:
            with self._change() as session:
                if parent:
                    parents = self._parents(session)
                    if parent not in parents:
                        raise NoSuchChannel(f"no channel {parent}")
                    # Murmur refuses a channel past its nesting limit, and the agent would leave the net out
                    if _depth(parents, parent) >= MAX_DEPTH:
                        raise TooDeep(f"nets nest at most {MAX_DEPTH} deep")
                new = insert(ChannelRow).values(parent=parent, name=name, description=description, access=access)
                return int(session.exec(new.returning(col(ChannelRow.id))).scalar_one())
        except IntegrityError as exc:
            raise ChannelExists(f"channel {name!r} already exists there") from exc

    def remove_channel(self, channel_id: int) -> None:
        """Remove a channel with everything under it"""
        with self._change() as session:
            parents = self._parents(session)
            if channel_id not in parents:
                raise NoSuchChannel(f"no channel {channel_id}")
            gone = _subtree(parents, channel_id)
            session.exec(delete(MemberRow).where(col(MemberRow.channel).in_(gone)))
            session.exec(delete(ChannelRow).where(col(ChannelRow.id).in_(gone)))

    def update_channel(
        self, channel_id: int, name: str | None = None, description: str | None = None, access: str | None = None
    ) -> None:
        """Rename a channel, change its description, or change who may use it"""
        try:
            with self._change() as session:
                row = session.get(ChannelRow, channel_id)
                if row is None:
                    raise NoSuchChannel(f"no channel {channel_id}")
                row.name = row.name if name is None else name
                row.description = row.description if description is None else description
                row.access = row.access if access is None else _access(access, row.parent)
        except IntegrityError as exc:
            raise ChannelExists(f"channel {name!r} already exists there") from exc

    def clear(self) -> int:
        """Remove every Units/ channel and membership; returns how many channels went"""
        with self._change() as session:
            session.exec(delete(MemberRow))
            return session.exec(delete(ChannelRow)).rowcount

    def set_member(self, channel_id: int, callsign: str, member: bool) -> None:
        """Add or remove a member. Members are invited, so adding one makes the net invite-only."""
        with self._change() as session:
            row = session.get(ChannelRow, channel_id)
            if row is None:
                raise NoSuchChannel(f"no channel {channel_id}")
            if member:
                session.exec(insert(MemberRow).values(channel=channel_id, callsign=callsign).on_conflict_do_nothing())
                row.access = "invite"
            else:
                session.exec(
                    delete(MemberRow).where(col(MemberRow.channel) == channel_id, col(MemberRow.callsign) == callsign)
                )

    def tree(self) -> list[Channel]:
        """The Units/ tree with members"""
        with Session(self._engine) as session:
            rows = session.exec(
                select(ChannelRow, MemberRow.callsign)
                .outerjoin(MemberRow, col(MemberRow.channel) == col(ChannelRow.id))
                .order_by(col(ChannelRow.name), col(MemberRow.callsign))
            ).all()
            nodes: dict[int, Channel] = {}
            parents: dict[int, int] = {}
            for row, member in rows:
                node = nodes.setdefault(row.id, Channel(row.id, row.name, row.description, row.access))
                parents[row.id] = row.parent
                if member:
                    node.members.append(member)
        top: list[Channel] = []
        for channel_id, node in nodes.items():
            parent = parents[channel_id]
            (nodes[parent].children if parent in nodes else top).append(node)
        return top

    def import_plan(self, plan: tuple[ChannelSpec, ...], parent: int = 0) -> int:
        """Add a channel plan (the 2022 YAML schema) under a channel; returns how many channels were created.
        Nets that exist are kept as they are; new ones get the plan's access and members."""
        created = 0
        for spec in plan:
            try:
                channel_id = self.add_channel(spec.name, spec.description, parent, spec.access or None)
                created += 1
                if spec.members:
                    with self._change() as session:
                        members = [{"channel": channel_id, "callsign": callsign} for callsign in spec.members]
                        session.exec(insert(MemberRow).values(members).on_conflict_do_nothing())
            except ChannelExists:
                with Session(self._engine) as session:
                    existing = select(ChannelRow.id).where(ChannelRow.parent == parent, ChannelRow.name == spec.name)
                    channel_id = session.exec(existing).one()
            created += self.import_plan(spec.children, channel_id)
        return created

    # ---- missions
    def missions(self) -> dict[str, frozenset[str]]:
        """TAK missions and their subscribers, as last read"""
        result: dict[str, set[str]] = {}
        with Session(self._engine) as session:
            for row in session.exec(select(MissionMemberRow)):
                result.setdefault(row.mission, set()).add(row.callsign)
        return {mission: frozenset(members) for mission, members in result.items()}

    def set_missions(self, missions: dict[str, frozenset[str]]) -> bool:
        """Replace the missions; True, and a new version, only when something changed. A TAK mission named
        like Guard is left out: Guard stays open to everyone."""
        wanted = {mission: members for mission, members in missions.items() if members and mission != GUARD}
        if wanted == self.missions():
            return False
        with self._change() as session:
            session.exec(delete(MissionMemberRow))
            session.add_all(
                MissionMemberRow(mission=mission, callsign=callsign)
                for mission, members in wanted.items()
                for callsign in members
            )
        return True

    def is_empty(self) -> bool:
        """No channels yet"""
        with Session(self._engine) as session:
            return session.exec(select(ChannelRow.id).limit(1)).first() is None

    # ---- web voice slots
    def web_slot(self, callsign: str, browser: str, now: float) -> int:
        """The web slot this browser of the callsign logs in with: the one it had, else the lowest free one.
        Murmur drops the older of two sessions with one name, so two browsers must not share a slot. No new
        version: nothing murmur-agent enforces changes."""
        with Session(self._engine) as session, session.begin():
            # One request per callsign at a time, so two new browsers cannot both take the same free slot
            session.exec(select(func.pg_advisory_xact_lock(func.hashtext(callsign))))
            held = session.exec(select(WebSlotRow).where(WebSlotRow.callsign == callsign)).all()
            row = next((r for r in held if r.browser == browser), None)
            if row is None:
                taken = {r.slot for r in held}
                slot = next((s for s in WEB_SLOTS if s not in taken), None)
                if slot is None:
                    # The browser whose last ticket is oldest loses its slot, even if it is still in voice
                    row = min(held, key=lambda r: (r.used_at, r.slot))
                    row.browser = browser
                else:
                    row = WebSlotRow(callsign=callsign, browser=browser, slot=slot, used_at=now)
                    session.add(row)
            row.used_at = now
            return row.slot
