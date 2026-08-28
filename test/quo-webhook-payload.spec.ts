import { describe, expect, it } from 'vitest'
import {
  evaluateQuoInboundMessage,
  extractSmsCode,
  isQuoInboundDirection,
  parseQuoMessageReceivedPayload,
} from '../shared/quo-webhook-payload'

describe('parseQuoMessageReceivedPayload', () => {
  it('parses the 2026-03-30 resource/context shape', () => {
    const parsed = parseQuoMessageReceivedPayload({
      id: 'EV123',
      type: 'message.received',
      data: {
        resource: {
          id: 'AC-message',
          direction: 'incoming',
          text: 'Susan?',
          media: [],
          status: 'received',
        },
        context: {
          senderIdentifier: '+15555550111',
          recipientIdentifiers: ['+15165184847'],
        },
      },
    })

    expect(parsed.rawType).toBe('message.received')
    expect(parsed.body).toBe('Susan?')
    expect(parsed.fromPhone).toBe('+15555550111')
    expect(parsed.toPhone).toBe('+15165184847')
    expect(parsed.messageId).toBe('AC-message')
    expect(isQuoInboundDirection(parsed.direction)).toBe(true)
  })

  it('parses legacy data.object payloads', () => {
    const parsed = parseQuoMessageReceivedPayload({
      type: 'message.received',
      data: {
        object: {
          id: 'ACold',
          direction: 'incoming',
          from: '+14155550100',
          to: ['+13105550199'],
          body: 'Hello',
        },
      },
    })

    expect(parsed.body).toBe('Hello')
    expect(parsed.fromPhone).toBe('+14155550100')
    expect(parsed.toPhone).toBe('+13105550199')
    expect(parsed.messageId).toBe('ACold')
  })

  it('treats missing direction as inbound', () => {
    expect(isQuoInboundDirection(null)).toBe(true)
    expect(isQuoInboundDirection('outgoing')).toBe(false)
  })
})

describe('extractSmsCode', () => {
  it('pulls a 6-digit code from an inbound body', () => {
    expect(extractSmsCode('Sensible Logistics code: 123456. Reply with this code to verify.')).toBe('123456')
    expect(extractSmsCode('123456')).toBe('123456')
    expect(extractSmsCode('no code here')).toBeNull()
  })
})

describe('evaluateQuoInboundMessage', () => {
  const inbound = parseQuoMessageReceivedPayload({
    type: 'message.received',
    data: {
      resource: { id: 'm1', direction: 'incoming', text: '123456' },
      context: {
        senderIdentifier: '+19545550142',
        recipientIdentifiers: ['+19545550000'],
      },
    },
  })

  it('accepts inbound SMS to the selected platform number', () => {
    expect(evaluateQuoInboundMessage(inbound, '+19545550000')).toEqual({ ignore: false })
  })

  it('ignores SMS sent to any other Quo number', () => {
    expect(evaluateQuoInboundMessage(inbound, '+19545550999')).toEqual({
      ignore: true,
      reason: 'wrong_number',
    })
  })

  it('ignores echoes from the platform number itself', () => {
    const self = parseQuoMessageReceivedPayload({
      type: 'message.received',
      data: {
        resource: { id: 'm2', direction: 'incoming', text: '123456' },
        context: {
          senderIdentifier: '+19545550000',
          recipientIdentifiers: ['+19545550000'],
        },
      },
    })
    expect(evaluateQuoInboundMessage(self, '+19545550000')).toEqual({
      ignore: true,
      reason: 'self_message',
    })
  })

  it('ignores outbound traffic and non-message events', () => {
    const outbound = parseQuoMessageReceivedPayload({
      type: 'message.received',
      data: {
        resource: { id: 'm3', direction: 'outgoing', text: 'hi' },
        context: {
          senderIdentifier: '+19545550000',
          recipientIdentifiers: ['+19545550142'],
        },
      },
    })
    expect(evaluateQuoInboundMessage(outbound, '+19545550000')).toEqual({
      ignore: true,
      reason: 'not_inbound',
    })

    const other = parseQuoMessageReceivedPayload({
      type: 'call.ringing',
      data: {
        resource: { id: 'c1', direction: 'incoming' },
        context: {
          senderIdentifier: '+19545550142',
          recipientIdentifiers: ['+19545550000'],
        },
      },
    })
    expect(evaluateQuoInboundMessage(other, '+19545550000')).toEqual({
      ignore: true,
      reason: 'wrong_type',
    })
  })
})
