import { CornerLeftUp, ListPlus, Lock, Plus, Upload } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";

import { StatusDot } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { NS, RAW } from "@/i18n";
import { MissionRow } from "./MissionRow";
import { NetCard } from "./NetCard";
import type { Data, TreeCtx } from "./types";

function GroupHeading({
  label,
  count,
  online,
  known,
  testId,
}: {
  label: string;
  count: number;
  online: number;
  known: boolean;
  testId: string;
}) {
  const { t } = useTranslation(NS);
  return (
    <div
      className="flex items-center justify-between gap-2 pb-2 pl-2 pr-3 pt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground"
      data-testid={testId}
    >
      <span role="heading" aria-level={2}>
        {label} <span className="tabular-nums">{count}</span>
      </span>
      {!known ? (
        <span>{t("admin.presenceUnknown")}</span>
      ) : online > 0 ? (
        <span className="inline-flex w-10 shrink-0 items-center justify-center gap-1 tabular-nums text-green-600">
          <StatusDot state="on" />
          <span aria-hidden="true">{online}</span>
          <span className="sr-only">
            {t("admin.onlineCount", { count: online })}
          </span>
        </span>
      ) : null}
    </div>
  );
}

function PhoneLegend() {
  const { t } = useTranslation(NS);
  return (
    <div className="flex flex-wrap items-center gap-3 px-2 pb-2 text-xs text-muted-foreground md:hidden">
      <span className="inline-flex items-center gap-1">
        <Lock className="size-3.5 shrink-0" />
        {t("admin.legendMembers")}
      </span>
      <span className="inline-flex items-center gap-1">
        <CornerLeftUp className="size-3.5 shrink-0" />
        {t("admin.legendFollows")}
      </span>
      <span>{t("admin.legendOpen")}</span>
    </div>
  );
}

export function NetsTab({
  data,
  ctx,
  query,
  top,
  onAddNet,
  onTemplates,
  fileInput,
  details,
}: {
  data: Data;
  ctx: TreeCtx;
  query: string;
  // The new net's form or the template chooser, above the cards
  top: ReactNode;
  onAddNet: () => void;
  // Null when no template is on offer
  onTemplates: (() => void) | null;
  fileInput: RefObject<HTMLInputElement | null>;
  details: ReactNode;
}) {
  const { t } = useTranslation(NS);
  const { derived } = ctx;
  // On a narrow workspace the open net is its own screen in place of the list
  if (!ctx.wide && details) return details;
  const q = query.trim();
  const empty = !data.channels.length && !q;
  const list =
    q && !derived.unitMatches && !derived.missionMatches ? (
      <p className="py-12 text-center text-sm text-muted-foreground">
        {t("admin.noMatches", { q, ...RAW })}
      </p>
    ) : (
      <>
        {empty && !top ? (
          <div className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
            {t("admin.empty")}
            <div className="flex flex-wrap justify-center gap-2">
              {onTemplates && (
                <Button type="button" onClick={onTemplates}>
                  <ListPlus />
                  {t("admin.emptyTemplate")}
                </Button>
              )}
              <Button
                type="button"
                variant={onTemplates ? "outline" : "default"}
                onClick={() => fileInput.current?.click()}
              >
                <Upload />
                {t("admin.emptyImport")}
              </Button>
              <Button type="button" variant="outline" onClick={onAddNet}>
                <Plus />
                {t("admin.addNet")}
              </Button>
            </div>
          </div>
        ) : (
          (derived.unitMatches > 0 || top) && (
            <section>
              <GroupHeading
                label={t("admin.units")}
                count={derived.unitMatches}
                online={derived.unitsOnline}
                known={derived.presenceKnown}
                testId="units-heading"
              />
              {derived.unitMatches > 0 && <PhoneLegend />}
              <ul className="space-y-2">
                {top && (
                  <li className="rounded-lg border border-dashed border-input p-2">
                    {top}
                  </li>
                )}
                {derived.roots.map((node) => (
                  <NetCard key={node.channel.id} node={node} ctx={ctx} />
                ))}
              </ul>
            </section>
          )
        )}
        {derived.missionMatches > 0 && (
          <section>
            <GroupHeading
              label={t("admin.missions")}
              count={derived.missionMatches}
              online={derived.missionsOnline}
              known={derived.presenceKnown}
              testId="missions-heading"
            />
            <ul className="divide-y overflow-hidden rounded-lg border border-border bg-card">
              {derived.missions
                .filter((m) => m.match)
                .map((node) => (
                  <MissionRow key={node.mission.name} node={node} ctx={ctx} />
                ))}
            </ul>
          </section>
        )}
      </>
    );
  // The split stays in place while nets open and close, so the list never remounts under the pointer
  return ctx.wide ? (
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1">{list}</div>
      {details}
    </div>
  ) : (
    list
  );
}
