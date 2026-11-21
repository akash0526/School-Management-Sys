// Response shapes of the School API (camelCase). Only fields the UI uses are listed.

export interface Me {
  userId: number
  username: string
  roles: string[]
  permissions: string[]
  staffId: number | null
  studentId: number | null
  guardianId: number | null
  mustChangePassword: boolean
}

export const STUDENT_STATUSES = ['active', 'inactive', 'transferred', 'left', 'graduated', 'dropped'] as const

export interface StudentRow {
  id: number
  admissionNo: string
  firstName: string
  middleName: string | null
  lastName: string
  gender: string
  dob: string
  phone: string | null
  status: string
  photoUrl: string | null
  className: string | null
  sectionName: string | null
  rollNo: number | null
  enrollmentId: number | null
}

export interface Student extends StudentRow {
  userId: number | null
  fullNameNp: string | null
  bloodGroup: string | null
  religion: string | null
  casteEthnicity: string | null
  motherTongue: string | null
  nationality: string | null
  disabilityType: string | null
  birthCertNo: string | null
  province: string | null
  district: string | null
  localLevel: string | null
  wardNo: number | null
  tole: string | null
  temporaryAddress: string | null
  email: string | null
  previousSchool: string | null
  admissionDate: string | null
  leftDate: string | null
}

export interface GuardianLink {
  /** guardian id */
  id: number
  fullName: string
  phone: string
  altPhone: string | null
  email: string | null
  occupation: string | null
  /** set when the guardian has a parent-portal login */
  userId: number | null
  relation: string
  isPrimary: boolean
  canPickup: boolean
}

export interface Guardian {
  id: number
  fullName: string
  phone: string
  email: string | null
  occupation: string | null
  userId: number | null
}

export interface Staff {
  id: number
  userId: number | null
  employeeNo: string
  firstName: string
  middleName: string | null
  lastName: string
  gender: string
  dob: string | null
  phone: string
  email: string | null
  address: string | null
  departmentId: number | null
  departmentName: string | null
  designation: string
  staffType: string
  employmentType: string
  qualification: string | null
  teachingLicenseNo: string | null
  citizenshipNo: string | null
  panNo: string | null
  bankName: string | null
  bankAccountNo: string | null
  joinDate: string
  leaveDate: string | null
  status: string
  showOnWebsite: boolean
  publicBio: string | null
}

export interface Year {
  id: number
  name: string
  startDate: string
  endDate: string
  isCurrent: boolean
}
export interface Term {
  id: number
  name: string
  sequence: number
  startDate: string
  endDate: string
}
export interface ClassRow {
  id: number
  name: string
  numericLevel: number
  levelGroup: string
}
export interface Stream {
  id: number
  name: string
}
export interface Room {
  id: number
  name: string
}
export interface Section {
  id: number
  academicYearId: number
  classId: number
  className: string
  streamId: number | null
  streamName: string | null
  name: string
  classTeacherId: number | null
  classTeacherName: string | null
  capacity: number | null
  studentCount: number
}
export interface Subject {
  id: number
  code: string
  name: string
  nameNp: string | null
  hasPractical: boolean
  isActive: boolean
}
export interface ClassSubject {
  id: number
  academicYearId: number
  classId: number
  streamId: number | null
  subjectId: number
  creditHours: number | null
  isOptional: boolean
  /** students choose at most one subject per optional group */
  optionalGroup: string | null
  sequence: number
  subjectCode: string
  subjectName: string
  className: string
  streamName: string | null
}
export interface Assignment {
  id: number
  sectionId: number
  classSubjectId: number
  staffId: number
  teacherName: string
  className: string
  sectionName: string
  subjectName: string
}
export interface CalendarEntry {
  id: number
  title: string
  startDate: string
  endDate: string
  dayType: string
  isHoliday: boolean
}

export interface Enrollment {
  id: number
  studentId: number
  admissionNo: string
  studentName: string
  academicYearId: number
  academicYear: string
  sectionId: number
  className: string
  sectionName: string
  rollNo: number | null
  symbolNo: string | null
  registrationNo: string | null
  status: string
  enrolledOn: string
}

export interface RosterRow {
  enrollmentId: number
  rollNo: number | null
  studentId: number
  studentName: string
  status: string | null
  remarks: string | null
}
export interface StaffAttendanceRow {
  staffId: number
  employeeNo: string
  staffName: string
  designation: string
  status: string | null
  checkIn: string | null
  checkOut: string | null
  remarks: string | null
}
export interface AttendanceSummary {
  academicYearId: number
  academicYear: string
  presentDays: number
  absentDays: number
  lateDays: number
  leaveDays: number
  recordedDays: number
}
export interface AttendanceRecord {
  attendanceDate: string
  status: string
  remarks: string | null
}

export interface Exam {
  id: number
  academicYearId: number
  name: string
  examType: string
  startDate: string | null
  endDate: string | null
  isPublished: boolean
  publishedAt: string | null
  academicYear: string
  termName: string | null
}
export interface ExamComponent {
  id: number
  name: string
  componentType: string
  fullMarks: number
  passMarks: number
  creditHours: number | null
}
export interface Schedule {
  id: number
  classSubjectId: number
  classId: number
  className: string
  subjectName: string
  examDate: string | null
  startTime: string | null
  endTime: string | null
  components: ExamComponent[]
}
export interface MarkRow {
  enrollmentId: number
  rollNo: number | null
  studentId: number
  studentName: string
  marksObtained: number | null
  isAbsent: boolean
  remarks: string | null
  verifiedAt: string | null
}
export interface Marksheet {
  component: { componentId: number; fullMarks: number; examId: number; examPublished: boolean; classSubjectId: number; classId: number }
  items: MarkRow[]
}
export interface ResultRow {
  enrollmentId: number
  studentId: number
  admissionNo: string
  studentName: string
  className: string
  sectionName: string
  rollNo: number | null
  totalObtained: number | null
  totalFull: number | null
  percentage: number | null
  gpa: number | null
  finalGrade: string | null
  rankInSection: number | null
  rankInClass: number | null
  resultStatus: string
}
export interface ReportCard extends ResultRow {
  examId: number
  examName: string
  academicYear: string
  isPublished: boolean
  symbolNo: string | null
  teacherRemarks: string | null
  subjects: {
    classSubjectId: number
    subjectCode: string
    subjectName: string
    totalObtained: number | null
    totalFull: number | null
    percentage: number | null
    grade: string | null
    gradePoint: number | null
    isGraded: boolean
    components: {
      name: string
      componentType: string
      fullMarks: number
      marksObtained: number | null
      isAbsent: boolean
      grade: string | null
      gradePoint: number | null
      creditHours: number | null
    }[]
  }[]
}
export interface StudentExamResult {
  examId: number
  examName: string
  examType: string
  isPublished: boolean
  academicYear: string
  className: string
  sectionName: string
  resultStatus: string
  percentage: number | null
  gpa: number | null
  finalGrade: string | null
  rankInSection: number | null
}

export interface FeeType {
  id: number
  code: string
  name: string
  isRefundable: boolean
  isActive: boolean
}
export interface FeeStructure {
  id: number
  academicYearId: number
  classId: number
  streamId: number | null
  feeTypeId: number
  amount: number
  frequency: string
  dueDay: number | null
  feeTypeName: string
  className: string
  streamName: string | null
}
export interface Discount {
  id: number
  enrollmentId: number
  feeTypeId: number | null
  feeTypeName: string | null
  discountType: string
  value: number
  reason: string
  validFrom: string | null
  validTo: string | null
}
export interface InvoiceRow {
  id: number
  invoiceNo: string
  billingPeriod: string
  issueDate: string
  dueDate: string | null
  subtotal: number
  discountTotal: number
  fineTotal: number
  totalAmount: number
  paidAmount: number
  dueAmount: number
  status: string
  studentId: number
  admissionNo: string
  studentName: string
}
export interface Invoice extends Omit<InvoiceRow, 'dueAmount'> {
  notes: string | null
  items: { feeTypeId: number; description: string; amount: number; discount: number; netAmount: number }[]
  payments: { receiptId: number; receiptNo: string; amount: number; paymentDate: string; status: string }[]
}
export interface Receipt {
  id: number
  receiptNo: string
  studentId: number
  amount: number
  paymentDate: string
  method: string
  referenceNo: string | null
  status: string
  cancelReason: string | null
  createdAt: string
  admissionNo: string
  studentName: string
  allocations: { invoiceId: number; invoiceNo: string; amount: number; billingPeriod: string }[]
}
export interface Statement {
  entries: {
    id: number
    entryDate: string
    entryType: string
    debit: number
    credit: number
    remarks: string | null
    invoiceId: number | null
    receiptId: number | null
    runningBalance: number
  }[]
  balance: number
}

export interface UserRow {
  id: number
  username: string
  email: string | null
  phone: string | null
  isActive: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  createdAt: string
  roles: string[]
}
export interface Role {
  id: number
  name: string
  description: string | null
  permissions: string[]
}
export interface SecurityEvent {
  id: number
  occurredAt: string
  eventType: string
  severity: string
  actorUsername: string | null
  targetUsername: string | null
  attemptedUsername: string | null
  ipAddress: string | null
  userAgent: string | null
  details: Record<string, unknown>
}

export interface FeesSummary {
  outstandingAmount: number
  openInvoices: number
  studentsWithDues: number
  overdueAmount: number
  overdueInvoices: number
  collectedToday: number
  receiptsToday: number
  collectedLast30Days: number
}

/** Row of GET /guardians (the directory) */
export interface GuardianListRow {
  id: number
  fullName: string
  phone: string
  email: string | null
  occupation: string | null
  userId: number | null
  children: { studentId: number; name: string; admissionNo: string; relation: string }[]
}

/** GET /guardians/:id */
export interface GuardianFull {
  id: number
  fullName: string
  phone: string
  altPhone: string | null
  email: string | null
  occupation: string | null
  organization: string | null
  citizenshipNo: string | null
  address: string | null
  userId: number | null
}

/** GET /enrollments/:id (with the student's chosen optional subjects) */
export interface EnrollmentDetail {
  id: number
  studentId: number
  sectionId: number
  academicYearId: number
  rollNo: number | null
  status: string
  subjects: { classSubjectId: number; code: string; name: string; optionalGroup: string | null }[]
}
