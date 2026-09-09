import { appBaseUrl, useMail } from './mail'
import type { DispatchTaskView } from './tasks'
import { DISPATCH_TASK_KIND_LABELS } from '#shared/utils/domain'
import { displayContainerNumber } from '#shared/utils/dispatch-cards'

function formatWorkDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  if (!year || !month || !day) return isoDate
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function taskLines(tasks: DispatchTaskView[]): string[] {
  return tasks.map((task, index) => {
    const box = displayContainerNumber(task.card.containerNumber)
    const place = task.card.locationName || task.card.destinationLocationName
    const bits = [
      `${index + 1}. ${DISPATCH_TASK_KIND_LABELS[task.kind]}`,
      box,
      place,
    ].filter(Boolean)
    return bits.join(' · ')
  })
}

function buildMessage(input: {
  firstName: string
  workDate: string
  dispatcherName: string
  kind: 'assigned' | 'updated'
  tasks: DispatchTaskView[]
}) {
  const appName = String(useRuntimeConfig().public.appName || 'Yard Manager')
  const day = formatWorkDate(input.workDate)
  const verb = input.kind === 'assigned' ? 'assigned new work' : 'updated your work'
  const subject = input.kind === 'assigned'
    ? `${appName}: work for ${day}`
    : `${appName}: work updated for ${day}`
  const link = `${appBaseUrl()}/tasks`
  const lines = taskLines(input.tasks)
  const text = [
    `Hi ${input.firstName},`,
    '',
    `${input.dispatcherName} ${verb} for ${day}.`,
    '',
    ...lines,
    '',
    `Open Tasks: ${link}`,
  ].join('\n')

  const items = input.tasks.map((task) => {
    const box = displayContainerNumber(task.card.containerNumber)
    const from = task.card.locationName
    const to = task.card.destinationLocationName
    const notes = task.card.notes
    return `<li style="margin:0 0 10px;">
      <strong>${escapeHtml(DISPATCH_TASK_KIND_LABELS[task.kind])}</strong>
      ${box ? ` · <span style="font-family:ui-monospace,monospace;">${escapeHtml(box)}</span>` : ''}
      ${from ? `<br><span style="color:#5B6B7C;">${escapeHtml(from)}${to && to !== from ? ` → ${escapeHtml(to)}` : ''}</span>` : ''}
      ${notes ? `<br><span style="color:#5B6B7C;">${escapeHtml(notes)}</span>` : ''}
    </li>`
  }).join('')

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#EDF0F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0C1E30;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden;">
      <tr>
        <td style="background:#0C1E30;padding:20px 24px;">
          <span style="color:#FFFFFF;font-weight:700;letter-spacing:0.08em;font-size:14px;">${escapeHtml(appName.toUpperCase())}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 24px;">
          <p style="margin:0 0 16px;font-size:16px;">Hi ${escapeHtml(input.firstName)},</p>
          <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">
            ${escapeHtml(input.dispatcherName)} ${verb} for <strong>${escapeHtml(day)}</strong>.
          </p>
          <ol style="margin:0 0 24px;padding-left:20px;font-size:15px;line-height:1.45;">
            ${items}
          </ol>
          <a href="${link}" style="display:block;background:#F0A422;color:#0C1E30;text-decoration:none;font-weight:700;font-size:16px;text-align:center;padding:16px 24px;border-radius:12px;">
            Open Tasks
          </a>
        </td>
      </tr>
    </table>
  </body>
</html>`

  return { subject, text, html }
}

export async function notifyDriverTaskChange(input: {
  email: string
  firstName: string
  workDate: string
  dispatcherName: string
  kind: 'assigned' | 'updated'
  tasks: DispatchTaskView[]
}): Promise<void> {
  const to = input.email.trim()
  if (!to || !input.tasks.length) return
  const message = buildMessage(input)
  try {
    await useMail().send({
      to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    })
  }
  catch (error) {
    console.error(`[tasks] ${input.kind} notice to ${to} failed`, error)
  }
}
