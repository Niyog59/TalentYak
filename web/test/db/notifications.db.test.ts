/**
 * The notification inbox and its preferences, exercised against the real
 * database as real signed-in people.
 *
 * The questions worth asking here are not "does the table exist" — a suite run
 * with the service role would answer that and prove nothing. They are:
 *
 *   · can one person read another person's inbox
 *   · can a person write to their own inbox, or edit what it says about them
 *   · can a person switch off an email the account's safety depends on
 *   · can a signed-in person call the server-only functions directly
 *
 * When the project is not confirmed available, every test SKIPS with the
 * reason printed, and a skipped test is never counted as a pass.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  adminClient,
  createTestUser,
  dbAvailability,
  deleteTestUsers,
  projectRef,
  wasDenied,
  type TestUser,
} from "./harness.ts";

const availability = dbAvailability();
const skip = availability.ready ? false : `database unavailable — ${availability.reason}`;

let personA: TestUser;
let personB: TestUser;
let createdUserIds: string[] = [];
let notificationForA: string;

describe("the notification inbox, as real people", { skip }, () => {
  before(async () => {
    console.log(`Database tests running against project ${projectRef()}`);

    personA = await createTestUser("notify-a");
    personB = await createTestUser("notify-b");
    createdUserIds = [personA.id, personB.id];

    // Written the way the worker writes it: through the server-only function,
    // with the service role.
    const { data, error } = await adminClient().rpc("create_notification", {
      p_profile_id: personA.id,
      p_category: "billing",
      p_title: "Your payment went through",
      p_body: null,
      p_path: "/account/billing",
      p_dedupe_key: `test:${personA.id}`,
      p_outbox_id: null,
    });
    if (error) throw new Error(`Could not seed a notification: ${error.message}`);
    notificationForA = data as string;
  });

  after(async () => {
    await adminClient().from("notifications").delete().in("profile_id", createdUserIds);
    await deleteTestUsers(createdUserIds);
  });

  test("a person reads their own inbox", async () => {
    const { data, error } = await personA.client
      .from("notifications")
      .select("id, title, category_id");

    assert.equal(error, null);
    assert.equal(data?.length, 1);
    assert.equal(data?.[0].id, notificationForA);
    assert.equal(data?.[0].title, "Your payment went through");
  });

  test("a person cannot read anybody else's inbox", async () => {
    const result = await personB.client.from("notifications").select("id, title");
    assert.ok(wasDenied(result), "person B could see person A's notifications");
  });

  test("a person cannot write to their own inbox", async () => {
    // If this were possible, the inbox would be a note-to-self, not a record of
    // what the system did.
    const result = await personA.client.from("notifications").insert({
      profile_id: personA.id,
      category_id: "billing",
      title: "A payment I invented",
    });
    assert.ok(result.error, "a person was able to write their own notification");
  });

  test("a person cannot rewrite what their inbox says", async () => {
    const before = await personA.client.from("notifications").select("title").eq("id", notificationForA).maybeSingle();
    await personA.client.from("notifications").update({ title: "Something else" }).eq("id", notificationForA);
    const after = await personA.client.from("notifications").select("title").eq("id", notificationForA).maybeSingle();

    assert.equal(after.data?.title, before.data?.title, "the title changed");
    assert.equal(after.data?.title, "Your payment went through");
  });

  test("a person marks their own notification read", async () => {
    const { data, error } = await personA.client.rpc("mark_notification_read", { p_id: notificationForA });
    assert.equal(error, null);
    assert.equal(data, true);

    const check = await personA.client.from("notifications").select("read_at").eq("id", notificationForA).maybeSingle();
    assert.ok(check.data?.read_at, "read_at was not set");
  });

  test("marking read cannot reach another person's notification", async () => {
    const { data, error } = await personB.client.rpc("mark_notification_read", { p_id: notificationForA });
    // The function scopes its own update to auth.uid(), so this is a no-op
    // rather than an error — and must report that nothing was marked.
    assert.equal(error, null);
    assert.equal(data, false, "person B marked person A's notification as read");
  });

  test("the server-only functions refuse a signed-in person", async () => {
    const write = await personA.client.rpc("create_notification", {
      p_profile_id: personB.id,
      p_category: "billing",
      p_title: "Written by somebody else",
      p_body: null,
      p_path: null,
      p_dedupe_key: null,
      p_outbox_id: null,
    });
    assert.ok(write.error, "a person could write into another person's inbox");

    const check = await personA.client.rpc("notification_email_allowed", {
      p_profile_id: personB.id,
      p_category: "messages",
    });
    assert.ok(check.error, "a person could read another person's delivery preferences");
  });
});

describe("what a person may switch off", { skip }, () => {
  let person: TestUser;
  let ids: string[] = [];

  before(async () => {
    person = await createTestUser("notify-prefs");
    ids = [person.id];
  });

  after(async () => {
    await adminClient().from("notification_preferences").delete().in("profile_id", ids);
    await deleteTestUsers(ids);
  });

  test("an optional email can be switched off, and the worker then sees it as off", async () => {
    const { error } = await person.client.rpc("set_notification_preference", {
      p_category: "appointment_reminders",
      p_email_enabled: false,
    });
    assert.equal(error, null);

    // The worker's own check, run as the server would run it.
    const { data: allowed } = await adminClient().rpc("notification_email_allowed", {
      p_profile_id: person.id,
      p_category: "appointment_reminders",
    });
    assert.equal(allowed, false, "the worker would still have emailed them");
  });

  test("an essential email cannot be switched off", async () => {
    const { error } = await person.client.rpc("set_notification_preference", {
      p_category: "billing",
      p_email_enabled: false,
    });
    assert.ok(error, "a person switched off billing email");

    const { data: allowed } = await adminClient().rpc("notification_email_allowed", {
      p_profile_id: person.id,
      p_category: "billing",
    });
    assert.equal(allowed, true, "essential email stopped being allowed");
  });

  test("a person cannot write a preference row directly, bypassing the essential rule", async () => {
    const result = await person.client.from("notification_preferences").insert({
      profile_id: person.id,
      category_id: "billing",
      email_enabled: false,
    });
    assert.ok(result.error, "a person wrote a preference row directly");
  });

  test("a person cannot read anybody else's preferences", async () => {
    const other = await createTestUser("notify-prefs-other");
    ids.push(other.id);

    const result = await other.client.from("notification_preferences").select("category_id, email_enabled");
    assert.ok(wasDenied(result), "another person's preferences were readable");
  });

  test("an unknown category is refused rather than silently accepted", async () => {
    const { error } = await person.client.rpc("set_notification_preference", {
      p_category: "not_a_real_category",
      p_email_enabled: true,
    });
    assert.ok(error, "an undefined category was accepted");
  });
});

/**
 * The delivery record backs the founder console's "what actually reached
 * people" panel. It holds recipient email addresses and subject lines, so who
 * can read it matters more than how it renders.
 */
describe("the delivery record", { skip }, () => {
  let person: TestUser;
  let ids: string[] = [];

  before(async () => {
    person = await createTestUser("delivery-reader");
    ids = [person.id];
  });

  after(async () => {
    await deleteTestUsers(ids);
  });

  test("an ordinary signed-in person cannot read delivery records", async () => {
    const result = await person.client
      .from("notification_deliveries")
      .select("recipient_email, subject, state");
    assert.ok(wasDenied(result), "a customer could read who was emailed what");
  });

  test("the columns the founder console reads exist and are shaped as expected", async () => {
    // Read with the service role, as the admin page's own query does after
    // its admin check. This is a schema guard: a renamed column would
    // otherwise only be found by loading the page.
    const { error } = await adminClient()
      .from("notification_deliveries")
      .select("id, template, recipient_email, subject, state, provider, provider_message_id, error, created_at")
      .limit(1);
    assert.equal(error, null, `the founder console's delivery query is broken: ${error?.message}`);
  });
});
