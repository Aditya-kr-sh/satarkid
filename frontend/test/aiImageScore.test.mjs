import assert from "node:assert/strict";
import test from "node:test";
import { aiScorePercent, aiScoreWidth } from "../lib/aiImageScore.mjs";

test("1.47 out of 100 renders as 1.47 percent width", () => {
  assert.equal(aiScorePercent(1.47), 1.47);
  assert.equal(aiScoreWidth(1.47), "1.47%");
});

test("invalid AI scores do not create a full progress bar", () => {
  for (const value of [null, "", NaN, -1, 101]) {
    assert.equal(aiScorePercent(value), null);
    assert.equal(aiScoreWidth(value), "0%");
  }
});
