import { startTransition, useCallback, useEffect, useState } from 'react'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/$/, '')
const TOKEN_STORAGE_KEY = 'ascure:web-admin:token'
const USER_STORAGE_KEY = 'ascure:web-admin:user'
const APP_VIEWS = {
  LOGIN: 'login',
  TEMPLATE_LIST: 'templateList',
  TEMPLATE_DETAIL: 'templateDetail',
}
const SEEDED_LOGIN = {
  email: 'admin@ascure.local',
  password: 'Admin123!',
}

function readStoredSession() {
  if (typeof window === 'undefined') {
    return { token: '', user: null }
  }

  const token = window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? ''
  const storedUser = window.localStorage.getItem(USER_STORAGE_KEY)

  if (!token) {
    return { token: '', user: null }
  }

  if (!storedUser) {
    return { token, user: null }
  }

  try {
    return {
      token,
      user: JSON.parse(storedUser),
    }
  } catch {
    window.localStorage.removeItem(USER_STORAGE_KEY)
    return { token, user: null }
  }
}

function persistSession(token, user) {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
  window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user))
}

function clearStoredSession() {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY)
  window.localStorage.removeItem(USER_STORAGE_KEY)
}

async function readResponseBody(response) {
  const text = await response.text()

  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function getErrorMessage(payload, fallback) {
  if (typeof payload === 'string' && payload.trim()) {
    return payload
  }

  if (Array.isArray(payload?.message) && payload.message.length > 0) {
    return payload.message.join(', ')
  }

  if (typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message
  }

  return fallback
}

async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers ?? {})

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json')
  }

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    })
  } catch {
    const networkError = new Error(
      `Unable to reach the ASCURE API at ${API_BASE_URL}. Make sure the backend is running.`,
    )
    networkError.status = 0
    throw networkError
  }

  const payload = await readResponseBody(response)

  if (!response.ok) {
    const requestError = new Error(getErrorMessage(payload, 'Request failed.'))
    requestError.status = response.status
    requestError.payload = payload
    throw requestError
  }

  return payload
}

function unwrapPayload(payload) {
  let currentPayload = payload

  while (currentPayload && typeof currentPayload === 'object' && !Array.isArray(currentPayload)) {
    if ('data' in currentPayload && currentPayload.data !== undefined) {
      currentPayload = currentPayload.data
      continue
    }

    if ('value' in currentPayload && currentPayload.value !== undefined) {
      currentPayload = currentPayload.value
      continue
    }

    break
  }

  return currentPayload
}

function normalizeTemplates(payload) {
  const value = unwrapPayload(payload)

  if (Array.isArray(value)) {
    return value
  }

  return []
}

function sortBySortOrder(items) {
  return [...items].sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
}

function normalizeTemplateDetail(payload) {
  const value = unwrapPayload(payload)

  if (!value || typeof value !== 'object' || !value.template) {
    return null
  }

  const sections = Array.isArray(value.sections) ? value.sections : []

  return {
    template: value.template,
    assetType: value.assetType ?? null,
    sections: sortBySortOrder(sections).map((section) => ({
      ...section,
      items: sortBySortOrder(Array.isArray(section.items) ? section.items : []),
    })),
  }
}

function extractClonedTemplateDetail(payload) {
  const value = unwrapPayload(payload)
  return normalizeTemplateDetail(value?.clonedTemplate ?? value)
}

function extractPublishedTemplateDetail(payload) {
  const value = unwrapPayload(payload)
  return normalizeTemplateDetail(value?.publishedTemplate ?? value)
}

function extractTemplateIdFromActionPayload(payload, detailKey) {
  const value = unwrapPayload(payload)
  const detail = normalizeTemplateDetail(value?.[detailKey] ?? value)

  if (detail?.template?.id) {
    return detail.template.id
  }

  const explicitIdKey = `${detailKey}Id`

  if (typeof value?.[explicitIdKey] === 'string' && value[explicitIdKey].trim()) {
    return value[explicitIdKey]
  }

  if (typeof value?.id === 'string' && value.id.trim()) {
    return value.id
  }

  return ''
}

function buildAuthHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
  }
}

async function fetchTemplates(token) {
  const payload = await apiRequest('/templates', {
    headers: buildAuthHeaders(token),
  })

  return normalizeTemplates(payload)
}

async function fetchTemplateDetail(token, templateId) {
  const payload = await apiRequest(`/templates/${templateId}`, {
    headers: buildAuthHeaders(token),
  })
  const detail = normalizeTemplateDetail(payload)

  if (!detail) {
    throw new Error('Template detail response was not in the expected format.')
  }

  return detail
}

async function cloneTemplateRequest(token, templateId) {
  return apiRequest(`/templates/${templateId}/clone`, {
    method: 'POST',
    headers: buildAuthHeaders(token),
  })
}

async function publishTemplateRequest(token, templateId) {
  return apiRequest(`/templates/${templateId}/publish`, {
    method: 'POST',
    headers: buildAuthHeaders(token),
  })
}

function formatPublishedDate(value) {
  if (!value) {
    return 'Not published'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Invalid date'
  }

  return new Intl.DateTimeFormat('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function formatRole(role) {
  if (!role) {
    return 'Unknown role'
  }

  return role.toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase())
}

function formatOptionsJson(value) {
  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value, null, 2)
}

function countItems(sections) {
  return sections.reduce((total, section) => total + (section.items?.length ?? 0), 0)
}

function getTemplateStatus(templateId, templates, templateDetail) {
  if (templateDetail?.template?.id === templateId) {
    return templateDetail.template.status
  }

  return templates.find((template) => template.id === templateId)?.status
}

function statusStyles(status) {
  switch (status) {
    case 'ACTIVE':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700'
    case 'DRAFT':
      return 'border-amber-200 bg-amber-50 text-amber-700'
    case 'ARCHIVED':
      return 'border-slate-200 bg-slate-100 text-slate-600'
    default:
      return 'border-slate-200 bg-white text-slate-600'
  }
}

function outlineButtonClassName(disabled = false) {
  const baseClassName =
    'inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-sm font-semibold transition'

  if (disabled) {
    return `${baseClassName} cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400`
  }

  return `${baseClassName} border-slate-300 bg-white text-slate-700 hover:border-teal-600 hover:text-teal-700`
}

function bannerClassName(tone) {
  switch (tone) {
    case 'success':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800'
    case 'error':
      return 'border-rose-200 bg-rose-50 text-rose-700'
    default:
      return 'border-sky-200 bg-sky-50 text-sky-800'
  }
}

function MetricCard({ label, value, helper }) {
  return (
    <div className="rounded-[28px] border border-white/70 bg-white/75 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.07)] backdrop-blur">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-3 text-3xl font-extrabold text-[var(--ink)]">{value}</p>
      <p className="mt-2 text-sm text-[var(--muted)]">{helper}</p>
    </div>
  )
}

function StatusBadge({ status, isActive }) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] ${statusStyles(status)}`}
      >
        {status}
      </span>
      <span className="text-xs text-[var(--muted)]">
        {isActive ? 'Current live version' : 'Not live'}
      </span>
    </div>
  )
}

function FeedbackBanner({ message, tone = 'info' }) {
  if (!message) {
    return null
  }

  return (
    <div
      className={`rounded-[24px] border px-5 py-4 text-sm leading-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)] ${bannerClassName(tone)}`}
    >
      {message}
    </div>
  )
}

function LoadingState() {
  return (
    <div className="rounded-[32px] border border-white/70 bg-white/75 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.07)] backdrop-blur">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-[24px] bg-[linear-gradient(135deg,rgba(226,232,240,0.85),rgba(255,255,255,0.95))]"
          />
        ))}
      </div>
      <div className="mt-6 h-72 animate-pulse rounded-[24px] bg-[linear-gradient(135deg,rgba(226,232,240,0.7),rgba(255,255,255,0.95))]" />
    </div>
  )
}

function TemplateDetailLoadingState() {
  return (
    <div className="rounded-[32px] border border-white/70 bg-white/80 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="h-8 w-60 animate-pulse rounded-full bg-slate-200" />
      <div className="mt-4 h-5 w-full max-w-3xl animate-pulse rounded-full bg-slate-200" />
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-[24px] bg-[linear-gradient(135deg,rgba(226,232,240,0.85),rgba(255,255,255,0.95))]"
          />
        ))}
      </div>
      <div className="mt-6 space-y-4">
        {Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className="h-56 animate-pulse rounded-[28px] bg-[linear-gradient(135deg,rgba(226,232,240,0.7),rgba(255,255,255,0.95))]"
          />
        ))}
      </div>
    </div>
  )
}

function TemplateActionButtons({
  template,
  onClone,
  onPublish,
  onView,
  pendingAction,
  showEditButton = false,
  showViewButton = true,
}) {
  const isBusy = pendingAction?.templateId === template.id
  const isClonePending = isBusy && pendingAction.type === 'clone'
  const isPublishPending = isBusy && pendingAction.type === 'publish'
  const isPublishDisabled = template.status !== 'DRAFT' || isBusy

  return (
    <div className="flex flex-wrap gap-2">
      {showViewButton ? (
        <button
          type="button"
          disabled={isBusy}
          className={outlineButtonClassName(isBusy)}
          onClick={() => onView(template.id)}
        >
          View
        </button>
      ) : null}
      <button
        type="button"
        disabled={isBusy}
        className={outlineButtonClassName(isBusy)}
        onClick={() => onClone(template.id)}
      >
        {isClonePending ? 'Cloning...' : 'Clone'}
      </button>
      <button
        type="button"
        disabled={isPublishDisabled}
        className={outlineButtonClassName(isPublishDisabled)}
        onClick={() => onPublish(template.id)}
        title={template.status !== 'DRAFT' ? 'Only draft templates can be published.' : undefined}
      >
        {isPublishPending ? 'Publishing...' : 'Publish'}
      </button>
      {showEditButton ? (
        <button
          type="button"
          disabled
          className={outlineButtonClassName(true)}
          title="Template editing is coming in a later phase."
        >
          Edit Template
        </button>
      ) : null}
    </div>
  )
}

function TemplatesTable({ onClone, onPublish, onView, pendingAction, templates }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-[32px] border border-white/70 bg-white/80 shadow-[0_25px_80px_rgba(15,23,42,0.08)] backdrop-blur xl:block">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="bg-slate-900 text-left text-xs font-bold uppercase tracking-[0.18em] text-slate-200">
              <th className="px-6 py-4">Template</th>
              <th className="px-6 py-4">Asset Type</th>
              <th className="px-6 py-4">Version</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4">Sections</th>
              <th className="px-6 py-4">Items</th>
              <th className="px-6 py-4">Inspections</th>
              <th className="px-6 py-4">Published</th>
              <th className="px-6 py-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((template) => (
              <tr key={template.id} className="border-t border-slate-200/80 align-top text-sm">
                <td className="px-6 py-5">
                  <div>
                    <p className="text-base font-bold text-[var(--ink)]">{template.name}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">Template ID: {template.id}</p>
                  </div>
                </td>
                <td className="px-6 py-5">
                  <div>
                    <p className="font-semibold text-[var(--ink)]">
                      {template.assetType?.code ?? 'Unknown'}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {template.assetType?.name ?? 'No asset type name'}
                    </p>
                  </div>
                </td>
                <td className="px-6 py-5 font-semibold text-[var(--ink)]">v{template.version}</td>
                <td className="px-6 py-5">
                  <StatusBadge status={template.status} isActive={template.isActive} />
                </td>
                <td className="px-6 py-5 text-[var(--ink)]">{template.sectionCount}</td>
                <td className="px-6 py-5 text-[var(--ink)]">{template.itemCount}</td>
                <td className="px-6 py-5 text-[var(--ink)]">{template.inspectionCount}</td>
                <td className="px-6 py-5 text-[var(--ink)]">
                  {formatPublishedDate(template.publishedAt)}
                </td>
                <td className="px-6 py-5">
                  <TemplateActionButtons
                    template={template}
                    onClone={onClone}
                    onPublish={onPublish}
                    onView={onView}
                    pendingAction={pendingAction}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 xl:hidden">
        {templates.map((template) => (
          <article
            key={template.id}
            className="rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <p className="text-lg font-bold text-[var(--ink)]">{template.name}</p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {template.assetType?.code ?? 'Unknown'} /{' '}
                  {template.assetType?.name ?? 'No asset type name'}
                </p>
              </div>
              <StatusBadge status={template.status} isActive={template.isActive} />
            </div>

            <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Version
                </dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--ink)]">v{template.version}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Sections
                </dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--ink)]">{template.sectionCount}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Items
                </dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--ink)]">{template.itemCount}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Inspections
                </dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--ink)]">
                  {template.inspectionCount}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Published
                </dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--ink)]">
                  {formatPublishedDate(template.publishedAt)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Template ID
                </dt>
                <dd className="mt-1 break-all text-sm text-[var(--muted)]">{template.id}</dd>
              </div>
            </dl>

            <div className="mt-5 border-t border-slate-200 pt-4">
              <TemplateActionButtons
                template={template}
                onClone={onClone}
                onPublish={onPublish}
                onView={onView}
                pendingAction={pendingAction}
              />
            </div>
          </article>
        ))}
      </div>
    </>
  )
}

function DetailMetaCard({ label, value }) {
  return (
    <div className="rounded-[24px] border border-white/80 bg-white/85 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">{label}</p>
      <div className="mt-3 text-sm text-[var(--ink)]">{value}</div>
    </div>
  )
}

function DetailField({ label, monospace = false, value }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">{label}</dt>
      <dd className={`mt-1 text-sm text-[var(--ink)] ${monospace ? 'break-all font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  )
}

function TemplateDetailView({
  detail,
  error,
  isLoading,
  onBack,
  onClone,
  onPublish,
  onRetry,
  pendingAction,
}) {
  const template = detail?.template ?? null
  const sections = detail?.sections ?? []
  const sectionCount = sections.length
  const itemCount = countItems(sections)

  return (
    <section className="mt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-[var(--ink)]">Template Detail</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Review the stored section and checklist item structure for this version. Editing stays
            disabled in Phase 3.1.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={outlineButtonClassName(false)} onClick={onBack}>
            Back to Templates
          </button>
          {template ? (
            <TemplateActionButtons
              template={template}
              onClone={onClone}
              onPublish={onPublish}
              pendingAction={pendingAction}
              showEditButton
              showViewButton={false}
            />
          ) : null}
        </div>
      </div>

      {isLoading && !detail ? <TemplateDetailLoadingState /> : null}

      {!isLoading && error && !detail ? (
        <div className="rounded-[32px] border border-rose-200 bg-rose-50 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
          <p className="text-lg font-bold text-rose-800">Unable to load this template.</p>
          <p className="mt-2 text-sm leading-6 text-rose-700">{error}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" className={outlineButtonClassName(false)} onClick={onRetry}>
              Retry
            </button>
            <button type="button" className={outlineButtonClassName(false)} onClick={onBack}>
              Back to Templates
            </button>
          </div>
        </div>
      ) : null}

      {detail ? (
        <div className="space-y-4">
          {isLoading ? <FeedbackBanner message="Refreshing template detail..." tone="info" /> : null}
          {error ? <FeedbackBanner message={error} tone="error" /> : null}

          <div className="rounded-[32px] border border-white/70 bg-white/80 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:p-7">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-4xl">
                <div className="inline-flex items-center rounded-full border border-teal-100 bg-teal-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-800">
                  {detail.assetType?.code ?? 'Unknown asset type'}
                </div>
                <h3 className="mt-4 text-3xl font-extrabold text-[var(--ink)]">{template.name}</h3>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  {detail.assetType?.name ?? 'No asset type name'} with version v{template.version}.
                  This view mirrors the current backend template structure without enabling editor
                  changes yet.
                </p>
              </div>
              <StatusBadge status={template.status} isActive={template.isActive} />
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <DetailMetaCard label="Name" value={template.name} />
              <DetailMetaCard
                label="Asset Type"
                value={
                  <>
                    <p className="font-semibold text-[var(--ink)]">
                      {detail.assetType?.code ?? 'Unknown'}
                    </p>
                    <p className="mt-1 text-[var(--muted)]">
                      {detail.assetType?.name ?? 'No asset type name'}
                    </p>
                  </>
                }
              />
              <DetailMetaCard label="Version" value={`v${template.version}`} />
              <DetailMetaCard label="Status" value={<StatusBadge status={template.status} isActive={template.isActive} />} />
              <DetailMetaCard label="Published At" value={formatPublishedDate(template.publishedAt)} />
              <DetailMetaCard label="Section Count" value={sectionCount} />
              <DetailMetaCard label="Item Count" value={itemCount} />
              <DetailMetaCard
                label="Template ID"
                value={<span className="break-all font-mono">{template.id}</span>}
              />
            </div>
          </div>

          {sections.length === 0 ? (
            <div className="rounded-[32px] border border-dashed border-slate-300 bg-white/75 px-6 py-16 text-center shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur">
              <p className="text-lg font-bold text-[var(--ink)]">No sections in this template yet.</p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Publishing will stay blocked until at least one section exists, but editing remains
                intentionally unavailable in this phase.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {sections.map((section) => (
                <article
                  key={section.id}
                  className="rounded-[32px] border border-white/70 bg-white/80 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-4xl">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                        Section {section.sortOrder}
                      </p>
                      <h3 className="mt-2 text-2xl font-bold text-[var(--ink)]">{section.title}</h3>
                      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                        {section.description?.trim() || 'No section description provided.'}
                      </p>
                    </div>
                    <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-700">
                      {section.items.length} item{section.items.length === 1 ? '' : 's'}
                    </div>
                  </div>

                  {section.items.length === 0 ? (
                    <div className="mt-5 rounded-[24px] border border-dashed border-slate-300 bg-slate-50/80 px-5 py-8 text-center">
                      <p className="text-sm font-semibold text-[var(--ink)]">No items in this section.</p>
                    </div>
                  ) : (
                    <div className="mt-5 grid gap-4 xl:grid-cols-2">
                      {section.items.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-5"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                                Item {item.sortOrder}
                              </p>
                              <h4 className="mt-2 text-lg font-bold text-[var(--ink)]">{item.label}</h4>
                            </div>
                            <span
                              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] ${
                                item.isRequired
                                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                                  : 'border-slate-200 bg-white text-slate-600'
                              }`}
                            >
                              {item.isRequired ? 'Required' : 'Optional'}
                            </span>
                          </div>

                          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                            <DetailField label="Key" monospace value={item.key} />
                            <DetailField label="Input Type" value={item.inputType} />
                            <DetailField label="Helper Text" value={item.helperText?.trim() || 'Not provided'} />
                            <DetailField label="Is Required" value={item.isRequired ? 'Yes' : 'No'} />
                          </dl>

                          {item.optionsJson !== null && item.optionsJson !== undefined ? (
                            <div className="mt-4">
                              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                                Options JSON
                              </p>
                              <pre className="mt-2 overflow-x-auto rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-xs leading-6 text-[var(--ink)]">
                                {formatOptionsJson(item.optionsJson)}
                              </pre>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}

function TemplateListView({
  isLoadingTemplates,
  onClone,
  onPublish,
  onRetry,
  onView,
  pendingAction,
  templates,
  templatesError,
}) {
  return (
    <section className="mt-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-extrabold text-[var(--ink)]">Template List</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            View, clone, and publish now connect to the live template endpoints. Editing remains
            disabled in this phase.
          </p>
        </div>
      </div>

      {templatesError ? (
        <div className="mb-4 flex flex-col gap-3 rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between">
          <p>{templatesError}</p>
          <button type="button" className={outlineButtonClassName(false)} onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}

      {isLoadingTemplates ? <LoadingState /> : null}

      {!isLoadingTemplates && templates.length === 0 ? (
        <div className="rounded-[32px] border border-dashed border-slate-300 bg-white/75 px-6 py-16 text-center shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur">
          <p className="text-lg font-bold text-[var(--ink)]">No templates returned yet.</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Once the backend has template data for this tenant, it will appear here.
          </p>
        </div>
      ) : null}

      {!isLoadingTemplates && templates.length > 0 ? (
        <TemplatesTable
          templates={templates}
          onClone={onClone}
          onPublish={onPublish}
          onView={onView}
          pendingAction={pendingAction}
        />
      ) : null}
    </section>
  )
}

function LoginView({ authError, formValues, isSubmitting, onChange, onSubmit }) {
  return (
    <main className="min-h-screen px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl overflow-hidden rounded-[40px] border border-white/60 bg-white/35 shadow-[0_28px_120px_rgba(15,23,42,0.16)] backdrop-blur lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative overflow-hidden border-b border-white/60 px-6 py-8 sm:px-10 lg:border-b-0 lg:border-r lg:px-12 lg:py-14">
          <div className="absolute left-8 top-8 h-40 w-40 rounded-full bg-teal-500/10 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-56 w-56 rounded-full bg-amber-500/10 blur-3xl" />
          <div className="relative flex h-full flex-col justify-between gap-8">
            <div>
              <div className="inline-flex items-center gap-3 rounded-full border border-teal-800/10 bg-white/80 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-teal-800 shadow-sm">
                <span className="h-2.5 w-2.5 rounded-full bg-teal-600" />
                ASCURE Web Admin
              </div>
              <h1 className="mt-6 max-w-xl text-4xl font-extrabold leading-tight text-[var(--ink)] sm:text-5xl">
                Template control room for review, clone, and publish workflows.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--muted)] sm:text-lg">
                Phase 3.1 keeps the login flow simple and connects the admin UI directly to live
                template detail, clone, and publish endpoints.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-[0_20px_45px_rgba(15,23,42,0.08)]">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Auth</p>
                <p className="mt-3 text-xl font-bold text-[var(--ink)]">JWT Session</p>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  Login stores the bearer token locally and preserves the session between refreshes.
                </p>
              </div>
              <div className="rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-[0_20px_45px_rgba(15,23,42,0.08)]">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">Data</p>
                <p className="mt-3 text-xl font-bold text-[var(--ink)]">Live Templates</p>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  The dashboard reads list and detail data from the existing template endpoints with
                  no backend changes.
                </p>
              </div>
              <div className="rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-[0_20px_45px_rgba(15,23,42,0.08)]">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-700">Scope</p>
                <p className="mt-3 text-xl font-bold text-[var(--ink)]">Phase 3.1</p>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  Inspect structure safely, clone draft-ready copies, and publish only eligible
                  templates while editing stays locked.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="flex items-center px-6 py-8 sm:px-10 lg:px-12 lg:py-14">
          <div className="mx-auto w-full max-w-md">
            <div className="rounded-[32px] border border-white/70 bg-white/85 p-7 shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                Admin Login
              </p>
              <h2 className="mt-3 text-3xl font-extrabold text-[var(--ink)]">
                Sign in to manage templates
              </h2>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                The seeded admin account is prefilled so you can validate the full flow quickly.
              </p>

              {authError ? (
                <div className="mt-5 rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {authError}
                </div>
              ) : null}

              <form className="mt-6 space-y-4" onSubmit={onSubmit}>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[var(--ink)]">Email</span>
                  <input
                    className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-[var(--ink)] outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
                    type="email"
                    name="email"
                    autoComplete="username"
                    value={formValues.email}
                    onChange={onChange}
                    required
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[var(--ink)]">Password</span>
                  <input
                    className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-[var(--ink)] outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    value={formValues.password}
                    onChange={onChange}
                    required
                  />
                </label>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex w-full items-center justify-center rounded-[20px] bg-slate-900 px-5 py-3.5 text-sm font-bold uppercase tracking-[0.16em] text-white transition hover:bg-teal-700 disabled:cursor-wait disabled:bg-slate-500"
                >
                  {isSubmitting ? 'Signing In...' : 'Login'}
                </button>
              </form>

              <div className="mt-6 rounded-[24px] border border-teal-100 bg-teal-50/90 p-4 text-sm text-teal-900">
                <p className="font-semibold">Seeded credentials</p>
                <p className="mt-2">
                  <span className="font-medium">Email:</span> {SEEDED_LOGIN.email}
                </p>
                <p className="mt-1">
                  <span className="font-medium">Password:</span> {SEEDED_LOGIN.password}
                </p>
              </div>

              <p className="mt-5 text-xs font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
                API target: <code>{API_BASE_URL}</code>
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function Dashboard({
  currentView,
  isLoadingTemplateDetail,
  isLoadingTemplates,
  notice,
  onBackToTemplates,
  onCloneTemplate,
  onLogout,
  onPublishTemplate,
  onRefreshCurrentView,
  onRetryTemplateDetail,
  onRetryTemplates,
  onViewTemplate,
  pendingAction,
  templateDetail,
  templateDetailError,
  templates,
  templatesError,
  user,
}) {
  const publishedTemplateCount = templates.filter((template) => template.status === 'ACTIVE').length
  const draftTemplateCount = templates.filter((template) => template.status === 'DRAFT').length
  const linkedInspectionCount = templates.reduce(
    (total, template) => total + (template.inspectionCount ?? 0),
    0,
  )

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <section className="rounded-[36px] border border-white/60 bg-white/45 p-6 shadow-[0_24px_90px_rgba(15,23,42,0.14)] backdrop-blur sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-3 rounded-full border border-white/80 bg-white/85 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-teal-800 shadow-sm">
                <span className="h-2.5 w-2.5 rounded-full bg-teal-600" />
                ASCURE Templates
              </div>
              <h1 className="mt-5 text-4xl font-extrabold text-[var(--ink)] sm:text-5xl">
                Admin visibility for every inspection template version.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--muted)] sm:text-lg">
                Open a template to inspect the exact stored checklist structure, then clone or
                publish it through the live API while the editor remains safely disabled.
              </p>
            </div>

            <div className="flex flex-col gap-4 rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-[0_20px_45px_rgba(15,23,42,0.08)]">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Signed In As
                </p>
                <p className="mt-2 text-lg font-bold text-[var(--ink)]">
                  {user?.name ?? 'ASCURE Admin'}
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">{user?.email ?? SEEDED_LOGIN.email}</p>
                <p className="mt-2 inline-flex rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-slate-700">
                  {formatRole(user?.role)}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className={outlineButtonClassName(false)}
                  onClick={onRefreshCurrentView}
                >
                  {currentView === APP_VIEWS.TEMPLATE_DETAIL ? 'Refresh Detail' : 'Refresh'}
                </button>
                <button type="button" className={outlineButtonClassName(false)} onClick={onLogout}>
                  Logout
                </button>
              </div>
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Templates"
              value={templates.length}
              helper="Every version returned by the live templates endpoint."
            />
            <MetricCard
              label="Active"
              value={publishedTemplateCount}
              helper="Published templates currently marked active."
            />
            <MetricCard
              label="Drafts"
              value={draftTemplateCount}
              helper="Draft versions waiting for further work or publish."
            />
            <MetricCard
              label="Inspections"
              value={linkedInspectionCount}
              helper="Existing inspections linked to these template versions."
            />
          </div>
        </section>

        {notice ? (
          <div className="mt-6">
            <FeedbackBanner message={notice.message} tone={notice.tone} />
          </div>
        ) : null}

        {currentView === APP_VIEWS.TEMPLATE_DETAIL ? (
          <TemplateDetailView
            detail={templateDetail}
            error={templateDetailError}
            isLoading={isLoadingTemplateDetail}
            onBack={onBackToTemplates}
            onClone={onCloneTemplate}
            onPublish={onPublishTemplate}
            onRetry={onRetryTemplateDetail}
            pendingAction={pendingAction}
          />
        ) : (
          <TemplateListView
            isLoadingTemplates={isLoadingTemplates}
            onClone={onCloneTemplate}
            onPublish={onPublishTemplate}
            onRetry={onRetryTemplates}
            onView={onViewTemplate}
            pendingAction={pendingAction}
            templates={templates}
            templatesError={templatesError}
          />
        )}
      </div>
    </main>
  )
}

function App() {
  const [storedSession] = useState(() => readStoredSession())
  const [formValues, setFormValues] = useState(SEEDED_LOGIN)
  const [token, setToken] = useState(storedSession.token)
  const [user, setUser] = useState(storedSession.user)
  const [currentView, setCurrentView] = useState(
    storedSession.token ? APP_VIEWS.TEMPLATE_LIST : APP_VIEWS.LOGIN,
  )
  const [templates, setTemplates] = useState([])
  const [templateDetailId, setTemplateDetailId] = useState('')
  const [templateDetail, setTemplateDetail] = useState(null)
  const [notice, setNotice] = useState(null)
  const [pendingAction, setPendingAction] = useState(null)
  const [authError, setAuthError] = useState('')
  const [templatesError, setTemplatesError] = useState('')
  const [templateDetailError, setTemplateDetailError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(Boolean(storedSession.token))
  const [isLoadingTemplateDetail, setIsLoadingTemplateDetail] = useState(false)

  const resetSession = useCallback((message = '') => {
    clearStoredSession()
    setToken('')
    setUser(null)
    setCurrentView(APP_VIEWS.LOGIN)
    setTemplates([])
    setTemplateDetailId('')
    setTemplateDetail(null)
    setNotice(null)
    setPendingAction(null)
    setTemplatesError('')
    setTemplateDetailError('')
    setAuthError(message)
    setIsLoadingTemplates(false)
    setIsLoadingTemplateDetail(false)
  }, [])

  const loadTemplates = useCallback(
    async ({ clearOnError = true, showSpinner = true } = {}) => {
      if (!token) {
        return []
      }

      if (showSpinner) {
        setIsLoadingTemplates(true)
      }

      setTemplatesError('')

      try {
        const nextTemplates = await fetchTemplates(token)

        startTransition(() => {
          setTemplates(nextTemplates)
        })

        return nextTemplates
      } catch (error) {
        if (error.status === 401) {
          resetSession('Your session expired. Please log in again.')
          return []
        }

        if (clearOnError) {
          setTemplates([])
        }

        setTemplatesError(error.message)
        return []
      } finally {
        if (showSpinner) {
          setIsLoadingTemplates(false)
        }
      }
    },
    [resetSession, token],
  )

  const openTemplateDetail = useCallback(
    async (nextTemplateId, { preserveNotice = false } = {}) => {
      if (!token) {
        return null
      }

      if (!preserveNotice) {
        setNotice(null)
      }

      setCurrentView(APP_VIEWS.TEMPLATE_DETAIL)
      setTemplateDetailId(nextTemplateId)
      setTemplateDetailError('')
      setIsLoadingTemplateDetail(true)
      setTemplateDetail((currentDetail) =>
        currentDetail?.template?.id === nextTemplateId ? currentDetail : null,
      )

      try {
        const nextDetail = await fetchTemplateDetail(token, nextTemplateId)

        startTransition(() => {
          setTemplateDetail(nextDetail)
        })

        return nextDetail
      } catch (error) {
        if (error.status === 401) {
          resetSession('Your session expired. Please log in again.')
          return null
        }

        setTemplateDetailError(error.message)
        return null
      } finally {
        setIsLoadingTemplateDetail(false)
      }
    },
    [resetSession, token],
  )

  useEffect(() => {
    if (!token) {
      return
    }

    let cancelled = false

    const syncTemplates = async () => {
      try {
        const nextTemplates = await fetchTemplates(token)

        if (cancelled) {
          return
        }

        startTransition(() => {
          setTemplates(nextTemplates)
        })
        setTemplatesError('')
      } catch (error) {
        if (cancelled) {
          return
        }

        if (error.status === 401) {
          resetSession('Your session expired. Please log in again.')
          return
        }

        setTemplates([])
        setTemplatesError(error.message)
      } finally {
        if (!cancelled) {
          setIsLoadingTemplates(false)
        }
      }
    }

    syncTemplates()

    return () => {
      cancelled = true
    }
  }, [resetSession, token])

  const handleFieldChange = (event) => {
    const { name, value } = event.target

    setFormValues((currentValues) => ({
      ...currentValues,
      [name]: value,
    }))
  }

  const handleLoginSubmit = async (event) => {
    event.preventDefault()
    setIsSubmitting(true)
    setAuthError('')

    try {
      const payload = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: formValues.email.trim(),
          password: formValues.password,
        }),
      })

      if (!payload?.access_token) {
        throw new Error('Login succeeded but no access token was returned.')
      }

      persistSession(payload.access_token, payload.user ?? null)
      setTemplatesError('')
      setTemplateDetailError('')
      setTemplateDetailId('')
      setTemplateDetail(null)
      setNotice(null)
      setCurrentView(APP_VIEWS.TEMPLATE_LIST)
      setIsLoadingTemplates(true)
      setUser(payload.user ?? null)
      setToken(payload.access_token)
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleLogout = () => {
    resetSession('')
    setFormValues(SEEDED_LOGIN)
  }

  const handleRetryTemplates = async () => {
    await loadTemplates()
  }

  const handleViewTemplate = async (nextTemplateId) => {
    await openTemplateDetail(nextTemplateId)
  }

  const handleBackToTemplates = () => {
    setCurrentView(APP_VIEWS.TEMPLATE_LIST)
    setTemplateDetailError('')
  }

  const handleRetryTemplateDetail = async () => {
    if (!templateDetailId) {
      return
    }

    await openTemplateDetail(templateDetailId, { preserveNotice: true })
  }

  const handleCloneTemplate = async (sourceTemplateId) => {
    if (!token) {
      return
    }

    const showListSpinner = currentView === APP_VIEWS.TEMPLATE_LIST

    setNotice(null)
    setPendingAction({
      type: 'clone',
      templateId: sourceTemplateId,
    })

    try {
      const payload = await cloneTemplateRequest(token, sourceTemplateId)
      const clonedDetail = extractClonedTemplateDetail(payload)
      const clonedTemplateId =
        clonedDetail?.template?.id || extractTemplateIdFromActionPayload(payload, 'clonedTemplate')

      if (clonedDetail) {
        startTransition(() => {
          setTemplateDetail(clonedDetail)
        })
        setTemplateDetailId(clonedDetail.template.id)
        setTemplateDetailError('')
        setCurrentView(APP_VIEWS.TEMPLATE_DETAIL)
        setNotice({
          tone: 'success',
          message: `Template cloned successfully as draft version v${clonedDetail.template.version}.`,
        })
      } else {
        setNotice({
          tone: 'success',
          message: 'Template cloned successfully.',
        })
      }

      if (!clonedDetail && clonedTemplateId) {
        await openTemplateDetail(clonedTemplateId, { preserveNotice: true })
      }

      await loadTemplates({
        clearOnError: false,
        showSpinner: showListSpinner,
      })
    } catch (error) {
      if (error.status === 401) {
        resetSession('Your session expired. Please log in again.')
        return
      }

      setNotice({
        tone: 'error',
        message: error.message,
      })
    } finally {
      setPendingAction(null)
    }
  }

  const handlePublishTemplate = async (targetTemplateId) => {
    if (!token) {
      return
    }

    const templateStatus = getTemplateStatus(targetTemplateId, templates, templateDetail)

    if (templateStatus && templateStatus !== 'DRAFT') {
      return
    }

    const showListSpinner = currentView === APP_VIEWS.TEMPLATE_LIST

    setNotice(null)
    setPendingAction({
      type: 'publish',
      templateId: targetTemplateId,
    })

    try {
      const payload = await publishTemplateRequest(token, targetTemplateId)
      const publishedDetail = extractPublishedTemplateDetail(payload)
      const publishedTemplateId =
        publishedDetail?.template?.id ||
        extractTemplateIdFromActionPayload(payload, 'publishedTemplate') ||
        targetTemplateId

      if (publishedDetail) {
        startTransition(() => {
          setTemplateDetail(publishedDetail)
        })
        setTemplateDetailId(publishedDetail.template.id)
        setTemplateDetailError('')
        setCurrentView(APP_VIEWS.TEMPLATE_DETAIL)
      } else if (publishedTemplateId) {
        await openTemplateDetail(publishedTemplateId, { preserveNotice: true })
      }

      setNotice({
        tone: 'success',
        message: 'Template published successfully.',
      })

      await loadTemplates({
        clearOnError: false,
        showSpinner: showListSpinner,
      })
    } catch (error) {
      if (error.status === 401) {
        resetSession('Your session expired. Please log in again.')
        return
      }

      setNotice({
        tone: 'error',
        message: error.message,
      })
    } finally {
      setPendingAction(null)
    }
  }

  const handleRefreshCurrentView = async () => {
    if (!token) {
      return
    }

    if (currentView === APP_VIEWS.TEMPLATE_DETAIL && templateDetailId) {
      await openTemplateDetail(templateDetailId, { preserveNotice: true })
      await loadTemplates({
        clearOnError: false,
        showSpinner: false,
      })
      return
    }

    await loadTemplates()
  }

  if (!token) {
    return (
      <LoginView
        authError={authError}
        formValues={formValues}
        isSubmitting={isSubmitting}
        onChange={handleFieldChange}
        onSubmit={handleLoginSubmit}
      />
    )
  }

  return (
    <Dashboard
      currentView={currentView}
      isLoadingTemplateDetail={isLoadingTemplateDetail}
      isLoadingTemplates={isLoadingTemplates}
      notice={notice}
      onBackToTemplates={handleBackToTemplates}
      onCloneTemplate={handleCloneTemplate}
      onLogout={handleLogout}
      onPublishTemplate={handlePublishTemplate}
      onRefreshCurrentView={handleRefreshCurrentView}
      onRetryTemplateDetail={handleRetryTemplateDetail}
      onRetryTemplates={handleRetryTemplates}
      onViewTemplate={handleViewTemplate}
      pendingAction={pendingAction}
      templateDetail={templateDetail}
      templateDetailError={templateDetailError}
      templates={templates}
      templatesError={templatesError}
      user={user}
    />
  )
}

export default App
