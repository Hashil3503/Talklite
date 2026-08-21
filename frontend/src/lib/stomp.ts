import { Client, type IMessage, type StompHeaders } from '@stomp/stompjs'

let stompClient: Client | null = null
let activeToken: string | null = null

export function setSessionToken(token: string | null) {
  activeToken = token
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
      console.error('STOMP protocol error:', frame.headers['message'], frame.body)
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
