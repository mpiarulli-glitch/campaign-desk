import assert from "node:assert/strict";
import test from "node:test";
import {
  completedTodoScopeReason,
  isNonClientBasecampProject,
  projectLooksLikeClient,
} from "../src/lib/snapshot-completed-todo";

test("projectLooksLikeClient matches Growth OS client projects", () => {
  assert.equal(
    projectLooksLikeClient(
      "CISCo Restaurant + Bar Growth OS - Powered by the Empire Method",
      "Cisco Restaurant + Bar"
    ),
    true
  );
  assert.equal(
    projectLooksLikeClient("Humble Somm Growth OS", "Humble Somm"),
    true
  );
  assert.equal(projectLooksLikeClient("Acme Co", "Acme Co"), true);
});

test("projectLooksLikeClient rejects unrelated projects", () => {
  assert.equal(
    projectLooksLikeClient("Department To-Do's Library", "Cisco Restaurant + Bar"),
    false
  );
  assert.equal(
    projectLooksLikeClient("Other Client Growth OS", "Cisco Restaurant + Bar"),
    false
  );
});

test("internal and template library projects are blocked for snapshot to-dos", () => {
  assert.equal(isNonClientBasecampProject("Department To-Do's Library"), true);
  assert.equal(isNonClientBasecampProject("Deliverable Templates"), true);
  assert.equal(
    isNonClientBasecampProject("Email/SMS + Automation + Linkedin Department"),
    true
  );
  assert.equal(isNonClientBasecampProject("Some Team Template Board"), true);
  assert.equal(
    isNonClientBasecampProject("Cisco Restaurant + Bar Growth OS"),
    false
  );
});

test("completedTodoScopeReason refuses non-client projects before mismatch", () => {
  assert.equal(
    completedTodoScopeReason("Department To-Do's Library", "Cisco Restaurant + Bar"),
    "not-client-project"
  );
  assert.equal(
    completedTodoScopeReason("Other Client Growth OS", "Cisco Restaurant + Bar"),
    "project-mismatch"
  );
  assert.equal(
    completedTodoScopeReason(
      "CISCo Restaurant + Bar Growth OS - Powered by the Empire Method",
      "Cisco Restaurant + Bar"
    ),
    null
  );
});
