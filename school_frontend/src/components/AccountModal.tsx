import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { post } from '../lib/api'
import { titleCase } from '../lib/format'
import { Button, Checkbox, ErrorBox, Field, Input, Modal, Notice, SecretReveal } from './ui'
import { fieldErrors } from './ui-utils'

/** Creates a portal login (student, parent or staff) and shows the one-time temporary password. */
export function AccountModal({ path, title, onClose, onDone, suggested = '', roles }: { path: string; title: string; onClose: () => void; onDone: () => void; suggested?: string; roles?: { options: string[]; initial: string[] } }) {
  const [username, setUsername] = useState(suggested)
  const [picked, setPicked] = useState<string[]>(roles?.initial ?? [])
  const m = useMutation({
    mutationFn: () => post<{ username: string; temporaryPassword?: string }>(path, roles ? { username, roles: picked } : { username }),
    onSuccess: onDone,
  })
  const errs = fieldErrors(m.error)
  return (
    <Modal open onClose={onClose} title={title} size="sm" footer={m.data ? <Button onClick={onClose}>Done</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={username.length < 3 || (roles && picked.length === 0)} onClick={() => m.mutate()}>Create login</Button></>}>
      {m.data ? (
        <div className="space-y-3">
          <Notice tone="green">Login <b>{m.data.username}</b> created.</Notice>
          {m.data.temporaryPassword && <SecretReveal label="Temporary password" value={m.data.temporaryPassword} />}
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Username" error={errs.username} hint="Letters, numbers, dot, dash, underscore"><Input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={50} autoFocus /></Field>
          {roles && (
            <Field label="Roles" error={errs.roles}>
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3">
                {roles.options.map((r) => <Checkbox key={r} label={titleCase(r)} checked={picked.includes(r)} onChange={(v) => setPicked((p) => (v ? [...p, r] : p.filter((x) => x !== r)))} />)}
              </div>
            </Field>
          )}
          <p className="text-xs text-slate-500">A temporary password is generated. Share it privately; it must be changed at first sign-in.</p>
          <ErrorBox error={m.error} />
        </div>
      )}
    </Modal>
  )
}
