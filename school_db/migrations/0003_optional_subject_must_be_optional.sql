-- =====================================================================
-- 0003 — A "chosen" subject must actually be optional
--
-- student_subjects holds the optional/elective subjects a student picked. The
-- trigger checked class, stream and year but not optionality, so a compulsory
-- subject could be stored as a choice. Nothing breaks visibly, but the student's
-- marks and report card then depend on a row that should not exist.
--
-- The API service already refuses this; the database now does too, so a bug in any
-- service cannot corrupt a student's year.
--
-- On a live database, existing bad rows must be cleared first: keeping them would
-- make the trigger fail forever. Such rows are exactly the compulsory subjects
-- stored as choices, which carry no information (a compulsory subject applies to
-- every student in the class), so deleting them loses nothing.
-- =====================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE v_bad BIGINT;
BEGIN
    SELECT count(*) INTO v_bad
      FROM student_subjects ss
      JOIN class_subjects cs ON cs.id = ss.class_subject_id
     WHERE NOT cs.is_optional;

    IF v_bad > 0 THEN
        RAISE WARNING 'Removing % student_subjects row(s) that name a COMPULSORY subject as a choice.', v_bad;
        DELETE FROM student_subjects ss
         USING class_subjects cs
         WHERE cs.id = ss.class_subject_id AND NOT cs.is_optional;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION validate_student_subject()
RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM enrollments e
        JOIN sections s        ON s.id = e.section_id
        JOIN class_subjects cs ON cs.id = NEW.class_subject_id
        WHERE e.id = NEW.enrollment_id
          AND cs.academic_year_id = e.academic_year_id
          AND cs.class_id = s.class_id
          AND (cs.stream_id IS NULL OR cs.stream_id IS NOT DISTINCT FROM s.stream_id)
          -- only OPTIONAL subjects are "chosen"; a compulsory subject belongs to every
          -- student of the class already, so storing it here is a data error
          AND cs.is_optional
    ) THEN
        RAISE EXCEPTION 'Subject % is not a chosen optional subject of enrollment % (wrong class/stream/year, or it is compulsory)',
            NEW.class_subject_id, NEW.enrollment_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
