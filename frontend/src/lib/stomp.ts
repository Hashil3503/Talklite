import { Client, type IMessage, type StompHeaders } from '@stomp/stompjs'
import { createSession } from './api'

let stompClient: Client | null = null
let activeToken: string | null = null
let recoveryPromise: Promise<void> | null = null

export function setSessionToken(token: string | null) {
  activeToken = token
}

function isAuthenticationError(message: string, body: string): boolean {
  return /authentication required|unauthori[sz]ed|unauthenticated|invalid token|access denied/i.test(`${message} ${body}`)
}

function recoverSession(): Promise<void> {
  if (recoveryPromise) return recoveryPromise

  recoveryPromise = (async () => {
    const uid = localStorage.getItem('talklite_uid')
    if (!uid) return

    activeToken = null
    localStorage.removeItem('talklite_token')
    localStorage.removeItem('talklite_token_expires_at')

    const session = await createSession(uid)
    localStorage.setItem('talklite_token', session.token)
    localStorage.setItem('talklite_token_expires_at', String(Date.now() + session.expiresIn * 1000))
    activeToken = session.token

    const client = stompClient
    if (!client) return
    if (client.active) {
      await client.deactivate()
    }
    await client.activate()
  })().catch((err: unknown) => {
    console.error('[stomp] session recovery failed:', err)
    throw err
  }).finally(() => {
    recoveryPromise = null
  })

  return recoveryPromise
}

export function getStompClient(): Client {
  if (stompClient) {
    return stompClient
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const brokerURL = `${protocol}//${window.location.host}/ws`

  stompClient = new Client({
    brokerURL,
    reconnectDelay: 5000,
    heartbeatIncoming: 10000,
    heartbeatOutgoing: 10000,
    beforeConnect: () => {
      const headers: StompHeaders = {}
      const token = activeToken || localStorage.getItem('talklite_token')
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
      const uid = localStorage.getItem('talklite_uid')
      if (uid) {
        headers['X-User-Id'] = uid
      }
      stompClient!.connectHeaders = headers
    },
    onStompError: (frame) => {
      const message = frame.headers['message'] || ''
      console.error('STOMP protocol error:', message, frame.body)
      if (isAuthenticationError(message, frame.body)) {
        void recoverSession()
      }
    },
    onWebSocketError: (event) => {
      console.warn('WebSocket connection error:', event)
    },
  })

  return stompClient
}

export function ensureStompConnected(): Promise<Client> {
  const client = getStompClient()
  if (client.connected) {
    return Promise.resolve(client)
  }

  return new Promise((resolve) => {
    const prevOnConnect = client.onConnect
    client.onConnect = (frame) => {
      if (prevOnConnect) prevOnConnect(frame)
      resolve(client)
    }
    if (!client.active) {
      client.activate()
    }
  })
}

export function subscribeTopic(topic: string, callback: (message: IMessage) => void) {
  const client = getStompClient()
  if (client.connected) {
    return client.subscribe(topic, callback)
  }
  let sub: any = null
  ensureStompConnected().then((c) => {
    sub = c.subscribe(topic, callback)
  })
  return {
    unsubscribe: () => {
      if (sub) sub.unsubscribe()
    },
  }
}
