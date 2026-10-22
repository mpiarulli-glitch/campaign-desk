import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_MANAGER_REVIEW_SECTIONS,
  accountManagerQueueNote,
  accountManagerReviewSection,
  accountManagerSlugFromOwner,
  accountManagerSlugFromReviewerName,
  accountManagerViewerSlug,
  campaignAssignedToAccountManager,
  campaignApprovedByAccountManager,
  campaignInAccountManagerQueue,
  campaignOnAccountManagerMainList,
  campaignVisibleToAccountManager,
  campaignsVisibleToViewer,
  isCampaignAccountManagerSlug,
  revisionAuthorForFeedback,
} from "../src/lib/campaign-review-queue";

test("account manager queue is the internal loop for work sent to them or revised by them", () => {
  assert.equal(isCampaignAccountManagerSlug("cassidy"), true);
  assert.equal(isCampaignAccountManagerSlug("kyle_morris"), true);
  assert.equal(isCampaignAccountManagerSlug("luis_romero"), true);
  assert.equal(isCampaignAccountManagerSlug("kyle_onstott"), false);
  assert.equal(isCampaignAccountManagerSlug("michael"), false);
  assert.equal(isCampaignAccountManagerSlug(null), false);

  assert.deepEqual(
    ACCOUNT_MANAGER_REVIEW_SECTIONS.map((section) => section.status),
    ["internal_review", "revisions_made", "needs_revisions_internal"]
  );
  assert.equal(accountManagerReviewSection("internal_review"), "needs_review");
  assert.equal(accountManagerReviewSection("revisions_made"), "revisions_made");
  assert.equal(
    accountManagerReviewSection("needs_revisions_internal"),
    "revisions_left"
  );
  assert.equal(accountManagerReviewSection("draft"), null);
  assert.equal(accountManagerReviewSection("in_review"), null);
  assert.equal(
    accountManagerQueueNote("needs_revisions_internal"),
    "Waiting on Michael"
  );
  assert.equal(accountManagerQueueNote("revisions_made"), null);

  const sentToCassidy = {
    status: "internal_review",
    owner_key: "luis_romero",
    review_assignee: "cassidy",
  };
  assert.equal(campaignAssignedToAccountManager(sentToCassidy, "cassidy"), true);
  assert.equal(campaignInAccountManagerQueue(sentToCassidy, "cassidy"), true);
  assert.equal(campaignInAccountManagerQueue(sentToCassidy, "kyle_morris"), false);

  const clientOwnerOnly = {
    status: "internal_review",
    owner_key: "cassidy",
    review_assignee: "",
    internal_revision_authors: "",
  };
  // No assignee and no revision author: the client owner is the fallback.
  assert.equal(campaignVisibleToAccountManager(clientOwnerOnly, "cassidy"), true);
  assert.equal(campaignInAccountManagerQueue(clientOwnerOnly, "cassidy"), true);
  assert.equal(campaignVisibleToAccountManager(clientOwnerOnly, "kyle_morris"), false);

  const assignedToKyle = {
    status: "revisions_made",
    owner_key: "cassidy",
    review_assignee: "kyle_morris",
    internal_revision_authors: "cassidy",
  };
  assert.equal(campaignAssignedToAccountManager(assignedToKyle, "kyle_morris"), true);
  assert.equal(campaignInAccountManagerQueue(assignedToKyle, "kyle_morris"), true);
  assert.equal(campaignVisibleToAccountManager(assignedToKyle, "cassidy"), true);
  assert.equal(campaignInAccountManagerQueue(assignedToKyle, "cassidy"), true);

  const followed = {
    status: "approved",
    approved_channel: "internal",
    review_assignee: "kyle_morris",
    internal_revision_authors: "cassidy",
  };
  assert.equal(campaignVisibleToAccountManager(followed, "cassidy"), true);
  assert.equal(campaignVisibleToAccountManager(followed, "kyle_morris"), true);
  assert.equal(campaignInAccountManagerQueue(followed, "cassidy"), false);
  assert.equal(campaignVisibleToAccountManager(followed, "luis_romero"), false);

  const waiting = {
    status: "needs_revisions_internal",
    owner_key: "unassigned",
    internal_review_assignee: "",
    internal_revision_authors: "luis_romero",
  };
  assert.equal(campaignInAccountManagerQueue(waiting, "luis_romero"), true);
  assert.equal(campaignVisibleToAccountManager(waiting, "cassidy"), false);

  const draft = { status: "draft", owner_key: "cassidy", review_assignee: "cassidy" };
  assert.equal(campaignVisibleToAccountManager(draft, "cassidy"), true);
  assert.equal(campaignInAccountManagerQueue(draft, "cassidy"), false);

  const sent = { status: "sent", review_assignee: "cassidy", internal_revision_authors: "" };
  assert.equal(campaignVisibleToAccountManager(sent, "cassidy"), true);
  assert.equal(campaignInAccountManagerQueue(sent, "cassidy"), false);
});

test("campaign list visibility is the account manager's set, and admins see every row", () => {
  const rows = [
    { id: "sent-cassidy", status: "sent", internal_review_assignee: "cassidy" },
    {
      id: "revised-by-cassidy",
      status: "in_review",
      internal_review_assignee: "kyle_morris",
      internal_revision_authors: "cassidy",
    },
    {
      id: "luis",
      status: "internal_review",
      internal_review_assignee: "luis_romero",
    },
    {
      id: "owned-unrecorded",
      status: "draft",
      internal_review_assignee: "",
      owner_key: "cassidy",
    },
    { id: "nobody", status: "draft", internal_review_assignee: "", owner_key: "unassigned" },
  ];

  assert.deepEqual(
    campaignsVisibleToViewer(rows, { role: "admin", person: "cassidy" }).map((row) => row.id),
    ["sent-cassidy", "revised-by-cassidy", "owned-unrecorded"]
  );
  assert.deepEqual(
    campaignsVisibleToViewer(rows, { role: "admin", person: "kyle_morris" }).map((row) => row.id),
    ["revised-by-cassidy"]
  );
  assert.equal(accountManagerViewerSlug({ role: "admin", person: null }), null);
  assert.equal(accountManagerViewerSlug({ role: "admin", person: "michael" }), null);
  assert.equal(accountManagerViewerSlug({ role: "admin", person: "carlos" }), null);
  assert.equal(accountManagerViewerSlug({ role: "admin", person: "kyle_onstott" }), null);
  assert.deepEqual(
    campaignsVisibleToViewer(rows, { role: "admin", person: null }).map((row) => row.id),
    rows.map((row) => row.id)
  );
  assert.deepEqual(
    campaignsVisibleToViewer(rows, { role: "admin", person: "carlos" }).map((row) => row.id),
    rows.map((row) => row.id)
  );

  assert.equal(accountManagerSlugFromReviewerName("Cassidy Merideth"), "cassidy");
  assert.equal(accountManagerSlugFromReviewerName("Morris Kyle"), "kyle_morris");
  assert.equal(accountManagerSlugFromReviewerName("Kyle Morris"), "kyle_morris");
  assert.equal(accountManagerSlugFromReviewerName("Luis"), "luis_romero");
  assert.equal(accountManagerSlugFromReviewerName("Kyle"), null);
  assert.equal(accountManagerSlugFromReviewerName("Reviewer"), null);
  assert.equal(accountManagerSlugFromReviewerName("Kyle Onstott"), null);

  assert.equal(
    revisionAuthorForFeedback({ sessionSlug: "cassidy", authorName: "Kyle Morris" }),
    "cassidy"
  );
  assert.equal(
    revisionAuthorForFeedback({ sessionSlug: "michael", authorName: "Cassidy" }),
    null
  );
  assert.equal(
    revisionAuthorForFeedback({ sessionSlug: "cassidy:impersonated", authorName: "Cassidy" }),
    null
  );
  const approvedByCassidy = {
    id: "approved-by-cassidy",
    status: "approved",
    internal_review_assignee: "cassidy",
    internal_revision_authors: "cassidy",
    internal_approved_by: "cassidy",
  };
  assert.deepEqual(
    campaignsVisibleToViewer(
      [...rows, approvedByCassidy],
      { role: "admin", person: "cassidy" }
    ).map((row) => row.id),
    ["sent-cassidy", "revised-by-cassidy", "owned-unrecorded"]
  );
  assert.deepEqual(
    campaignsVisibleToViewer(
      [...rows, approvedByCassidy],
      { role: "admin", person: "cassidy" },
      "approved"
    ).map((row) => row.id),
    ["approved-by-cassidy"]
  );
  assert.deepEqual(
    campaignsVisibleToViewer(
      [...rows, approvedByCassidy],
      { role: "admin", person: null },
      "approved"
    ).map((row) => row.id),
    [...rows, approvedByCassidy].map((row) => row.id)
  );
  assert.equal(campaignOnAccountManagerMainList(approvedByCassidy, "cassidy"), false);
  assert.equal(campaignApprovedByAccountManager(approvedByCassidy, "cassidy"), true);
  assert.equal(
    campaignApprovedByAccountManager({ ...approvedByCassidy, status: "sent" }, "cassidy"),
    true
  );
  assert.equal(
    campaignOnAccountManagerMainList({ ...approvedByCassidy, status: "live" }, "cassidy"),
    false
  );

  const backWithCassidy = {
    ...approvedByCassidy,
    status: "internal_review",
    internal_review_assignee: "cassidy",
  };
  assert.equal(campaignOnAccountManagerMainList(backWithCassidy, "cassidy"), true);
  assert.equal(campaignApprovedByAccountManager(backWithCassidy, "cassidy"), false);
  assert.equal(campaignInAccountManagerQueue(backWithCassidy, "cassidy"), true);
  assert.equal(
    campaignOnAccountManagerMainList(
      { ...backWithCassidy, status: "revisions_made" },
      "cassidy"
    ),
    true
  );
  assert.equal(
    campaignApprovedByAccountManager(
      { ...backWithCassidy, status: "needs_revisions_internal" },
      "cassidy"
    ),
    false
  );

  const sentToKyle = {
    ...approvedByCassidy,
    status: "internal_review",
    internal_review_assignee: "kyle_morris",
    internal_revision_authors: "cassidy,kyle_morris",
    internal_approved_by: "cassidy,kyle_morris",
  };
  assert.equal(campaignOnAccountManagerMainList(sentToKyle, "cassidy"), false);
  assert.equal(campaignApprovedByAccountManager(sentToKyle, "cassidy"), true);
  assert.equal(campaignOnAccountManagerMainList(sentToKyle, "kyle_morris"), true);
  assert.equal(campaignApprovedByAccountManager(sentToKyle, "kyle_morris"), false);
  assert.equal(campaignInAccountManagerQueue(sentToKyle, "cassidy"), false);

  const kyleOnlyRevised = {
    status: "in_review",
    internal_review_assignee: "cassidy",
    internal_revision_authors: "kyle_morris",
    internal_approved_by: "cassidy",
  };
  assert.equal(campaignOnAccountManagerMainList(kyleOnlyRevised, "kyle_morris"), true);
  assert.equal(campaignApprovedByAccountManager(kyleOnlyRevised, "kyle_morris"), false);
  assert.equal(campaignVisibleToAccountManager(kyleOnlyRevised, "luis_romero"), false);

  // Production shape: Revisions made, notes saved as Reviewer or Michael, no
  // assignee, Owner = Cassidy. It belongs on her queue and her main list.
  const revisionsMadeForOwner = {
    id: "revisions-made-owner",
    status: "revisions_made",
    internal_review_assignee: "",
    internal_revision_authors: "",
    client_account_manager: "Cassidy",
  };
  assert.equal(accountManagerSlugFromOwner("Cassidy"), "cassidy");
  assert.equal(accountManagerSlugFromOwner("Kyle"), "kyle_morris");
  assert.equal(accountManagerSlugFromOwner("Luis"), "luis_romero");
  assert.equal(accountManagerSlugFromOwner("Kyle Onstott"), null);
  assert.equal(accountManagerSlugFromOwner("Reviewer"), null);
  assert.equal(campaignOnAccountManagerMainList(revisionsMadeForOwner, "cassidy"), true);
  assert.equal(campaignApprovedByAccountManager(revisionsMadeForOwner, "cassidy"), false);
  assert.equal(campaignInAccountManagerQueue(revisionsMadeForOwner, "cassidy"), true);
  assert.equal(campaignInAccountManagerQueue(revisionsMadeForOwner, "kyle_morris"), false);
  assert.equal(
    campaignInAccountManagerQueue(
      { ...revisionsMadeForOwner, status: "needs_revisions_internal" },
      "cassidy"
    ),
    true
  );
  assert.equal(
    campaignOnAccountManagerMainList(
      { ...revisionsMadeForOwner, status: "sent" },
      "cassidy"
    ),
    true
  );
  assert.equal(
    campaignInAccountManagerQueue(
      { ...revisionsMadeForOwner, status: "sent" },
      "cassidy"
    ),
    false
  );

  const assignedToSomeoneElse = {
    id: "assigned-elsewhere",
    status: "revisions_made",
    internal_review_assignee: "kyle_morris",
    internal_revision_authors: "",
    client_account_manager: "Cassidy",
  };
  assert.equal(campaignOnAccountManagerMainList(assignedToSomeoneElse, "cassidy"), false);
  assert.equal(campaignInAccountManagerQueue(assignedToSomeoneElse, "cassidy"), false);
  assert.equal(campaignOnAccountManagerMainList(assignedToSomeoneElse, "kyle_morris"), true);

  const namedAssignee = {
    status: "revisions_made",
    internal_review_assignee: "Cassidy Merideth",
    internal_revision_authors: "",
    client_account_manager: "Kyle",
  };
  assert.equal(campaignAssignedToAccountManager(namedAssignee, "cassidy"), true);
  assert.equal(campaignInAccountManagerQueue(namedAssignee, "cassidy"), true);
  assert.equal(campaignOnAccountManagerMainList(namedAssignee, "kyle_morris"), false);

  const backToOwner = {
    ...revisionsMadeForOwner,
    internal_approved_by: "cassidy",
  };
  assert.equal(campaignOnAccountManagerMainList(backToOwner, "cassidy"), true);
  assert.equal(campaignApprovedByAccountManager(backToOwner, "cassidy"), false);
  assert.deepEqual(
    campaignsVisibleToViewer([revisionsMadeForOwner, assignedToSomeoneElse], {
      role: "admin",
      person: "cassidy",
    }).map((row) => row.id),
    ["revisions-made-owner"]
  );
  assert.deepEqual(
    campaignsVisibleToViewer([revisionsMadeForOwner], { role: "admin", person: null }).map(
      (row) => row.id
    ),
    ["revisions-made-owner"]
  );

  assert.equal(
    revisionAuthorForFeedback({ sessionSlug: "", authorName: "Luis Romero" }),
    "luis_romero"
  );
});
