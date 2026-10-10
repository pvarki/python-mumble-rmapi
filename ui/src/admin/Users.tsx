import { useTranslation } from "react-i18next";

import { api, type User } from "../api";
import { NS, RAW } from "../i18n";
import { listUsers, pathLabel } from "../paths";
import * as ui from "../ui";
import type { Run } from "./types";

// The state shown always comes from the server after the reload: no optimistic flip
function VoiceSwitch({
  user,
  run,
  busy,
}: {
  user: User;
  run: Run;
  busy: boolean;
}) {
  const { t } = useTranslation(NS);
  const on = !user.voice_disabled;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={t("admin.voiceFor", { callsign: user.callsign, ...RAW })}
      aria-label={t("admin.voiceFor", { callsign: user.callsign, ...RAW })}
      className={ui.SWITCH_BTN}
      aria-disabled={busy || undefined}
      onClick={() =>
        void run(`voice:${user.callsign}`, () =>
          api.setVoice(user.callsign, !on),
        )
      }
    >
      <span
        className={ui.cx(
          ui.SWITCH_TRACK,
          on ? ui.SWITCH_TRACK_ON : ui.SWITCH_TRACK_OFF,
        )}
      >
        <span
          data-state={on ? "checked" : "unchecked"}
          className={ui.cx(
            ui.SWITCH_THUMB,
            on ? ui.SWITCH_THUMB_ON : ui.SWITCH_THUMB_OFF,
          )}
        />
      </span>
    </button>
  );
}

// The dot's class and the words a screen reader hears in its place
function presence(user: User): [string, string] {
  if (user.online === null) return [ui.DOT_UNKNOWN, "admin.presenceUnknown"];
  return user.online.length
    ? [ui.DOT_ON, "admin.isOnline"]
    : [ui.DOT_OFF, "admin.isOffline"];
}

export function UsersList({
  users,
  query,
  known,
  run,
  pending,
}: {
  users: User[];
  query: string;
  known: boolean;
  run: Run;
  pending: Set<string>;
}) {
  const { t } = useTranslation(NS);
  const shown = listUsers(users, query);
  if (!shown.length) {
    return (
      <p className={ui.NOMATCH}>
        {t("admin.noMatches", { q: query.trim(), ...RAW })}
      </p>
    );
  }
  return (
    <div className={ui.USER_LIST}>
      {/* Names the switch column; screen readers get presence and labels per row */}
      <div className={ui.USER_HEAD} aria-hidden="true">
        {!known && (
          <span className={ui.USER_HEAD_NOTE}>
            {t("admin.presenceUnknown")}
          </span>
        )}
        <span className={ui.USER_HEAD_VOICE}>{t("title")}</span>
      </div>
      <ul>
        {shown.map((user) => {
          const [dot, words] = presence(user);
          const where = user.online?.map(pathLabel).join(", ") ?? "";
          return (
            <li
              key={user.callsign}
              className={ui.USER_ROW}
              data-testid={`user-${user.callsign}`}
            >
              <span className={dot} />
              <span className={ui.USER_CALLSIGN} title={user.callsign}>
                {user.callsign}
              </span>
              <span className={ui.SR}>{t(words)}</span>
              {user.voice_disabled ? (
                <span className={ui.USER_WHERE_OFF}>
                  <span className={ui.DOT_RED} />
                  {t("admin.voiceOff")}
                </span>
              ) : (
                <span className={ui.USER_WHERE} title={where || undefined}>
                  {where}
                </span>
              )}
              <VoiceSwitch
                user={user}
                run={run}
                busy={pending.has(`voice:${user.callsign}`)}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
