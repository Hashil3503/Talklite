import { Client, type IMessage, type StompHeaders, type StompSubscription } from '@stomp/stompjs'
import { createSession } from './api'
import { getStoredSecret, getStoredUid, saveSessionCredentials } from './uid'
import { useUserStore } from '../store/userStore'

let stompClient: Client | null = null
let activeToken: string | null = null
let recoveryPromise: Promise<void> | null = null

// 단일 onConnect 핸들러의 연결 대기열 — 호출마다 client.onConnect를 감싸면 핸들러가 누적된다
let connectionWaiters: ((client: Client) => void)[] = []
let handlersInstalled = false

// 재연결(드롭/세션 복구) 후에도 복원해야 하는 활성 구독 레지스트리
interface TopicSubscription {
  topic: string
  callback: (message: IMessage) => void
  subscription: StompSubscription | null
}
const topicSubscriptions = new Set<TopicSubscription>()

// 서버 재기동 감지용 — 최초로 확인한 서버 인스턴스 ID
let serverInstanceId: string | null = null

const SERVER_RESTART_MESSAGE =
  '서버가 다시 시작되었습니다. 최신 상태를 불러오려면 새로고침이 필요합니다. 지금 새로고침할까요?'

/** 이전에 본 인스턴스와 다르면 재기동으로 보고 새로고침을 안내한다 (최초 관찰은 제외) */
export function shouldPromptRefresh(previousId: string | null, currentId: string | null): boolean {
  return previousId !== null && currentId !== null && previousId !== currentId
}

function checkServerInstance() {
  void fetch('/api/health')
    .then((response) => (response.ok ? response.json() : null))
    .then((data: { instanceId?: unknown } | null) => {
      const currentId = typeof data?.instanceId === 'string' ? data.instanceId : null
      if (!currentId) return
      const previousId = serverInstanceId
      serverInstanceId = currentId
      if (shouldPromptRefresh(previousId, currentId) && window.confirm(SERVER_RESTART_MESSAGE)) {
        window.location.reload()
      }
    })
    .catch(() => {
      // 네트워크 오류는 무시한다
    })
}

export function setSessionToken(token: string | null) {
  activeToken = token
}

function isAuthenticationError(message: string, body: string): boolean {
  return /authentication required|unauthori[sz]ed|unauthenticated|invalid token|access denied/i.test(`${message} ${body}`)
}

export function recoverSession(): Promise<void> {
  if (recoveryPromise) return recoveryPromise

  recoveryPromise = (async () => {
    const uid = getStoredUid()

    activeToken = null
    localStorage.removeItem('talklite_token')
    localStorage.removeItem('talklite_token_expires_at')

    const session = await createSession(uid || undefined, getStoredSecret() || undefined)
    localStorage.setItem('talklite_token', session.token)
    localStorage.setItem('talklite_token_expires_at', String(Date.now() + session.expiresIn * 1000))
    activeToken = session.token
    // 서버가 새 UID(또는 새 비밀값)를 발급한 경우 저장하고 스토어 UID도 갱신
    if (session.user !== uid || session.secret) {
      saveSessionCredentials(session.user, session.secret)
      useUserStore.getState().setUid(session.user)
    }

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

/** 연결 수립 시 레지스트리의 모든 구독을 (재)등록한다. */
function restoreSubscriptions(client: Client) {
  for (const entry of topicSubscriptions) {
    // 이전 소켓의 구독은 브로커 측에서 함께 사라지므로 새 연결에서 다시 등록만 한다
    entry.subscription = client.subscribe(entry.topic, entry.callback)
  }
}

function installHandlers(client: Client) {
  if (handlersInstalled) return
  handlersInstalled = true

  client.onConnect = () => {
    restoreSubscriptions(client)
    checkServerInstance()
    const waiters = connectionWaiters
    connectionWaiters = []
    waiters.forEach((resolve) => resolve(client))
  }

  client.onStompError = (frame) => {
    const message = frame.headers['message'] || ''
    console.error('STOMP protocol error:', message, frame.body)
    if (isAuthenticationError(message, frame.body)) {
      void recoverSession()
    }
  }
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
    onWebSocketError: (event) => {
      console.warn('WebSocket connection error:', event)
    },
  })
  installHandlers(stompClient)

  return stompClient
}

export function ensureStompConnected(): Promise<Client> {
  const client = getStompClient()
  if (client.connected) {
    return Promise.resolve(client)
  }

  return new Promise((resolve) => {
    connectionWaiters.push(resolve)
    if (!client.active) {
      client.activate()
    }
  })
}

/**
 * 토픽 구독 — 연결 전이면 연결 후 구독하고, 재연결 시에도 자동으로 재등록된다.
 * 반환된 unsubscribe는 레지스트리에서도 해당 구독을 제거한다.
 */
export function subscribeTopic(topic: string, callback: (message: IMessage) => void) {
  const client = getStompClient()
  const entry: TopicSubscription = {
    topic,
    callback,
    subscription: client.connected ? client.subscribe(topic, callback) : null,
  }
  topicSubscriptions.add(entry)

  if (!entry.subscription) {
    void ensureStompConnected()
  }

  return {
    unsubscribe: () => {
      topicSubscriptions.delete(entry)
      if (entry.subscription) {
        entry.subscription.unsubscribe()
        entry.subscription = null
      }
    },
  }
}
