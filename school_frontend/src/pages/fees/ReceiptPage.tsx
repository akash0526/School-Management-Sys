import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Printer } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { SchoolLetterhead } from '../../components/SchoolLetterhead'
import { Badge, Button, ErrorBox, Field, Modal, Spinner, Textarea } from '../../components/ui'
import { useToast } from '../../components/ui-utils'
import { get, post } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { date, dateTime, money, titleCase } from '../../lib/format'
import type { Receipt } from '../../lib/types'

/** Converts a rupee amount to words (Indian/Nepali numbering: lakh, crore). */
function inWords(n: number): string {
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
  const two = (x: number) => (x < 20 ? ones[x]! : `${tens[Math.floor(x / 10)]}${x % 10 ? `-${ones[x % 10]}` : ''}`)
  const three = (x: number) => (x >= 100 ? `${ones[Math.floor(x / 100)]} hundred${x % 100 ? ` ${two(x % 100)}` : ''}` : two(x))
  const rupees = Math.floor(n)
  const paisa = Math.round((n - rupees) * 100)
  if (rupees === 0 && paisa === 0) return 'Zero'
  const parts: string[] = []
  let r = rupees
  const crore = Math.floor(r / 1e7); r %= 1e7
  const lakh = Math.floor(r / 1e5); r %= 1e5
  const thousand = Math.floor(r / 1e3); r %= 1e3
  if (crore) parts.push(`${three(crore)} crore`)
  if (lakh) parts.push(`${two(lakh)} lakh`)
  if (thousand) parts.push(`${two(thousand)} thousand`)
  if (r) parts.push(three(r))
  let s = parts.join(' ') + (rupees ? ' rupees' : '')
  if (paisa) s += `${rupees ? ' and ' : ''}${two(paisa)} paisa`
  return s.charAt(0).toUpperCase() + s.slice(1) + ' only'
}

export function ReceiptPage() {
  const id = Number(useParams().id)
  const nav = useNavigate()
  const { can } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState('')
  const { data: r, isLoading, error } = useQuery({ queryKey: ['receipt', id], queryFn: () => get<Receipt>(`/fees/receipts/${id}`) })
  const cancel = useMutation({
    mutationFn: () => post(`/fees/receipts/${id}/cancel`, { reason }),
    onSuccess: () => { toast.success('Receipt cancelled'); setCancelOpen(false); void qc.invalidateQueries() },
  })
  if (isLoading) return <Spinner />
  if (error || !r) return <ErrorBox error={error ?? 'Receipt not found'} />
  const cancelled = r.status === 'cancelled'
  const advance = Math.round((r.amount - r.allocations.reduce((a, x) => a + Number(x.amount), 0)) * 100) / 100

  return (
    <div className="mx-auto max-w-2xl">
      <div className="no-print mb-4 flex items-center justify-between">
        <button onClick={() => nav(-1)} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft className="size-4" /> Back</button>
        <div className="flex gap-2">
          {can('fees.cancel_receipt') && !cancelled && <Button variant="secondary" onClick={() => setCancelOpen(true)}>Cancel receipt</Button>}
          <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>Print</Button>
        </div>
      </div>
      <article className="card print-area relative overflow-hidden">
        {cancelled && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="-rotate-12 rounded-lg border-4 border-rose-500/60 px-6 py-2 text-5xl font-black tracking-widest text-rose-500/60">CANCELLED</span></div>}
        <header className="flex items-start justify-between border-b border-dashed border-slate-300 px-8 py-6">
          <SchoolLetterhead title="Payment receipt" showPan />
          <div className="shrink-0 text-right text-sm">
            <div className="font-mono font-semibold text-slate-900">{r.receiptNo}</div>
            <div className="text-slate-500">{date(r.paymentDate)}</div>
            {cancelled ? <Badge tone="red">Cancelled</Badge> : <Badge tone="green">Valid</Badge>}
          </div>
        </header>
        <section className="grid grid-cols-2 gap-4 px-8 py-5 text-sm">
          <div><div className="text-xs text-slate-500">Received from</div><div className="font-medium text-slate-900">{r.studentName}</div><div className="text-xs text-slate-500">Adm. {r.admissionNo}</div></div>
          <div className="text-right"><div className="text-xs text-slate-500">Method</div><div className="font-medium text-slate-900">{titleCase(r.method)}</div>{r.referenceNo && <div className="text-xs text-slate-500">Ref. {r.referenceNo}</div>}</div>
        </section>
        <div className="px-8">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase"><tr className="border-b border-slate-200"><th className="py-2 text-left">Invoice</th><th className="py-2 text-left">Period</th><th className="py-2 text-right">Amount</th></tr></thead>
            <tbody>
              {r.allocations.map((a) => <tr key={a.invoiceId} className="border-b border-slate-100"><td className="py-2 font-mono text-xs">{a.invoiceNo}</td><td className="py-2">{a.billingPeriod}</td><td className="py-2 text-right tabular-nums">{money(a.amount)}</td></tr>)}
              {advance > 0 && <tr className="border-b border-slate-100"><td className="py-2" colSpan={2}>Advance (credit for future invoices)</td><td className="py-2 text-right tabular-nums">{money(advance)}</td></tr>}
            </tbody>
            <tfoot><tr><td colSpan={2} className="pt-3 text-right font-medium">Total received</td><td className="pt-3 text-right text-lg font-bold tabular-nums">{money(r.amount)}</td></tr></tfoot>
          </table>
          <p className="mt-2 text-right text-xs text-slate-500 italic">{inWords(Number(r.amount))}</p>
        </div>
        {cancelled && r.cancelReason && <p className="mx-8 mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Cancelled: {r.cancelReason}</p>}
        <footer className="mt-8 flex items-end justify-between px-8 pb-8 text-xs text-slate-500">
          <span>Recorded {dateTime(r.createdAt)}</span>
          <span className="w-40 border-t border-slate-300 pt-1 text-center">Received by</span>
        </footer>
      </article>
      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel receipt" size="sm" footer={<><Button variant="secondary" onClick={() => setCancelOpen(false)}>Keep</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel receipt</Button></>}>
        <p className="mb-3 text-sm text-slate-600">The payment is reversed and the invoices become due again. This is logged.</p>
        <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
        <ErrorBox error={cancel.error} className="mt-3" />
      </Modal>
    </div>
  )
}
