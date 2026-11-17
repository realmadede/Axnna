ALTER TABLE signals ADD COLUMN technical_score REAL;
ALTER TABLE signals ADD COLUMN rejection_reason TEXT;
ALTER TABLE signals ADD COLUMN evidence_payload TEXT;
