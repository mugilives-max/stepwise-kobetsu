-- Additive only: existing profiles, contracts, consents and payroll are untouched.
CREATE TABLE staffRegistrationRequests (
 id TEXT PRIMARY KEY, staffId TEXT NOT NULL REFERENCES staff(id),
 data TEXT NOT NULL, contentHash TEXT NOT NULL, submittedAt TEXT NOT NULL,
 submitterId TEXT NOT NULL REFERENCES staff(id), submitterName TEXT NOT NULL
);
CREATE INDEX staffRegistrationRequests_staff ON staffRegistrationRequests(staffId,submittedAt);
CREATE TABLE staffRegistrationState (
 staffId TEXT PRIMARY KEY REFERENCES staff(id), required INTEGER NOT NULL DEFAULT 0,
 latestId TEXT NOT NULL DEFAULT '', acceptedId TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE staffRegistrationReviews (
 requestId TEXT PRIMARY KEY REFERENCES staffRegistrationRequests(id), operationId TEXT NOT NULL UNIQUE,
 outcome TEXT NOT NULL CHECK(outcome IN ('accepted','returned')),
 reason TEXT NOT NULL DEFAULT '', reviewedAt TEXT NOT NULL,
 reviewerId TEXT NOT NULL REFERENCES staff(id), reviewerName TEXT NOT NULL
);
CREATE TRIGGER staffRegistrationRequestFixed BEFORE UPDATE ON staffRegistrationRequests BEGIN SELECT RAISE(ABORT,'registration is immutable'); END;
CREATE TRIGGER staffRegistrationRequestRetain BEFORE DELETE ON staffRegistrationRequests BEGIN SELECT RAISE(ABORT,'retain registration'); END;
CREATE TRIGGER staffRegistrationReviewFixed BEFORE UPDATE ON staffRegistrationReviews BEGIN SELECT RAISE(ABORT,'registration review is immutable'); END;
CREATE TRIGGER staffRegistrationReviewRetain BEFORE DELETE ON staffRegistrationReviews BEGIN SELECT RAISE(ABORT,'retain registration review'); END;
