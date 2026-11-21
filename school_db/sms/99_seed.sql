-- =====================================================================
-- File 99: Starter data (edit to match your school)
-- =====================================================================

-- Roles
INSERT INTO roles (name, description) VALUES
 ('super_admin', 'Full system access'),
 ('principal',   'View everything, approve results & discounts'),
 ('admin_staff', 'Student records, admissions'),
 ('teacher',     'Attendance, marks, homework for assigned classes'),
 ('accountant',  'Fees, receipts, expenses, payroll'),
 ('librarian',   'Library module'),
 ('student',     'Student portal'),
 ('parent',      'Parent portal');

-- Permissions — these exact codes are checked by the backend API
INSERT INTO permissions (code, module, description) VALUES
 ('users.manage',         'users',      'Create users, assign roles, reset passwords'),
 ('settings.manage',      'system',     'Change system settings'),
 ('students.view',        'students',   'View student & guardian records'),
 ('students.manage',      'students',   'Create / edit students & guardians'),
 ('staff.view',           'staff',      'View staff records'),
 ('staff.manage',         'staff',      'Create / edit staff'),
 ('academic.manage',      'academic',   'Manage years, sections, subjects, assignments, calendar'),
 ('enrollment.manage',    'enrollment', 'Enroll, promote, change roll numbers'),
 ('attendance.view',      'attendance', 'View attendance of any section'),
 ('attendance.mark',      'attendance', 'Mark attendance (own sections)'),
 ('attendance.mark_any',  'attendance', 'Mark attendance for any section'),
 ('exams.manage',         'exams',      'Create exams, schedules, components'),
 ('marks.enter',          'exams',      'Enter marks (own subjects)'),
 ('marks.enter_any',      'exams',      'Enter marks for any subject'),
 ('marks.approve',        'exams',      'Verify / approve marks'),
 ('results.view',         'exams',      'View results of any student'),
 ('results.process',      'exams',      'Calculate results'),
 ('results.publish',      'exams',      'Publish / unpublish results'),
 ('fees.view',            'fees',       'View invoices, receipts, ledgers'),
 ('fees.manage',          'fees',       'Fee types, structures, generate invoices'),
 ('fees.collect',         'fees',       'Collect fees & issue receipts'),
 ('fees.discount',        'fees',       'Approve discounts'),
 ('fees.cancel_receipt',  'fees',       'Cancel receipts'),
 ('expenses.manage',      'accounts',   'Record expenses'),
 ('payroll.manage',       'payroll',    'Process payroll'),
 ('notices.manage',       'communication', 'Create notices / events');

-- Role -> permission mapping (students & parents get access through ownership rules, not permissions)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON
  (r.name = 'super_admin')
  OR (r.name = 'principal'   AND p.code NOT IN ('users.manage','settings.manage','fees.cancel_receipt'))
  OR (r.name = 'admin_staff' AND p.code IN ('students.view','students.manage','staff.view','academic.manage',
                                            'enrollment.manage','attendance.view','attendance.mark_any',
                                            'exams.manage','results.view','notices.manage'))
  OR (r.name = 'teacher'     AND p.code IN ('students.view','staff.view','attendance.mark','marks.enter'))
  OR (r.name = 'accountant'  AND p.code IN ('students.view','fees.view','fees.manage','fees.collect',
                                            'fees.discount','fees.cancel_receipt','expenses.manage','payroll.manage'))
  OR (r.name = 'librarian'   AND p.code IN ('students.view','staff.view'));

-- Classes
INSERT INTO classes (name, numeric_level, level_group) VALUES
 ('Nursery', -2, 'pre_primary'), ('LKG', -1, 'pre_primary'), ('UKG', 0, 'pre_primary'),
 ('Grade 1', 1, 'basic'),  ('Grade 2', 2, 'basic'),  ('Grade 3', 3, 'basic'),
 ('Grade 4', 4, 'basic'),  ('Grade 5', 5, 'basic'),  ('Grade 6', 6, 'basic'),
 ('Grade 7', 7, 'basic'),  ('Grade 8', 8, 'basic'),
 ('Grade 9', 9, 'secondary'),   ('Grade 10', 10, 'secondary'),
 ('Grade 11', 11, 'secondary'), ('Grade 12', 12, 'secondary');

-- Streams (+2)
INSERT INTO streams (name) VALUES ('Science'), ('Management'), ('Humanities'), ('Law'), ('Education');

-- Academic year: BS 2083 = Baisakh 1 (14 Apr 2026) to Chaitra 30 (13 Apr 2027)
INSERT INTO academic_years (name, start_date, end_date, is_current)
VALUES ('2083', '2026-04-14', '2027-04-13', TRUE);

-- NEB letter grading (current system, 2078 BS onward). NG = below 35%, no grade point.
-- Applied per component (theory / internal) — see assessment_components.credit_hours
INSERT INTO grading_scales (name, is_default, description)
VALUES ('NEB Letter Grading', TRUE, 'Grades 1-12 letter grading system');

INSERT INTO grading_scale_items (grading_scale_id, min_percent, max_percent, grade, grade_point, description)
SELECT g.id, v.min_p, v.max_p, v.grade, v.gp, v.descr
FROM grading_scales g,
     (VALUES (90, 100.01, 'A+', 4.0, 'Outstanding'),
             (80, 90,     'A',  3.6, 'Excellent'),
             (70, 80,     'B+', 3.2, 'Very Good'),
             (60, 70,     'B',  2.8, 'Good'),
             (50, 60,     'C+', 2.4, 'Satisfactory'),
             (40, 50,     'C',  2.0, 'Acceptable'),
             (35, 40,     'D',  1.6, 'Basic'),
             (0,  35,     'NG', NULL::NUMERIC, 'Not Graded')
     ) AS v(min_p, max_p, grade, gp, descr)
WHERE g.name = 'NEB Letter Grading';

-- Fee types
INSERT INTO fee_types (code, name, is_refundable) VALUES
 ('ADMISSION', 'Admission Fee', FALSE),
 ('TUITION',   'Monthly Tuition Fee', FALSE),
 ('EXAM',      'Examination Fee', FALSE),
 ('TRANSPORT', 'Transport Fee', FALSE),
 ('LAB',       'Lab Fee', FALSE),
 ('COMPUTER',  'Computer Fee', FALSE),
 ('DEPOSIT',   'Caution Deposit', TRUE),
 ('ANNUAL',    'Annual Charge', FALSE);

-- Periods (Sunday–Friday school day)
INSERT INTO periods (name, sequence, start_time, end_time, is_break) VALUES
 ('1st Period', 1, '10:00', '10:45', FALSE),
 ('2nd Period', 2, '10:45', '11:30', FALSE),
 ('3rd Period', 3, '11:30', '12:15', FALSE),
 ('Tiffin',     4, '12:15', '12:45', TRUE),
 ('4th Period', 5, '12:45', '13:30', FALSE),
 ('5th Period', 6, '13:30', '14:15', FALSE),
 ('6th Period', 7, '14:15', '15:00', FALSE),
 ('7th Period', 8, '15:00', '15:45', FALSE);

-- Leave types
INSERT INTO leave_types (name, applies_to, days_per_year, is_paid) VALUES
-- Staff leave based on Labour Act 2074 defaults — adjust to your school's policy
 ('Home Leave',      'staff',   18, TRUE),   -- 1 day per 20 working days
 ('Sick Leave',      'staff',   12, TRUE),
 ('Maternity Leave', 'staff',   98, TRUE),   -- 60 days paid
 ('Paternity Leave', 'staff',   15, TRUE),
 ('Mourning Leave',  'staff',   13, TRUE),
 ('Sick Leave',      'student', NULL, TRUE),
 ('Family Function', 'student', NULL, TRUE);

-- Salary components
INSERT INTO salary_components (name, component_type, is_taxable) VALUES
 ('Basic Salary', 'earning', TRUE), ('Grade', 'earning', TRUE),
 ('Allowance', 'earning', TRUE),    ('Dashain Bonus', 'earning', TRUE),
 ('Provident Fund', 'deduction', FALSE), ('CIT', 'deduction', FALSE),
 ('SSF', 'deduction', FALSE),       ('Income Tax (TDS)', 'deduction', FALSE);

INSERT INTO expense_categories (name) VALUES
 ('Electricity'), ('Water'), ('Internet'), ('Stationery'), ('Maintenance'), ('Fuel'), ('Events'), ('Miscellaneous');

INSERT INTO settings (key, value, description) VALUES
 ('receipt_prefix',    '"RCPT-"',          'Prefix for receipt numbers'),
 ('invoice_prefix',    '"INV-"',           'Prefix for invoice numbers'),
 ('attendance_mode',   '"daily"',          'daily | period_wise'),
 ('date_display',      '"BS"',             'BS | AD — store AD, display BS'),
 ('weekly_holidays',   '[6]',              'Day numbers (0=Sun). 6 = Saturday'),
 ('sms_absent_alert',  'true',             'Send SMS to guardian when student is absent');
