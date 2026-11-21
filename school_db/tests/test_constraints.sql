-- Run on a FRESH school_sms database: psql -d school_sms -f tests/test_constraints.sql
-- Part 1 must succeed; Part 2 lines must each print an ERROR (that mistake is blocked).
\set ON_ERROR_STOP on
-- ======================= SETUP (must all succeed) =======================
BEGIN;
SET LOCAL app.user_id = '1';
INSERT INTO users (username, password_hash) VALUES ('admin','x');
INSERT INTO staff (employee_no, first_name, last_name, gender, phone, designation, staff_type, join_date, show_on_website)
 VALUES ('EMP001','Ram','Sharma','male','9800000000','Teacher','teaching','2020-01-01', true);
INSERT INTO students (admission_no, first_name, last_name, gender, dob) VALUES ('ADM001','Sita','Thapa','female','2014-05-10'),('ADM002','Gita','Rai','female','2014-02-01');
INSERT INTO sections (academic_year_id, class_id, name) VALUES (1,(SELECT id FROM classes WHERE numeric_level=10),'A');
INSERT INTO sections (academic_year_id, class_id, name) VALUES (1,(SELECT id FROM classes WHERE numeric_level=9),'A');
INSERT INTO subjects (code,name) VALUES ('MATH','Mathematics'),('OPTM','Opt Math'),('COMP','Computer');
INSERT INTO class_subjects (academic_year_id,class_id,subject_id,credit_hours) VALUES (1,13,1,5);
INSERT INTO class_subjects (academic_year_id,class_id,subject_id,is_optional,optional_group) VALUES (1,13,2,true,'Optional I'),(1,13,3,true,'Optional I');
INSERT INTO enrollments (student_id, academic_year_id, section_id, roll_no, symbol_no) VALUES (1,1,1,1,'S123'),(2,1,2,1,'S124');
INSERT INTO student_subjects VALUES (1,3);   -- Sita chose Computer
-- parallel optional subjects in same period now allowed
INSERT INTO timetable_entries (academic_year_id,section_id,day_of_week,period_id,class_subject_id) VALUES (1,1,0,1,2),(1,1,0,1,3);
INSERT INTO exams (academic_year_id, name, exam_type, is_published) VALUES (1,'First Terminal','terminal',true);
INSERT INTO exam_schedules (exam_id, class_subject_id) VALUES (1,1),(1,3);
INSERT INTO assessment_components (exam_schedule_id,name,component_type,full_marks,pass_marks,credit_hours)
 VALUES (1,'Theory','theory',75,26.25,3.75),(1,'Internal','internal',25,8.75,1.25),(2,'Theory','theory',50,17.5,2);
INSERT INTO marks (component_id, enrollment_id, marks_obtained) VALUES (1,1,68),(2,1,22),(3,1,40);
INSERT INTO marks (component_id, enrollment_id, is_absent) VALUES (2,1,true) ON CONFLICT DO NOTHING;
INSERT INTO exam_results (exam_id, enrollment_id, gpa, final_grade, result_status) VALUES (1,1,4.0,'A+','graded');
-- fees
INSERT INTO invoices (invoice_no, enrollment_id) VALUES ('INV-1',1);
INSERT INTO invoice_items (invoice_id, fee_type_id, amount, discount) VALUES (1,2,3000,500),(1,3,1000,0);
INSERT INTO receipts (receipt_no, student_id, amount, method) VALUES ('RCPT-1',1,2000,'esewa');
INSERT INTO payment_allocations VALUES (1,1,2000);
INSERT INTO notices (title, body, is_public) VALUES ('Dashain Holiday','School closed', true);
COMMIT;

\echo '=== invoice after items + partial payment (expect 4000/500/3500/2000/partial)'
SELECT subtotal, discount_total, total_amount, paid_amount, status FROM invoices WHERE id=1;
INSERT INTO receipts (receipt_no, student_id, amount, method) VALUES ('RCPT-2',1,1500,'cash');
INSERT INTO payment_allocations VALUES (2,1,1500);
\echo '=== after second payment (expect paid)'
SELECT total_amount, paid_amount, status FROM invoices WHERE id=1;
UPDATE receipts SET status='cancelled', cancel_reason='bounced' WHERE id=2;
\echo '=== after cancelling receipt 2 (expect 2000 / partial)'
SELECT paid_amount, status FROM invoices WHERE id=1;
\echo '=== NG grade has NULL grade point'
SELECT grade, grade_point FROM grading_scale_items WHERE grade IN ('A+','D','NG') ORDER BY min_percent DESC;
\echo '=== public_results'
SELECT exam_name, student_name, gpa, final_grade, result_status FROM public_results WHERE symbol_no='S123' AND dob='2014-05-10';

-- ======================= MUST FAIL =======================
\set ON_ERROR_STOP off
\echo '=== EXPECTED ERRORS BELOW (each line = one blocked mistake)'
INSERT INTO academic_years (name,start_date,end_date) VALUES ('BAD','2026-06-01','2027-06-01');
INSERT INTO marks (component_id, enrollment_id, marks_obtained, is_absent) VALUES (1,2,5,true);
INSERT INTO marks (component_id, enrollment_id) VALUES (1,2);
INSERT INTO marks (component_id, enrollment_id, marks_obtained) VALUES (1,1,80) ON CONFLICT (component_id, enrollment_id) DO UPDATE SET marks_obtained=80;
INSERT INTO marks (component_id, enrollment_id, marks_obtained) VALUES (1,2,50);
INSERT INTO exam_schedules (exam_id, class_subject_id) VALUES (1,2);
INSERT INTO assessment_components (exam_schedule_id,name,component_type,full_marks) VALUES (3,'Theory','theory',75);
INSERT INTO marks (component_id, enrollment_id, marks_obtained) VALUES (4,1,50);
INSERT INTO student_subjects VALUES (2,2);
INSERT INTO grading_scale_items (grading_scale_id,min_percent,max_percent,grade,grade_point) VALUES (1,85,95,'X',3.9);
INSERT INTO invoices (invoice_no, enrollment_id) VALUES ('INV-2',1);
INSERT INTO invoice_items (invoice_id, fee_type_id, amount) VALUES (2,2,5000);
INSERT INTO payment_allocations VALUES (1,2,100);
INSERT INTO invoices (invoice_no, enrollment_id) VALUES ('INV-3',2);
INSERT INTO invoice_items (invoice_id, fee_type_id, amount) VALUES (3,2,5000);
INSERT INTO receipts (receipt_no, student_id, amount, method) VALUES ('RCPT-3',1,9000,'cash');
INSERT INTO payment_allocations VALUES (3,3,100);
INSERT INTO payment_allocations VALUES (2,2,100);
INSERT INTO payment_allocations VALUES (3,1,1600);
INSERT INTO teacher_assignments (academic_year_id, section_id, class_subject_id, staff_id)
  VALUES ((SELECT id FROM academic_years WHERE NOT is_current LIMIT 1),1,1,1);
INSERT INTO academic_years (name,start_date,end_date) VALUES ('2084','2027-04-14','2028-04-13');
INSERT INTO teacher_assignments (academic_year_id, section_id, class_subject_id, staff_id) VALUES ((SELECT id FROM academic_years WHERE name='2084'),1,1,1);
INSERT INTO enrollments (student_id, academic_year_id, section_id, roll_no, symbol_no) VALUES (2,(SELECT id FROM academic_years WHERE name='2084'),1,5,NULL);
INSERT INTO book_issues (book_copy_id, student_id, issue_date, due_date) VALUES (1,1,'2026-05-10','2026-05-01');
