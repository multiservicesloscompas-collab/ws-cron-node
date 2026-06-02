import { assertEquals } from '#test-assert'
import { vi } from 'vitest'
import { makeCronScheduler } from '../make-cron-scheduler.ts'
import type { CronRuntimeState } from '../cron-runtime.ts'
import { success, failure } from '../../../types/result.ts'

const scheduledDate = new Date('2026-06-02T12:30:00.000Z')

const runtimeState: CronRuntimeState = {
  settings: {
    defaultTargetJid: 'saved@g.us',
    timezone: 'America/Caracas',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  cronJobs: [
    {
      id: 'runtime-cron-id',
      name: 'Matutino',
      scheduleTime: '08:30',
      days: '*',
      enabled: true,
      targetJid: 'saved@g.us',
      executionMode: 'sequence',
      messages: [
        {
          contentType: 'static_template',
          staticTemplate: 'Hola runtime',
          llmPrompt: null,
          llmModel: null,
          fallbackMessages: null,
        },
      ],
      contentType: 'static_template',
      staticTemplate: 'Hola runtime',
      llmPrompt: null,
      llmModel: null,
      fallbackMessages: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastTriggeredAt: null,
    },
  ],
}

const flushPromises = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

Deno.test('makeCronScheduler retries automatic sends on the next matching tick after a failure', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(scheduledDate)

  const attempts: string[] = []
  let triggeredCount = 0

  const scheduler = makeCronScheduler({
    sendMessage: async (_jid, text) => {
      attempts.push(text)
      return attempts.length === 1 ? failure('WhatsApp no está conectado') : success(undefined)
    },
    messageRenderer: {
      render: async () => failure('No debería usarse en este test'),
      renderMessage: async () => success({
        contentType: 'static_template',
        text: 'Hola runtime',
        fallbackMessages: null,
      }),
    },
    onTriggered: () => {
      triggeredCount += 1
    },
  })

  try {
    scheduler.startAll(runtimeState)
    await flushPromises()

    assertEquals(attempts, ['Hola runtime'])
    assertEquals(triggeredCount, 0)

    await vi.advanceTimersByTimeAsync(30_000)
    await flushPromises()

    assertEquals(attempts, ['Hola runtime', 'Hola runtime'])
    assertEquals(triggeredCount, 1)
  } finally {
    scheduler.stopAll()
    vi.useRealTimers()
  }
})

Deno.test('makeCronScheduler keeps retrying automatic sends briefly after the scheduled minute', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(scheduledDate)

  const attempts: string[] = []
  let triggeredCount = 0

  const scheduler = makeCronScheduler({
    sendMessage: async (_jid, text) => {
      attempts.push(text)
      return attempts.length < 3 ? failure('WhatsApp no está conectado') : success(undefined)
    },
    messageRenderer: {
      render: async () => failure('No debería usarse en este test'),
      renderMessage: async () => success({
        contentType: 'static_template',
        text: 'Hola runtime',
        fallbackMessages: null,
      }),
    },
    onTriggered: () => {
      triggeredCount += 1
    },
  })

  try {
    scheduler.startAll(runtimeState)
    await flushPromises()

    await vi.advanceTimersByTimeAsync(30_000)
    await flushPromises()

    await vi.advanceTimersByTimeAsync(30_000)
    await flushPromises()

    assertEquals(attempts, ['Hola runtime', 'Hola runtime', 'Hola runtime'])
    assertEquals(triggeredCount, 1)
  } finally {
    scheduler.stopAll()
    vi.useRealTimers()
  }
})

Deno.test('makeCronScheduler marks automatic sends as fired only after success', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(scheduledDate)

  const attempts: string[] = []
  let triggeredCount = 0

  const scheduler = makeCronScheduler({
    sendMessage: async (_jid, text) => {
      attempts.push(text)
      return success(undefined)
    },
    messageRenderer: {
      render: async () => failure('No debería usarse en este test'),
      renderMessage: async () => success({
        contentType: 'static_template',
        text: 'Hola runtime',
        fallbackMessages: null,
      }),
    },
    onTriggered: () => {
      triggeredCount += 1
    },
  })

  try {
    scheduler.startAll(runtimeState)
    await flushPromises()

    assertEquals(attempts, ['Hola runtime'])
    assertEquals(triggeredCount, 1)

    await vi.advanceTimersByTimeAsync(30_000)
    await flushPromises()

    assertEquals(attempts, ['Hola runtime'])
    assertEquals(triggeredCount, 1)
  } finally {
    scheduler.stopAll()
    vi.useRealTimers()
  }
})

Deno.test('makeCronScheduler avoids overlapping automatic sends while a cron execution is still in flight', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(scheduledDate)

  let resolveSend: (() => void) | undefined
  let sendCalls = 0

  const scheduler = makeCronScheduler({
    sendMessage: async () => {
      sendCalls += 1
      return await new Promise<ReturnType<typeof success<void>>>((resolve) => {
        resolveSend = () => resolve(success(undefined))
      })
    },
    messageRenderer: {
      render: async () => failure('No debería usarse en este test'),
      renderMessage: async () => success({
        contentType: 'static_template',
        text: 'Hola runtime',
        fallbackMessages: null,
      }),
    },
  })

  try {
    scheduler.startAll(runtimeState)
    await flushPromises()
    assertEquals(sendCalls, 1)

    await vi.advanceTimersByTimeAsync(30_000)
    await flushPromises()
    assertEquals(sendCalls, 1)

    resolveSend?.()
    await flushPromises()

    await vi.advanceTimersByTimeAsync(30_000)
    await flushPromises()
    assertEquals(sendCalls, 1)
  } finally {
    scheduler.stopAll()
    vi.useRealTimers()
  }
})
