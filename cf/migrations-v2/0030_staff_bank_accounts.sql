-- Additive only. No contract, consent, salary, profile or payroll rows are rewritten.
CREATE TABLE staffBankRequests (
 id TEXT PRIMARY KEY, staffId TEXT NOT NULL REFERENCES staff(id),
 account TEXT NOT NULL, contentHash TEXT NOT NULL,
 consentVersion TEXT NOT NULL, consentText TEXT NOT NULL,
 consenterId TEXT NOT NULL REFERENCES staff(id), consenterName TEXT NOT NULL, submittedAt TEXT NOT NULL
);
CREATE INDEX staffBankRequests_staff ON staffBankRequests(staffId,submittedAt);
CREATE TABLE staffBankState (
 staffId TEXT PRIMARY KEY REFERENCES staff(id),
 latestId TEXT NOT NULL DEFAULT '', acceptedId TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE staffBankReviews (
 requestId TEXT PRIMARY KEY REFERENCES staffBankRequests(id), operationId TEXT NOT NULL UNIQUE,
 outcome TEXT NOT NULL CHECK(outcome IN ('accepted','returned')),
 reason TEXT NOT NULL DEFAULT '', reviewedAt TEXT NOT NULL,
 reviewerId TEXT NOT NULL REFERENCES staff(id), reviewerName TEXT NOT NULL
);
CREATE TRIGGER staffBankRequestFixed BEFORE UPDATE ON staffBankRequests BEGIN SELECT RAISE(ABORT,'bank consent is immutable'); END;
CREATE TRIGGER staffBankRequestRetain BEFORE DELETE ON staffBankRequests BEGIN SELECT RAISE(ABORT,'retain bank consent'); END;
CREATE TRIGGER staffBankReviewFixed BEFORE UPDATE ON staffBankReviews BEGIN SELECT RAISE(ABORT,'bank review is immutable'); END;
CREATE TRIGGER staffBankReviewRetain BEFORE DELETE ON staffBankReviews BEGIN SELECT RAISE(ABORT,'retain bank review'); END;
