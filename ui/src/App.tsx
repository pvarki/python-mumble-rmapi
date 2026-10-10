import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Admin } from "./admin/Admin";
import { addTranslations, NS } from "./i18n";
import { Flag } from "./icons";
import { MISSIONS, pathLabel } from "./paths";
import * as ui from "./ui";

// What mumblermapi's /api/v2/clients/data returns for the signed-in user, by way of rmapi
export interface ClientData {
  admin?: boolean;
  voice?: boolean;
  nets?: string[];
}

interface Props {
  data?: ClientData;
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
            <span className={ui.DOT_ON} />
            {t("voiceOn")}
          </span>
        )}
        {data.voice === false && (
          <span className={ui.cx(ui.YOU_STATUS, ui.YOU_OFF)}>
            <span className={ui.DOT_RED} />
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

function VoicePage({ data }: { data: ClientData }) {
  const { t } = useTranslation(NS);
  return (
    <div className={ui.PAGE}>
      <h1 className={ui.H1}>{t("title")}</h1>
      <YouLine data={data} />
      {data.admin && <Admin />}
    </div>
  );
}

export default function MumbleApp({ data = {} }: Props) {
  const { i18n } = useTranslation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void addTranslations(i18n).then(() => setReady(true));
  }, [i18n]);

  return ready ? <VoicePage data={data} /> : null;
}
