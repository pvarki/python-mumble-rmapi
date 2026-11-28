import { useTranslation } from "react-i18next";

import { api, type User } from "@/api";
import { StatusDot, type Status } from "@/components/StatusDot";
import { Switch } from "@/components/ui/switch";
import { NS, RAW } from "@/i18n";
import { pathLabel } from "@/paths";
import { listUsers } from "./tree";
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
  const name = t("admin.voiceFor", { callsign: user.callsign, ...RAW });
  return (
    // The label gives the small switch a 40 px touch target
    <label className="inline-flex h-10 shrink-0 items-center px-2">
      <Switch
        checked={on}
        title={name}
        aria-label={name}
        aria-disabled={busy || undefined}
        className="aria-disabled:opacity-50"
        onCheckedChange={(checked) =>
          void run(`voice:${user.callsign}`, () =>
            api.setVoice(user.callsign, checked),
          )
        }
      />
    </label>
  );
}

// The dot and the words a screen reader hears in its place
function presence(user: User): [Status, string] {
  if (user.online === null) return ["unknown", "admin.presenceUnknown"];
  return user.online.length
    ? ["on", "admin.isOnline"]
    : ["off", "admin.isOffline"];
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
      <p className="py-12 text-center text-sm text-muted-foreground">
        {t("admin.noMatches", { q: query.trim(), ...RAW })}
      </p>
    );
  }
  return (
    <div className="pt-2">
      {/* Names the switch column; screen readers get presence and labels per row */}
      <div className="flex text-xs text-muted-foreground" aria-hidden="true">
        {!known && <span className="pl-2">{t("admin.presenceUnknown")}</span>}
        <span className="ml-auto w-12 text-center">{t("title")}</span>
      </div>
      <ul>
        {shown.map((user) => {
          const [state, words] = presence(user);
          const where = user.online?.map(pathLabel).join(", ") ?? "";
          return (
            <li
              key={user.callsign}
              className="flex items-center gap-3 rounded-md pl-2 text-sm hover:bg-muted/50"
              data-testid={`user-${user.callsign}`}
            >
              <StatusDot state={state} />
              <span
                className="w-32 shrink-0 truncate font-medium"
                title={user.callsign}
              >
                {user.callsign}
              </span>
              <span className="sr-only">{t(words)}</span>
              {user.voice_disabled ? (
                <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-foreground">
                  <StatusDot state="alert" />
                  {t("admin.voiceOff")}
                </span>
              ) : (
                <span
                  className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                  title={where || undefined}
                >
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
