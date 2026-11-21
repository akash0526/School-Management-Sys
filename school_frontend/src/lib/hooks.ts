import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { get, type Items, type Page } from './api'
import type { ClassRow, ClassSubject, FeeType, Room, Section, Staff, Stream, StudentRow, Subject, Year } from './types'

const STALE = 5 * 60_000

export function useYears() {
  return useQuery({ queryKey: ['years'], queryFn: () => get<Items<Year>>('/academic/years'), staleTime: STALE, select: (d) => d.items })
}
export function useCurrentYear() {
  const q = useYears()
  return { ...q, data: q.data?.find((y) => y.isCurrent) ?? q.data?.[0] }
}
export function useClasses() {
  return useQuery({ queryKey: ['classes'], queryFn: () => get<Items<ClassRow>>('/academic/classes'), staleTime: STALE, select: (d) => d.items })
}
export function useStreams() {
  return useQuery({ queryKey: ['streams'], queryFn: () => get<Items<Stream>>('/academic/streams'), staleTime: STALE, select: (d) => d.items })
}
export function useRooms() {
  return useQuery({ queryKey: ['rooms'], queryFn: () => get<Items<Room>>('/academic/rooms'), staleTime: STALE, select: (d) => d.items })
}
export function useSubjects() {
  return useQuery({ queryKey: ['subjects'], queryFn: () => get<Items<Subject>>('/academic/subjects'), staleTime: STALE, select: (d) => d.items })
}
export function useSections(academicYearId?: number, classId?: number) {
  return useQuery({
    queryKey: ['sections', academicYearId, classId],
    queryFn: () => get<Items<Section>>('/academic/sections', { academicYearId, classId }),
    enabled: !!academicYearId,
    staleTime: STALE,
    select: (d) => d.items,
  })
}
export function useClassSubjects(academicYearId?: number, classId?: number) {
  return useQuery({
    queryKey: ['class-subjects', academicYearId, classId],
    queryFn: () => get<Items<ClassSubject>>('/academic/class-subjects', { academicYearId, classId }),
    enabled: !!academicYearId,
    staleTime: STALE,
    select: (d) => d.items,
  })
}
export function useFeeTypes(enabled = true) {
  return useQuery({ queryKey: ['fee-types'], queryFn: () => get<Items<FeeType>>('/fees/types'), staleTime: STALE, enabled, select: (d) => d.items })
}
export function useStaffList(enabled = true) {
  return useQuery({
    queryKey: ['staff-all'],
    queryFn: () => get<Page<Staff>>('/staff', { pageSize: 100, status: 'active' }),
    staleTime: STALE,
    enabled,
    select: (d) => d.items,
  })
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export { keepPreviousData }

/** "Grade 10 – A", "Grade 11 – A (Science)" — the stream is skipped when the section is already named after it. */
export const sectionLabel = (s: Pick<Section, 'className' | 'name' | 'streamName'>) =>
  `${s.className} – ${s.name}${s.streamName && s.streamName !== s.name ? ` (${s.streamName})` : ''}`

/** The signed-in staff member's own record (null for accounts without one). */
export function useMyStaff(staffId: number | null | undefined) {
  return useQuery({ queryKey: ['staff-me', staffId], queryFn: () => get<Staff>('/staff/me'), enabled: !!staffId, staleTime: STALE })
}

/** Children of the signed-in parent (or the signed-in student themself). */
export function useMyStudents() {
  return useQuery({ queryKey: ['students-mine'], queryFn: () => get<Items<StudentRow>>('/students/mine'), select: (d) => d.items })
}

/** Academic-year selector state that defaults to the current year without an effect. */
export function useYearPicker() {
  const years = useYears()
  const [picked, setYearId] = useState<number>()
  const yearId = picked ?? (years.data?.find((y) => y.isCurrent) ?? years.data?.[0])?.id
  return { years, yearId, setYearId }
}
