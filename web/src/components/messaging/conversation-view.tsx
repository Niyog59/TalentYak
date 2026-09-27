"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/button";
import { MediaUploader } from "@/components/media/uploader";
import { createClient } from "@/lib/supabase/client";
import {
  PROMPT_EXPECTED_WITHIN_MS,
  advanceWatermark,
  describeWorkingHours,
  groupByDay,
  liveUpdatesLookSilent,
  mergeMessages,
  timeLabel,
} from "@/lib/messaging/display";
import {
  attachmentStateAction,
  conversationStatusAction,
  loadMessagesAction,
  markReadAction,
  sendMessageAction,
} from "@/lib/messaging/actions";
import type { ConversationStatus, Message } from "@/lib/messaging/types";

/*
 * One private conversation.
 *
 * THE DATABASE IS THE RECORD. Realtime only says "something changed"; the
 * screen then asks the server for messages after the last one it has. After a
 * dropped connection, a sleeping laptop or a refresh, the same catch-up runs,
 * so nothing depends on a live socket having stayed up.
 *
 * SENDING IS IDEMPOTENT. Every message gets an id generated here before it is
 * sent, and keeps it through every retry. Sending the same id twice returns
 * the original message, so a retry after a timeout cannot post a duplicate.
 * Unsent messages are kept on this device until the server confirms them.
 *
 * READ MEANS SEEN. A message counts as read only when it has been on screen in
 * this open conversation while the tab is visible — not when it was delivered,
 * emailed about, or sitting in a background tab.
 */

interface Pending {
  clientId: string;
  body: string;
  mediaId: string | null;
  mediaKind: "image" | "video" | null;
  state: "sending" | "failed";
  error: string | null;
  /** A refusal (not a dropped connection) is not retried automatically. */
  retryable: boolean;
  createdAt: string;
}

interface Staged {
  assetId: string;
  kind: "image" | "video";
  state: "processing" | "ready" | "failed" | "slow";
  reason: string | null;
}

const storageKey = (viewer: string, conversation: string) => `talentyak:unsent:${viewer}:${conversation}`;

function readPending(key: string): Pending[] {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Pending[]) : [];
  } catch {
    return [];
  }
}

function writePending(key: string, items: Pending[]) {
  try {
    if (items.length) window.localStorage.setItem(key, JSON.stringify(items));
    else window.localStorage.removeItem(key);
  } catch {
    // Private browsing or storage switched off: the message still sends, it
    // just isn't kept across a refresh.
  }
}

export function ConversationView({
  conversationId,
  viewerId,
  timeZone,
  enrollmentId,
  initialStatus,
  initialMessages,
  initialHasOlder,
  backHref,
  supportHref,
}: {
  conversationId: string;
  viewerId: string;
  timeZone: string;
  enrollmentId: string;
  initialStatus: ConversationStatus;
  initialMessages: Message[];
  initialHasOlder: boolean;
  backHref: string;
  supportHref: string;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [hasOlder, setHasOlder] = useState(initialHasOlder);
  const [status, setStatus] = useState<ConversationStatus>(initialStatus);
  const [revoked, setRevoked] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<"connecting" | "live" | "offline">("connecting");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showUploader, setShowUploader] = useState(false);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [newBelow, setNewBelow] = useState(false);

  const scroller = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const lastSeq = useRef(initialMessages.at(-1)?.seq ?? 0);
  // Whether the realtime channel says it is subscribed, and when it last
  // actually delivered a prompt. The two can disagree: see liveUpdatesLookSilent.
  const subscribed = useRef(false);
  const lastPromptAt = useRef(0);
  const watermark = useRef(initialStatus.my_last_read_seq);
  const seen = useRef(new Set<number>());
  const onScreen = useRef(new Set<number>());
  const markTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preserveFrom = useRef<number | null>(null);
  const stickToBottom = useRef(true);
  const pendingKey = storageKey(viewerId, conversationId);
  // Where the "unread" line goes: fixed when the screen opened, so it does not
  // jump away the moment the first message is marked read.
  const [unreadFrom] = useState(initialStatus.my_last_read_seq);

  const mine = useMemo(
    () => new Set(messages.filter((m) => m.sender_profile_id === viewerId).map((m) => m.seq)),
    [messages, viewerId],
  );

  // --- Keeping up to date ----------------------------------------------------

  const refreshStatus = useCallback(async () => {
    // A dropped connection is not a refusal: try again on the next prompt.
    const result = await conversationStatusAction(conversationId).catch(() => null);
    if (!result) return;
    if (result.ok) {
      setStatus(result.data);
      watermark.current = Math.max(watermark.current, result.data.my_last_read_seq);
    } else {
      setRevoked(result.message);
    }
  }, [conversationId]);

  /** Fetches what arrived since the last message shown. Returns how many were from the other person. */
  const catchUp = useCallback(async (): Promise<number> => {
    const result = await loadMessagesAction(conversationId, { afterSeq: lastSeq.current }).catch(() => null);
    if (!result) return 0;
    if (!result.ok) {
      setRevoked(result.message);
      return 0;
    }
    setLoadError(null);
    if (!result.data.messages.length) return 0;
    lastSeq.current = Math.max(lastSeq.current, ...result.data.messages.map((m) => m.seq));
    setMessages((current) => mergeMessages(current, result.data.messages));
    // A confirmed message replaces its unsent copy.
    const confirmed = new Set(result.data.messages.map((m) => m.client_message_id));
    setPending((current) => {
      const next = current.filter((p) => !confirmed.has(p.clientId));
      if (next.length !== current.length) writePending(pendingKey, next);
      return next;
    });
    const el = scroller.current;
    const nearBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 120 : true;
    if (nearBottom) stickToBottom.current = true;
    else setNewBelow(true);
    return result.data.messages.filter((m) => m.sender_profile_id !== viewerId).length;
  }, [conversationId, pendingKey, viewerId]);

  // A prompt that ought to arrive, and the moment from which it counts. If none
  // has come within PROMPT_EXPECTED_WITHIN_MS, live updates have silently
  // stopped: stop saying "Up to date" and check every 20 seconds instead,
  // until a prompt arrives again.
  const expectPrompt = useCallback((expectedSince: number) => {
    setTimeout(() => {
      if (liveUpdatesLookSilent({ subscribed: subscribed.current, lastPromptAt: lastPromptAt.current, expectedSince })) {
        setLive("offline");
      }
    }, PROMPT_EXPECTED_WITHIN_MS);
  }, []);

  // Realtime prompts, with catch-up on every (re)connection.
  //
  // The realtime connection must carry the signed-in person's token BEFORE it
  // subscribes. Without it the channel still reports "subscribed", but it is
  // authorised as an anonymous visitor, so row-level security filters out
  // every signal and nothing ever arrives (found in testing).
  useEffect(() => {
    const sb = createClient();
    if (!sb) return;
    let cancelled = false;
    let channel: ReturnType<typeof sb.channel> | null = null;

    const { data: auth } = sb.auth.onAuthStateChange((_event, session) => {
      if (session) void sb.realtime.setAuth(session.access_token);
    });

    void (async () => {
      const { data } = await sb.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        setLive("offline");
        return;
      }
      await sb.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      channel = sb
        .channel(`conversation:${conversationId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "conversation_signals", filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            lastPromptAt.current = Date.now();
            // A prompt is proof live updates work, whatever was concluded before.
            setLive("live");
            const kind = (payload.new as { kind?: string }).kind;
            if (kind === "message") void catchUp();
            void refreshStatus();
          },
        )
        .subscribe((state) => {
          if (state === "SUBSCRIBED") {
            subscribed.current = true;
            setLive("live");
            void catchUp();
            void refreshStatus();
          } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
            subscribed.current = false;
            setLive("offline");
          }
        });
    })();

    return () => {
      cancelled = true;
      subscribed.current = false;
      auth.subscription.unsubscribe();
      if (channel) void sb.removeChannel(channel);
    };
  }, [conversationId, catchUp, refreshStatus]);

  // Without a live connection, ask every 20 seconds; always ask on return.
  useEffect(() => {
    const onReturn = () => {
      if (!navigator.onLine) return;
      if (document.visibilityState === "visible") {
        void catchUp();
        void refreshStatus();
      }
    };
    // A socket can drop without saying so (measured: a lost network left the
    // channel reporting nothing). Going offline is therefore never "up to
    // date", and even a live screen checks once a minute.
    const onOffline = () => setLive("offline");
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("online", onReturn);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", onReturn);
    // The periodic check doubles as a watchdog: if it finds a message from the
    // other person while the screen believes it is live, the prompt for that
    // message should arrive within moments. If it does not, live updates have
    // gone quiet without the connection saying so.
    const onPoll = async () => {
      if (!navigator.onLine || document.visibilityState !== "visible") return;
      const startedAt = Date.now();
      const found = await catchUp();
      void refreshStatus();
      // A prompt in the two seconds before this check still counts: it is
      // most likely the prompt for what this check just found.
      if (found > 0 && live === "live") expectPrompt(startedAt - 2_000);
    };
    const poll = setInterval(() => void onPoll(), live === "live" ? 60_000 : 20_000);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("online", onReturn);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", onReturn);
      clearInterval(poll);
    };
  }, [live, catchUp, refreshStatus, expectPrompt]);

  // Fill the space left below the site's own header, in the VISIBLE viewport —
  // which shrinks when a phone keyboard opens, keeping the composer above it.
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const visible = window.visualViewport?.height ?? window.innerHeight;
      el.style.height = `${Math.max(360, Math.floor(visible - top))}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
    };
  }, []);

  // --- Older history ---------------------------------------------------------

  const loadOlder = useCallback(async () => {
    const oldest = messages[0]?.seq;
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    const result = await loadMessagesAction(conversationId, { beforeSeq: oldest }).catch(() => null);
    setLoadingOlder(false);
    if (!result || !result.ok) {
      setLoadError("Older messages couldn't be loaded. Try again.");
      return;
    }
    preserveFrom.current = scroller.current?.scrollHeight ?? null;
    stickToBottom.current = false;
    setHasOlder(result.data.hasOlder);
    setMessages((current) => mergeMessages(current, result.data.messages));
  }, [conversationId, messages, loadingOlder]);

  // Keep the reader's place when older messages are added above them, and
  // follow new messages only if they were already at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (preserveFrom.current !== null) {
      el.scrollTop += el.scrollHeight - preserveFrom.current;
      preserveFrom.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pending]);

  // On opening: make sure the first unread message is loaded, then show it.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    const firstUnread = initialMessages.find((m) => m.seq > unreadFrom && m.sender_profile_id !== viewerId);
    if (firstUnread) {
      stickToBottom.current = false;
      requestAnimationFrame(() => {
        // Scroll the message list only — scrollIntoView would also move the
        // page and push the conversation header off a phone screen.
        const el = scroller.current;
        const target = document.getElementById(`msg-${firstUnread.seq}`);
        if (el && target) el.scrollTop = Math.max(0, target.offsetTop - 48);
      });
    }
  }, [initialMessages, unreadFrom, viewerId]);

  // --- Read tracking ---------------------------------------------------------

  const flushRead = useCallback(() => {
    const next = advanceWatermark(watermark.current, lastSeq.current, seen.current, mine);
    if (next <= watermark.current) return;
    watermark.current = next;
    setStatus((s) => ({ ...s, my_last_read_seq: next }));
    if (markTimer.current) clearTimeout(markTimer.current);
    markTimer.current = setTimeout(() => {
      void markReadAction(conversationId, watermark.current).catch(() => {
        // Not recorded this time; the next seen message sends the mark again.
        watermark.current = Math.min(watermark.current, next - 1);
      });
    }, 600);
  }, [conversationId, mine]);

  useEffect(() => {
    const root = scroller.current;
    if (!root || revoked) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const seq = Number((entry.target as HTMLElement).dataset.seq);
          if (entry.isIntersecting) onScreen.current.add(seq);
          else onScreen.current.delete(seq);
          if (entry.isIntersecting && document.visibilityState === "visible") seen.current.add(seq);
        }
        flushRead();
      },
      { root, threshold: 0.6 },
    );
    root.querySelectorAll<HTMLElement>("[data-unread-candidate]").forEach((el) => observer.observe(el));

    // Coming back to a hidden tab: what is on screen now has now been seen.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      onScreen.current.forEach((s) => seen.current.add(s));
      flushRead();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [messages, flushRead, revoked]);

  // --- Sending ---------------------------------------------------------------

  const deliver = useCallback(
    async (item: Pending) => {
      setPending((current) => {
        const next = current.map((p) => (p.clientId === item.clientId ? { ...p, state: "sending" as const, error: null } : p));
        writePending(pendingKey, next);
        return next;
      });
      let failure: { message: string; retryable: boolean } | null = null;
      const sendStartedAt = Date.now();
      try {
        const result = await sendMessageAction(conversationId, item.clientId, item.body, item.mediaId);
        if (!result.ok) failure = { message: result.message, retryable: result.code === "rate_limited" };
        // Sending emits a prompt to every participant — the sender included.
        // Its echo is the cheapest proof that live updates still work. A retry
        // that returned an earlier message emitted nothing new, so expect nothing.
        else if (!result.data.duplicate) expectPrompt(sendStartedAt);
      } catch {
        failure = { message: "Not sent — the connection dropped. Try again.", retryable: true };
      }
      if (failure) {
        const { message, retryable } = failure;
        setPending((current) => {
          const next = current.map((p) =>
            p.clientId === item.clientId ? { ...p, state: "failed" as const, error: message, retryable } : p,
          );
          writePending(pendingKey, next);
          return next;
        });
        return;
      }
      stickToBottom.current = true;
      await catchUp();
    },
    [conversationId, pendingKey, catchUp, expectPrompt],
  );

  // Unsent messages from an earlier visit, and after coming back online.
  // Device storage is not available during the server render, so it is read
  // after mount — once.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    const saved = readPending(pendingKey).map((p) => ({ ...p, state: "failed" as const }));
    if (!saved.length) return;
    const timer = setTimeout(() => {
      // Marked inside the timer so a development double-mount still restores.
      restored.current = true;
      setPending(saved);
      saved.filter((p) => p.retryable).forEach((p) => void deliver(p));
    }, 0);
    return () => clearTimeout(timer);
  }, [pendingKey, deliver]);

  useEffect(() => {
    const onOnline = () => pending.filter((p) => p.state === "failed" && p.retryable).forEach((p) => void deliver(p));
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [pending, deliver]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const body = draft.trim();
    const media = staged?.state === "ready" ? staged : null;
    if (!body && !media) return;
    if (staged && staged.state !== "ready") return;
    const item: Pending = {
      clientId: crypto.randomUUID(),
      body,
      mediaId: media?.assetId ?? null,
      mediaKind: media?.kind ?? null,
      state: "sending",
      error: null,
      retryable: true,
      createdAt: new Date().toISOString(),
    };
    setPending((current) => {
      const next = [...current, item];
      writePending(pendingKey, next);
      return next;
    });
    setDraft("");
    setStaged(null);
    setShowUploader(false);
    stickToBottom.current = true;
    void deliver(item);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter makes a new line (as on a phone keyboard); Ctrl or Cmd + Enter sends.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
  };

  const discard = (clientId: string) =>
    setPending((current) => {
      const next = current.filter((p) => p.clientId !== clientId);
      writePending(pendingKey, next);
      return next;
    });

  // --- Attachments -----------------------------------------------------------

  useEffect(() => {
    if (!staged || (staged.state !== "processing" && staged.state !== "slow")) return;
    const started = Date.now();
    const timer = setInterval(async () => {
      const result = await attachmentStateAction(staged.assetId).catch(() => null);
      if (!result || !result.ok) return;
      if (result.data.state === "ready") setStaged((s) => (s ? { ...s, state: "ready" } : s));
      else if (result.data.state === "failed" || result.data.state === "deleted")
        setStaged((s) => (s ? { ...s, state: "failed", reason: result.data.failure_reason } : s));
      else if (Date.now() - started > 4 * 60_000) setStaged((s) => (s && s.state === "processing" ? { ...s, state: "slow" } : s));
    }, 2500);
    return () => clearInterval(timer);
  }, [staged]);

  // --- Rendering -------------------------------------------------------------

  const other = status.role === "customer" ? status.coach_name : status.client_name;
  const hours = describeWorkingHours(status.working_hours);
  const groups = groupByDay(messages, timeZone);
  const firstUnreadSeq = messages.find((m) => m.seq > unreadFrom && m.sender_profile_id !== viewerId)?.seq;
  const closed = Boolean(revoked) || !status.can_send;
  const expectationsHref = status.role === "customer"
    ? `/account/expectations/${enrollmentId}`
    : `/coach/expectations/clients/${enrollmentId}`;

  return (
    <div ref={frame} className="flex h-[calc(100dvh-4rem)] flex-col">
      <header className="border-b border-line pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <Link href={backHref} className="text-sm text-brand underline underline-offset-4">All conversations</Link>
            <h1 className="mt-1 truncate text-2xl font-semibold">{other}</h1>
            <Link href={expectationsHref} className="text-sm text-brand underline underline-offset-4">Welcome &amp; expectations</Link>
          </div>
          <p className="text-sm text-ink-muted" aria-live="polite">
            {live === "live" ? "Up to date" : live === "connecting" ? "Connecting…" : "Live updates paused — checking every 20 seconds"}
          </p>
        </div>

        {status.role === "customer" && (status.response_expectation || hours || status.away_until) ? (
          <div className="mt-2 space-y-1 text-sm">
            {status.away_until ? (
              <p className="rounded-lg bg-accent-tint px-3 py-2 font-medium">
                Away until {new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(status.away_until))}
                {status.away_note ? ` — ${status.away_note}` : ""}
              </p>
            ) : null}
            {status.response_expectation ? <p>In {other}&rsquo;s words: &ldquo;{status.response_expectation}&rdquo;</p> : null}
            {hours ? <p className="text-ink-muted">Working hours: {hours}{status.coach_timezone ? ` (${status.coach_timezone.replace("_", " ")} time)` : ""}</p> : null}
          </div>
        ) : null}

        <details className="mt-2 text-sm text-ink-muted">
          <summary className="cursor-pointer">About this conversation</summary>
          <div className="mt-2 space-y-2">
            <p>
              Only you and {other} can read these messages. TalentYak staff can read a conversation only when a support case about it
              needs it; that access is limited to the case, runs out, and every access is recorded. Messages are protected in transit and
              in our database, but they are not end-to-end encrypted.
            </p>
            <p>TalentYak doesn&rsquo;t show when anyone is online. Replies come when the other person is available.</p>
            <p>
              Anything already downloaded or saved on a device can&rsquo;t be recalled. If access to this conversation ends, it stops
              future access only.
            </p>
            <p className="flex flex-wrap gap-4">
              <a href={`/api/messages/${conversationId}/export`} className="text-brand underline underline-offset-4">Download a copy (text)</a>
              <Link href={`${supportHref}?conversation=${conversationId}`} className="text-brand underline underline-offset-4">Report a problem</Link>
            </p>
          </div>
        </details>
      </header>

      <div
        ref={scroller}
        className="relative flex-1 overflow-y-auto overscroll-contain py-4"
        role="log"
        aria-label={`Messages with ${other}`}
        aria-live="polite"
        aria-relevant="additions"
        onScroll={(e) => {
          const el = e.currentTarget;
          const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          stickToBottom.current = nearBottom;
          if (nearBottom) setNewBelow(false);
        }}
      >
        {hasOlder ? (
          <div className="mb-4 text-center">
            <Button variant="secondary" size="sm" onClick={() => void loadOlder()} disabled={loadingOlder}>
              {loadingOlder ? "Loading…" : "Show earlier messages"}
            </Button>
          </div>
        ) : messages.length ? (
          <p className="mb-4 text-center text-sm text-ink-muted">Start of your conversation with {other}</p>
        ) : null}

        {loadError ? <p role="alert" className="mb-3 text-center text-sm font-medium text-danger">{loadError}</p> : null}

        {!messages.length && !pending.length ? (
          <div className="mx-auto mt-10 max-w-sm text-center text-ink-muted">
            <p className="font-medium text-ink">No messages yet</p>
            <p className="mt-1 text-sm">
              {status.can_send ? `Say hello to ${other}. Messages stay here for both of you.` : "Nothing was sent in this conversation."}
            </p>
          </div>
        ) : null}

        {groups.map((group) => (
          <section key={group.key} aria-label={group.label}>
            <h2 className="sticky top-0 z-10 my-3 text-center">
              <span className="rounded-full bg-paper-raised px-3 py-1 text-xs font-semibold text-ink-muted">{group.label}</span>
            </h2>
            <ol className="space-y-2">
              {group.messages.map((m) => {
                const own = m.sender_profile_id === viewerId;
                return (
                  <li key={m.seq} id={`msg-${m.seq}`}>
                    {m.seq === firstUnreadSeq ? (
                      <p className="my-3 flex items-center gap-2 text-xs font-semibold text-brand">
                        <span className="h-px flex-1 bg-brand" aria-hidden />New messages<span className="h-px flex-1 bg-brand" aria-hidden />
                      </p>
                    ) : null}
                    <div
                      data-seq={m.seq}
                      {...(!own && m.seq > status.my_last_read_seq ? { "data-unread-candidate": "" } : {})}
                      className={`flex ${own ? "justify-end" : "justify-start"}`}
                    >
                      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 ${own ? "bg-brand-tint" : "border border-line bg-surface"}`}>
                        <span className="sr-only">{own ? "You" : m.sender_role === "system" ? "TalentYak" : other}: </span>
                        <MessageBody message={m} expectationsHref={expectationsHref} />
                        <p className="mt-1 text-right text-xs text-ink-muted">
                          <time dateTime={m.created_at}>{timeLabel(m.created_at, timeZone)}</time>
                          {own ? <span> · {m.seq <= status.their_last_read_seq ? "Read" : "Sent"}</span> : null}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}

        {pending.length ? (
          <ol className="mt-2 space-y-2" aria-label="Messages not yet sent">
            {pending.map((p) => (
              <li key={p.clientId} className="flex justify-end">
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 ${p.state === "failed" ? "border border-danger bg-danger-tint" : "bg-brand-tint opacity-70"}`}>
                  {p.mediaKind ? <p className="text-sm italic">{p.mediaKind === "video" ? "Clip" : "Photo"}</p> : null}
                  {p.body ? <p className="whitespace-pre-wrap break-words">{p.body}</p> : null}
                  <p className="mt-1 text-right text-xs" role={p.state === "failed" ? "alert" : "status"}>
                    {p.state === "sending" ? "Sending…" : p.error ?? "Not sent"}
                  </p>
                  {p.state === "failed" ? (
                    <div className="mt-1 flex justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={() => void deliver(p)}>Try again</Button>
                      <Button size="sm" variant="quiet" onClick={() => discard(p.clientId)}>Delete</Button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : null}

        {newBelow ? (
          <div className="sticky bottom-2 text-center">
            <Button
              size="sm"
              onClick={() => {
                const el = scroller.current;
                if (el) el.scrollTop = el.scrollHeight;
                setNewBelow(false);
              }}
            >
              New messages below
            </Button>
          </div>
        ) : null}
      </div>

      {closed ? (
        <div role="status" className="border-t border-line bg-paper-raised px-3 py-3 text-sm">
          <p className="font-medium">{revoked ?? status.reason ?? "Messages can't be sent here."}</p>
          {!revoked ? <StateDates status={status} timeZone={timeZone} /> : null}
          <Link href={`${supportHref}?conversation=${conversationId}`} className="mt-1 inline-block text-brand underline underline-offset-4">
            Contact support
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="border-t border-line pt-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {showUploader && !staged ? (
            <div className="mb-3">
              <MediaUploader
                purpose="chat_attachment"
                enrollmentId={enrollmentId}
                label="Add a photo or clip"
                help="Photos and clips up to 2 minutes. Location and camera details are removed before anyone sees them."
                onUploaded={(assetId, kind) => setStaged({ assetId, kind, state: "processing", reason: null })}
              />
            </div>
          ) : null}
          {staged ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              <p role={staged.state === "failed" ? "alert" : "status"} className={staged.state === "failed" ? "font-medium text-danger" : ""}>
                {staged.state === "processing"
                  ? `Preparing your ${staged.kind === "video" ? "clip" : "photo"}… You can send it once it's ready.`
                  : staged.state === "slow"
                    ? "This is taking longer than usual. You can keep waiting or remove it."
                    : staged.state === "ready"
                      ? `${staged.kind === "video" ? "Clip" : "Photo"} ready. Add a note if you like, then send.`
                      : `That ${staged.kind === "video" ? "clip" : "photo"} couldn't be used${staged.reason ? `: ${staged.reason}` : "."} Nothing was sent.`}
              </p>
              <Button type="button" size="sm" variant="quiet" onClick={() => setStaged(null)}>Remove</Button>
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <label htmlFor="composer" className="sr-only">Message to {other}</label>
            <textarea
              id="composer"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              rows={Math.min(6, Math.max(1, draft.split("\n").length))}
              maxLength={4000}
              placeholder={`Message ${other}`}
              aria-describedby="composer-help"
              className="min-h-11 flex-1 resize-none rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-base"
            />
            <Button type="submit" disabled={(!draft.trim() && staged?.state !== "ready") || (staged !== null && staged.state !== "ready")}>
              Send
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p id="composer-help" className="text-xs text-ink-muted">
              {draft.length > 3500 ? `${4000 - draft.length} characters left. ` : ""}Ctrl or ⌘ + Enter to send.
            </p>
            {!staged ? (
              <Button type="button" size="sm" variant="quiet" onClick={() => setShowUploader((v) => !v)} aria-expanded={showUploader}>
                {showUploader ? "Cancel attachment" : "Add photo or clip"}
              </Button>
            ) : null}
          </div>
        </form>
      )}
    </div>
  );
}

function MessageBody({ message, expectationsHref }: { message: Message; expectationsHref: string }) {
  const a = message.attachment;
  if (message.kind === "expectations_link" && message.expectations_presentation_id) {
    // A link to one presented version of the welcome document. The words are
    // ours (written by the database); the destination checks access again.
    return (
      <p>
        <span className="block font-semibold">{message.body ?? "Coaching Welcome & Expectations"}</span>
        <Link href={`${expectationsHref}?v=${message.expectations_presentation_id}`} className="mt-1 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4">
          Open the Coaching Welcome &amp; Expectations
        </Link>
      </p>
    );
  }
  return (
    <>
      {a ? (
        a.media_kind === "image" ? (
          <a href={`/api/media/${a.id}`} target="_blank" rel="noopener" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element -- a two-minute private link via our own route */}
            <img
              src={`/api/media/${a.id}?variant=preview`}
              alt="Photo"
              width={a.width ?? undefined}
              height={a.height ?? undefined}
              loading="lazy"
              className="max-h-72 w-auto rounded-lg"
            />
          </a>
        ) : (
          <video controls preload="none" playsInline className="max-h-72 w-full rounded-lg" src={`/api/media/${a.id}`}>
            <track kind="captions" />
          </video>
        )
      ) : message.has_attachment ? (
        <p className="text-sm italic text-ink-muted">Attachment no longer available</p>
      ) : null}
      {message.kind !== "text" && message.kind !== "attachment" && message.kind !== "system" ? (
        <p className="text-sm italic text-ink-muted">This message type isn&rsquo;t available yet.</p>
      ) : message.body ? (
        <p className={`whitespace-pre-wrap break-words ${a ? "mt-1" : ""}`}>{message.body}</p>
      ) : null}
    </>
  );
}

function StateDates({ status, timeZone }: { status: ConversationStatus; timeZone: string }) {
  const d = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "medium" }).format(new Date(iso)) : null);
  const facts: string[] = [];
  if (status.state === "paused" && status.paid_through) facts.push(`Paid time ran out on ${d(status.paid_through)}.`);
  if (status.state === "ended" && (status.ended_at || status.paid_through)) facts.push(`Coaching ended on ${d(status.ended_at ?? status.paid_through)}.`);
  if (status.state === "reassigned" && status.assigned_to) facts.push(`${status.coach_name} coached you until ${d(status.assigned_to)}.`);
  return facts.length ? <p className="mt-1 text-ink-muted">{facts.join(" ")}</p> : null;
}
