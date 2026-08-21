"use client";

import { Fragment, useEffect, useState } from "react";
import { kindLabel, type AssetKind } from "@/lib/asset-kinds";
import {
  atLabel,
  buildAutomationTree,
  coerceTriggerKind,
  conditionKindLabel,
  delayToMs,
  splitDelay,
  triggerKindLabel,
  CONDITION_KINDS,
  TRIGGER_KINDS,
  WAIT_PRESETS,
  type AutomationEmail,
  type ConditionKind,
  type DelayUnit,
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

function PencilGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 20h4L20 8l-4-4L4 16v4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type FlowInsertAt = {
  parentId: string | null;
  branch: FlowBranch;
  afterStepId?: string | null;
  prepend?: boolean;
};

export type TriggerDraft = { kind: TriggerKind; label: string };
export type WaitDraft = { delayMs: number };
export type ConditionDraft = { kind: ConditionKind; label: string };

type Props = {
  triggerLabel?: string | null;
  triggerKind?: string | null;
  emails: AutomationEmail[];
  steps?: FlowStepRecord[] | null;
  selectedId?: string | null;
  onSelectEmail?: (id: string) => void;
  onSelectStep?: (stepId: string, emailId?: string | null) => void;
  onAddStep?: (stepType: FlowStepType, at: FlowInsertAt) => void;
  /** Inline editors. Passing these is what turns a node into an editor. */
  onSaveTrigger?: (draft: TriggerDraft) => void;
  onSaveWait?: (stepId: string, draft: WaitDraft) => void;
  onSaveCondition?: (stepId: string, draft: ConditionDraft) => void;
  onDeleteStep?: (stepId: string) => void;
  busy?: boolean;
  previewHint?: boolean;
  editable?: boolean;
  /** Day-N chips down the path. On by default in the admin editor. */
  showSchedule?: boolean;
};

/**
 * The rail between two steps. It stays a thin line until you hover or focus it,
 * then offers the three things you can drop in. Keeping the buttons hidden is
 * what lets a ten-step map read as a path instead of a wall of chips.
 */
function InsertBar({
  at,
  onAddStep,
  busy,
}: {
  at: FlowInsertAt;
  onAddStep: (stepType: FlowStepType, at: FlowInsertAt) => void;
  busy?: boolean;
}) {
  return (
    <li className="am-insert">
      <span className="am-insert-line" aria-hidden />
      <div className="am-insert-hit">
        <span className="am-insert-plus" aria-hidden>
          +
        </span>
        <div className="am-insert-btns">
          <button type="button" onClick={() => onAddStep("wait", at)} disabled={busy}>
            Wait
          </button>
          <button type="button" onClick={() => onAddStep("email", at)} disabled={busy}>
            Email
          </button>
          <button type="button" onClick={() => onAddStep("condition", at)} disabled={busy}>
            If / else
          </button>
        </div>
      </div>
      <span className="am-insert-line" aria-hidden />
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
  showSchedule,
  busy,
  onSelectEmail,
  onSelectStep,
  onAddStep,
  onSaveWait,
  onSaveCondition,
  onDeleteStep,
}: {
  nodes: FlowTreeNode[];
  parentId: string | null;
  branch: FlowBranch;
  selectedId?: string | null;
  previewHint: boolean;
  editable: boolean;
  showSchedule: boolean;
  busy?: boolean;
  onSelectEmail?: (id: string) => void;
  onSelectStep?: (stepId: string, emailId?: string | null) => void;
  onAddStep?: (stepType: FlowStepType, at: FlowInsertAt) => void;
  onSaveWait?: (stepId: string, draft: WaitDraft) => void;
  onSaveCondition?: (stepId: string, draft: ConditionDraft) => void;
  onDeleteStep?: (stepId: string) => void;
}) {
  const showInserts = editable && !!onAddStep;
  return (
    <ol className="am-map">
      {showInserts && onAddStep ? (
        <InsertBar
          at={{ parentId, branch, prepend: true }}
          onAddStep={onAddStep}
          busy={busy}
        />
      ) : null}
      {nodes.map((node, index) => (
        <Fragment key={node.id}>
          <Step
            node={node}
            selectedId={selectedId}
            previewHint={previewHint}
            editable={editable}
            showSchedule={showSchedule}
            busy={busy}
            onSelectEmail={onSelectEmail}
            onSelectStep={onSelectStep}
            onAddStep={onAddStep}
            onSaveWait={onSaveWait}
            onSaveCondition={onSaveCondition}
            onDeleteStep={onDeleteStep}
            last={showInserts || index === nodes.length - 1}
          />
          {showInserts && onAddStep ? (
            <InsertBar
              at={{ parentId, branch, afterStepId: node.id }}
              onAddStep={onAddStep}
              busy={busy}
            />
          ) : null}
        </Fragment>
      ))}
      {showInserts && nodes.length === 0 ? (
        <li className="am-empty-path">Nothing on this path yet</li>
      ) : null}
    </ol>
  );
}

/** The number-and-unit pair plus the one-tap presets, shared by every wait. */
function WaitFields({
  delayMs,
  onChange,
  disabled,
  id,
}: {
  delayMs: number;
  onChange: (ms: number) => void;
  disabled?: boolean;
  id?: string;
}) {
  const { amount, unit } = splitDelay(delayMs);
  return (
    <div className="am-wait-fields">
      <div className="am-delay-picker">
        <input
          id={id}
          type="number"
          min={0}
          step={1}
          value={amount}
          disabled={disabled}
          aria-label="Wait amount"
          onChange={(e) =>
            onChange(delayToMs(Math.max(0, Number(e.target.value) || 0), unit))
          }
        />
        <select
          value={unit}
          disabled={disabled}
          aria-label="Wait unit"
          onChange={(e) => onChange(delayToMs(amount, e.target.value as DelayUnit))}
        >
          <option value="minutes">minutes</option>
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
      </div>
      <div className="am-presets">
        <button
          type="button"
          className={`am-preset ${delayMs === 0 ? "is-on" : ""}`}
          disabled={disabled}
          onClick={() => onChange(0)}
        >
          No wait
        </button>
        {WAIT_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={`am-preset ${delayMs === preset.ms ? "is-on" : ""}`}
            disabled={disabled}
            onClick={() => onChange(preset.ms)}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function WaitNode({
  node,
  selected,
  editable,
  showSchedule,
  busy,
  onSelectStep,
  onSaveWait,
  onDeleteStep,
}: {
  node: Extract<FlowTreeNode, { type: "wait" }>;
  selected: boolean;
  editable: boolean;
  showSchedule: boolean;
  busy?: boolean;
  onSelectStep?: (stepId: string, emailId?: string | null) => void;
  onSaveWait?: (stepId: string, draft: WaitDraft) => void;
  onDeleteStep?: (stepId: string) => void;
}) {
  const canEdit = editable && !!onSaveWait;
  const [draft, setDraft] = useState(node.delayMs);
  // The saved value wins whenever the step reloads, so a save that the server
  // rounded or rejected does not leave the box showing something untrue.
  useEffect(() => setDraft(node.delayMs), [node.delayMs, node.id]);

  const open = canEdit && selected;
  const dirty = draft !== node.delayMs;

  if (!open) {
    const Tag = onSelectStep ? "button" : "div";
    return (
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
          <strong>{node.delayMs <= 0 ? "No wait" : node.label}</strong>
        </div>
        <span className="am-node-side">
          {showSchedule ? <span className="am-at">{atLabel(node.atMs)}</span> : null}
          {canEdit ? (
            <span className="am-edit-cue" aria-hidden>
              <PencilGlyph />
            </span>
          ) : null}
        </span>
      </Tag>
    );
  }

  return (
    <div className="am-node am-wait-node is-selected is-editing">
      <span className="am-glyph">
        <ClockGlyph />
      </span>
      <div className="am-node-copy">
        <div className="am-edit-head">
          <span className="am-kicker">Wait</span>
          {showSchedule ? (
            <span className="am-at">
              {atLabel(node.atMs - node.delayMs + draft)}
            </span>
          ) : null}
        </div>
        <WaitFields delayMs={draft} onChange={setDraft} disabled={busy} />
        <div className="am-edit-actions">
          {dirty ? (
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => onSaveWait?.(node.id, { delayMs: draft })}
            >
              {busy ? "Saving..." : "Save wait"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => onSelectStep?.("")}
          >
            Done
          </button>
          {onDeleteStep ? (
            <button
              type="button"
              className="btn btn-danger btn-sm am-edit-remove"
              disabled={busy}
              onClick={() => onDeleteStep(node.id)}
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ConditionNode({
  node,
  selected,
  editable,
  showSchedule,
  busy,
  onSelectStep,
  onSaveCondition,
  onDeleteStep,
}: {
  node: Extract<FlowTreeNode, { type: "condition" }>;
  selected: boolean;
  editable: boolean;
  showSchedule: boolean;
  busy?: boolean;
  onSelectStep?: (stepId: string, emailId?: string | null) => void;
  onSaveCondition?: (stepId: string, draft: ConditionDraft) => void;
  onDeleteStep?: (stepId: string) => void;
}) {
  const canEdit = editable && !!onSaveCondition;
  const [kind, setKind] = useState<ConditionKind>(node.kind);
  const [label, setLabel] = useState(node.label);
  useEffect(() => {
    setKind(node.kind);
    setLabel(node.label);
  }, [node.kind, node.label, node.id]);

  const open = canEdit && selected;
  const dirty = kind !== node.kind || label.trim() !== node.label;

  if (!open) {
    const Tag = onSelectStep ? "button" : "div";
    return (
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
        <span className="am-node-side">
          {showSchedule ? <span className="am-at">{atLabel(node.atMs)}</span> : null}
          {canEdit ? (
            <span className="am-edit-cue" aria-hidden>
              <PencilGlyph />
            </span>
          ) : null}
        </span>
      </Tag>
    );
  }

  return (
    <div className="am-node am-condition is-selected is-editing">
      <span className="am-glyph">
        <SplitGlyph />
      </span>
      <div className="am-node-copy">
        <div className="am-edit-head">
          <span className="am-kicker">If / else</span>
          {showSchedule ? <span className="am-at">{atLabel(node.atMs)}</span> : null}
        </div>
        <div className="am-inline-fields">
          <select
            value={kind}
            disabled={busy}
            aria-label="Question type"
            onChange={(e) => setKind(e.target.value as ConditionKind)}
          >
            {CONDITION_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <input
            value={label}
            disabled={busy}
            aria-label="Question"
            placeholder="Opened the last email?"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="am-edit-actions">
          {dirty ? (
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => onSaveCondition?.(node.id, { kind, label })}
            >
              {busy ? "Saving..." : "Save question"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => onSelectStep?.("")}
          >
            Done
          </button>
          {onDeleteStep ? (
            <button
              type="button"
              className="btn btn-danger btn-sm am-edit-remove"
              disabled={busy}
              onClick={() => onDeleteStep(node.id)}
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Step({
  node,
  selectedId,
  previewHint,
  editable,
  showSchedule,
  busy,
  onSelectEmail,
  onSelectStep,
  onAddStep,
  onSaveWait,
  onSaveCondition,
  onDeleteStep,
  last,
}: {
  node: FlowTreeNode;
  selectedId?: string | null;
  previewHint: boolean;
  editable: boolean;
  showSchedule: boolean;
  busy?: boolean;
  onSelectEmail?: (id: string) => void;
  onSelectStep?: (stepId: string, emailId?: string | null) => void;
  onAddStep?: (stepType: FlowStepType, at: FlowInsertAt) => void;
  onSaveWait?: (stepId: string, draft: WaitDraft) => void;
  onSaveCondition?: (stepId: string, draft: ConditionDraft) => void;
  onDeleteStep?: (stepId: string) => void;
  last: boolean;
}) {
  const selected =
    node.id === selectedId ||
    (node.type === "email" &&
      (node.emailId === selectedId || node.email?.id === selectedId));

  if (node.type === "wait") {
    return (
      <li className="am-step">
        <WaitNode
          node={node}
          selected={selected}
          editable={editable}
          showSchedule={showSchedule}
          busy={busy}
          onSelectStep={onSelectStep}
          onSaveWait={onSaveWait}
          onDeleteStep={onDeleteStep}
        />
        {!last ? <span className="am-rail" aria-hidden /> : null}
      </li>
    );
  }

  if (node.type === "condition") {
    return (
      <li className="am-step">
        <ConditionNode
          node={node}
          selected={selected}
          editable={editable}
          showSchedule={showSchedule}
          busy={busy}
          onSelectStep={onSelectStep}
          onSaveCondition={onSaveCondition}
          onDeleteStep={onDeleteStep}
        />
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
              showSchedule={showSchedule}
              busy={busy}
              onSelectEmail={onSelectEmail}
              onSelectStep={onSelectStep}
              onAddStep={onAddStep}
              onSaveWait={onSaveWait}
              onSaveCondition={onSaveCondition}
              onDeleteStep={onDeleteStep}
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
              showSchedule={showSchedule}
              busy={busy}
              onSelectEmail={onSelectEmail}
              onSelectStep={onSelectStep}
              onAddStep={onAddStep}
              onSaveWait={onSaveWait}
              onSaveCondition={onSaveCondition}
              onDeleteStep={onDeleteStep}
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
        {showSchedule ? (
          <span className="am-node-side">
            <span className="am-at">{atLabel(node.atMs)}</span>
          </span>
        ) : null}
      </Tag>
      {!last ? <span className="am-rail" aria-hidden /> : null}
    </li>
  );
}

function TriggerNode({
  kind,
  label,
  editable,
  busy,
  onSaveTrigger,
}: {
  kind: TriggerKind;
  label: string;
  editable: boolean;
  busy?: boolean;
  onSaveTrigger?: (draft: TriggerDraft) => void;
}) {
  const canEdit = editable && !!onSaveTrigger;
  const [open, setOpen] = useState(false);
  const [kindDraft, setKindDraft] = useState<TriggerKind>(kind);
  const [labelDraft, setLabelDraft] = useState(label);
  useEffect(() => {
    setKindDraft(kind);
    setLabelDraft(label);
  }, [kind, label]);

  const dirty = kindDraft !== kind || labelDraft.trim() !== label.trim();

  if (!canEdit || !open) {
    return (
      <div className="am-node am-trigger">
        <span className="am-glyph">
          <TriggerGlyph kind={kind} />
        </span>
        <div className="am-node-copy">
          <span className="am-kicker">Trigger · {triggerKindLabel(kind)}</span>
          <strong>{label}</strong>
        </div>
        {canEdit ? (
          <span className="am-node-side">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setOpen(true)}
            >
              Edit trigger
            </button>
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="am-node am-trigger is-editing">
      <span className="am-glyph">
        <TriggerGlyph kind={kindDraft} />
      </span>
      <div className="am-node-copy">
        <span className="am-kicker">Trigger</span>
        <div className="am-inline-fields">
          <select
            value={kindDraft}
            disabled={busy}
            aria-label="What starts it"
            onChange={(e) => setKindDraft(coerceTriggerKind(e.target.value))}
          >
            {TRIGGER_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <input
            value={labelDraft}
            disabled={busy}
            aria-label="Trigger"
            placeholder="Tag added: New patient"
            onChange={(e) => setLabelDraft(e.target.value)}
          />
        </div>
        <div className="am-edit-actions">
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || !dirty}
            onClick={() => {
              onSaveTrigger?.({ kind: kindDraft, label: labelDraft });
              setOpen(false);
            }}
          >
            {busy ? "Saving..." : "Save trigger"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => {
              setKindDraft(kind);
              setLabelDraft(label);
              setOpen(false);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
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
  onSaveTrigger,
  onSaveWait,
  onSaveCondition,
  onDeleteStep,
  busy,
  previewHint = false,
  editable = false,
  showSchedule,
}: Props) {
  const tree = buildAutomationTree({ triggerLabel, triggerKind, emails, steps });
  const kind = coerceTriggerKind(triggerKind);
  const schedule = showSchedule ?? editable;

  return (
    <div className="am-root">
      <TriggerNode
        kind={kind}
        label={tree.trigger.label}
        editable={editable}
        busy={busy}
        onSaveTrigger={onSaveTrigger}
      />
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
        showSchedule={schedule}
        busy={busy}
        onSelectEmail={onSelectEmail}
        onSelectStep={onSelectStep}
        onAddStep={onAddStep}
        onSaveWait={onSaveWait}
        onSaveCondition={onSaveCondition}
        onDeleteStep={onDeleteStep}
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
  unit: DelayUnit;
  onAmount: (n: number) => void;
  onUnit: (u: DelayUnit) => void;
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
        onChange={(e) => onUnit(e.target.value as DelayUnit)}
        aria-label="Wait unit"
      >
        <option value="minutes">minutes</option>
        <option value="hours">hours</option>
        <option value="days">days</option>
      </select>
    </div>
  );
}
