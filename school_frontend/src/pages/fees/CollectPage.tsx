import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Printer, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { StudentPicker } from '../../components/StudentPicker'
import { Button, Card, Empty, ErrorBox, Field, Input, Notice, PageHeader, Select, Spinner, StatusBadge } from '../../components/ui'
import { cx } from '../../components/ui-utils'
import { get, post, type Page } from '../../lib/api'
import { date, money, today } from '../../lib/format'
import type { InvoiceRow, Statement, StudentRow } from '../../lib/types'

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'esewa', label: 'eSewa' },
  { value: 'khalti', label: 'Khalti' },
  { value: 'fonepay', label: 'Fonepay' },
  { value: 'connectips', label: 'ConnectIPS' },
  { value: 'bank_deposit', label: 'Bank deposit' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
]
const NEEDS_REF = ['cheque', 'bank_deposit', 'esewa', 'khalti', 'fonepay', 'connectips']

interface Result { receiptId: number; receiptNo: string; allocations: { invoiceId: number; amount: number }[]; advance: number }

export function CollectPage() {
  const qc = useQueryClient()
  const [student, setStudent] = useState<StudentRow | null>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [ref, setRef] = useState('')
  const [payDate, setPayDate] = useState(today())
  const [manual, setManual] = useState(false)
  const [alloc, setAlloc] = useState<Record<number, string>>({})
  const [done, setDone] = useState<Result | null>(null)

  const invoices = useQuery({
    queryKey: ['student-invoices', student?.id],
    queryFn: () => get<Page<InvoiceRow>>(`/fees/students/${student!.id}/invoices`, { pageSize: 100 }),
    enabled: !!student,
  })
  const stmt = useQuery({ queryKey: ['statement', student?.id], queryFn: () => get<Statement>(`/fees/students/${student!.id}/statement`), enabled: !!student })
  const open = useMemo(() => (invoices.data?.items ?? []).filter((i) => i.status === 'unpaid' || i.status === 'partial').sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.id - b.id), [invoices.data])
  const totalDue = open.reduce((a, i) => a + Number(i.dueAmount), 0)

  // switching student clears the form (done in the event, not an effect, to avoid a wasted render)
  const pickStudent = (st: StudentRow | null) => {
    if (st?.id !== student?.id) { setAlloc({}); setManual(false); setAmount(''); setRef(''); setDone(null) }
    setStudent(st)
  }

  // FIFO preview — mirrors the server's automatic allocation (oldest first)
  const amt = Number(amount) || 0
  const preview = useMemo(() => {
    if (manual) return open.map((i) => ({ inv: i, pay: Number(alloc[i.id] || 0) }))
    const out: { inv: InvoiceRow; pay: number }[] = []
    let left = amt
    for (const i of open) {
      const pay = Math.min(left, Number(i.dueAmount))
      left = Math.round((left - pay) * 100) / 100
      out.push({ inv: i, pay })
    }
    return out
  }, [manual, alloc, open, amt])
  const allocated = preview.reduce((a, p) => a + p.pay, 0)
  const advance = Math.round((amt - allocated) * 100) / 100
  const overAlloc = manual && (allocated > amt + 0.001 || preview.some((p) => p.pay > Number(p.inv.dueAmount) + 0.001))

  const pay = useMutation({
    mutationFn: () => post<Result>('/fees/receipts', {
      studentId: student!.id,
      amount: amt,
      method,
      referenceNo: ref.trim() || null,
      paymentDate: payDate,
      ...(manual ? { allocations: preview.filter((p) => p.pay > 0).map((p) => ({ invoiceId: p.inv.id, amount: p.pay })) } : {}),
    }),
    onSuccess: (r) => {
      setDone(r)
      void qc.invalidateQueries({ queryKey: ['student-invoices', student?.id] })
      void qc.invalidateQueries({ queryKey: ['statement', student?.id] })
      void qc.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
  const valid = !!student && amt > 0 && /^\d+(\.\d{1,2})?$/.test(amount) && (!NEEDS_REF.includes(method) || ref.trim()) && !overAlloc

  return (
    <>
      <PageHeader title="Collect payment" subtitle="Record a fee payment and print the receipt." />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card title="1. Student">
            <StudentPicker value={student} onChange={pickStudent} />
          </Card>
          {student && (
            <Card title="Open invoices" padded={false} actions={open.length > 0 && <button className="text-xs font-medium text-brand-600" onClick={() => setManual((m) => !m)}>{manual ? 'Use automatic allocation' : 'Allocate manually'}</button>}>
              {invoices.isLoading ? <Spinner /> : !open.length ? <Empty title="No dues" hint="Any payment will be kept as an advance." /> : (
                <table className="table-base">
                  <thead><tr><th>Invoice</th><th>Period</th><th className="text-right">Due</th><th className="w-36 text-right">This payment</th></tr></thead>
                  <tbody>
                    {preview.map(({ inv, pay }) => (
                      <tr key={inv.id}>
                        <td><div className="font-mono text-xs">{inv.invoiceNo}</div><StatusBadge status={inv.status} /></td>
                        <td>{inv.billingPeriod}<div className="text-xs text-slate-500">{date(inv.issueDate)}</div></td>
                        <td className="text-right font-medium tabular-nums">{money(inv.dueAmount)}</td>
                        <td className="text-right">
                          {manual ? (
                            <Input className="py-1.5 text-right" inputMode="decimal" value={alloc[inv.id] ?? ''} onChange={(e) => setAlloc((a) => ({ ...a, [inv.id]: e.target.value }))} placeholder="0" />
                          ) : (
                            <span className={cx('tabular-nums', pay > 0 ? 'font-medium text-emerald-700' : 'text-slate-300')}>{pay > 0 ? money(pay) : '—'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={2} className="px-4 py-2.5 text-right text-sm font-medium">Total due</td><td className="px-4 py-2.5 text-right font-semibold tabular-nums">{money(totalDue)}</td><td /></tr></tfoot>
                </table>
              )}
            </Card>
          )}
        </div>

        <div className="lg:col-span-2">
          <Card title="2. Payment" className="lg:sticky lg:top-6">
            {done ? (
              <div className="space-y-4 text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><CheckCircle2 className="size-7" /></div>
                <div>
                  <div className="text-lg font-semibold text-slate-900">Payment recorded</div>
                  <div className="text-sm text-slate-500">Receipt <span className="font-mono">{done.receiptNo}</span></div>
                  {done.advance > 0 && <div className="mt-1 text-sm text-sky-700">{money(done.advance)} kept as advance</div>}
                </div>
                <div className="flex justify-center gap-2">
                  <Link to={`/fees/receipts/${done.receiptId}`}><Button icon={<Printer className="size-4" />}>View / print receipt</Button></Link>
                  <Button variant="secondary" onClick={() => { setDone(null); setAmount(''); setRef(''); setAlloc({}) }}>New payment</Button>
                </div>
              </div>
            ) : !student ? (
              <Empty title="Choose a student first" />
            ) : (
              <div className="space-y-4">
                {stmt.data && (
                  <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
                    <span className="text-slate-500">{stmt.data.balance >= 0 ? 'Balance due' : 'Advance'}</span>
                    <span className={cx('font-semibold', stmt.data.balance > 0 ? 'text-rose-600' : 'text-emerald-600')}>{money(Math.abs(stmt.data.balance))}</span>
                  </div>
                )}
                <Field label="Amount received (Rs.)">
                  <div className="flex gap-2">
                    <Input inputMode="decimal" className="text-lg font-semibold" value={amount} onChange={(e) => setAmount(e.target.value.trim())} placeholder="0.00" autoFocus />
                    {totalDue > 0 && <Button variant="secondary" onClick={() => setAmount(String(totalDue))}>Full</Button>}
                  </div>
                </Field>
                <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)} options={METHODS} /></Field>
                {NEEDS_REF.includes(method) && <Field label="Reference / transaction ID *" hint={method === 'cheque' ? 'Cheque number' : 'From the wallet or bank slip'}><Input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={100} /></Field>}
                <Field label="Payment date"><Input type="date" value={payDate} max={today()} onChange={(e) => setPayDate(e.target.value)} /></Field>
                {amt > 0 && (
                  <div className="space-y-1 rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex justify-between"><span className="text-slate-500">Applied to invoices</span><span className="tabular-nums">{money(allocated)}</span></div>
                    {advance > 0 && <div className="flex justify-between text-sky-700"><span>Advance (credit)</span><span className="tabular-nums">{money(advance)}</span></div>}
                  </div>
                )}
                {overAlloc && <Notice tone="amber">Allocations exceed the amount received or an invoice's due amount.</Notice>}
                <ErrorBox error={pay.error} />
                <Button className="w-full py-2.5" icon={<Wallet className="size-4" />} disabled={!valid} loading={pay.isPending} onClick={() => pay.mutate()}>Record {amt > 0 ? money(amt) : 'payment'}</Button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
