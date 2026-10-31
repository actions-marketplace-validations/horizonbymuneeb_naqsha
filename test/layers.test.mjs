// Layering and label placement — the two ways a diagram goes from "correct" to
// "looks broken": a label printed through a line, or two labels on the same spot.
//
// Both bugs shipped in v1.4.0 on examples/engine-repo.architecture.json:
//   - every edge painted its own label with its own line, so a later edge's line
//     struck through an earlier edge's chip;
//   - "Agent Surface" and "Integrations" are sibling boundaries that share a top
//     edge, so both labels landed on the same row and overprinted.

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { ROOT, runCli } from "./helpers.mjs";

const scratch = path.join("/tmp/cli-test", "layers");
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(scratch, { recursive: true });

const EXAMPLE = path.join(ROOT, "examples", "engine-repo.architecture.json");
const OUT = path.join(scratch, "engine-repo.html");
const rendered = runCli(["render", EXAMPLE, OUT]);

function html() {
  assert.equal(rendered.status, 0, rendered.stderr);
  return fs.readFileSync(OUT, "utf8");
}

/** Just the drawing. The inline viewer script also mentions these class names. */
function svg(source) {
  const start = source.indexOf('<svg id="diagram"');
  const end = source.indexOf("</svg>", start);
  assert.ok(start > 0 && end > start, "expected the diagram svg");
  return source.slice(start, end);
}

/** Every group label as the view draws it: x, baseline y, and the text it holds. */
function groupLabels(source) {
  const labels = [];
  const re = /<text class="group-label"([^>]*)><tspan x="([\d.]+)" y="([\d.]+)">([^<]*)<\/tspan>/g;
  let match;
  while ((match = re.exec(source))) {
    const [, attrs, x, y, text] = match;
    labels.push({
      text,
      anchor: /text-anchor="end"/.test(attrs) ? "end" : "start",
      x: Number(x),
      y: Number(y),
    });
  }
  return labels;
}

/** .group-label is 11px/600 with 0.09em tracking: 8.8px a glyph, measured. */
function labelWidth(text) {
  return Math.round(text.length * 8.8) + 2;
}

function box(label) {
  const w = labelWidth(label.text);
  return {
    x: label.anchor === "end" ? label.x - w : label.x,
    y: label.y - 11,
    w,
    h: 15,
  };
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

test("group labels never print on top of each other", () => {
  const labels = groupLabels(html());
  assert.ok(labels.length >= 4, `expected every group label, got ${labels.length}`);
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = box(labels[i]);
      const b = box(labels[j]);
      assert.equal(
        overlaps(a, b),
        false,
        `"${labels[i].text}" and "${labels[j].text}" overlap: ` +
          `(${a.x},${a.y},${a.w}) vs (${b.x},${b.y},${b.w})`,
      );
    }
  }
});

test("a label that would collide falls back to the right edge of its own box", () => {
  const labels = groupLabels(html());
  const surface = labels.find((label) => /AGENT SURFACE/.test(label.text));
  assert.ok(surface, "expected the Agent Surface boundary label");
  assert.equal(surface.anchor, "end", "the outer boundary label moves right when the inner one takes the corner");
});

test("edge lines all paint before any edge label", () => {
  const source = svg(html());
  const linesLayer = source.indexOf('<g class="lay-edges"');
  const labelsLayer = source.indexOf('<g class="lay-edge-labels"');
  const nodesLayer = source.indexOf('<g class="lay-nodes"');
  assert.ok(linesLayer > 0 && labelsLayer > linesLayer, "labels layer must follow the lines layer");
  assert.ok(nodesLayer > labelsLayer, "nodes still paint above both");

  const firstLabel = source.indexOf('class="edge-label-group"');
  const lastLine = source.lastIndexOf('class="edge-line"');
  assert.ok(firstLabel > 0, "expected edge labels");
  assert.ok(
    firstLabel > lastLine,
    "no edge line may be emitted after a label, or it paints through the chip",
  );
});

test("every label chip carries the id of the edge it belongs to", () => {
  const source = svg(html());
  const tags = source.match(/<g class="edge[^"]*edge-tag"[^>]*>/g) || [];
  const labelled = (source.match(/class="edge-label-group"/g) || []).length;
  assert.ok(labelled > 0, "expected labelled edges");
  assert.equal(tags.length, labelled, "one tag group per drawn label");
  for (const tag of tags) {
    assert.match(tag, /data-edge-id="/, "the viewer needs the id to highlight on hover");
    assert.match(tag, /data-from="/);
    assert.match(tag, /data-to="/);
  }
});
