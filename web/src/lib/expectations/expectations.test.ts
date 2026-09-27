import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanList, cleanText, paragraphs } from "@/lib/expectations/text";
import { diffCoach, diffPlatform } from "@/lib/expectations/diff";
import { COACH_STARTER, PLATFORM_STARTER } from "@/lib/expectations/template";
import { POLICY_LINK_OPTIONS, missingCoachFields, missingPlatformFields } from "@/lib/expectations/types";

describe("authored text is cleaned, never interpreted", () => {
  test("bidirectional overrides and zero-width characters are removed", () => {
    // U+202E would display "evil.exe" reversed; U+200B hides inside a word.
    assert.equal(cleanText("safe‮txt.exe​", 100), "safetxt.exe");
  });

  test("markup is kept as literal text for React to escape, not stripped into something else", () => {
    assert.equal(cleanText("<script>alert(1)</script>", 100), "<script>alert(1)</script>");
  });

  test("length is capped and runs of blank lines collapse", () => {
    assert.equal(cleanText("a\n\n\n\n\nb", 100), "a\n\nb");
    assert.equal(cleanText("x".repeat(50), 10).length, 10);
    assert.equal(cleanText(42, 10), "");
  });

  test("lists: one point per line, bullets dropped, capped in count and length", () => {
    assert.deepEqual(cleanList("- one\n\n• two\n* three", 12, 300), ["one", "two", "three"]);
    assert.equal(cleanList(Array.from({ length: 20 }, (_, i) => `p${i}`).join("\n"), 12, 300).length, 12);
    assert.equal(cleanList("y".repeat(400), 12, 300)[0].length, 300);
  });

  test("paragraphs split on blank lines only", () => {
    assert.deepEqual(paragraphs("a\nb\n\nc"), ["a\nb", "c"]);
  });
});

describe("what changed between versions", () => {
  test("identical versions show no changes", () => {
    assert.deepEqual(diffCoach(COACH_STARTER, { ...COACH_STARTER }), []);
    assert.deepEqual(diffPlatform(PLATFORM_STARTER, { ...PLATFORM_STARTER }), []);
  });

  test("whitespace-only edits are not reported as changes", () => {
    assert.deepEqual(diffCoach(COACH_STARTER, { ...COACH_STARTER, provides: `  ${COACH_STARTER.provides}  ` }), []);
  });

  test("a text change shows the whole sentence before and after", () => {
    const after = { ...COACH_STARTER, response_expectation: "Within two working days." };
    const changes = diffCoach(COACH_STARTER, after);
    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0], {
      kind: "text",
      section: "Your coaching arrangement",
      label: "How quickly I usually reply",
      before: COACH_STARTER.response_expectation,
      after: "Within two working days.",
    });
  });

  test("list changes name what was added and removed", () => {
    const after = { ...COACH_STARTER, client_part: [...COACH_STARTER.client_part.slice(1), "Bring water to sessions."] };
    const [c] = diffCoach(COACH_STARTER, after);
    assert.equal(c.kind, "list");
    assert.deepEqual(c.kind === "list" && c.added, ["Bring water to sessions."]);
    assert.deepEqual(c.kind === "list" && c.removed, [COACH_STARTER.client_part[0]]);
  });

  test("policy link changes are described by their page names", () => {
    const [c] = diffPlatform(PLATFORM_STARTER, { ...PLATFORM_STARTER, policy_links: ["/legal/terms"] });
    assert.equal(c.kind, "list");
    assert.deepEqual(c.kind === "list" && c.removed, ["Privacy notice", "Contact support"]);
  });
});

describe("starter templates and required parts", () => {
  test("the coach starter is publishable as written, and promises no results", () => {
    assert.deepEqual(missingCoachFields(COACH_STARTER), []);
    const all = JSON.stringify(COACH_STARTER).toLowerCase();
    for (const word of ["guarantee", "penalt", "fine ", "forfeit", "waive"]) {
      assert.equal(all.includes(word), false, `starter must not contain "${word}"`);
    }
  });

  test("a coach draft missing required parts is named, not silently accepted", () => {
    const missing = missingCoachFields({ ...COACH_STARTER, appointments: " ", coach_part: [] });
    assert.deepEqual(missing, ["How appointments are arranged", "What your coach commits to"]);
  });

  test("the platform starter invents no email address and links only to our own pages", () => {
    assert.equal(/@|mailto:/.test(JSON.stringify(PLATFORM_STARTER)), false);
    const allowed = new Set(POLICY_LINK_OPTIONS.map((o) => o.href));
    for (const href of PLATFORM_STARTER.policy_links) assert.ok(allowed.has(href), href);
    for (const o of POLICY_LINK_OPTIONS) assert.match(o.href, /^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/);
    assert.deepEqual(missingPlatformFields(PLATFORM_STARTER), []);
  });
});

describe("the document is never rendered as raw HTML", () => {
  test("no expectations component or page uses dangerouslySetInnerHTML", () => {
    const roots = ["src/components/expectations", "src/app/coach/expectations", "src/app/admin/expectations", "src/app/(marketing)/account/expectations"];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    for (const r of roots) walk(r);
    assert.ok(files.length >= 8, `expected the expectations files, found ${files.length}`);
    for (const f of files) assert.equal(readFileSync(f, "utf8").includes("dangerouslySetInnerHTML"), false, f);
  });
});
