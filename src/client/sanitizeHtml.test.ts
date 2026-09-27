// Regression tests for sanitizeHtml, the HTML-email sanitizer in
// sanitizeHtml.ts. These lock in CURRENT, already-shipped behavior only --
// including known quirks (like the empty-spacer-paragraph double-break
// stacking below) that are tracked as separate bugs, not something to fix
// here. Each test is written against sanitizeHtml's public output (never the
// internal helpers) and is meant to read like a plausible visual-regression
// report a user would file after seeing a real email render oddly.
//
// Fixtures are adapted from real marketing/transactional/mailing-list email
// HTML encountered while building this feature (Spectrum, StableHost,
// Amazon/AWS, and a Google Groups mailing list). Any real person's name,
// account number, or contact info has been replaced with an obviously fake
// placeholder; the surrounding structural mess (nesting, spacer tags,
// tracking links) is kept as-is since that's what actually exercises the
// sanitizer.

import { Window } from "happy-dom";
import { beforeAll, describe, expect, test } from "bun:test";
import { sanitizeHtml } from "./sanitizeHtml";

beforeAll(() => {
  // sanitizeHtml uses DOMParser/document/Node directly as globals (it runs
  // in a browser in production), so a DOM implementation needs to be
  // installed before it's called. happy-dom is lighter than jsdom and is
  // enough for the plain-HTML parsing this function does.
  const window = new Window();
  Object.assign(globalThis, {
    document: window.document,
    DOMParser: window.DOMParser,
    Node: window.Node,
  });
});

// Renders sanitizeHtml's output the way client.ts actually consumes it
// (appended into a container element) and returns the resulting innerHTML,
// so assertions read close to "what would show up on screen."
function sanitize(html: string): string {
  const container = document.createElement("div");
  container.appendChild(sanitizeHtml(html));
  return container.innerHTML;
}

describe("sanitizeHtml", () => {
  describe("break collapsing", () => {
    test("a run of many explicit <br> tags collapses to at most 2", () => {
      const html = "Hi<br><br><br><br><br>Bye";
      const out = sanitize(html);
      expect(out).toBe("Hi<br><br>Bye");
    });

    test("consecutive empty Gmail-composer <div>s (each worth one <br>) collapse to a single paragraph-sized gap", () => {
      // A very common Gmail-composer artifact: several blank <div>s in a
      // row used to add vertical space, each unwrapping to one <br>.
      const html = "Hi<div></div><div></div><div></div><div></div>Bye";
      const out = sanitize(html);
      expect(out).toBe("Hi<br><br>Bye");
    });

    test("a <br> run separated only by whitespace/indentation still collapses as one run", () => {
      const html = "Hi<br><br>\n    \n<br><br>Bye";
      const out = sanitize(html);
      expect(out).toBe("Hi<br><br>Bye");
    });

    test("a <br> run touching a kept block element (e.g. a real table) collapses to at most 1, not 2", () => {
      const html = "Hi<br><br><br><table><tr><td>a</td><td>b</td></tr></table>";
      const out = sanitize(html);
      // The run is adjacent to a kept <table>, so it's capped at 1 instead
      // of the usual 2 -- the table itself already reads as a visual break.
      expect(out).toBe("Hi<br><table><tr><td>a</td><td>b</td></tr></table>");
    });

    test("leading and trailing <br>s (a common raw-email artifact) are stripped entirely", () => {
      // Real StableHost email body started with a stray leading <br><br>
      // before any content -- this was reported and fixed; lock in the fix.
      const html = "<br><br>Account security update<br><br>Hi Jane Doe<br>";
      const out = sanitize(html);
      expect(out.startsWith("<br>")).toBe(false);
      expect(out.endsWith("<br>")).toBe(false);
      expect(out).toBe("Account security update<br><br>Hi Jane Doe");
    });
  });

  describe("paragraph/div/blockquote unwrapping", () => {
    test("two plain <p> paragraphs read as a paragraph gap (2 <br>s), not glued together", () => {
      const html = "<p>First paragraph.</p><p>Second paragraph.</p>";
      const out = sanitize(html);
      expect(out).toBe("First paragraph.<br><br>Second paragraph.");
    });

    test("two plain <div> lines read as a single line break (1 <br>), not a paragraph gap", () => {
      const html = "<div>First line.</div><div>Second line.</div>";
      const out = sanitize(html);
      expect(out).toBe("First line.<br>Second line.");
    });

    test("a purely inline wrapper like <font> around block content contributes no break of its own", () => {
      // A <font> wrapping an entire message shouldn't glue every top-level
      // div into one block, but also shouldn't introduce its own spacing.
      const html =
        '<font face="arial"><div>Line one.</div><div>Line two.</div></font>';
      const out = sanitize(html);
      expect(out).toBe("Line one.<br>Line two.");
    });

    test("KNOWN QUIRK (not fixed here): an empty spacer <p> between real paragraphs stacks an extra paragraph gap on top of its neighbors' own gaps", () => {
      // Real Spectrum "Your Statement is Ready" email used
      // <p class="ht-8">&nbsp;</p> as an empty spacer between <p> tags.
      // Each <p> unwrap unconditionally inserts a 2-break gap regardless of
      // whether it has real content, so an empty spacer paragraph adds its
      // own 2-break gap in addition to the gaps its neighbors already
      // contribute -- producing 4 consecutive <br>s here, which the
      // "collapse repeated breaks" pass caps at 2 (not more, but still a
      // visibly larger paragraph-sized gap than a single <p> boundary would
      // give). This is the currently-shipped, arguably-too-spacious
      // behavior -- asserting it here locks in what exists today, not what
      // it should be.
      const html =
        "<h3>Your Account at a Glance</h3>" +
        '<p class="ht-8">&nbsp;</p>' +
        "<p><b>Account Number:</b></p>" +
        "<p>Ending in 0000</p>" +
        '<p class="ht-8">&nbsp;</p>' +
        "<p><b>Statement Amount:</b></p>" +
        "<p>$120.00</p>";
      const out = sanitize(html);
      expect(out).toBe(
        "Your Account at a Glance<br><br>" +
          "<b>Account Number:</b><br><br>" +
          "Ending in 0000<br><br>" +
          "<b>Statement Amount:</b><br><br>" +
          "$120.00",
      );
    });

    test("deeply nested divs (Gmail's gmail_quote reply wrapping) contribute only one break total, not one per nesting level", () => {
      // Real Google Groups mailing-list email: the reply body was wrapped
      // in ~4 levels of nested <div class="gmail_quote">...</div> before
      // reaching the actual paragraph text. A break is only inserted when
      // dest already has content (dest.lastChild), so three of these four
      // divs -- each being the very first (only) child of its parent -- add
      // no break of their own; only the outermost div (a sibling of the
      // "Hi all," div, so its dest already has content) contributes one.
      const html =
        "<div>Hi all,</div>" +
        "<div><div><div><div>" +
        "I have an announcement to share.<br><br>Details follow." +
        "</div></div></div></div>";
      const out = sanitize(html);
      expect(out).toBe(
        "Hi all,<br>I have an announcement to share.<br><br>Details follow.",
      );
    });

    test("an empty <div><font><br></font></div> spacer block (Gmail composer artifact) renders as one paragraph-sized gap", () => {
      // Real mailing-list email used this exact pattern purely for vertical
      // spacing between paragraphs: the div-unwrap contributes 1 <br>, and
      // the literal <br> inside the (also unwrapped) <font> contributes
      // another, landing at exactly 2 -- which collapseRepeatedBreaks
      // leaves untouched since 2 is already at the cap.
      const html =
        "<div>Paragraph one.</div>" +
        '<div><font face="arial, sans-serif"><br></font></div>' +
        "<div>Paragraph two.</div>";
      const out = sanitize(html);
      expect(out).toBe("Paragraph one.<br><br>Paragraph two.");
    });

    test("a <blockquote> is treated like a paragraph (2-break gap), not like a div", () => {
      const html = "<p>Quoting:</p><blockquote>Someone said this.</blockquote>";
      const out = sanitize(html);
      expect(out).toBe("Quoting:<br><br>Someone said this.");
    });
  });

  describe("tables: layout vs. real data", () => {
    test("a pure single-column layout table is flattened away, leaving no <table> in the output", () => {
      // Common marketing-email scaffolding: one <td> of real content per
      // <tr>, used purely to stack blocks vertically.
      const html =
        "<table>" +
        "<tr><td>Step 1: Log in.</td></tr>" +
        "<tr><td>Step 2: Go to settings.</td></tr>" +
        "</table>";
      const out = sanitize(html);
      expect(out).not.toContain("<table");
      expect(out).not.toContain("<td");
      // Cells become paragraph-gap-separated content instead of table rows.
      expect(out).toBe("Step 1: Log in.<br><br>Step 2: Go to settings.");
    });

    test("a real 2-column data table is preserved as an actual <table> with <tr>/<td> structure intact", () => {
      // Real StableHost email used exactly this shape for its numbered
      // setup steps: a step number in one cell, instructions in the other
      // -- two non-empty cells per row, so it's real tabular content, not
      // layout, even though visually it reads like a simple list.
      const html =
        "<table><tr><td>1</td><td>Log in to your account.</td></tr></table>";
      const out = sanitize(html);
      expect(out).toContain("<table>");
      expect(out).toContain("<tr>");
      expect(out).toContain("<td>1</td>");
      expect(out).toContain("<td>Log in to your account.</td>");
    });

    test("a layout table with empty spacer cells alongside one real cell per row is still flattened (spacer cells don't count as a second column)", () => {
      const html =
        "<table>" +
        '<tr><td width="20">&nbsp;</td><td>Real content here.</td><td width="20">&nbsp;</td></tr>' +
        "</table>";
      const out = sanitize(html);
      expect(out).not.toContain("<table");
      expect(out).toBe("Real content here.");
    });

    test("a table nested inside a layout table's cell is handled by its own recursive walk, independent of the outer table's layout-vs-data classification", () => {
      // Outer table: one non-empty column per row (layout). Its single
      // cell contains an inner 2-column real data table, which should
      // survive as an actual <table> even though the outer one is flattened.
      const html =
        "<table><tr><td>" +
        "<table><tr><td>Qty</td><td>2</td></tr></table>" +
        "</td></tr></table>";
      const out = sanitize(html);
      // Only one <table> survives in the output (the inner, real one).
      expect((out.match(/<table>/g) ?? []).length).toBe(1);
      expect(out).toContain("<td>Qty</td>");
      expect(out).toContain("<td>2</td>");
    });

    test("an empty layout-table row (no non-empty cells) contributes no gap at all", () => {
      const html =
        "<table>" +
        "<tr><td>Real content.</td></tr>" +
        "<tr><td>&nbsp;</td></tr>" +
        "<tr><td>More content.</td></tr>" +
        "</table>";
      const out = sanitize(html);
      // The blank middle row's cell content is empty after trimming, so it's
      // skipped -- no extra <br><br> pair for it.
      expect(out).toBe("Real content.<br><br>More content.");
    });
  });

  describe("links", () => {
    test("an http(s) link is kept clickable with target=_blank and rel=noopener noreferrer forced on", () => {
      const html = '<a href="https://example.com/path">Visit us</a>';
      const out = sanitize(html);
      expect(out).toBe(
        '<a href="https://example.com/path" target="_blank" rel="noopener noreferrer">Visit us</a>',
      );
    });

    test("a mailto: link is kept clickable the same as an http(s) link", () => {
      const html = '<a href="mailto:hello@example.com">Email us</a>';
      const out = sanitize(html);
      expect(out).toContain('href="mailto:hello@example.com"');
      expect(out).toContain('target="_blank"');
    });

    test("a javascript: link has its href/target/rel stripped, leaving a plain non-clickable <a> with no javascript: URL exposed", () => {
      // "a" stays in ALLOWED_TAGS regardless of href safety, so the element
      // itself isn't unwrapped -- only the unsafe href (and the target/rel
      // that would normally accompany a safe one) is omitted, leaving an
      // <a> with no href at all rather than a plain text run.
      const html = '<a href="javascript:alert(1)">Click here</a>';
      const out = sanitize(html);
      expect(out).not.toContain("javascript:");
      expect(out).not.toContain("href=");
      expect(out).toBe("<a>Click here</a>");
    });

    test("an empty/whitespace-only <a> tag (a common tracking-pixel artifact) is dropped entirely, leaving no dead clickable gap", () => {
      const html =
        'Before.<a href="https://tracker.example.com/pixel">   </a>After.';
      const out = sanitize(html);
      expect(out).not.toContain("<a");
      expect(out).toBe("Before.After.");
    });

    test("a real tracking/redirect-wrapped href (e.g. a marketing ESP click-tracking URL) is preserved as-is since it's still an http(s) URL", () => {
      // Real StableHost email routed its CTA link through a marketing ESP's
      // redirect/tracking domain -- still a plain https: URL, so it's kept.
      const html =
        '<a href="https://app2.example-esp.com/track.htm?url=https%3A%2F%2Fbilling.example.com%2Fsecurity&amp;track=abc123">Go to Security Settings &rarr;</a>';
      const out = sanitize(html);
      expect(out).toContain(
        'href="https://app2.example-esp.com/track.htm?url=https%3A%2F%2Fbilling.example.com%2Fsecurity&amp;track=abc123"',
      );
    });

    test("a link's text is kept and marked up (e.g. bold inside a link) while its wrapping href logic still applies", () => {
      const html = '<a href="https://example.com"><b>Learn more</b></a>';
      const out = sanitize(html);
      expect(out).toBe(
        '<a href="https://example.com" target="_blank" rel="noopener noreferrer"><b>Learn more</b></a>',
      );
    });
  });

  describe("dropped tags", () => {
    test("script, style, and img tags are removed entirely, including their content/attributes", () => {
      const html =
        "<style>.foo { color: red; }</style>" +
        "<script>alert(1)</script>" +
        '<img src="https://example.com/tracker.gif" alt="tracking pixel">' +
        "Visible text.";
      const out = sanitize(html);
      expect(out).not.toContain("<style");
      expect(out).not.toContain("<script");
      expect(out).not.toContain("<img");
      expect(out).not.toContain("color: red");
      expect(out).not.toContain("alert(1)");
      expect(out).toBe("Visible text.");
    });

    test("an unrecognized/unsafe attribute on a kept tag (e.g. an inline style or onclick) is dropped, only the tag and its safe attributes survive", () => {
      const html = '<b style="color: red" onclick="doEvil()">Bold text</b>';
      const out = sanitize(html);
      expect(out).toBe("<b>Bold text</b>");
    });
  });

  describe("lists", () => {
    test("an unordered list is preserved as real <ul>/<li> structure, not flattened to <br>-separated text", () => {
      const html = "<ul><li>First item</li><li>Second item</li></ul>";
      const out = sanitize(html);
      expect(out).toBe("<ul><li>First item</li><li>Second item</li></ul>");
    });

    test("an ordered list is preserved as real <ol>/<li> structure", () => {
      const html = "<ol><li>Step one</li><li>Step two</li></ol>";
      const out = sanitize(html);
      expect(out).toBe("<ol><li>Step one</li><li>Step two</li></ol>");
    });
  });

  describe("inline formatting", () => {
    test("bold, italic, and underline tags are kept as real elements", () => {
      const html =
        "<b>bold</b> <i>italic</i> <u>underline</u> <strong>strong</strong> <em>em</em>";
      const out = sanitize(html);
      expect(out).toBe(
        "<b>bold</b> <i>italic</i> <u>underline</u> <strong>strong</strong> <em>em</em>",
      );
    });

    test("an unrecognized inline wrapper like <span> is unwrapped but its text content is kept", () => {
      const html =
        '<span style="font-weight:bold">Plain-looking bold text</span>';
      const out = sanitize(html);
      expect(out).toBe("Plain-looking bold text");
    });
  });

  describe("whole-message realistic fixtures", () => {
    test("a realistic marketing-email fragment (nested layout tables + spacer <p>s + tracking link + unsubscribe footer) renders as flattened, readable plain text with clickable links", () => {
      // Adapted from a real StableHost "2FA becomes mandatory" email: mix
      // of plain paragraphs, single-column "numbered step" layout tables,
      // an ESP redirect-tracking CTA link, and a footer with an unsubscribe
      // link plus a mailto contact link.
      const html =
        "<div>Account security update</div>" +
        "<div>Two-factor authentication is becoming mandatory</div>" +
        "<p>Hi Jane Doe</p>" +
        "<p>Set it up now, ahead of the deadline</p>" +
        "<table><tr><td>1. Log in to your Client Area</td></tr></table>" +
        "<table><tr><td>2. Go to Security Settings</td></tr></table>" +
        '<p><a href="https://app2.example-esp.com/track?url=https%3A%2F%2Fbilling.example.com%2Fsecurity">Go to Security Settings</a></p>' +
        '<p>Questions? Reach us at <a href="mailto:billing@example.com">billing@example.com</a>.</p>' +
        '<p><a href="https://example.com/unsubscribe?track=abc">Unsubscribe</a></p>';
      const out = sanitize(html);

      expect(out).not.toContain("<table");
      expect(out).toContain(
        "Account security update<br>Two-factor authentication is becoming mandatory",
      );
      expect(out).toContain("1. Log in to your Client Area");
      expect(out).toContain("2. Go to Security Settings");
      expect(out).toContain('href="mailto:billing@example.com"');
      expect(out).toContain('href="https://example.com/unsubscribe?track=abc"');
      expect(out).not.toContain("<script");
      expect(out).not.toContain("<style");
    });

    test("a realistic mailing-list reply fragment (nested gmail_quote divs, real paragraph text, quoted-footer unsubscribe link) keeps paragraph text readable and preserves the footer link", () => {
      // Adapted from a real Google Groups (civic-techish-nyc) mailing-list
      // reply: several levels of gmail_quote div nesting around the actual
      // message body, followed by Google Groups' standard footer with an
      // unsubscribe mailto link and a "view this discussion" link.
      const html =
        "<div>Hi all,</div>" +
        "<div><div><div>" +
        "I'm sharing an announcement with the group.<br><br>" +
        "Please apply by the deadline. Learn more at " +
        '<a href="https://example.org">example.org</a>.' +
        "</div></div></div>" +
        "<div><br></div>" +
        "-- <br>" +
        "You received this message because you are subscribed to the group.<br>" +
        'To unsubscribe, email <a href="mailto:group+unsubscribe@googlegroups.com">group+unsubscribe@googlegroups.com</a>.<br>' +
        'To view this discussion visit <a href="https://groups.google.com/d/msgid/example/abc">this link</a>.';
      const out = sanitize(html);

      expect(out).toContain(
        "Hi all,<br>I'm sharing an announcement with the group.",
      );
      expect(out).toContain('href="https://example.org"');
      expect(out).toContain('href="mailto:group+unsubscribe@googlegroups.com"');
      expect(out).toContain(
        'href="https://groups.google.com/d/msgid/example/abc"',
      );
      expect(out).not.toContain("<div");
    });
  });
});
