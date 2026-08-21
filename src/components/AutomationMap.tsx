"use client";

import { Fragment } from "react";
import { kindLabel, type AssetKind } from "@/lib/asset-kinds";
import {
  buildAutomationTree,
  coerceTriggerKind,
  conditionKindLabel,
  triggerKindLabel,
  type AutomationEmail,
  type FlowBranch,
  type FlowStepRecord,
  type FlowStepType,
  type FlowTreeNode,
  type TriggerKind,
} from "@/lib/automation-map";

function TriggerGlyph({ kind }: { kind: TriggerKind }) {
  if (kind === "form") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="3" width="16" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 8h8M8 12h8M8 16h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "purchase") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M6 7h15l-1.5 8.5a2 2 0 0 1-2 1.5H9a2 2 0 0 1-2-1.6L5 4H3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="9.5" cy="20" r="1.3" fill="currentColor" />
        <circle cx="17.5" cy="20" r="1.3" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "date") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 3.5v4M16 3.5v4M3.5 10h17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "tag") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 12.5V5h7.5L20 13.5 13.5 20 4 12.5z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <circle cx="8.2" cy="8.2" r="1.2" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M13 3 5 14h6l-1 7 9-12h-6l0-6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MailGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 7l8 6 8-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function ClockGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v4.5L15 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SplitGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3 21 12 12 21 3 12 12 3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M8 12h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export type FlowInsertAt = {
  parentId: string | null;
  branch: FlowBranch;
  afterStepId?: string | null;
  prepend?: boolean;
};

type Props = {
  triggerLabel?: string | null;
  triggerKind?: string | null;
  emails: AutomationEmail[];
  steps?: FlowStepRecord[] | null;
  selectedId?: string | null;
  onSelectEmail?: (id: string) => void;
  onSelectStep?: (stepId: string, emailId?: string | null) => void;
  onAddStep?: (stepType: FlowStepType, at: FlowInsertAt) => void;
  previewHint?: boolean;
  editable?: boolean;
};

function InsertBar({
  at,
  onAddStep,
}: {
  at: FlowInsertAt;
  onAddStep: (stepType: FlowStepType, at: FlowInsertAt) => void;
}) {
  return (
    <li className="am-insert">
      <span className="am-insert-line" aria-hidden />
      <div className="am-insert-btns">
        <button type="button" onClick={() => onAddStep("wait", at)}>
          Wait
        </button>
        <button type="button" onClick={() => onAddStep("email", at)}>
          Email
        </button>
        <button type="button" onClick={() => onAddStep("condition", at)}>
          If / else
        </button>
      </div>
    </li>
  );
}

function Path({
  nodes,
  parentId,
  branch,
  selectedId,
  previewHint,
  editable,
  onSelectEmail,
  onSelectStep,
  onAddStep,
}: {
  nodes: FlowTreeNode[];
  parentId: string | null;
  branch: FlowBranch;
  selectedId?: string | null;
  previewHint: boolean;
  editable: boolean;
  onSelectEmail?: (id: string) => void;
  onSelectStep?: (stepId: string, emailId?: string | null) => void;
  onAddStep?: (stepType: FlowStepType, at: FlowInsertAt) => void;
}) {
  return (
    <ol className="am-map">
      {editable && onAddStep ? (
        <InsertBar
          at={{ parentId, branch, prepend: true }}
          onAddStep={onAddStep}
        />
      ) : null}
      {nodes.map((node, index) => (
        <Fragment key={node.id}>
          <Step
            node={node}
            selectedId={selectedId}
            previewHint={previewHint}
            editable={editable}
            onSelectEmail={onSelectEmail}
            onSelectStep={onSelectStep}
            onAddStep={onAddStep}
            last={index === nodes.length - 1 && !editable}
          />
          {editable && onAddStep ? (
            <InsertBar
              at={{ parentId, branch, afterStepId: node.id }}
              onAddStep={onAddStep}
            />
          ) : null}
        </Fragment>
      ))}
    </ol>
  );
}

function Step({
  node,
  selectedId,
  previewHint,
  editable,
  onSelectEmail,
  onSelectStep,
  onAddStep,
  last,
}: {
  node: FlowTreeNode;
  selectedId?: string | null;
  previewHint: boolean;
  editable: boolean;
  onSelectEmail?: (id: string) => void;
  onSelectStep?: (stepId: string, emailId?: string | null) => void;
  onAddStep?: (stepType: FlowStepType, at: FlowInsertAt) => void;
  last: boolean;
}) {
  const selected = node.id === selectedId || (node.type === "email" && (node.emailId === selectedId || node.email?.id === selectedId));

  if (node.type === "wait") {
    const Tag = onSelectStep ? "button" : "div";
    return (
      <li className="am-step">
        <Tag
          type={onSelectStep ? "button" : undefined}
          className={`am-node am-wait-node ${selected ? "is-selected" : ""}`}
          onClick={onSelectStep ? () => onSelectStep(node.id) : undefined}
        >
          <span className="am-glyph">
            <ClockGlyph />
          </span>
          <div className="am-node-copy">
            <span className="am-kicker">Wait</span>
            <strong>{node.delayMs <= 0 ? "Immediately" : node.label}</strong>
          </div>
        </Tag>
        {!last ? <span className="am-rail" aria-hidden /> : null}
      </li>
    );
  }

  if (node.type === "condition") {
    const Tag = onSelectStep ? "button" : "div";
    return (
      <li className="am-step">
        <Tag
          type={onSelectStep ? "button" : undefined}
          className={`am-node am-condition ${selected ? "is-selected" : ""}`}
          onClick={onSelectStep ? () => onSelectStep(node.id) : undefined}
        >
          <span className="am-glyph">
            <SplitGlyph />
          </span>
          <div className="am-node-copy">
            <span className="am-kicker">{conditionKindLabel(node.kind)}</span>
            <strong>{node.label}</strong>
          </div>
        </Tag>
        <div className="am-fork">
          <div className="am-fork-col">
            <span className="am-fork-label">If yes</span>
            <Path
              nodes={node.yes}
              parentId={node.id}
              branch="yes"
              selectedId={selectedId}
              previewHint={previewHint}
              editable={editable}
              onSelectEmail={onSelectEmail}
              onSelectStep={onSelectStep}
              onAddStep={onAddStep}
            />
          </div>
          <div className="am-fork-col is-else">
            <span className="am-fork-label">If no / else</span>
            <Path
              nodes={node.no}
              parentId={node.id}
              branch="no"
              selectedId={selectedId}
              previewHint={previewHint}
              editable={editable}
              onSelectEmail={onSelectEmail}
              onSelectStep={onSelectStep}
              onAddStep={onAddStep}
            />
          </div>
        </div>
        {!last ? <span className="am-rail" aria-hidden /> : null}
      </li>
    );
  }

  const email = node.email;
  const emailId = node.emailId || email?.id || "";
  const emailKind = (email?.kind || "email") as AssetKind;
  const clickable = !!(onSelectEmail || onSelectStep);
  const Tag = clickable ? "button" : "div";
  return (
    <li className="am-step">
      <Tag
        type={clickable ? "button" : undefined}
        className={`am-node am-email ${selected ? "is-selected" : ""} ${
          email?.approved_at ? "is-approved" : ""
        }`}
        onClick={
          clickable
            ? () => {
                if (onSelectStep) onSelectStep(node.id, emailId || null);
                else if (emailId && onSelectEmail) onSelectEmail(emailId);
              }
            : undefined
        }
      >
        <span className="am-glyph">
          <MailGlyph />
        </span>
        <div className="am-node-copy">
          <span className="am-kicker">
            {email?.approved_at ? "Approved" : kindLabel(emailKind)}
            {email?.open_comments ? ` · ${email.open_comments} comments` : ""}
          </span>
          <strong>{email?.title || "Untitled email"}</strong>
          {email?.subject ? <span className="am-sub">{email.subject}</span> : null}
          {previewHint && clickable ? (
            <span className="am-preview-cue">Click to preview</span>
          ) : null}
        </div>
      </Tag>
      {!last ? <span className="am-rail" aria-hidden /> : null}
    </li>
  );
}

export function AutomationMap({
  triggerLabel,
  triggerKind,
  emails,
  steps,
  selectedId,
  onSelectEmail,
  onSelectStep,
  onAddStep,
  previewHint = false,
  editable = false,
}: Props) {
  const tree = buildAutomationTree({ triggerLabel, triggerKind, emails, steps });
  const kind = coerceTriggerKind(triggerKind);

  return (
    <div className="am-root">
      <div className="am-node am-trigger">
        <span className="am-glyph">
          <TriggerGlyph kind={kind} />
        </span>
        <div className="am-node-copy">
          <span className="am-kicker">{triggerKindLabel(kind)}</span>
          <strong>{tree.trigger.label}</strong>
        </div>
      </div>
      {tree.nodes.length > 0 || editable ? (
        <span className="am-rail" aria-hidden />
      ) : null}
      <Path
        nodes={tree.nodes}
        parentId={null}
        branch=""
        selectedId={selectedId}
        previewHint={previewHint}
        editable={editable}
        onSelectEmail={onSelectEmail}
        onSelectStep={onSelectStep}
        onAddStep={onAddStep}
      />
    </div>
  );
}

export function DelayPicker({
  amount,
  unit,
  onAmount,
  onUnit,
  disabled,
  id,
}: {
  amount: number;
  unit: "minutes" | "hours" | "days";
  onAmount: (n: number) => void;
  onUnit: (u: "minutes" | "hours" | "days") => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <div className="am-delay-picker">
      <input
        id={id}
        type="number"
        min={0}
        step={1}
        value={amount}
        disabled={disabled}
        onChange={(e) => onAmount(Math.max(0, Number(e.target.value) || 0))}
      />
      <select
        value={unit}
        disabled={disabled}
        onChange={(e) => onUnit(e.target.value as "minutes" | "hours" | "days")}
        aria-label="Wait unit"
      >
        <option value="minutes">minutes</option>
        <option value="hours">hours</option>
        <option value="days">days</option>
      </select>
    </div>
  );
}
