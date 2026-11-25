import { CornerLeftUp, ListPlus, Lock, Plus, Upload } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";

import { NS, RAW } from "../i18n";
import * as ui from "../ui";
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
    <div className={ui.HEADING} data-testid={testId}>
      <span role="heading" aria-level={2}>
        {label} <span className={ui.NUM}>{count}</span>
      </span>
      {!known ? (
        <span>{t("admin.presenceUnknown")}</span>
      ) : online > 0 ? (
        <span className={ui.HEAD_ONLINE}>
          <span className={ui.DOT_ON} aria-hidden="true" />
          <span aria-hidden="true">{online}</span>
          <span className={ui.SR}>
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
    <div className={ui.LEGEND}>
      <span className={ui.LEGEND_ITEM}>
        <Lock className={ui.ICON_META} />
        {t("admin.legendMembers")}
      </span>
      <span className={ui.LEGEND_ITEM}>
        <CornerLeftUp className={ui.ICON_META} />
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
  // The new net's form, the template chooser or the plan's removal, above the cards
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
      <p className={ui.NOMATCH}>{t("admin.noMatches", { q, ...RAW })}</p>
    ) : (
      <>
        {empty && !top ? (
          <div className={ui.EMPTY}>
            {t("admin.empty")}
            <div className={ui.EMPTY_BTNS}>
              {onTemplates && (
                <button
                  type="button"
                  className={ui.cx(ui.BTN, ui.BTN_PRIMARY_V)}
                  onClick={onTemplates}
                >
                  <ListPlus className={ui.ICON} />
                  {t("admin.emptyTemplate")}
                </button>
              )}
              <button
                type="button"
                className={ui.cx(
                  ui.BTN,
                  onTemplates ? ui.BTN_OUTLINE_V : ui.BTN_PRIMARY_V,
                )}
                onClick={() => fileInput.current?.click()}
              >
                <Upload className={ui.ICON} />
                {t("admin.emptyImport")}
              </button>
              <button
                type="button"
                className={ui.cx(ui.BTN, ui.BTN_OUTLINE_V)}
                onClick={onAddNet}
              >
                <Plus className={ui.ICON} />
                {t("admin.addNet")}
              </button>
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
              <ul className={ui.CARDS}>
                {top && <li className={ui.CARD_FORM}>{top}</li>}
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
            <ul className={ui.CARD}>
              {derived.missions
                .filter((m) => m.match)
                .map((node, index) => (
                  <MissionRow
                    key={node.mission.name}
                    node={node}
                    ctx={ctx}
                    first={index === 0}
                  />
                ))}
            </ul>
          </section>
        )}
      </>
    );
  // The split stays in place while nets open and close, so the list never remounts under the pointer
  return ctx.wide ? (
    <div className={ui.NETS_SPLIT}>
      <div className={ui.NETS_LIST}>{list}</div>
      {details}
    </div>
  ) : (
    list
  );
}
