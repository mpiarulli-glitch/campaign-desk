"use client";

import { useState, type ReactNode } from "react";
import { EmailAnalyticsPanel } from "./EmailAnalyticsPanel";
import { LinkedInAnalyticsPanel } from "./LinkedInAnalyticsPanel";

export type AnalyticsChannel = "email" | "linkedin";

export function ChannelTitle({
  channel,
  onChange,
}: {
  channel: AnalyticsChannel;
  onChange: (channel: AnalyticsChannel) => void;
}): ReactNode {
  return (
    <div className="lh-channel-title">
      <label className="lh-channel-select">
        <select
          value={channel}
          onChange={(e) => onChange(e.target.value as AnalyticsChannel)}
          aria-label="Analytics source"
        >
          <option value="email">Email &amp; revenue</option>
          <option value="linkedin">LinkedIn</option>
        </select>
      </label>
    </div>
  );
}

export function ChannelAnalyticsPanel({
  clientId,
  memberIds = [],
  ghlLinked,
  crmLinked = false,
  businessModel = "home_service",
  onOpenTools,
}: {
  clientId: string;
  memberIds?: string[];
  ghlLinked: boolean;
  crmLinked?: boolean;
  businessModel?: "ecomm" | "b2b" | "home_service";
  onOpenTools?: () => void;
}) {
  const [channel, setChannel] = useState<AnalyticsChannel>("email");
  const title = <ChannelTitle channel={channel} onChange={setChannel} />;

  if (channel === "linkedin") {
    return (
      <LinkedInAnalyticsPanel
        clientId={clientId}
        memberIds={memberIds}
        title={title}
      />
    );
  }

  return (
    <EmailAnalyticsPanel
      clientId={clientId}
      memberIds={memberIds}
      ghlLinked={ghlLinked}
      crmLinked={crmLinked}
      businessModel={businessModel}
      onOpenTools={onOpenTools}
      title={title}
    />
  );
}
