const { test } = require("node:test");
const assert = require("node:assert/strict");
process.env.DATABASE_URL ||= "postgresql://unused:unused@localhost:1/test";
const { validateReview } = require("../src/services/indianDocumentService");

test("birth dates remain date-only when read from PostgreSQL", () => {
  assert.equal(require("pg").types.getTypeParser(1082)("1990-04-15"), "1990-04-15");
});
test("unreadable identity fields can stay blank for face comparison", () => {
  assert.equal(validateReview({ fullName: "", documentNumber: "" }, "Aadhaar").number, "");
});

test("masked Aadhaar and year-only dates survive review", () => {
  const result = validateReview({ fullName: "Sample", documentNumber: "XXXX XXXX 1234", yearOfBirth: "1951" }, "Aadhaar");
  assert.equal(result.dob, "");
  assert.equal(result.year, "1951");
  assert.equal(result.number, "XXXXXXXX1234");
});
test("calendar dates and PAN format are validated at the server", () => {
  assert.throws(() => validateReview({ fullName: "Test", documentNumber: "AAAPT1234Z", dob: "2001-02-30" }, "PAN"), /valid date/);
  assert.throws(() => validateReview({ fullName: "Test", documentNumber: "not-a-pan" }, "PAN"), /format/);
  assert.equal(validateReview({ fullName: "Test", documentNumber: "aaapt1234z" }, "PAN").number, "AAAPT1234Z");
});
