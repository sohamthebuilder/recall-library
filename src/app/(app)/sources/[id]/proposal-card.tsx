"use client";

import { useActionState } from "react";
import type { TopicProposal } from "@/core";
import { decideTopicProposal, type FormState } from "../../actions";

const initialState: FormState = { error: null, ok: false };

/** One proposed Topic: approve (and optionally rename), merge into an existing Topic, or reject. */
export function ProposalCard({
  proposal,
  topics,
  primary = false,
}: {
  proposal: TopicProposal;
  topics: { id: string; name: string }[];
  /** Only the first card's Approve is the screen's primary button. */
  primary?: boolean;
}) {
  const [state, action, pending] = useActionState(
    decideTopicProposal.bind(null, proposal.sourceId, proposal.id),
    initialState,
  );
  const nameId = `name-${proposal.id}`;
  const mergeId = `merge-${proposal.id}`;

  return (
    <form action={action} className="panel proposal">
      <div className="row-between">
        <strong>{proposal.name}</strong>
        <span className={proposal.match ? "badge badge-ready" : "badge"}>
          {proposal.match ? `Matches “${proposal.match.name}”` : "New Topic"}
        </span>
      </div>
      {proposal.description ? <p className="muted" style={{ margin: "4px 0 12px" }}>{proposal.description}</p> : null}

      <input type="hidden" name="proposedName" value={proposal.name} />
      {proposal.match ? (
        <p className="hint">
          Approving adds this Source to “{proposal.match.name}”. To keep it separate, type a new name.
        </p>
      ) : null}
      <label htmlFor={nameId}>{proposal.match ? "New Topic name (optional)" : "Name"}</label>
      <input
        id={nameId}
        name="name"
        type="text"
        defaultValue={proposal.match ? "" : proposal.name}
        autoComplete="off"
      />

      {topics.length > 0 ? (
        <>
          <label htmlFor={mergeId}>Or merge into an existing Topic</label>
          <select id={mergeId} name="intoTopicId" defaultValue="">
            <option value="">Choose a Topic…</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </>
      ) : null}

      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="button-row">
        <button className={primary ? "primary" : "accept"} type="submit" name="decision" value="approve" disabled={pending}>
          Approve
        </button>
        {topics.length > 0 ? (
          <button type="submit" name="decision" value="merge" disabled={pending}>
            Merge
          </button>
        ) : null}
        <button type="submit" name="decision" value="reject" disabled={pending}>
          Reject
        </button>
      </div>
    </form>
  );
}
