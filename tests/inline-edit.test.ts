import assert from "node:assert/strict";
import test from "node:test";
import { applyTextEdits, replaceBodyInnerHtml } from "../src/lib/inline-edit";

// Shaped like the real thing: full document, a <head> whose media queries are
// the only reason the email works on a phone, and a VML button whose label is
// written twice.
const EMAIL = `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
  <meta charset="utf-8" />
  <title>A Team Update</title>
  <style type="text/css">
    @media screen and (max-width: 600px) {
      .body-copy { font-size: 16px !important; }
    }
  </style>
</head>
<body>
  <table role="presentation" border="0" cellpadding="0" cellspacing="0">
    <tr>
      <td class="body-copy" style="padding: 20px;">Hi there,</td>
    </tr>
    <tr>
      <td class="body-copy">I wanted to send a quick thank-you after our launch party.</td>
    </tr>
    <tr>
      <td>
        <!--[if mso]>
        <v:roundrect href="https://example.com/book" fillcolor="#000000">
          <w:anchorlock/>
          <center style="color:#ffffff;">Book a consultation</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-->
        <a href="https://example.com/book" style="background-color:#000000;">Book a consultation</a>
        <!--<![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;

test("editing copy in the preview", async (t) => {
  await t.test("changes only the run it names", () => {
    const res = applyTextEdits(EMAIL, [
      {
        oldText: "I wanted to send a quick thank-you after our launch party.",
        newText: "I wanted to say thank you after our launch party.",
        ordinal: 0,
      },
    ]);
    assert.equal(res.applied, 1);
    assert.deepEqual(res.skipped, []);
    assert.match(res.html, /I wanted to say thank you after our launch party\./);
    assert.doesNotMatch(res.html, /quick thank-you/);
  });

  await t.test("leaves the head, media queries and doctype untouched", () => {
    const res = applyTextEdits(EMAIL, [
      { oldText: "Hi there,", newText: "Hello,", ordinal: 0 },
    ]);
    assert.ok(res.html.startsWith("<!DOCTYPE html>"));
    assert.match(res.html, /@media screen and \(max-width: 600px\)/);
    assert.match(res.html, /\.body-copy \{ font-size: 16px !important; \}/);
    assert.match(res.html, /xmlns:v="urn:schemas-microsoft-com:vml"/);
  });

  await t.test("rewrites nothing it was not asked to change", () => {
    const before = EMAIL;
    const res = applyTextEdits(EMAIL, [
      { oldText: "Hi there,", newText: "Hello,", ordinal: 0 },
    ]);
    // Everything either side of the edited run is identical, character for
    // character. This is the whole point of splicing rather than re-serialising.
    const at = before.indexOf("Hi there,");
    assert.equal(res.html.slice(0, at), before.slice(0, at));
    assert.equal(
      res.html.slice(at + "Hello,".length),
      before.slice(at + "Hi there,".length)
    );
  });

  // The trap that makes this worth doing carefully: the label a reviewer edits
  // is the anchor, but Outlook renders the copy inside the conditional comment.
  await t.test("carries a button label into its Outlook copy", () => {
    const res = applyTextEdits(EMAIL, [
      { oldText: "Book a consultation", newText: "Book your free consult", ordinal: 0 },
    ]);
    assert.equal(res.applied, 1);
    assert.equal(res.outlookCopiesUpdated, 1);
    assert.equal(
      res.html.match(/Book your free consult/g)?.length,
      2,
      "both the anchor and the VML center should read the new label"
    );
    assert.doesNotMatch(res.html, /Book a consultation/);
  });

  await t.test("counts occurrences past the ones hidden in comments", () => {
    const html = `<p>Shop now</p><!--[if mso]><center>Shop now</center><![endif]--><p>Shop now</p>`;
    // The reviewer edited the second visible paragraph. Counting the comment's
    // copy would have moved this edit onto the wrong one.
    const res = applyTextEdits(html, [
      { oldText: "Shop now", newText: "Browse the sale", ordinal: 1 },
    ]);
    assert.equal(res.html, `<p>Shop now</p><!--[if mso]><center>Browse the sale</center><![endif]--><p>Browse the sale</p>`);
  });

  await t.test("keeps repeated copy apart by position", () => {
    const html = `<td>Learn more</td><td>Learn more</td><td>Learn more</td>`;
    const res = applyTextEdits(html, [
      { oldText: "Learn more", newText: "See the details", ordinal: 1 },
    ]);
    assert.equal(res.html, `<td>Learn more</td><td>See the details</td><td>Learn more</td>`);
  });

  await t.test("applies several edits at once", () => {
    const res = applyTextEdits(EMAIL, [
      { oldText: "Hi there,", newText: "Hello,", ordinal: 0 },
      {
        oldText: "I wanted to send a quick thank-you after our launch party.",
        newText: "Thanks for coming.",
        ordinal: 0,
      },
    ]);
    assert.equal(res.applied, 2);
    assert.match(res.html, /Hello,/);
    assert.match(res.html, /Thanks for coming\./);
  });

  await t.test("escapes text that would otherwise be markup", () => {
    const res = applyTextEdits(EMAIL, [
      { oldText: "Hi there,", newText: "Tom & Jerry <3", ordinal: 0 },
    ]);
    assert.match(res.html, /Tom &amp; Jerry &lt;3/);
    assert.doesNotMatch(res.html, /Tom & Jerry <3/);
  });

  await t.test("finds copy that is written as entities in the source", () => {
    const html = `<p>Coffee &amp; cake</p>`;
    // The browser reports the decoded form, which is not what the source says.
    const res = applyTextEdits(html, [
      { oldText: "Coffee & cake", newText: "Tea & cake", ordinal: 0 },
    ]);
    assert.equal(res.html, `<p>Tea &amp; cake</p>`);
  });

  await t.test("skips an edit it cannot place instead of guessing", () => {
    const res = applyTextEdits(EMAIL, [
      { oldText: "copy that is not in this email", newText: "anything", ordinal: 0 },
    ]);
    assert.equal(res.applied, 0);
    assert.equal(res.skipped.length, 1);
    assert.equal(res.html, EMAIL, "a miss must leave the document alone");
  });

  await t.test("ignores an edit that changes nothing", () => {
    const res = applyTextEdits(EMAIL, [
      { oldText: "Hi there,", newText: "Hi there,", ordinal: 0 },
    ]);
    assert.equal(res.applied, 0);
    assert.deepEqual(res.skipped, []);
    assert.equal(res.html, EMAIL);
  });

  await t.test("an unterminated comment does not swallow the document", () => {
    const html = `<p>Before</p><!-- never closed <p>After</p>`;
    const res = applyTextEdits(html, [
      { oldText: "Before", newText: "Changed", ordinal: 0 },
    ]);
    assert.equal(res.html, `<p>Changed</p><!-- never closed <p>After</p>`);
  });
});

test("text that also appears in an attribute", () => {
  // One text node, but the words occur twice in the source. Counting the
  // attribute would put the edit on the wrong element in a longer document.
  const html = `<a href="/x" title="Book now">Book now</a><p>Book now</p>`;
  const res = applyTextEdits(html, [
    { oldText: "Book now", newText: "Reserve", ordinal: 1 },
  ]);
  assert.equal(
    res.html,
    `<a href="/x" title="Book now">Book now</a><p>Reserve</p>`
  );
});

test("the first visible occurrence is not the attribute", () => {
  const html = `<a title="Book now">Book now</a>`;
  const res = applyTextEdits(html, [
    { oldText: "Book now", newText: "Reserve", ordinal: 0 },
  ]);
  assert.equal(res.html, `<a title="Book now">Reserve</a>`);
});

// The browser decodes entities before we ever see the text, so the copy it
// reports is not the copy the source is written in. Emails here are full of
// &nbsp; because a headline must not leave one word alone on the last line.
test("copy the source writes as entities", async (t) => {
  await t.test("matches a non-breaking space reported as U+00A0", () => {
    const html = `<h1>Find A Signature&nbsp;Piece</h1>`;
    const res = applyTextEdits(html, [
      {
        oldText: "Find A Signature Piece",
        newText: "Find Your Signature Piece",
        ordinal: 0,
      },
    ]);
    assert.equal(res.applied, 1);
    assert.equal(res.html, `<h1>Find Your Signature&nbsp;Piece</h1>`);
  });

  await t.test("writes a non-breaking space back as its entity", () => {
    const html = `<h1>Two words</h1>`;
    const res = applyTextEdits(html, [
      { oldText: "Two words", newText: "Three whole words", ordinal: 0 },
    ]);
    assert.equal(res.html, `<h1>Three whole&nbsp;words</h1>`);
  });

  await t.test("handles a run mixing entities and plain characters", () => {
    const html = `<p>Rings &amp; watches&nbsp;here</p>`;
    const res = applyTextEdits(html, [
      {
        oldText: "Rings & watches here",
        newText: "Rings & necklaces here",
        ordinal: 0,
      },
    ]);
    assert.equal(res.applied, 1);
    assert.equal(res.html, `<p>Rings &amp; necklaces&nbsp;here</p>`);
  });

  await t.test("matches smart punctuation written either way", () => {
    const html = `<p>We&rsquo;re open &mdash; come in</p>`;
    const res = applyTextEdits(html, [
      {
        oldText: "We’re open — come in",
        newText: "We’re open today",
        ordinal: 0,
      },
    ]);
    assert.equal(res.applied, 1);
    assert.equal(res.html, `<p>We’re open today</p>`);
  });

  await t.test("still tells duplicates apart when entities are involved", () => {
    const html = `<td>Visit The&nbsp;Showroom</td><td>Visit The&nbsp;Showroom</td>`;
    const res = applyTextEdits(html, [
      {
        oldText: "Visit The Showroom",
        newText: "Book A Visit",
        ordinal: 1,
      },
    ]);
    assert.equal(
      res.html,
      `<td>Visit The&nbsp;Showroom</td><td>Book A&nbsp;Visit</td>`
    );
  });
});

test("replacing the preview body keeps the document head", () => {
  const source = `<!DOCTYPE html><html><head><style>.x{color:red}</style></head><body><p>Hi</p></body></html>`;
  const out = replaceBodyInnerHtml(
    source,
    `<p>Hi<br>there</p><img src="data:image/png;base64,xx" alt="">`
  );
  assert.match(out, /<!DOCTYPE html>/);
  assert.match(out, /\.x\{color:red\}/);
  assert.match(out, /Hi<br>there/);
  assert.match(out, /data:image\/png;base64,xx/);
  assert.doesNotMatch(out, /<p>Hi<\/p>/);
});

test("fragment emails are replaced wholesale", () => {
  const out = replaceBodyInnerHtml(`<p>Old</p>`, `<p>New<br>line</p>`);
  assert.equal(out, `<p>New<br>line</p>`);
});
