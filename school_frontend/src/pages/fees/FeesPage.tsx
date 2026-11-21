import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { StudentPicker } from '../../components/StudentPicker'
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Modal, Notice, Pagination, PageHeader, Select, Spinner, StatusBadge, Tabs, Textarea } from '../../components/ui'
import { enumOptions, useToast } from '../../components/ui-utils'
import { get, post, type Items, type Page } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { clean, date, money, titleCase, today } from '../../lib/format'
import { keepPreviousData, sectionLabel, useClasses, useCurrentYear, useDebounced, useFeeTypes, useSections, useStreams } from '../../lib/hooks'
import type { Discount, FeeStructure, Invoice, InvoiceRow, StudentRow } from '../../lib/types'

const FREQUENCIES = ['one_time', 'monthly', 'termly', 'yearly'] as const
const INVOICE_STATUS = ['unpaid', 'partial', 'paid', 'cancelled'] as const
const BS_MONTHS = ['Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Asoj', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra']

type Tab = 'invoices' | 'generate' | 'setup' | 'discounts'

export function FeesPage() {
  const { can } = useAuth()
  const [tab, setTab] = useState<Tab>('invoices')
  return (
    <>
      <PageHeader
        title="Fees"
        subtitle="Invoices, fee structures, discounts and billing."
        actions={can('fees.collect') && <Link to="/fees/collect"><Button>Collect payment</Button></Link>}
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'invoices', label: 'Invoices' },
          ...(can('fees.manage') ? [{ id: 'generate' as Tab, label: 'Generate invoices' }] : []),
          { id: 'setup', label: 'Fee structure' },
          { id: 'discounts', label: 'Discounts' },
        ]}
      />
      {tab === 'invoices' && <InvoicesTab />}
      {tab === 'generate' && <GenerateTab />}
      {tab === 'setup' && <SetupTab />}
      {tab === 'discounts' && <DiscountsTab />}
    </>
  )
}

/* ───── Invoices ───── */
function InvoicesTab() {
  const year = useCurrentYear().data
  const sections = useSections(year?.id)
  const [status, setStatus] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [period, setPeriod] = useState('')
  const [student, setStudent] = useState<StudentRow | null>(null)
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<number | null>(null)
  const p = useDebounced(period.trim())
  const q = useQuery({
    queryKey: ['invoices', status, sectionId, p, student?.id, page],
    queryFn: () => get<Page<InvoiceRow>>('/fees/invoices', { status, sectionId, billingPeriod: p, studentId: student?.id, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  })
  useEffect(() => setPage(1), [status, sectionId, p, student])
  return (
    <Card padded={false}>
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-4">
        <StudentPicker value={student} onChange={setStudent} placeholder="Filter by student…" />
        <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} placeholder="All sections" options={(sections.data ?? []).map((s) => ({ value: s.id, label: sectionLabel(s) }))} />
        <div className="relative"><Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" /><input className="input pl-9" placeholder="Billing period…" value={period} onChange={(e) => setPeriod(e.target.value)} /></div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={enumOptions(INVOICE_STATUS)} />
      </div>
      {q.isLoading ? <Spinner /> : !q.data?.items.length ? <Empty title="No invoices found" /> : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Invoice</th><th>Student</th><th>Period</th><th>Issued</th><th className="text-right">Total</th><th className="text-right">Paid</th><th className="text-right">Due</th><th>Status</th></tr></thead>
            <tbody>
              {q.data.items.map((i) => (
                <tr key={i.id} className="clickable" onClick={() => setOpenId(i.id)}>
                  <td className="font-mono text-xs">{i.invoiceNo}</td>
                  <td><div className="font-medium text-slate-900">{i.studentName}</div><div className="text-xs text-slate-500">{i.admissionNo}</div></td>
                  <td>{i.billingPeriod}</td><td>{date(i.issueDate)}</td>
                  <td className="text-right tabular-nums">{money(i.totalAmount)}</td>
                  <td className="text-right tabular-nums text-emerald-700">{money(i.paidAmount)}</td>
                  <td className="text-right font-medium tabular-nums">{money(i.dueAmount)}</td>
                  <td><StatusBadge status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.data && <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />}
      {openId && <InvoiceModal id={openId} onClose={() => setOpenId(null)} />}
    </Card>
  )
}

export function InvoiceModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const { data: inv, isLoading } = useQuery({ queryKey: ['invoice', id], queryFn: () => get<Invoice>(`/fees/invoices/${id}`) })
  const cancel = useMutation({
    mutationFn: () => post(`/fees/invoices/${id}/cancel`, { reason }),
    onSuccess: () => { toast.success('Invoice cancelled'); void qc.invalidateQueries({ queryKey: ['invoices'] }); void qc.invalidateQueries({ queryKey: ['invoice', id] }); setCancelling(false) },
  })
  return (
    <Modal open onClose={onClose} size="lg" title={inv ? `Invoice ${inv.invoiceNo}` : 'Invoice'} footer={inv && can('fees.manage') && inv.status !== 'cancelled' && inv.paidAmount === 0 && !cancelling && <Button variant="danger" onClick={() => setCancelling(true)}>Cancel invoice</Button>}>
      {isLoading || !inv ? <Spinner /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Link to={`/students/${inv.studentId}`} className="font-medium text-slate-900 hover:text-brand-600">{inv.studentName}</Link>
              <div className="text-sm text-slate-500">{inv.admissionNo} · {inv.billingPeriod}</div>
              <div className="text-xs text-slate-400">Issued {date(inv.issueDate)}{inv.dueDate ? ` · due ${date(inv.dueDate)}` : ''}</div>
            </div>
            <StatusBadge status={inv.status} />
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase"><tr className="border-b border-slate-200"><th className="py-2 text-left">Item</th><th className="py-2 text-right">Amount</th><th className="py-2 text-right">Discount</th><th className="py-2 text-right">Net</th></tr></thead>
            <tbody>
              {inv.items.map((it, i) => <tr key={i} className="border-b border-slate-100"><td className="py-2">{it.description}</td><td className="py-2 text-right tabular-nums">{money(it.amount)}</td><td className="py-2 text-right text-emerald-700 tabular-nums">{it.discount ? `−${money(it.discount)}` : ''}</td><td className="py-2 text-right tabular-nums">{money(it.netAmount)}</td></tr>)}
            </tbody>
            <tfoot className="font-medium">
              {inv.fineTotal > 0 && <tr><td colSpan={3} className="pt-2 text-right text-slate-500">Fine</td><td className="pt-2 text-right tabular-nums">{money(inv.fineTotal)}</td></tr>}
              <tr><td colSpan={3} className="pt-2 text-right">Total</td><td className="pt-2 text-right tabular-nums">{money(inv.totalAmount)}</td></tr>
              <tr><td colSpan={3} className="text-right text-emerald-700">Paid</td><td className="text-right text-emerald-700 tabular-nums">{money(inv.paidAmount)}</td></tr>
              <tr className="text-base"><td colSpan={3} className="text-right">Due</td><td className="text-right tabular-nums">{money(inv.totalAmount - inv.paidAmount)}</td></tr>
            </tfoot>
          </table>
          {inv.payments.length > 0 && (
            <div>
              <div className="label">Payments</div>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {inv.payments.map((p) => (
                  <li key={p.receiptId} className="flex items-center justify-between px-3 py-2 text-sm">
                    <Link to={`/fees/receipts/${p.receiptId}`} className="font-mono text-xs text-brand-600 hover:underline">{p.receiptNo}</Link>
                    <span className="text-slate-500">{date(p.paymentDate)}</span>
                    <span className={p.status === 'cancelled' ? 'text-slate-400 line-through' : 'font-medium'}>{money(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {cancelling && (
            <div className="space-y-3 rounded-lg border border-rose-200 bg-rose-50/50 p-3">
              <Field label="Reason for cancelling"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
              <ErrorBox error={cancel.error} />
              <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setCancelling(false)}>Keep invoice</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={cancel.isPending} onClick={() => cancel.mutate()}>Confirm cancel</Button></div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

/* ───── Generate ───── */
function GenerateTab() {
  const toast = useToast()
  const qc = useQueryClient()
  const year = useCurrentYear().data
  const classes = useClasses()
  const sections = useSections(year?.id)
  const feeTypes = useFeeTypes()
  const [scope, setScope] = useState<'all' | 'class' | 'section'>('class')
  const [classId, setClassId] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [month, setMonth] = useState(BS_MONTHS[7]!)
  const [period, setPeriod] = useState('')
  const [freqs, setFreqs] = useState<string[]>(['monthly'])
  const [types, setTypes] = useState<number[]>([])
  const [issueDate, setIssueDate] = useState(today())
  const [dueDate, setDueDate] = useState('')
  const billingPeriod = period || `${year?.name ?? ''}-${month}`
  const m = useMutation({
    mutationFn: () => post<{ created: number; totalBilled: number; skipped: { alreadyBilled: number; noFees: number } }>('/fees/invoices/generate', clean({
      academicYearId: year!.id,
      ...(scope === 'class' && classId ? { classId: Number(classId) } : {}),
      ...(scope === 'section' && sectionId ? { sectionId: Number(sectionId) } : {}),
      billingPeriod,
      frequencies: freqs,
      ...(types.length ? { feeTypeIds: types } : {}),
      issueDate,
      dueDate: dueDate || null,
    })),
    onSuccess: (r) => { toast.success(`Generated ${r.created} invoice(s)`); void qc.invalidateQueries({ queryKey: ['invoices'] }) },
  })
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Bulk-generate invoices" className="lg:col-span-2">
        <div className="space-y-5">
          <Field label="Who">
            <div className="inline-flex rounded-lg bg-slate-100 p-1 text-sm">
              {(['all', 'class', 'section'] as const).map((s) => <button key={s} type="button" onClick={() => setScope(s)} className={`rounded-md px-3 py-1.5 font-medium ${scope === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{s === 'all' ? 'Whole school' : s === 'class' ? 'One class' : 'One section'}</button>)}
            </div>
          </Field>
          {scope === 'class' && <Field label="Class"><Select value={classId} onChange={(e) => setClassId(e.target.value)} placeholder="Select" options={(classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))} /></Field>}
          {scope === 'section' && <Field label="Section"><Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} placeholder="Select" options={(sections.data ?? []).map((s) => ({ value: s.id, label: sectionLabel(s) }))} /></Field>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Month (BS)"><Select value={month} onChange={(e) => { setMonth(e.target.value); setPeriod('') }} options={BS_MONTHS.map((m) => ({ value: m, label: m }))} /></Field>
            <Field label="Billing period label" hint="Re-running with the same label never duplicates invoices"><Input value={billingPeriod} onChange={(e) => setPeriod(e.target.value)} maxLength={30} /></Field>
          </div>
          <Field label="Include fees charged">
            <div className="flex flex-wrap gap-4">{FREQUENCIES.map((f) => <Checkbox key={f} label={titleCase(f)} checked={freqs.includes(f)} onChange={(v) => setFreqs((x) => (v ? [...x, f] : x.filter((y) => y !== f)))} />)}</div>
          </Field>
          <Field label="Only these fee types (optional)">
            <div className="flex flex-wrap gap-2">
              {(feeTypes.data ?? []).filter((t) => t.isActive).map((t) => (
                <button key={t.id} type="button" onClick={() => setTypes((x) => (x.includes(t.id) ? x.filter((y) => y !== t.id) : [...x, t.id]))} className={`rounded-full border px-3 py-1 text-xs font-medium ${types.includes(t.id) ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{t.name}</button>
              ))}
            </div>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Issue date"><Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></Field>
            <Field label="Due date"><Input type="date" value={dueDate} min={issueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
          </div>
          <ErrorBox error={m.error} />
          {m.data && <Notice tone="green">Done: <b>{m.data.created}</b> invoice(s) created, totalling <b>{money(m.data.totalBilled)}</b>. Skipped {m.data.skipped.alreadyBilled} already billed and {m.data.skipped.noFees} with no matching fees.</Notice>}
          <Button loading={m.isPending} disabled={!year || !freqs.length || (scope === 'class' && !classId) || (scope === 'section' && !sectionId)} onClick={() => confirm(`Generate “${billingPeriod}” invoices?`) && m.mutate()}>Generate invoices</Button>
        </div>
      </Card>
      <Card title="How it works">
        <ul className="list-disc space-y-2 pl-4 text-sm text-slate-600">
          <li>Invoices are built from the <b>fee structure</b> of each student's class (stream fees override general ones).</li>
          <li>Active <b>discounts</b> (scholarship, sibling…) are applied per line automatically.</li>
          <li>Generation is <b>all-or-nothing</b> and <b>idempotent</b>: students who already have an invoice for the period are skipped.</li>
        </ul>
      </Card>
    </div>
  )
}

/* ───── Setup (types & structures) ───── */
function SetupTab() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const year = useCurrentYear().data
  const classes = useClasses()
  const streams = useStreams()
  const feeTypes = useFeeTypes()
  const [classId, setClassId] = useState('')
  const structures = useQuery({ queryKey: ['structures', year?.id, classId], queryFn: () => get<Items<FeeStructure>>('/fees/structures', { academicYearId: year!.id, classId }), enabled: !!year })
  const [typeOpen, setTypeOpen] = useState(false)
  const [structOpen, setStructOpen] = useState(false)
  const [t, setT] = useState({ code: '', name: '' })
  const [refundable, setRefundable] = useState(false)
  const [s, setS] = useState({ classId: '', streamId: '', feeTypeId: '', amount: '', frequency: 'monthly', dueDay: '' })
  const createType = useMutation({ mutationFn: () => post('/fees/types', { ...t, code: t.code.toUpperCase(), isRefundable: refundable }), onSuccess: () => { toast.success('Fee type added'); setTypeOpen(false); void qc.invalidateQueries({ queryKey: ['fee-types'] }) } })
  const createStruct = useMutation({
    mutationFn: () => post('/fees/structures', { academicYearId: year!.id, classId: Number(s.classId), streamId: s.streamId ? Number(s.streamId) : null, feeTypeId: Number(s.feeTypeId), amount: Number(s.amount), frequency: s.frequency, dueDay: s.dueDay ? Number(s.dueDay) : null }),
    onSuccess: () => { toast.success('Fee added to structure'); setStructOpen(false); void qc.invalidateQueries({ queryKey: ['structures'] }) },
  })
  const manage = can('fees.manage')
  const byClass = (structures.data?.items ?? []).reduce<Record<string, FeeStructure[]>>((a, x) => ((a[x.className] = [...(a[x.className] ?? []), x]), a), {})

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title={`Fee structure · ${year?.name ?? ''}`} padded={false} className="lg:col-span-2" actions={
        <>
          <Select className="w-36 py-1.5" value={classId} onChange={(e) => setClassId(e.target.value)} placeholder="All classes" options={(classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          {manage && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => { setS({ ...s, classId }); setStructOpen(true) }}>Add fee</Button>}
        </>
      }>
        {structures.isLoading ? <Spinner /> : !structures.data?.items.length ? <Empty title="No fees set up" hint="Add tuition, exam, computer fees etc. per class." /> : (
          <div className="divide-y divide-slate-100">
            {Object.entries(byClass).map(([cls, rows]) => (
              <div key={cls} className="px-5 py-4">
                <div className="mb-2 flex items-center justify-between"><span className="font-medium text-slate-900">{cls}</span><span className="text-xs text-slate-500">Monthly total {money(rows.filter((r) => r.frequency === 'monthly' && !r.streamId).reduce((a, r) => a + Number(r.amount), 0))}</span></div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {rows.map((r) => (
                    <div key={r.id} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-sm">
                      <span>{r.feeTypeName}{r.streamName && <span className="text-xs text-slate-500"> · {r.streamName}</span>}</span>
                      <span className="flex items-center gap-2"><span className="font-medium tabular-nums">{money(r.amount)}</span><Badge>{titleCase(r.frequency)}</Badge></span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="Fee types" padded={false} actions={manage && <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setTypeOpen(true)}>New</Button>}>
        <ul className="divide-y divide-slate-100">
          {(feeTypes.data ?? []).map((ft) => (
            <li key={ft.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
              <span>{ft.name} <span className="font-mono text-xs text-slate-400">{ft.code}</span></span>
              {ft.isRefundable && <Badge tone="blue">Refundable</Badge>}
            </li>
          ))}
        </ul>
      </Card>

      <Modal open={typeOpen} onClose={() => setTypeOpen(false)} title="New fee type" size="sm" footer={<><Button variant="secondary" onClick={() => setTypeOpen(false)}>Cancel</Button><Button loading={createType.isPending} onClick={() => createType.mutate()}>Save</Button></>}>
        <div className="space-y-4">
          <Field label="Code" hint="Letters and underscore, e.g. COMPUTER"><Input value={t.code} onChange={(e) => setT({ ...t, code: e.target.value })} maxLength={20} /></Field>
          <Field label="Name"><Input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} maxLength={100} placeholder="Computer fee" /></Field>
          <Checkbox label="Refundable (e.g. security deposit)" checked={refundable} onChange={setRefundable} />
          <ErrorBox error={createType.error} />
        </div>
      </Modal>
      <Modal open={structOpen} onClose={() => setStructOpen(false)} title="Add fee to structure" footer={<><Button variant="secondary" onClick={() => setStructOpen(false)}>Cancel</Button><Button loading={createStruct.isPending} disabled={!s.classId || !s.feeTypeId || !s.amount} onClick={() => createStruct.mutate()}>Save</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Class"><Select value={s.classId} onChange={(e) => setS({ ...s, classId: e.target.value })} placeholder="Select" options={(classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
          <Field label="Stream (optional)"><Select value={s.streamId} onChange={(e) => setS({ ...s, streamId: e.target.value })} placeholder="All" options={(streams.data ?? []).map((x) => ({ value: x.id, label: x.name }))} /></Field>
          <Field label="Fee type"><Select value={s.feeTypeId} onChange={(e) => setS({ ...s, feeTypeId: e.target.value })} placeholder="Select" options={(feeTypes.data ?? []).filter((f) => f.isActive).map((f) => ({ value: f.id, label: f.name }))} /></Field>
          <Field label="Amount (Rs.)"><Input type="number" min={0} step="0.01" value={s.amount} onChange={(e) => setS({ ...s, amount: e.target.value })} /></Field>
          <Field label="Frequency"><Select value={s.frequency} onChange={(e) => setS({ ...s, frequency: e.target.value })} options={enumOptions(FREQUENCIES)} /></Field>
          <Field label="Due day of month"><Input type="number" min={1} max={32} value={s.dueDay} onChange={(e) => setS({ ...s, dueDay: e.target.value })} /></Field>
          <div className="col-span-2"><ErrorBox error={createStruct.error} /></div>
        </div>
      </Modal>
    </div>
  )
}

/* ───── Discounts ───── */
const DISCOUNT_REASONS = ['scholarship', 'sibling', 'staff_child', 'merit', 'need_based', 'other'] as const
function DiscountsTab() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const feeTypes = useFeeTypes()
  const [student, setStudent] = useState<StudentRow | null>(null)
  const enrollmentId = student?.enrollmentId
  const list = useQuery({ queryKey: ['discounts', enrollmentId], queryFn: () => get<Items<Discount>>('/fees/discounts', { enrollmentId: enrollmentId! }), enabled: !!enrollmentId })
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ feeTypeId: '', discountType: 'percent', value: '', reason: 'scholarship', validFrom: '', validTo: '' })
  const m = useMutation({
    mutationFn: () => post('/fees/discounts', clean({ enrollmentId: enrollmentId!, feeTypeId: f.feeTypeId ? Number(f.feeTypeId) : null, discountType: f.discountType, value: Number(f.value), reason: f.reason, validFrom: f.validFrom, validTo: f.validTo })),
    onSuccess: () => { toast.success('Discount added'); setOpen(false); void qc.invalidateQueries({ queryKey: ['discounts', enrollmentId] }) },
  })
  return (
    <Card title="Student discounts & scholarships" actions={can('fees.discount') && enrollmentId && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Add discount</Button>}>
      <div className="max-w-md"><StudentPicker value={student} onChange={setStudent} /></div>
      {student && !enrollmentId && <div className="mt-4"><Notice tone="amber">This student isn't enrolled this year. Discounts attach to an enrollment.</Notice></div>}
      {enrollmentId && (
        <div className="mt-5">
          {list.isLoading ? <Spinner /> : !list.data?.items.length ? <Empty title="No discounts" /> : (
            <table className="table-base">
              <thead><tr><th>Applies to</th><th>Discount</th><th>Reason</th><th>Valid</th></tr></thead>
              <tbody>{list.data.items.map((d) => <tr key={d.id}><td>{d.feeTypeName ?? 'All fees'}</td><td className="font-medium">{d.discountType === 'percent' ? `${d.value}%` : money(d.value)}</td><td>{titleCase(d.reason)}</td><td className="text-slate-500">{d.validFrom || d.validTo ? `${date(d.validFrom)} – ${date(d.validTo)}` : 'Always'}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add discount" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={m.isPending} disabled={!f.value} onClick={() => m.mutate()}>Save</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fee type" className="col-span-2"><Select value={f.feeTypeId} onChange={(e) => setF({ ...f, feeTypeId: e.target.value })} placeholder="All fees" options={(feeTypes.data ?? []).map((t) => ({ value: t.id, label: t.name }))} /></Field>
          <Field label="Type"><Select value={f.discountType} onChange={(e) => setF({ ...f, discountType: e.target.value })} options={[{ value: 'percent', label: 'Percent (%)' }, { value: 'fixed', label: 'Fixed (Rs.)' }]} /></Field>
          <Field label="Value"><Input type="number" min={0} max={f.discountType === 'percent' ? 100 : undefined} step="0.01" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
          <Field label="Reason" className="col-span-2"><Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} options={enumOptions(DISCOUNT_REASONS)} /></Field>
          <Field label="Valid from"><Input type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /></Field>
          <Field label="Valid to"><Input type="date" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} /></Field>
          <div className="col-span-2"><ErrorBox error={m.error} /></div>
        </div>
      </Modal>
    </Card>
  )
}
