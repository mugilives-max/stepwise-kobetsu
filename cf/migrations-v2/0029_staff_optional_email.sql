-- Draft employees may have no email. Keep every existing row and nonempty-email uniqueness.
-- No placeholder address, account activation, invite or contract changes.
DROP INDEX staff_email;
CREATE UNIQUE INDEX staff_email ON staff(email) WHERE email <> '';
