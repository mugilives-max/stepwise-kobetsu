-- Additive only: existing staff, contracts, consent evidence and payroll values stay intact.
ALTER TABLE staff ADD COLUMN employmentAccess INTEGER NOT NULL DEFAULT 1 CHECK(employmentAccess IN (0,1));
ALTER TABLE staff ADD COLUMN testOnly INTEGER NOT NULL DEFAULT 0 CHECK(testOnly IN (0,1));
ALTER TABLE staffRates ADD COLUMN meetingConfigured INTEGER NOT NULL DEFAULT 1 CHECK(meetingConfigured IN (0,1));
ALTER TABLE payrollMonths ADD COLUMN workMinutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payrollMonths ADD COLUMN workAmount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payrollItems ADD COLUMN workDayId TEXT NOT NULL DEFAULT '';

CREATE TABLE employmentProfiles(
 staffId TEXT PRIMARY KEY REFERENCES staff(id),
 data TEXT NOT NULL DEFAULT '{}',
 invitedAt TEXT NOT NULL DEFAULT '',
 createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE employmentContracts(
 id TEXT PRIMARY KEY, staffId TEXT NOT NULL REFERENCES staff(id), revision INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','issued','agreed','withdrawn')),
 method TEXT NOT NULL CHECK(method IN ('paper','electronic')),
 snapshot TEXT NOT NULL, contentHash TEXT NOT NULL,
 startDate TEXT NOT NULL, endDate TEXT NOT NULL,
 issuedAt TEXT NOT NULL DEFAULT '', issuedBy TEXT NOT NULL DEFAULT '',
 preferenceAt TEXT NOT NULL DEFAULT '', recipient TEXT NOT NULL DEFAULT '',
 deliveredAt TEXT NOT NULL DEFAULT '', deliveryNote TEXT NOT NULL DEFAULT '',
 agreedAt TEXT NOT NULL DEFAULT '', consenterName TEXT NOT NULL DEFAULT '',
 evidenceRef TEXT NOT NULL DEFAULT '',
 createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 UNIQUE(staffId,revision)
);
CREATE INDEX employmentContracts_staff ON employmentContracts(staffId,revision);
CREATE TRIGGER employmentContractFixed BEFORE UPDATE OF snapshot,contentHash,staffId,revision,method,startDate,endDate ON employmentContracts
 BEGIN SELECT RAISE(ABORT,'contract versions are immutable; create another version'); END;
CREATE TRIGGER employmentContractRetain BEFORE DELETE ON employmentContracts
 BEGIN SELECT RAISE(ABORT,'retain contract versions'); END;
CREATE TABLE employmentEvents(
 id INTEGER PRIMARY KEY AUTOINCREMENT, contractId TEXT NOT NULL REFERENCES employmentContracts(id),
 action TEXT NOT NULL, actualAt TEXT NOT NULL, recordedAt TEXT NOT NULL, actorId TEXT NOT NULL, actorName TEXT NOT NULL,
 detail TEXT NOT NULL DEFAULT '{}', contractVersion INTEGER NOT NULL,
 UNIQUE(contractId,contractVersion)
);
CREATE TRIGGER employmentEventsNoUpdate BEFORE UPDATE ON employmentEvents BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TRIGGER employmentEventsNoDelete BEFORE DELETE ON employmentEvents BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TABLE workDays(
 id TEXT PRIMARY KEY, staffId TEXT NOT NULL REFERENCES staff(id), date TEXT NOT NULL,
 planned TEXT NOT NULL DEFAULT '[]', actual TEXT NOT NULL DEFAULT '[]',
 planVersion INTEGER NOT NULL DEFAULT 0, planAgreedVersion INTEGER NOT NULL DEFAULT 0,
 planAgreedAt TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','confirmed')),
 note TEXT NOT NULL DEFAULT '', reviewNote TEXT NOT NULL DEFAULT '',
 submittedAt TEXT NOT NULL DEFAULT '', confirmedAt TEXT NOT NULL DEFAULT '', confirmedBy TEXT NOT NULL DEFAULT '',
 payrollId TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, UNIQUE(staffId,date)
);
CREATE TABLE workDayRevisions(
 id INTEGER PRIMARY KEY AUTOINCREMENT, workDayId TEXT NOT NULL REFERENCES workDays(id),
 version INTEGER NOT NULL, snapshot TEXT NOT NULL, reason TEXT NOT NULL,
 recordedAt TEXT NOT NULL, recordedBy TEXT NOT NULL, UNIQUE(workDayId,version)
);
CREATE TRIGGER workDayArchiveInsert AFTER INSERT ON workDays BEGIN
 INSERT INTO workDayRevisions(workDayId,version,snapshot,reason,recordedAt,recordedBy)
 VALUES(NEW.id,NEW.version,json_object('staffId',NEW.staffId,'date',NEW.date,'planned',json(NEW.planned),'actual',json(NEW.actual),'status',NEW.status,'planVersion',NEW.planVersion,'planAgreedVersion',NEW.planAgreedVersion,'note',NEW.note,'reviewNote',NEW.reviewNote,'planAgreedAt',NEW.planAgreedAt,'submittedAt',NEW.submittedAt,'confirmedAt',NEW.confirmedAt,'confirmedBy',NEW.confirmedBy),NEW.reviewNote,NEW.updatedAt,NEW.confirmedBy);
END;
CREATE TRIGGER workDayArchiveUpdate AFTER UPDATE OF version ON workDays BEGIN
 INSERT INTO workDayRevisions(workDayId,version,snapshot,reason,recordedAt,recordedBy)
 VALUES(NEW.id,NEW.version,json_object('staffId',NEW.staffId,'date',NEW.date,'planned',json(NEW.planned),'actual',json(NEW.actual),'status',NEW.status,'planVersion',NEW.planVersion,'planAgreedVersion',NEW.planAgreedVersion,'note',NEW.note,'reviewNote',NEW.reviewNote,'planAgreedAt',NEW.planAgreedAt,'submittedAt',NEW.submittedAt,'confirmedAt',NEW.confirmedAt,'confirmedBy',NEW.confirmedBy),NEW.reviewNote,NEW.updatedAt,NEW.confirmedBy);
END;
CREATE TRIGGER workDayRevisionFixed BEFORE UPDATE ON workDayRevisions BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TRIGGER workDayRevisionRetain BEFORE DELETE ON workDayRevisions BEGIN SELECT RAISE(ABORT,'append only'); END;
CREATE TRIGGER workDayRetain BEFORE DELETE ON workDays BEGIN SELECT RAISE(ABORT,'retain actual work'); END;
CREATE TABLE payrollWorkDays(
 payrollId TEXT NOT NULL REFERENCES payrollMonths(id),workDayId TEXT NOT NULL REFERENCES workDays(id),
 workVersion INTEGER NOT NULL,PRIMARY KEY(payrollId,workDayId)
);

CREATE TRIGGER payrollWorkVersion BEFORE INSERT ON payrollWorkDays
 WHEN NOT EXISTS(SELECT 1 FROM workDays WHERE id=NEW.workDayId AND version=NEW.workVersion AND status='confirmed' AND payrollId='')
 BEGIN SELECT RAISE(ABORT,'work changed during payroll confirmation'); END;

-- Payroll confirmation and actual-work editing are mutually exclusive even under concurrent requests.
CREATE TRIGGER workDayClosedInsert BEFORE INSERT ON workDays
 WHEN NEW.submittedAt<>'' AND EXISTS(SELECT 1 FROM payrollMonths WHERE staffId=NEW.staffId AND status<>'void' AND month>=substr(NEW.date,1,7))
 BEGIN SELECT RAISE(ABORT,'payroll is confirmed; correct payroll before actual work'); END;
CREATE TRIGGER workDayClosedUpdate BEFORE UPDATE OF actual,status,submittedAt,confirmedAt ON workDays
 WHEN EXISTS(SELECT 1 FROM payrollMonths WHERE staffId=NEW.staffId AND status<>'void' AND month>=substr(NEW.date,1,7))
 BEGIN SELECT RAISE(ABORT,'payroll is confirmed; correct payroll before actual work'); END;

ALTER TABLE payrollMonths ADD COLUMN workBasis TEXT NOT NULL DEFAULT '';
CREATE TRIGGER payrollWorkBasis BEFORE INSERT ON payrollMonths
 WHEN NEW.workBasis<>'' AND NEW.workBasis<>(
  SELECT coalesce(json_group_array(json_object('id',id,'version',version,'status',status,'payrollId',payrollId)),'[]')
  FROM (SELECT id,version,status,payrollId FROM workDays WHERE staffId=NEW.staffId AND date<=date(NEW.month||'-01','+1 month','-1 day') AND submittedAt<>'' ORDER BY date)
 )
 BEGIN SELECT RAISE(ABORT,'work changed during payroll confirmation'); END;
