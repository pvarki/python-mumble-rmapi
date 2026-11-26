import { Flag } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { StatusDot } from "@/components/StatusDot";
import { Admin } from "./admin/Admin";
import { OnboardingHandler } from "./guide/OnboardingHandler";
import { addTranslations, NS } from "./i18n";
import { cn } from "./lib/utils";
import { MISSIONS, pathLabel } from "./paths";
import * as ui from "./ui";
import { Talk } from "./voice/Talk";

// What mumblermapi's /api/v2/clients/data returns for the signed-in user, by way of rmapi
export interface ClientData {
  admin?: boolean;
  voice?: boolean;
  nets?: string[];
}

// What rmui passes every remote about the signed-in user besides data
export interface Meta {
  callsign?: string;
  // Whether guides may open by themselves, and the way to turn that off for every product
  autoOpenGuides?: boolean;
  onDisableGuides?: () => void;
}

interface Props {
  data?: ClientData;
  meta?: Meta;
}

// The signed-in user's voice state and nets, readable without a click
function YouLine({ data }: { data: ClientData }) {
  const { t } = useTranslation(NS);
  const nets = data.nets ?? [];
  return (
    <div className={ui.YOU} data-testid="you">
      <div className={ui.YOU_LINE}>
        {data.voice === true && (
          <span className={ui.YOU_STATUS}>
            <StatusDot state="on" />
            {t("voiceOn")}
          </span>
        )}
        {data.voice === false && (
          <span className={cn(ui.YOU_STATUS, ui.YOU_OFF)}>
            <StatusDot state="alert" />
            {t("voiceOff")}
          </span>
        )}
        {data.voice === false ? null : nets.length ? (
          nets.map((net) => (
            <span key={net} className={ui.NET_TAG}>
              {net.startsWith(MISSIONS) && <Flag className={ui.FLAG} />}
              {pathLabel(net)}
            </span>
          ))
        ) : (
          <span className={ui.MUTED_XS}>{t("openNetsOnly")}</span>
        )}
      </div>
      <p className={ui.MUTED_XS}>{t("atakHint")}</p>
    </div>
  );
}

function VoicePage({ data, meta }: { data: ClientData; meta: Meta }) {
  const { t } = useTranslation(NS);
  return (
    <div className={ui.PAGE}>
      <div className={ui.PAGE_HEAD}>
        <h1 className={ui.H1}>{t("title")}</h1>
        {/* rmui passes {} until rmapi answers, and the guide decides on mount whether it opens */}
        {data.voice !== undefined && (
          <OnboardingHandler
            meta={meta}
            voice={data.voice}
            admin={!!data.admin}
          />
        )}
      </div>
      <YouLine data={data} />
      {data.voice !== false && <Talk />}
      {data.admin && <Admin />}
    </div>
  );
}

export default function MumbleApp({ data = {}, meta = {} }: Props) {
  const { i18n } = useTranslation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void addTranslations(i18n).then(() => setReady(true));
  }, [i18n]);

  return ready ? <VoicePage data={data} meta={meta} /> : null;
}
