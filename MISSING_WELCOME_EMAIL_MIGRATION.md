# Missing migration from the uploaded requirements

`REQUIREMENTS_AND_STATUS.md` references `welcome_email.sql`, but that file was not included in the ZIP. It is intentionally not fabricated because the SQL asks for two REPLACE values and may rely on project-specific schema or webhook details. Recover the original file before running the full deployment SQL sequence.
